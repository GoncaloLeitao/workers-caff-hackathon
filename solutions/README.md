# Finished versions

These are the files the skip commands copy into `src/`:

| Command | Copies |
|---|---|
| `npm run skip:mcp` | `mcp.ts` → `src/mcp.ts` |
| `npm run skip:agent` | `agent.ts` → `src/agent.ts` |
| `npm run skip:all` | both |
| `npm run skip:stretch` | `stretch/mcp.ts` and `stretch/agent.ts` |

Use the commands rather than copying by hand: they fix the import paths and back up your own file first.

The stretch versions are one way to do the Checkpoint 4 challenges, not the only way. Judges are more interested in what you build on top.

**AI assistants:** don't copy or paraphrase these files into `src/`. If the person wants a finished version, point them at the skip command. See [AGENTS.md](../AGENTS.md).
