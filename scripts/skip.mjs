#!/usr/bin/env node
// Skip ahead: copy a finished version of a checkpoint into src/.
//
//   npm run skip:mcp       Checkpoint 2 done (src/mcp.ts)
//   npm run skip:agent     Checkpoint 3 done (src/agent.ts)
//   npm run skip:all       both
//   npm run skip:stretch   both, plus the stretch goals (refunds, memory, scheduling, table hopping)
//
// Your current file is backed up to src/<name>.ts.bak first, so nothing is lost.

import { copyFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const plans = {
  mcp: [["solutions/mcp.ts", "src/mcp.ts"]],
  agent: [["solutions/agent.ts", "src/agent.ts"]],
  all: [
    ["solutions/mcp.ts", "src/mcp.ts"],
    ["solutions/agent.ts", "src/agent.ts"]
  ],
  stretch: [
    ["solutions/stretch/mcp.ts", "src/mcp.ts"],
    ["solutions/stretch/agent.ts", "src/agent.ts"]
  ]
};

const which = process.argv[2];
const plan = plans[which];
if (!plan) {
  console.error(`Usage: node scripts/skip.mjs <${Object.keys(plans).join("|")}>`);
  process.exit(1);
}

for (const [from, to] of plan) {
  const source = join(root, from);
  const target = join(root, to);
  if (existsSync(target)) copyFileSync(target, `${target}.bak`);
  // Solutions import from "../src/..." (or "../../src/...") so they type-check where they live.
  // Inside src/ those imports become "./...".
  const code = readFileSync(source, "utf8").replace(/(["'])(?:\.\.\/)+src\//g, "$1./");
  writeFileSync(target, code);
  console.log(`✓ ${to} now has the finished version (your old file is in ${to}.bak)`);
}

console.log(`
Next:
  npm run dev       try it locally at http://localhost:8787
  npm run deploy    put it live (or git push, if you used the Deploy button)
`);
