import { Agent } from "agents";
import { generateText, isStepCount } from "ai";
import {
  chatModel,
  handleChatRequest,
  rememberTurn,
  toModelMessages,
  traceTools,
  type ChatReply,
  type ChatState
} from "./caff/agent-kit";

/** Who your agent is and how it should behave. Make it your own. */
const SYSTEM_PROMPT = `You are Sid, the manager of The Workers Caff, a busy cafe in London.
You help the staff take orders, keep the kitchen moving and keep stock topped up.

Rules:
- Use your tools for anything about the menu, orders or stock. Never guess prices, stock or order numbers.
- Tables are numbered 1 to 12. Use the item ids the menu gives you.
- Only say something is done after the tool call worked. If a tool returns an error, explain it and suggest a fix.
- Tools give prices in pence (450 means £4.50). Always show prices in pounds, like £4.50, and quote the totals the tools give you.
- Always mention order numbers, like #104.
- If you have no tools available, say you are not connected to the caff's systems yet.
- Keep replies short and cheerful. Plain text, no emoji, no sign-offs like "let me know if you need anything else".`;

/**
 * CHECKPOINT 3: your agent
 * ========================
 *
 * Open /chat on your Worker and say hello. Sid can talk, but can't do
 * anything yet: he isn't connected to the caff. Two changes fix that:
 *
 *   TODO 1  connect to your MCP server with this.addMcpServer(...)
 *   TODO 2  hand the model your MCP tools with this.mcp.getAITools()
 *
 * Then ask Sid to take an order and watch the dashboard.
 * Stuck? Run `npm run skip:agent` (your file is backed up to src/agent.ts.bak first).
 *
 * Each chat session gets its own CaffAgent instance. It's a Durable Object,
 * so it keeps its state (the conversation) between messages.
 */
export class CaffAgent extends Agent<Env, ChatState> {
  initialState: ChatState = { messages: [] };

  // The chat UI at /chat talks to this agent over HTTP.
  async onRequest(request: Request) {
    return handleChatRequest(this, request);
  }

  async chat(message: string, origin: string): Promise<ChatReply> {
    // TODO 1: connect to your own MCP server, the same way AI Playground did.
    // Uncomment this. The headers tell the dashboard the calls come from your agent.
    //
    // await this.addMcpServer("caff", `${origin}/mcp`, {
    //   transport: {
    //     type: "streamable-http",
    //     headers: { "x-caff-client": "agent", "x-caff-origin": origin }
    //   }
    // });

    // Ask the model. It sees the conversation so far and, once you've done
    // TODO 2, every tool your MCP server offers. The SDK runs the tools the
    // model picks and feeds the results back until it has an answer.
    const result = await generateText({
      model: chatModel(this.env),
      system: SYSTEM_PROMPT,
      messages: toModelMessages(this.state.messages, message),
      // TODO 2: give the model your MCP tools. Uncomment the next line.
      // tools: this.mcp.getAITools(),
      stopWhen: isStepCount(8)
    });

    // Remember the conversation. setState saves it in this agent's storage.
    const tools = traceTools(this, result.steps);
    this.setState(rememberTurn(this.state, message, result.text, tools));

    return { reply: result.text, tools };
  }
}
