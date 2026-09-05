#!/usr/bin/env node
// run-beir-rrf-ablation.mjs — RRF weight/k ablation matrix on a single
// BEIR dataset (ADR-087).
//
// Pre-requisite: BGE doc embeddings cached at <dataset>/bge-cache/
// (run scripts/run-beir-bge.mjs first).
//
// Reports:
//   - Fixed default: k=60, equal weights (the headline number we ship)
//   - Ablations: k=30/60/120 × weights (0.8/1.0, 1.0/1.0, 1.2/0.8 dense/bm25)
//   - Bootstrap 95% CI on the fixed-default config only
//
// Usage:
//   cd /tmp/beir-nfcorpus
//   node /path/to/scripts/run-beir-rrf-ablation.mjs
//   cd /tmp/beir-scifact
//   BEIR_DATA_DIR=/tmp/beir-scifact/scifact node /path/to/scripts/run-beir-rrf-ablation.mjs

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { performance } from 'node:perf_hooks';

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const CLI_ROOT = resolve(SCRIPT_DIR, '..');
const RUFLO_ROOT = resolve(SCRIPT_DIR, '../../../..');
const RUNS_DIR = join(RUFLO_ROOT, 'docs', 'benchmarks', 'runs');

const DATA_DIR = process.env.BEIR_DATA_DIR || '/tmp/beir-nfcorpus/nfcorpus';
const BGE_MODEL = process.env.BGE_MODEL || 'Xenova/bge-base-en-v1.5';
const CACHE_DIR = join(dirname(DATA_DIR), 'bge-cache');

const BASELINES = {
  nfcorpus: { 'BM25': 0.325, 'BGE-large-pub': 0.380, 'SPLADE++': 0.347 },
  scifact:  { 'BM25': 0.679, 'BGE-large-pub': 0.722, 'SPLADE++': 0.704 },
};
function detectDataset(p) { const x = p.toLowerCase(); return Object.keys(BASELINES).find(d => x.includes(d)) || 'nfcorpus'; }
const DATASET = detectDataset(DATA_DIR);

function dcg(rels, k) { let s = 0; for (let i = 0; i < Math.min(rels.length, k); i++) s += (Math.pow(2, rels[i]) - 1) / Math.log2(i + 2); return s; }
function ndcg(retrieved, qrels, k) { const rels = retrieved.slice(0, k).map((id) => qrels.get(id) ?? 0); const ideal = [...qrels.values()].sort((a, b) => b - a).slice(0, k); const idcg = dcg(ideal, k); return idcg > 0 ? dcg(rels, k) / idcg : 0; }
function recall(retrieved, qrels, k) { const tot = [...qrels.values()].filter((v) => v > 0).length; if (tot === 0) return 0; let h = 0; for (let i = 0; i < Math.min(retrieved.length, k); i++) if ((qrels.get(retrieved[i]) ?? 0) > 0) h++; return h / tot; }
function cosine(a, b) { let s = 0; for (let i = 0; i < a.length; i++) s += a[i] * b[i]; return s; }

function loadJsonl(p) { return readFileSync(p, 'utf-8').split('\n').filter(Boolean).map((l) => JSON.parse(l)); }
function loadQrels(p) { const q = new Map(); const lines = readFileSync(p, 'utf-8').split('\n'); for (let i = 1; i < lines.length; i++) { if (!lines[i].trim()) continue; const [qid, did, s] = lines[i].split('\t'); if (!q.has(qid)) q.set(qid, new Map()); q.get(qid).set(did, Number(s)); } return q; }

function cachePath(s) { const safe = BGE_MODEL.replace(/\//g, '_'); return join(CACHE_DIR, `${safe}.${s}`); }
function loadEmbeddings(dim) {
  if (!existsSync(cachePath('ids')) || !existsSync(cachePath('f32'))) return null;
  const ids = readFileSync(cachePath('ids'), 'utf-8').split('\n').filter(Boolean);
  const raw = readFileSync(cachePath('f32'));
  const buf = new Float32Array(raw.buffer, raw.byteOffset, raw.length / 4);
  return { ids, embeds: ids.map((_, i) => buf.slice(i * dim, (i + 1) * dim)) };
}

// RRF — pure function per the original Cormack/Clarke/Buettcher 2009 paper.
// `rankings` is an array of [{id, score}, ...] sorted descending by score.
// `weights` is per-system weight (default 1.0 each).
function rrfFuse(rankings, k = 60, weights) {
  const scores = new Map();
  rankings.forEach((ranking, sIdx) => {
    const w = weights?.[sIdx] ?? 1;
    ranking.forEach((doc, rankIdx) => {
      const rank = rankIdx + 1;
      scores.set(doc.id, (scores.get(doc.id) ?? 0) + w / (k + rank));
    });
  });
  return [...scores.entries()].map(([id, score]) => ({ id, score })).sort((a, b) => b.score - a.score);
}

// Mulberry32 PRNG for deterministic bootstrap.
function mulberry32(a) { return function () { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
function bootstrapCI(scores, iter = 10000, rng = mulberry32(42)) {
  const n = scores.length; const means = new Float64Array(iter);
  for (let i = 0; i < iter; i++) { let s = 0; for (let j = 0; j < n; j++) s += scores[Math.floor(rng() * n)]; means[i] = s / n; }
  const sorted = Array.from(means).sort((a, b) => a - b);
  const lo = sorted[Math.floor(0.025 * iter)]; const hi = sorted[Math.floor(0.975 * iter)];
  return { mean: scores.reduce((s, v) => s + v, 0) / n, lo, hi };
}

async function main() {
  console.log(`# RRF ablation on BEIR ${DATASET} (ADR-087)`);
  console.log(`Data: ${DATA_DIR}\nDense: ${BGE_MODEL}\n`);

  const corpus = loadJsonl(join(DATA_DIR, 'corpus.jsonl'));
  const queries = loadJsonl(join(DATA_DIR, 'queries.jsonl'));
  const qrels = loadQrels(join(DATA_DIR, 'qrels/test.tsv'));
  console.log(`Corpus: ${corpus.length} · queries: ${queries.length} · test qrels: ${qrels.size}`);

  // Dense
  const bge = await import(join(CLI_ROOT, 'dist/src/memory/bge-embedder.js'));
  const emb = await bge.getBgeEmbedder(BGE_MODEL);
  if (!emb) { console.error('BGE failed'); process.exit(1); }
  const cached = loadEmbeddings(emb.dim());
  if (!cached) { console.error(`No cached embeddings at ${cachePath('f32')}. Run run-beir-bge.mjs first.`); process.exit(2); }
  const { ids: docIds, embeds: docEmbeds } = cached;

  // BM25
  const { tokenize, buildCorpusStats, multiFieldBM25 } = await import(join(CLI_ROOT, 'dist/src/memory/hybrid-retrieval.js'));
  const titleDocs = corpus.map((d) => tokenize(d.title || ''));
  const textDocs = corpus.map((d) => tokenize(d.text || ''));
  const titleStats = buildCorpusStats(titleDocs);
  const textStats = buildCorpusStats(textDocs);
  const corpusIdxToId = corpus.map((d) => d._id);

  // Pre-compute per-query rankings for both systems ONCE, so the ablation
  // matrix below just permutes RRF k/weights, not the underlying retrievals.
  const queriesById = new Map(queries.map((q) => [q._id, q.text]));
  const evalQids = [...qrels.keys()];

  console.log(`Pre-computing dense + BM25 rankings for ${evalQids.length} queries...`);
  const cached_dense = new Map();
  const cached_bm25 = new Map();
  const TOP_K_RETRIEVE = 1000;  // enough for stable RRF
  const tPre = performance.now();
  for (const qid of evalQids) {
    const qtext = queriesById.get(qid);
    if (!qtext) continue;
    // Dense
    const qEmb = await emb.embed(qtext);
    const dense = docIds.map((id, i) => ({ id, score: cosine(qEmb, docEmbeds[i]) })).sort((a, b) => b.score - a.score).slice(0, TOP_K_RETRIEVE);
    cached_dense.set(qid, dense);
    // BM25
    const qTokens = tokenize(qtext);
    const bm25 = corpus.map((d, i) => ({ id: corpusIdxToId[i], score: multiFieldBM25(qTokens, titleDocs[i], textDocs[i], titleStats, textStats, 1, 1) })).filter((d) => d.score > 0).sort((a, b) => b.score - a.score).slice(0, TOP_K_RETRIEVE);
    cached_bm25.set(qid, bm25);
  }
  console.log(`Pre-compute done in ${((performance.now() - tPre) / 1000).toFixed(0)}s.\n`);

  // ----- ABLATION GRID -----
  // FIXED-DEFAULT first (the ship claim). Other variants reported as exploratory.
  const CONFIGS = [
    // The headline configurations — defaults fixed before viewing results.
    { name: 'dense only',             rrf: false, weights: null,           kVal: null },
    { name: 'BM25 only',              rrf: false, weights: null,           kVal: null, bm25Only: true },
    { name: 'RRF k=60 equal (default)', rrf: true,  weights: [1.0, 1.0],     kVal: 60 },
    // Exploratory — disclose as tuned variants, not default.
    { name: 'RRF k=30 equal',         rrf: true,  weights: [1.0, 1.0],     kVal: 30 },
    { name: 'RRF k=120 equal',        rrf: true,  weights: [1.0, 1.0],     kVal: 120 },
    { name: 'RRF k=60 dense=1.2,bm25=0.8', rrf: true,  weights: [1.2, 0.8],     kVal: 60 },
    { name: 'RRF k=60 dense=0.8,bm25=1.2', rrf: true,  weights: [0.8, 1.2],     kVal: 60 },
  ];

  function scoreConfig(cfg) {
    let nSum = 0, r10Sum = 0, r100Sum = 0, n = 0;
    const perQuery = [];
    for (const qid of evalQids) {
      const dense = cached_dense.get(qid);
      const bm25 = cached_bm25.get(qid);
      if (!dense) continue;
      let top100;
      if (!cfg.rrf) {
        if (cfg.bm25Only) top100 = (bm25 || []).slice(0, 100).map((d) => d.id);
        else top100 = dense.slice(0, 100).map((d) => d.id);
      } else {
        const fused = rrfFuse([dense, bm25 || []], cfg.kVal, cfg.weights);
        top100 = fused.slice(0, 100).map((d) => d.id);
      }
      const qmap = qrels.get(qid);
      const ndcg10 = ndcg(top100, qmap, 10);
      nSum += ndcg10;
      r10Sum += recall(top100, qmap, 10);
      r100Sum += recall(top100, qmap, 100);
      n++;
      perQuery.push({ qid, ndcg10 });
    }
    return {
      name: cfg.name,
      ndcg10: nSum / n,
      recall10: r10Sum / n,
      recall100: r100Sum / n,
      n,
      perQuery,
    };
  }

  console.log('Config                                | nDCG@10  R@10    R@100   95% CI');
  console.log('--------------------------------------|---------------------------------');
  const results = [];
  let defaultResult = null;
  for (const cfg of CONFIGS) {
    const r = scoreConfig(cfg);
    const ci = bootstrapCI(r.perQuery.map((q) => q.ndcg10));
    const ciStr = `[${ci.lo.toFixed(3)}, ${ci.hi.toFixed(3)}]`;
    console.log(`${cfg.name.padEnd(38)} | ${r.ndcg10.toFixed(4)}  ${r.recall10.toFixed(3)}   ${r.recall100.toFixed(3)}   ${ciStr}`);
    results.push({ ...r, ci, cfg });
    if (cfg.name.includes('default')) defaultResult = { ...r, ci, cfg };
  }

  console.log('\n=== Ship claim (fixed default, k=60, equal weights) ===');
  console.log(`Dataset: ${DATASET}`);
  console.log(`nDCG@10: ${defaultResult.ndcg10.toFixed(4)}   95% CI ${`[${defaultResult.ci.lo.toFixed(4)}, ${defaultResult.ci.hi.toFixed(4)}]`}`);
  for (const [name, score] of Object.entries(BASELINES[DATASET])) {
    const delta = defaultResult.ndcg10 - score;
    const inCi = score >= defaultResult.ci.lo && score <= defaultResult.ci.hi;
    const sig = inCi ? 'n.s.' : (delta > 0 ? 'p<0.05 WIN' : 'p<0.05 LOSS');
    console.log(`  vs ${name.padEnd(15)} Δ=${(delta >= 0 ? '+' : '') + delta.toFixed(4)}   ${sig}`);
  }

  // Save
  const summary = {
    runAt: new Date().toISOString(),
    benchmark: `beir-${DATASET}-rrf-ablation`,
    dataset: DATASET,
    bgeModel: BGE_MODEL,
    queries: defaultResult.n,
    corpusSize: corpus.length,
    fixedDefault: { name: defaultResult.cfg.name, metrics: { ndcg10: defaultResult.ndcg10, recall10: defaultResult.recall10, recall100: defaultResult.recall100 }, ci: defaultResult.ci, perQuery: defaultResult.perQuery },
    ablation: results.map((r) => ({ name: r.cfg.name, ndcg10: r.ndcg10, recall10: r.recall10, recall100: r.recall100, ci: r.ci })),
    baselines: BASELINES[DATASET],
  };
  mkdirSync(RUNS_DIR, { recursive: true });
  const stamp = summary.runAt.replace(/[:.]/g, '-');
  writeFileSync(join(RUNS_DIR, `beir-${DATASET}-rrf-ablation-${stamp}.json`), JSON.stringify(summary, null, 2));
  writeFileSync(join(RUNS_DIR, `beir-${DATASET}-rrf-ablation-latest.json`), JSON.stringify(summary, null, 2));
  console.log(`\nWrote ${join(RUNS_DIR, `beir-${DATASET}-rrf-ablation-${stamp}.json`)}`);
  process.exit(0);
}

main().catch((err) => { console.error(err); process.exit(1); });
