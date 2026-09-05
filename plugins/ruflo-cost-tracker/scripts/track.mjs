#!/usr/bin/env node
// cost-track — auto-capture token usage from a Claude Code session jsonl
// and persist a structured record to the `cost-tracking` AgentDB namespace.
//
// Resolution: by default reads the most-recently-modified session jsonl in
// ~/.claude/projects/<encoded-cwd>/. Override with TRACK_CWD or TRACK_SESSION.
//
// Optional env:
//   TRACK_CWD=<path>          override which project's sessions to scan
//   TRACK_SESSION=<file>      pin to a specific session jsonl
//   TRACK_OUT=<path>          also write the JSON summary to this path
//   TRACK_DRY_RUN=1           skip the memory_store call
//   TRACK_QUIET=1             suppress markdown summary
//   TRACK_NAMESPACE=<name>    override (default: cost-tracking)

import { readFileSync, writeFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { spawnNpxSync } from './_npx.mjs';
// iter 68 — shared PRICING table (was duplicated in counterfactual.mjs too).
import { modelTier, costForUsage } from './_prices.mjs';

const PROJECTS_DIR = join(homedir(), '.claude', 'projects');

function encodeProjectPath(cwd) {
  // #1927: Claude Code encodes an absolute path by replacing path separators
  // AND the Windows drive colon with `-`. So:
  //   POSIX:   /home/user/proj      -> -home-user-proj
  //   Windows: D:\project\Subcloudy -> D--project-Subcloudy   (`:` -> `-`, `\` -> `-`)
  // The old code only replaced `/`, a no-op on Windows paths.
  return cwd.replace(/[/\\:]/g, '-');
}

function findProjectDir(cwd) {
  const candidate = join(PROJECTS_DIR, encodeProjectPath(cwd));
  return existsSync(candidate) ? candidate : null;
}

function findActiveSession(projectDir) {
  const entries = readdirSync(projectDir)
    .filter((f) => f.endsWith('.jsonl'))
    .map((f) => ({ f, mtime: statSync(join(projectDir, f)).mtimeMs }))
    .sort((a, b) => b.mtime - a.mtime);
  return entries[0] ? join(projectDir, entries[0].f) : null;
}

function summarizeSession(jsonlPath) {
  const text = readFileSync(jsonlPath, 'utf-8');
  const lines = text.split('\n').filter(Boolean);
  const byModel = {};
  const byTier = { haiku: 0, sonnet: 0, opus: 0, unknown: 0 };
  let messageCount = 0, totalCost = 0;
  let firstTs = null, lastTs = null;
  let sessionId = null, cwd = null;

  for (const line of lines) {
    let m;
    try { m = JSON.parse(line); } catch { continue; }
    if (!sessionId && m.sessionId) sessionId = m.sessionId;
    if (!cwd && m.cwd) cwd = m.cwd;
    if (m.timestamp) {
      if (!firstTs || m.timestamp < firstTs) firstTs = m.timestamp;
      if (!lastTs || m.timestamp > lastTs) lastTs = m.timestamp;
    }
    if (m.type !== 'assistant' || !m.message?.usage) continue;
    messageCount++;
    const model = m.message.model || 'unknown';
    const tier = modelTier(model);
    const u = m.message.usage;
    const cost = costForUsage(tier, u);
    const slot = byModel[model] || {
      tier,
      input_tokens: 0, output_tokens: 0,
      cache_creation_input_tokens: 0, cache_read_input_tokens: 0,
      messages: 0, cost_usd: 0,
    };
    slot.input_tokens += u.input_tokens || 0;
    slot.output_tokens += u.output_tokens || 0;
    slot.cache_creation_input_tokens += u.cache_creation_input_tokens || 0;
    slot.cache_read_input_tokens += u.cache_read_input_tokens || 0;
    slot.messages++;
    slot.cost_usd += cost;
    byModel[model] = slot;
    byTier[tier] += cost;
    totalCost += cost;
  }

  return {
    sessionId, cwd, startedAt: firstTs, endedAt: lastTs,
    messageCount, byModel, byTier, total_cost_usd: totalCost,
    capturedAt: new Date().toISOString(),
  };
}

function persistToMemory(summary) {
  const ns = process.env.TRACK_NAMESPACE || 'cost-tracking';
  const key = `session-${summary.sessionId || 'unknown'}`;
  // ADR-100 / #1748 Issue 3 — opt into cli-core's lite path with CLI_CORE=1.
  // Cold-cache wall-time drops from ~25s to ~2s. JSON backend instead of
  // SQLite/HNSW; semantic search degrades to substring (fine for cost-track
  // which never invokes search — only store/list/retrieve). See
  // v3/@claude-flow/cli-core/MIGRATION.md.
  const cliPkg = process.env.CLI_CORE === '1'
    ? '@claude-flow/cli-core@alpha'
    : '@claude-flow/cli@latest';
  // spawnSync with explicit args avoids shell-escape pitfalls for the JSON value.
  const r = spawnNpxSync([
    cliPkg, 'memory', 'store',
    '--namespace', ns,
    '--key', key,
    '--value', JSON.stringify(summary),
  ], { stdio: ['ignore', 'pipe', 'pipe'], encoding: 'utf-8', shell: process.platform === 'win32' });
  if (r.status !== 0) {
    return { ok: false, reason: r.stderr?.slice(0, 300) || `exit ${r.status}` };
  }
  return { ok: true, namespace: ns, key };
}

function main() {
  const targetCwd = process.env.TRACK_CWD || process.cwd();
  const projectDir = findProjectDir(targetCwd);
  if (!projectDir) {
    console.error(`cost-track: no Claude Code project dir for cwd=${targetCwd}`);
    console.error(`looked under ${PROJECTS_DIR}/${encodeProjectPath(targetCwd)}`);
    process.exit(2);
  }
  const sessionPath = process.env.TRACK_SESSION || findActiveSession(projectDir);
  if (!sessionPath || !existsSync(sessionPath)) {
    console.error(`cost-track: no session jsonl in ${projectDir}`);
    process.exit(2);
  }

  const summary = summarizeSession(sessionPath);

  if (process.env.TRACK_OUT) {
    writeFileSync(process.env.TRACK_OUT, JSON.stringify(summary, null, 2));
  }

  let storeResult = { ok: false, reason: 'dry-run' };
  if (process.env.TRACK_DRY_RUN !== '1') {
    storeResult = persistToMemory(summary);
  }

  if (process.env.TRACK_QUIET === '1') return;

  console.log(`# cost-track — session ${(summary.sessionId || '').slice(0, 8) || 'unknown'}`);
  console.log('');
  console.log(`| Metric | Value |`);
  console.log(`|---|---:|`);
  console.log(`| Session ID | \`${summary.sessionId}\` |`);
  console.log(`| Project | \`${summary.cwd}\` |`);
  console.log(`| First message | ${summary.startedAt} |`);
  console.log(`| Last message | ${summary.endedAt} |`);
  console.log(`| Assistant messages | ${summary.messageCount} |`);
  console.log(`| **Total cost** | **$${summary.total_cost_usd.toFixed(6)}** |`);
  console.log(`| Persisted | ${storeResult.ok ? `\`${storeResult.namespace}:${storeResult.key}\`` : `**FAILED** (${storeResult.reason})`} |`);
  console.log('');
  console.log('## Per-model breakdown');
  console.log('');
  console.log('| Model | Tier | Messages | Input | Output | Cache write | Cache read | Cost |');
  console.log('|---|---|---:|---:|---:|---:|---:|---:|');
  for (const [m, s] of Object.entries(summary.byModel).sort((a, b) => b[1].cost_usd - a[1].cost_usd)) {
    console.log(`| \`${m}\` | ${s.tier} | ${s.messages} | ${s.input_tokens} | ${s.output_tokens} | ${s.cache_creation_input_tokens} | ${s.cache_read_input_tokens} | $${s.cost_usd.toFixed(6)} |`);
  }
  console.log('');
  console.log('## Per-tier breakdown');
  console.log('');
  console.log('| Tier | Cost |');
  console.log('|---|---:|');
  for (const [t, c] of Object.entries(summary.byTier).sort((a, b) => b[1] - a[1])) {
    if (c > 0) console.log(`| ${t} | $${c.toFixed(6)} |`);
  }
}

main();
