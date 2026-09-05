#!/usr/bin/env node
// benchmark-pretrained-retrieval.mjs — proof that pretrained patterns are
// retrievable, not just stored.
//
// Runs sample queries against the neural store (post-pretrain) and reports
// the top-k matches. Demonstrates that after `pretrain-from-github.mjs`
// runs, an agent can recall relevant past work by intent.
//
// Usage:
//   1. node scripts/pretrain-from-github.mjs           # populate the store
//   2. node scripts/benchmark-pretrained-retrieval.mjs # query + report

import { writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { performance } from 'node:perf_hooks';

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const CLI_ROOT = resolve(SCRIPT_DIR, '..');
const REPO_ROOT = resolve(SCRIPT_DIR, '../../../..');
const RUNS_DIR = join(REPO_ROOT, 'docs', 'benchmarks', 'runs');

// ADR-081 labelled held-out corpus. Each query has hand-curated
// `expectedSubstrings` — case-insensitive substring matches against the
// pattern's name. A result is "relevant" if its name contains ANY of the
// substrings. Tighter than the regex proxy used in ADRs 077-080 (which
// matched related-but-not-exact commits).
//
// `expect` (regex) is kept for backwards compatibility with the older
// numbers in ADRs 077-080. New metrics use expectedSubstrings.
const QUERIES = [
  {
    q: 'how was the Opus model alias fixed',
    expect: /opus|2232|model.*alias|4\.8/i,
    expectedSubstrings: ['opus 4.8', 'opus alias', 'opus model alias', '#2232'],
  },
  {
    q: 'self-learning wiring task-completed pretrain',
    expect: /self.?learning|task.?completed|pretrain|2245|074/i,
    expectedSubstrings: ['self-learning', 'adr-074', 'self learning', '#2245', 'task-completed'],
  },
  {
    q: 'deterministic codemod engine var-to-const',
    expect: /codemod|var.?to.?const|143|deterministic/i,
    expectedSubstrings: ['deterministic tier-1 codemod', 'adr-143', 'codemod', 'var-to-const'],
  },
  {
    q: 'MCP server orphan leak parent-death',
    expect: /mcp.*orphan|orphan.*mcp|parent.?death|leak/i,
    expectedSubstrings: ['mcp orphan', 'mcp servers orphan', 'parent-death', '#2234', 'orphan on every claude'],
  },
  {
    q: 'unified learning stats aggregator',
    expect: /unified|stats|aggregator|075/i,
    expectedSubstrings: ['unified learning-stats', 'adr-075', 'unified learning stats'],
  },
  {
    q: 'structured distillation 4-field schema',
    expect: /distillation|structured|076|4.?field/i,
    expectedSubstrings: ['structured distillation', 'adr-076', '4-field schema'],
  },
  {
    q: 'SQL injection migrate.ts table identifier',
    expect: /sql.?injection|migrate|table|identifier/i,
    expectedSubstrings: ['sql injection', 'shell injection', 'migrate.ts', 'agentdb', 'cve'],
  },
  {
    q: 'recall@k HNSW benchmark harness',
    expect: /recall|hnsw|benchmark|harness/i,
    expectedSubstrings: ['hnsw', 'memory-recall', 'benchmark suite', 'recall@k', 'benchmark intelligence'],
  },
  {
    q: 'Q-learning encoder keyword block',
    expect: /q.?learning|encoder|keyword|2239/i,
    expectedSubstrings: ['q-state encoder', 'route q-state', 'keyword block', '#2239', 'q-encoder'],
  },
  {
    q: 'security hardening crypto random IDs',
    expect: /security|hardening|crypto|random/i,
    expectedSubstrings: ['cwe-347', 'crypto.randomuuid', 'security fix', 'random id', 'crypto random'],
  },
];

/** Returns true if name contains ANY of the labelled substrings (case-insensitive). */
function isRelevant(name, expectedSubstrings) {
  if (!name || !expectedSubstrings?.length) return false;
  const lower = String(name).toLowerCase();
  return expectedSubstrings.some((s) => lower.includes(s.toLowerCase()));
}

/** nDCG@k with binary relevance (each relevant item contributes 1 / log2(i+1)). */
function ndcgAtK(rankedRelevance, k) {
  const arr = rankedRelevance.slice(0, k);
  const dcg = arr.reduce((acc, rel, i) => acc + (rel ? 1 / Math.log2(i + 2) : 0), 0);
  const numRelevant = arr.filter(Boolean).length;
  if (numRelevant === 0) return 0;
  // Ideal: all relevant items packed at positions 1..numRelevant
  let idcg = 0;
  for (let i = 0; i < numRelevant; i++) idcg += 1 / Math.log2(i + 2);
  return idcg > 0 ? dcg / idcg : 0;
}

const TOP_K = 5;

async function main() {
  const intel = await import(join(CLI_ROOT, 'dist/src/memory/intelligence.js'));
  const neural = await import(join(CLI_ROOT, 'dist/src/mcp-tools/neural-tools.js'));

  // §1 — snapshot the neural store + globalStats so we know what's there.
  const unified = await intel.getUnifiedLearningStats();
  const total = unified.neuralPatterns.patternCount;

  if (total === 0) {
    console.error('No patterns in neural store. Run scripts/pretrain-from-github.mjs first.');
    process.exit(2);
  }

  // §2 — A/B hybrid vs cosine-only (HYBRID=0 forces pre-3.10.18 behaviour).
  // Default runs hybrid (cosine + BM25 + MMR per ADR-078).
  const listTool = neural.neuralTools.find((t) => t.name === 'neural_patterns');
  const mode = process.env.HYBRID === '0' ? 'cosine' : 'hybrid';
  // ADR-080 opt-in cross-encoder rerank — set RERANK=1 to enable.
  const useRerank = process.env.RERANK === '1';

  // top-1-uniqueness — fraction of queries whose top-1 result is NOT the
  // same pattern ID as another query's top-1. Catches the "everyone gets
  // the same generic top-1" failure mode.
  const top1Ids = new Map();

  const tQuery0 = performance.now();
  const results = [];
  for (const { q, expect, expectedSubstrings } of QUERIES) {
    const r = await listTool.handler({ action: 'search', query: q, mode, limit: TOP_K, rerank: useRerank });
    const matches = (r.patterns || r.results || r.matches || []).slice(0, TOP_K);
    if (matches.length > 0) {
      const top1 = matches[0].id;
      top1Ids.set(top1, (top1Ids.get(top1) ?? 0) + 1);
    }

    // Two relevance signals per result:
    //   regexRel — old proxy (kept for back-compat with ADR-077-080 numbers)
    //   labelRel — ADR-081 hand-curated label match
    const regexRel = matches.map((m) => expect.test(m?.name ?? ''));
    const labelRel = matches.map((m) => isRelevant(m?.name, expectedSubstrings));

    // First rank where a labelled-relevant doc appears.
    let firstLabelRank = -1;
    for (let i = 0; i < matches.length; i++) {
      if (labelRel[i]) { firstLabelRank = i + 1; break; }
    }
    let firstRegexRank = -1;
    for (let i = 0; i < matches.length; i++) {
      if (regexRel[i]) { firstRegexRank = i + 1; break; }
    }

    results.push({
      query: q,
      matched: matches.length > 0,
      // Regex-proxy metrics (back-compat with ADR-077-080)
      top1Relevant: regexRel[0] || false,
      top3Relevant: regexRel.slice(0, 3).some(Boolean),
      firstRelevantRank: firstRegexRank,
      // ADR-081 labelled metrics
      label_top1: labelRel[0] || false,
      label_top3_count: labelRel.slice(0, 3).filter(Boolean).length,
      label_top5_count: labelRel.slice(0, 5).filter(Boolean).length,
      label_firstRank: firstLabelRank,
      label_ndcg3: ndcgAtK(labelRel, 3),
      label_ndcg5: ndcgAtK(labelRel, 5),
      topK: matches.map((m, i) => ({
        id: m.id,
        name: m.name?.slice(0, 100),
        type: m.type,
        score: m.score ?? m.similarity,
        cosineScore: m.cosineScore,
        bm25Score: m.bm25Score,
        mmrScore: m.mmrScore,
        labelRelevant: labelRel[i],
      })),
    });
  }
  const queryMs = performance.now() - tQuery0;

  const matchedQueries = results.filter((r) => r.matched).length;
  // Regex-proxy metrics (back-compat)
  const top1Hits = results.filter((r) => r.top1Relevant).length;
  const top3Hits = results.filter((r) => r.top3Relevant).length;
  const ranks = results.filter((r) => r.firstRelevantRank > 0).map((r) => r.firstRelevantRank);
  const mrr3 = QUERIES.length > 0
    ? Number((ranks.reduce((s, r) => s + 1 / r, 0) / QUERIES.length).toFixed(4))
    : 0;

  // ADR-081 labelled metrics — tighter ground truth than regex proxy.
  const label_top1Hits = results.filter((r) => r.label_top1).length;
  const label_top3HitsBinary = results.filter((r) => r.label_top3_count > 0).length;
  const label_ranks = results.filter((r) => r.label_firstRank > 0).map((r) => r.label_firstRank);
  const label_mrr3 = QUERIES.length > 0
    ? Number((label_ranks.reduce((s, r) => s + 1 / r, 0) / QUERIES.length).toFixed(4))
    : 0;
  const label_ndcg3_mean = QUERIES.length > 0
    ? Number((results.reduce((s, r) => s + r.label_ndcg3, 0) / QUERIES.length).toFixed(4))
    : 0;
  const label_ndcg5_mean = QUERIES.length > 0
    ? Number((results.reduce((s, r) => s + r.label_ndcg5, 0) / QUERIES.length).toFixed(4))
    : 0;
  // Mean precision@3 — fraction of top-3 that's relevant per query, averaged.
  const label_precision3 = QUERIES.length > 0
    ? Number((results.reduce((s, r) => s + r.label_top3_count / 3, 0) / QUERIES.length).toFixed(4))
    : 0;
  // top-1 collision: number of distinct top-1 IDs over the query count.
  const uniqueTop1 = top1Ids.size;
  const top1Diversity = Number((uniqueTop1 / QUERIES.length).toFixed(4));

  // top-3 redundancy: average fraction of top-3 results that are duplicates
  // of the same pattern within a single query (should be 0 — but if the same
  // ID appears twice in top-3 we surface it).
  let dupCount = 0, top3Slots = 0;
  for (const r of results) {
    const ids = r.topK.slice(0, 3).map((m) => m.id);
    top3Slots += ids.length;
    const seen = new Set();
    for (const id of ids) {
      if (seen.has(id)) dupCount++;
      seen.add(id);
    }
  }
  const top3DupRate = top3Slots > 0 ? Number((dupCount / top3Slots).toFixed(4)) : 0;

  const summary = {
    runAt: new Date().toISOString(),
    benchmark: 'pretrained-retrieval',
    mode,                              // ADR-078: which retrieval path was used
    rerank: useRerank,                 // ADR-080: cross-encoder rerank on/off
    storeSize: total,
    queries: QUERIES.length,
    matchedQueries,
    matchRate: Number((matchedQueries / QUERIES.length).toFixed(4)),
    // Regex-proxy metrics (ADR-077-080 back-compat)
    top1HitRate: Number((top1Hits / QUERIES.length).toFixed(4)),
    top3HitRate: Number((top3Hits / QUERIES.length).toFixed(4)),
    mrr3,
    // ADR-081 labelled metrics — tighter ground truth
    label_top1HitRate: Number((label_top1Hits / QUERIES.length).toFixed(4)),
    label_top3HitRate: Number((label_top3HitsBinary / QUERIES.length).toFixed(4)),
    label_mrr3,
    label_precision3,
    label_ndcg3: label_ndcg3_mean,
    label_ndcg5: label_ndcg5_mean,
    top1Diversity,                     // 1.0 = every query gets a distinct top-1
    top3DupRate,                       // 0.0 = no duplicate IDs inside any top-3
    avgQueryLatencyMs: Number((queryMs / QUERIES.length).toFixed(2)),
    totalQueryMs: Number(queryMs.toFixed(2)),
    results,
    passed: matchedQueries === QUERIES.length,
  };

  if (process.env.BENCH_JSON) {
    console.log(JSON.stringify(summary, null, 2));
  } else {
    console.log(`# Pretrained-retrieval benchmark — proof of learning`);
    console.log(`Mode: ${mode}${mode === 'hybrid' ? ' (cosine + BM25 + MMR, ADR-078)' : ' (cosine-only, pre-3.10.18)'}${useRerank ? ' + cross-encoder rerank (ADR-080)' : ''}`);
    console.log(`Store size: ${total} patterns`);
    console.log(`Queries: ${QUERIES.length}`);
    console.log(`Match rate: ${(summary.matchRate * 100).toFixed(0)}% (${matchedQueries}/${QUERIES.length})`);
    console.log(`Top-1 hit rate (regex proxy): ${(summary.top1HitRate * 100).toFixed(0)}% (${top1Hits}/${QUERIES.length})`);
    console.log(`Top-3 hit rate (regex proxy): ${(summary.top3HitRate * 100).toFixed(0)}% (${top3Hits}/${QUERIES.length})`);
    console.log(`MRR@3 (regex proxy):          ${summary.mrr3}`);
    console.log('');
    console.log(`Top-1 hit rate (ADR-081 labelled): ${(summary.label_top1HitRate * 100).toFixed(0)}% (${label_top1Hits}/${QUERIES.length})`);
    console.log(`Top-3 hit rate (ADR-081 labelled): ${(summary.label_top3HitRate * 100).toFixed(0)}% (${label_top3HitsBinary}/${QUERIES.length})`);
    console.log(`MRR@3 (labelled):                  ${summary.label_mrr3}`);
    console.log(`Precision@3 (labelled, mean):      ${summary.label_precision3}`);
    console.log(`nDCG@3 (labelled, mean):           ${summary.label_ndcg3}`);
    console.log(`nDCG@5 (labelled, mean):           ${summary.label_ndcg5}`);
    console.log(`Top-1 diversity: ${(summary.top1Diversity * 100).toFixed(0)}% (${uniqueTop1} distinct top-1 IDs across ${QUERIES.length} queries)`);
    console.log(`Top-3 dup rate: ${(summary.top3DupRate * 100).toFixed(0)}%`);
    console.log(`Avg query latency: ${summary.avgQueryLatencyMs} ms`);
    console.log('');
    for (const r of results) {
      console.log(`Q: "${r.query}"`);
      if (r.topK.length === 0) {
        console.log(`   → no matches`);
      } else {
        for (const m of r.topK.slice(0, 3)) {
          console.log(`   → ${m.score?.toFixed?.(3) ?? '—'}  ${m.name}`);
        }
      }
    }
    console.log('');
    console.log(`Overall: ${summary.passed ? '✅ PASSED' : '⚠️  partial'}`);
  }

  if (!process.env.BENCH_NO_WRITE) {
    mkdirSync(RUNS_DIR, { recursive: true });
    const stamp = summary.runAt.replace(/[:.]/g, '-');
    writeFileSync(join(RUNS_DIR, `pretrained-retrieval-${stamp}.json`), JSON.stringify(summary, null, 2));
    writeFileSync(join(RUNS_DIR, 'pretrained-retrieval-latest.json'), JSON.stringify(summary, null, 2));
    if (!process.env.BENCH_JSON) console.log(`\nWrote ${join(RUNS_DIR, `pretrained-retrieval-${stamp}.json`)}`);
  }

  // ONNX runtime keeps a worker thread alive — force exit.
  process.exit(summary.passed ? 0 : 1);
}

main().catch((err) => { console.error(err); process.exit(1); });
