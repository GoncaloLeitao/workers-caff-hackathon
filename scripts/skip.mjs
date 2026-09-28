#!/usr/bin/env node
// Skip ahead: copy a finished version of a checkpoint into src/.
//
//   npm run skip:mcp       Checkpoint 2 done (src/mcp.ts)
//   npm run skip:agent     Checkpoint 3 done (src/agent.ts)
//   npm run skip:all       both
//   npm run skip:stretch   both, plus the stretch goals (refunds, memory, scheduling, table hopping)
//
// Your current file is backed up first, as src/<name>.ts.bak (or .bak-2, .bak-3, ... if that
// exists already), so skipping twice never overwrites your own work.

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

/** First free backup name: file.ts.bak, then file.ts.bak-2, file.ts.bak-3, ... */
function backupPath(target) {
  let path = `${target}.bak`;
  for (let n = 2; existsSync(path); n++) path = `${target}.bak-${n}`;
  return path;
}

for (const [from, to] of plan) {
  const source = join(root, from);
  const target = join(root, to);
  const current = existsSync(target) ? readFileSync(target, "utf8") : null;
  // Solutions import from "../src/..." (or "../../src/...") so they type-check where they live.
  // Inside src/ those imports become "./...".
  const code = readFileSync(source, "utf8").replace(/(["'])(?:\.\.\/)+src\//g, "$1./");
  if (current === code) {
    console.log(`• ${to} already has this finished version`);
    continue;
  }
  let backup = null;
  if (current !== null) {
    backup = backupPath(target);
    copyFileSync(target, backup);
  }
  writeFileSync(target, code);
  console.log(`✓ ${to} now has the finished version${backup ? ` (your old file is in ${backup.slice(root.length + 1)})` : ""}`);
}

console.log(`
Next:
  npm run dev       try it locally at http://localhost:8787
  npm run deploy    put it live (or git push, if you used the Deploy button)
`);
