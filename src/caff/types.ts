/**
 * Shared types for The Workers Caff.
 * You shouldn't need to edit this file for the guided path.
 */

/** Who did something. Shown as a badge on the dashboard. */
export type Source =
  | "dashboard" // someone clicked a button on the dashboard
  | "api" // a direct REST API call (curl, scripts)
  | "mcp" // an MCP client such as AI Playground or MCP Inspector
  | "agent" // your agent, calling your MCP server
  | "visitor" // another table's agent, calling your MCP server
  | "walk-in" // simulated customers from the "Rush hour" button
  | "smoke"; // the smoke test script

export type OrderStatus = "new" | "cooking" | "ready" | "served" | "cancelled";

export const ORDER_STATUSES: readonly OrderStatus[] = ["new", "cooking", "ready", "served", "cancelled"];

export type MenuCategory = "breakfast" | "sandwiches" | "mains" | "sweets" | "drinks";

export interface MenuItem {
  id: string;
  name: string;
  category: MenuCategory;
  /** Price in pence. 450 = £4.50 */
  price: number;
  /** Portions left. 0 means sold out. */
  stock: number;
  description: string;
  vegetarian: boolean;
}

export interface OrderLine {
  itemId: string;
  name: string;
  qty: number;
  /** Unit price in pence */
  price: number;
}

export interface Order {
  id: number;
  table: number;
  items: OrderLine[];
  /** Total in pence */
  total: number;
  /** Total formatted for humans, e.g. "£8.10" */
  totalText: string;
  status: OrderStatus;
  source: Source;
  note: string | null;
  refunded: boolean;
  createdAt: string;
  updatedAt: string;
  /** Who moved the order to its current status */
  updatedBy: Source;
}

export interface PlaceOrderInput {
  table: number;
  items: { itemId: string; qty?: number }[];
  note?: string | null;
}

export interface ListOrdersFilter {
  /** "active" = anything not served or cancelled. Defaults to "active". */
  status?: OrderStatus | "active" | "all";
  table?: number;
  limit?: number;
}

export interface CaffEvent {
  id: number;
  at: string;
  type: string;
  source: Source;
  message: string;
}

export interface Approval {
  id: number;
  kind: "refund";
  orderId: number | null;
  reason: string;
  /** Amount in pence */
  amount: number;
  status: "pending" | "approved" | "rejected";
  requestedBy: Source;
  createdAt: string;
  resolvedAt: string | null;
}

export interface Mission {
  id: string;
  title: string;
  hint: string;
  checkpoint: number;
  bonus: boolean;
  done: boolean;
  doneAt: string | null;
}

export interface Snapshot {
  caff: { name: string; openedAt: string; now: string };
  menu: MenuItem[];
  orders: Order[];
  approvals: Approval[];
  missions: Mission[];
  events: CaffEvent[];
  stats: {
    ordersToday: number;
    revenue: number;
    revenueText: string;
    bySource: Partial<Record<Source, number>>;
    lowStock: string[];
  };
}

/** Thrown for anything the caller did wrong. The message is safe to show to users and models. */
export class CaffError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CaffError";
  }
}

export function formatPence(pence: number): string {
  const sign = pence < 0 ? "-" : "";
  const abs = Math.abs(pence);
  return `${sign}£${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, "0")}`;
}
