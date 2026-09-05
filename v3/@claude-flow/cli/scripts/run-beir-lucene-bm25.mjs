#!/usr/bin/env node
// run-beir-lucene-bm25.mjs — test our Lucene-style BM25 against the
// published BEIR BM25 baselines. Also runs RRF with Lucene-BM25 + dense
// to see if the stronger BM25 closes the asymmetric-strength gap that
// broke RRF in ADR-087.
//
// Usage:
//   cd /tmp/beir-nfcorpus
//   node /path/to/scripts/run-beir-lucene-bm25.mjs
//   BEIR_DATA_DIR=/tmp/beir-scifact/scifact node /path/to/scripts/run-beir-lucene-bm25.mjs

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { performance } from 'node:perf_hooks';

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const CLI_ROOT = resolve(SCRIPT_DIR, '..');
const RUFLO_ROOT = resolve(SCRIPT_DIR, '../../../..');
const RUNS_DIR = join(RUFLO_ROOT, 'docs', 'benchmarks', 'runs');

const DATA_DIR = process.env.BEIR_DATA_DIR || '/tmp/beir-nfcorpus/nfcorpus';
const BGE_MODEL = 'Xenova/bge-base-en-v1.5';
const CACHE_DIR = join(dirname(DATA_DIR), 'bge-cache');

const BASELINES = {
  nfcorpus: { BM25: 0.325, 'BGE-large-pub': 0.380, 'SPLADE++': 0.347 },
  scifact: { BM25: 0.679, 'BGE-large-pub': 0.722, 'SPLADE++': 0.704 },
};
function detect(p) { const x = p.toLowerCase(); return Object.keys(BASELINES).find(d => x.includes(d)) || 'nfcorpus'; }

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

async function main() {
  const dataset = detect(DATA_DIR);
  console.log(`# Lucene-style BM25 + RRF on BEIR ${dataset} (ADR-088)`);
  console.log(`Data: ${DATA_DIR}\n`);

  const corpus = loadJsonl(join(DATA_DIR, 'corpus.jsonl'));
  const queries = loadJsonl(join(DATA_DIR, 'queries.jsonl'));
  const qrels = loadQrels(join(DATA_DIR, 'qrels/test.tsv'));
  console.log(`Corpus: ${corpus.length} · test qrels: ${qrels.size}`);

  // Lucene BM25
  const { luceneTokenize, buildLuceneCorpusStats, luceneBM25 } = await import(join(CLI_ROOT, 'dist/src/memory/lucene-bm25.js'));
  console.log('\nTokenising corpus (Lucene-style: Porter stem + Lucene stopwords + length norm)...');
  const tIngest = performance.now();
  const docs = corpus.map((d) => luceneTokenize(`${d.title || ''} ${d.text || ''}`));
  const stats = buildLuceneCorpusStats(docs);
  console.log(`Tokenized + stats built in ${((performance.now() - tIngest) / 1000).toFixed(1)}s. avgDocLen=${stats.avgDocLen.toFixed(0)}, vocab=${stats.idf.size}`);

  // BGE dense (from cache)
  const bge = await import(join(CLI_ROOT, 'dist/src/memory/bge-embedder.js'));
  const emb = await bge.getBgeEmbedder(BGE_MODEL);
  if (!emb) { console.error('BGE failed'); process.exit(1); }
  const cached = loadEmbeddings(emb.dim());
  if (!cached) { console.error(`No cached embeddings. Run run-beir-bge.mjs first.`); process.exit(2); }
  const { ids: docIds, embeds: docEmbeds } = cached;
  const corpusIdxToId = corpus.map((d) => d._id);

  // Run all configs
  const queriesById = new Map(queries.map((q) => [q._id, q.text]));
  const evalQids = [...qrels.keys()];
  console.log(`\nRunning ${evalQids.length} queries through 4 configs (dense, Lucene-BM25, RRF, RRF-tuned)...\n`);

  let n = 0;
  const results = {
    dense: { n: 0, ndcg: 0, r10: 0, r100: 0 },
    bm25: { n: 0, ndcg: 0, r10: 0, r100: 0 },
    rrf60: { n: 0, ndcg: 0, r10: 0, r100: 0 },
    rrf30: { n: 0, ndcg: 0, r10: 0, r100: 0 },
  };
  const tQ = performance.now();
  for (const qid of evalQids) {
    const qtext = queriesById.get(qid);
    if (!qtext) continue;
    n++;

    // Dense
    const qEmb = await emb.embed(qtext);
    const dense = docIds.map((id, i) => ({ id, score: cosine(qEmb, docEmbeds[i]) })).sort((a, b) => b.score - a.score).slice(0, 1000);

    // BM25
    const qTokens = luceneTokenize(qtext);
    const bm25 = corpus.map((d, i) => ({ id: corpusIdxToId[i], score: luceneBM25(qTokens, docs[i], stats) })).filter((d) => d.score > 0).sort((a, b) => b.score - a.score).slice(0, 1000);

    // RRF k=60 and k=30
    const rrf60 = rrfFuse([dense, bm25], 60);
    const rrf30 = rrfFuse([dense, bm25], 30);

    const qmap = qrels.get(qid);
    for (const [key, top] of [['dense', dense], ['bm25', bm25], ['rrf60', rrf60], ['rrf30', rrf30]]) {
      const top100 = top.slice(0, 100).map((s) => s.id);
      results[key].n++;
      results[key].ndcg += ndcg(top100, qmap, 10);
      results[key].r10 += recall(top100, qmap, 10);
      results[key].r100 += recall(top100, qmap, 100);
    }
    if (n % 50 === 0) console.log(`  ${n}/${evalQids.length} dense=${(results.dense.ndcg / results.dense.n).toFixed(3)} bm25=${(results.bm25.ndcg / results.bm25.n).toFixed(3)} rrf60=${(results.rrf60.ndcg / results.rrf60.n).toFixed(3)}`);
  }
  const elapsed = (performance.now() - tQ) / 1000;

  console.log(`\nDone in ${elapsed.toFixed(0)}s.\n`);
  console.log('Config         | nDCG@10  R@10   R@100  vs published-BM25');
  console.log('---------------|---------------------------------');
  for (const [key, r] of Object.entries(results)) {
    const score = r.ndcg / r.n;
    const delta = score - BASELINES[dataset].BM25;
    console.log(`${key.padEnd(14)} | ${score.toFixed(4)}  ${(r.r10 / r.n).toFixed(3)}  ${(r.r100 / r.n).toFixed(3)}  ${(delta >= 0 ? '+' : '') + delta.toFixed(4)}`);
  }

  const summary = {
    runAt: new Date().toISOString(),
    benchmark: `beir-${dataset}-lucene-bm25`,
    dataset, model: BGE_MODEL, queries: n,
    results: Object.fromEntries(Object.entries(results).map(([k, v]) => [k, { ndcg10: v.ndcg / v.n, recall10: v.r10 / v.n, recall100: v.r100 / v.n }])),
    baselines: BASELINES[dataset],
  };
  mkdirSync(RUNS_DIR, { recursive: true });
  const stamp = summary.runAt.replace(/[:.]/g, '-');
  writeFileSync(join(RUNS_DIR, `beir-${dataset}-lucene-bm25-${stamp}.json`), JSON.stringify(summary, null, 2));
  writeFileSync(join(RUNS_DIR, `beir-${dataset}-lucene-bm25-latest.json`), JSON.stringify(summary, null, 2));
  console.log(`\nWrote ${join(RUNS_DIR, `beir-${dataset}-lucene-bm25-${stamp}.json`)}`);
  process.exit(0);
}

main().catch((err) => { console.error(err); process.exit(1); });
