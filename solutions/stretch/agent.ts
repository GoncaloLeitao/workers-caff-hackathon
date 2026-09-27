import { Agent } from "agents";
import { generateText, isStepCount, tool } from "ai";
import { z } from "zod";
import {
  chatModel,
  handleChatRequest,
  rememberTurn,
  reportScheduledTask,
  toModelMessages,
  traceTools,
  type ChatReply,
  type ChatState
} from "../../src/caff/agent-kit";

const SYSTEM_PROMPT = `You are Sid, the manager of The Workers Caff, a busy cafe in London.
You help the staff take orders, keep the kitchen moving and keep stock topped up.

Rules:
- Use your tools for anything about the menu, orders or stock. Never guess prices, stock or order numbers.
- Item ids come from get_menu. Tables are numbered 1 to 12.
- Only say something is done after the tool call worked. If a tool returns an error, explain it and suggest a fix.
- Prices are in pence: 450 means £4.50. Quote the totals the tools give you.
- Always mention order numbers, like #104.
- Refunds need the manager's approval: use request_refund, then check_approval when asked.
- When someone tells you a regular's usual order, save it with remember_regular.
- Keep replies short and cheerful. Plain text, no emoji.`;

interface StretchState extends ChatState {
  /** This Worker's origin, saved so scheduled tasks can reconnect to /mcp. */
  origin?: string;
  /** Regulars and their usual orders: agent memory that survives restarts. */
  regulars?: Record<string, string>;
}

const MCP_HEADERS = (origin: string) => ({ "x-caff-client": "agent", "x-caff-origin": origin });

/**
 * Stretch reference. On top of the finished agent:
 *   - memory: remembers regulars' usual orders in its own state
 *   - local tools: tools that run inside the agent, mixed with MCP tools
 *   - table hopping: connects to another table's MCP server on request
 *   - scheduling: a stock check every two minutes that restocks anything low
 */
export class CaffAgent extends Agent<Env, StretchState> {
  initialState: StretchState = { messages: [], regulars: {} };

  async onRequest(request: Request) {
    return handleChatRequest(this, request);
  }

  async chat(message: string, origin: string): Promise<ChatReply> {
    if (this.state.origin !== origin) this.setState({ ...this.state, origin });
    await this.connectToCaff(origin);

    // Safe to call every time: the same callback + interval is only scheduled once.
    await this.scheduleEvery(120, "stockCheck");

    const result = await generateText({
      model: chatModel(this.env),
      system: SYSTEM_PROMPT + this.regularsNote(),
      messages: toModelMessages(this.state.messages, message),
      tools: { ...this.mcp.getAITools(), ...this.localTools(origin) },
      stopWhen: isStepCount(10)
    });

    const tools = traceTools(this, result.steps);
    this.setState(rememberTurn(this.state, message, result.text, tools));
    return { reply: result.text, tools };
  }

  private connectToCaff(origin: string) {
    return this.addMcpServer("caff", `${origin}/mcp`, {
      transport: { type: "streamable-http", headers: MCP_HEADERS(origin) }
    });
  }

  private regularsNote(): string {
    const regulars = Object.entries(this.state.regulars ?? {});
    if (!regulars.length) return "";
    return `\n\nRegulars you know:\n${regulars.map(([name, usual]) => `- ${name}: ${usual}`).join("\n")}`;
  }

  /** Tools that run inside the agent rather than over MCP. */
  private localTools(origin: string) {
    return {
      remember_regular: tool({
        description: "Remember a regular customer's usual order so you can place it next time they ask for 'the usual'.",
        inputSchema: z.object({
          name: z.string().describe("The customer's name"),
          usual: z.string().describe("Their usual order, in words")
        }),
        execute: async ({ name, usual }) => {
          this.setState({ ...this.state, regulars: { ...(this.state.regulars ?? {}), [name]: usual } });
          return `Saved. ${name}'s usual is ${usual}.`;
        }
      }),
      visit_table: tool({
        description:
          "Connect to another table's caff so you can use their MCP tools too. Needs the other table's Worker URL, like https://workers-caff.someone.workers.dev",
        inputSchema: z.object({ url: z.string().describe("The other table's Worker URL") }),
        execute: async ({ url }) => {
          const target = new URL("/mcp", url);
          const name = `table-${target.hostname.split(".")[1] ?? target.hostname}`;
          await this.addMcpServer(name, target.toString(), {
            transport: { type: "streamable-http", headers: MCP_HEADERS(origin) }
          });
          return `Connected to ${target}. Their tools will be available from the next message.`;
        }
      })
    };
  }

  /** Runs every two minutes once scheduled. Restocks anything running low. */
  async stockCheck() {
    const origin = this.state.origin;
    if (!origin) return;
    await this.connectToCaff(origin);
    const serverId = Object.entries(this.getMcpServers().servers).find(([, s]) => s.name === "caff")?.[0];
    if (!serverId) return;

    const menuResult = await this.mcp.callTool({ serverId, name: "get_menu", arguments: {} });
    const text = (menuResult.content as { type: string; text?: string }[])?.find((c) => c.type === "text")?.text ?? "[]";
    const menu = JSON.parse(text) as { id: string; name: string; stock: number }[];
    const low = menu.filter((item) => item.stock <= 4);
    for (const item of low) {
      await this.mcp.callTool({ serverId, name: "restock_item", arguments: { itemId: item.id, quantity: 10 } });
    }
    await reportScheduledTask(
      low.length ? `stock check restocked ${low.map((i) => i.name).join(", ")}` : "stock check, nothing low"
    );
  }
}
