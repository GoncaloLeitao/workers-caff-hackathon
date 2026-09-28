# Notes for facilitators

For the people running the room. Attendees don't need this page, but nothing here is secret.

## Before the day

- [ ] Make the repo public (**Settings → General → Danger Zone → Change visibility**). The Deploy button only works on public repos.
- [ ] Test the Deploy button once the repo is public, ideally with an account that has never used Workers.
- [ ] Print the [cheat sheet](cheatsheet.pdf): one per person plus spares.
- [ ] Check the venue Wi-Fi reaches `github.com`, `registry.npmjs.org`, `*.workers.dev` and `playground.ai.cloudflare.com`.
- [ ] Deploy your own caff so you can demo each step. The reference caff below has everything done.
- [ ] Agree the prize categories and who's judging.

## Useful links

| What | Where |
|---|---|
| Starter repo | https://github.com/GoncaloLeitao/workers-caff-hackathon |
| Reference caff, finished with all stretch goals | https://workers-caff.jleitao.workers.dev |
| Reference chat | https://workers-caff.jleitao.workers.dev/chat |
| AI Playground | https://playground.ai.cloudflare.com/models |

## Run of show

| Time | What happens |
|---|---|
| 15:00 | Kick-off, five minutes: the two paths, the cheat sheet, how to get help, prizes |
| 15:05 | Everyone deploys. Walk the room: sign-up and first deploy are where people get stuck |
| 15:35 | Checkpoint 1 target. If several tables are stuck, demo AI Playground on the big screen |
| 16:05 | Checkpoint 2 target. Suggest `npm run skip:mcp` to anyone still on the first tool |
| 16:30 | Checkpoint 3 target. Suggest `npm run skip:all` to anyone behind, so everyone gets to chat to their agent |
| 16:45 | Judges compare notes |
| 17:00 | Discussion and prizes for the best builds |

## Kick-off, in about two minutes

> You've got until five. There are two ways to spend it. The guided path builds an MCP server for a London caff, then an AI agent called Sid who uses it to take orders. Four checkpoints, and a skip command at each one, so nobody gets stuck for long. Or build your own thing on Cloudflare: that's just as welcome.
>
> Everything you need is on the cheat sheet on your table. Use your own free Cloudflare account. Your dashboard has a mission board that ticks off as you go, which is how we'll find you. We'll be walking round the whole time, so wave if you're stuck.
>
> There are prizes for the best builds, and we'll hand them out at ten to five.

## Helping at a table

Work through these in order:

1. **Does the dashboard load** at `https://<their-worker>/`? If not, the deploy didn't happen. Check the output of `npm run deploy`, or the build log in the Cloudflare dashboard if they used the Deploy button.
2. **Where are they?** The mission board shows which checkpoint they've reached.
3. **Run the smoke test:** `npm run smoke -- https://<their-worker> --agent`. It checks the API, lists their MCP tools, counts the Checkpoint 2 tools and asks Sid a question.
4. **Read the logs:** `npx wrangler tail`, or the Worker's **Logs** tab in the Cloudflare dashboard. Observability is on.

Problems you're likely to see:

| Symptom | Likely cause and fix |
|---|---|
| Can't deploy: no `workers.dev` subdomain | New accounts need one. Wrangler asks for it on the first deploy; any name works. |
| `npm install` fails on Node version | Node 22 or later is required. Use `nvm install 22`, or switch to the Deploy button and GitHub's web editor (press `.` on their repo). |
| Locked-down laptop, no npm | Deploy button, then edit in GitHub's web editor. Every commit to `main` redeploys. |
| No GitHub account | Clone over HTTPS and deploy with `npm run deploy`. |
| Sid chats but never uses tools | Checkpoint 3 not finished, or not deployed since. The chat header shows how many MCP tools Sid can see. |
| "Couldn't use your MCP server" | Their `src/mcp.ts` fails to build a server. Usual suspects: a tool registered twice, or a syntax error. The smoke test shows the error. |
| Error 1042 | They removed `global_fetch_strictly_public` from `wrangler.jsonc`. Sid needs it to call the Worker's own public URL. |
| Tools missing in AI Playground | **Custom MCP → Tools → Refresh** after each deploy. |
| Free Workers AI allowance used up | Switch `vars.MODEL` to `@cf/zai-org/glm-4.7-flash` and redeploy. AI Playground doesn't use their allowance. |
| Missions don't tick for smoke tests | That's deliberate. Smoke traffic is labelled and ignored. |

## Judging

There's no leaderboard. The mission board helps you find tables worth a visit, but it isn't a score: someone who skipped to Checkpoint 3 and then built something original deserves more than someone who ticked every box.

Things worth rewarding:

- It works, live, when they show you.
- They added something the starter didn't give them.
- They used the platform well: a Workflow, AI Search, a schedule, a second agent, a real frontend.
- Character. A Sid who refuses to serve beans after 11 counts.

Three or four prizes is plenty. Suggested categories: best agent, most creative, best own project, and furthest from a standing start.

## How the starter works

Enough detail to answer questions at the tables.

**One Worker does everything.** `src/index.ts` routes `/api/*` to the REST API, `/mcp` to the MCP server, `/agents/*` to the agent and everything else to static files in `public/`. The caff's data lives in `CaffStore`, a single Durable Object with SQLite.

**The MCP server** is built per request with `createMcpHandler` from the Agents SDK, using the official MCP TypeScript SDK. Tools call the store over Durable Object RPC.

**Sid** is an Agents SDK `Agent`, one instance per chat session. He connects to his own Worker's public `/mcp` URL with `addMcpServer`, just like an external client would. That's why the `global_fetch_strictly_public` compatibility flag is on: without it, a Worker calling its own hostname gets error 1042. The model is `@cf/openai/gpt-oss-120b` on Workers AI: about four seconds and 100 Neurons per reply, so roughly 100 replies a day on a free account.

**Missions** tick from what the caff sees. Every `/mcp` request is inspected in the background, and headers say who's calling:

| Header | Treated as |
|---|---|
| `x-caff-client: agent`, same origin | Their own agent |
| `x-caff-client: agent`, different `x-caff-origin` | A visiting agent from another table |
| `x-caff-client: smoke` | The smoke test (ignored) |
| Anything else | An MCP client such as AI Playground |

| Mission | Ticks when |
|---|---|
| Doors open | The dashboard loads |
| Hello, MCP | An MCP client lists tools |
| First tool call | An MCP client calls any tool |
| Order up / Service! / Stock take | An order is placed, moved along or restocked over MCP (client or agent) |
| Agent on shift | Sid replies with at least one MCP tool available |
| The agent takes an order | Sid places an order |
| Full service | Sid marks served an order that he placed |
| Off menu | Any client calls a tool the starter doesn't include |
| Manager's say-so | A human approves or rejects a refund on the dashboard |
| Clockwork | A scheduled task reports in |
| Table hopping | Sid connects to another table's MCP server, or a visiting agent uses theirs |

**Known quirks**

- Sid's memory belongs to one chat session. **New conversation** on the chat page starts a fresh agent.
- The first message after a deploy can take a few extra seconds while Sid reconnects.
- The stretch reference schedules a stock check every two minutes, and it keeps running until the Worker is deleted. It only calls MCP tools, so it doesn't use any Workers AI allowance.
- Open models occasionally slip. The chat hides leaked tool-call syntax and asks the user to try again.

## Resetting a caff

**Reset caff** on the dashboard restores the stock and clears orders but keeps the mission board. To wipe everything:

```sh
curl -X POST https://<worker>/api/reset -H 'content-type: application/json' -d '{"everything":true}'
```
