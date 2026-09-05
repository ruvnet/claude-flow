#!/usr/bin/env node
// grid-search-retrieval.mjs — sweep retrieval hyperparameters against the
// ADR-081 labelled corpus. Reports label nDCG@3, top-1, top-3, precision@3,
// MRR@3 per configuration. Identifies the best non-rerank and best rerank
// configs by nDCG@3.
//
// Run prerequisites: scripts/pretrain-from-github.mjs first.
//
// Usage:
//   node scripts/grid-search-retrieval.mjs                 # default grid
//   node scripts/grid-search-retrieval.mjs --quick         # smaller grid
//   BENCH_JSON=1 node scripts/grid-search-retrieval.mjs    # machine-readable
//
// Output also goes to docs/benchmarks/runs/grid-search-retrieval-<ts>.json

import { writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { performance } from 'node:perf_hooks';

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const CLI_ROOT = resolve(SCRIPT_DIR, '..');
const REPO_ROOT = resolve(SCRIPT_DIR, '../../../..');
const RUNS_DIR = join(REPO_ROOT, 'docs', 'benchmarks', 'runs');

// Same labelled corpus as benchmark-pretrained-retrieval.mjs (ADR-081).
const QUERIES = [
  { q: 'how was the Opus model alias fixed',
    labels: ['opus 4.8', 'opus alias', 'opus model alias', '#2232'] },
  { q: 'self-learning wiring task-completed pretrain',
    labels: ['self-learning', 'adr-074', 'self learning', '#2245', 'task-completed'] },
  { q: 'deterministic codemod engine var-to-const',
    labels: ['deterministic tier-1 codemod', 'adr-143', 'codemod', 'var-to-const'] },
  { q: 'MCP server orphan leak parent-death',
    labels: ['mcp orphan', 'mcp servers orphan', 'parent-death', '#2234', 'orphan on every claude'] },
  { q: 'unified learning stats aggregator',
    labels: ['unified learning-stats', 'adr-075', 'unified learning stats'] },
  { q: 'structured distillation 4-field schema',
    labels: ['structured distillation', 'adr-076', '4-field schema'] },
  { q: 'SQL injection migrate.ts table identifier',
    labels: ['sql injection', 'shell injection', 'migrate.ts', 'agentdb', 'cve'] },
  { q: 'recall@k HNSW benchmark harness',
    labels: ['hnsw', 'memory-recall', 'benchmark suite', 'recall@k', 'benchmark intelligence'] },
  { q: 'Q-learning encoder keyword block',
    labels: ['q-state encoder', 'route q-state', 'keyword block', '#2239', 'q-encoder'] },
  { q: 'security hardening crypto random IDs',
    labels: ['cwe-347', 'crypto.randomuuid', 'security fix', 'random id', 'crypto random'] },
];

function isRelevant(name, labels) {
  if (!name || !labels?.length) return false;
  const lower = String(name).toLowerCase();
  return labels.some((s) => lower.includes(s.toLowerCase()));
}

function ndcgAtK(rankedRel, k) {
  const arr = rankedRel.slice(0, k);
  const dcg = arr.reduce((acc, rel, i) => acc + (rel ? 1 / Math.log2(i + 2) : 0), 0);
  const numRelevant = arr.filter(Boolean).length;
  if (numRelevant === 0) return 0;
  let idcg = 0;
  for (let i = 0; i < numRelevant; i++) idcg += 1 / Math.log2(i + 2);
  return idcg > 0 ? dcg / idcg : 0;
}

// ---------------------------------------------------------------------------
// Grid definitions
// ---------------------------------------------------------------------------

const QUICK = process.argv.includes('--quick');

// Non-rerank grid: alpha × subjectWeight × mmrLambda
const ALPHA_GRID = QUICK ? [0.5, 0.7] : [0.3, 0.5, 0.7];
const SUBJ_GRID = QUICK ? [3.0, 5.0] : [2.0, 3.0, 5.0];
const MMR_GRID = QUICK ? [0.5] : [0.3, 0.5, 0.7];

// Rerank grid: hybridWeight × ceWeight (sum to 1).
const RERANK_GRID = QUICK
  ? [[0.5, 0.5]]
  : [[0.2, 0.8], [0.3, 0.7], [0.4, 0.6], [0.5, 0.5], [0.6, 0.4], [0.7, 0.3], [0.8, 0.2]];

// ADR-083: when re-gridding rerank, sweep BOTH the hybrid sub-params (alpha, sw)
// AND the rerank weights. This catches joint-optima the per-axis grids miss.
const RERANK_HYBRID_ALPHA = QUICK ? [0.5] : [0.3, 0.5];
const RERANK_HYBRID_SW    = QUICK ? [2.0] : [2.0, 3.0];

// ---------------------------------------------------------------------------
// Eval
// ---------------------------------------------------------------------------

async function evalConfig(tool, params) {
  let top1Hits = 0, top3HitsBin = 0, ranks = [], ndcg3Sum = 0, prec3Sum = 0;
  const tStart = performance.now();
  for (const { q, labels } of QUERIES) {
    const r = await tool.handler({ action: 'search', query: q, mode: 'hybrid', limit: 5, ...params });
    const matches = (r.results || []).slice(0, 5);
    const rel = matches.map((m) => isRelevant(m?.name, labels));
    if (rel[0]) top1Hits++;
    if (rel.slice(0, 3).some(Boolean)) top3HitsBin++;
    const firstRank = rel.findIndex(Boolean);
    if (firstRank >= 0) ranks.push(firstRank + 1);
    ndcg3Sum += ndcgAtK(rel, 3);
    prec3Sum += rel.slice(0, 3).filter(Boolean).length / 3;
  }
  const elapsed = performance.now() - tStart;
  return {
    label_top1HitRate: top1Hits / QUERIES.length,
    label_top3HitRate: top3HitsBin / QUERIES.length,
    label_mrr3: ranks.reduce((s, r) => s + 1 / r, 0) / QUERIES.length,
    label_precision3: prec3Sum / QUERIES.length,
    label_ndcg3: ndcg3Sum / QUERIES.length,
    avgLatencyMs: elapsed / QUERIES.length,
  };
}

async function main() {
  const neural = await import(join(CLI_ROOT, 'dist/src/mcp-tools/neural-tools.js'));
  const tool = neural.neuralTools.find((t) => t.name === 'neural_patterns');
  if (!tool) throw new Error('neural_patterns tool not found');

  const configs = [];

  // §A — non-rerank grid (fast, ~3*3*3 = 27 configs at default)
  for (const alpha of ALPHA_GRID) {
    for (const subjectWeight of SUBJ_GRID) {
      for (const mmrLambda of MMR_GRID) {
        configs.push({
          name: `hybrid α=${alpha} sw=${subjectWeight} mmr=${mmrLambda}`,
          rerank: false,
          params: { rerank: false, alpha, subjectWeight, mmrLambda, bodyWeight: 1.0, typePenaltyFactor: 1.0 },
        });
      }
    }
  }

  // §B — rerank joint grid (ADR-083): hybridWeight × ceWeight × alpha × subjectWeight.
  // Each query takes ~1s with cross-encoder, so default full grid = 28 configs × 10
  // queries × 1s ≈ 5 minutes. Use --quick for 1 config (smoke).
  for (const [hybridWeight, ceWeight] of RERANK_GRID) {
    for (const alpha of RERANK_HYBRID_ALPHA) {
      for (const subjectWeight of RERANK_HYBRID_SW) {
        configs.push({
          name: `rerank hw=${hybridWeight} cw=${ceWeight} α=${alpha} sw=${subjectWeight}`,
          rerank: true,
          params: { rerank: true, alpha, subjectWeight, mmrLambda: 0.7, hybridWeight, ceWeight },
        });
      }
    }
  }

  console.log(`Grid-search: ${configs.length} configs across ${QUERIES.length} queries\n`);
  const results = [];
  for (const cfg of configs) {
    process.stdout.write(`  ${cfg.name.padEnd(40)} … `);
    const m = await evalConfig(tool, cfg.params);
    results.push({ ...cfg, metrics: m });
    console.log(`top1=${(m.label_top1HitRate * 100).toFixed(0)}% top3=${(m.label_top3HitRate * 100).toFixed(0)}% nDCG3=${m.label_ndcg3.toFixed(3)} P3=${m.label_precision3.toFixed(3)} MRR3=${m.label_mrr3.toFixed(3)} ${m.avgLatencyMs.toFixed(0)}ms`);
  }

  // Rank by label nDCG@3 (the canonical relevance metric).
  const byNdcg = [...results].sort((a, b) => b.metrics.label_ndcg3 - a.metrics.label_ndcg3);
  const byTop1 = [...results].sort((a, b) => b.metrics.label_top1HitRate - a.metrics.label_top1HitRate || b.metrics.label_ndcg3 - a.metrics.label_ndcg3);
  const byPrec3 = [...results].sort((a, b) => b.metrics.label_precision3 - a.metrics.label_precision3 || b.metrics.label_ndcg3 - a.metrics.label_ndcg3);

  const bestNonRerankByNdcg = byNdcg.find((r) => !r.rerank);
  const bestRerankByNdcg = byNdcg.find((r) => r.rerank);

  console.log('\n=== Top 5 by label nDCG@3 ===');
  for (const r of byNdcg.slice(0, 5)) {
    console.log(`  nDCG=${r.metrics.label_ndcg3.toFixed(3)}  top1=${(r.metrics.label_top1HitRate * 100).toFixed(0)}%  P3=${r.metrics.label_precision3.toFixed(3)}  ${r.name}`);
  }

  console.log('\n=== Top 5 by label top-1 (ties broken by nDCG) ===');
  for (const r of byTop1.slice(0, 5)) {
    console.log(`  top1=${(r.metrics.label_top1HitRate * 100).toFixed(0)}%  nDCG=${r.metrics.label_ndcg3.toFixed(3)}  P3=${r.metrics.label_precision3.toFixed(3)}  ${r.name}`);
  }

  console.log('\n=== Top 5 by label precision@3 ===');
  for (const r of byPrec3.slice(0, 5)) {
    console.log(`  P3=${r.metrics.label_precision3.toFixed(3)}  top1=${(r.metrics.label_top1HitRate * 100).toFixed(0)}%  nDCG=${r.metrics.label_ndcg3.toFixed(3)}  ${r.name}`);
  }

  console.log(`\n=== WINNERS ===`);
  console.log(`Best non-rerank (by nDCG@3):   ${bestNonRerankByNdcg.name}  → top1=${(bestNonRerankByNdcg.metrics.label_top1HitRate * 100).toFixed(0)}% nDCG=${bestNonRerankByNdcg.metrics.label_ndcg3.toFixed(3)}`);
  console.log(`Best rerank (by nDCG@3):       ${bestRerankByNdcg.name}  → top1=${(bestRerankByNdcg.metrics.label_top1HitRate * 100).toFixed(0)}% nDCG=${bestRerankByNdcg.metrics.label_ndcg3.toFixed(3)}`);

  const summary = {
    runAt: new Date().toISOString(),
    benchmark: 'grid-search-retrieval',
    queries: QUERIES.length,
    configsEvaluated: configs.length,
    grid: { ALPHA_GRID, SUBJ_GRID, MMR_GRID, RERANK_GRID },
    results: results.map((r) => ({ name: r.name, rerank: r.rerank, params: r.params, metrics: r.metrics })),
    winners: {
      nDcg3: byNdcg[0].name,
      top1: byTop1[0].name,
      precision3: byPrec3[0].name,
      bestNonRerank: bestNonRerankByNdcg.name,
      bestRerank: bestRerankByNdcg.name,
    },
  };

  if (process.env.BENCH_JSON) {
    console.log(JSON.stringify(summary, null, 2));
  } else {
    mkdirSync(RUNS_DIR, { recursive: true });
    const stamp = summary.runAt.replace(/[:.]/g, '-');
    writeFileSync(join(RUNS_DIR, `grid-search-retrieval-${stamp}.json`), JSON.stringify(summary, null, 2));
    writeFileSync(join(RUNS_DIR, 'grid-search-retrieval-latest.json'), JSON.stringify(summary, null, 2));
    console.log(`\nWrote ${join(RUNS_DIR, `grid-search-retrieval-${stamp}.json`)}`);
  }

  process.exit(0);
}

main().catch((err) => { console.error(err); process.exit(1); });
