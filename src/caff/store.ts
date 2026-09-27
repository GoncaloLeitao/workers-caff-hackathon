import { DurableObject } from "cloudflare:workers";
import { LOW_STOCK, STARTING_MENU, TABLES } from "./menu";
import { KNOWN_TOOLS, MISSIONS, type MissionId } from "./missions";
import {
  CaffError,
  formatPence,
  ORDER_STATUSES,
  type Approval,
  type CaffEvent,
  type ListOrdersFilter,
  type MenuItem,
  type Mission,
  type Order,
  type OrderLine,
  type OrderStatus,
  type PlaceOrderInput,
  type Snapshot,
  type Source
} from "./types";

type Row = Record<string, SqlStorageValue>;

const STATUS_RANK: Record<OrderStatus, number> = { new: 0, cooking: 1, ready: 2, served: 3, cancelled: 3 };
const MAX_STOCK = 99;
const MAX_EVENTS = 300;

/**
 * The caff's backend: one Durable Object with its own SQLite database.
 *
 * Everything else talks to it over RPC: the REST API, your MCP tools (via
 * src/caff/client.ts) and the dashboard. There is one instance per
 * deployment, named "caff".
 */
export class CaffStore extends DurableObject<Env> {
  private sql: SqlStorage;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.sql = ctx.storage.sql;
    this.migrate();
  }

  // ---------------------------------------------------------------------------
  // Menu and stock
  // ---------------------------------------------------------------------------

  getMenu(): MenuItem[] {
    return this.sql
      .exec("SELECT * FROM menu ORDER BY position")
      .toArray()
      .map(rowToMenuItem);
  }

  restock(itemRef: string, quantity: number, source: Source): MenuItem {
    if (!Number.isInteger(quantity) || quantity < 1 || quantity > 50) {
      throw new CaffError("Restock quantity must be a whole number between 1 and 50.");
    }
    const item = this.findItem(itemRef);
    const stock = Math.min(MAX_STOCK, item.stock + quantity);
    this.sql.exec("UPDATE menu SET stock = ? WHERE id = ?", stock, item.id);
    this.log("stock.restocked", source, `Restocked ${item.name}: ${item.stock} → ${stock}`);
    if (source === "mcp" || source === "agent") this.complete("mcp_restock");
    return { ...item, stock };
  }

  // ---------------------------------------------------------------------------
  // Orders
  // ---------------------------------------------------------------------------

  listOrders(filter: ListOrdersFilter = {}): Order[] {
    const status = filter.status ?? "active";
    const clauses: string[] = [];
    const params: SqlStorageValue[] = [];
    if (status === "active") clauses.push("status NOT IN ('served', 'cancelled')");
    else if (status !== "all") {
      if (!ORDER_STATUSES.includes(status)) throw new CaffError(`Unknown status "${status}".`);
      clauses.push("status = ?");
      params.push(status);
    }
    if (filter.table !== undefined) {
      clauses.push("table_no = ?");
      params.push(filter.table);
    }
    const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
    const limit = Math.min(Math.max(filter.limit ?? 25, 1), 100);
    return this.sql
      .exec(`SELECT * FROM orders ${where} ORDER BY id DESC LIMIT ${limit}`, ...params)
      .toArray()
      .map(rowToOrder);
  }

  getOrder(id: number): Order {
    const row = this.sql.exec("SELECT * FROM orders WHERE id = ?", id).toArray()[0];
    if (!row) throw new CaffError(`There is no order #${id}. Use list_orders to see current orders.`);
    return rowToOrder(row);
  }

  placeOrder(input: PlaceOrderInput, source: Source): Order {
    const table = Number(input?.table);
    if (!Number.isInteger(table) || table < TABLES.min || table > TABLES.max) {
      throw new CaffError(`Table must be a number from ${TABLES.min} to ${TABLES.max}.`);
    }
    if (!Array.isArray(input.items) || input.items.length === 0) {
      throw new CaffError("An order needs at least one item.");
    }

    // Merge duplicate lines and check everything before touching stock.
    const wanted = new Map<string, { item: MenuItem; qty: number }>();
    for (const line of input.items) {
      const qty = line.qty ?? 1;
      if (!Number.isInteger(qty) || qty < 1 || qty > 20) {
        throw new CaffError("Each item quantity must be a whole number between 1 and 20.");
      }
      const item = this.findItem(String(line.itemId ?? ""));
      const existing = wanted.get(item.id);
      wanted.set(item.id, { item, qty: (existing?.qty ?? 0) + qty });
    }
    for (const { item, qty } of wanted.values()) {
      if (item.stock < qty) {
        throw new CaffError(
          item.stock === 0
            ? `Sorry, ${item.name} is sold out. Restock it first or pick something else.`
            : `Only ${item.stock} ${item.name} left, but the order asks for ${qty}.`
        );
      }
    }

    const lines: OrderLine[] = [];
    for (const { item, qty } of wanted.values()) {
      this.sql.exec("UPDATE menu SET stock = stock - ? WHERE id = ?", qty, item.id);
      lines.push({ itemId: item.id, name: item.name, qty, price: item.price });
    }
    const total = lines.reduce((sum, l) => sum + l.qty * l.price, 0);
    const note = input.note ? String(input.note).slice(0, 140) : null;
    const now = new Date().toISOString();
    const id = Number(this.sql.exec("SELECT COALESCE(MAX(id), 100) + 1 AS id FROM orders").one().id);
    this.sql.exec(
      `INSERT INTO orders (id, table_no, items, total, status, source, note, refunded, created_at, updated_at, updated_by)
       VALUES (?, ?, ?, ?, 'new', ?, ?, 0, ?, ?, ?)`,
      id,
      table,
      JSON.stringify(lines),
      total,
      source,
      note,
      now,
      now,
      source
    );

    const summary = lines.map((l) => `${l.qty}× ${l.name}`).join(", ");
    this.log("order.placed", source, `Order #${id}: table ${table} ordered ${summary} (${formatPence(total)})`);
    if (source === "mcp" || source === "agent") this.complete("mcp_order");
    if (source === "agent") this.complete("agent_order");
    return this.getOrder(id);
  }

  updateOrderStatus(id: number, status: OrderStatus, source: Source): Order {
    if (!ORDER_STATUSES.includes(status) || status === "new") {
      throw new CaffError('Status must be one of "cooking", "ready", "served" or "cancelled".');
    }
    const order = this.getOrder(id);
    if (order.status === status) return order;
    if (order.status === "served" || order.status === "cancelled") {
      throw new CaffError(`Order #${id} is already ${order.status}, so it can't change any more.`);
    }
    if (status !== "cancelled" && STATUS_RANK[status] < STATUS_RANK[order.status]) {
      throw new CaffError(`Order #${id} is already ${order.status}. Orders only move forward: new → cooking → ready → served.`);
    }
    if (status === "cancelled") {
      for (const line of order.items) {
        this.sql.exec("UPDATE menu SET stock = MIN(?, stock + ?) WHERE id = ?", MAX_STOCK, line.qty, line.itemId);
      }
    }
    this.sql.exec(
      "UPDATE orders SET status = ?, updated_at = ?, updated_by = ? WHERE id = ?",
      status,
      new Date().toISOString(),
      source,
      id
    );

    const verb = { cooking: "is cooking", ready: "is ready", served: "was served", cancelled: "was cancelled" }[status];
    this.log("order.status", source, `Order #${id} (table ${order.table}) ${verb}`);
    if (source === "mcp" || source === "agent") this.complete("mcp_status");
    if (source === "agent" && status === "served" && order.source === "agent") this.complete("agent_serves");
    return this.getOrder(id);
  }

  // ---------------------------------------------------------------------------
  // Approvals (human in the loop)
  // ---------------------------------------------------------------------------

  requestApproval(input: { orderId: number; reason: string }, source: Source): Approval {
    const order = this.getOrder(Number(input.orderId));
    if (order.refunded) throw new CaffError(`Order #${order.id} has already been refunded.`);
    const pending = this.sql
      .exec("SELECT * FROM approvals WHERE order_id = ? AND status = 'pending'", order.id)
      .toArray()[0];
    if (pending) return rowToApproval(pending);
    const reason = String(input.reason ?? "").slice(0, 200) || "No reason given";
    const now = new Date().toISOString();
    this.sql.exec(
      `INSERT INTO approvals (kind, order_id, reason, amount, status, requested_by, created_at)
       VALUES ('refund', ?, ?, ?, 'pending', ?, ?)`,
      order.id,
      reason,
      order.total,
      source,
      now
    );
    const id = Number(this.sql.exec("SELECT MAX(id) AS id FROM approvals").one().id);
    this.log("approval.requested", source, `Refund of ${order.totalText} for order #${order.id} needs a manager: "${reason}"`);
    return this.getApproval(id);
  }

  getApproval(id: number): Approval {
    const row = this.sql.exec("SELECT * FROM approvals WHERE id = ?", id).toArray()[0];
    if (!row) throw new CaffError(`There is no approval request #${id}.`);
    return rowToApproval(row);
  }

  resolveApproval(id: number, decision: "approved" | "rejected", source: Source): Approval {
    if (decision !== "approved" && decision !== "rejected") {
      throw new CaffError('Decision must be "approved" or "rejected".');
    }
    const approval = this.getApproval(id);
    if (approval.status !== "pending") return approval;
    this.sql.exec(
      "UPDATE approvals SET status = ?, resolved_at = ?, resolved_by = ? WHERE id = ?",
      decision,
      new Date().toISOString(),
      source,
      id
    );
    if (decision === "approved" && approval.orderId !== null) {
      this.sql.exec("UPDATE orders SET refunded = 1 WHERE id = ?", approval.orderId);
    }
    this.log("approval.resolved", source, `Manager ${decision} the refund for order #${approval.orderId}`);
    this.complete("approval");
    return this.getApproval(id);
  }

  // ---------------------------------------------------------------------------
  // Activity tracking (feeds the mission board)
  // ---------------------------------------------------------------------------

  /** Called by the Worker for every MCP request so the mission board can react. */
  trackMcp(input: { method: string; tool?: string; source: Source; fromOrigin?: string | null }) {
    const { method, tool, source } = input;
    if (source === "smoke") return;
    const who = { mcp: "An MCP client", agent: "Your agent", visitor: "A visiting agent" }[source as string] ?? source;
    if (method === "tools/list") {
      this.log("mcp.tools_list", source, `${who} listed your MCP tools`);
      if (source === "mcp") this.complete("mcp_connected");
    } else if (method === "tools/call") {
      this.log("mcp.tool_call", source, `${who} called ${tool ?? "a tool"}`);
      if (source === "mcp") {
        this.complete("mcp_connected");
        this.complete("first_tool_call");
      }
      if (tool && !KNOWN_TOOLS.has(tool)) this.complete("custom_tool");
    }
    if (source === "visitor") {
      this.log("table.visited", source, `A visiting agent from ${input.fromOrigin ?? "another table"} is using your MCP server`);
      this.complete("table_hop");
    }
  }

  /** Called by your agent after each reply (see src/caff/agent-kit.ts). */
  noteAgentReply(input: { toolCount: number; toolsUsed: string[] }) {
    const used = input.toolsUsed.length ? ` using ${input.toolsUsed.join(", ")}` : "";
    this.log("agent.reply", "agent", `Your agent replied${used}`);
    if (input.toolCount > 0) this.complete("agent_online");
  }

  noteScheduledTask(description: string) {
    this.log("agent.scheduled", "agent", `Scheduled task ran: ${description.slice(0, 120)}`);
    this.complete("scheduled");
  }

  noteTableHop(otherOrigin: string) {
    this.log("table.hop", "agent", `Your agent connected to another table's MCP server at ${otherOrigin}`);
    this.complete("table_hop");
  }

  noteDashboardOpened() {
    this.complete("doors_open");
  }

  // ---------------------------------------------------------------------------
  // Dashboard helpers
  // ---------------------------------------------------------------------------

  /** Simulate a rush of walk-in customers. */
  rush(count = 4): Order[] {
    const n = Math.min(Math.max(Math.floor(count), 1), 8);
    const placed: Order[] = [];
    for (let i = 0; i < n; i++) {
      const available = this.getMenu().filter((m) => m.stock > 0);
      if (!available.length) break;
      const lines = new Map<string, number>();
      const lineCount = 1 + Math.floor(Math.random() * 3);
      for (let j = 0; j < lineCount; j++) {
        const item = available[Math.floor(Math.random() * available.length)];
        const qty = Math.min(item.stock - (lines.get(item.id) ?? 0), 1 + Math.floor(Math.random() * 2));
        if (qty > 0) lines.set(item.id, (lines.get(item.id) ?? 0) + qty);
      }
      if (!lines.size) continue;
      const table = TABLES.min + Math.floor(Math.random() * (TABLES.max - TABLES.min + 1));
      try {
        placed.push(this.placeOrder({ table, items: [...lines].map(([itemId, qty]) => ({ itemId, qty })) }, "walk-in"));
      } catch {
        // Ran out of something mid-rush. Fine.
      }
    }
    return placed;
  }

  snapshot(): Snapshot {
    const menu = this.getMenu();
    const active = this.listOrders({ status: "active", limit: 100 });
    const done = this.sql
      .exec("SELECT * FROM orders WHERE status IN ('served', 'cancelled') ORDER BY updated_at DESC LIMIT 12")
      .toArray()
      .map(rowToOrder);
    const approvals = this.sql
      .exec("SELECT * FROM approvals ORDER BY status = 'pending' DESC, id DESC LIMIT 8")
      .toArray()
      .map(rowToApproval);
    const events = this.sql
      .exec("SELECT * FROM events ORDER BY id DESC LIMIT 40")
      .toArray()
      .map(rowToEvent);
    const doneMissions = new Map(
      this.sql.exec("SELECT id, done_at FROM missions").toArray().map((r) => [String(r.id), String(r.done_at)])
    );
    const missions: Mission[] = MISSIONS.map((m) => ({
      id: m.id,
      title: m.title,
      hint: m.hint,
      checkpoint: m.checkpoint,
      bonus: Boolean(m.bonus),
      done: doneMissions.has(m.id),
      doneAt: doneMissions.get(m.id) ?? null
    }));

    const totals = this.sql
      .exec(
        `SELECT COUNT(*) AS n, COALESCE(SUM(CASE WHEN refunded = 1 THEN 0 ELSE total END), 0) AS revenue
         FROM orders WHERE status != 'cancelled'`
      )
      .one();
    const bySource: Partial<Record<Source, number>> = {};
    for (const r of this.sql.exec("SELECT source, COUNT(*) AS n FROM orders GROUP BY source").toArray()) {
      bySource[String(r.source) as Source] = Number(r.n);
    }

    return {
      caff: { name: "The Workers Caff", openedAt: this.meta("opened_at") ?? new Date().toISOString(), now: new Date().toISOString() },
      menu,
      orders: [...active, ...done],
      approvals,
      missions,
      events,
      stats: {
        ordersToday: Number(totals.n),
        revenue: Number(totals.revenue),
        revenueText: formatPence(Number(totals.revenue)),
        bySource,
        lowStock: menu.filter((m) => m.stock <= LOW_STOCK).map((m) => m.name)
      }
    };
  }

  /** Put the menu, stock and orders back to how they started. Missions are kept. */
  reset() {
    this.sql.exec("DELETE FROM orders");
    this.sql.exec("DELETE FROM approvals");
    this.sql.exec("DELETE FROM events");
    this.sql.exec("DELETE FROM menu");
    this.seedMenu();
    this.log("caff.reset", "dashboard", "The caff was reset: fresh stock, no orders");
  }

  /** Also wipes the mission board. Used by the smoke test's --reset flag. */
  resetEverything() {
    this.reset();
    this.sql.exec("DELETE FROM missions");
  }

  // ---------------------------------------------------------------------------
  // Internals
  // ---------------------------------------------------------------------------

  /** Find a menu item by id or by (part of) its name, so models can be a bit sloppy. */
  private findItem(ref: string): MenuItem {
    const menu = this.getMenu();
    const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
    const key = norm(ref);
    if (!key) throw new CaffError("Missing item id. Use get_menu to see item ids.");
    const exact = menu.find((m) => norm(m.id) === key || norm(m.name) === key);
    if (exact) return exact;
    const partial = menu.filter((m) => norm(m.id).includes(key) || norm(m.name).includes(key));
    if (partial.length === 1) return partial[0];
    if (partial.length > 1) {
      throw new CaffError(`"${ref}" could mean ${partial.map((m) => m.id).join(" or ")}. Use an exact item id.`);
    }
    throw new CaffError(`"${ref}" isn't on the menu. Valid item ids: ${menu.map((m) => m.id).join(", ")}.`);
  }

  private complete(id: MissionId) {
    const exists = this.sql.exec("SELECT 1 FROM missions WHERE id = ?", id).toArray().length > 0;
    if (exists) return;
    this.sql.exec("INSERT INTO missions (id, done_at) VALUES (?, ?)", id, new Date().toISOString());
    const def = MISSIONS.find((m) => m.id === id);
    this.log("mission.complete", "dashboard", `Mission complete: ${def?.title ?? id}`);
  }

  private log(type: string, source: Source, message: string) {
    this.sql.exec(
      "INSERT INTO events (at, type, source, message) VALUES (?, ?, ?, ?)",
      new Date().toISOString(),
      type,
      source,
      message
    );
    this.sql.exec("DELETE FROM events WHERE id <= (SELECT MAX(id) FROM events) - ?", MAX_EVENTS);
  }

  private meta(key: string): string | null {
    const row = this.sql.exec("SELECT value FROM meta WHERE key = ?", key).toArray()[0];
    return row ? String(row.value) : null;
  }

  private migrate() {
    this.sql.exec(`
      CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT);
      CREATE TABLE IF NOT EXISTS menu (
        id TEXT PRIMARY KEY, name TEXT NOT NULL, category TEXT NOT NULL, price INTEGER NOT NULL,
        stock INTEGER NOT NULL, description TEXT NOT NULL, vegetarian INTEGER NOT NULL, position INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS orders (
        id INTEGER PRIMARY KEY, table_no INTEGER NOT NULL, items TEXT NOT NULL, total INTEGER NOT NULL,
        status TEXT NOT NULL, source TEXT NOT NULL, note TEXT, refunded INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL, updated_at TEXT NOT NULL, updated_by TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS events (
        id INTEGER PRIMARY KEY AUTOINCREMENT, at TEXT NOT NULL, type TEXT NOT NULL,
        source TEXT NOT NULL, message TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS missions (id TEXT PRIMARY KEY, done_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS approvals (
        id INTEGER PRIMARY KEY AUTOINCREMENT, kind TEXT NOT NULL, order_id INTEGER, reason TEXT NOT NULL,
        amount INTEGER NOT NULL, status TEXT NOT NULL, requested_by TEXT NOT NULL, created_at TEXT NOT NULL,
        resolved_at TEXT, resolved_by TEXT
      );
    `);
    if (!this.meta("opened_at")) {
      this.sql.exec("INSERT INTO meta (key, value) VALUES ('opened_at', ?)", new Date().toISOString());
    }
    if (Number(this.sql.exec("SELECT COUNT(*) AS n FROM menu").one().n) === 0) {
      this.seedMenu();
    }
  }

  private seedMenu() {
    STARTING_MENU.forEach((m, position) => {
      this.sql.exec(
        "INSERT INTO menu (id, name, category, price, stock, description, vegetarian, position) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
        m.id,
        m.name,
        m.category,
        m.price,
        m.stock,
        m.description,
        m.vegetarian ? 1 : 0,
        position
      );
    });
  }
}

function rowToMenuItem(r: Row): MenuItem {
  return {
    id: String(r.id),
    name: String(r.name),
    category: String(r.category) as MenuItem["category"],
    price: Number(r.price),
    stock: Number(r.stock),
    description: String(r.description),
    vegetarian: Boolean(r.vegetarian)
  };
}

function rowToOrder(r: Row): Order {
  const total = Number(r.total);
  return {
    id: Number(r.id),
    table: Number(r.table_no),
    items: JSON.parse(String(r.items)) as OrderLine[],
    total,
    totalText: formatPence(total),
    status: String(r.status) as OrderStatus,
    source: String(r.source) as Source,
    note: r.note === null ? null : String(r.note),
    refunded: Boolean(r.refunded),
    createdAt: String(r.created_at),
    updatedAt: String(r.updated_at),
    updatedBy: String(r.updated_by) as Source
  };
}

function rowToApproval(r: Row): Approval {
  return {
    id: Number(r.id),
    kind: "refund",
    orderId: r.order_id === null ? null : Number(r.order_id),
    reason: String(r.reason),
    amount: Number(r.amount),
    status: String(r.status) as Approval["status"],
    requestedBy: String(r.requested_by) as Source,
    createdAt: String(r.created_at),
    resolvedAt: r.resolved_at === null ? null : String(r.resolved_at)
  };
}

function rowToEvent(r: Row): CaffEvent {
  return {
    id: Number(r.id),
    at: String(r.at),
    type: String(r.type),
    source: String(r.source) as Source,
    message: String(r.message)
  };
}
