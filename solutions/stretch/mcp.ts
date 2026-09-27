import { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import type { Caff } from "../../src/caff/client";

/**
 * Stretch reference: the finished MCP server plus
 *   request_refund + check_approval   human in the loop via the dashboard
 *   daily_report                      a tool that combines several API calls into one answer
 */
export function createCaffMcpServer(caff: Caff) {
  const server = new McpServer(
    { name: "workers-caff", version: "1.1.0" },
    {
      instructions:
        "Tools for running The Workers Caff, a London cafe: menu, orders, stock, refunds and reports. Prices are in pence (450 = £4.50). Tables are numbered 1 to 12."
    }
  );

  server.registerTool(
    "get_menu",
    {
      title: "Get the menu",
      description:
        "List everything on the menu: item id, name, price in pence, portions left and whether it is vegetarian.",
      inputSchema: z.object({}),
      annotations: { readOnlyHint: true }
    },
    async () => asText(await caff.getMenu())
  );

  server.registerTool(
    "place_order",
    {
      title: "Place an order",
      description:
        "Place a new order for a table. Use item ids from get_menu. Stock goes down straight away. Returns the order number and total.",
      inputSchema: z.object({
        table: z.number().int().min(1).max(12).describe("Table number, 1 to 12"),
        items: z
          .array(
            z.object({
              itemId: z.string().describe("Menu item id from get_menu, e.g. bacon-butty"),
              qty: z.number().int().min(1).max(20).default(1).describe("How many")
            })
          )
          .min(1)
          .describe("What the table wants"),
        note: z.string().max(140).optional().describe("Anything the kitchen should know, e.g. no mushrooms")
      })
    },
    async ({ table, items, note }) => asText(await caff.placeOrder({ table, items, note }))
  );

  server.registerTool(
    "list_orders",
    {
      title: "List orders",
      description:
        "List orders, newest first. 'active' (the default) means anything not yet served or cancelled. Optionally filter by table.",
      inputSchema: z.object({
        status: z
          .enum(["active", "new", "cooking", "ready", "served", "cancelled", "all"])
          .default("active")
          .describe("Which orders to show"),
        table: z.number().int().min(1).max(12).optional().describe("Only this table")
      }),
      annotations: { readOnlyHint: true }
    },
    async ({ status, table }) => asText(await caff.listOrders({ status, table }))
  );

  server.registerTool(
    "update_order_status",
    {
      title: "Update an order's status",
      description:
        "Move an order through the kitchen: new → cooking → ready → served. Orders only move forward. 'cancelled' cancels it and returns the stock.",
      inputSchema: z.object({
        orderId: z.number().int().describe("The order number, e.g. 101"),
        status: z.enum(["cooking", "ready", "served", "cancelled"]).describe("The new status")
      })
    },
    async ({ orderId, status }) => asText(await caff.updateOrderStatus(orderId, status))
  );

  server.registerTool(
    "restock_item",
    {
      title: "Restock an item",
      description: "Add portions back to a menu item's stock, for example after a delivery. Use item ids from get_menu.",
      inputSchema: z.object({
        itemId: z.string().describe("Menu item id from get_menu"),
        quantity: z.number().int().min(1).max(50).describe("How many portions to add")
      })
    },
    async ({ itemId, quantity }) => asText(await caff.restockItem(itemId, quantity))
  );

  // --- Stretch: human in the loop -------------------------------------------
  // The tool doesn't wait for the human. It files a request that shows up on
  // the dashboard with Approve / Reject buttons, and returns straight away.
  // The agent (or you) checks back later with check_approval.

  server.registerTool(
    "request_refund",
    {
      title: "Request a refund",
      description:
        "Ask the manager (a human, on the dashboard) to approve a refund for an order. Returns an approval id straight away; the decision comes later, so check it with check_approval.",
      inputSchema: z.object({
        orderId: z.number().int().describe("The order number to refund"),
        reason: z.string().min(3).max(200).describe("Why the customer should get a refund")
      })
    },
    async ({ orderId, reason }) => asText(await caff.requestRefund(orderId, reason))
  );

  server.registerTool(
    "check_approval",
    {
      title: "Check an approval",
      description: "See whether the manager has approved or rejected a request. Status is pending, approved or rejected.",
      inputSchema: z.object({ approvalId: z.number().int().describe("The approval id from request_refund") }),
      annotations: { readOnlyHint: true }
    },
    async ({ approvalId }) => asText(await caff.checkApproval(approvalId))
  );

  // --- Stretch: a tool that does the sums so the model doesn't have to -------

  server.registerTool(
    "daily_report",
    {
      title: "Daily report",
      description:
        "Summarise trading so far: orders, takings, best sellers and anything running low. Use this instead of adding up orders yourself.",
      inputSchema: z.object({}),
      annotations: { readOnlyHint: true }
    },
    async () => {
      const [orders, menu] = await Promise.all([caff.listOrders({ status: "all", limit: 100 }), caff.getMenu()]);
      const counted = orders.filter((o) => o.status !== "cancelled");
      const takings = counted.filter((o) => !o.refunded).reduce((sum, o) => sum + o.total, 0);
      const sold = new Map<string, number>();
      for (const order of counted) {
        for (const line of order.items) sold.set(line.name, (sold.get(line.name) ?? 0) + line.qty);
      }
      return asText({
        orders: counted.length,
        takingsPence: takings,
        takings: `£${(takings / 100).toFixed(2)}`,
        waiting: counted.filter((o) => o.status !== "served").length,
        bestSellers: [...sold].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([name, qty]) => ({ name, qty })),
        runningLow: menu.filter((m) => m.stock <= 4).map((m) => ({ id: m.id, name: m.name, stock: m.stock }))
      });
    }
  );

  return server;
}

function asText(data: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(data) }] };
}
