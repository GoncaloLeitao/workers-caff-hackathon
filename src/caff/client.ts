import type { ListOrdersFilter, OrderStatus, PlaceOrderInput, Source } from "./types";

/**
 * A small typed client for the caff backend (the CaffStore Durable Object).
 *
 * Your MCP tools get one of these, already labelled with who is calling
 * (an MCP client, your agent or a visiting agent), so the dashboard can show
 * where each order came from.
 *
 * Every method returns plain JSON-friendly data. When something is wrong
 * (sold out, unknown item, bad table number) it throws an Error with a
 * message that is safe to show to people and models.
 */
export function caffFor(env: Env, source: Source) {
  const store = () => env.CAFF.getByName("caff");
  return {
    /** Everything on the menu, with prices in pence and portions left. */
    getMenu: () => store().getMenu(),

    /** Orders, newest first. Defaults to active orders (not served or cancelled). */
    listOrders: (filter: ListOrdersFilter = {}) => store().listOrders(filter),

    /** One order by its number, e.g. 101. */
    getOrder: (orderId: number) => store().getOrder(orderId),

    /** Place an order. Item ids come from getMenu(). Stock goes down straight away. */
    placeOrder: (input: PlaceOrderInput) => store().placeOrder(input, source),

    /** Move an order along: "cooking" → "ready" → "served", or "cancelled". */
    updateOrderStatus: (orderId: number, status: OrderStatus) => store().updateOrderStatus(orderId, status, source),

    /** Add portions back to an item after a delivery. */
    restockItem: (itemId: string, quantity: number) => store().restock(itemId, quantity, source),

    /** Stretch goal: ask a human manager (on the dashboard) to approve a refund. */
    requestRefund: (orderId: number, reason: string) => store().requestApproval({ orderId, reason }, source),

    /** Stretch goal: check whether the manager has approved or rejected a request. */
    checkApproval: (approvalId: number) => store().getApproval(approvalId)
  };
}

export type Caff = ReturnType<typeof caffFor>;
