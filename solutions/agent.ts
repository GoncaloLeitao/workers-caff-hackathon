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
} from "../src/caff/agent-kit";

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
 * Checkpoint 3, finished: an agent that runs the caff through your MCP server.
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
    // 1. Connect to your own MCP server, the same way AI Playground did.
    //    The headers tell the dashboard these calls come from your agent.
    //    (Safe to call every time: it reuses the existing connection.)
    await this.addMcpServer("caff", `${origin}/mcp`, {
      transport: {
        type: "streamable-http",
        headers: { "x-caff-client": "agent", "x-caff-origin": origin }
      }
    });

    // 2. Give the model the conversation so far plus every tool your MCP
    //    server offers. The model picks tools, the SDK runs them over MCP and
    //    feeds the results back, round after round, until it has an answer.
    const result = await generateText({
      model: chatModel(this.env),
      system: SYSTEM_PROMPT,
      messages: toModelMessages(this.state.messages, message),
      tools: this.mcp.getAITools(),
      stopWhen: isStepCount(8)
    });

    // 3. Remember the conversation. setState saves it in this agent's storage.
    const tools = traceTools(this, result.steps);
    this.setState(rememberTurn(this.state, message, result.text, tools));

    return { reply: result.text, tools };
  }
}
