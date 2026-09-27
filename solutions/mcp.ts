import { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import type { Caff } from "../src/caff/client";

/**
 * Checkpoint 2, finished: the caff's MCP server with all four tools.
 *
 * Every tool follows the same shape:
 *   name         what the model calls
 *   description  how the model decides when to use it (write it for a model, not a human)
 *   inputSchema  a zod schema; the SDK turns it into JSON Schema and validates input for you
 *   handler      does the work and returns content blocks
 */
export function createCaffMcpServer(caff: Caff) {
  const server = new McpServer(
    { name: "workers-caff", version: "1.0.0" },
    {
      instructions:
        "Tools for running The Workers Caff, a London cafe: menu, orders and stock. Prices are in pence (450 = £4.50). Tables are numbered 1 to 12."
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
    async () => {
      const menu = await caff.getMenu();
      return asText(menu);
    }
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
    async ({ table, items, note }) => {
      const order = await caff.placeOrder({ table, items, note });
      return asText(order);
    }
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
    async ({ status, table }) => {
      const orders = await caff.listOrders({ status, table });
      return asText(orders);
    }
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
    async ({ orderId, status }) => {
      const order = await caff.updateOrderStatus(orderId, status);
      return asText(order);
    }
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
    async ({ itemId, quantity }) => {
      const item = await caff.restockItem(itemId, quantity);
      return asText(item);
    }
  );

  return server;
}

/** MCP tools return content blocks. JSON as text is the simplest thing that works well with models. */
function asText(data: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(data) }] };
}
