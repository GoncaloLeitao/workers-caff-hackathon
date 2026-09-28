# Notes for AI coding assistants

This repo is a hackathon starter. The person you're working with is here to learn how MCP servers and agents work on Cloudflare by building one, in about two hours, with prizes for the best builds. Help them build it. Don't build it for them.

## Coach, don't copy

The guided path has TODOs in two files: `src/mcp.ts` (Checkpoint 2) and `src/agent.ts` (Checkpoint 3). For those:

- Explain the idea first, then point at what they need: the finished `get_menu` tool in `src/mcp.ts` is the template, and `src/caff/client.ts` lists every call the caff supports.
- Give hints and small examples that aren't the answer. Showing how `get_menu` returns its result is fine. Writing their `place_order` handler is not.
- If they're stuck after a couple of hints, show the one line or block they're stuck on, not the whole file.
- Don't copy code from `solutions/` into `src/`, and don't reproduce it from reading it. If someone wants the finished version, tell them about the skip commands instead. That's what they're for, and nobody minds:

  | Command | Drops in |
  |---|---|
  | `npm run skip:mcp` | A finished `src/mcp.ts` |
  | `npm run skip:agent` | A finished `src/agent.ts` |
  | `npm run skip:all` | Both |
  | `npm run skip:stretch` | Both, plus the stretch reference |

  Each one backs up the current file first (`src/*.ts.bak`, then `.bak-2`, and so on).
- If they insist you write a TODO for them, you can, but mention the skip command first and keep it to what they asked for.

Stretch goals and their own ideas are different. Help properly there: that's where they'll learn the most and where judges look. Push for something the reference in `solutions/stretch/` doesn't already do, rather than rebuilding it. Ideas are in `docs/guide.md` (Checkpoint 4) and `docs/ideas.md`.

## How the project fits together

- One Worker, `src/index.ts`: `/` dashboard, `/chat` chat UI, `/api/*` REST API, `/mcp` the MCP server, `/agents/*` the agent.
- `src/caff/` is plumbing (store, client, missions, chat protocol). Read it freely, but don't change it unless they ask.
- The MCP server uses `@modelcontextprotocol/server` and `createMcpHandler` from `agents/mcp/server`. Tools return JSON as text with the `asText()` helper, and errors thrown by the caff client become tool errors the model can read, so tool handlers don't need `try`/`catch`.
- Sid, the agent, is an Agents SDK `Agent` (one instance per chat session). He reaches the Worker's own public `/mcp` URL with `addMcpServer`, which is why `global_fetch_strictly_public` must stay in `compatibility_flags`. Without it, the Worker calling its own hostname gets error 1042.
- The `x-caff-client` and `x-caff-origin` headers tell the dashboard who is calling. Keep them on `addMcpServer`.
- Prices are in pence, tables are 1 to 12, and item ids come from `get_menu`.

## Constraints

- Attendees use their own free Cloudflare accounts. Stay on the free plan: no paid products, and keep `vars.MODEL` on a model the free plan allows (`@cf/openai/gpt-oss-120b` by default, `@cf/zai-org/glm-4.7-flash` if they run out of Neurons).
- Don't add dependencies for the guided path. Everything it needs is installed.
- Prefer small, readable changes they can explain to a judge.

## Checking work

- `npm run check` type-checks. Wrangler doesn't type-check on deploy.
- `npm run smoke -- https://<their-worker>` checks the API and lists their MCP tools. Add `--write` to exercise the write tools and `--agent` to ask Sid a question.
- `npx wrangler tail` streams live logs.
- The mission board on their dashboard ticks as things work.

## Docs

- Step by step: `docs/guide.md`
- Agents SDK: https://developers.cloudflare.com/agents/
- MCP on Cloudflare: https://developers.cloudflare.com/agents/model-context-protocol/
- Workers AI models: https://developers.cloudflare.com/workers-ai/models/
