#!/usr/bin/env node
// benchmark-cross-repo.mjs — cross-repo generalisation proof (ADR-084).
//
// Pretrains on a DIFFERENT repo's history (default: ruvnet/agentdb) and runs
// labelled queries about THAT repo's work. If the retrieval system genuinely
// generalises (vs overfits to the ruflo corpus it was tuned on), nDCG@3
// should stay near 0.96.
//
// Usage:
//   1. cd /tmp/agentdb-bench
//   2. REPO_ROOT=/tmp/agentdb-bench GH_REPO=ruvnet/agentdb \
//        node /path/to/pretrain-from-github.mjs    # writes /tmp/agentdb-bench/.claude-flow/neural/
//   3. cd /tmp/agentdb-bench && node /path/to/benchmark-cross-repo.mjs
//
// Or use the wrapper at the bottom that does both steps with --repo=<name>.

import { writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { performance } from 'node:perf_hooks';

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const CLI_ROOT = resolve(SCRIPT_DIR, '..');
const RUFLO_ROOT = resolve(SCRIPT_DIR, '../../../..');
const RUNS_DIR = join(RUFLO_ROOT, 'docs', 'benchmarks', 'runs');

// Labelled queries about agentdb's actual history (commits + issues
// observed via `git log` + `gh issue list` on ruvnet/agentdb).
// Each query targets a specific piece of work; labels are case-insensitive
// substring matches against the pattern name.
const QUERIES_AGENTDB = [
  { q: 'SQL injection fix REINDEX',
    labels: ['sql injection', 'reindex'] },
  { q: 'insecure PRNG random IDs',
    labels: ['insecure prng', 'random ids', 'random id', 'crypto', 'uuid'] },
  { q: 'JSON parse crash hardening',
    labels: ['json.parse', 'json parse', 'crash hardening'] },
  { q: 'protobuf critical CVE patch',
    labels: ['protobufjs', 'protobuf', 'cve'] },
  { q: 'spawnSync vs execSync security',
    labels: ['spawnsync', 'execsync'] },
  { q: 'better-sqlite3 inline schemas',
    labels: ['better-sqlite3', 'inline schema', 'schemas'] },
  { q: 'Claude Code marketplace plugins',
    labels: ['marketplace', 'plugin', 'claude code'] },
  { q: 'README rewrite ruflo style',
    labels: ['readme', 'rewrite'] },
  { q: 'WASM browser fs.readFileSync blocking',
    labels: ['wasm', 'browser', 'fs.readfilesync', 'readfilesync', 'agentdb/wasm'] },
  { q: 'AgentDB missing schema files',
    labels: ['missing schema', 'mising schema', 'schema files', 'not working'] },
];

// Labelled queries about agentic-flow's actual history.
const QUERIES_AGENTIC_FLOW = [
  { q: 'CWE-78 shell injection fix',
    labels: ['cwe-78', 'shell injection', 'execsync', 'safe-exec'] },
  { q: 'SSRF hardcoded key NaN panic security',
    labels: ['ssrf', 'hardcoded key', 'nan-panic', 'nan panic'] },
  { q: 'WebSocket QUIC transport fallback',
    labels: ['websocket', 'quic', 'transport'] },
  { q: 'agentdb submodule bump',
    labels: ['agentdb submodule', 'bump agentdb', 'submodule'] },
  { q: 'sql.js prepared statement leak',
    labels: ['sql.js', 'prepared statement', 'leak'] },
  { q: 'WASM ADR-071 integration',
    labels: ['wasm', 'adr-071', 'wasm-integration'] },
  { q: 'patch CVEs transitive overrides',
    labels: ['cve', 'patch', 'transitive', 'overrides'] },
  { q: 'GraphDatabaseAdapter delete API',
    labels: ['graphdatabaseadapter', 'delete api', 'reflexionmemory', 'deleteepisode'] },
  { q: 'release alpha publish version',
    labels: ['release', 'publish', 'alpha', 'version'] },
  { q: 'extract packages to dedicated repo',
    labels: ['extract', 'refactor', 'dedicated repo', 'submodule', 'agentdb'] },
];

// Auto-pick query set based on GH_REPO env var.
const QUERY_SETS = {
  'ruvnet/agentdb': QUERIES_AGENTDB,
  'ruvnet/agentic-flow': QUERIES_AGENTIC_FLOW,
};
const QUERIES = QUERY_SETS[process.env.GH_REPO] || QUERIES_AGENTDB;
const TOP_K = 5;

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

async function evalConfig(tool, params) {
  let top1 = 0, top3 = 0, ranks = [], ndcg3sum = 0, ndcg5sum = 0, p3sum = 0;
  const t0 = performance.now();
  const perQuery = [];
  for (const { q, labels } of QUERIES) {
    const r = await tool.handler({ action: 'search', query: q, mode: 'hybrid', limit: TOP_K, ...params });
    const matches = (r.results || []).slice(0, TOP_K);
    const rel = matches.map((m) => isRelevant(m?.name, labels));
    if (rel[0]) top1++;
    if (rel.slice(0, 3).some(Boolean)) top3++;
    const firstRank = rel.findIndex(Boolean);
    if (firstRank >= 0) ranks.push(firstRank + 1);
    ndcg3sum += ndcgAtK(rel, 3);
    ndcg5sum += ndcgAtK(rel, 5);
    p3sum += rel.slice(0, 3).filter(Boolean).length / 3;
    perQuery.push({ q, top1: rel[0] || false, topK: matches.map((m, i) => ({ name: m.name?.slice(0, 90), relevant: rel[i], score: (m.score ?? m.similarity)?.toFixed?.(3) })) });
  }
  const elapsed = performance.now() - t0;
  return {
    top1HitRate: top1 / QUERIES.length,
    top3HitRate: top3 / QUERIES.length,
    mrr3: ranks.reduce((s, r) => s + 1 / r, 0) / QUERIES.length,
    precision3: p3sum / QUERIES.length,
    ndcg3: ndcg3sum / QUERIES.length,
    ndcg5: ndcg5sum / QUERIES.length,
    avgLatencyMs: elapsed / QUERIES.length,
    perQuery,
  };
}

async function main() {
  const neural = await import(join(CLI_ROOT, 'dist/src/mcp-tools/neural-tools.js'));
  const intel = await import(join(CLI_ROOT, 'dist/src/memory/intelligence.js'));
  const stats = await intel.getUnifiedLearningStats();
  const storeSize = stats.neuralPatterns.patternCount;

  if (storeSize === 0) {
    console.error('No patterns in neural store. Run pretrain-from-github.mjs first (with REPO_ROOT + GH_REPO env).');
    process.exit(2);
  }

  const tool = neural.neuralTools.find((t) => t.name === 'neural_patterns');
  if (!tool) throw new Error('neural_patterns tool not found');

  console.log(`# Cross-repo generalisation benchmark (ADR-084)`);
  console.log(`Cwd: ${process.cwd()}`);
  console.log(`Store size: ${storeSize} patterns`);
  console.log(`Queries: ${QUERIES.length} (labelled set for ${process.env.GH_REPO || 'default agentdb'})`);
  console.log('');

  console.log('--- Hybrid path (defaults) ---');
  const hybrid = await evalConfig(tool, { rerank: false });
  console.log(`  top-1: ${(hybrid.top1HitRate * 100).toFixed(0)}%  top-3: ${(hybrid.top3HitRate * 100).toFixed(0)}%  MRR@3: ${hybrid.mrr3.toFixed(3)}  P3: ${hybrid.precision3.toFixed(3)}  nDCG@3: ${hybrid.ndcg3.toFixed(3)}  nDCG@5: ${hybrid.ndcg5.toFixed(3)}  ${hybrid.avgLatencyMs.toFixed(0)}ms`);

  console.log('--- Rerank path (defaults) ---');
  const rerank = await evalConfig(tool, { rerank: true });
  console.log(`  top-1: ${(rerank.top1HitRate * 100).toFixed(0)}%  top-3: ${(rerank.top3HitRate * 100).toFixed(0)}%  MRR@3: ${rerank.mrr3.toFixed(3)}  P3: ${rerank.precision3.toFixed(3)}  nDCG@3: ${rerank.ndcg3.toFixed(3)}  nDCG@5: ${rerank.ndcg5.toFixed(3)}  ${rerank.avgLatencyMs.toFixed(0)}ms`);

  console.log('\n--- Per-query rerank top-3 ---');
  for (const q of rerank.perQuery) {
    console.log(`Q: "${q.q}" (top-1: ${q.top1 ? '✓' : '✗'})`);
    for (const m of q.topK.slice(0, 3)) {
      console.log(`   ${m.relevant ? '★' : ' '} [${m.score ?? '—'}] ${m.name}`);
    }
  }

  const summary = {
    runAt: new Date().toISOString(),
    benchmark: 'cross-repo-generalisation',
    repo: process.env.GH_REPO || 'unknown',
    cwd: process.cwd(),
    storeSize,
    queries: QUERIES.length,
    hybrid: {
      top1HitRate: hybrid.top1HitRate,
      top3HitRate: hybrid.top3HitRate,
      mrr3: hybrid.mrr3,
      precision3: hybrid.precision3,
      ndcg3: hybrid.ndcg3,
      ndcg5: hybrid.ndcg5,
      avgLatencyMs: hybrid.avgLatencyMs,
    },
    rerank: {
      top1HitRate: rerank.top1HitRate,
      top3HitRate: rerank.top3HitRate,
      mrr3: rerank.mrr3,
      precision3: rerank.precision3,
      ndcg3: rerank.ndcg3,
      ndcg5: rerank.ndcg5,
      avgLatencyMs: rerank.avgLatencyMs,
    },
    perQueryRerank: rerank.perQuery,
  };

  mkdirSync(RUNS_DIR, { recursive: true });
  const stamp = summary.runAt.replace(/[:.]/g, '-');
  const repoSlug = (process.env.GH_REPO || 'unknown').replace('/', '-');
  writeFileSync(join(RUNS_DIR, `cross-repo-${repoSlug}-${stamp}.json`), JSON.stringify(summary, null, 2));
  writeFileSync(join(RUNS_DIR, `cross-repo-${repoSlug}-latest.json`), JSON.stringify(summary, null, 2));
  console.log(`\nWrote ${join(RUNS_DIR, `cross-repo-${repoSlug}-${stamp}.json`)}`);

  process.exit(0);
}

main().catch((err) => { console.error(err); process.exit(1); });
