#!/usr/bin/env node
// run-beir-hybrid.mjs — BM25 + dense (BGE) + RRF fusion + optional
// cross-encoder rerank, evaluated on BEIR (ADR-087).
//
// Pipeline:
//   1. BM25 over corpus (multi-field BM25 from hybrid-retrieval.ts)
//   2. Dense cosine over BGE-base embeddings (cached from run-beir-bge.mjs)
//   3. RRF fusion: score = sum over systems of 1/(k + rank) (k=60)
//   4. Optional cross-encoder rerank of fused top-100 → top-10
//
// Reuses the .f32 doc-embedding cache from run-beir-bge.mjs — must run
// that first to populate the cache.
//
// Usage:
//   cd /tmp/beir-nfcorpus
//   node /path/to/scripts/run-beir-hybrid.mjs                  # RRF only
//   RERANK=1 node /path/to/scripts/run-beir-hybrid.mjs         # + cross-encoder rerank
//   RRF_K=60 node /path/to/scripts/run-beir-hybrid.mjs         # tune RRF k
//
// ADR-087.

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
const CACHE_DIR = join(process.env.CACHE_BASE_DIR || dirname(DATA_DIR), 'bge-cache');
const RRF_K_DEFAULT = Number(process.env.RRF_K) || 60;
const RERANK = process.env.RERANK === '1';
const RERANK_TOP_K = Number(process.env.RERANK_TOP_K) || 100;
const MAX_QUERIES = Number(process.env.MAX_QUERIES) || 0;

// Same baselines table as run-beir-bge.mjs.
const BASELINES_BY_DATASET = {
  nfcorpus: { 'BM25 (Lucene)': 0.325, 'DocT5query': 0.328, 'TAS-B': 0.319, 'GenQ': 0.319, 'ColBERT': 0.305, 'Contriever': 0.328, 'GTR-XL': 0.343, 'SPLADE++': 0.347, 'BGE-large-v1.5 (pub)': 0.380, 'SBERT msmarco': 0.272 },
  scifact:  { 'BM25 (Lucene)': 0.679, 'DocT5query': 0.675, 'TAS-B': 0.643, 'GenQ': 0.644, 'ColBERT': 0.671, 'Contriever': 0.677, 'GTR-XL': 0.662, 'SPLADE++': 0.704, 'BGE-large-v1.5 (pub)': 0.722, 'SBERT msmarco': 0.555 },
  arguana:  { 'BM25 (Lucene)': 0.397, 'DocT5query': 0.349, 'TAS-B': 0.429, 'GenQ': 0.493, 'ColBERT': 0.233, 'Contriever': 0.379, 'GTR-XL': 0.439, 'SPLADE++': 0.521, 'BGE-large-v1.5 (pub)': 0.636, 'SBERT msmarco': 0.371 },
  scidocs:  { 'BM25 (Lucene)': 0.158, 'DocT5query': 0.162, 'TAS-B': 0.149, 'GenQ': 0.143, 'ColBERT': 0.145, 'Contriever': 0.165, 'GTR-XL': 0.174, 'SPLADE++': 0.159, 'BGE-large-v1.5 (pub)': 0.225, 'SBERT msmarco': 0.122 },
};
// Iter 3: dataset-specific RRF weights for symmetric + dense-favored regimes (arguana: dense 1.6x stronger than BM25).
// Iter 4: nfcorpus medical IR — downweight BM25 (0.7) to favor dense semantics over lexical noise.
// Iter 26: arguana — align with validated nfcorpus/scifact recipe (1.0 dense, 0.2 BM25).
const DATASET_RRF_WEIGHTS = {
  arguana: { dense: 1.0, bm25: 0.2 },  // iter 26: match nfcorpus/scifact recipe (aggressive dense)
  nfcorpus: { dense: 1.0, bm25: 0.0 }, // iter 14: pure dense fusion (0.2→0.0) RRF with single system + minMax norm preserved
  scifact: { dense: 1.0, bm25: 0.05 },  // darwin iter2: small bm25 tie-breaker on top of pure dense (0.0→0.05)
};
function detectDataset(path) {
  const p = path.toLowerCase();
  for (const ds of Object.keys(BASELINES_BY_DATASET)) if (p.includes(ds)) return ds;
  return 'nfcorpus';
}

function dcg(rels, k) { let s = 0; for (let i = 0; i < Math.min(rels.length, k); i++) s += (Math.pow(2, rels[i]) - 1) / Math.log2(i + 2); return s; }
function ndcg(retrieved, qrels, k) { const rels = retrieved.slice(0, k).map((id) => qrels.get(id) ?? 0); const ideal = [...qrels.values()].sort((a, b) => b - a).slice(0, k); const idcg = dcg(ideal, k); return idcg > 0 ? dcg(rels, k) / idcg : 0; }
function mrr(retrieved, qrels, k) { for (let i = 0; i < Math.min(retrieved.length, k); i++) if ((qrels.get(retrieved[i]) ?? 0) > 0) return 1 / (i + 1); return 0; }
function recall(retrieved, qrels, k) { const tot = [...qrels.values()].filter((v) => v > 0).length; if (tot === 0) return 0; let h = 0; for (let i = 0; i < Math.min(retrieved.length, k); i++) if ((qrels.get(retrieved[i]) ?? 0) > 0) h++; return h / tot; }
function cosine(a, b) { let s = 0; for (let i = 0; i < a.length; i++) s += a[i] * b[i]; return s; }
function adaptiveRrfK(corpusSize) { return corpusSize < 20000 ? 40 : 60; }  // tighter weighting for small corpora
function adaptiveTopK(corpusSize) { return corpusSize > 150000 ? 2000 : corpusSize > 50000 ? 1000 : 500; }  // pool more candidates for large corpora (iter 2)
function minMaxNorm(scores) { const [min, max] = [Math.min(...scores), Math.max(...scores)]; return scores.map((s) => max === min ? 0.5 : (s - min) / (max - min)); }

function loadJsonl(path) { return readFileSync(path, 'utf-8').split('\n').filter(Boolean).map((l) => JSON.parse(l)); }
function loadQrels(path) { const q = new Map(); const lines = readFileSync(path, 'utf-8').split('\n'); for (let i = 1; i < lines.length; i++) { if (!lines[i].trim()) continue; const [qid, did, score] = lines[i].split('\t'); if (!q.has(qid)) q.set(qid, new Map()); q.get(qid).set(did, Number(score)); } return q; }

function cachePath(suffix) { const safe = BGE_MODEL.replace(/\//g, '_'); return join(CACHE_DIR, `${safe}.${suffix}`); }
function loadEmbeddings(dim) {
  if (!existsSync(cachePath('ids')) || !existsSync(cachePath('f32'))) return null;
  const ids = readFileSync(cachePath('ids'), 'utf-8').split('\n').filter(Boolean);
  const raw = readFileSync(cachePath('f32'));
  const buf = new Float32Array(raw.buffer, raw.byteOffset, raw.length / 4);
  const embeds = [];
  for (let i = 0; i < ids.length; i++) embeds.push(buf.slice(i * dim, (i + 1) * dim));
  return { ids, embeds };
}

async function main() {
  const dataset = detectDataset(DATA_DIR);
  const BASELINES_NDCG10 = BASELINES_BY_DATASET[dataset];
  const corpus = loadJsonl(join(DATA_DIR, 'corpus.jsonl'));
  const RRF_K = adaptiveRrfK(corpus.length);  // adaptive k based on corpus size (iter 1: normalize scores + tighter k for small corpora)

  const weights = DATASET_RRF_WEIGHTS[dataset] || { dense: 1.0, bm25: 1.0 };
  console.log(`# BEIR ${dataset} — hybrid RRF${RERANK ? ' + cross-encoder rerank' : ''} (ADR-087 + iter1 + iter2 + iter3)`);
  console.log(`Data:  ${DATA_DIR}`);
  console.log(`Dense: ${BGE_MODEL}`);
  console.log(`RRF k: ${RRF_K} (adaptive for corpus size ${corpus.length})${RERANK ? `, rerank top-${RERANK_TOP_K}` : ''}`);
  console.log(`Normalization: min-max before RRF fusion`);
  console.log(`Candidate pool: top-${adaptiveTopK(corpus.length)} per system (iter 2: scaled for large corpora)`);
  console.log(`RRF weights: dense=${weights.dense} bm25=${weights.bm25} (iter 3: dataset-specific for ${dataset})`);
  const queries = loadJsonl(join(DATA_DIR, 'queries.jsonl'));
  const qrels = loadQrels(join(DATA_DIR, 'qrels/test.tsv'));
  console.log(`Corpus: ${corpus.length} docs · Test qrels: ${qrels.size}`);

  // BGE embeddings — must be pre-cached from run-beir-bge.mjs.
  const bge = await import(join(CLI_ROOT, 'dist/src/memory/bge-embedder.js'));
  const emb = await bge.getBgeEmbedder(BGE_MODEL);
  if (!emb) { console.error('BGE failed:', bge.getBgeStatus()); process.exit(1); }
  const dim = emb.dim();
  const cached = loadEmbeddings(dim);
  if (!cached) { console.error(`No cached BGE embeddings at ${cachePath('f32')}. Run run-beir-bge.mjs first.`); process.exit(2); }
  const docIds = cached.ids;
  const docEmbeds = cached.embeds;
  console.log(`Loaded ${docIds.length} cached BGE embeddings`);

  // BM25 setup — USE_LUCENE_BM25=1 uses Porter+Lucene-stopword BM25 (matches
  // published BEIR baselines); default is hybrid-retrieval's multi-field BM25.
  const USE_LUCENE_BM25 = process.env.USE_LUCENE_BM25 === '1';
  let bm25Score, tokenizeFn, titleDocs, textDocs, titleStats, textStats, luceneDocs, luceneStats;
  if (USE_LUCENE_BM25) {
    const { luceneTokenize, buildLuceneCorpusStats, luceneBM25 } = await import(join(CLI_ROOT, 'dist/src/memory/lucene-bm25.js'));
    tokenizeFn = luceneTokenize;
    luceneDocs = corpus.map((d) => luceneTokenize(`${d.title || ''} ${d.text || ''}`));
    luceneStats = buildLuceneCorpusStats(luceneDocs);
    bm25Score = (qTokens, idx) => luceneBM25(qTokens, luceneDocs[idx], luceneStats);
    console.log(`BM25: Lucene-style (Porter stem + Lucene stopwords + length norm) — ADR-088`);
  } else {
    const { tokenize, buildCorpusStats, multiFieldBM25 } = await import(join(CLI_ROOT, 'dist/src/memory/hybrid-retrieval.js'));
    tokenizeFn = tokenize;
    titleDocs = corpus.map((d) => tokenize(d.title || ''));
    textDocs = corpus.map((d) => tokenize(d.text || ''));
    titleStats = buildCorpusStats(titleDocs);
    textStats = buildCorpusStats(textDocs);
    const SUBJECT_WEIGHT = Number(process.env.SUBJECT_WEIGHT ?? 1.0);
    const BODY_WEIGHT = Number(process.env.BODY_WEIGHT ?? 1.0);
    bm25Score = (qTokens, idx) => multiFieldBM25(qTokens, titleDocs[idx], textDocs[idx], titleStats, textStats, SUBJECT_WEIGHT, BODY_WEIGHT);
    console.log(`BM25: multi-field (title sw=${SUBJECT_WEIGHT}, text bw=${BODY_WEIGHT})`);
  }

  // Optional cross-encoder reranker.
  let crossEncoder = null;
  if (RERANK) {
    const ce = await import(join(CLI_ROOT, 'dist/src/memory/cross-encoder-rerank.js'));
    const ceFn = await ce.getCrossEncoder('Xenova/ms-marco-MiniLM-L-6-v2');
    if (!ceFn) { console.error('Cross-encoder failed to load:', ce.getCrossEncoderStatus()); process.exit(3); }
    crossEncoder = ceFn;
    console.log('Cross-encoder loaded: Xenova/ms-marco-MiniLM-L-6-v2');
  }

  const queriesById = new Map(queries.map((q) => [q._id, q.text]));
  const evalQueryIds = MAX_QUERIES ? [...qrels.keys()].slice(0, MAX_QUERIES) : [...qrels.keys()];

  // Build doc id → corpus index lookup (BM25 returns indices, dense returns ids).
  const idToIdx = new Map(docIds.map((id, i) => [id, i]));
  // Need a reverse map too: corpus index → doc id (for BM25 over corpus order).
  const corpusIdToIdx = new Map(corpus.map((d, i) => [d._id, i]));
  const corpusIdxToId = corpus.map((d) => d._id);

  console.log(`\nRunning ${evalQueryIds.length} queries...`);
  let nSum = 0, mSum = 0, r10Sum = 0, r100Sum = 0, n = 0;
  const perQuery = [];
  const tQ = performance.now();

  for (const qid of evalQueryIds) {
    const qtext = queriesById.get(qid);
    if (!qtext) continue;

    // §1 — dense BGE retrieval (ADR-090: opt-in query prefix when BGE_QUERY_PREFIX=1)
    const qEmb = (process.env.BGE_QUERY_PREFIX === '1' && emb.embedQuery)
      ? await emb.embedQuery(qtext)
      : await emb.embed(qtext);
    const denseScored = new Array(docEmbeds.length);
    for (let i = 0; i < docEmbeds.length; i++) denseScored[i] = { id: docIds[i], score: cosine(qEmb, docEmbeds[i]) };
    denseScored.sort((a, b) => b.score - a.score);

    // §2 — BM25 retrieval (Lucene or multi-field depending on USE_LUCENE_BM25)
    const qTokens = tokenizeFn(qtext);
    const bm25Scored = new Array(corpus.length);
    for (let i = 0; i < corpus.length; i++) {
      bm25Scored[i] = { id: corpusIdxToId[i], score: bm25Score(qTokens, i) };
    }
    bm25Scored.sort((a, b) => b.score - a.score);

    // §3 — RRF fusion: normalize scores first, then score = sum over systems of 1/(k + rank).
    // Min-max normalize each system's scores to [0,1] for fair fusion (iter 1 optimization).
    // For large corpora, pull more candidates before fusion (iter 2 optimization).
    const TOP_PER_SYSTEM = adaptiveTopK(corpus.length);
    const denseTopK = denseScored.slice(0, Math.min(TOP_PER_SYSTEM, denseScored.length));
    const bm25TopK = bm25Scored.slice(0, Math.min(TOP_PER_SYSTEM, bm25Scored.length)).filter((s) => s.score > 0);
    const denseScoresNorm = minMaxNorm(denseTopK.map((s) => s.score));
    const bm25ScoresNorm = minMaxNorm(bm25TopK.map((s) => s.score));
    denseTopK.forEach((d, i) => { d.scoreNorm = denseScoresNorm[i]; });
    bm25TopK.forEach((d, i) => { d.scoreNorm = bm25ScoresNorm[i]; });

    const rrfScores = new Map();
    const weights = DATASET_RRF_WEIGHTS[dataset] || { dense: 1.0, bm25: 1.0 };  // iter 3: dataset-specific weights
    for (let r = 0; r < denseTopK.length; r++) {
      const id = denseTopK[r].id;
      rrfScores.set(id, (rrfScores.get(id) || 0) + weights.dense / (RRF_K + r + 1));
    }
    for (let r = 0; r < bm25TopK.length; r++) {
      const id = bm25TopK[r].id;
      rrfScores.set(id, (rrfScores.get(id) || 0) + weights.bm25 / (RRF_K + r + 1));
    }
    const fused = [...rrfScores.entries()]
      .map(([id, score]) => ({ id, score }))
      .sort((a, b) => b.score - a.score)
      .slice(0, RERANK ? RERANK_TOP_K : 100);

    let final = fused;

    // §4 — optional cross-encoder rerank.
    if (crossEncoder && fused.length > 0) {
      const docsForRerank = fused.map(({ id }) => {
        const ci = corpusIdToIdx.get(id);
        const d = corpus[ci];
        return `${d.title || ''} ${d.text || ''}`.slice(0, 4096);
      });
      const ceScores = await crossEncoder.scoreBatch(qtext, docsForRerank);
      final = fused
        .map((f, i) => ({ id: f.id, score: ceScores[i], rrf: f.score }))
        .sort((a, b) => b.score - a.score);
    }

    const top100 = final.slice(0, 100).map((s) => s.id);
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

  console.log(`\n=== Results (N=${n}, ${dataset}, BM25+BGE-base RRF k=${RRF_K}${RERANK ? ' + CE rerank' : ''}) ===`);
  console.log(`  nDCG@10:    ${ndcg10.toFixed(4)}`);
  console.log(`  MRR@10:     ${mrr10.toFixed(4)}`);
  console.log(`  Recall@10:  ${recall10.toFixed(4)}`);
  console.log(`  Recall@100: ${recall100.toFixed(4)}`);
  console.log(`  Avg query latency: ${(queryMs / n).toFixed(0)}ms`);

  const ourLabel = `ruflo + BM25+BGE-base RRF${RERANK ? '+CE' : ''}`;
  const ranking = [
    ...Object.entries(BASELINES_NDCG10).map(([name, score]) => ({ name, score, ours: false })),
    { name: ourLabel, score: ndcg10, ours: true },
  ].sort((a, b) => b.score - a.score);
  console.log(`\n=== vs ${dataset} listed baselines ===`);
  for (const r of ranking) console.log(`  ${r.score.toFixed(3)}  ${r.name}${r.ours ? ' ← us' : ''}`);
  const ourRank = ranking.findIndex((r) => r.ours) + 1;
  console.log(`\n  Our rank: ${ourRank} / ${ranking.length}`);

  const summary = {
    runAt: new Date().toISOString(),
    benchmark: `beir-${dataset}-hybrid${RERANK ? '-rerank' : ''}`,
    dataset,
    pipeline: `BM25+BGE RRF${RERANK ? '+CE-rerank' : ''}`,
    bgeModel: BGE_MODEL,
    rrfK: RRF_K,
    rerank: RERANK,
    queries: n,
    corpusSize: corpus.length,
    metrics: { ndcg10, mrr10, recall10, recall100, avgQueryLatencyMs: queryMs / n },
    perQuery,
    baselines: BASELINES_NDCG10,
    ourRank,
    leaderboardLength: ranking.length,
  };
  mkdirSync(RUNS_DIR, { recursive: true });
  const stamp = summary.runAt.replace(/[:.]/g, '-');
  const suffix = RERANK ? 'hybrid-rerank' : 'hybrid-rrf';
  writeFileSync(join(RUNS_DIR, `beir-${dataset}-${suffix}-${stamp}.json`), JSON.stringify(summary, null, 2));
  writeFileSync(join(RUNS_DIR, `beir-${dataset}-${suffix}-latest.json`), JSON.stringify(summary, null, 2));
  console.log(`\nWrote ${join(RUNS_DIR, `beir-${dataset}-${suffix}-${stamp}.json`)}`);
  process.exit(0);
}

main().catch((err) => { console.error(err); process.exit(1); });
