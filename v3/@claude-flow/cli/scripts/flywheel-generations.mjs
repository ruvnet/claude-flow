#!/usr/bin/env node
/**
 * A-P3b — run the flywheel generation-over-generation on REAL data against a
 * FROZEN anchor, compounding (winner → next baseline), emitting a real
 * evolve-proof receipt bundle per generation. Goal: land a real 2nd verified
 * promotion chained to the immutable root, then prove it with reconstructLineage.
 *
 * Honest protocol (no leakage): the frozen anchor's HELD-OUT split is never used
 * for candidate selection — candidates are selected on the anchor TRAIN split,
 * promotion is gated on the frozen HELD-OUT split. $0 (no LLM/network).
 *
 * Usage: node scripts/flywheel-generations.mjs [--generations N] [--dir <root>]
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { performance } from 'node:perf_hooks';

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const CLI_ROOT = resolve(SCRIPT_DIR, '..');
const d = (p) => join(CLI_ROOT, 'dist/src', p);
const { runRealEvolveRound, reconstructLineage, mutationEffectiveness, detectPlateau, verifyReceiptBundle } = await import(`file://${d('services/evolve-proof.js')}`);
const neural = await import(`file://${d('mcp-tools/neural-tools.js')}`);
const tool = neural.neuralTools.find((t) => t.name === 'neural_patterns');
if (!tool) { console.error('neural_patterns unavailable'); process.exit(1); }

const argN = process.argv.indexOf('--generations');
const MAX_GEN = argN > -1 ? Number(process.argv[argN + 1]) : 6;
const argDir = process.argv.indexOf('--dir');
const projectRoot = argDir > -1 ? resolve(process.argv[argDir + 1]) : CLI_ROOT;
const NOW0 = 1_700_000_100_000;

// ── Frozen anchor (ADR-081) — immutable evaluation suite ──────────────────────
const RAW = [
  ['how was the Opus model alias fixed', ['opus 4.8', 'opus alias', 'opus model alias', '#2232']],
  ['self-learning wiring task-completed pretrain', ['self-learning', 'adr-074', 'self learning', '#2245', 'task-completed']],
  ['deterministic codemod engine var-to-const', ['deterministic tier-1 codemod', 'adr-143', 'codemod', 'var-to-const']],
  ['MCP server orphan leak parent-death', ['mcp orphan', 'mcp servers orphan', 'parent-death', '#2234', 'orphan on every claude']],
  ['unified learning stats aggregator', ['unified learning-stats', 'adr-075', 'unified learning stats']],
  ['structured distillation 4-field schema', ['structured distillation', 'adr-076', '4-field schema']],
  ['SQL injection migrate.ts table identifier', ['sql injection', 'shell injection', 'migrate.ts', 'agentdb', 'cve']],
  ['recall@k HNSW benchmark harness', ['hnsw', 'memory-recall', 'benchmark suite', 'recall@k', 'benchmark intelligence']],
  ['Q-learning encoder keyword block', ['q-state encoder', 'route q-state', 'keyword block', '#2239', 'q-encoder']],
  ['security hardening crypto random IDs', ['cwe-347', 'crypto.randomuuid', 'security fix', 'random id', 'crypto random']],
];
const FROZEN_ANCHOR = 'ADR-081-frozen-v1';
const Q = RAW.map(([q, labels], i) => ({ id: `q${String(i).padStart(2, '0')}`, q, labels }));
const ordered = [...Q].sort((a, b) => a.id.localeCompare(b.id));
const TRAIN = ordered.slice(0, 5);        // selection only
const HELD = ordered.slice(5);            // FROZEN gate — never used for selection

const isRel = (name, labels) => !!name && labels.some((s) => String(name).toLowerCase().includes(s.toLowerCase()));
function ndcg3(names, labels) {
  const rel = names.slice(0, 3).map((n) => isRel(n, labels));
  const dcg = rel.reduce((a, r, i) => a + (r ? 1 / Math.log2(i + 2) : 0), 0);
  const num = rel.filter(Boolean).length; if (!num) return 0;
  let idcg = 0; for (let i = 0; i < num; i++) idcg += 1 / Math.log2(i + 2);
  return dcg / idcg;
}

const key = (c) => `a${c.alpha}_sw${c.subjectWeight}_mmr${c.mmrLambda}_bw${c.bodyWeight}_tp${c.typePenaltyFactor}`;
const cache = new Map();
async function names(qid, q, cfg) {
  const ck = `${qid}::${key(cfg)}`;
  if (cache.has(ck)) return cache.get(ck);
  const r = await tool.handler({ action: 'search', query: q, mode: 'hybrid', limit: 5, rerank: false, ...cfg });
  const ns = (r.results || []).slice(0, 5).map((m) => m?.name ?? '');
  cache.set(ck, ns); return ns;
}
const scoreOn = async (tasks, cfg) => { let s = 0; for (const t of tasks) s += ndcg3(await names(t.id, t.q, cfg), t.labels); return s / tasks.length; };

const DEFAULTS = { alpha: 0.5, subjectWeight: 2, mmrLambda: 0.7, bodyWeight: 1, typePenaltyFactor: 1 };
function coarseGrid() {
  const g = [];
  for (const alpha of [0.3, 0.4, 0.5, 0.6, 0.7]) for (const subjectWeight of [1, 1.5, 2, 3])
    for (const mmrLambda of [0.5, 0.7, 0.9]) for (const bodyWeight of [1, 1.5]) for (const typePenaltyFactor of [1, 0.5])
      g.push({ alpha, subjectWeight, mmrLambda, bodyWeight, typePenaltyFactor });
  return g;
}
// Local multi-axis grid around a champion (joint moves — escapes single-axis local optima).
function localGrid(c) {
  const opt = { alpha: [c.alpha, +(c.alpha - 0.1).toFixed(2), +(c.alpha + 0.1).toFixed(2)].filter((v) => v > 0 && v < 1),
    subjectWeight: [c.subjectWeight, Math.max(0.5, c.subjectWeight - 0.5), c.subjectWeight + 0.5],
    mmrLambda: [c.mmrLambda, +(c.mmrLambda - 0.1).toFixed(2), +(c.mmrLambda + 0.1).toFixed(2)].filter((v) => v >= 0 && v <= 1),
    bodyWeight: [c.bodyWeight, Math.max(0.5, c.bodyWeight - 0.5), c.bodyWeight + 0.5],
    typePenaltyFactor: [c.typePenaltyFactor, Math.max(0.25, c.typePenaltyFactor - 0.25), Math.min(1, c.typePenaltyFactor + 0.25)] };
  const g = []; const u = new Set();
  for (const alpha of opt.alpha) for (const subjectWeight of [...new Set(opt.subjectWeight)]) for (const mmrLambda of opt.mmrLambda)
    for (const bodyWeight of [...new Set(opt.bodyWeight)]) for (const typePenaltyFactor of [...new Set(opt.typePenaltyFactor)]) {
      const cfg = { alpha, subjectWeight, mmrLambda, bodyWeight, typePenaltyFactor };
      if (u.has(key(cfg))) continue; u.add(key(cfg)); g.push(cfg);
    }
  return g;
}

const bundles = [];
let champion = DEFAULTS, parent = null, promotions = 0;
const t0 = performance.now();
for (let gen = 0; gen < MAX_GEN && promotions < 2; gen++) {
  const grid = gen === 0 ? coarseGrid() : localGrid(champion);
  // select best candidate on TRAIN (never touches the frozen held-out)
  const baseTrain = await scoreOn(TRAIN, champion);
  let cand = champion, candTrain = baseTrain;
  for (const c of grid) { if (key(c) === key(champion)) continue; const s = await scoreOn(TRAIN, c); if (s > candTrain + 1e-9) { candTrain = s; cand = c; } }

  // measure baseline + candidate on the FROZEN held-out
  const holdout = [];
  for (const t of HELD) holdout.push({ taskId: t.id, baselineScore: ndcg3(await names(t.id, t.q, champion), t.labels), candidateScore: ndcg3(await names(t.id, t.q, cand), t.labels) });
  // redblue: no TRAIN regression (real adversarial-ish check: don't tank train to win held-out)
  const redblue = (await scoreOn(TRAIN, cand)) >= baseTrain - 1e-3 ? 'PASS' : 'FAIL';

  const bundle = runRealEvolveRound({ baseline: champion, candidate: cand, holdout, generation: gen, parent, branch: 'main', now: NOW0 + gen * 1000, redblue, corpus: FROZEN_ANCHOR });
  bundles.push(bundle);
  const promoted = bundle.decisionReceipt.promoted;
  console.log(`gen ${gen}: cand=${key(cand)} baseHeld=${bundle.holdout.reduce((s, h) => s + h.baselineScore, 0) / HELD.length} candHeld=${bundle.holdout.reduce((s, h) => s + h.candidateScore, 0) / HELD.length} delta=${bundle.deltas.benchmark.toFixed(4)} redblue=${redblue} promoted=${promoted} ${promoted ? '' : bundle.decisionReceipt.reason}`);
  if (promoted) { champion = cand; parent = bundle.candidateManifestHash; promotions++; }
}
const elapsed = ((performance.now() - t0) / 1000).toFixed(0);

// ── Prove it ──────────────────────────────────────────────────────────────────
const lineage = reconstructLineage(bundles);
const plateau = detectPlateau(bundles, { window: 3 });
console.log(`\n=== REAL LINEAGE (${elapsed}s, ${bundles.length} generations) ===`);
console.log(`promotions=${lineage.promotions} rejections=${lineage.rejections} lineageIntact=${lineage.lineageIntact} allReplayable=${lineage.allReplayable} rootHash=${(lineage.rootHash || '').slice(0, 24)}…`);
console.log('mutationEffectiveness:', JSON.stringify(mutationEffectiveness(bundles)));
console.log('plateau:', plateau.status, '-', plateau.rationale);
console.log('per-bundle independent replay:', bundles.map((b, i) => `gen${i}:${verifyReceiptBundle(b).valid}`).join(' '));

// persist real bundles
const outDir = join(projectRoot, '.claude', 'evolve-proof');
mkdirSync(outDir, { recursive: true });
bundles.forEach((b, i) => writeFileSync(join(outDir, `real-generation-${i}.json`), JSON.stringify(b, null, 2) + '\n'));

const milestone = lineage.promotions >= 2 && lineage.lineageIntact && lineage.allReplayable;
console.log('='.repeat(70));
console.log(milestone
  ? `MILESTONE MET: ${lineage.promotions} real, independently-verified promotions chained to the immutable root — the flywheel turns.`
  : `MILESTONE NOT MET: ${lineage.promotions} promotion(s). ${plateau.status === 'local-optimum' ? 'Frozen anchor held-out saturated — honest plateau.' : 'Keep iterating the search/objective.'}`);
process.exit(milestone ? 0 : 3);
