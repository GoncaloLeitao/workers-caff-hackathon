#!/usr/bin/env node
// Health check for your caff: API, MCP server and (optionally) the agent.
//
//   npm run smoke                                   checks http://localhost:8787
//   npm run smoke -- https://workers-caff.you.workers.dev
//   npm run smoke -- <url> --write                  also exercises the write tools (orders show as "smoke")
//   npm run smoke -- <url> --agent                  also asks your agent a question
//   npm run smoke -- <url> --reset                  wipes the caff AND the mission board first (careful)
//
// The URL can be your Worker or its MCP server URL: a trailing /mcp is ignored.
// Smoke-test traffic is labelled "smoke" and never ticks missions.

const args = process.argv.slice(2);
// Accept the Worker URL or the MCP URL people copy from the dashboard.
const base = (args.find((a) => !a.startsWith("--")) ?? "http://localhost:8787").replace(/\/+$/, "").replace(/\/mcp$/, "");
const flags = new Set(args.filter((a) => a.startsWith("--")));

const CHECKPOINT_2_TOOLS = ["place_order", "list_orders", "update_order_status", "restock_item"];
let failures = 0;

const ok = (msg) => console.log(`  \x1b[32m✓\x1b[0m ${msg}`);
const bad = (msg) => {
  failures++;
  console.log(`  \x1b[31m✗\x1b[0m ${msg}`);
};
const info = (msg) => console.log(`  \x1b[2m•\x1b[0m ${msg}`);

async function api(path, init = {}) {
  const res = await fetch(`${base}${path}`, {
    ...init,
    headers: { "content-type": "application/json", ...(init.headers ?? {}) }
  });
  const body = await res.json().catch(() => null);
  return { res, body };
}

let rpcId = 0;
async function mcp(method, params = {}) {
  const res = await fetch(`${base}/mcp`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      "mcp-protocol-version": "2025-06-18",
      "x-caff-client": "smoke"
    },
    body: JSON.stringify({ jsonrpc: "2.0", id: ++rpcId, method, params })
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${text.slice(0, 200)}`);
  // Responses come back as plain JSON or as a single server-sent event.
  const payload = text.trim().startsWith("{")
    ? text
    : text
        .split("\n")
        .filter((l) => l.startsWith("data:"))
        .map((l) => l.slice(5).trim())
        .join("");
  const msg = JSON.parse(payload);
  if (msg.error) throw new Error(msg.error.message ?? JSON.stringify(msg.error));
  return msg.result;
}

function toolJson(result) {
  const text = result?.content?.find((c) => c.type === "text")?.text ?? "";
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

console.log(`\nSmoke testing ${base}\n`);

// 1. REST API ---------------------------------------------------------------
console.log("API");
try {
  if (flags.has("--reset")) {
    await api("/api/reset", { method: "POST", body: JSON.stringify({ everything: true }) });
    info("reset the caff and the mission board");
  }
  const { res, body } = await api("/api/state");
  if (res.ok && Array.isArray(body?.menu)) {
    ok(`GET /api/state → ${body.menu.length} menu items, ${body.orders.length} orders`);
    const done = body.missions.filter((m) => m.done).length;
    info(`missions complete: ${done}/${body.missions.length}`);
  } else bad(`GET /api/state → HTTP ${res.status}`);
} catch (e) {
  bad(`couldn't reach ${base}: ${e.message}`);
  console.log(`\nIs it running? Try "npm run dev" first, or pass your Worker URL.\n`);
  process.exit(1);
}

// 2. MCP server ------------------------------------------------------------------
console.log("\nMCP server (/mcp)");
let toolNames = [];
try {
  const init = await mcp("initialize", {
    protocolVersion: "2025-06-18",
    capabilities: {},
    clientInfo: { name: "caff-smoke-test", version: "1.0.0" }
  });
  ok(`initialize → ${init.serverInfo?.name} ${init.serverInfo?.version}`);
  const list = await mcp("tools/list");
  toolNames = list.tools.map((t) => t.name);
  ok(`tools/list → ${toolNames.join(", ")}`);
  const menu = toolJson(await mcp("tools/call", { name: "get_menu", arguments: {} }));
  if (Array.isArray(menu) && menu.length) ok(`tools/call get_menu → ${menu.length} items`);
  else bad("tools/call get_menu didn't return the menu");
} catch (e) {
  bad(`MCP request failed: ${e.message}`);
}

const built = CHECKPOINT_2_TOOLS.filter((t) => toolNames.includes(t));
console.log(`\nCheckpoint 2 progress: ${built.length}/${CHECKPOINT_2_TOOLS.length} tools`);
for (const t of CHECKPOINT_2_TOOLS) (toolNames.includes(t) ? ok : info)(`${t}${toolNames.includes(t) ? "" : "  (not built yet)"}`);
const extra = toolNames.filter((t) => t !== "get_menu" && !CHECKPOINT_2_TOOLS.includes(t));
if (extra.length) info(`extra tools: ${extra.join(", ")}`);

// 3. Write tools (optional) ------------------------------------------------------
if (flags.has("--write") && built.includes("place_order")) {
  console.log("\nWrite tools (orders are labelled smoke)");
  try {
    const order = toolJson(
      await mcp("tools/call", { name: "place_order", arguments: { table: 12, items: [{ itemId: "builders-tea", qty: 1 }] } })
    );
    if (order?.id) ok(`place_order → order #${order.id}, ${order.totalText}`);
    else bad(`place_order returned ${JSON.stringify(order).slice(0, 120)}`);
    if (order?.id && built.includes("update_order_status")) {
      const served = toolJson(await mcp("tools/call", { name: "update_order_status", arguments: { orderId: order.id, status: "served" } }));
      served?.status === "served" ? ok(`update_order_status → #${served.id} served`) : bad("update_order_status didn't serve the order");
    }
    if (built.includes("list_orders")) {
      const orders = toolJson(await mcp("tools/call", { name: "list_orders", arguments: { status: "all" } }));
      Array.isArray(orders) ? ok(`list_orders → ${orders.length} orders`) : bad("list_orders didn't return a list");
    }
    if (built.includes("restock_item")) {
      const item = toolJson(await mcp("tools/call", { name: "restock_item", arguments: { itemId: "builders-tea", quantity: 1 } }));
      item?.id ? ok(`restock_item → ${item.name} now ${item.stock}`) : bad("restock_item didn't return the item");
    }
    const soldOut = await mcp("tools/call", { name: "place_order", arguments: { table: 12, items: [{ itemId: "caviar", qty: 1 }] } });
    soldOut?.isError ? ok(`bad input comes back as a tool error: "${soldOut.content?.[0]?.text?.slice(0, 70)}…"`) : bad("ordering caviar should fail");
  } catch (e) {
    bad(`write tools failed: ${e.message}`);
  }
}

// 4. Agent (optional) -------------------------------------------------------------
if (flags.has("--agent")) {
  console.log("\nAgent (/agents/caff-agent)");
  const session = `smoke-${Math.random().toString(36).slice(2, 8)}`;
  try {
    const { res, body } = await api(`/agents/caff-agent/${session}`, {
      method: "POST",
      headers: { "x-caff-client": "smoke" },
      body: JSON.stringify({ message: "How much is a bacon butty? One short sentence." })
    });
    if (res.ok && body?.reply) {
      ok(`reply in ${body.ms} ms using ${body.model}: "${body.reply.replace(/\s+/g, " ").slice(0, 120)}"`);
      info(`MCP tools the agent can see: ${body.mcp?.toolCount ?? 0}; tools it used: ${body.tools.map((t) => t.name).join(", ") || "none"}`);
      if (!body.mcp?.toolCount) info("the agent isn't connected to your MCP server yet (Checkpoint 3)");
      if (/wires crossed/i.test(body.reply)) info("the model sometimes garbles a reply and Sid covers for it: run this again before you start debugging");
    } else bad(`agent error: ${body?.error ?? `HTTP ${res.status}`}`);
    await api(`/agents/caff-agent/${session}`, { method: "DELETE" });
  } catch (e) {
    bad(`agent request failed: ${e.message}`);
  }
}

console.log(failures ? `\n\x1b[31m${failures} problem(s) found.\x1b[0m\n` : "\n\x1b[32mAll good.\x1b[0m\n");
process.exit(failures ? 1 : 0);
