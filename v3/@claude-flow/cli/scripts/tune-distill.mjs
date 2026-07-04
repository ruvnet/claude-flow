#!/usr/bin/env node
// tune-distill.mjs — ADR-174 Milestone 4 self-optimization harness
// ("ruflo tuning ruflo"). Grid-searches the memory-distillation config
// (batchSize x dedupDistance x promoteThreshold) and prints the grid table +
// winner + held-out score.
//
// Safety: this script NEVER touches the live DB with a write connection. It
// copies the source DB into its own scratch temp file BEFORE tuneDistillation
// ever sees a path — defense-in-depth on top of tuneDistillation's own
// internal per-candidate isolation (which only ever opens further copies of
// whatever dbPath it's handed).
//
// Usage:
//   node scripts/tune-distill.mjs                    # tune against a copy of .swarm/memory.db
//   node scripts/tune-distill.mjs --db <path>         # tune against a copy of a different source db
//   node scripts/tune-distill.mjs --write-config      # persist the winner to .claude-flow/distill-tuned.json
//   node scripts/tune-distill.mjs --quick             # smaller grid for a fast sanity run

import { mkdtempSync, copyFileSync, existsSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const CLI_ROOT = resolve(SCRIPT_DIR, '..');

const {
  tuneDistillation,
  buildTunedConfigFile,
  writeTunedConfigFile,
  defaultTunedConfigPath,
} = await import(join(CLI_ROOT, 'dist/src/services/distill-tuning.js'));
const { defaultMemoryDbPath } = await import(join(CLI_ROOT, 'dist/src/services/memory-distillation.js'));

function argValue(flag) {
  const i = process.argv.indexOf(flag);
  return i >= 0 && i + 1 < process.argv.length ? process.argv[i + 1] : undefined;
}

const sourceDb = argValue('--db') ?? defaultMemoryDbPath(process.cwd());
const writeConfig = process.argv.includes('--write-config');
const quick = process.argv.includes('--quick');

if (!existsSync(sourceDb)) {
  console.error(`tune-distill: no memory DB found at ${sourceDb}`);
  console.error('Pass --db <path> to point at a different source, or run inside a project with .swarm/memory.db');
  process.exit(1);
}

// Defense-in-depth: copy the live DB into a script-owned scratch temp file
// BEFORE tuneDistillation (or anything else in this process) ever sees the
// live path. Everything downstream only ever touches this copy — the live
// path is used exactly once, for fs.copyFileSync.
const workdir = mkdtempSync(join(tmpdir(), 'tune-distill-'));
const isolatedCopy = join(workdir, 'source-copy.db');
copyFileSync(sourceDb, isolatedCopy);
console.log(`tune-distill: tuning against an isolated copy of ${sourceDb}`);
console.log(`  -> ${isolatedCopy}\n`);

try {
  const grid = quick
    ? { batchSize: [200], dedupDistance: [0.1, 0.2], promoteThreshold: ['execution-only', 'execution+corroborated'] }
    : undefined; // undefined => tuneDistillation's own ADR-174 default grid

  const t0 = Date.now();
  const report = await tuneDistillation({ dbPath: isolatedCopy, grid, now: Date.now(), verbose: true });
  const elapsedMs = Date.now() - t0;

  console.log('\n=== Grid results ===');
  console.log(
    'batchSize | dedupDistance | promoteThreshold          | trainMRR@10 | trainRecall@10 | patterns | promoted',
  );
  for (const c of report.candidates) {
    const cfg = c.config;
    const row =
      `${String(cfg.batchSize).padEnd(9)} | ${String(cfg.dedupDistance).padEnd(13)} | ${cfg.promoteThreshold.padEnd(25)} | ` +
      `${c.trainScore.toFixed(4).padEnd(11)} | ${c.trainRecallAt10.toFixed(4).padEnd(14)} | ${String(c.patternCount).padEnd(8)} | ${c.promotedCount}`;
    console.log(row + (c.skipped ? `  [skipped: ${c.skipped}]` : ''));
  }

  console.log('\n=== Winner (best train MRR@10) ===');
  console.log(JSON.stringify(report.winner, null, 2));

  console.log('\n=== Held-out (scored once, on the true held-out ~20%) ===');
  console.log(JSON.stringify(report.heldOut, null, 2));
  console.log(`\noverfit flag (held-out >20% worse than train): ${report.overfit}`);

  console.log('\n=== Provenance ===');
  console.log(JSON.stringify(report.provenance, null, 2));
  console.log(`\nwall time: ${elapsedMs}ms for ${report.candidates.length} grid points`);

  if (writeConfig) {
    const outPath = defaultTunedConfigPath(process.cwd());
    writeTunedConfigFile(report, outPath);
    console.log(`\nwrote winning config -> ${outPath}`);
    console.log(JSON.stringify(buildTunedConfigFile(report), null, 2));
  }
} finally {
  rmSync(workdir, { recursive: true, force: true });
}
