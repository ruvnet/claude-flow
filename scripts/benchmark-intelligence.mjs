#!/usr/bin/env node
/**
 * benchmark-intelligence.mjs — Real, reusable benchmark harness for the
 * RuVector / AgentDB intelligence stack.
 *
 * Measures, on the machine it runs on, against the BUILT exports under
 *   v3/@claude-flow/cli/dist/src/...
 * (never against source, never hardcoded):
 *
 *   1. HNSW search vs in-process brute-force cosine baseline
 *      at N = 1000, 5000, 20000, 50000:
 *        - per-query ms (HNSW + brute force)
 *        - speedup ratio (brute / hnsw)
 *        - recall@10 (HNSW results vs exact top-10)
 *   2. Int8 quantization: measured compression ratio + reconstruction cosine.
 *   3. RaBitQ: memory compression ratio (+ retrieval speed if a populated
 *      index is feasible, else null with a reason).
 *   4. SONA WASM adapt latency (ms/call, warmed).
 *   5. MoE gate: confirm the gate LEARNS (probability/Q shift after rewards).
 *   6. Embedding backend actually in use (onnx vs mock) — honest.
 *
 * DESIGN NOTES
 * ------------
 * - All vectors are generated with a seeded deterministic RNG so the run is
 *   reproducible and safe to re-run. We deliberately do NOT route HNSW/quant
 *   benchmarks through the embedding backend: that backend can be mock on a
 *   given machine, which would make the structural benchmarks non-deterministic
 *   and conflate two separate measurements. The embedding backend is instead
 *   reported HONESTLY as its own item (#6).
 * - Every number printed/emitted comes from a measurement in THIS process.
 *   Unmeasurable items are emitted as `null` with a `reason` string.
 * - Exit code is 0 on success (a benchmark being unmeasurable is not a failure;
 *   only an unexpected crash is). The script prints a markdown table to stdout
 *   and writes a machine-readable JSON object after a `===BENCH_JSON===` marker.
 *
 * USAGE
 *   node scripts/benchmark-intelligence.mjs            # default sizes
 *   node scripts/benchmark-intelligence.mjs --sizes 1000,5000
 *   node scripts/benchmark-intelligence.mjs --queries 50 --dims 384
 *   node scripts/benchmark-intelligence.mjs --json-only
 *
 * Created for the ruflo intelligence stack. Co-Authored-By: RuFlo <ruv@ruv.net>
 */

import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');
const DIST = path.join(REPO_ROOT, 'v3', '@claude-flow', 'cli', 'dist', 'src');

// ----------------------------------------------------------------------------
// CLI args
// ----------------------------------------------------------------------------
function parseArgs(argv) {
  const args = { sizes: [1000, 5000, 20000, 50000], queries: 30, dims: 384, jsonOnly: false, only: null };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--sizes') args.sizes = argv[++i].split(',').map((s) => parseInt(s.trim(), 10)).filter(Boolean);
    else if (a === '--queries') args.queries = parseInt(argv[++i], 10);
    else if (a === '--dims') args.dims = parseInt(argv[++i], 10);
    else if (a === '--json-only') args.jsonOnly = true;
    // --only=hnsw,sona,moe runs ONLY those sub-benches. Saves multi-minute wall
    // when a Darwin-core agent only needs one dimension's measurement.
    // Accept both `--only hnsw,sona` and `--only=hnsw,sona` forms.
    else if (a === '--only') args.only = new Set(argv[++i].split(',').map(s => s.trim()).filter(Boolean));
    else if (a.startsWith('--only=')) args.only = new Set(a.slice(7).split(',').map(s => s.trim()).filter(Boolean));
    else if (a === '--help' || a === '-h') {
      console.log('Usage: node scripts/benchmark-intelligence.mjs [--sizes N,N] [--queries K] [--dims D] [--json-only] [--only=hnsw,sona,moe]');
      process.exit(0);
    }
  }
  return args;
}
const ARGS = parseArgs(process.argv);

const log = (...m) => { if (!ARGS.jsonOnly) console.log(...m); };

// ----------------------------------------------------------------------------
// Deterministic RNG (mulberry32) + unit-vector generator
// ----------------------------------------------------------------------------
function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Generate a clustered set of unit-length Float32 vectors (deterministic). */
function makeDataset(n, dims, seed) {
  const rng = mulberry32(seed);
  // A handful of cluster centroids so nearest-neighbour structure is non-trivial.
  const numClusters = Math.max(8, Math.round(Math.sqrt(n) / 4));
  const centroids = [];
  for (let c = 0; c < numClusters; c++) {
    const v = new Float32Array(dims);
    for (let d = 0; d < dims; d++) v[d] = rng() * 2 - 1;
    normalize(v);
    centroids.push(v);
  }
  const vectors = new Array(n);
  for (let i = 0; i < n; i++) {
    const base = centroids[i % numClusters];
    const v = new Float32Array(dims);
    for (let d = 0; d < dims; d++) v[d] = base[d] + (rng() * 2 - 1) * 0.35; // jitter around centroid
    normalize(v);
    vectors[i] = v;
  }
  return vectors;
}

function normalize(v) {
  let s = 0;
  for (let i = 0; i < v.length; i++) s += v[i] * v[i];
  const inv = s > 0 ? 1 / Math.sqrt(s) : 0;
  for (let i = 0; i < v.length; i++) v[i] *= inv;
  return v;
}

function cosine(a, b) {
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) { dot += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; }
  const denom = Math.sqrt(na) * Math.sqrt(nb);
  return denom > 0 ? dot / denom : 0;
}

/** Exact top-k by cosine (brute force) — returns array of ids. */
function bruteTopK(vectors, query, k) {
  const scored = new Array(vectors.length);
  for (let i = 0; i < vectors.length; i++) scored[i] = [i, cosine(query, vectors[i])];
  scored.sort((x, y) => y[1] - x[1]);
  return scored.slice(0, k).map((s) => s[0]);
}

const now = () => performance.now();
const round = (x, d = 4) => (x == null || Number.isNaN(x) ? null : Number(x.toFixed(d)));

// ----------------------------------------------------------------------------
// 1. HNSW vs brute-force
// ----------------------------------------------------------------------------
async function benchHnsw() {
  const out = { unit: 'ms/query', backend: null, byN: {}, note: '' };
  let createVectorDB, getStatus, loadRuVector;
  try {
    ({ createVectorDB, getStatus, loadRuVector } = await import(path.join(DIST, 'ruvector', 'vector-db.js')));
    await loadRuVector();
    out.backend = getStatus();
  } catch (e) {
    out.error = `failed to load ruvector vector-db: ${e.message}`;
    return out;
  }

  // ruvector createVectorDB enforces 384 dims on this build; honour that.
  const dims = ARGS.dims;
  const K = 10;

  for (const N of ARGS.sizes) {
    const entry = { n: N };
    let dataset, queries;
    try {
      dataset = makeDataset(N, dims, 1234 + N);
      // Queries: reuse a deterministic subset perturbed slightly so they are
      // near (but not identical to) indexed points.
      const qRng = mulberry32(99 + N);
      queries = [];
      for (let q = 0; q < ARGS.queries; q++) {
        const src = dataset[Math.floor(qRng() * N)];
        const v = new Float32Array(dims);
        for (let d = 0; d < dims; d++) v[d] = src[d] + (qRng() * 2 - 1) * 0.05;
        queries.push(normalize(v));
      }
    } catch (e) {
      entry.error = `dataset build failed: ${e.message}`;
      out.byN[N] = entry;
      continue;
    }

    // --- Build HNSW index ---
    let db, buildMs;
    try {
      const t0 = now();
      db = await createVectorDB(dims);
      for (let i = 0; i < N; i++) await db.insert(dataset[i], String(i));
      buildMs = now() - t0;
    } catch (e) {
      entry.error = `hnsw build failed: ${e.message}`;
      out.byN[N] = entry;
      continue;
    }
    entry.buildMs = round(buildMs, 2);
    entry.indexSize = await db.size();

    // --- HNSW query timing + recall ---
    // Warm the index first: the native NAPI search path has per-call marshalling
    // + JIT + page-fault overhead that dominates the FIRST touch of each query.
    // The brute-force baseline below runs in an already-hot JS loop, so timing
    // HNSW cold would compare a cold path against a warm one. We discard one full
    // pass so both sides are measured at steady state — this measures search
    // performance, not first-call overhead.
    for (const q of queries) await db.search(q, K);

    let hnswTotal = 0, recallHits = 0, recallTotal = 0;
    const exactByQuery = queries.map((q) => bruteTopK(dataset, q, K)); // ground truth
    for (let qi = 0; qi < queries.length; qi++) {
      const q = queries[qi];
      const t0 = now();
      const res = await db.search(q, K);
      hnswTotal += now() - t0;
      const ids = (res || []).map((r) => parseInt(r.id, 10));
      const truth = new Set(exactByQuery[qi]);
      for (const id of ids) if (truth.has(id)) recallHits++;
      recallTotal += K;
    }
    const hnswPerQuery = hnswTotal / queries.length;

    // --- Brute-force baseline timing (independent of ground-truth precompute) ---
    let bruteTotal = 0;
    for (const q of queries) {
      const t0 = now();
      bruteTopK(dataset, q, K);
      bruteTotal += now() - t0;
    }
    const brutePerQuery = bruteTotal / queries.length;

    entry.hnswMsPerQuery = round(hnswPerQuery, 5);
    entry.bruteMsPerQuery = round(brutePerQuery, 5);
    entry.speedup = round(hnswPerQuery > 0 ? brutePerQuery / hnswPerQuery : null, 2);
    entry.recallAt10 = round(recallTotal > 0 ? recallHits / recallTotal : null, 4);
    out.byN[N] = entry;

    if (db.clear) await db.clear();
    log(`  HNSW N=${N}: build=${entry.buildMs}ms hnsw=${entry.hnswMsPerQuery}ms brute=${entry.bruteMsPerQuery}ms speedup=${entry.speedup}x recall@10=${entry.recallAt10}`);
  }
  return out;
}

// ----------------------------------------------------------------------------
// 2. Int8 quantization
// ----------------------------------------------------------------------------
async function benchInt8() {
  const out = {};
  let encodeEmbedding, decodeEmbedding, encodedByteSize;
  try {
    ({ encodeEmbedding, decodeEmbedding, encodedByteSize } = await import(path.join(DIST, 'memory', 'embedding-quantization.js')));
  } catch (e) {
    return { error: `failed to load embedding-quantization: ${e.message}` };
  }
  const dims = ARGS.dims;
  const SAMPLES = 200;
  const rng = mulberry32(4242);
  let cosSum = 0;
  let rawBytes = 0, encBase64Bytes = 0, quantRawBytes = 0;
  for (let s = 0; s < SAMPLES; s++) {
    const v = new Float32Array(dims);
    for (let d = 0; d < dims; d++) v[d] = rng() * 2 - 1;
    normalize(v);
    const encoded = encodeEmbedding(v);          // "inline:<base64>"
    const decoded = decodeEmbedding(encoded);    // Float32Array | null
    if (!decoded) continue;
    cosSum += cosine(v, decoded);
    rawBytes += dims * 4;                          // float32 source bytes
    // measured base64 transport payload (the blob, sans "inline:" prefix)
    const b64 = encoded.startsWith('inline:') ? encoded.slice(7) : encoded;
    encBase64Bytes += b64.length;                  // chars == bytes for base64 ASCII
    // measured raw quantized byte count: decode the base64 to get its true
    // pre-encoding size (header + 1 byte/dim). We do NOT assume the format.
    quantRawBytes += Buffer.from(b64, 'base64').length;
  }
  out.dims = dims;
  out.samples = SAMPLES;
  out.reconstructionCosine = round(cosSum / SAMPLES, 6);
  out.rawBytesPerVec = round(rawBytes / SAMPLES, 1);                 // 1536 for 384-d f32
  out.quantizedRawBytesPerVec = round(quantRawBytes / SAMPLES, 1);  // ~400 (header+int8)
  out.base64BytesPerVec = round(encBase64Bytes / SAMPLES, 1);       // ~536 transport
  out.encodedByteSizeReported = encodedByteSize ? encodedByteSize(dims) : null;
  // Honest int8 compression = float32 source bytes / int8 quantized bytes.
  out.compressionRatioInt8 = round(rawBytes / quantRawBytes, 3);
  // Transport (base64) ratio — what actually lands in the embedding_ref column.
  out.compressionRatioBase64 = round(rawBytes / encBase64Bytes, 3);
  log(`  Int8: reconstructionCosine=${out.reconstructionCosine} compression(int8)=${out.compressionRatioInt8}x compression(base64)=${out.compressionRatioBase64}x`);
  return out;
}

// ----------------------------------------------------------------------------
// 3. RaBitQ
// ----------------------------------------------------------------------------
async function benchRabitq() {
  const out = {};
  let buildRabitqIndex, getRabitqStatus, searchRabitq;
  try {
    ({ buildRabitqIndex, getRabitqStatus, searchRabitq } = await import(path.join(DIST, 'memory', 'rabitq-index.js')));
  } catch (e) {
    return { error: `failed to load rabitq-index: ${e.message}` };
  }
  // Memory compression ratio is a structural property: 1-bit packing of a
  // float32 vector = 32x. The WASM module reports the measured ratio at build
  // time. buildRabitqIndex pulls from a SQLite memory DB — if no populated DB
  // exists we cannot measure retrieval speed; report that honestly.
  const status = getRabitqStatus();
  out.available = !!status.available;
  out.statusBefore = status;

  let build = null;
  try {
    build = await buildRabitqIndex({ dimensions: ARGS.dims });
  } catch (e) {
    out.buildError = e.message;
  }
  out.build = build;

  if (build && build.success && build.vectorCount > 0) {
    out.compressionRatio = round(build.compressionRatio, 3);
    out.buildTimeMs = round(build.buildTimeMs, 3);
    // Retrieval timing on the populated index.
    try {
      const rng = mulberry32(7);
      const q = Array.from({ length: ARGS.dims }, () => rng() * 2 - 1);
      const reps = 20;
      const t0 = now();
      for (let i = 0; i < reps; i++) await searchRabitq(q, { k: 10 });
      out.searchMsPerQuery = round((now() - t0) / reps, 5);
    } catch (e) {
      out.searchMsPerQuery = null;
      out.searchNote = `retrieval not measured: ${e.message}`;
    }
  } else {
    // No populated SQLite vector store on this machine — compression ratio is
    // reported from status/build if the WASM module surfaced it, else from the
    // documented 1-bit packing invariant is NOT assumed; we mark it null.
    out.compressionRatio = build && typeof build.compressionRatio === 'number' && build.compressionRatio > 0
      ? round(build.compressionRatio, 3)
      : (typeof status.compressionRatio === 'number' && status.compressionRatio > 0 ? round(status.compressionRatio, 3) : null);
    out.searchMsPerQuery = null;
    out.searchNote = 'not measured: no populated RaBitQ/SQLite index available on this machine (build returned vectorCount=0)';
  }
  log(`  RaBitQ: available=${out.available} compressionRatio=${out.compressionRatio} searchMsPerQuery=${out.searchMsPerQuery ?? 'null'}`);
  return out;
}

// ----------------------------------------------------------------------------
// 4. SONA WASM adapt latency (warmed)
// ----------------------------------------------------------------------------
async function benchSona() {
  const out = {};
  let isRuvllmWasmAvailable, initRuvllmWasm, createSonaInstant;
  try {
    ({ isRuvllmWasmAvailable, initRuvllmWasm, createSonaInstant } = await import(path.join(DIST, 'ruvector', 'ruvllm-wasm.js')));
  } catch (e) {
    return { error: `failed to load ruvllm-wasm: ${e.message}` };
  }
  const available = await isRuvllmWasmAvailable();
  out.wasmAvailable = available;
  if (!available) {
    out.adaptMsPerCall = null;
    out.note = 'not measured: @ruvector/ruvllm-wasm not available on this machine';
    log('  SONA: WASM not available');
    return out;
  }
  await initRuvllmWasm();
  const sona = await createSonaInstant({ hiddenDim: 64 });
  // Warm-up (JIT + WASM page faults).
  for (let i = 0; i < 1000; i++) sona.adapt(0.7 + (i % 3) * 0.1);
  // Measured loop.
  const ITER = 20000;
  const rng = mulberry32(11);
  const t0 = now();
  for (let i = 0; i < ITER; i++) sona.adapt(rng());
  const totalMs = now() - t0;
  out.iterations = ITER;
  out.totalMs = round(totalMs, 3);
  out.adaptMsPerCall = round(totalMs / ITER, 6);
  out.targetMet_0_05ms = out.adaptMsPerCall != null ? out.adaptMsPerCall < 0.05 : null;
  if (sona.reset) sona.reset();
  log(`  SONA: ${out.adaptMsPerCall} ms/adapt-call (warmed, ${ITER} iters)`);
  return out;
}

// ----------------------------------------------------------------------------
// 5. MoE gate learns (Q-value / probability shift after rewards)
// ----------------------------------------------------------------------------
async function benchMoeGate() {
  const out = {};
  let createQLearningRouter;
  try {
    ({ createQLearningRouter } = await import(path.join(DIST, 'ruvector', 'q-learning-router.js')));
  } catch (e) {
    return { error: `failed to load q-learning-router: ${e.message}` };
  }
  let router;
  try {
    router = createQLearningRouter({ saveInterval: 1e9 }); // never auto-persist during bench
  } catch (e) {
    return { error: `failed to construct router: ${e.message}` };
  }

  const task = 'optimize the database query performance bottleneck';
  // Discover available actions from an initial (greedy) decision.
  const before = router.route(task, false);
  const actions = (before.alternatives && before.alternatives.length)
    ? before.alternatives.map((a) => a.route)
    : [before.route];
  if (actions.length < 2) {
    out.note = 'gate exposed fewer than 2 actions; cannot demonstrate competitive shift';
  }
  // Pick a "good" action and reward it repeatedly; pick a "bad" action and
  // penalise it. We then verify the gate's Q-value / probability for the good
  // action rose relative to before.
  const good = before.route;       // initial greedy pick (argmax of qValues)
  const bad = actions.find((a) => a !== good) || good;

  // The greedy decision's chosen route is the argmax, so its Q is the max of
  // the qValues vector. We read the Q of whatever route is greedily chosen
  // before and after training. After rewarding `good`, a learning gate should
  // (a) keep choosing `good` and (b) have raised its Q for that context.
  const maxQ = (decision) => (decision.qValues && decision.qValues.length ? Math.max(...decision.qValues) : null);
  // Q assigned specifically to the `good` route: if `good` is the greedy pick
  // it equals maxQ; otherwise it's its score in alternatives.
  const qForRoute = (decision, route) => {
    if (decision.route === route) return maxQ(decision);
    const alt = (decision.alternatives || []).find((a) => a.route === route);
    return alt ? alt.score : null;
  };

  const beforeGoodQ = qForRoute(before, good);
  const beforeConf = before.confidence;

  // Train: reward `good`, penalise `bad`.
  const REWARDS = 200;
  for (let i = 0; i < REWARDS; i++) {
    router.update(task, good, 1.0, task);
    if (bad !== good) router.update(task, bad, -1.0, task);
  }

  const after = router.route(task, false); // greedy after training
  const afterGoodQ = qForRoute(after, good);
  const afterConf = after.confidence;
  out.afterGreedyRoute = after.route;
  out.goodStillChosen = after.route === good;

  out.actionsObserved = actions.length;
  out.goodAction = good;
  out.badAction = bad;
  out.rewardsApplied = REWARDS;
  out.beforeGoodQ = round(beforeGoodQ, 5);
  out.afterGoodQ = round(afterGoodQ, 5);
  out.qShift = (beforeGoodQ != null && afterGoodQ != null) ? round(afterGoodQ - beforeGoodQ, 5) : null;
  out.beforeConfidence = round(beforeConf, 5);
  out.afterConfidence = round(afterConf, 5);
  out.confidenceShift = (beforeConf != null && afterConf != null) ? round(afterConf - beforeConf, 5) : null;
  // The gate "learns" if reward changed its internal valuation in the rewarded
  // direction (Q rose) OR its confidence in the greedy pick rose.
  out.gateLearned = (out.qShift != null && out.qShift > 0) || (out.confidenceShift != null && out.confidenceShift > 0);
  const stats = router.getStats ? router.getStats() : null;
  out.routerStats = stats;
  log(`  MoE gate: qShift=${out.qShift} confShift=${out.confidenceShift} learned=${out.gateLearned}`);
  return out;
}

// ----------------------------------------------------------------------------
// 6. Embedding backend honesty
// ----------------------------------------------------------------------------
async function benchEmbeddingBackend() {
  const out = {};
  let generateEmbedding;
  try {
    ({ generateEmbedding } = await import(path.join(DIST, 'memory', 'memory-initializer.js')));
  } catch (e) {
    return { error: `failed to load memory-initializer: ${e.message}` };
  }
  try {
    const r = await generateEmbedding('benchmark probe: authentication and database optimization patterns');
    out.backend = r.backend;          // 'onnx' | 'mock' — the authoritative signal
    out.model = r.model;
    out.dimensions = r.dimensions;
    out.honest = `backend=${r.backend} (model string '${r.model}' is reported regardless of backend; backend field is authoritative)`;
  } catch (e) {
    out.backend = null;
    out.note = `not measured: ${e.message}`;
  }
  log(`  Embedding backend: ${out.backend} (model=${out.model}, dims=${out.dimensions})`);
  return out;
}

// ----------------------------------------------------------------------------
// Markdown report
// ----------------------------------------------------------------------------
function printMarkdown(results) {
  const lines = [];
  lines.push('');
  lines.push('## Intelligence Benchmark — Measured Results');
  lines.push('');
  lines.push(`- Host: ${process.platform}/${process.arch}, Node ${process.version}`);
  lines.push(`- dist: ${path.relative(REPO_ROOT, DIST)}`);
  lines.push(`- dims=${ARGS.dims}, queries/size=${ARGS.queries}`);
  lines.push('');

  // HNSW table
  lines.push('### 1. HNSW vs brute-force cosine');
  const h = results.hnsw;
  if (h && h.byN && !h.error) {
    lines.push(`backend: \`${JSON.stringify(h.backend)}\``);
    lines.push('');
    lines.push('| N | build ms | HNSW ms/q | brute ms/q | speedup | recall@10 |');
    lines.push('|--:|--:|--:|--:|--:|--:|');
    for (const N of ARGS.sizes) {
      const e = h.byN[N];
      if (!e) continue;
      if (e.error) { lines.push(`| ${N} | error: ${e.error} | | | | |`); continue; }
      lines.push(`| ${N} | ${e.buildMs} | ${e.hnswMsPerQuery} | ${e.bruteMsPerQuery} | ${e.speedup}x | ${e.recallAt10} |`);
    }
  } else {
    lines.push(`error: ${h?.error ?? 'no data'}`);
  }
  lines.push('');

  // Int8
  lines.push('### 2. Int8 quantization');
  const q = results.int8;
  if (q && !q.error) {
    lines.push('| metric | value |');
    lines.push('|--|--:|');
    lines.push(`| reconstruction cosine | ${q.reconstructionCosine} |`);
    lines.push(`| compression (int8 quantized) | ${q.compressionRatioInt8}x |`);
    lines.push(`| compression (base64 transport) | ${q.compressionRatioBase64}x |`);
    lines.push(`| f32 source bytes/vec | ${q.rawBytesPerVec} |`);
    lines.push(`| int8 quantized bytes/vec | ${q.quantizedRawBytesPerVec} |`);
    lines.push(`| base64 transport bytes/vec | ${q.base64BytesPerVec} |`);
  } else { lines.push(`error: ${q?.error ?? 'no data'}`); }
  lines.push('');

  // RaBitQ
  lines.push('### 3. RaBitQ');
  const rb = results.rabitq;
  if (rb && !rb.error) {
    lines.push('| metric | value |');
    lines.push('|--|--:|');
    lines.push(`| available | ${rb.available} |`);
    lines.push(`| compression ratio | ${rb.compressionRatio ?? 'null'} |`);
    lines.push(`| search ms/query | ${rb.searchMsPerQuery ?? 'null'} |`);
    if (rb.searchNote) lines.push(`| note | ${rb.searchNote} |`);
  } else { lines.push(`error: ${rb?.error ?? 'no data'}`); }
  lines.push('');

  // SONA
  lines.push('### 4. SONA WASM adapt latency (warmed)');
  const s = results.sona;
  if (s && !s.error) {
    lines.push('| metric | value |');
    lines.push('|--|--:|');
    lines.push(`| wasm available | ${s.wasmAvailable} |`);
    lines.push(`| adapt ms/call | ${s.adaptMsPerCall ?? 'null'} |`);
    if (s.iterations) lines.push(`| iterations | ${s.iterations} |`);
    if (s.targetMet_0_05ms != null) lines.push(`| < 0.05ms target met | ${s.targetMet_0_05ms} |`);
    if (s.note) lines.push(`| note | ${s.note} |`);
  } else { lines.push(`error: ${s?.error ?? 'no data'}`); }
  lines.push('');

  // MoE
  lines.push('### 5. MoE gate learning');
  const m = results.moeGate;
  if (m && !m.error) {
    lines.push('| metric | value |');
    lines.push('|--|--:|');
    lines.push(`| actions observed | ${m.actionsObserved} |`);
    lines.push(`| rewards applied | ${m.rewardsApplied} |`);
    lines.push(`| good-action Q before → after | ${m.beforeGoodQ} → ${m.afterGoodQ} (Δ ${m.qShift}) |`);
    lines.push(`| confidence before → after | ${m.beforeConfidence} → ${m.afterConfidence} (Δ ${m.confidenceShift}) |`);
    lines.push(`| **gate learned** | **${m.gateLearned}** |`);
  } else { lines.push(`error: ${m?.error ?? 'no data'}`); }
  lines.push('');

  // Embedding backend
  lines.push('### 6. Embedding backend (honest)');
  const eb = results.embeddingBackend;
  if (eb && !eb.error) {
    lines.push('| metric | value |');
    lines.push('|--|--|');
    lines.push(`| **backend in use** | **${eb.backend}** |`);
    lines.push(`| model string | ${eb.model} |`);
    lines.push(`| dimensions | ${eb.dimensions} |`);
    if (eb.note) lines.push(`| note | ${eb.note} |`);
  } else { lines.push(`error: ${eb?.error ?? 'no data'}`); }
  lines.push('');

  console.log(lines.join('\n'));
}

// ----------------------------------------------------------------------------
// Main
// ----------------------------------------------------------------------------
async function main() {
  log('Intelligence benchmark — measuring against built dist exports...');
  log(`dist: ${DIST}`);

  const results = {
    meta: {
      timestamp: new Date().toISOString(),
      platform: `${process.platform}/${process.arch}`,
      node: process.version,
      dist: DIST,
      dims: ARGS.dims,
      queriesPerSize: ARGS.queries,
      sizes: ARGS.sizes,
    },
  };

  // Each benchmark is isolated: a failure in one does not abort the rest.
  // --only filter skips dims not requested; saves wall-time for Darwin
  // per-dimension agents (e.g. `--only=hnsw` runs only the HNSW bench).
  const want = (name) => !ARGS.only || ARGS.only.has(name);

  if (want('hnsw')) { log('\n[1/6] HNSW vs brute-force...'); try { results.hnsw = await benchHnsw(); } catch (e) { results.hnsw = { error: e.stack || e.message }; } }
  if (want('int8')) { log('\n[2/6] Int8 quantization...'); try { results.int8 = await benchInt8(); } catch (e) { results.int8 = { error: e.stack || e.message }; } }
  if (want('rabitq')) { log('\n[3/6] RaBitQ...'); try { results.rabitq = await benchRabitq(); } catch (e) { results.rabitq = { error: e.stack || e.message }; } }
  if (want('sona')) { log('\n[4/6] SONA WASM adapt...'); try { results.sona = await benchSona(); } catch (e) { results.sona = { error: e.stack || e.message }; } }
  if (want('moe') || want('moeGate')) { log('\n[5/6] MoE gate learning...'); try { results.moeGate = await benchMoeGate(); } catch (e) { results.moeGate = { error: e.stack || e.message }; } }
  if (want('embedding') || want('embeddingBackend')) { log('\n[6/6] Embedding backend...'); try { results.embeddingBackend = await benchEmbeddingBackend(); } catch (e) { results.embeddingBackend = { error: e.stack || e.message }; } }

  if (!ARGS.jsonOnly) printMarkdown(results);

  // Machine-readable block (always emitted, after a stable marker).
  console.log('\n===BENCH_JSON===');
  console.log(JSON.stringify(results));

  return results;
}

main()
  .then(() => process.exit(0))
  .catch((e) => { console.error('FATAL:', e.stack || e.message); process.exit(1); });
