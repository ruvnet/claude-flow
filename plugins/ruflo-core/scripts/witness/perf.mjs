#!/usr/bin/env node
/**
 * Performance verification — benchmark key user-visible capabilities and
 * append per-OS measurements to verification/<os>/performance.jsonl.
 *
 * Each entry is one capability×measurement at a single git commit. The
 * file is JSONL so a regression in install-time or CLI-startup gets
 * caught the same way `verify.mjs` catches a marker disappearing — by
 * comparing to the running baseline (median of last N) and flagging
 * deltas that exceed a threshold.
 *
 * Capabilities tracked
 * ────────────────────
 *   install_pack          how long `pnpm pack @claude-flow/memory` takes
 *   install_no_optional   how long `npm install <tarball> --omit=optional` takes
 *   memory_load           how long `import('@claude-flow/memory')` takes
 *   memory_round_trip     store + get on the auto-selected backend
 *   witness_verify        how long `verify.mjs --manifest` takes
 *
 * Each measurement records:
 *   { v, commit, issuedAt, os, capability, durationMs, metadata }
 *
 * Usage:
 *   node plugins/ruflo-core/scripts/witness/perf.mjs \
 *     --output verification/<os>/performance.jsonl
 *
 *   --capabilities install_pack,memory_load   # subset
 *   --baseline                                # compare against last 5 entries
 *   --json                                    # machine-readable output
 */

import { writeFileSync, appendFileSync, readFileSync, existsSync, mkdtempSync, rmSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { osDir } from './lib.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));

const args = parseArgs(process.argv.slice(2));
if (args.help) {
  console.log(readFileSync(new URL(import.meta.url), 'utf8').split('\n').filter(l => l.startsWith(' *')).map(l => l.slice(3)).join('\n'));
  process.exit(0);
}

const REPO_ROOT = resolve(args.root ?? process.cwd());
const OUTPUT = args.output ? resolve(args.output) : join(REPO_ROOT, 'verification', osDir(), 'performance.jsonl');
const ASJSON = !!args.json;
const COMPARE_BASELINE = !!args.baseline;
const ENABLED = (args.capabilities ?? 'install_pack,install_no_optional,memory_load,memory_round_trip,witness_verify').split(',').map(s => s.trim()).filter(Boolean);

const gitCommit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: REPO_ROOT }).toString().trim();
const issuedAt = new Date().toISOString();
const os = osDir();

// ─── benchmark runners ─────────────────────────────────────────
const runners = {
  install_pack: () => bench(() => {
    // execFileSync with array args prevents shell injection (CWE-78).
    execFileSync('pnpm', ['pack', '--pack-destination', tmpdir()], {
      cwd: join(REPO_ROOT, 'v3/@claude-flow/memory'),
      stdio: 'pipe',
    });
  }),

  install_no_optional: () => {
    const dir = mkdtempSync(join(tmpdir(), 'perf-install-'));
    const tarball = execFileSync('pnpm', ['pack', '--pack-destination', dir], {
      cwd: join(REPO_ROOT, 'v3/@claude-flow/memory'),
      stdio: 'pipe',
    }).toString().trim().split('\n').filter(l => l.endsWith('.tgz')).pop();
    if (!tarball) throw new Error('pnpm pack produced no tarball');
    execFileSync('npm', ['init', '-y'], { cwd: dir, stdio: 'pipe' });
    execFileSync('npm', ['pkg', 'set', 'type=module'], { cwd: dir, stdio: 'pipe' });
    const ms = bench(() => {
      // Pass tarball path as a discrete argument — no shell quoting needed.
      execFileSync('npm', ['install', tarball, '--omit=optional', '--no-audit', '--no-fund'], { cwd: dir, stdio: 'pipe' });
    });
    rmSync(dir, { recursive: true, force: true });
    return ms;
  },

  memory_load: () => {
    return bench(() => {
      // Spawn a fresh node process so import is truly cold.
      spawnSync(process.execPath, ['-e', "import('@claude-flow/memory').then(()=>{}).catch(e=>{process.exit(1)})"], {
        cwd: REPO_ROOT,
        stdio: 'pipe',
      });
    });
  },

  memory_round_trip: () => {
    const dbPath = join(tmpdir(), `perf-mem-${Date.now()}.db`);
    const ms = bench(() => {
      const r = spawnSync(process.execPath, ['-e', `
        const m = await import('@claude-flow/memory');
        const db = await m.createDatabase('${dbPath}', { provider: 'auto' });
        await db.initialize();
        const ts = Date.now();
        await db.store({ id: 'p1', key: 'k', content: 'v', type: 'episodic', namespace: 'd',
          tags: [], metadata: {}, accessLevel: 'private',
          createdAt: ts, updatedAt: ts, version: 1, references: [], accessCount: 0, lastAccessedAt: ts });
        await db.get('p1');
        await db.shutdown?.();
      `], { cwd: REPO_ROOT, stdio: 'pipe' });
      if (r.status !== 0) throw new Error('memory_round_trip failed: ' + r.stderr?.toString());
    });
    try { rmSync(dbPath, { force: true }); } catch { /* */ }
    return ms;
  },

  witness_verify: () => {
    const manifest = join(REPO_ROOT, 'verification', os, 'manifest.md.json');
    if (!existsSync(manifest)) return null;
    return bench(() => {
      // Use execFileSync so paths with spaces or special chars are safe (CWE-78).
      execFileSync(process.execPath, [join(__dirname, 'verify.mjs'), '--manifest', manifest, '--json'], {
        cwd: REPO_ROOT, stdio: 'pipe',
      });
    });
  },
};

// ─── bench helper ───────────────────────────────────────────────
function bench(fn) {
  const start = process.hrtime.bigint();
  try { fn(); } catch (e) {
    return { error: e.message ?? String(e), durationMs: null };
  }
  const ms = Number((process.hrtime.bigint() - start) / 1_000_000n);
  return { durationMs: ms };
}

// ─── baseline comparison ────────────────────────────────────────
function loadBaseline(capability) {
  if (!existsSync(OUTPUT)) return null;
  const lines = readFileSync(OUTPUT, 'utf8').split('\n').filter(Boolean);
  const recent = lines.map(l => JSON.parse(l)).filter(e => e.capability === capability && e.durationMs != null).slice(-5);
  if (recent.length < 3) return null;
  const sorted = [...recent].sort((a, b) => a.durationMs - b.durationMs);
  return sorted[Math.floor(sorted.length / 2)].durationMs; // median
}

// ─── run ─────────────────────────────────────────────────────────
const results = [];
for (const cap of ENABLED) {
  if (!runners[cap]) {
    if (!ASJSON) console.error(`unknown capability: ${cap}`);
    continue;
  }
  if (!ASJSON) console.error(`benchmarking: ${cap}`);
  const r = runners[cap]();
  if (r === null) continue; // skipped
  const baseline = COMPARE_BASELINE ? loadBaseline(cap) : null;
  const entry = {
    v: 1,
    commit: gitCommit,
    issuedAt,
    os,
    capability: cap,
    ...r,
    ...(baseline != null && r.durationMs != null
      ? { baselineMs: baseline, deltaPct: Math.round(((r.durationMs - baseline) / baseline) * 100) }
      : {}),
  };
  results.push(entry);
  appendFileSync(OUTPUT, JSON.stringify(entry) + '\n');
}

// ─── report ─────────────────────────────────────────────────────
if (ASJSON) {
  console.log(JSON.stringify({ commit: gitCommit, os, results }, null, 2));
} else {
  console.log(`\nperf summary (commit=${gitCommit.slice(0, 12)}, os=${os})`);
  console.log('─'.repeat(60));
  for (const r of results) {
    const dur = r.durationMs != null ? `${r.durationMs}ms`.padStart(10) : 'error'.padStart(10);
    const delta = r.deltaPct != null ? ` (${r.deltaPct >= 0 ? '+' : ''}${r.deltaPct}% vs baseline)` : '';
    const err = r.error ? `  ERROR: ${r.error}` : '';
    console.log(`  ${r.capability.padEnd(22)} ${dur}${delta}${err}`);
  }
  console.log(`\nappended: ${OUTPUT}`);
}

const failed = results.filter(r => r.error);
process.exit(failed.length > 0 ? 1 : 0);

// ─── arg parser ─────────────────────────────────────────────────
function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--baseline' || a === '--json' || a === '--help') { out[a.slice(2)] = true; continue; }
    if (a.startsWith('--')) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next && !next.startsWith('--')) { out[key] = next; i++; }
      else { out[key] = true; }
    }
  }
  return out;
}
