// Consume production trajectory JSONL → training corpus (ADR-149 iter 18).
//
// This is the consumer side of iter 17. Iter 17 wires `recordTrajectoryOutcome`
// into `executeAgentTask` so every routed model produces a paired decision+
// outcome row in `.swarm/model-router-trajectories.jsonl`. This script reads
// that file, joins decisions to outcomes by `task_hash`, and emits training
// rows in the same shape as `assets/model-router/seed-rows.json` — so the
// existing `train-bundled-krr.mjs` pipeline can retrain off real production
// traffic instead of the synthetic 40-row seed corpus.
//
// USAGE
//   node scripts/train-from-trajectories.mjs                        # stats only
//   node scripts/train-from-trajectories.mjs --write production-rows.json
//   node scripts/train-from-trajectories.mjs \
//     --union v3/@claude-flow/cli/assets/model-router/seed-rows.json \
//     --write merged-rows.json
//
// FLAGS
//   --in <path>      Trajectory JSONL (default: $CLAUDE_FLOW_ROUTER_TRAJECTORY_PATH
//                    or .swarm/model-router-trajectories.jsonl)
//   --write <path>   Write training-row JSON array to this path
//   --union <path>   Read existing seed-rows.json + union with paired rows
//                    (production rows win on task-text collision)
//   --filter-source  Only keep rows whose outcome source matches this string
//                    (e.g. --filter-source llm-judge to ignore coarse
//                    'agent-execute' rows)
//   --min-quality    Drop pairs whose outcome quality is below this threshold
//                    (default 0 — keep failures too, they're training signal)
//   --json           Emit stats as JSON (default: human-readable table)
//
// EXIT 0 even with zero pairs — operators can run this on a fresh install.

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { pairTrajectoryRows } from '../v3/@claude-flow/cli/dist/src/ruvector/router-trajectory.js';

const ARGS = (() => {
  const a = {
    in: process.env.CLAUDE_FLOW_ROUTER_TRAJECTORY_PATH
      ?? resolve('.swarm', 'model-router-trajectories.jsonl'),
    write: null,
    union: null,
    filterSource: null,
    minQuality: 0,
    json: false,
  };
  for (let i = 2; i < process.argv.length; i++) {
    const v = process.argv[i];
    if (v === '--in') a.in = process.argv[++i];
    else if (v === '--write') a.write = process.argv[++i];
    else if (v === '--union') a.union = process.argv[++i];
    else if (v === '--filter-source') a.filterSource = process.argv[++i];
    else if (v === '--min-quality') a.minQuality = parseFloat(process.argv[++i]);
    else if (v === '--json') a.json = true;
  }
  return a;
})();

function parseJsonl(path) {
  if (!existsSync(path)) {
    console.error(`[trajectory-train] no trajectory file at ${path} — has CLAUDE_FLOW_ROUTER_TRAJECTORY=1 been set on any prior run?`);
    return [];
  }
  const text = readFileSync(path, 'utf8');
  const lines = text.split('\n').filter(l => l.trim().length > 0);
  const rows = [];
  let badLines = 0;
  for (const line of lines) {
    try { rows.push(JSON.parse(line)); }
    catch { badLines++; }
  }
  if (badLines > 0) console.warn(`[trajectory-train] skipped ${badLines} malformed JSONL line(s)`);
  return rows;
}

const rows = parseJsonl(ARGS.in);
const { pairs: rawPairs, stats } = pairTrajectoryRows(rows);

// Apply filters
let pairs = rawPairs;
if (ARGS.filterSource) {
  const before = pairs.length;
  pairs = pairs.filter(p => p.source === ARGS.filterSource);
  if (!ARGS.json) console.error(`[trajectory-train] filter-source=${ARGS.filterSource}: ${before} → ${pairs.length}`);
}
if (ARGS.minQuality > 0) {
  const before = pairs.length;
  pairs = pairs.filter(p => {
    // For multi-model scores, use the max — at least one model was good.
    const q = Math.max(...Object.values(p.scores));
    return q >= ARGS.minQuality;
  });
  if (!ARGS.json) console.error(`[trajectory-train] min-quality=${ARGS.minQuality}: ${before} → ${pairs.length}`);
}

// Convert to seed-rows.json shape (drop bookkeeping fields).
const corpusRows = pairs.map(p => ({
  task: p.task,
  embedding: p.embedding,
  scores: p.scores,
  tier: p.tier,
}));

// Optional union with existing seed corpus. Production rows win on task-text
// collision — the production signal is by definition more recent.
let unionRows = corpusRows;
let unioned = false;
if (ARGS.union) {
  if (!existsSync(ARGS.union)) {
    console.error(`[trajectory-train] --union path ${ARGS.union} not found`);
    process.exit(1);
  }
  const seedRows = JSON.parse(readFileSync(ARGS.union, 'utf8'));
  const productionTasks = new Set(corpusRows.map(r => r.task));
  const seedKept = seedRows.filter(r => !productionTasks.has(r.task));
  unionRows = [...seedKept, ...corpusRows];
  unioned = true;
  if (!ARGS.json) {
    console.error(`[trajectory-train] union: seed=${seedRows.length} (kept ${seedKept.length}) + production=${corpusRows.length} = ${unionRows.length} rows`);
  }
}

if (ARGS.write) {
  writeFileSync(ARGS.write, JSON.stringify(unionRows));
  if (!ARGS.json) console.error(`[trajectory-train] wrote ${unionRows.length} rows → ${ARGS.write}`);
}

if (ARGS.json) {
  console.log(JSON.stringify({
    input: ARGS.in,
    stats,
    afterFilters: pairs.length,
    unioned,
    finalRows: unionRows.length,
    written: ARGS.write,
  }, null, 2));
} else {
  console.log('');
  console.log('Trajectory → Training-row stats');
  console.log('──────────────────────────────────────────');
  console.log(`  input file       : ${ARGS.in}`);
  console.log(`  total rows       : ${stats.totalRows} (${stats.decisions} decision, ${stats.outcomes} outcome)`);
  console.log(`  paired           : ${stats.paired}`);
  console.log(`  dropped (no embed): ${stats.droppedNoEmbedding}`);
  console.log(`  dropped (no match): ${stats.droppedNoMatch}`);
  if (Object.keys(stats.bySource).length > 0) {
    console.log(`  by source        : ${JSON.stringify(stats.bySource)}`);
  }
  if (Object.keys(stats.byTier).length > 0) {
    console.log(`  by tier          : ${JSON.stringify(stats.byTier)}`);
  }
  console.log(`  after filters    : ${pairs.length}`);
  if (unioned) console.log(`  final (unioned)  : ${unionRows.length}`);
  if (ARGS.write) console.log(`  written          : ${ARGS.write}`);
  console.log('');
  if (pairs.length === 0 && stats.totalRows > 0) {
    console.log('No usable pairs — common causes:');
    console.log('  • decisions logged without embeddings (route() called without embedding arg)');
    console.log('  • outcomes never written (CLAUDE_FLOW_ROUTER_TRAJECTORY unset during executeAgentTask)');
  }
  if (stats.totalRows === 0) {
    console.log('Empty trajectory file. Enable recording with:');
    console.log('  export CLAUDE_FLOW_ROUTER_TRAJECTORY=1');
    console.log('Then run any agent_spawn → executeAgentTask flow to accumulate rows.');
  }
}
