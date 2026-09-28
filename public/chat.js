// Chat UI for your agent. Plain JavaScript, no build step.
// It talks to your CaffAgent over HTTP: /agents/caff-agent/<session>

const $ = (sel) => document.querySelector(sel);

const SUGGESTIONS = [
  "What's on the menu?",
  "Table 4 wants two builder's teas and a bacon butty",
  "What's waiting in the kitchen?",
  "The order you just took is ready. Mark it served",
  "What's running lowest? Top it up by 10",
  "Cancel the last order, they walked out"
];

// ?session=<id> in the URL opens a specific conversation (handy for demos).
let session = new URLSearchParams(location.search).get("session") || localStorage.getItem("caff-session");
if (!session) {
  session = `chat-${Math.random().toString(36).slice(2, 10)}`;
  localStorage.setItem("caff-session", session);
}
const endpoint = () => `/agents/caff-agent/${session}`;
let busy = false;
let totals = { input: 0, output: 0, turns: 0 };

// ---------------------------------------------------------------------------
// Talking to the agent
// ---------------------------------------------------------------------------

async function loadHistory() {
  try {
    const res = await fetch(endpoint());
    const body = await res.json();
    $("#model").textContent = body.model ?? "?";
    updateMcp(body.mcp);
    if (body.messages?.length) {
      $("#hello").remove();
      for (const m of body.messages) addMessage(m.role, m.content, { tools: m.tools });
    }
  } catch (e) {
    addMessage("error", `Couldn't load the conversation: ${e.message}`);
  }
}

async function send(text) {
  if (busy || !text.trim()) return;
  busy = true;
  $("#hello")?.remove();
  addMessage("user", text);
  const pending = addMessage("assistant", "", { pending: true });
  const started = Date.now();
  const tick = setInterval(() => {
    const s = Math.round((Date.now() - started) / 1000);
    const meta = pending.querySelector(".meta");
    if (meta) meta.textContent = s >= 2 ? `Sid is thinking… ${s}s` : "";
  }, 500);
  try {
    const res = await fetch(endpoint(), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ message: text })
    });
    const body = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
    pending.remove();
    if (body.model) $("#model").textContent = body.model;
    updateMcp(body.mcp);
    if (!res.ok || body.error) {
      addMessage("error", body.error ?? `HTTP ${res.status}`);
    } else {
      addMessage("assistant", body.reply, { tools: body.tools, ms: body.ms, usage: body.usage });
      if (body.usage) {
        totals.input += body.usage.inputTokens;
        totals.output += body.usage.outputTokens;
        totals.turns += 1;
        $("#last-turn").textContent = `${(body.ms / 1000).toFixed(1)}s · ${body.usage.modelCalls} model call${body.usage.modelCalls === 1 ? "" : "s"} · ${body.tools.length} tool call${body.tools.length === 1 ? "" : "s"}`;
        $("#total-tokens").textContent = `${totals.turns} replies · ${fmt(totals.input)} tokens in, ${fmt(totals.output)} out`;
      }
    }
  } catch (e) {
    pending.remove();
    addMessage("error", `Couldn't reach your agent: ${e.message}`);
  } finally {
    clearInterval(tick);
    busy = false;
    $("#input").focus();
  }
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

function addMessage(role, text, opts = {}) {
  const el = document.createElement("div");
  el.className = `msg ${role}`;
  const avatar = role === "user" ? `<div class="avatar">You</div>` : `<div class="avatar"><img src="/favicon.svg" alt="Sid" /></div>`;
  const tools = opts.tools?.length
    ? `<div class="tools">${opts.tools
        .map((t, i) => `<button class="tool ${t.error ? "err" : ""} ${t.server === "local" ? "local" : ""}" data-i="${i}" title="Show input and output">${esc(t.name)}</button>`)
        .join("")}</div>`
    : "";
  const meta = opts.pending
    ? `<div class="meta"></div>`
    : opts.ms
      ? `<div class="meta">${(opts.ms / 1000).toFixed(1)}s${opts.usage ? ` · ${fmt(opts.usage.inputTokens + opts.usage.outputTokens)} tokens` : ""}</div>`
      : "";
  el.innerHTML = `${avatar}<div class="bubble">${
    opts.pending ? `<span class="typing"><span></span><span></span><span></span></span>` : role === "user" ? esc(text) : markdown(text)
  }${tools}${meta}</div>`;
  if (opts.tools?.length) {
    el.querySelectorAll(".tool").forEach((btn) =>
      btn.addEventListener("click", () => {
        const t = opts.tools[Number(btn.dataset.i)];
        const bubble = el.querySelector(".bubble");
        const existing = bubble.querySelector(`.tool-detail[data-i="${btn.dataset.i}"]`);
        if (existing) return existing.remove();
        const detail = document.createElement("div");
        detail.className = "tool-detail";
        detail.dataset.i = btn.dataset.i;
        detail.textContent = `${t.name} (${t.server})\n\ninput:\n${pretty(t.input)}\n\n${t.error ? `error:\n${t.error}` : `output:\n${pretty(t.output)}`}`;
        bubble.appendChild(detail);
      })
    );
  }
  $("#thread").appendChild(el);
  $("#thread").scrollTop = $("#thread").scrollHeight;
  return el;
}

function updateMcp(mcp) {
  if (!mcp) return;
  const connected = mcp.servers.filter((s) => s.state === "ready");
  $("#mcp-pill .dot").classList.toggle("off", connected.length === 0);
  $("#mcp-pill-text").textContent = connected.length
    ? `Connected to ${connected.length} MCP server${connected.length > 1 ? "s" : ""} · ${mcp.toolCount} tools`
    : "Not connected to MCP yet";
  $("#tool-count").textContent = mcp.toolCount;
  if (!mcp.servers.length) return;
  $("#servers").innerHTML = mcp.servers
    .map(
      (s) => `
      <div class="server">
        <div class="server-top"><span>${esc(s.name)}</span><span class="state ${s.state === "ready" ? "" : "bad"}">${esc(s.state)}</span></div>
        <div class="server-url">${esc(s.url)}</div>
        ${s.error ? `<div class="small" style="color:var(--red)">${esc(s.error)}</div>` : ""}
        <div class="tool-names">${s.tools.map((t) => `<code>${esc(t)}</code>`).join("")}</div>
      </div>`
    )
    .join("");
}

/** A deliberately tiny Markdown renderer: paragraphs, lists, tables, bold, italics and code. */
function markdown(src) {
  const lines = esc(src ?? "").split("\n");
  const out = [];
  let list = null;
  let table = null;
  const inline = (s) =>
    s
      .replace(/`([^`]+)`/g, "<code>$1</code>")
      .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
      .replace(/(^|[^*])\*([^*\s][^*]*)\*/g, "$1<em>$2</em>");
  const closeList = () => {
    if (list) out.push(`</${list}>`);
    list = null;
  };
  const closeTable = () => {
    if (table) out.push(`<table>${table.join("")}</table>`);
    table = null;
  };
  for (const raw of lines) {
    const line = raw.trimEnd();
    if (/^\s*\|.*\|\s*$/.test(line)) {
      closeList();
      if (/^\s*\|[\s:|-]+\|\s*$/.test(line)) continue;
      const cells = line.trim().slice(1, -1).split("|").map((c) => inline(c.trim()));
      table ??= [];
      const tag = table.length === 0 ? "th" : "td";
      table.push(`<tr>${cells.map((c) => `<${tag}>${c}</${tag}>`).join("")}</tr>`);
      continue;
    }
    closeTable();
    const bullet = line.match(/^\s*[-*•]\s+(.*)$/);
    const numbered = line.match(/^\s*\d+[.)]\s+(.*)$/);
    if (bullet || numbered) {
      const kind = bullet ? "ul" : "ol";
      if (list !== kind) {
        closeList();
        out.push(`<${kind}>`);
        list = kind;
      }
      out.push(`<li>${inline((bullet ?? numbered)[1])}</li>`);
      continue;
    }
    closeList();
    if (line.trim()) out.push(`<p>${inline(line)}</p>`);
  }
  closeList();
  closeTable();
  return out.join("");
}

function pretty(value) {
  if (value === undefined) return "(none)";
  return typeof value === "string" ? value : JSON.stringify(value, null, 2);
}

function fmt(n) {
  return n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n);
}

function esc(value) {
  return String(value ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
}

// ---------------------------------------------------------------------------
// Wiring
// ---------------------------------------------------------------------------

$("#session").textContent = session;
$("#suggestions").innerHTML = SUGGESTIONS.map((s) => `<button type="button">${esc(s)}</button>`).join("");
$("#suggestions").addEventListener("click", (e) => {
  const btn = e.target.closest("button");
  if (btn) send(btn.textContent);
});

$("#composer").addEventListener("submit", (e) => {
  e.preventDefault();
  const text = $("#input").value;
  $("#input").value = "";
  autosize();
  send(text);
});

$("#input").addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    $("#composer").requestSubmit();
  }
});

function autosize() {
  const t = $("#input");
  t.style.height = "auto";
  t.style.height = `${Math.min(t.scrollHeight, 160)}px`;
}
$("#input").addEventListener("input", autosize);

$("#new-chat").addEventListener("click", async () => {
  await fetch(endpoint(), { method: "DELETE" }).catch(() => {});
  session = `chat-${Math.random().toString(36).slice(2, 10)}`;
  localStorage.setItem("caff-session", session);
  $("#session").textContent = session;
  totals = { input: 0, output: 0, turns: 0 };
  $("#last-turn").textContent = "–";
  $("#total-tokens").textContent = "–";
  $("#thread").innerHTML = "";
  addMessage("assistant", "Fresh page in the order book. What can I do for you?");
});

loadHistory();
$("#input").focus();
