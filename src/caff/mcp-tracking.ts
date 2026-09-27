import type { Source } from "./types";

export interface McpCaller {
  source: Source;
  /** For visiting agents: the origin of the Worker they came from. */
  fromOrigin: string | null;
}

/**
 * Work out who is calling /mcp.
 *
 * Your agent sends `x-caff-client: agent` and `x-caff-origin: <its origin>`
 * (see src/agent.ts). If that origin is not this Worker, it's another
 * table's agent paying a visit. Everyone else is a regular MCP client.
 */
export function identifyMcpCaller(request: Request, ownOrigin: string): McpCaller {
  const client = request.headers.get("x-caff-client");
  const fromOrigin = request.headers.get("x-caff-origin");
  if (client === "smoke") return { source: "smoke", fromOrigin: null };
  if (client === "agent") {
    if (fromOrigin && safeOrigin(fromOrigin) !== ownOrigin) return { source: "visitor", fromOrigin: safeOrigin(fromOrigin) };
    return { source: "agent", fromOrigin: null };
  }
  return { source: "mcp", fromOrigin: null };
}

/**
 * Peek at the JSON-RPC body of an MCP request and tell the caff about
 * tools/list and tools/call, so the mission board can tick. Runs in the
 * background (ctx.waitUntil) and never affects the MCP response.
 */
export async function trackMcpRequest(request: Request, env: Env, caller: McpCaller): Promise<void> {
  if (request.method !== "POST") return;
  try {
    const body = (await request.json()) as unknown;
    const messages = Array.isArray(body) ? body : [body];
    const store = env.CAFF.getByName("caff");
    for (const msg of messages) {
      if (!msg || typeof msg !== "object") continue;
      const { method, params } = msg as { method?: unknown; params?: { name?: unknown } };
      if (method !== "tools/list" && method !== "tools/call") continue;
      await store.trackMcp({
        method,
        tool: typeof params?.name === "string" ? params.name : undefined,
        source: caller.source,
        fromOrigin: caller.fromOrigin
      });
    }
  } catch {
    // Not JSON, or the store is busy. Tracking is best effort.
  }
}

function safeOrigin(value: string): string {
  try {
    return new URL(value).origin;
  } catch {
    return value.slice(0, 100);
  }
}
