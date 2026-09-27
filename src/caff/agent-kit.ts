import { env } from "cloudflare:workers";
import type { Agent } from "agents";
import type { ModelMessage, StepResult, ToolSet } from "ai";
import { createWorkersAI } from "workers-ai-provider";

/**
 * Plumbing for src/agent.ts: the HTTP chat protocol used by /chat, model
 * setup, conversation history and dashboard reporting. You can read it, but
 * you don't need to change it for the guided path.
 */

export interface ToolTrace {
  /** The MCP tool name, e.g. "place_order" */
  name: string;
  /** Which MCP server it came from (the name you gave addMcpServer) */
  server: string;
  input: unknown;
  output?: unknown;
  error?: string;
}

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
  at: string;
  tools?: ToolTrace[];
}

export interface ChatState {
  messages: ChatMessage[];
}

export interface ChatReply {
  reply: string;
  tools: ToolTrace[];
}

/** What the kit needs from your agent class. */
export type ChatAgent = Agent<Env, ChatState> & {
  chat(message: string, origin: string): Promise<ChatReply>;
};

const DEFAULT_MODEL = "@cf/zai-org/glm-4.7-flash";

function modelName(bindings: Env = env): string {
  return (bindings.MODEL as string | undefined) || DEFAULT_MODEL;
}
const HISTORY_FOR_MODEL = 12;
const HISTORY_TO_KEEP = 40;

// -----------------------------------------------------------------------------
// Model
// -----------------------------------------------------------------------------

/** The Workers AI model named in wrangler.jsonc (vars.MODEL), tuned for snappy tool calling. */
export function chatModel(bindings: Env = env) {
  const workersai = createWorkersAI({ binding: bindings.AI });
  const model = modelName(bindings);
  // Reasoning models think before they answer. For a chatty caff manager
  // we want quick replies, so turn thinking off (or down) where we can.
  const settings: Record<string, unknown> = {};
  if (model.includes("glm-4.7-flash")) settings.chat_template_kwargs = { enable_thinking: false };
  else if (model.includes("gpt-oss")) settings.reasoning_effort = "low";
  return workersai(model as Parameters<typeof workersai>[0], settings as Parameters<typeof workersai>[1]);
}

// -----------------------------------------------------------------------------
// Conversation history
// -----------------------------------------------------------------------------

/** The recent conversation plus the new message, in the shape the AI SDK expects. */
export function toModelMessages(history: ChatMessage[], newMessage: string): ModelMessage[] {
  const recent = history.slice(-HISTORY_FOR_MODEL).map((m) => ({ role: m.role, content: m.content }) as ModelMessage);
  return [...recent, { role: "user", content: newMessage }];
}

/** A new state with this turn appended (and old turns trimmed). */
export function rememberTurn(state: ChatState, userMessage: string, reply: string, tools: ToolTrace[]): ChatState {
  const now = new Date().toISOString();
  const messages: ChatMessage[] = [
    ...(state?.messages ?? []),
    { role: "user", content: userMessage, at: now },
    { role: "assistant", content: reply || "(no reply)", at: now, tools }
  ];
  return { ...state, messages: messages.slice(-HISTORY_TO_KEEP) };
}

// -----------------------------------------------------------------------------
// Tool call traces (shown as chips in the chat UI)
// -----------------------------------------------------------------------------

/** Turn the AI SDK's steps into a simple list of the MCP tools the model called. */
export function traceTools(agent: ChatAgent, steps: StepResult<ToolSet>[]): ToolTrace[] {
  const names = toolNameLookup(agent);
  const traces = new Map<string, ToolTrace>();
  for (const step of steps) {
    for (const part of step.content) {
      if (part.type === "tool-call") {
        const known = names.get(part.toolName);
        traces.set(part.toolCallId, {
          name: known?.name ?? part.toolName,
          server: known?.server ?? "local",
          input: part.input
        });
      } else if (part.type === "tool-result") {
        const trace = traces.get(part.toolCallId);
        if (trace) trace.output = simplifyOutput(part.output);
      } else if (part.type === "tool-error") {
        const trace = traces.get(part.toolCallId);
        if (trace) trace.error = part.error instanceof Error ? part.error.message : String(part.error);
      }
    }
  }
  return [...traces.values()];
}

/** Map AI SDK tool keys (tool_<serverId>_<name>) back to MCP tool and server names. */
function toolNameLookup(agent: ChatAgent) {
  const lookup = new Map<string, { name: string; server: string }>();
  try {
    const state = agent.getMcpServers();
    for (const tool of agent.mcp.listTools()) {
      const key = `tool_${tool.serverId.replace(/-/g, "")}_${tool.name}`;
      lookup.set(key, { name: tool.name, server: state.servers[tool.serverId]?.name ?? tool.serverId });
    }
  } catch {
    // No MCP servers yet.
  }
  return lookup;
}

/** MCP results are { content: [{ type: "text", text }] }. Show the JSON inside instead. */
function simplifyOutput(output: unknown): unknown {
  const content = (output as { content?: { type: string; text?: string }[] })?.content;
  if (!Array.isArray(content)) return output;
  const text = content
    .filter((c) => c.type === "text")
    .map((c) => c.text ?? "")
    .join("\n");
  try {
    return JSON.parse(text);
  } catch {
    return text.length > 4000 ? `${text.slice(0, 4000)}…` : text;
  }
}

// -----------------------------------------------------------------------------
// HTTP chat protocol for /chat
//
//   GET    /agents/caff-agent/<session>   { messages, model, mcp }
//   POST   /agents/caff-agent/<session>   { message } -> { reply, tools, ms, model, mcp }
//   DELETE /agents/caff-agent/<session>   start a fresh conversation
// -----------------------------------------------------------------------------

const reportedHops = new Set<string>();

export async function handleChatRequest(agent: ChatAgent, request: Request): Promise<Response> {
  const url = new URL(request.url);
  const model = modelName();

  if (request.method === "GET") {
    return json({ messages: agent.state?.messages ?? [], model, mcp: mcpStatus(agent) });
  }
  if (request.method === "DELETE") {
    agent.setState({ ...agent.state, messages: [] });
    return json({ ok: true });
  }
  if (request.method !== "POST") return json({ error: "Use GET, POST or DELETE" }, 405);

  let message = "";
  try {
    const body = (await request.json()) as { message?: unknown };
    message = String(body?.message ?? "").trim().slice(0, 2000);
  } catch {
    // fall through
  }
  if (!message) return json({ error: 'Send JSON like { "message": "What\'s on the menu?" }' }, 400);

  const started = Date.now();
  try {
    // After a restart, saved MCP connections reconnect in the background.
    await agent.mcp.waitForConnections({ timeout: 5_000 });
    const { reply, tools } = await agent.chat(message, url.origin);
    if (request.headers.get("x-caff-client") !== "smoke") await reportTurn(agent, url.origin, tools);
    return json({ reply, tools, ms: Date.now() - started, model, mcp: mcpStatus(agent) });
  } catch (e) {
    console.error("chat failed", e);
    return json({ error: friendlyError(e, url.origin), ms: Date.now() - started, model, mcp: mcpStatus(agent) }, 500);
  }
}

/** Tell the dashboard what happened, for the mission board and activity feed. */
async function reportTurn(agent: ChatAgent, ownOrigin: string, tools: ToolTrace[]) {
  try {
    const store = env.CAFF.getByName("caff");
    const status = mcpStatus(agent);
    await store.noteAgentReply({ toolCount: status.toolCount, toolsUsed: tools.map((t) => t.name) });
    for (const server of status.servers) {
      const origin = safeOrigin(server.url);
      if (server.state === "ready" && origin && origin !== ownOrigin && !reportedHops.has(origin)) {
        reportedHops.add(origin);
        await store.noteTableHop(origin);
      }
    }
  } catch (e) {
    console.warn("could not report to dashboard", e);
  }
}

export function mcpStatus(agent: ChatAgent) {
  try {
    const state = agent.getMcpServers();
    const servers = Object.entries(state.servers).map(([id, s]) => ({
      name: s.name,
      url: s.server_url,
      state: s.state,
      error: s.error,
      tools: state.tools.filter((t) => t.serverId === id).map((t) => t.name)
    }));
    return { servers, toolCount: state.tools.length };
  } catch {
    return { servers: [], toolCount: 0 };
  }
}

function friendlyError(e: unknown, origin: string): string {
  const text = e instanceof Error ? e.message : String(e);
  if (/4006|daily free allocation|neurons/i.test(text)) {
    return "You've used today's free Workers AI allowance (10,000 Neurons). Try a cheaper model in wrangler.jsonc (vars.MODEL) or upgrade to Workers Paid.";
  }
  if (/5035|requires a Workers Paid plan/i.test(text)) {
    return 'That model needs the Workers Paid plan. Set vars.MODEL in wrangler.jsonc to "@cf/zai-org/glm-4.7-flash".';
  }
  if (/3040|capacity|429/i.test(text)) {
    return "Workers AI is busy right now. Give it a few seconds and try again.";
  }
  if (/mcp|connect|fetch failed|discover|initialize/i.test(text)) {
    return `Couldn't use your MCP server at ${origin}/mcp: ${text}. Check it works with "npm run smoke" or MCP Inspector.`;
  }
  return `Something went wrong: ${text}`;
}

function safeOrigin(url: string): string | null {
  try {
    return new URL(url).origin;
  } catch {
    return null;
  }
}

function json(data: unknown, status = 200): Response {
  return Response.json(data, { status, headers: { "cache-control": "no-store" } });
}

// -----------------------------------------------------------------------------
// Stretch goal helpers
// -----------------------------------------------------------------------------

/** Tell the mission board a scheduled task ran ("Clockwork"). */
export async function reportScheduledTask(description: string) {
  await env.CAFF.getByName("caff").noteScheduledTask(description);
}
