import { Agent, getAgentByName } from "agents";
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
- Tables are numbered 1 to 12. Use the item ids the menu gives you.
- Only say something is done after the tool call worked. If a tool returns an error, explain it and suggest a fix.
- Tools give prices in pence (450 means £4.50). Always show prices in pounds, like £4.50, and quote the totals the tools give you.
- Always mention order numbers, like #104.
- Refunds need the manager's approval: use request_refund, then check_approval when asked.
- When someone tells you a regular's usual order, call remember_regular before you reply. Only place an order when asked to.
- Keep replies short and cheerful. Plain text, no emoji, no sign-offs like "let me know if you need anything else".`;

interface StretchState extends ChatState {
  /** This Worker's origin, saved so scheduled tasks can reconnect to /mcp. */
  origin?: string;
  /** Kitchen instance only: when someone last chatted, so the stock check can stop itself. */
  lastChatAt?: number;
  /** Regulars and their usual orders: agent memory that survives restarts. */
  regulars?: Record<string, string>;
}

const MCP_HEADERS = (origin: string) => ({ "x-caff-client": "agent", "x-caff-origin": origin });

/**
 * Every chat session is its own CaffAgent. The stock check runs on one extra instance with this
 * name, so there is only ever one check however many conversations are open.
 */
const KITCHEN = "kitchen";

/** The stock check stops itself once nobody has chatted for this long. */
const IDLE_STOP_MS = 60 * 60 * 1000;

/**
 * Stretch reference. On top of the finished agent:
 *   - memory: remembers regulars' usual orders in its own state
 *   - local tools: tools that run inside the agent, mixed with MCP tools
 *   - table hopping: connects to another table's MCP server on request
 *   - scheduling: a stock check every two minutes that restocks anything low, run by one
 *     "kitchen" instance and stopped after an hour without chat
 */
export class CaffAgent extends Agent<Env, StretchState> {
  initialState: StretchState = { messages: [], regulars: {} };

  async onRequest(request: Request) {
    return handleChatRequest(this, request);
  }

  async chat(message: string, origin: string): Promise<ChatReply> {
    if (this.state.origin !== origin) this.setState({ ...this.state, origin });
    await this.connectToCaff(origin);

    // Ask the kitchen instance to run the stock check. Safe to call every turn: scheduleEvery
    // is idempotent, and it always lands on the same instance.
    const kitchen = (await getAgentByName(this.env.CaffAgent, KITCHEN)) as unknown as DurableObjectStub<CaffAgent>;
    await kitchen.startStockCheck(origin);

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

  /** Runs on the kitchen instance. Starts the two-minute stock check (once) and notes the time. */
  async startStockCheck(origin: string) {
    this.setState({ ...this.state, origin, lastChatAt: Date.now() });
    await this.scheduleEvery(120, "stockCheck");
  }

  /** Runs every two minutes once scheduled. Restocks anything running low. */
  async stockCheck() {
    // Nobody has chatted for an hour: stop, so the check doesn't run forever after the event.
    if (Date.now() - (this.state.lastChatAt ?? 0) > IDLE_STOP_MS) {
      for (const schedule of await this.listSchedules()) {
        if (schedule.callback === "stockCheck") await this.cancelSchedule(schedule.id);
      }
      return;
    }
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
