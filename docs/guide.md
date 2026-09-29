# The guided path

By the end of this you'll have an MCP server that runs a caff and an AI agent, Sid, who uses it to take orders, chase the kitchen and keep the stock up. Everything runs on one Cloudflare Worker in your own account.

There are four checkpoints. Rough timings for the two-hour session, 15:00 to 17:00:

| Checkpoint | You'll have | Aim to finish by |
|---|---|---|
| [1. Open the caff](#checkpoint-1-open-the-caff) | A deployed caff and an MCP client calling your first tool | 15:35 |
| [2. Build the MCP server](#checkpoint-2-build-the-mcp-server) | Four new tools that take orders, move them along and restock | 16:05 |
| [3. Put Sid to work](#checkpoint-3-put-sid-to-work) | An agent that runs the caff through your MCP server | 16:30 |
| [4. Stretch](#checkpoint-4-stretch-challenges) | Whatever you pick: approvals, schedules, memory, table hopping | 17:00 |

Behind schedule? Every checkpoint has a skip command that drops in a finished version, so you can always get to the fun part. Skipping is allowed and nobody minds.

## Before you start

- A free Cloudflare account. [Sign up](https://dash.cloudflare.com/sign-up) if you haven't got one.
- For working locally: Node.js 22 or later, Git and an editor. Check with `node --version`.
- No local setup? Use the Deploy button and edit in the browser. On your new GitHub repo, press `.` to open the web editor. Each commit to `main` redeploys.

---

## Checkpoint 1: open the caff

Goal: deploy the caff, open the dashboard and get an MCP client to call a tool.

### 1. Deploy

Use the Deploy button in the [README](../README.md#option-a-the-deploy-button), or from a terminal:

```sh
git clone https://github.com/GoncaloLeitao/workers-caff-hackathon.git
cd workers-caff-hackathon
npm install
npx wrangler login
npm run deploy
```

Wrangler prints your Worker's URL. It looks like `https://workers-caff.<your-subdomain>.workers.dev`. The rest of this guide calls it `<your-worker>`.

### 2. Open the dashboard

Go to `https://<your-worker>/`. You'll see empty order lanes, the stock and the mission board. **Doors open** ticks straight away.

Press **Rush hour** to see a few walk-in orders arrive, and move them along with the buttons on each ticket. That's the REST API at work: the dashboard is plain HTML calling `/api/*`.

### 3. Connect an MCP client

MCP (Model Context Protocol) is how AI apps find and use tools. A client connects to a server, asks which tools it has, and lets a model call them. Your caff already runs an MCP server at `https://<your-worker>/mcp` with one tool, `get_menu`.

Copy the URL from the **Your MCP server** box on the dashboard, then connect a client. Use the event's Cloudflare OS for the rest of the afternoon; AI Playground is the backup.

**Cloudflare OS** (use this one)

The event has its own [Cloudflare OS](https://github.com/cloudflare/cloudflare-os) at [cfos.cfevents.dev](https://cfos.cfevents.dev). Workers AI models are free to use; a few OpenAI and Anthropic models work too, with a small budget each. If one of those stops answering, switch to a Workers AI model.

1. Open [cfos.cfevents.dev](https://cfos.cfevents.dev) and sign in with the email you registered with and a one-time code.
2. Open **Gatekeepers** from the sidebar (you may also be offered it the first time you sign in) and choose **MCP Server**.
3. Paste your MCP server URL and select **Continue**.
4. Start a chat and ask: *What's on the menu at the caff?*

Tools marked read-only, like `get_menu`, run straight away. Anything that changes the caff waits for you to approve it in the chat, so from Checkpoint 2 on, expect to press **Approve** for each order, status change and restock.

**AI Playground** (backup: no sign-in, but chats stop after 10 messages)

1. Open [playground.ai.cloudflare.com/models](https://playground.ai.cloudflare.com/models).
2. In the panel on the right, open **Custom MCP** and select **Add server**.
3. Paste your MCP server URL and select **Add server**. After a few seconds it says **Ready**, and the **Tools** tab lists `get_menu`.
4. Ask it: *What's on the menu at the caff?* When it says the demo is limited to 10 messages, start a new chat.

Either way, the model calls `get_menu` and the dashboard ticks **Hello, MCP** and **First tool call**.

**MCP Inspector** (a developer tool that shows the raw protocol)

```sh
npx @modelcontextprotocol/inspector
```

It opens in your browser. Choose the Streamable HTTP transport, paste your URL, connect, list the tools and run `get_menu`. If you'd rather stay in the terminal:

```sh
npx @modelcontextprotocol/inspector --cli https://<your-worker>/mcp --transport http --method tools/call --tool-name get_menu
```

### What just happened

The client sent `tools/list` to your Worker and got back a name, a description and an input schema for each tool. The model read those, decided `get_menu` would answer your question, and the client sent `tools/call`. Your Worker ran the tool and sent back the menu as JSON.

`src/index.ts` sends every `/mcp` request to `createMcpHandler` from the Agents SDK, which builds a fresh server from `src/mcp.ts` for each request. That file is where you're going next.

---

## Checkpoint 2: build the MCP server

Goal: add four tools to `src/mcp.ts` so an MCP client can run the caff.

### How a tool is built

Open `src/mcp.ts`. The finished `get_menu` tool is your template:

```ts
server.registerTool(
  "get_menu",                                   // the name the model calls
  {
    title: "Get the menu",
    description: "List everything on the menu: ...", // how the model decides when to use it
    inputSchema: z.object({}),                  // a zod schema; the SDK validates input for you
    annotations: { readOnlyHint: true }         // a hint that it doesn't change anything
  },
  async () => {
    const menu = await caff.getMenu();           // talk to the caff
    return asText(menu);                         // send the result back as JSON text
  }
);
```

`caff` is a small client for the caff's backend (a Durable Object with a SQLite database). `src/caff/client.ts` lists what it can do. When something's wrong, like an unknown item or a sold-out dish, it throws an error with a readable message. The MCP SDK turns that into a tool error the model can read and explain, so you don't need `try`/`catch`.

### Your loop for each tool

1. Uncomment the block and write the handler.
2. Deploy with `npm run deploy` (or commit and push if you used the Deploy button).
3. Cloudflare OS picks up new tools within about 5 minutes; if one still isn't there, start a new chat. In AI Playground, open **Custom MCP → Tools** and select **Refresh**.
4. Ask for something that needs the tool and watch the dashboard.

Working locally? `npm run dev` serves everything at http://localhost:8787. Cloudflare OS and AI Playground can't reach your laptop, so connect MCP Inspector to `http://localhost:8787/mcp` instead.

### TODO 1: `place_order`

The schema is written for you. Fill in the handler so it calls `caff.placeOrder` and returns the result.

Then ask: *Table 4 would like two bacon butties and a builder's tea.* A new ticket appears on the dashboard, labelled **MCP**, and **Order up** ticks.

Now try an order the caff can't take: *Table 4 wants the caviar.* The error comes back as a tool result and the model explains it.

<details>
<summary>Show the answer</summary>

```ts
async ({ table, items, note }) => {
  const order = await caff.placeOrder({ table, items, note });
  return asText(order);
}
```

</details>

### TODO 2: `list_orders`

Read-only, like `get_menu`. Both inputs are optional, and `status` defaults to `"active"` (anything not served or cancelled).

Ask: *What's waiting in the kitchen?*

<details>
<summary>Show the answer</summary>

```ts
async ({ status, table }) => asText(await caff.listOrders({ status, table }))
```

</details>

### TODO 3: `update_order_status`

Orders move forward only: `new → cooking → ready → served`. Cancelling returns the stock.

Ask: *Order 101 is ready.* Then: *They've got their food, mark it served.* **Service!** ticks.

<details>
<summary>Show the answer</summary>

```ts
async ({ orderId, status }) => asText(await caff.updateOrderStatus(orderId, status))
```

</details>

### TODO 4: `restock_item`

This one's all yours, including the description and the schema. It takes an `itemId` (a string) and a `quantity` (a whole number from 1 to 50), and calls `caff.restockItem(itemId, quantity)`.

Write the description for a model, not a person: say what the tool does, when to use it and where the ids come from.

Ask: *We've had a delivery. Ten more pie and mash, please.* **Stock take** ticks.

<details>
<summary>Show the answer</summary>

```ts
server.registerTool(
  "restock_item",
  {
    title: "Restock an item",
    description:
      "Add portions back to a menu item's stock, for example after a delivery. Use item ids from get_menu.",
    inputSchema: z.object({
      itemId: z.string().describe("Menu item id from get_menu"),
      quantity: z.number().int().min(1).max(50).describe("How many portions to add")
    })
  },
  async ({ itemId, quantity }) => asText(await caff.restockItem(itemId, quantity))
);
```

</details>

### Check your work

```sh
npm run smoke -- https://<your-worker> --write
```

You want `Checkpoint 2 progress: 4/4 tools`. Smoke-test orders are labelled **smoke** and don't count towards missions.

Stuck or short on time? `npm run skip:mcp` copies in a finished `src/mcp.ts` and keeps yours as `src/mcp.ts.bak`. Deploy afterwards.

---

## Checkpoint 3: put Sid to work

Goal: connect your agent to your MCP server so he can run the caff from a chat.

### Meet Sid

Open `https://<your-worker>/chat` and say hello. Sid will chat, but he'll tell you he isn't connected to the caff yet. He has no tools.

Sid lives in `src/agent.ts`. He's an [Agents SDK](https://developers.cloudflare.com/agents/) `Agent`, and every chat session gets its own instance. Each instance is a Durable Object with its own storage, which is how he remembers the conversation between messages.

When you send a message, `chat()` asks the model for a reply with `generateText` from the AI SDK. Once the model has tools, the SDK runs a loop: the model asks for a tool, the SDK calls it, the result goes back to the model, and so on until it has an answer (up to 8 steps).

### TODO 1: connect to your MCP server

In `chat()`, uncomment the `addMcpServer` call:

```ts
await this.addMcpServer("caff", `${origin}/mcp`, {
  transport: {
    type: "streamable-http",
    headers: { "x-caff-client": "agent", "x-caff-origin": origin }
  }
});
```

Sid connects to your `/mcp` over its public URL, the same way Cloudflare OS did. The connection is saved in his storage, so calling this on every message is fine. The headers tell the dashboard that the calls come from your agent.

### TODO 2: hand the model your tools

Uncomment one line in the `generateText` call:

```ts
tools: this.mcp.getAITools(),
```

`getAITools()` turns every tool from every connected MCP server into the format the AI SDK expects.

### Try it

Deploy, then reload `/chat`. The pill at the top should say **Connected to 1 MCP server · 5 tools**. Try the suggestions under the chat, or:

- *Table 6 wants a full English and two teas.*
- *What's waiting in the kitchen?*
- *The order you just took is ready. Mark it served.*
- *What's running lowest? Top it up by 10.*

Under each reply you'll see the tools Sid called. Click one to see its input and output. On the dashboard his orders are labelled **AGENT**, and **Agent on shift**, **The agent takes an order** and **Full service** tick as he works.

### Make him your own

The `SYSTEM_PROMPT` at the top of `src/agent.ts` is Sid's personality and rules. Change it: make him grumpier, get him to upsell pudding, or have him refuse to serve beans after 11. The rules about using tools and quoting totals keep him honest, so change those carefully.

Stuck? `npm run skip:agent` copies in a finished `src/agent.ts` (yours goes to `src/agent.ts.bak`). You need a working MCP server as well, so run `npm run skip:all` if Checkpoint 2 isn't done.

---

## Checkpoint 4: stretch challenges

Pick whatever looks fun. Four of them tick bonus missions on the dashboard. `npm run skip:stretch` drops in one way to do the first four, plus a `daily_report` tool as an example of a tool of your own. It doesn't tick **Off menu**: that one has to be yours. Reading `solutions/stretch/` is a good way to see how they work, but the builds that stand out at judging do something the reference doesn't.

### Manager's say-so (human in the loop)

Agents shouldn't hand out refunds on their own. Add two MCP tools:

- `request_refund` calls `caff.requestRefund(orderId, reason)`. The request appears on the dashboard with **Approve** and **Reject** buttons, and the tool returns an approval id straight away.
- `check_approval` calls `caff.checkApproval(approvalId)` and returns `pending`, `approved` or `rejected`.

Tell Sid *table 4 says their butty was cold, refund order 102*, approve it on the dashboard, then ask whether it went through. **Manager's say-so** ticks when a human decides. More in the docs on [human in the loop](https://developers.cloudflare.com/agents/concepts/agentic-patterns/human-in-the-loop/).

### Clockwork (scheduled tasks)

Agents can wake themselves up. `this.scheduleEvery(120, "stockCheck")` runs an `async stockCheck()` method on the class every two minutes. Scheduled runs have no request, so save the Worker's origin in `this.state` and reconnect to the MCP server from there. Use `this.mcp.callTool({ serverId, name, arguments })` to call tools directly, and `reportScheduledTask("…")` from `./caff/agent-kit` to tick **Clockwork**. See [scheduling tasks](https://developers.cloudflare.com/agents/runtime/execution/schedule-tasks/).

One thing to think about: every chat session is its own agent, so scheduling from `chat()` starts a separate stock check for each conversation. Run it on one named instance instead (`getAgentByName` from `agents` gets you one), and decide when it should stop.

### Remember the regulars (memory and local tools)

Give Sid a tool that runs inside the agent rather than over MCP. Use `tool()` from the `ai` package, mix it in with `tools: { ...this.mcp.getAITools(), remember_regular }`, and save what he learns with `this.setState(...)`. Add the regulars to the system prompt so he can place "the usual".

Each chat session is its own agent, so this memory belongs to one conversation. To share it across sessions, keep it in one named agent instance or add a [D1](https://developers.cloudflare.com/d1/) database or [KV](https://developers.cloudflare.com/kv/) namespace. See [agent state](https://developers.cloudflare.com/agents/runtime/lifecycle/state/).

### Table hopping

Swap Worker URLs with the next table. Give Sid a tool that connects to theirs:

```ts
await this.addMcpServer("table-5", "https://workers-caff.their-subdomain.workers.dev/mcp", {
  transport: { type: "streamable-http", headers: { "x-caff-client": "agent", "x-caff-origin": origin } }
});
```

From the next message, Sid can use their tools as well as yours: take orders for their tables, or nick their stock. **Table hopping** ticks on both dashboards, and theirs shows your agent as a visitor.

### Off menu (a tool of your own)

Invent a tool the caff hasn't got. A few ideas: `todays_special`, `allergens`, `split_the_bill`, `kitchen_eta`, `busiest_table`. (`daily_report` is taken: the stretch reference already has one.) **Off menu** ticks the first time any client calls a tool the caff doesn't know about.

### Lock the door

Anyone who knows your URL can use your MCP server. Add a bearer token check for `/mcp` in `src/index.ts`, store the token with `npx wrangler secret put MCP_TOKEN`, send it from Sid in the `addMcpServer` headers, and from AI Playground with **Custom headers** on your server. Cloudflare OS only asks for a URL, so it can't send the token: test from AI Playground once the door is locked. For the full version with logins, see [MCP authorization](https://developers.cloudflare.com/agents/model-context-protocol/protocol/authorization/).

### More with Cloudflare OS

You connected Cloudflare OS to your caff in Checkpoint 1. It can do more than chat: it can write code against your tools, build small apps (gadgets) and run things on a schedule. Each link below opens Cloudflare OS with the prompt filled in, ready for you to edit and send:

- [Use my caff's tools to show me the menu and any orders that are still open.](https://cfos.cfevents.dev/?prompt=Use%20my%20caff%27s%20tools%20to%20show%20me%20the%20menu%20and%20any%20orders%20that%20are%20still%20open.)
- [Check my caff's stock and restock anything with fewer than 5 portions left. Ask me before changing anything.](https://cfos.cfevents.dev/?prompt=Check%20my%20caff%27s%20stock%20and%20restock%20anything%20with%20fewer%20than%205%20portions%20left.%20Ask%20me%20before%20changing%20anything.)
- [Build me a small dashboard that shows my caff's active orders by table and refreshes every 30 seconds.](https://cfos.cfevents.dev/?prompt=Build%20me%20a%20small%20dashboard%20that%20shows%20my%20caff%27s%20active%20orders%20by%20table%20and%20refreshes%20every%2030%20seconds.)

### More ideas

- Try [Code Mode](https://developers.cloudflare.com/agents/tools/codemode/): the model writes a little code that calls your tools, instead of calling them one at a time.
- Build a customer-facing ordering page. The REST API allows cross-origin requests, so it can live anywhere.
- Try other [Workers AI models](https://developers.cloudflare.com/workers-ai/models/) in `vars.MODEL` and compare speed and cost in the chat's **Under the hood** panel. Some models need the Workers Paid plan.
- See [ideas.md](ideas.md) for bigger ideas that use more of the platform.

---

## Troubleshooting

| What you see | What to do |
|---|---|
| Sid says he isn't connected to the caff | Finish both TODOs in `src/agent.ts` and deploy again. |
| "Couldn't use your MCP server at …/mcp" | Your MCP server fails to start, often because of a duplicate tool name or an error at the top level of `src/mcp.ts`. Run `npm run smoke -- <your-worker>` and `npx wrangler tail`. |
| Error 1042 | `global_fetch_strictly_public` is missing from `compatibility_flags` in `wrangler.jsonc`. Put it back and deploy. |
| New tools don't show in Cloudflare OS | It checks for new tools every 5 minutes. Wait, then start a new chat. |
| New tools don't show in AI Playground | **Custom MCP → Tools → Refresh**. |
| Can't sign in to Cloudflare OS | Use the email you registered with. If the code never arrives, ask a facilitator and use AI Playground meanwhile. |
| AI Playground says the demo is limited to 10 messages | Start a new chat, or switch to Cloudflare OS, which has no such limit. |
| Cloudflare OS or AI Playground can't connect to localhost | They run on the internet. Deploy, or use MCP Inspector for local testing. |
| "You've used today's free Workers AI allowance" | Set `vars.MODEL` to `"@cf/zai-org/glm-4.7-flash"` in `wrangler.jsonc` and deploy. |
| "That model needs the Workers Paid plan" | Set `vars.MODEL` back to `"@cf/openai/gpt-oss-120b"`. |
| Wrangler asks for a workers.dev subdomain | New accounts need one. Pick any name. |
| `npm install` complains about the Node version | You need Node.js 22 or later. |
| TypeScript errors | `npm run check` lists them. Wrangler doesn't type-check when it deploys, so a type error can hide a real bug. |
| The caff is a mess | **Reset caff** on the dashboard gives you fresh stock and no orders. To wipe the mission board too: `curl -X POST https://<your-worker>/api/reset -H 'content-type: application/json' -d '{"everything":true}'` |

## REST API reference

Useful for scripts and your own frontends. Everything returns JSON, prices are in pence and tables are numbered 1 to 12.

| Method and path | Body | Returns |
|---|---|---|
| `GET /api/menu` | | Menu items with stock |
| `POST /api/menu/:itemId/restock` | `{ "quantity": 10 }` | The updated item |
| `GET /api/orders?status=active&table=4` | | Orders, newest first. Status can be `active`, `new`, `cooking`, `ready`, `served`, `cancelled` or `all` |
| `POST /api/orders` | `{ "table": 4, "items": [{ "itemId": "bacon-butty", "qty": 2 }], "note": "brown sauce" }` | The new order |
| `GET /api/orders/:id` | | One order |
| `PATCH /api/orders/:id` | `{ "status": "cooking" }` | The updated order |
| `POST /api/approvals/:id` | `{ "decision": "approved" }` | The decided approval |
| `GET /api/state` | | Everything the dashboard shows, in one call |
| `POST /api/rush` | `{ "count": 4 }` | Walk-in orders |
| `POST /api/reset` | `{ "everything": true }` (optional) | `{ "ok": true }` |
