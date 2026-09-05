#!/usr/bin/env node
// run-beir-nfcorpus.mjs — public benchmark harness for BEIR NFCorpus.
//
// Why NFCorpus: smallest BEIR dataset (3.6k docs, 323 test queries) with a
// well-published BM25 baseline and dense-retriever ceilings — runs end-to-end
// in <15 min on this hardware.
//
// Setup:
//   mkdir -p /tmp/beir-nfcorpus && cd /tmp/beir-nfcorpus
//   curl -sL -o nfcorpus.zip 'https://public.ukp.informatik.tu-darmstadt.de/thakur/BEIR/datasets/nfcorpus.zip'
//   unzip -q nfcorpus.zip
//
// Run:
//   cd /tmp/beir-nfcorpus && rm -rf .claude-flow
//   node /path/to/scripts/run-beir-nfcorpus.mjs
//
// Reports:
//   - nDCG@10 (graded, BEIR standard)
//   - MRR@10
//   - Recall@10, Recall@100
//   - Published comparisons (BM25, ColBERT, SPLADE, etc.)

import { readFileSync, writeFileSync, mkdirSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { performance } from 'node:perf_hooks';

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const CLI_ROOT = resolve(SCRIPT_DIR, '..');
const RUFLO_ROOT = resolve(SCRIPT_DIR, '../../../..');
const RUNS_DIR = join(RUFLO_ROOT, 'docs', 'benchmarks', 'runs');

const DATA_DIR = process.env.BEIR_DATA_DIR || '/tmp/beir-nfcorpus/nfcorpus';
const TOP_K = Number(process.env.TOP_K) || 100;     // top-100 for recall@100
const NDCG_K = 10;
const MAX_QUERIES = Number(process.env.MAX_QUERIES) || 0;  // 0 = all
const SKIP_INGEST = process.env.SKIP_INGEST === '1'; // reuse existing store

// Published BEIR NFCorpus baselines (from Thakur et al. 2021 + leaderboard tracker)
const BASELINES_NDCG10 = {
  'BM25':            0.325,
  'DocT5query':      0.328,
  'SBERT (msmarco)': 0.272,  // dense bi-encoder on MS MARCO
  'TAS-B':           0.319,
  'GenQ':            0.319,
  'ColBERT':         0.305,
  'SPLADE++':        0.347,  // top dense at time of paper
  'Contriever':      0.328,
  'GTR-XL':          0.343,
  'BGE-large-v1.5':  0.380,  // current ~top-of-class
};

// ---------------------------------------------------------------------------
// nDCG with graded relevance (BEIR standard)
// ---------------------------------------------------------------------------

function dcg(rels, k) {
  let s = 0;
  for (let i = 0; i < Math.min(rels.length, k); i++) {
    s += (Math.pow(2, rels[i]) - 1) / Math.log2(i + 2);
  }
  return s;
}

function ndcg(retrievedDocIds, qrelsMap, k) {
  const rels = retrievedDocIds.slice(0, k).map((id) => qrelsMap.get(id) ?? 0);
  const ideal = [...qrelsMap.values()].sort((a, b) => b - a).slice(0, k);
  const idcg = dcg(ideal, k);
  return idcg > 0 ? dcg(rels, k) / idcg : 0;
}

function mrr(retrievedDocIds, qrelsMap, k) {
  for (let i = 0; i < Math.min(retrievedDocIds.length, k); i++) {
    if ((qrelsMap.get(retrievedDocIds[i]) ?? 0) > 0) return 1 / (i + 1);
  }
  return 0;
}

function recall(retrievedDocIds, qrelsMap, k) {
  const totalRelevant = [...qrelsMap.values()].filter((v) => v > 0).length;
  if (totalRelevant === 0) return 0;
  let hit = 0;
  for (let i = 0; i < Math.min(retrievedDocIds.length, k); i++) {
    if ((qrelsMap.get(retrievedDocIds[i]) ?? 0) > 0) hit++;
  }
  return hit / totalRelevant;
}

// ---------------------------------------------------------------------------
// Loaders
// ---------------------------------------------------------------------------

function loadJsonl(path) {
  const items = [];
  for (const line of readFileSync(path, 'utf-8').split('\n')) {
    if (!line.trim()) continue;
    items.push(JSON.parse(line));
  }
  return items;
}

function loadQrels(path) {
  // Map<queryId, Map<docId, grade>>
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
// Main
// ---------------------------------------------------------------------------

async function main() {
  console.log(`# BEIR NFCorpus benchmark (ADR-085)`);
  console.log(`Data: ${DATA_DIR}`);
  console.log(`Cwd: ${process.cwd()}`);

  const corpus = loadJsonl(join(DATA_DIR, 'corpus.jsonl'));
  const queries = loadJsonl(join(DATA_DIR, 'queries.jsonl'));
  const qrels = loadQrels(join(DATA_DIR, 'qrels/test.tsv'));

  console.log(`Corpus: ${corpus.length} docs, ${queries.length} queries (total), ${qrels.size} eval queries (test split)`);

  const neural = await import(join(CLI_ROOT, 'dist/src/mcp-tools/neural-tools.js'));
  const tool = neural.neuralTools.find((t) => t.name === 'neural_patterns');

  // §1 — Ingest corpus (id-stable pattern name = doc _id; content = title + text).
  // Skip if SKIP_INGEST=1 and store already populated.
  if (!SKIP_INGEST) {
    console.log(`\nIngesting ${corpus.length} docs...`);
    const t0 = performance.now();
    // Batch in chunks to avoid memory pressure.
    const CHUNK = 200;
    for (let i = 0; i < corpus.length; i += CHUNK) {
      const batch = corpus.slice(i, i + CHUNK);
      await neural.storeNeuralPatterns(batch.map((d) => ({
        name: d._id,                         // use _id as the stable identifier
        type: 'beir-nfcorpus',
        content: `${d.title || ''}\n${d.text || ''}`.slice(0, 4096),
      })));
      if ((i + CHUNK) % 1000 === 0 || i + CHUNK >= corpus.length) {
        const pct = Math.min(100, ((i + CHUNK) / corpus.length * 100)).toFixed(0);
        const elapsed = (performance.now() - t0) / 1000;
        console.log(`  ${Math.min(i + CHUNK, corpus.length)}/${corpus.length} (${pct}%) in ${elapsed.toFixed(0)}s`);
      }
    }
    console.log(`Ingest done in ${((performance.now() - t0) / 1000).toFixed(0)}s`);
  } else {
    console.log('SKIP_INGEST=1 → reusing existing store');
  }

  // §2 — Build query lookup (eval queries only).
  const queriesById = new Map(queries.map((q) => [q._id, q.text]));
  const evalQueryIds = MAX_QUERIES
    ? [...qrels.keys()].slice(0, MAX_QUERIES)
    : [...qrels.keys()];

  // §3 — Run retrieval for each query, compute metrics.
  console.log(`\nRunning ${evalQueryIds.length} queries...`);
  let ndcgSum = 0, mrrSum = 0, recall10Sum = 0, recall100Sum = 0;
  const tQ = performance.now();
  let queryIdx = 0;
  for (const qid of evalQueryIds) {
    const qtext = queriesById.get(qid);
    if (!qtext) { queryIdx++; continue; }
    const r = await tool.handler({ action: 'search', query: qtext, mode: 'hybrid', limit: TOP_K, rerank: false });
    const retrievedIds = (r.results || []).map((m) => m.name);  // we set name = _id
    const qrelsMap = qrels.get(qid) || new Map();
    ndcgSum += ndcg(retrievedIds, qrelsMap, NDCG_K);
    mrrSum += mrr(retrievedIds, qrelsMap, NDCG_K);
    recall10Sum += recall(retrievedIds, qrelsMap, 10);
    recall100Sum += recall(retrievedIds, qrelsMap, 100);
    queryIdx++;
    if (queryIdx % 50 === 0) {
      const elapsed = (performance.now() - tQ) / 1000;
      console.log(`  ${queryIdx}/${evalQueryIds.length} in ${elapsed.toFixed(0)}s — running nDCG@10=${(ndcgSum / queryIdx).toFixed(4)}`);
    }
  }
  const queryMs = performance.now() - tQ;
  const N = evalQueryIds.length;
  const ndcg10 = ndcgSum / N;
  const mrr10 = mrrSum / N;
  const recall10 = recall10Sum / N;
  const recall100 = recall100Sum / N;

  console.log(`\n=== Results (N=${N} queries) ===`);
  console.log(`  nDCG@10:    ${ndcg10.toFixed(4)}`);
  console.log(`  MRR@10:     ${mrr10.toFixed(4)}`);
  console.log(`  Recall@10:  ${recall10.toFixed(4)}`);
  console.log(`  Recall@100: ${recall100.toFixed(4)}`);
  console.log(`  Avg query latency: ${(queryMs / N).toFixed(0)}ms`);

  console.log(`\n=== vs published NFCorpus nDCG@10 baselines ===`);
  const ourEntry = { name: 'ruflo hybrid (3.10.25)', score: ndcg10, ours: true };
  const ranking = [
    ...Object.entries(BASELINES_NDCG10).map(([name, score]) => ({ name, score, ours: false })),
    ourEntry,
  ].sort((a, b) => b.score - a.score);
  for (const r of ranking) {
    const marker = r.ours ? ' ← us' : '';
    console.log(`  ${r.score.toFixed(3)}  ${r.name}${marker}`);
  }
  const ourRank = ranking.findIndex((r) => r.ours) + 1;
  console.log(`\n  Our rank: ${ourRank} / ${ranking.length}`);

  const summary = {
    runAt: new Date().toISOString(),
    benchmark: 'beir-nfcorpus',
    queries: N,
    corpusSize: corpus.length,
    metrics: { ndcg10, mrr10, recall10, recall100, avgQueryLatencyMs: queryMs / N },
    baselines: BASELINES_NDCG10,
    ourRank,
    leaderboardLength: ranking.length,
  };
  mkdirSync(RUNS_DIR, { recursive: true });
  const stamp = summary.runAt.replace(/[:.]/g, '-');
  writeFileSync(join(RUNS_DIR, `beir-nfcorpus-${stamp}.json`), JSON.stringify(summary, null, 2));
  writeFileSync(join(RUNS_DIR, 'beir-nfcorpus-latest.json'), JSON.stringify(summary, null, 2));
  console.log(`\nWrote ${join(RUNS_DIR, `beir-nfcorpus-${stamp}.json`)}`);

  process.exit(0);
}

main().catch((err) => { console.error(err); process.exit(1); });
