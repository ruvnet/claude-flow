#!/usr/bin/env node
// bench-agenticow.mjs — verify agenticow's published perf claims against ruflo's
// reality. Measures branch latency + size vs full-copy snapshot at N ∈ {1k, 10k, 100k}.
//
// Published claims (agenticow@0.2.3):
//   - "Branch in ~0.5ms / 162 bytes regardless of base size"
//   - "83x faster, 3000x smaller than full-copy snapshots"
//
// We measure both halves. CLAUDE.md source-of-truth rule: replace unverified
// perf numbers with measured ones; THIS is the measurement.
//
// Usage:
//   node scripts/bench-agenticow.mjs                       # default: 1k,10k,100k
//   node scripts/bench-agenticow.mjs --sizes 1000,5000     # custom
//   node scripts/bench-agenticow.mjs --dim 384             # custom dim (default 128)

import { open, openBase, AgenticMemory } from 'agenticow';
import { mkdirSync, rmSync, writeFileSync, statSync, copyFileSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { performance } from 'node:perf_hooks';
import { execSync } from 'node:child_process';

function parseArgs() {
  const args = { sizes: [1000, 10000, 100000], dim: 128, runs: 5 };
  for (let i = 2; i < process.argv.length; i++) {
    const a = process.argv[i];
    if (a === '--sizes') args.sizes = process.argv[++i].split(',').map(Number);
    else if (a.startsWith('--sizes=')) args.sizes = a.slice(8).split(',').map(Number);
    else if (a === '--dim') args.dim = Number(process.argv[++i]);
    else if (a.startsWith('--dim=')) args.dim = Number(a.slice(6));
    else if (a === '--runs') args.runs = Number(process.argv[++i]);
    else if (a.startsWith('--runs=')) args.runs = Number(a.slice(7));
  }
  return args;
}

function randVec(d) {
  const v = new Float32Array(d);
  for (let i = 0; i < d; i++) v[i] = Math.random() * 2 - 1;
  // L2-normalize (matches typical embedding output)
  let s = 0;
  for (let i = 0; i < d; i++) s += v[i] * v[i];
  s = Math.sqrt(s);
  if (s > 0) for (let i = 0; i < d; i++) v[i] /= s;
  return v;
}

function dirSize(path) {
  // Sum file sizes in a directory tree (where agenticow stores the .rvf bundle)
  if (!existsSync(path)) return 0;
  const st = statSync(path);
  if (st.isFile()) return st.size;
  let total = 0;
  for (const e of readdirSync(path)) total += dirSize(join(path, e));
  return total;
}

const ARGS = parseArgs();
const tmp = join(tmpdir(), `agenticow-bench-${Date.now()}`);
mkdirSync(tmp, { recursive: true });

const results = {
  schema: 1,
  bench: 'agenticow-vs-full-copy',
  agenticowVersion: JSON.parse(
    await import('node:fs').then(fs => fs.promises.readFile('node_modules/agenticow/package.json', 'utf8'))
  ).version,
  ts: new Date().toISOString(),
  dim: ARGS.dim,
  runsPerSize: ARGS.runs,
  bySize: {},
};

for (const N of ARGS.sizes) {
  console.error(`\n[bench] N=${N} dim=${ARGS.dim}`);
  const baseFile = join(tmp, `base-${N}.rvf`);

  // --- Build base memory ---
  const buildStart = performance.now();
  const base = await open(baseFile, { dimension: ARGS.dim });
  // Ingest in chunks to avoid huge intermediate arrays
  const CHUNK = 1000;
  for (let i = 0; i < N; i += CHUNK) {
    const chunkSize = Math.min(CHUNK, N - i);
    const chunk = [];
    for (let j = 0; j < chunkSize; j++) chunk.push({ id: i + j, vector: randVec(ARGS.dim) });
    base.ingest(chunk);
  }
  await base.close?.();
  const buildMs = performance.now() - buildStart;
  const baseBytes = dirSize(baseFile);
  console.error(`  base built: ${buildMs.toFixed(0)} ms, ${(baseBytes / 1024 / 1024).toFixed(1)} MB`);

  // --- Measure agenticow branch latency + size (RUNS times) ---
  // Open base ONCE — measuring fork() alone, not reopen overhead
  const cowBranchMs = [];
  const cowBranchBytes = [];
  const cowQueryMs = [];
  const baseForFork = await open(baseFile, { dimension: ARGS.dim });
  for (let r = 0; r < ARGS.runs; r++) {
    const branchPath = `${baseFile}.cow-${r}.rvf`;
    const t0 = performance.now();
    const branch = await baseForFork.fork(`branch-${r}`, branchPath);
    cowBranchMs.push(performance.now() - t0);
    cowBranchBytes.push(dirSize(branchPath));

    // Measure query latency through the COW chain (parent ∪ edits, child wins)
    const q = randVec(ARGS.dim);
    const qt0 = performance.now();
    await branch.query(q, 10);
    cowQueryMs.push(performance.now() - qt0);

    await branch.close?.();
  }
  await baseForFork.close?.();

  // --- Measure full-copy snapshot latency + size (RUNS times) ---
  const copyMs = [];
  const copyBytes = [];
  for (let r = 0; r < ARGS.runs; r++) {
    const copyPath = `${baseFile}.copy-${r}.rvf`;
    const t0 = performance.now();
    // Copy the .rvf bundle/file. If it's a directory, recursive copy.
    const st = statSync(baseFile);
    if (st.isFile()) {
      copyFileSync(baseFile, copyPath);
    } else {
      // recursive copy
      execSync(`cp -R ${JSON.stringify(baseFile)} ${JSON.stringify(copyPath)}`);
    }
    copyMs.push(performance.now() - t0);
    copyBytes.push(dirSize(copyPath));
  }

  const median = (arr) => {
    const s = [...arr].sort((a, b) => a - b);
    return s[Math.floor(s.length / 2)];
  };

  const cowBranchMsMedian = median(cowBranchMs);
  const cowBranchBytesMedian = median(cowBranchBytes);
  const copyMsMedian = median(copyMs);
  const copyBytesMedian = median(copyBytes);

  const entry = {
    n: N,
    baseBuildMs: Math.round(buildMs),
    baseBytes,
    agenticow: {
      branchMsMedian: Number(cowBranchMsMedian.toFixed(3)),
      branchMsAll: cowBranchMs.map(x => Number(x.toFixed(3))),
      branchBytesMedian: cowBranchBytesMedian,
      branchBytesAll: cowBranchBytes,
      queryMsMedian: Number(median(cowQueryMs).toFixed(3)),
      queryMsAll: cowQueryMs.map(x => Number(x.toFixed(3))),
    },
    fullCopy: {
      copyMsMedian: Number(copyMsMedian.toFixed(3)),
      copyBytesMedian: copyBytesMedian,
    },
    ratios: {
      speedup: Number((copyMsMedian / Math.max(cowBranchMsMedian, 0.001)).toFixed(2)),
      sizeReduction: Number((copyBytesMedian / Math.max(cowBranchBytesMedian, 1)).toFixed(2)),
    },
    publishedClaim: {
      branchMsTarget: 0.5,
      branchBytesTarget: 162,
      speedupClaim: 83,
      sizeReductionClaim: 3000,
    },
    verdict: {
      branchMsHit: cowBranchMsMedian <= 2.0,  // 4x tolerance vs 0.5ms claim
      branchBytesHit: cowBranchBytesMedian <= 1024,  // 6x tolerance vs 162 byte claim
      speedupHit: (copyMsMedian / Math.max(cowBranchMsMedian, 0.001)) >= 10,  // 10x is impressive; 83x is the claim
      sizeReductionHit: (copyBytesMedian / Math.max(cowBranchBytesMedian, 1)) >= 100,  // 100x is impressive; 3000x is the claim
    },
  };

  results.bySize[N] = entry;
  console.error(`  agenticow branch: ${cowBranchMsMedian.toFixed(2)} ms / ${cowBranchBytesMedian} bytes (claim: 0.5ms / 162B)`);
  console.error(`  agenticow query:  ${entry.agenticow.queryMsMedian} ms (top-10 through chain)`);
  console.error(`  full-copy:        ${copyMsMedian.toFixed(2)} ms / ${copyBytesMedian} bytes`);
  console.error(`  → speedup ${entry.ratios.speedup}x (claim 83x), size-reduction ${entry.ratios.sizeReduction}x (claim 3000x)`);
}

// Cleanup
try { rmSync(tmp, { recursive: true, force: true }); } catch { /* ignore */ }

// Emit machine-readable result
console.log('===AGENTICOW_BENCH_JSON===');
console.log(JSON.stringify(results));

// Also persist a copy to docs/benchmarks/runs/ for repo-level visibility
const runFile = `docs/benchmarks/runs/agenticow-vs-full-copy-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
try {
  writeFileSync(runFile, JSON.stringify(results, null, 2));
  console.error(`\nWrote ${runFile}`);
} catch (e) { console.error(`\n(could not write run file: ${e.message})`); }
