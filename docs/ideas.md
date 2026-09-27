# Ideas

You don't have to follow the guided path. Here are some bigger things to build, on top of the caff or from scratch. The stretch challenges in [the guide](guide.md#checkpoint-4-stretch-challenges) are smaller and a good warm-up.

## Build on the caff

**A kitchen display or an ordering page.** Put a customer-facing menu in `public/`, or build a screen for the kitchen that shows tickets as they arrive. The [REST API](guide.md#rest-api-reference) is already there and allows cross-origin requests, so the page can live anywhere. See [static assets](https://developers.cloudflare.com/workers/static-assets/).

**Order by voice.** Workers AI has speech-to-text and text-to-speech models. Record a message in the browser, transcribe it, pass it to Sid and read his reply out loud. Browse the [model catalogue](https://developers.cloudflare.com/workers-ai/models/).

**An allergen and recipe knowledge base.** Put some recipe files in R2 and index them with [AI Search](https://developers.cloudflare.com/ai-search/), then give Sid a tool that searches them. "Is the veggie breakfast gluten free?" deserves a sourced answer.

**Orders that look after themselves.** Start a [Workflow](https://developers.cloudflare.com/workflows/) for each order. It can sleep, nudge the kitchen if the order's been cooking for ages, and ask for feedback an hour after it's served. Workflows survive restarts and retry failed steps for you.

**Receipts and menus as PDFs.** Use [Browser Run](https://developers.cloudflare.com/browser-run/) to render an HTML receipt or today's menu to a PDF or screenshot, and store it in [R2](https://developers.cloudflare.com/r2/).

**Sid on Slack, Discord or Telegram.** Add a webhook route to the Worker that passes messages to the agent and posts his replies back. Each channel or user can have its own agent instance.

**See what the model is doing.** Put [AI Gateway](https://developers.cloudflare.com/ai-gateway/) between Sid and Workers AI for request logs, caching, rate limits and cost tracking.

**Let Sid write code.** With [Code Mode](https://developers.cloudflare.com/agents/tools/codemode/), the model writes a small program that calls your tools instead of calling them one at a time. It helps a lot when a job needs many tool calls, such as "restock everything that's below five".

## Start your own project

| Starting point | Command |
|---|---|
| Any Workers template | `npm create cloudflare@latest` |
| A chat agent with a React UI | `npm create cloudflare@latest -- --template=cloudflare/agents-starter` |
| A remote MCP server | `npm create cloudflare@latest -- my-mcp-server --template=cloudflare/ai/demos/remote-mcp-authless` |

There are many more in the [templates repo](https://github.com/cloudflare/templates).

## Handy docs

| Area | Products |
|---|---|
| Agents and MCP | [Agents SDK](https://developers.cloudflare.com/agents/), [MCP servers](https://developers.cloudflare.com/agents/model-context-protocol/), [MCP client in agents](https://developers.cloudflare.com/agents/tools/mcp/), [scheduling](https://developers.cloudflare.com/agents/runtime/execution/schedule-tasks/), [state](https://developers.cloudflare.com/agents/runtime/lifecycle/state/) |
| AI | [Workers AI](https://developers.cloudflare.com/workers-ai/), [function calling](https://developers.cloudflare.com/workers-ai/features/function-calling/), [AI Gateway](https://developers.cloudflare.com/ai-gateway/), [AI Search](https://developers.cloudflare.com/ai-search/), [Vectorize](https://developers.cloudflare.com/vectorize/) |
| Compute | [Workers](https://developers.cloudflare.com/workers/), [Durable Objects](https://developers.cloudflare.com/durable-objects/), [Workflows](https://developers.cloudflare.com/workflows/), [Sandbox SDK](https://developers.cloudflare.com/sandbox/), [Browser Run](https://developers.cloudflare.com/browser-run/) |
| Storage | [D1](https://developers.cloudflare.com/d1/) (SQL), [KV](https://developers.cloudflare.com/kv/) (key-value), [R2](https://developers.cloudflare.com/r2/) (objects), [Queues](https://developers.cloudflare.com/queues/) |

Most of these have a free allowance, so a free account goes a long way this afternoon. The Sandbox SDK runs on Containers, which need the Workers Paid plan.
