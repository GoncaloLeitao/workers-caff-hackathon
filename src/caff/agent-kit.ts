import { AsyncLocalStorage } from "node:async_hooks";
import { env } from "cloudflare:workers";
import type { Agent } from "agents";
import { wrapLanguageModel, type ModelMessage, type StepResult, type ToolSet } from "ai";
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

const DEFAULT_MODEL = "@cf/openai/gpt-oss-120b";

function modelName(bindings: Env = env): string {
  return (bindings.MODEL as string | undefined) || DEFAULT_MODEL;
}
const HISTORY_FOR_MODEL = 12;
const HISTORY_TO_KEEP = 40;

// -----------------------------------------------------------------------------
// Model
// -----------------------------------------------------------------------------

const NO_TOOLS_NOTE =
  "Right now you have NO tools and cannot call any functions, so you cannot see or change the menu, orders or stock. " +
  "Never write out a function or tool call. Do not pretend to have done anything. Reply in plain text: explain that " +
  "you're not connected to the caff's systems yet (your developer needs to connect the MCP server in src/agent.ts), " +
  "then help with anything else.";

const NOT_CONNECTED_REPLY =
  "I'm not connected to the caff's systems yet, so I can't see the menu, orders or stock. " +
  "Connect me to your MCP server in src/agent.ts (Checkpoint 3) and I'll get stuck in.";

const WIRES_CROSSED = "Sorry, I got my wires crossed there. Could you ask me that again?";

/**
 * Some open models occasionally leak their raw tool-call syntax as text
 * (for example gpt-oss's "<|channel|>" tokens), or get stuck repeating one
 * character ("!!!!!!…"). Tidy that up so the chat stays readable.
 */
export function cleanReply(text: string, hadTools: boolean): string {
  const leaked = /<\|(start|channel|message|call|end|constrain)\|>/.test(text);
  const cleaned = text
    .replace(/<\|start\|>[\s\S]*?(<\|call\|>|<\|end\|>|$)/g, "")
    .replace(/<\|[a-z_]+\|>/g, "")
    .trim();
  if (/([^\s])\1{49,}/.test(cleaned)) return WIRES_CROSSED;
  if (cleaned) return cleaned;
  if (!hadTools) return NOT_CONNECTED_REPLY;
  return leaked ? WIRES_CROSSED : "";
}

/** Token usage for the current chat turn, so the chat UI can show what each reply cost. */
interface TurnUsage {
  modelCalls: number;
  inputTokens: number;
  outputTokens: number;
}
const turnUsage = new AsyncLocalStorage<TurnUsage>();

/** The Workers AI model named in wrangler.jsonc (vars.MODEL), tuned for snappy tool calling. */
export function chatModel(bindings: Env = env) {
  const workersai = createWorkersAI({ binding: bindings.AI });
  const model = modelName(bindings);
  // Reasoning models think before they answer. For a chatty caff manager we
  // want quick replies, so keep the thinking short.
  const settings: Record<string, unknown> = {};
  if (model.includes("gpt-oss") || model.includes("glm")) settings.reasoning_effort = "low";
  return wrapLanguageModel({
    model: workersai(model as Parameters<typeof workersai>[0], settings as Parameters<typeof workersai>[1]),
    middleware: {
      transformParams: async ({ params }) => {
        // Before Checkpoint 3 the agent has no tools. Tell the model, so it
        // doesn't pretend to take orders (or try to call tools it hasn't got).
        const prompt = params.tools?.length
          ? params.prompt
          : [{ role: "system" as const, content: NO_TOOLS_NOTE }, ...params.prompt];
        // Some models default to very short replies (256 tokens). Give them room.
        return { ...params, prompt, maxOutputTokens: params.maxOutputTokens ?? 2048 };
      },
      wrapGenerate: async ({ doGenerate }) => {
        const result = await doGenerate();
        const tally = turnUsage.getStore();
        if (tally) {
          tally.modelCalls += 1;
          tally.inputTokens += tokenCount(result.usage?.inputTokens);
          tally.outputTokens += tokenCount(result.usage?.outputTokens);
        }
        return result;
      }
    }
  });
}

function tokenCount(value: unknown): number {
  if (typeof value === "number") return value;
  const total = (value as { total?: unknown } | undefined)?.total;
  return typeof total === "number" ? total : 0;
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
    await agent.mcp.waitForConnections({ timeout: 3_000 });
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
  const usage: TurnUsage = { modelCalls: 0, inputTokens: 0, outputTokens: 0 };
  try {
    // After a restart, saved MCP connections reconnect in the background.
    await agent.mcp.waitForConnections({ timeout: 5_000 });
    const { reply: text, tools } = await turnUsage.run(usage, () => agent.chat(message, url.origin));
    const reply =
      cleanReply(text, mcpStatus(agent).toolCount > 0) ||
      (tools.length
        ? `(Sid made ${tools.length} tool call${tools.length === 1 ? "" : "s"} but ran out of steps before replying. The chips below show what he did.)`
        : "(Sid went quiet. The model returned no text, so try asking again.)");
    // Keep the saved conversation in step with what the user actually saw.
    const saved = agent.state?.messages ?? [];
    const last = saved[saved.length - 1];
    if (last?.role === "assistant" && last.content !== reply) {
      agent.setState({ ...agent.state, messages: [...saved.slice(0, -1), { ...last, content: reply }] });
    }
    if (request.headers.get("x-caff-client") !== "smoke") await reportTurn(agent, url.origin, tools);
    return json({ reply, tools, usage, ms: Date.now() - started, model, mcp: mcpStatus(agent) });
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
    return 'You\'ve used today\'s free Workers AI allowance (10,000 Neurons). Switch vars.MODEL in wrangler.jsonc to "@cf/zai-org/glm-4.7-flash" (about a third of the cost) or upgrade to Workers Paid.';
  }
  if (/5035|requires a Workers Paid plan/i.test(text)) {
    return 'That model needs the Workers Paid plan. Set vars.MODEL in wrangler.jsonc back to "@cf/openai/gpt-oss-120b".';
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
