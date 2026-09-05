#!/usr/bin/env node
// cost-outcome — thin wrapper around `hooks model-outcome` so cost-optimize
// recommendations can be emitted as pre-formatted shell commands. The agent
// (or human) runs this once per applied recommendation and the router learns.
//
// Usage:
//   node scripts/outcome.mjs <task-description> <model> <outcome>
//     outcome ∈ { success, escalated, failure }
//
// Example:
//   node scripts/outcome.mjs "format imports" haiku success
//   node scripts/outcome.mjs "design auth flow" sonnet escalated
//
// Why a wrapper: `hooks model-outcome` takes `-t -m -o` and quoting through
// shell pipelines is error-prone. This script uses spawnSync with explicit
// argv so a task description with quotes/newlines is preserved.

import { spawnNpxSync } from './_npx.mjs';

const ALLOWED = new Set(['success', 'escalated', 'failure']);

function main() {
  const [task, model, outcome] = process.argv.slice(2);
  if (!task || !model || !outcome) {
    console.error('usage: outcome.mjs <task-description> <model> <outcome>');
    console.error('  outcome ∈ {success, escalated, failure}');
    process.exit(2);
  }
  if (!ALLOWED.has(outcome)) {
    console.error(`invalid outcome '${outcome}' — must be one of: success, escalated, failure`);
    process.exit(2);
  }
  const r = spawnNpxSync([
    '@claude-flow/cli@latest', 'hooks', 'model-outcome',
    '-t', task, '-m', model, '-o', outcome,
  ], { stdio: 'inherit', shell: process.platform === 'win32' });
  if (r.status !== 0) {
    console.error(`emit failed (exit ${r.status})`);
    process.exit(r.status || 1);
  }
}

main();
