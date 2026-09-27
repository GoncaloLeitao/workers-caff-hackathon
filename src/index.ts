import { routeAgentRequest } from "agents";
import { createMcpHandler } from "agents/mcp/server";
import { handleApi } from "./caff/api";
import { caffFor } from "./caff/client";
import { identifyMcpCaller, trackMcpRequest } from "./caff/mcp-tracking";
import { createCaffMcpServer } from "./mcp";

// Durable Object classes must be exported from the Worker's entry point.
export { CaffStore } from "./caff/store";
export { CaffAgent } from "./agent";

/**
 * The Workers Caff: one Worker, four jobs.
 *
 *   /             the live dashboard (static files in ./public)
 *   /chat         a chat UI for your agent (./public/chat.html)
 *   /api/*        the caff's REST API          -> src/caff/api.ts
 *   /mcp          your MCP server              -> src/mcp.ts    (Checkpoint 2)
 *   /agents/*     your agent                   -> src/agent.ts  (Checkpoint 3)
 *
 * You don't need to edit this file for the guided path.
 */
export default {
  async fetch(request, env, ctx): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname.startsWith("/api/")) {
      return handleApi(request, env);
    }

    if (url.pathname === "/mcp") {
      const caller = identifyMcpCaller(request, url.origin);
      ctx.waitUntil(trackMcpRequest(request.clone(), env, caller));
      // A fresh MCP server per request, wired to the caff and labelled with who is calling.
      const handler = createMcpHandler(() => createCaffMcpServer(caffFor(env, caller.source)));
      return handler(request, env, ctx);
    }

    // Routes /agents/caff-agent/<session> to a CaffAgent instance.
    const agentResponse = await routeAgentRequest(request, env);
    if (agentResponse) return agentResponse;

    return env.ASSETS.fetch(request);
  }
} satisfies ExportedHandler<Env>;
