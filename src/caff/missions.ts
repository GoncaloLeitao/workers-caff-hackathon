/**
 * The mission board. Missions tick themselves off when the caff sees the
 * matching activity, so staff can see your progress at a glance.
 */

export interface MissionDef {
  id: MissionId;
  title: string;
  hint: string;
  checkpoint: number;
  bonus?: boolean;
}

export type MissionId =
  | "doors_open"
  | "mcp_connected"
  | "first_tool_call"
  | "mcp_order"
  | "mcp_status"
  | "mcp_restock"
  | "agent_online"
  | "agent_order"
  | "agent_serves"
  | "custom_tool"
  | "approval"
  | "scheduled"
  | "table_hop";

export const MISSIONS: MissionDef[] = [
  {
    id: "doors_open",
    title: "Doors open",
    hint: "Deploy the caff and open this dashboard",
    checkpoint: 1
  },
  {
    id: "mcp_connected",
    title: "Hello, MCP",
    hint: "Connect Cloudflare OS, AI Playground or MCP Inspector to your /mcp endpoint",
    checkpoint: 1
  },
  {
    id: "first_tool_call",
    title: "First tool call",
    hint: "Ask the MCP client something that makes it call get_menu",
    checkpoint: 1
  },
  {
    id: "mcp_order",
    title: "Order up",
    hint: "Build place_order and take an order over MCP",
    checkpoint: 2
  },
  {
    id: "mcp_status",
    title: "Service!",
    hint: "Build update_order_status and move an order along over MCP",
    checkpoint: 2
  },
  {
    id: "mcp_restock",
    title: "Stock take",
    hint: "Build restock_item and top up an item over MCP",
    checkpoint: 2
  },
  {
    id: "agent_online",
    title: "Agent on shift",
    hint: "Connect your agent to your MCP server and chat to it",
    checkpoint: 3
  },
  {
    id: "agent_order",
    title: "The agent takes an order",
    hint: "Ask your agent to place an order",
    checkpoint: 3
  },
  {
    id: "agent_serves",
    title: "Full service",
    hint: "Your agent takes an order and later marks it served",
    checkpoint: 3
  },
  {
    id: "custom_tool",
    title: "Off menu",
    hint: "Invent a new MCP tool and get a client to call it",
    checkpoint: 4,
    bonus: true
  },
  {
    id: "approval",
    title: "Manager's say-so",
    hint: "Your agent asks for a refund and a human approves or rejects it here",
    checkpoint: 4,
    bonus: true
  },
  {
    id: "scheduled",
    title: "Clockwork",
    hint: "Your agent runs a scheduled task (for example, a stock check)",
    checkpoint: 4,
    bonus: true
  },
  {
    id: "table_hop",
    title: "Table hopping",
    hint: "Your agent uses another table's MCP server, or theirs uses yours",
    checkpoint: 4,
    bonus: true
  }
];

/** Tools from the guided path and the stretch reference. Anything else counts as "Off menu". */
export const KNOWN_TOOLS = new Set([
  "get_menu",
  "place_order",
  "list_orders",
  "update_order_status",
  "restock_item",
  "request_refund",
  "check_approval",
  "daily_report"
]);
