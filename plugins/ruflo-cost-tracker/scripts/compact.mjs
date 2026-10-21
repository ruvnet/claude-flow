#!/usr/bin/env node
// cost-compact — wraps getTokenOptimizer().getCompactContext() so the
// cost-compact-context skill can invoke a single command instead of an
// inlined Node one-liner.
//
// Resolution strategy (#1930): pnpm-workspace marketplace installs don't
// hoist `@claude-flow/integration` into `v3/node_modules/`. The resolved
// module is imported, so it never comes from the cwd (the project). Try:
//   1. createRequire(script-dir)    — works when run from inside the plugin
//   2. absolute path from this file — works on the marketplace layout
//      (script lives at <ruflo>/plugins/ruflo-cost-tracker/scripts/, the
//       integration package at <ruflo>/v3/@claude-flow/integration/)
//
// Also: agentic-flow's index.js binds `process.env.HEALTH_PORT || 8080`
// unconditionally on import. On any host with something already on 8080
// (k8s NodePort, forwarded dev server) the import EADDRINUSEs. Set
// HEALTH_PORT to 0 by default so the OS picks a free port — users can
// still override with an explicit value.
//
// Usage:
//   node scripts/compact.mjs "<query>"
//
// Optional env:
//   COMPACT_QUIET=1   emit JSON only (no markdown banner)
//   HEALTH_PORT=<n>   override agentic-flow's health-server port (default 0)

import { createRequire } from 'node:module';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { join, resolve, dirname, isAbsolute } from 'node:path';
import { existsSync } from 'node:fs';

// #1930 step 4: pick a free port unless caller pinned one. Set BEFORE the
// dynamic import below — agentic-flow reads HEALTH_PORT at module-load time.
if (!process.env.HEALTH_PORT) process.env.HEALTH_PORT = '0';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

function tryResolveFrom(anchorPath) {
  try {
    const req = createRequire(anchorPath);
    return req.resolve('@claude-flow/integration/token-optimizer');
  } catch {
    return null;
  }
}

function tryAbsolutePath() {
  // Walk up from this script looking for `v3/@claude-flow/integration/dist/token-optimizer.js`.
  // Handles the marketplace layout (script at plugins/ruflo-cost-tracker/scripts/) and the
  // dev-repo layout. Caps depth at 6 to avoid runaway traversal.
  let dir = __dirname;
  for (let i = 0; i < 6; i++) {
    const candidate = join(dir, 'v3', '@claude-flow', 'integration', 'dist', 'token-optimizer.js');
    if (existsSync(candidate)) return candidate;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

async function main() {
  const query = process.argv[2] || '';
  if (!query) {
    console.error('usage: compact.mjs "<query>"');
    process.exit(2);
  }

  // Resolution chain — script dir → absolute fallback (#1930 step 5). Not the
  // cwd: the module found here is imported, and the cwd is the project.
  const candidates = [
    tryResolveFrom(join(__dirname, 'package.json')),
    tryAbsolutePath(),
  ].filter(Boolean);

  let mod;
  let lastErr = null;
  for (const resolved of candidates) {
    try {
      // Skip dangling resolutions that point at a non-existent file (a
      // common pnpm-workspace symptom when dist/ wasn't built — see
      // #1930 step 1).
      const abs = isAbsolute(resolved) ? resolved : resolve(resolved);
      if (!existsSync(abs)) {
        lastErr = new Error(`token-optimizer.js missing at ${abs} — run \`cd v3/@claude-flow/integration && pnpm run build\` (#1930 step 1)`);
        continue;
      }
      mod = await import(pathToFileURL(abs).href);
      break;
    } catch (err) {
      lastErr = err;
    }
  }

  if (!mod) {
    const reason = lastErr
      ? String(lastErr.message || lastErr).slice(0, 300)
      : 'Cannot find module @claude-flow/integration/token-optimizer';
    const out = {
      bridgeUnavailable: true,
      reason,
      memoriesRetrieved: 0,
      tokensSaved: 0,
      agenticFlowAvailable: false,
      hint: 'Tried the script dir and the absolute path from this script — see #1930 for full troubleshooting.',
    };
    if (process.env.COMPACT_QUIET === '1') return console.log(JSON.stringify(out));
    console.log(`# cost-compact-context\n\nbridge unavailable: ${reason}`);
    console.log('');
    console.log('Tried:');
    console.log('  - resolve from cwd');
    console.log('  - resolve from script dir');
    console.log('  - absolute path walk from this script (looking for v3/@claude-flow/integration/dist/token-optimizer.js)');
    console.log('');
    console.log('If `@claude-flow/integration` is installed but `dist/` is missing, run:');
    console.log('  cd v3/@claude-flow/integration && pnpm run build');
    return;
  }

  const { getTokenOptimizer } = mod;
  const opt = await getTokenOptimizer();
  const ctx = await opt.getCompactContext(query);
  const stats = opt.getStats();

  const out = {
    query,
    memoriesRetrieved: ctx.memories?.length ?? 0,
    tokensSaved: ctx.tokensSaved ?? 0,
    agenticFlowAvailable: !!stats?.agenticFlowAvailable,
    cacheHitRate: stats?.cacheHitRate || '0%',
    upstreamReported: 'tokensSaved is bridge-reported (heuristic), not measured against a no-RAG baseline',
  };

  if (process.env.COMPACT_QUIET === '1') return console.log(JSON.stringify(out));
  console.log(`# cost-compact-context — query: "${query}"`);
  console.log('');
  console.log('| Metric | Value |');
  console.log('|---|---:|');
  console.log(`| Memories retrieved | ${out.memoriesRetrieved} |`);
  console.log(`| Tokens saved (bridge-reported) | ${out.tokensSaved} |`);
  console.log(`| agentic-flow bridge available | ${out.agenticFlowAvailable} |`);
  console.log(`| Cache hit rate | ${out.cacheHitRate} |`);
  console.log('');
  console.log(`> ${out.upstreamReported}`);
  if (!out.agenticFlowAvailable) {
    console.log('');
    console.log('agentic-flow not installed — bridge returns inert results. No compact-context savings.');
  }
}

main().catch((e) => { console.error('compact.mjs failed:', e.message || e); process.exit(1); });
