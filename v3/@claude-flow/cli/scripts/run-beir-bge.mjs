#!/usr/bin/env node
// run-beir-bge.mjs — NFCorpus retrieval using real BGE-base-en-v1.5
// embeddings (bypasses neural-tools' broken agentic-flow path that hash-fell-
// back on darwin-arm64 without sharp/libvips).
//
// Stores doc embeddings in a single .f32 binary file (3633 * 768 * 4 = ~11MB)
// for fast bench iteration without re-embedding.
//
// Usage:
//   cd /tmp/beir-nfcorpus
//   node /path/to/scripts/run-beir-bge.mjs                          # full ingest + bench
//   SKIP_INGEST=1 node /path/to/scripts/run-beir-bge.mjs            # reuse cached embeds
//   BGE_MODEL=Xenova/bge-small-en-v1.5 node ...                     # faster, lower-quality
//   BGE_MODEL=Xenova/bge-large-en-v1.5 node ...                     # slower, higher-quality
//
// ADR-086.

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { performance } from 'node:perf_hooks';

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const CLI_ROOT = resolve(SCRIPT_DIR, '..');
const RUFLO_ROOT = resolve(SCRIPT_DIR, '../../../..');
const RUNS_DIR = join(RUFLO_ROOT, 'docs', 'benchmarks', 'runs');

const DATA_DIR = process.env.BEIR_DATA_DIR || '/tmp/beir-nfcorpus/nfcorpus';
// BUG-FIX (ADR-087): CACHE_DIR was hardcoded to /tmp/beir-nfcorpus/bge-cache,
// which made the SciFact run silently overwrite the NFCorpus cache. Now
// derived from DATA_DIR — each dataset gets its own cache directory.
const CACHE_DIR = join(dirname(DATA_DIR), 'bge-cache');
const BGE_MODEL = process.env.BGE_MODEL || 'Xenova/bge-base-en-v1.5';
const SKIP_INGEST = process.env.SKIP_INGEST === '1';
const MAX_QUERIES = Number(process.env.MAX_QUERIES) || 0;

// Published BEIR baselines per dataset (nDCG@10).
// Sources: Thakur et al. 2021 (BEIR paper), BGE paper (BAAI 2024),
// SPLADE++ paper, papers-with-code BEIR leaderboards.
const BASELINES_BY_DATASET = {
  nfcorpus: {
    'BM25 (Lucene)':        0.325,
    'DocT5query':           0.328,
    'TAS-B':                0.319,
    'GenQ':                 0.319,
    'ColBERT':              0.305,
    'Contriever':           0.328,
    'GTR-XL':               0.343,
    'SPLADE++':             0.347,
    'BGE-large-v1.5 (pub)': 0.380,
    'SBERT msmarco':        0.272,
  },
  scifact: {
    'BM25 (Lucene)':        0.679,
    'DocT5query':           0.675,
    'TAS-B':                0.643,
    'GenQ':                 0.644,
    'ColBERT':              0.671,
    'Contriever':           0.677,
    'GTR-XL':               0.662,
    'SPLADE++':             0.704,
    'BGE-large-v1.5 (pub)': 0.722,
    'SBERT msmarco':        0.555,
  },
  arguana: {
    'BM25 (Lucene)':        0.397,
    'DocT5query':           0.349,
    'TAS-B':                0.429,
    'GenQ':                 0.493,
    'ColBERT':              0.233,
    'Contriever':           0.379,
    'GTR-XL':               0.439,
    'SPLADE++':             0.521,
    'BGE-large-v1.5 (pub)': 0.636,
    'SBERT msmarco':        0.371,
  },
  scidocs: {
    'BM25 (Lucene)':        0.158,
    'DocT5query':           0.162,
    'TAS-B':                0.149,
    'GenQ':                 0.143,
    'ColBERT':              0.145,
    'Contriever':           0.165,
    'GTR-XL':               0.174,
    'SPLADE++':             0.159,
    'BGE-large-v1.5 (pub)': 0.225,
    'SBERT msmarco':        0.122,
  },
};

// Auto-detect dataset from DATA_DIR path; default to nfcorpus baselines.
function detectDataset(path) {
  const p = path.toLowerCase();
  for (const ds of Object.keys(BASELINES_BY_DATASET)) {
    if (p.includes(ds)) return ds;
  }
  return 'nfcorpus';
}

// ---------------------------------------------------------------------------
// nDCG (graded)
// ---------------------------------------------------------------------------

function dcg(rels, k) {
  let s = 0;
  for (let i = 0; i < Math.min(rels.length, k); i++) {
    s += (Math.pow(2, rels[i]) - 1) / Math.log2(i + 2);
  }
  return s;
}
function ndcg(retrieved, qrels, k) {
  const rels = retrieved.slice(0, k).map((id) => qrels.get(id) ?? 0);
  const ideal = [...qrels.values()].sort((a, b) => b - a).slice(0, k);
  const idcg = dcg(ideal, k);
  return idcg > 0 ? dcg(rels, k) / idcg : 0;
}
function mrr(retrieved, qrels, k) {
  for (let i = 0; i < Math.min(retrieved.length, k); i++) {
    if ((qrels.get(retrieved[i]) ?? 0) > 0) return 1 / (i + 1);
  }
  return 0;
}
function recall(retrieved, qrels, k) {
  const tot = [...qrels.values()].filter((v) => v > 0).length;
  if (tot === 0) return 0;
  let h = 0;
  for (let i = 0; i < Math.min(retrieved.length, k); i++) {
    if ((qrels.get(retrieved[i]) ?? 0) > 0) h++;
  }
  return h / tot;
}

function cosine(a, b) {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i] * b[i];
  return s; // already L2-normalised in BGE
}

// ---------------------------------------------------------------------------
// Loaders
// ---------------------------------------------------------------------------

function loadJsonl(path) {
  return readFileSync(path, 'utf-8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
}
function loadQrels(path) {
  const qrels = new Map();
  const lines = readFileSync(path, 'utf-8').split('\n');
  for (let i = 1; i < lines.length; i++) {
    if (!lines[i].trim()) continue;
    const [qid, did, score] = lines[i].split('\t');
    if (!qrels.has(qid)) qrels.set(qid, new Map());
    qrels.get(qid).set(did, Number(score));
  }
  return qrels;
}

// ---------------------------------------------------------------------------
// Embedding cache I/O — single .f32 file + .ids file
// ---------------------------------------------------------------------------

function cachePath(suffix) {
  const safe = BGE_MODEL.replace(/\//g, '_');
  return join(CACHE_DIR, `${safe}.${suffix}`);
}

function saveEmbeddings(ids, embeddings, dim) {
  mkdirSync(CACHE_DIR, { recursive: true });
  // ids: one per line
  writeFileSync(cachePath('ids'), ids.join('\n') + '\n');
  // embeddings: concatenated Float32Array
  const buf = new Float32Array(ids.length * dim);
  for (let i = 0; i < ids.length; i++) buf.set(embeddings[i], i * dim);
  writeFileSync(cachePath('f32'), Buffer.from(buf.buffer));
}

function loadEmbeddings(dim) {
  if (!existsSync(cachePath('ids')) || !existsSync(cachePath('f32'))) return null;
  const ids = readFileSync(cachePath('ids'), 'utf-8').split('\n').filter(Boolean);
  const raw = readFileSync(cachePath('f32'));
  const buf = new Float32Array(raw.buffer, raw.byteOffset, raw.length / 4);
  const embeds = [];
  for (let i = 0; i < ids.length; i++) embeds.push(buf.slice(i * dim, (i + 1) * dim));
  return { ids, embeds };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const dataset = detectDataset(DATA_DIR);
  const BASELINES_NDCG10 = BASELINES_BY_DATASET[dataset];
  console.log(`# BEIR ${dataset} — BGE embedder (ADR-085/086)`);
  console.log(`Model: ${BGE_MODEL}`);
  console.log(`Data:  ${DATA_DIR}`);

  const corpus = loadJsonl(join(DATA_DIR, 'corpus.jsonl'));
  const queries = loadJsonl(join(DATA_DIR, 'queries.jsonl'));
  const qrels = loadQrels(join(DATA_DIR, 'qrels/test.tsv'));
  console.log(`Corpus: ${corpus.length} docs · Queries: ${queries.length} · Test qrels: ${qrels.size}`);

  const bge = await import(join(CLI_ROOT, 'dist/src/memory/bge-embedder.js'));
  const emb = await bge.getBgeEmbedder(BGE_MODEL);
  if (!emb) {
    console.error('BGE failed to load:', bge.getBgeStatus());
    process.exit(1);
  }
  const dim = emb.dim();
  console.log(`BGE loaded (dim=${dim})`);

  // Ingest or load cached doc embeddings.
  let docIds, docEmbeds;
  const cached = SKIP_INGEST ? loadEmbeddings(dim) : null;
  if (cached) {
    docIds = cached.ids;
    docEmbeds = cached.embeds;
    console.log(`Loaded ${docIds.length} cached doc embeddings from ${cachePath('f32')}`);
  } else {
    console.log(`\nEmbedding ${corpus.length} docs (this is the slow step, ~20 min on M-series CPU)...`);
    docIds = corpus.map((d) => d._id);
    docEmbeds = new Array(corpus.length);
    const tIngest = performance.now();
    for (let i = 0; i < corpus.length; i++) {
      const d = corpus[i];
      const text = `${d.title || ''}\n${d.text || ''}`.slice(0, 4096);
      docEmbeds[i] = await emb.embed(text);
      if ((i + 1) % 100 === 0) {
        const elapsed = (performance.now() - tIngest) / 1000;
        const rate = (i + 1) / elapsed;
        const eta = (corpus.length - i - 1) / rate;
        console.log(`  ${i + 1}/${corpus.length}  ${rate.toFixed(1)} docs/s  ETA ${eta.toFixed(0)}s`);
      }
    }
    console.log(`Embedded ${corpus.length} docs in ${((performance.now() - tIngest) / 1000).toFixed(0)}s`);
    saveEmbeddings(docIds, docEmbeds, dim);
    console.log(`Cached to ${cachePath('f32')}`);
  }

  // Run retrieval per query.
  const queriesById = new Map(queries.map((q) => [q._id, q.text]));
  const evalQueryIds = MAX_QUERIES
    ? [...qrels.keys()].slice(0, MAX_QUERIES)
    : [...qrels.keys()];

  // ADR-090: BGE_QUERY_PREFIX=1 enables BAAI's recommended query prefix.
  const USE_QUERY_PREFIX = process.env.BGE_QUERY_PREFIX === '1';
  console.log(`\nRunning ${evalQueryIds.length} queries${USE_QUERY_PREFIX ? ' (with BGE query prefix, ADR-090)' : ''}...`);
  let nSum = 0, mSum = 0, r10Sum = 0, r100Sum = 0, n = 0;
  // ADR-086 — save per-query metrics for paired bootstrap significance testing.
  const perQuery = [];
  const tQ = performance.now();
  for (const qid of evalQueryIds) {
    const qtext = queriesById.get(qid);
    if (!qtext) continue;
    // ADR-090: opt-in BGE query prefix per BAAI's docs (+0.009 nDCG@10 on
    // NFCorpus dense-alone). Falls back to plain embed() if not enabled.
    const qEmb = USE_QUERY_PREFIX && emb.embedQuery ? await emb.embedQuery(qtext) : await emb.embed(qtext);
    const scores = new Array(docEmbeds.length);
    for (let i = 0; i < docEmbeds.length; i++) scores[i] = { id: docIds[i], score: cosine(qEmb, docEmbeds[i]) };
    scores.sort((a, b) => b.score - a.score);
    const top100 = scores.slice(0, 100).map((s) => s.id);

    const qmap = qrels.get(qid);
    const qNdcg = ndcg(top100, qmap, 10);
    const qMrr = mrr(top100, qmap, 10);
    const qR10 = recall(top100, qmap, 10);
    const qR100 = recall(top100, qmap, 100);
    nSum += qNdcg; mSum += qMrr; r10Sum += qR10; r100Sum += qR100; n++;
    perQuery.push({ qid, ndcg10: qNdcg, mrr10: qMrr, recall10: qR10, recall100: qR100 });
    if (n % 50 === 0) {
      const elapsed = (performance.now() - tQ) / 1000;
      console.log(`  ${n}/${evalQueryIds.length} in ${elapsed.toFixed(0)}s  running nDCG@10=${(nSum / n).toFixed(4)}`);
    }
  }
  const queryMs = performance.now() - tQ;

  const ndcg10 = nSum / n;
  const mrr10 = mSum / n;
  const recall10 = r10Sum / n;
  const recall100 = r100Sum / n;

  console.log(`\n=== Results (N=${n}, BGE-base-en-v1.5) ===`);
  console.log(`  nDCG@10:    ${ndcg10.toFixed(4)}`);
  console.log(`  MRR@10:     ${mrr10.toFixed(4)}`);
  console.log(`  Recall@10:  ${recall10.toFixed(4)}`);
  console.log(`  Recall@100: ${recall100.toFixed(4)}`);
  console.log(`  Avg query latency: ${(queryMs / n).toFixed(0)}ms`);

  console.log(`\n=== vs published NFCorpus baselines (nDCG@10) ===`);
  const ourLabel = `ruflo + ${BGE_MODEL.replace('Xenova/', '')}`;
  const ranking = [
    ...Object.entries(BASELINES_NDCG10).map(([name, score]) => ({ name, score, ours: false })),
    { name: ourLabel, score: ndcg10, ours: true },
  ].sort((a, b) => b.score - a.score);
  for (const r of ranking) {
    console.log(`  ${r.score.toFixed(3)}  ${r.name}${r.ours ? ' ← us' : ''}`);
  }
  const ourRank = ranking.findIndex((r) => r.ours) + 1;
  console.log(`\n  Our rank: ${ourRank} / ${ranking.length}`);

  const summary = {
    runAt: new Date().toISOString(),
    benchmark: `beir-${dataset}-bge`,
    dataset,
    model: BGE_MODEL,
    queries: n,
    corpusSize: corpus.length,
    metrics: { ndcg10, mrr10, recall10, recall100, avgQueryLatencyMs: queryMs / n },
    perQuery, // ADR-086: per-query metrics for paired bootstrap significance testing
    baselines: BASELINES_NDCG10,
    ourRank,
    leaderboardLength: ranking.length,
  };
  mkdirSync(RUNS_DIR, { recursive: true });
  const stamp = summary.runAt.replace(/[:.]/g, '-');
  const safe = BGE_MODEL.replace(/\//g, '_');
  writeFileSync(join(RUNS_DIR, `beir-${dataset}-bge-${safe}-${stamp}.json`), JSON.stringify(summary, null, 2));
  writeFileSync(join(RUNS_DIR, `beir-${dataset}-bge-latest.json`), JSON.stringify(summary, null, 2));
  console.log(`\nWrote ${join(RUNS_DIR, `beir-${dataset}-bge-${safe}-${stamp}.json`)}`);
  process.exit(0);
}

main().catch((err) => { console.error(err); process.exit(1); });
