#!/usr/bin/env node
/**
 * Dream Cycle 2026-08-18 — hybridSearch retrieval-quality benchmark
 *
 * Quantifies the actual recall@10 / MRR benefit of the already-built
 * three-arm hybridSearch controller (dense HNSW + sparse FTS5 keyword +
 * entity-linking, RRF + MMR fused) over the vector-only `semanticSearch()`
 * path every production caller gets today, now that the 2026-08-18 fix
 * (`controller-registry.ts`) makes hybridSearch reachable via explicit
 * `controllers: { hybridSearch: true }` opt-in without a hand-built
 * `UnifiedMemoryService`.
 *
 * Zero LLM calls, $0 cost, fully deterministic (seeded PRNG). Run against
 * the SAME corpus + SAME stored embeddings for both arms — only the
 * retrieval path differs (baseline: `semanticSearch()` only; candidate:
 * the hybridSearch controller).
 *
 * Per the 2026-08-18 Deep Researcher finding (vstash, arXiv 2604.15484,
 * Apr 2026): hybrid fusion roughly MATCHES the stronger single signal in
 * aggregate — its real value is per-query-type robustness where dense and
 * sparse disagree. This benchmark therefore reports FOUR separate query
 * categories rather than one aggregate number, to avoid a misleading
 * "no significant gain" read on a metric average that hides where the
 * fusion actually helps.
 *
 * Usage: node benchmarks/results/scripts/hybridsearch-quality-benchmark.mjs
 * (run from v3/@claude-flow/memory, against the built dist/)
 */

import { UnifiedMemoryService } from '../../../dist/index.js';
import { ControllerRegistry } from '../../../dist/controller-registry.js';
import { createDefaultEntry } from '../../../dist/types.js';

const DIM = 16;
const TOP_K = 10;
const INSTANCES_PER_CATEGORY = 15;

// ---- Deterministic PRNG (xorshift32, seeded) ----
function makeRng(seed) {
  let s = seed | 0 || 1;
  return () => {
    s ^= s << 13; s ^= s >>> 17; s ^= s << 5;
    return (s >>> 0) / 0xffffffff;
  };
}

function hashStr(s) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h) + 1;
}

// A "topic" embedding: deterministic base vector from a topic id, so text
// assigned the same topic id clusters in vector space regardless of its
// literal wording — simulating what a real semantic embedder does for
// paraphrases, without needing a real (costly) embedding model.
function topicVec(topicId, dim = DIM) {
  const rng = makeRng(hashStr(`topic:${topicId}`));
  const v = new Float32Array(dim);
  for (let i = 0; i < dim; i++) v[i] = rng() * 2 - 1;
  return v;
}

function withNoise(vec, rng, amount = 0.05) {
  const out = new Float32Array(vec.length);
  for (let i = 0; i < vec.length; i++) out[i] = vec[i] + (rng() * 2 - 1) * amount;
  return out;
}

// ---- Corpus + query generation (frozen design — written before any run) ----

function buildCorpus() {
  const entries = []; // { key, content, embedding, topicId }
  const queries = []; // { category, query, targetKey, queryEmbedding }
  const rng = makeRng(hashStr('dream-cycle-2026-08-18-hybridsearch-corpus'));

  // Category A — keyword-exact: target has a literal rare token the query
  // also contains, but its topic embedding is DELIBERATELY unrelated to the
  // query's topic. Distractors sit near the query's topic (semantically
  // plausible) but never mention the rare token. Dense-only should miss the
  // target; sparse/hybrid should catch it via the exact-token match.
  for (let i = 0; i < INSTANCES_PER_CATEGORY; i++) {
    const rareToken = `xreindex${7000 + i}gamma`;
    const queryTopic = `db-ops-${i}`;
    const unrelatedTopic = `weather-report-${i}`;
    const query = `find the log entry about ${rareToken} checkpoint status`;
    const targetKey = `catA-target-${i}`;
    entries.push({
      key: targetKey,
      content: `system log entry: ${rareToken} completed at checkpoint 7`,
      embedding: withNoise(topicVec(unrelatedTopic), rng),
    });
    for (let d = 0; d < 4; d++) {
      entries.push({
        key: `catA-distractor-${i}-${d}`,
        content: `notes about routine database reindexing operations and maintenance windows ${d}`,
        embedding: withNoise(topicVec(queryTopic), rng),
      });
    }
    // queryEmbeddingTopic pins the resolved query embedding to the SAME
    // topic used for the distractors above, so the dense arm genuinely
    // prefers the distractors (plausible-but-wrong) over the target —
    // without this, the query would hash to an unrelated vector and the
    // "dense should miss this" premise wouldn't hold.
    queries.push({ category: 'A-keyword-exact', query, targetKey, queryEmbeddingTopic: queryTopic });
  }

  // Category B — paraphrase-semantic: target shares almost no literal
  // tokens with the query but its topic embedding is close (paraphrase).
  // Distractors are topically unrelated. Sparse-only should largely miss
  // the target; dense/hybrid should catch it via embedding proximity.
  const paraphrasePairs = [
    ['How do I fix a database that responds slowly to lookups?',
     'Query latency was high because the index needed a rebuild; the rebuild resolved it.'],
    ['What causes an agent to repeat the same failed tool call?',
     'The retry loop lacked a backoff and kept re-issuing an identical request.'],
    ['Why did the deployment roll back automatically?',
     'The health check threshold was breached so the release manager reverted the change.'],
  ];
  for (let i = 0; i < INSTANCES_PER_CATEGORY; i++) {
    const [queryBase, paraphrase] = paraphrasePairs[i % paraphrasePairs.length];
    // Each instance needs a distinct query string (else the embeddingGenerator
    // lookup below would collide across instances that reuse the same base
    // question text and resolve to the wrong instance's topic).
    const query = `${queryBase} (case ${i})`;
    const sharedTopic = `paraphrase-topic-${i}`;
    const targetKey = `catB-target-${i}`;
    entries.push({
      key: targetKey,
      content: `${paraphrase} (case ${i})`,
      embedding: withNoise(topicVec(sharedTopic), rng),
    });
    for (let d = 0; d < 4; d++) {
      entries.push({
        key: `catB-distractor-${i}-${d}`,
        content: `unrelated household gardening tip number ${d} for case ${i}`,
        embedding: withNoise(topicVec(`unrelated-${i}-${d}`), rng),
      });
    }
    // The query itself is embedded near the same shared topic — this is
    // what happens when a real embedder captures paraphrase similarity.
    queries.push({
      category: 'B-paraphrase-semantic',
      query,
      targetKey,
      queryEmbeddingTopic: sharedTopic,
    });
  }

  // Category C — entity: a distinctive named entity in the target, absent
  // from distractors; query names the entity. Target's topic embedding is
  // deliberately unrelated to the query (dense alone should miss it);
  // the entity arm (keyword search on the extracted proper noun) should
  // catch it.
  const names = ['Priya Natarajan', 'Diego Alvarez', 'Wen Zhao', 'Aisha Bello', 'Lars Eriksson'];
  for (let i = 0; i < INSTANCES_PER_CATEGORY; i++) {
    const name = names[i % names.length];
    // Unique per instance (case suffix) — avoids collisions in the
    // embeddingGenerator's query-text lookup and keeps every instance
    // independently addressable even though names repeat every 5 cases.
    const query = `what did ${name} decide about the release (case ${i})`;
    const targetKey = `catC-target-${i}`;
    const distractorTopic = `entity-distractor-${i}`;
    entries.push({
      key: targetKey,
      content: `${name} approved the release plan after the review meeting (case ${i})`,
      embedding: withNoise(topicVec(`entity-unrelated-${i}`), rng),
    });
    for (let d = 0; d < 4; d++) {
      entries.push({
        key: `catC-distractor-${i}-${d}`,
        content: `generic release notes and changelog entry ${d} for case ${i}`,
        embedding: withNoise(topicVec(distractorTopic), rng),
      });
    }
    // Pin the query embedding to the distractors' topic — same rationale
    // as category A: without this, dense wouldn't even plausibly prefer
    // the distractors, weakening the "entity arm rescues it" premise.
    queries.push({ category: 'C-entity', query, targetKey, queryEmbeddingTopic: distractorTopic });
  }

  // Category D — mixed/control: target has BOTH topic proximity AND some
  // keyword overlap with the query. Expect both baseline and candidate
  // near ceiling here — a control group, not a differentiator.
  for (let i = 0; i < INSTANCES_PER_CATEGORY; i++) {
    const sharedTopic = `mixed-topic-${i}`;
    const query = `release checklist deployment status case ${i}`;
    const targetKey = `catD-target-${i}`;
    entries.push({
      key: targetKey,
      content: `release checklist deployment status update for case ${i}`,
      embedding: withNoise(topicVec(sharedTopic), rng),
    });
    for (let d = 0; d < 4; d++) {
      entries.push({
        key: `catD-distractor-${i}-${d}`,
        content: `unrelated topic filler entry ${d} case ${i}`,
        embedding: withNoise(topicVec(`mixed-distractor-${i}-${d}`), rng),
      });
    }
    queries.push({ category: 'D-mixed-control', query, targetKey, queryEmbeddingTopic: sharedTopic });
  }

  return { entries, queries, rng };
}

// The query's OWN embedding (used by the dense arm) must be derived
// consistently: for categories where we declared a `queryEmbeddingTopic`,
// use that topic's vector (simulating a real embedder placing the query
// near its true paraphrase/topic cluster). Otherwise, hash the raw query
// text (a generic embedder would place an out-of-topic query arbitrarily —
// here, deliberately NOT matching the target's unrelated-topic vector,
// matching categories A/C's design: dense should not accidentally solve
// the query it wasn't designed to solve).
//
// CRITICAL FAIRNESS REQUIREMENT: the candidate path (hybridSearch) calls
// `adapter.semanticSearch(queryText, ...)` internally, which computes its
// OWN embedding from raw text via `config.embeddingGenerator` — it never
// sees the hand-crafted Float32Array this function returns. If the service
// has no `embeddingGenerator` configured, ADR-125's graceful-degradation
// path makes `semanticSearch()` silently fall back to keyword-only search,
// which would make the "dense arm" inside hybridSearch secretly identical
// to its sparse arm — an unfair, misleading comparison against a baseline
// that DOES get the real hand-crafted embedding via `svc.search(embedding)`.
// So this exact function is also wired as the service's `embeddingGenerator`
// (see `main()`) — both paths resolve the SAME query text to the SAME
// vector. Only the retrieval algorithm differs between baseline/candidate.
function queryEmbedding(query, queryEmbeddingTopic) {
  if (queryEmbeddingTopic) return topicVec(queryEmbeddingTopic);
  return topicVec(`query-text:${query}`);
}

function rankOf(results, targetKey) {
  const idx = results.findIndex((r) => (r.entry ? r.entry.key : r.key) === targetKey);
  return idx === -1 ? null : idx + 1;
}

function pairedTTest(a, b) {
  const n = a.length;
  const diffs = a.map((v, i) => v - b[i]);
  const mean = diffs.reduce((s, v) => s + v, 0) / n;
  const variance = diffs.reduce((s, v) => s + (v - mean) ** 2, 0) / (n - 1); // sample stddev — 08-17 bugfix precedent
  const se = Math.sqrt(variance / n);
  const t = se === 0 ? (mean === 0 ? 0 : Infinity) : mean / se;
  return { meanDiff: mean, t, n };
}

async function main() {
  const { entries, queries } = buildCorpus();

  // Same embedding function for both paths (see fairness note above).
  const svc = new UnifiedMemoryService({
    dimensions: DIM,
    persistenceEnabled: false,
    snapshotInterval: 0,
    embeddingGenerator: async (text) => {
      const q = queries.find((q) => q.query === text);
      return queryEmbedding(text, q?.queryEmbeddingTopic);
    },
  });
  await svc.initialize();

  for (const e of entries) {
    const entry = createDefaultEntry({ key: e.key, content: e.content });
    entry.embedding = e.embedding;
    await svc.store(entry);
  }

  // Candidate path: explicit opt-in, backend-only (no memoryService) —
  // exercises exactly the 2026-08-18 fix, not a hand-built memoryService.
  const registry = new ControllerRegistry();
  await registry.initialize({
    backend: svc.getAdapter(),
    controllers: { hybridSearch: true },
  });
  const hybrid = registry.get('hybridSearch');
  if (!hybrid) throw new Error('hybridSearch controller did not construct — candidate regressed');

  const byCategory = {};

  for (const q of queries) {
    const qEmb = queryEmbedding(q.query, q.queryEmbeddingTopic);

    // Baseline: what every production caller gets today (vector-only).
    const baselineResults = await svc.search(qEmb, { k: TOP_K });
    const baselineRank = rankOf(baselineResults, q.targetKey);

    // Candidate: hybridSearch (dense + sparse + entity, RRF + MMR).
    const hybridResults = await hybrid.search(q.query, { limit: TOP_K });
    const hybridRank = rankOf(hybridResults, q.targetKey);

    const bucket = (byCategory[q.category] ??= { baselineRR: [], hybridRR: [], baselineRecall: [], hybridRecall: [] });
    bucket.baselineRR.push(baselineRank ? 1 / baselineRank : 0);
    bucket.hybridRR.push(hybridRank ? 1 / hybridRank : 0);
    bucket.baselineRecall.push(baselineRank ? 1 : 0);
    bucket.hybridRecall.push(hybridRank ? 1 : 0);
  }

  const report = { generatedAt: 'dream-cycle-2026-08-18', dim: DIM, topK: TOP_K, instancesPerCategory: INSTANCES_PER_CATEGORY, categories: {} };

  console.log('\n=== hybridSearch quality benchmark — Dream Cycle 2026-08-18 ===\n');
  console.log(`corpus: ${entries.length} entries, ${queries.length} queries (${INSTANCES_PER_CATEGORY}/category)\n`);

  let overallBaselineRecall = [];
  let overallHybridRecall = [];

  for (const [category, b] of Object.entries(byCategory)) {
    const mean = (arr) => arr.reduce((s, v) => s + v, 0) / arr.length;
    const mrrTest = pairedTTest(b.hybridRR, b.baselineRR);
    const recallDelta = mean(b.hybridRecall) - mean(b.baselineRecall);

    report.categories[category] = {
      n: b.baselineRR.length,
      baselineRecallAt10: mean(b.baselineRecall),
      hybridRecallAt10: mean(b.hybridRecall),
      recallDelta,
      baselineMRR: mean(b.baselineRR),
      hybridMRR: mean(b.hybridRR),
      mrrPairedT: mrrTest.t,
      mrrMeanDiff: mrrTest.meanDiff,
    };

    console.log(`[${category}] n=${b.baselineRR.length}`);
    console.log(`  recall@10   baseline=${mean(b.baselineRecall).toFixed(3)}  hybrid=${mean(b.hybridRecall).toFixed(3)}  Δ=${(recallDelta >= 0 ? '+' : '') + recallDelta.toFixed(3)}`);
    console.log(`  MRR         baseline=${mean(b.baselineRR).toFixed(3)}  hybrid=${mean(b.hybridRR).toFixed(3)}  Δ=${(mrrTest.meanDiff >= 0 ? '+' : '') + mrrTest.meanDiff.toFixed(3)}  t=${mrrTest.t.toFixed(2)}`);
    console.log('');

    overallBaselineRecall = overallBaselineRecall.concat(b.baselineRecall);
    overallHybridRecall = overallHybridRecall.concat(b.hybridRecall);
  }

  const overallMean = (arr) => arr.reduce((s, v) => s + v, 0) / arr.length;
  report.overall = {
    n: overallBaselineRecall.length,
    baselineRecallAt10: overallMean(overallBaselineRecall),
    hybridRecallAt10: overallMean(overallHybridRecall),
    recallDelta: overallMean(overallHybridRecall) - overallMean(overallBaselineRecall),
  };
  console.log(`[OVERALL] n=${report.overall.n}  recall@10 baseline=${report.overall.baselineRecallAt10.toFixed(3)} hybrid=${report.overall.hybridRecallAt10.toFixed(3)} Δ=${(report.overall.recallDelta >= 0 ? '+' : '') + report.overall.recallDelta.toFixed(3)}`);

  await registry.shutdown();
  await svc.close();

  const fs = await import('node:fs');
  const path = await import('node:path');
  const outPath = path.join(import.meta.dirname, '..', 'hybridsearch-quality-receipt.json');
  fs.writeFileSync(outPath, JSON.stringify(report, null, 2));
  console.log(`\nReceipt written to ${outPath}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
