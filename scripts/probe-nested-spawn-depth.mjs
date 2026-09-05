#!/usr/bin/env node
// scripts/probe-nested-spawn-depth.mjs
//
// Empirical probe of Claude Code's nested-subagent depth cap (announced 2026-06-09
// by Boris Cherny: "Capped at depth=5 to start"). Runs a fresh `claude -p` session,
// spawns ruflo-agent:nested-coordinator at L1, and that coordinator recursively
// spawns more nested-coordinators (L2, L3, ...) until either (a) some level's
// Agent-tool call returns an error, or (b) we reach L7 (one past the announced
// cap) and stop voluntarily.
//
// Output:
//   - prints the verbatim chain to stdout
//   - writes results to docs/probes/nested-spawn-depth-<ISO timestamp>.txt
//   - exits 0 on completion (regardless of observed cap); 1 only on infra failure
//
// Required state: ruflo-agent plugin cache must contain the nested-* agents
// (run `claude plugin details ruflo-agent` first — expect Agents (9) listed).

import { spawn } from 'node:child_process';
import { writeFileSync, mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';

const REPO_ROOT = resolve(import.meta.dirname, '..');
const OUT_DIR = join(REPO_ROOT, 'docs', 'probes');
const TEST_LIMIT = 7; // stop voluntarily one past the announced cap of 5
const BUDGET_USD = '3.00';

const RECURSIVE_PROCEDURE = `You are participating in an empirical test of Claude Code's nested-subagent depth cap.

YOU ARE AT LEVEL N (a number passed to you in this prompt; see "CURRENT LEVEL" below).

PROCEDURE — follow exactly, no narration:

1. If you do NOT have the Agent tool in your tool list, output ONLY one line:
   "level=N status=NO_AGENT_TOOL"
   and stop.

2. If N >= ${TEST_LIMIT}, output ONLY one line:
   "level=N status=TEST_LIMIT_HIT"
   and stop.

3. Otherwise, call the Agent tool ONCE with these exact parameters:
   - subagent_type: "nested-coordinator"
   - name: "L<N+1>"
   - description: "Depth probe L<N+1>"
   - prompt: THIS ENTIRE PROCEDURE, but with the line "CURRENT LEVEL: <N>" rewritten as "CURRENT LEVEL: <N+1>"
   Do NOT set isolation or run_in_background.

4. When the child returns, output ONE LINE only:
   "level=N spawn=ok child={ <verbatim child output> }"
   or, if the Agent tool itself returned an error:
   "level=N spawn=FAILED error={ <verbatim error message> }"

No prose, no markdown, no headers. Exactly one line. The verbatim child output may contain its own
"level=" lines — that is expected and desired (it's how we measure depth).

CURRENT LEVEL: 1`;

const ROOT_PROMPT = `Empirical probe: nested-subagent depth cap. Spawn ONE sub-agent and report its result verbatim.

Use the Agent tool with EXACTLY these parameters:
  subagent_type: "nested-coordinator"
  name: "L1"
  description: "Depth probe L1"
  prompt: (the procedure shown below — pass it verbatim)

When the L1 agent returns, output its result prefixed with "FINAL: " on its own line. No other prose.

--- PROCEDURE TO PASS TO L1 ---
${RECURSIVE_PROCEDURE}
--- END PROCEDURE ---`;

console.log('=== Nested-subagent depth probe ===');
console.log(`Test limit: ${TEST_LIMIT} (one past announced cap of 5)`);
console.log(`Budget cap: $${BUDGET_USD}`);
console.log('Running `claude -p` ... (1–3 minutes typical)\n');

const startedAt = new Date();
const args = [
  '-p',
  '--max-budget-usd', BUDGET_USD,
  '--model', 'claude-haiku-4-5',
  '--output-format', 'text',
  ROOT_PROMPT,
];

const stdoutChunks = [];
const stderrChunks = [];
const child = spawn('claude', args, { stdio: ['ignore', 'pipe', 'pipe'] });
child.stdout.on('data', (b) => {
  stdoutChunks.push(b);
  process.stdout.write(b);
});
child.stderr.on('data', (b) => stderrChunks.push(b));

const exitCode = await new Promise((res) => {
  child.on('close', res);
  child.on('error', () => res(-1));
});

const stdout = Buffer.concat(stdoutChunks).toString('utf-8');
const stderr = Buffer.concat(stderrChunks).toString('utf-8');
const finishedAt = new Date();

// Parse the chain. Count nested "level=N spawn=ok" → depth+1 successes.
const okMatches = [...stdout.matchAll(/level=(\d+)\s+spawn=ok/g)].map((m) => Number(m[1]));
const failMatches = [...stdout.matchAll(/level=(\d+)\s+spawn=FAILED\s+error=\{\s*([^\n}]+)\s*\}/g)];
const noToolMatches = [...stdout.matchAll(/level=(\d+)\s+status=NO_AGENT_TOOL/g)].map((m) => Number(m[1]));
const limitHitMatches = [...stdout.matchAll(/level=(\d+)\s+status=TEST_LIMIT_HIT/g)].map((m) => Number(m[1]));

const deepestOk = okMatches.length ? Math.max(...okMatches) : null;
const firstFailure = failMatches.length
  ? { level: Number(failMatches[0][1]), error: failMatches[0][2] }
  : null;
const noTool = noToolMatches.length ? Math.min(...noToolMatches) : null;
const testLimitHit = limitHitMatches.length ? Math.max(...limitHitMatches) : null;

let verdict;
if (noTool !== null) {
  verdict = `INCONCLUSIVE — Agent tool was missing at level=${noTool}. Likely the tools: [Task] frontmatter is not being honored by this CLI build, or the cache stage didn't include the agent file at that level.`;
} else if (testLimitHit !== null) {
  verdict = `CAP NOT REACHED — chain ran to test limit (level=${testLimitHit}); the runtime cap is at least ${testLimitHit}. Re-run with a higher TEST_LIMIT to find it.`;
} else if (firstFailure) {
  // deepest_ok + 1 == first failing spawn. The failing level tried to spawn and failed,
  // so the runtime allowed spawning UP TO firstFailure.level, but not BEYOND.
  verdict = `CAP OBSERVED at depth=${firstFailure.level} (level ${firstFailure.level} could not spawn level ${firstFailure.level + 1}). Error: ${firstFailure.error}`;
} else if (deepestOk !== null) {
  verdict = `Chain partially completed — deepest successful spawn reported at level=${deepestOk}. No explicit refusal seen; child may have hallucinated success or output was truncated.`;
} else {
  verdict = `NO RECURSIVE OUTPUT detected. The root spawn likely never returned a structured chain. Inspect raw output below.`;
}

mkdirSync(OUT_DIR, { recursive: true });
const stamp = startedAt.toISOString().replace(/[:.]/g, '-');
const outFile = join(OUT_DIR, `nested-spawn-depth-${stamp}.txt`);
const report = [
  '=== Nested-subagent depth probe — empirical result ===',
  `started: ${startedAt.toISOString()}`,
  `finished: ${finishedAt.toISOString()}`,
  `duration_ms: ${finishedAt - startedAt}`,
  `exit_code: ${exitCode}`,
  `cli_command: claude ${args.slice(0, -1).join(' ')} <prompt>`,
  '',
  '--- VERDICT ---',
  verdict,
  '',
  `okMatches (levels that successfully spawned): ${JSON.stringify(okMatches)}`,
  `failMatches: ${JSON.stringify(failMatches.map((m) => ({ level: Number(m[1]), error: m[2] })))}`,
  `noToolMatches: ${JSON.stringify(noToolMatches)}`,
  `testLimitHit: ${JSON.stringify(limitHitMatches)}`,
  '',
  '--- RAW STDOUT ---',
  stdout,
  '',
  '--- RAW STDERR ---',
  stderr,
].join('\n');

writeFileSync(outFile, report, 'utf-8');

console.log('\n=== VERDICT ===');
console.log(verdict);
console.log(`\nFull report: ${outFile}`);
process.exit(0);
