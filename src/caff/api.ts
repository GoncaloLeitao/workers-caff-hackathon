import { ORDER_STATUSES, type OrderStatus, type Source } from "./types";

/**
 * The caff's REST API. The dashboard uses it, and so can you (curl, scripts,
 * your own frontend).
 *
 *   GET    /api/menu                  the menu with stock levels
 *   POST   /api/menu/:itemId/restock  { quantity }
 *   GET    /api/orders?status=active  orders (active | new | cooking | ready | served | cancelled | all)
 *   POST   /api/orders                { table, items: [{ itemId, qty }], note? }
 *   GET    /api/orders/:id
 *   PATCH  /api/orders/:id            { status }
 *   POST   /api/approvals/:id         { decision: "approved" | "rejected" }
 *   GET    /api/state                 everything the dashboard needs in one call
 *   POST   /api/rush                  { count } simulate walk-in customers
 *   POST   /api/reset                 fresh stock, no orders (missions are kept)
 */
export async function handleApi(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const path = url.pathname.replace(/\/+$/, "");
  const method = request.method.toUpperCase();
  const store = env.CAFF.getByName("caff");
  // The dashboard labels its own requests so its buttons show up as "dashboard".
  const source: Source = request.headers.get("x-caff-client") === "dashboard" ? "dashboard" : "api";

  try {
    if (method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders() });

    if (path === "/api/state" && method === "GET") {
      if (source === "dashboard") await store.noteDashboardOpened();
      return json(await store.snapshot());
    }

    if (path === "/api/menu" && method === "GET") return json(await store.getMenu());

    let m = path.match(/^\/api\/menu\/([^/]+)\/restock$/);
    if (m && method === "POST") {
      const body = await readJson(request);
      return json(await store.restock(decodeURIComponent(m[1]), Number(body.quantity ?? 10), source));
    }

    if (path === "/api/orders" && method === "GET") {
      const status = (url.searchParams.get("status") ?? "active") as OrderStatus | "active" | "all";
      const table = url.searchParams.get("table");
      return json(await store.listOrders({ status, table: table ? Number(table) : undefined }));
    }

    if (path === "/api/orders" && method === "POST") {
      const body = await readJson(request);
      return json(await store.placeOrder(body as never, source), 201);
    }

    m = path.match(/^\/api\/orders\/(\d+)$/);
    if (m && method === "GET") return json(await store.getOrder(Number(m[1])));
    if (m && method === "PATCH") {
      const body = await readJson(request);
      const status = String(body.status ?? "") as OrderStatus;
      if (!ORDER_STATUSES.includes(status)) return error(`status must be one of ${ORDER_STATUSES.join(", ")}`, 400);
      return json(await store.updateOrderStatus(Number(m[1]), status, source));
    }

    m = path.match(/^\/api\/approvals\/(\d+)$/);
    if (m && method === "POST") {
      const body = await readJson(request);
      return json(await store.resolveApproval(Number(m[1]), body.decision as "approved" | "rejected", source));
    }

    if (path === "/api/rush" && method === "POST") {
      const body = await readJson(request);
      return json(await store.rush(Number(body.count ?? 4)), 201);
    }

    if (path === "/api/reset" && method === "POST") {
      const body = await readJson(request);
      if (body.everything === true) await store.resetEverything();
      else await store.reset();
      return json({ ok: true });
    }

    return error(`No API route for ${method} ${path}`, 404);
  } catch (e) {
    // Errors from the store carry friendly messages (sold out, unknown item...).
    return error(e instanceof Error ? e.message : String(e), 400);
  }
}

async function readJson(request: Request): Promise<Record<string, unknown>> {
  const text = await request.text();
  if (!text) return {};
  try {
    const value = JSON.parse(text);
    return value && typeof value === "object" ? value : {};
  } catch {
    throw new Error("Request body must be JSON.");
  }
}

function corsHeaders(): HeadersInit {
  return {
    "access-control-allow-origin": "*",
    "access-control-allow-methods": "GET, POST, PATCH, OPTIONS",
    "access-control-allow-headers": "content-type, x-caff-client"
  };
}

function json(data: unknown, status = 200): Response {
  return Response.json(data, { status, headers: { ...corsHeaders(), "cache-control": "no-store" } });
}

function error(message: string, status: number): Response {
  return json({ error: message }, status);
}
