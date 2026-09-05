#!/usr/bin/env node
// benchmark-trajectory-mrr.mjs — proof harness for Structured Distillation
// (#2241 §SOTA, arXiv:2603.13017).
//
// Measures retrieval MRR for raw vs structured-distilled trajectory content
// against a paired corpus. The arXiv paper reports raw → distilled MRR
// going from 0.745 to 0.759 on a 214 K-pair consensus-graded set; our corpus
// is much smaller and hand-curated, so the absolute numbers won't match,
// but the *direction* of the delta is what we're proving.
//
// Two embedders are supported:
//   - Real ONNX (Xenova/all-MiniLM-L6-v2 384-dim) via @claude-flow/embeddings
//     when available. Best signal.
//   - Hash-based deterministic fallback when ONNX isn't installed. Lower
//     signal; results still relative-comparable.
//
// Usage:
//   node scripts/benchmark-trajectory-mrr.mjs            # default
//   BENCH_JSON=1 node scripts/benchmark-trajectory-mrr.mjs
//   BENCH_NO_WRITE=1 node scripts/benchmark-trajectory-mrr.mjs

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { performance } from 'node:perf_hooks';

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const CLI_ROOT = resolve(SCRIPT_DIR, '..');
const REPO_ROOT = resolve(SCRIPT_DIR, '../../../..');
const RUNS_DIR = join(REPO_ROOT, 'docs', 'benchmarks', 'runs');

const { distillAndSerialise, compressionRatio } = await import(
  join(CLI_ROOT, 'dist/src/memory/structured-distill.js')
);

// ---------------------------------------------------------------------------
// Embedder — prefers real ONNX, falls back to hash-based deterministic.
// ---------------------------------------------------------------------------
async function loadEmbedder() {
  // Tier 1: AgentDB's bridge-loaded ONNX embedder (the path the live MCP
  // server + vitest tests use, so we measure what users actually get).
  try {
    const mb = await import(join(CLI_ROOT, 'dist/src/memory/memory-bridge.js'));
    const probe = await mb.bridgeGenerateEmbedding('warm-up').catch(() => null);
    if (probe && probe.embedding && probe.embedding.length > 0 && probe.backend === 'onnx') {
      return {
        name: `bridge ONNX (${probe.model}, ${probe.dimensions}-dim)`,
        embed: async (text) => {
          const r = await mb.bridgeGenerateEmbedding(text);
          if (!r) throw new Error('bridge embed returned null');
          return r.embedding;
        },
      };
    }
  } catch { /* fall through */ }
  // Tier 2: hash-based deterministic. Clearly degraded; produces only
  // direction-of-effect signal, not absolute MRR numbers comparable to paper.
  console.error('⚠️  Real ONNX embedder unavailable — using hash-based deterministic fallback. Absolute MRR numbers are NOT comparable to the arXiv paper in this mode; relative comparison is also weak.');
  return {
    name: 'hash-fallback (no semantic signal — degraded mode)',
    embed: async (text) => hashEmbed(text, 384),
  };
}

function hashEmbed(text, dims) {
  const v = new Float32Array(dims);
  let seed = 0;
  for (let i = 0; i < text.length; i++) seed = (seed * 31 + text.charCodeAt(i)) | 0;
  let s = Math.abs(seed) | 1;
  for (let i = 0; i < dims; i++) {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    v[i] = (s / 0x7fffffff) * 2 - 1;
  }
  // L2 normalise
  let n = 0;
  for (let i = 0; i < dims; i++) n += v[i] * v[i];
  n = Math.sqrt(n) || 1;
  for (let i = 0; i < dims; i++) v[i] /= n;
  return Array.from(v);
}

function cosine(a, b) {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i] * b[i];
  return s;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function main() {
  const corpusPath = join(CLI_ROOT, 'bench', 'trajectory-mrr-corpus.json');
  const corpus = JSON.parse(readFileSync(corpusPath, 'utf-8'));
  const trajectories = corpus.trajectories;
  const embedder = await loadEmbedder();

  // Per-trajectory: embed both raw and distilled forms.
  const tEmbed0 = performance.now();
  const rawEmbs = [];
  const distEmbs = [];
  let totalRawBytes = 0;
  let totalDistBytes = 0;
  for (const t of trajectories) {
    const distilled = distillAndSerialise(t.raw);
    totalRawBytes += t.raw.length;
    totalDistBytes += distilled.length;
    rawEmbs.push(await embedder.embed(t.raw));
    distEmbs.push(await embedder.embed(distilled));
  }
  const embedMs = performance.now() - tEmbed0;

  // For each (query, gold) pair: rank all trajectories by cosine to the query
  // embedding. MRR = mean of 1 / rank-of-gold across all queries.
  const tQuery0 = performance.now();
  let rrRaw = 0, rrDist = 0;
  const perQuery = [];
  for (let i = 0; i < trajectories.length; i++) {
    const q = await embedder.embed(trajectories[i].query);
    const rankRaw = rankOf(q, rawEmbs, i);
    const rankDist = rankOf(q, distEmbs, i);
    rrRaw += 1 / rankRaw;
    rrDist += 1 / rankDist;
    perQuery.push({ id: trajectories[i].id, rankRaw, rankDist });
  }
  const queryMs = performance.now() - tQuery0;

  const N = trajectories.length;
  const mrrRaw = rrRaw / N;
  const mrrDist = rrDist / N;
  const delta = mrrDist - mrrRaw;
  const compression = totalRawBytes / Math.max(1, totalDistBytes);

  const summary = {
    runAt: new Date().toISOString(),
    benchmark: 'trajectory-mrr',
    embedder: embedder.name,
    corpusVersion: corpus.version,
    corpusSize: N,
    mrr: {
      raw: Number(mrrRaw.toFixed(4)),
      distilled: Number(mrrDist.toFixed(4)),
      delta: Number(delta.toFixed(4)),
      paperReference: { raw: 0.745, distilled: 0.759, delta: 0.014, source: 'arXiv:2603.13017' },
    },
    compression: {
      totalRawBytes,
      totalDistBytes,
      ratio: Number(compression.toFixed(2)),
      paperReference: { tokensRaw: 371, tokensDistilled: 38, ratio: 9.76, source: 'arXiv:2603.13017' },
    },
    latencyMs: {
      embedAll: Number(embedMs.toFixed(2)),
      queryAll: Number(queryMs.toFixed(2)),
      perDistill: Number((embedMs / (2 * N)).toFixed(4)),
    },
    distilledIsBetter: delta > 0,
    perQueryRanks: perQuery,
  };

  if (process.env.BENCH_JSON) {
    console.log(JSON.stringify(summary, null, 2));
  } else {
    console.log(`# Trajectory MRR benchmark (#2241 §Structured Distillation)`);
    console.log(`Embedder: ${embedder.name}`);
    console.log(`Corpus: N=${N} (v${corpus.version})`);
    console.log('');
    console.log('| Metric | Raw | Distilled | Δ |');
    console.log('|---|---:|---:|---:|');
    console.log(`| MRR | ${summary.mrr.raw} | ${summary.mrr.distilled} | ${summary.mrr.delta >= 0 ? '+' : ''}${summary.mrr.delta} |`);
    console.log(`| Total bytes | ${totalRawBytes} | ${totalDistBytes} | ${compression.toFixed(2)}× compression |`);
    console.log('');
    console.log(`Distilled is ${summary.distilledIsBetter ? 'BETTER ✅' : 'WORSE ❌'} than raw on this corpus.`);
    console.log(`Paper (arXiv:2603.13017): MRR raw 0.745 → distilled 0.759 (Δ +0.014); compression ~9.76× (371→38 tokens).`);
  }

  if (!process.env.BENCH_NO_WRITE) {
    mkdirSync(RUNS_DIR, { recursive: true });
    const stamp = summary.runAt.replace(/[:.]/g, '-');
    writeFileSync(join(RUNS_DIR, `trajectory-mrr-${stamp}.json`), JSON.stringify(summary, null, 2));
    writeFileSync(join(RUNS_DIR, 'trajectory-mrr-latest.json'), JSON.stringify(summary, null, 2));
    if (!process.env.BENCH_JSON) console.log(`\nWrote ${join(RUNS_DIR, `trajectory-mrr-${stamp}.json`)}`);
  }
}

function rankOf(query, embeddings, goldIndex) {
  const scored = embeddings.map((e, i) => ({ i, score: cosine(query, e) }));
  scored.sort((a, b) => b.score - a.score);
  return scored.findIndex((s) => s.i === goldIndex) + 1;
}

main().catch((err) => { console.error(err); process.exit(1); });
