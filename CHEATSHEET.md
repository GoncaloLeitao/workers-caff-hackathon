# The Workers Caff: cheat sheet

Build with Cloudflare London · Tuesday 29 September 2026 · 15:00 to 17:00 · prizes for the best builds at 17:00

Printable version: [docs/cheatsheet.pdf](docs/cheatsheet.pdf)

## Links

| | |
|---|---|
| Starter repo | https://github.com/GoncaloLeitao/workers-caff-hackathon |
| Your caff | `https://workers-caff.<your-subdomain>.workers.dev` (Wrangler prints it) |
| Dashboard / chat / MCP / API | `/` · `/chat` · `/mcp` · `/api/state` |
| Cloudflare OS | https://cfos.cfevents.dev, sign in with the email you registered with |
| AI Playground (backup) | https://playground.ai.cloudflare.com/models |
| Step-by-step guide | [docs/guide.md](docs/guide.md) |

## Get going

```sh
git clone https://github.com/GoncaloLeitao/workers-caff-hackathon.git
cd workers-caff-hackathon
npm install
npx wrangler login
npm run deploy
```

No Node 22 or no npm? Use the **Deploy to Cloudflare** button in the README, then edit in GitHub's web editor (press `.` on your repo). Every commit redeploys.

## The checkpoints

**1. Open the caff** (aim for 15:35). Deploy and open your dashboard. In Cloudflare OS, open **Gatekeepers → MCP Server**, paste your `/mcp` URL, select **Continue** and ask *what's on the menu?* Approve anything that changes the caff. Backup: AI Playground, **Custom MCP → Add server** (10 messages per chat).

**2. Build the MCP server** (aim for 16:05). In `src/mcp.ts`, finish TODO 1 to 4: `place_order`, `list_orders`, `update_order_status`, `restock_item`. After each deploy, Cloudflare OS sees new tools within 5 minutes (AI Playground: **Custom MCP → Tools → Refresh**).

**3. Put Sid to work** (aim for 16:30). In `src/agent.ts`, uncomment `this.addMcpServer(...)` and `tools: this.mcp.getAITools()`. Deploy, open `/chat` and give Sid an order.

**4. Stretch.** Refunds with a human approval, a scheduled stock check, memory for regulars, table hopping, a tool of your own, auth. Or your own idea: see [docs/ideas.md](docs/ideas.md).

## The code you'll write

```ts
// src/mcp.ts: every tool has the same shape. get_menu is done for you: copy its pattern.
server.registerTool(
  "get_menu",                                       // the name the model calls
  {
    description: "List everything on the menu: ...", // how the model decides when to use it
    inputSchema: z.object({}),                      // a zod schema: what the model must send
    annotations: { readOnlyHint: true }             // a hint that it changes nothing
  },
  async () => asText(await caff.getMenu())          // do the work, send back JSON text
);

// src/agent.ts: connect Sid to your MCP server, then give the model its tools
await this.addMcpServer("caff", `${origin}/mcp`, {
  transport: { type: "streamable-http", headers: { "x-caff-client": "agent", "x-caff-origin": origin } }
});
tools: this.mcp.getAITools(),
```

## Commands

| Command | What it does |
|---|---|
| `npm run dev` | Local caff at http://localhost:8787 (use MCP Inspector: Cloudflare OS and AI Playground can't reach localhost) |
| `npm run deploy` | Put it live |
| `npm run smoke -- <url> --write --agent` | Check the API, your MCP tools and Sid |
| `npx wrangler tail` | Live logs from your Worker |
| `npx @modelcontextprotocol/inspector` | MCP Inspector, for poking at `/mcp` |
| `npm run skip:mcp` / `skip:agent` / `skip:all` / `skip:stretch` | Drop in a finished version (yours is saved as `src/*.ts.bak`) |

## If it breaks

| What you see | Fix |
|---|---|
| Sid says he isn't connected | Finish Checkpoint 3 and deploy again |
| New tools missing in Cloudflare OS | Wait 5 minutes, then start a new chat |
| New tools missing in AI Playground | **Custom MCP → Tools → Refresh** |
| "Couldn't use your MCP server" | `npm run smoke -- <url>` shows the error |
| Error 1042 | Keep `global_fetch_strictly_public` in `wrangler.jsonc` |
| Free Workers AI allowance used up | Set `vars.MODEL` to `"@cf/zai-org/glm-4.7-flash"` and deploy |
| Anything else | Wave at us |

## Missions

**Checkpoint 1:** Doors open · Hello, MCP · First tool call
**Checkpoint 2:** Order up · Service! · Stock take
**Checkpoint 3:** Agent on shift · The agent takes an order · Full service
**Bonus:** Off menu · Manager's say-so · Clockwork · Table hopping
