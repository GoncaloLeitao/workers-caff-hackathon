import { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import type { Caff } from "./caff/client";

/**
 * CHECKPOINT 2: your MCP server
 * =============================
 *
 * MCP (Model Context Protocol) is how AI apps find and call tools. Anything
 * that speaks MCP (AI Playground, MCP Inspector, Claude, Cursor, your own
 * agent) can connect to https://<your-worker>/mcp, ask "what tools do you
 * have?" and call them.
 *
 * Each tool has:
 *   a name         what the model calls
 *   a description  how the model decides when to use it (write it for a model)
 *   an inputSchema a zod schema; the SDK validates input for you
 *   a handler      does the work and returns content
 *
 * `caff` talks to the caff's backend. src/caff/client.ts lists everything it can do.
 *
 * YOUR JOBS (uncomment each block, then fill in the handler):
 *   TODO 1  place_order          ->  caff.placeOrder({ table, items, note })
 *   TODO 2  list_orders          ->  caff.listOrders({ status, table })
 *   TODO 3  update_order_status  ->  caff.updateOrderStatus(orderId, status)
 *   TODO 4  restock_item         ->  caff.restockItem(itemId, quantity)
 *
 * After each one: save, test it in MCP Inspector or AI Playground, and watch
 * the dashboard. Stuck? Run `npm run skip:mcp` to drop in a finished version
 * (your file is backed up to src/mcp.ts.bak first).
 */
export function createCaffMcpServer(caff: Caff) {
  const server = new McpServer(
    { name: "workers-caff", version: "1.0.0" },
    {
      instructions:
        "Tools for running The Workers Caff, a London cafe: menu, orders and stock. Prices are in pence (450 = £4.50). Tables are numbered 1 to 12."
    }
  );

  // DONE FOR YOU: a read-only tool with no inputs. Use it as your template.
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

  // TODO 1: place_order
  // The schema is written for you. Fill in the handler: call caff.placeOrder
  // and return the order it gives back, wrapped in asText(...).
  //
  // server.registerTool(
  //   "place_order",
  //   {
  //     title: "Place an order",
  //     description:
  //       "Place a new order for a table. Use item ids from get_menu. Stock goes down straight away. Returns the order number and total.",
  //     inputSchema: z.object({
  //       table: z.number().int().min(1).max(12).describe("Table number, 1 to 12"),
  //       items: z
  //         .array(
  //           z.object({
  //             itemId: z.string().describe("Menu item id from get_menu, e.g. bacon-butty"),
  //             qty: z.number().int().min(1).max(20).default(1).describe("How many")
  //           })
  //         )
  //         .min(1)
  //         .describe("What the table wants"),
  //       note: z.string().max(140).optional().describe("Anything the kitchen should know, e.g. no mushrooms")
  //     })
  //   },
  //   async ({ table, items, note }) => {
  //     // your code here
  //   }
  // );

  // TODO 2: list_orders
  // Read-only, like get_menu. Both inputs are optional.
  //
  // server.registerTool(
  //   "list_orders",
  //   {
  //     title: "List orders",
  //     description:
  //       "List orders, newest first. 'active' (the default) means anything not yet served or cancelled. Optionally filter by table.",
  //     inputSchema: z.object({
  //       status: z
  //         .enum(["active", "new", "cooking", "ready", "served", "cancelled", "all"])
  //         .default("active")
  //         .describe("Which orders to show"),
  //       table: z.number().int().min(1).max(12).optional().describe("Only this table")
  //     }),
  //     annotations: { readOnlyHint: true }
  //   },
  //   async ({ status, table }) => {
  //     // your code here
  //   }
  // );

  // TODO 3: update_order_status
  // Orders move new → cooking → ready → served (or cancelled).
  //
  // server.registerTool(
  //   "update_order_status",
  //   {
  //     title: "Update an order's status",
  //     description:
  //       "Move an order through the kitchen: new → cooking → ready → served. Orders only move forward. 'cancelled' cancels it and returns the stock.",
  //     inputSchema: z.object({
  //       orderId: z.number().int().describe("The order number, e.g. 101"),
  //       status: z.enum(["cooking", "ready", "served", "cancelled"]).describe("The new status")
  //     })
  //   },
  //   async ({ orderId, status }) => {
  //     // your code here
  //   }
  // );

  // TODO 4: restock_item
  // This one's all yours: write the description and the inputSchema too.
  // Inputs: itemId (a string) and quantity (a whole number, 1 to 50).
  // Then call caff.restockItem(itemId, quantity).

  return server;
}

/** MCP tools return content blocks. JSON as text is the simplest thing that works well with models. */
function asText(data: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(data) }] };
}
