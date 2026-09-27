// The Workers Caff dashboard. Plain JavaScript, no build step.
// It polls GET /api/state every couple of seconds and redraws what changed.

const POLL_MS = 2000;
const $ = (sel) => document.querySelector(sel);

const state = {
  data: null,
  seenOrders: new Set(),
  seenEvents: new Set(),
  doneMissions: new Set(),
  maxStock: {},
  firstLoad: true,
  lastRender: {}
};

const LANES = [
  { status: "new", label: "New", next: "cooking", action: "Start cooking" },
  { status: "cooking", label: "Cooking", next: "ready", action: "Ready" },
  { status: "ready", label: "Ready", next: "served", action: "Serve" },
  { status: "served", label: "Done" }
];

// ---------------------------------------------------------------------------
// Data
// ---------------------------------------------------------------------------

async function api(path, init = {}) {
  const res = await fetch(path, {
    ...init,
    headers: { "content-type": "application/json", "x-caff-client": "dashboard", ...(init.headers ?? {}) }
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
  return body;
}

async function load() {
  try {
    const data = await api("/api/state");
    setOnline(true);
    render(data);
  } catch (e) {
    setOnline(false, e.message);
  }
}

let timer;
function schedule() {
  clearTimeout(timer);
  if (!document.hidden) timer = setTimeout(async () => {
    await load();
    schedule();
  }, POLL_MS);
}

document.addEventListener("visibilitychange", () => {
  if (!document.hidden) load().then(schedule);
});

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

function render(data) {
  state.data = data;
  renderIfChanged("approvals", data.approvals, renderApprovals);
  renderIfChanged("orders", data.orders, renderBoard);
  renderIfChanged("missions", data.missions, renderMissions);
  renderIfChanged("menu", data.menu, renderStock);
  renderIfChanged("events", data.events, renderFeed);
  renderIfChanged("stats", data.stats, renderStats);
  // Ticket ages change every render, so refresh them in place.
  document.querySelectorAll("[data-age]").forEach((el) => (el.textContent = ago(el.dataset.age)));
  state.firstLoad = false;
}

function renderIfChanged(key, value, fn) {
  const json = JSON.stringify(value);
  if (state.lastRender[key] === json) return;
  state.lastRender[key] = json;
  fn(value);
}

function renderApprovals(approvals) {
  const pending = approvals.filter((a) => a.status === "pending");
  $("#approvals").innerHTML = pending
    .map(
      (a) => `
      <div class="approval">
        <div>
          <div class="who">Manager needed · requested by <span class="badge src-${a.requestedBy}">${esc(a.requestedBy)}</span></div>
          <div class="what">Refund ${money(a.amount)} on order #${a.orderId}: “${esc(a.reason)}”</div>
        </div>
        <div class="actions">
          <button class="btn approve" data-approval="${a.id}" data-decision="approved">Approve</button>
          <button class="btn reject" data-approval="${a.id}" data-decision="rejected">Reject</button>
        </div>
      </div>`
    )
    .join("");
}

function renderBoard(orders) {
  const active = orders.filter((o) => o.status !== "served" && o.status !== "cancelled").length;
  $("#orders-meta").textContent = `${active} on the go`;
  $("#board").innerHTML = LANES.map((lane) => {
    const list = orders
      .filter((o) => (lane.status === "served" ? o.status === "served" || o.status === "cancelled" : o.status === lane.status))
      .sort((a, b) => (lane.status === "served" ? b.updatedAt.localeCompare(a.updatedAt) : a.id - b.id));
    return `
      <div class="lane" data-status="${lane.status}">
        <div class="lane-head"><span>${lane.label}</span><span class="count">${list.length}</span></div>
        ${list.length ? list.map((o) => ticket(o, lane)).join("") : `<div class="empty">${emptyLane(lane.status)}</div>`}
      </div>`;
  }).join("");
  for (const o of orders) state.seenOrders.add(o.id);
}

function ticket(o, lane) {
  const isNew = !state.firstLoad && !state.seenOrders.has(o.id);
  const stamp = o.status === "cancelled" ? `<span class="stamp">Cancelled</span>` : o.refunded ? `<span class="stamp refunded">Refunded</span>` : "";
  const actions =
    lane.next && o.status === lane.status
      ? `<div class="ticket-actions">
           <button class="btn small" data-order="${o.id}" data-status="${lane.next}">${lane.action}</button>
           <button class="btn ghost small cancel" data-order="${o.id}" data-status="cancelled" title="Cancel order">✕</button>
         </div>`
      : "";
  return `
    <article class="ticket ${isNew ? "pop" : ""}" data-status="${o.status}">
      ${stamp}
      <div class="ticket-top">
        <span class="ticket-id">#${o.id}</span>
        <span class="ticket-table">Table ${o.table}</span>
      </div>
      <ul>${o.items.map((l) => `<li><span class="qty">${l.qty}×</span><span>${esc(l.name)}</span></li>`).join("")}</ul>
      ${o.note ? `<div class="note">${esc(o.note)}</div>` : ""}
      <div class="ticket-foot">
        <span class="badge src-${o.source}">${label(o.source)}</span>
        <span class="total">${esc(o.totalText)}</span>
      </div>
      <div class="ticket-foot"><span class="age" data-age="${o.createdAt}">${ago(o.createdAt)}</span>${
        o.updatedBy !== o.source && o.status !== "new" ? `<span class="age">${o.status} by ${label(o.updatedBy)}</span>` : ""
      }</div>
      ${actions}
    </article>`;
}

function emptyLane(status) {
  return {
    new: "No new orders. Try Rush hour, or place one over MCP.",
    cooking: "Nothing on the stove",
    ready: "Nothing waiting at the pass",
    served: "Nothing served yet"
  }[status];
}

function renderMissions(missions) {
  const core = missions.filter((m) => !m.bonus);
  const bonus = missions.filter((m) => m.bonus);
  const coreDone = core.filter((m) => m.done).length;
  const bonusDone = bonus.filter((m) => m.done).length;
  const pct = Math.round((coreDone / core.length) * 100);
  $("#missions-meta").textContent = `${coreDone + bonusDone}/${missions.length}`;
  $("#progress").innerHTML = `
    <div class="ring" style="--p:${pct}" data-label="${coreDone}/${core.length}"></div>
    <div class="progress-text">
      <strong>${progressLine(coreDone, core.length)}</strong>
      <span>Bonus missions: ${bonusDone}/${bonus.length}</span>
    </div>`;

  const justDone = [];
  for (const m of missions) {
    if (m.done && !state.doneMissions.has(m.id)) {
      if (!state.firstLoad) justDone.push(m);
      state.doneMissions.add(m.id);
    }
  }
  const item = (m) => `
    <li class="mission ${m.done ? "done" : ""} ${justDone.includes(m) ? "just-done" : ""}">
      <span class="check"></span>
      <div>
        <div class="mission-title">${esc(m.title)}</div>
        <div class="mission-hint">${esc(m.hint)}</div>
      </div>
      <span class="cp" title="Checkpoint ${m.checkpoint}">CP${m.checkpoint}</span>
    </li>`;
  $("#missions").innerHTML = core.map(item).join("") + `<li class="mission-divider">Bonus</li>` + bonus.map(item).join("");
  justDone.forEach((m, i) => setTimeout(() => toast(`Mission complete: ${m.title}`, m.hint), i * 700));
}

function progressLine(done, total) {
  if (done === 0) return "Deploy, then open this page";
  if (done === total) return "Every core mission done. Legends.";
  if (done < 3) return "Checkpoint 1: say hello over MCP";
  if (done < 6) return "Checkpoint 2: build your MCP tools";
  return "Checkpoint 3: put your agent to work";
}

function renderStock(menu) {
  const low = menu.filter((m) => m.stock > 0 && m.stock <= 4).length;
  const out = menu.filter((m) => m.stock === 0).length;
  $("#stock-meta").textContent = out ? `${out} sold out, ${low} low` : low ? `${low} running low` : "All good";
  $("#stock").innerHTML = menu
    .map((m) => {
      state.maxStock[m.id] = Math.max(state.maxStock[m.id] ?? 0, m.stock, 10);
      const pct = Math.round((m.stock / state.maxStock[m.id]) * 100);
      const cls = m.stock === 0 ? "out" : m.stock <= 4 ? "low" : "";
      return `
        <div class="item ${cls}">
          ${m.stock === 0 ? `<span class="stamp">86'd</span>` : ""}
          <div class="item-top">
            <span class="item-name">${esc(m.name)}${m.vegetarian ? `<span class="veg" title="Vegetarian">V</span>` : ""}</span>
            <span class="item-price">${money(m.price)}</span>
          </div>
          <div class="bar"><span style="width:${pct}%"></span></div>
          <div class="item-foot">
            <span><strong>${m.stock}</strong> left · <code>${esc(m.id)}</code></span>
            <button class="btn ghost small" data-restock="${esc(m.id)}" title="Add 10 portions">+10</button>
          </div>
        </div>`;
    })
    .join("");
}

function renderFeed(events) {
  $("#feed").innerHTML = events.length
    ? events
        .map((e) => {
          const fresh = !state.firstLoad && !state.seenEvents.has(e.id);
          const isMission = e.type === "mission.complete";
          return `
            <li class="${fresh ? "fresh" : ""} ${isMission ? "mission-event" : ""}">
              <time>${clock(e.at)}</time>
              <div class="msg">${isMission ? "" : `<span class="badge src-${e.source}">${label(e.source)}</span>`}${esc(e.message)}</div>
            </li>`;
        })
        .join("")
    : `<li><div></div><div class="muted">Nothing yet. Things you do show up here.</div></li>`;
  for (const e of events) state.seenEvents.add(e.id);
}

function renderStats(stats) {
  const sources = Object.entries(stats.bySource)
    .map(([s, n]) => `<span class="badge src-${s}">${label(s)} ${n}</span>`)
    .join(" ");
  $("#stats").innerHTML = `
    <span>Orders <strong>${stats.ordersToday}</strong></span>
    <span>Takings <strong>${esc(stats.revenueText)}</strong></span>
    <span>${sources || '<span class="muted">No orders yet</span>'}</span>`;
}

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

document.addEventListener("click", async (event) => {
  const el = event.target.closest("button");
  if (!el) return;
  try {
    if (el.dataset.order) {
      el.disabled = true;
      await api(`/api/orders/${el.dataset.order}`, { method: "PATCH", body: JSON.stringify({ status: el.dataset.status }) });
    } else if (el.dataset.restock) {
      el.disabled = true;
      await api(`/api/menu/${encodeURIComponent(el.dataset.restock)}/restock`, { method: "POST", body: JSON.stringify({ quantity: 10 }) });
    } else if (el.dataset.approval) {
      el.disabled = true;
      await api(`/api/approvals/${el.dataset.approval}`, { method: "POST", body: JSON.stringify({ decision: el.dataset.decision }) });
    } else if (el.id === "rush") {
      el.disabled = true;
      const placed = await api("/api/rush", { method: "POST", body: JSON.stringify({ count: 4 }) });
      toast(`Rush hour! ${placed.length} walk-in orders`, "Ask your agent what's waiting");
      setTimeout(() => (el.disabled = false), 1500);
    } else if (el.id === "reset") {
      if (!confirm("Reset the caff? Orders and activity are cleared and stock is refilled. Your mission board is kept.")) return;
      await api("/api/reset", { method: "POST", body: "{}" });
      state.seenOrders.clear();
    } else if (el.dataset.copy || el.dataset.copyText) {
      const text = el.dataset.copyText ?? $(el.dataset.copy).textContent;
      await navigator.clipboard.writeText(text);
      const old = el.textContent;
      el.textContent = "Copied";
      setTimeout(() => (el.textContent = old), 1200);
      return;
    } else return;
    await load();
  } catch (e) {
    toast("That didn't work", e.message);
    el.disabled = false;
  }
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function setOnline(online, why) {
  $("#status .dot").classList.toggle("off", !online);
  $("#status-text").textContent = online ? "Open" : "Can't reach the caff";
  $("#status").title = why ?? "";
}

function toast(title, detail) {
  const el = document.createElement("div");
  el.className = "toast";
  el.innerHTML = `<span class="star">★</span><div>${esc(title)}${detail ? `<small>${esc(detail)}</small>` : ""}</div>`;
  $("#toasts").appendChild(el);
  setTimeout(() => {
    el.classList.add("leaving");
    setTimeout(() => el.remove(), 350);
  }, 4200);
}

const LABELS = { mcp: "MCP", agent: "Agent", visitor: "Visitor", dashboard: "Dashboard", "walk-in": "Walk-in", api: "API", smoke: "Smoke" };
const label = (s) => LABELS[s] ?? s;
const money = (p) => `£${(p / 100).toFixed(2)}`;
const clock = (iso) => new Date(iso).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", second: "2-digit" });

function ago(iso) {
  const s = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000));
  if (s < 10) return "just now";
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  return `${Math.floor(s / 3600)}h ago`;
}

function esc(value) {
  return String(value ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
}

// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------

$("#mcp-url").textContent = `${location.origin}/mcp`;
setInterval(() => ($("#clock").textContent = new Date().toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })), 1000);
$("#clock").textContent = new Date().toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
load().then(schedule);
