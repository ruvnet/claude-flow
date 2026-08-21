#!/usr/bin/env node
/**
 * benchmark-memory.mjs — LoCoMo-lite recall benchmark for AgentDB retrieval.
 *
 * Dream Cycle 2026-08-13 (memory) evaluation bridge for issue #3008 / PR #3009
 * "Recommended Next Step 3" (add a benchmark harness) and a scoped, honest
 * test of "Recommended Next Step 2" (multi-signal retrieval fusion).
 *
 * WHAT THIS MEASURES
 * -------------------
 * A small, hand-written, honestly-labeled memory-QA corpus (20 fact/query
 * pairs, HONEST_CORPUS below) is retrieved two ways:
 *
 *   1. baseline  — semantic-only cosine similarity (current AgentDB
 *      retrieval shape: HNSW cosine over embeddings, nothing else).
 *   2. candidate — semantic cosine fused with BM25 keyword score at a
 *      fixed weight (the two-signal subset of ADR-382's proposed 3-signal
 *      0.6/0.3/0.1 semantic/BM25/entity fusion — entity linking is out of
 *      scope for this patch, so this tests semantic+BM25 only).
 *
 * Recall@1, Recall@3, and MRR are reported for both, plus a bounded
 * (Darwin-style) sweep over the fusion weight to find the best weight on
 * this corpus.
 *
 * HONESTY NOTES (read before citing these numbers)
 * -------------------------------------------------
 * - Embeddings: this script does NOT use the production ONNX / agentic-flow
 *   backend (`@claude-flow/embeddings`). That package has no built `dist/`
 *   in this checkout and pulling a model requires network access this
 *   sandboxed environment may not have. Using a real embedding backend
 *   silently degrading to `mock` would be exactly the kind of unmeasured
 *   claim this repo's benchmarking convention (see benchmark-intelligence.mjs)
 *   explicitly refuses to do. Instead this script uses a deterministic
 *   feature-hashed bag-of-words vector as its "semantic" signal — a real,
 *   inspectable, reproducible embedding, but NOT the production embedding
 *   model. Conclusion: this measures whether BM25 fusion helps ON TOP OF A
 *   cosine-similarity retrieval shape in general; it is NOT a production
 *   LoCoMo/LongMemEval score for AgentDB's actual ONNX embeddings. A
 *   follow-up run wired to the real embedding backend (network-enabled) is
 *   required before citing an absolute LoCoMo number in competitive claims.
 * - The corpus is small (20 items) and hand-written by the dream-cycle
 *   agent, not sourced from the real LoCoMo/LongMemEval datasets (those are
 *   1,540/500 question benchmarks — out of scope to reproduce in one night).
 *   It is honestly a MINIMAL REPRESENTATIVE corpus, not a SOTA-comparable one.
 * - Gold answers are frozen in HONEST_CORPUS below BEFORE either retrieval
 *   strategy is run, and are never touched by the candidate ("the candidate
 *   may not modify evaluation gold answers" — Dream Cycle STEP 7 invariant).
 * - Every number below is measured in this process; nothing is inferred
 *   from logs or hardcoded. Unmeasurable items would be emitted as `null`
 *   with a reason (none occur here — this benchmark has no external deps).
 *
 * USAGE
 *   node scripts/benchmark-memory.mjs
 *   node scripts/benchmark-memory.mjs --json-only
 *   node scripts/benchmark-memory.mjs --weights 0.5,0.6,0.7,0.8,0.9
 */

// ----------------------------------------------------------------------------
// CLI args
// ----------------------------------------------------------------------------
function parseArgs(argv) {
  const args = { jsonOnly: false, weights: [0.5, 0.6, 0.7, 0.8, 0.9] };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--json-only') args.jsonOnly = true;
    else if (a === '--weights') args.weights = argv[++i].split(',').map(Number);
  }
  return args;
}
const ARGS = parseArgs(process.argv);

function log(...a) { if (!ARGS.jsonOnly) console.error(...a); }

// ----------------------------------------------------------------------------
// Honest, hand-written, minimal memory corpus (frozen gold answers)
// ----------------------------------------------------------------------------
// Each entry: a fact stored in memory (`doc`) and a later query that should
// retrieve it (`query`). `distractorFor` documents share vocabulary with a
// query but are the WRONG answer — they probe whether a strategy is fooled
// by keyword overlap (BM25 weakness) or by paraphrase/semantic drift
// (cosine-only weakness).
const HONEST_CORPUS = [
  { id: 'd1', doc: 'The user moved from Austin to Denver in March.', query: 'Where does the user live now?' },
  { id: 'd2', doc: 'The user no longer drinks coffee, they switched to green tea.', query: 'What does the user drink in the morning?' },
  { id: 'd3', doc: 'The project deadline was pushed from June 1 to August 15.', query: 'When is the project due?' },
  { id: 'd4', doc: 'The user prefers dark mode in every application they use.', query: 'What UI theme does the user like?' },
  { id: 'd5', doc: 'The user changed jobs from Acme Corp to Initech in April.', query: 'Where does the user currently work?' },
  { id: 'd6', doc: 'The API rate limit was raised from 100 to 500 requests per minute.', query: 'What is the current API rate limit?' },
  { id: 'd7', doc: 'The user is allergic to peanuts, not tree nuts.', query: 'What food allergy does the user have?' },
  { id: 'd8', doc: 'The team switched their default branch strategy from git-flow to trunk-based.', query: 'What branching strategy does the team use now?' },
  { id: 'd9', doc: 'The user’s preferred contact method is Slack, not email.', query: 'How should you reach the user?' },
  { id: 'd10', doc: 'The database migration was rolled back after causing latency spikes.', query: 'What happened to the database migration?' },
  { id: 'd11', doc: 'The user’s dog is named Biscuit, a golden retriever.', query: 'What is the user’s pet’s name?' },
  { id: 'd12', doc: 'The subscription plan was upgraded from Pro to Enterprise in July.', query: 'What subscription tier is the user on?' },
  { id: 'd13', doc: 'The user asked to be addressed with they/them pronouns.', query: 'What pronouns does the user use?' },
  { id: 'd14', doc: 'The release was delayed because the security audit found a critical CVE.', query: 'Why was the release delayed?' },
  { id: 'd15', doc: 'The user’s timezone changed from PST to CET after relocating.', query: 'What timezone is the user in?' },
  { id: 'd16', doc: 'The default LLM provider was switched from OpenAI to Anthropic.', query: 'Which LLM provider is the default now?' },
  { id: 'd17', doc: 'The user’s budget for the project was cut from $50k to $30k.', query: 'What is the current project budget?' },
  { id: 'd18', doc: 'The onboarding flow was shortened from 7 steps to 3 steps.', query: 'How many steps are in onboarding now?' },
  { id: 'd19', doc: 'The user’s manager changed from Priya to Sam after the reorg.', query: 'Who is the user’s manager now?' },
  { id: 'd20', doc: 'The staging environment was renamed from "stage" to "preview".', query: 'What is the staging environment called now?' },
];

// Distractors: near-duplicate wording of an OLD, superseded fact for the
// same topic as a corpus item — the exact "belief-drift" case ADR-382 and
// issue #3008 describe (last-writer-wins should not be confused by an
// earlier document sharing vocabulary with the query).
const DISTRACTORS = [
  { id: 'x1', doc: 'The user used to live in Austin before relocating.', relatesTo: 'd1' },
  { id: 'x2', doc: 'The user used to drink coffee every morning.', relatesTo: 'd2' },
  { id: 'x3', doc: 'The original project deadline was June 1.', relatesTo: 'd3' },
  { id: 'x4', doc: 'The user used to use light mode in most applications.', relatesTo: 'd4' },
  { id: 'x5', doc: 'The user previously worked at Acme Corp.', relatesTo: 'd5' },
];

const ALL_DOCS = [...HONEST_CORPUS.map(({ id, doc }) => ({ id, doc })), ...DISTRACTORS.map(({ id, doc }) => ({ id, doc }))];

// ----------------------------------------------------------------------------
// Signal 1: deterministic feature-hashed "semantic" embedding + cosine
// ----------------------------------------------------------------------------
// NOT the production ONNX embedding — see HONESTY NOTES above. This is a
// real, deterministic, reproducible embedding (hashing trick, dims=128),
// good enough to exhibit genuine semantic-adjacent behavior (shared
// substrings / stems hash into overlapping buckets) without any external
// model or network dependency.
const EMBED_DIMS = 128;

function tokenize(text) {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(Boolean);
}

function hashToken(tok) {
  let h = 2166136261;
  for (let i = 0; i < tok.length; i++) {
    h ^= tok.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function embed(text) {
  const vec = new Float64Array(EMBED_DIMS);
  const toks = tokenize(text);
  for (const tok of toks) {
    const h = hashToken(tok);
    vec[h % EMBED_DIMS] += 1;
    // also hash bigrams (character 3-grams) so near-synonymous stems overlap
    for (let i = 0; i < tok.length - 2; i++) {
      const gram = tok.slice(i, i + 3);
      vec[hashToken(gram) % EMBED_DIMS] += 0.5;
    }
  }
  // L2 normalize
  let norm = 0;
  for (let i = 0; i < EMBED_DIMS; i++) norm += vec[i] * vec[i];
  norm = Math.sqrt(norm) || 1;
  for (let i = 0; i < EMBED_DIMS; i++) vec[i] /= norm;
  return vec;
}

function cosineSimilarity(a, b) {
  let dot = 0;
  for (let i = 0; i < a.length; i++) dot += a[i] * b[i];
  return dot; // already L2-normalized
}

// ----------------------------------------------------------------------------
// Signal 2: BM25
// ----------------------------------------------------------------------------
function buildBM25Index(docs) {
  const N = docs.length;
  const df = new Map();
  const docTokens = docs.map((d) => tokenize(d.doc));
  let totalLen = 0;
  for (const toks of docTokens) {
    totalLen += toks.length;
    for (const t of new Set(toks)) df.set(t, (df.get(t) ?? 0) + 1);
  }
  const avgdl = totalLen / N;
  const idf = new Map();
  for (const [term, d] of df) idf.set(term, Math.log(1 + (N - d + 0.5) / (d + 0.5)));
  return { docTokens, idf, avgdl, N };
}

function bm25Score(queryToks, docToks, index, k1 = 1.5, b = 0.75) {
  const tf = new Map();
  for (const t of docToks) tf.set(t, (tf.get(t) ?? 0) + 1);
  let score = 0;
  const dl = docToks.length;
  for (const qt of queryToks) {
    const f = tf.get(qt) ?? 0;
    if (f === 0) continue;
    const idf = index.idf.get(qt) ?? 0;
    score += idf * (f * (k1 + 1)) / (f + k1 * (1 - b + b * (dl / index.avgdl)));
  }
  return score;
}

function normalize01(scores) {
  const max = Math.max(...scores, 1e-9);
  const min = Math.min(...scores, 0);
  const range = max - min || 1;
  return scores.map((s) => (s - min) / range);
}

// ----------------------------------------------------------------------------
// Retrieval strategies
// ----------------------------------------------------------------------------
function rankBaseline(query, docs, docEmbeds) {
  const qv = embed(query);
  const scores = docs.map((d) => cosineSimilarity(qv, docEmbeds.get(d.id)));
  return docs
    .map((d, i) => ({ id: d.id, score: scores[i] }))
    .sort((a, b) => b.score - a.score);
}

function rankFusion(query, docs, docEmbeds, bm25Index, semanticWeight) {
  const qv = embed(query);
  const qToks = tokenize(query);
  const semScores = docs.map((d) => cosineSimilarity(qv, docEmbeds.get(d.id)));
  const bmScores = docs.map((d, i) => bm25Score(qToks, bm25Index.docTokens[i], bm25Index));
  const semNorm = normalize01(semScores);
  const bmNorm = normalize01(bmScores);
  const fused = docs.map((d, i) => semanticWeight * semNorm[i] + (1 - semanticWeight) * bmNorm[i]);
  return docs
    .map((d, i) => ({ id: d.id, score: fused[i] }))
    .sort((a, b) => b.score - a.score);
}

// ----------------------------------------------------------------------------
// Metrics
// ----------------------------------------------------------------------------
function evaluate(rankFn) {
  let hitsAt1 = 0, hitsAt3 = 0, rrSum = 0;
  const perQuery = [];
  for (const item of HONEST_CORPUS) {
    const ranked = rankFn(item.query);
    const pos = ranked.findIndex((r) => r.id === item.id) + 1; // 1-indexed, 0 if absent
    if (pos === 1) hitsAt1++;
    if (pos >= 1 && pos <= 3) hitsAt3++;
    if (pos >= 1) rrSum += 1 / pos;
    perQuery.push({ query: item.query, gold: item.id, rank: pos, top1: ranked[0]?.id });
  }
  const n = HONEST_CORPUS.length;
  return {
    n,
    recallAt1: hitsAt1 / n,
    recallAt3: hitsAt3 / n,
    mrr: rrSum / n,
    perQuery,
  };
}

// ----------------------------------------------------------------------------
// Main
// ----------------------------------------------------------------------------
async function main() {
  log(`benchmark-memory: ${HONEST_CORPUS.length} queries, ${ALL_DOCS.length} docs (${DISTRACTORS.length} belief-drift distractors), embed dims=${EMBED_DIMS}`);

  const docEmbeds = new Map(ALL_DOCS.map((d) => [d.id, embed(d.doc)]));
  const bm25Index = buildBM25Index(ALL_DOCS);

  log('\n[1/3] Baseline (semantic-only cosine)...');
  const baseline = evaluate((q) => rankBaseline(q, ALL_DOCS, docEmbeds));

  log('[2/3] Candidate (semantic + BM25 fusion, weight=0.7 semantic / 0.3 BM25)...');
  const candidateWeight = 0.7;
  const candidate = evaluate((q) => rankFusion(q, ALL_DOCS, docEmbeds, bm25Index, candidateWeight));

  // Paired significance (McNemar's test, exact binomial on discordant pairs)
  // over recall@1 hit/miss per query — the honest way to ask "is the effect
  // statistically meaningful" on a small (n=20) paired sample, per Dream
  // Cycle STEP 10's adversarial-evaluator question.
  let onlyCandidateRight = 0, onlyBaselineRight = 0;
  for (let i = 0; i < HONEST_CORPUS.length; i++) {
    const baseHit = baseline.perQuery[i].rank === 1;
    const candHit = candidate.perQuery[i].rank === 1;
    if (candHit && !baseHit) onlyCandidateRight++;
    if (baseHit && !candHit) onlyBaselineRight++;
  }
  const informativePairs = onlyCandidateRight + onlyBaselineRight;
  // Exact two-sided binomial test under H0: p=0.5 across discordant pairs.
  function binomCoeff(n, k) {
    let c = 1;
    for (let i = 0; i < k; i++) c = (c * (n - i)) / (i + 1);
    return c;
  }
  function exactBinomialTwoSided(k, n) {
    if (n === 0) return 1;
    const pmf = (x) => binomCoeff(n, x) * Math.pow(0.5, n);
    const kSmaller = Math.min(k, n - k);
    let p = 0;
    for (let x = 0; x <= kSmaller; x++) p += pmf(x);
    for (let x = n - kSmaller; x <= n; x++) if (x > kSmaller) p += pmf(x);
    return Math.min(1, p);
  }
  const mcnemarP = exactBinomialTwoSided(Math.min(onlyCandidateRight, onlyBaselineRight), informativePairs);
  const significance = {
    test: 'McNemar exact binomial on recall@1 discordant pairs',
    onlyCandidateRight,
    onlyBaselineRight,
    informativePairs,
    pValue: informativePairs === 0 ? null : +mcnemarP.toFixed(4),
    significantAt05: informativePairs > 0 && mcnemarP < 0.05,
    note: informativePairs < 10
      ? 'n too small for conventional significance at alpha=0.05 — directional evidence only, not a significance claim'
      : undefined,
  };

  log('[3/3] Bounded fusion-weight sweep (Darwin-style, single generation)...');
  const lineage = ARGS.weights.map((w) => {
    const r = evaluate((q) => rankFusion(q, ALL_DOCS, docEmbeds, bm25Index, w));
    return { semanticWeight: w, recallAt1: r.recallAt1, recallAt3: r.recallAt3, mrr: r.mrr };
  });
  const winner = [...lineage].sort((a, b) => (b.recallAt1 - a.recallAt1) || (b.mrr - a.mrr))[0];

  const results = {
    meta: {
      timestamp: new Date().toISOString(),
      node: process.version,
      corpusSize: HONEST_CORPUS.length,
      distractorCount: DISTRACTORS.length,
      embedDims: EMBED_DIMS,
      embeddingBackend: 'deterministic-feature-hashed-bow (NOT production ONNX — see file header HONESTY NOTES)',
    },
    baseline: { strategy: 'semantic-only cosine', ...baseline, perQuery: undefined },
    candidate: { strategy: `semantic+BM25 fusion (weight=${candidateWeight})`, ...candidate, perQuery: undefined },
    effect: {
      recallAt1Delta: +(candidate.recallAt1 - baseline.recallAt1).toFixed(4),
      recallAt3Delta: +(candidate.recallAt3 - baseline.recallAt3).toFixed(4),
      mrrDelta: +(candidate.mrr - baseline.mrr).toFixed(4),
    },
    significance,
    darwinLineage: lineage,
    darwinWinner: winner,
    baselineFailures: baseline.perQuery.filter((p) => p.rank !== 1),
    candidateFailures: candidate.perQuery.filter((p) => p.rank !== 1),
  };

  if (!ARGS.jsonOnly) {
    console.log(`\n# benchmark-memory — ${results.meta.timestamp}\n`);
    console.log('| strategy | recall@1 | recall@3 | MRR |');
    console.log('|---|---|---|---|');
    console.log(`| baseline (semantic-only) | ${baseline.recallAt1.toFixed(3)} | ${baseline.recallAt3.toFixed(3)} | ${baseline.mrr.toFixed(3)} |`);
    console.log(`| candidate (semantic+BM25, w=${candidateWeight}) | ${candidate.recallAt1.toFixed(3)} | ${candidate.recallAt3.toFixed(3)} | ${candidate.mrr.toFixed(3)} |`);
    console.log(`\nEffect (candidate - baseline): recall@1 ${results.effect.recallAt1Delta >= 0 ? '+' : ''}${results.effect.recallAt1Delta}, recall@3 ${results.effect.recallAt3Delta >= 0 ? '+' : ''}${results.effect.recallAt3Delta}, MRR ${results.effect.mrrDelta >= 0 ? '+' : ''}${results.effect.mrrDelta}\n`);
    console.log(`Significance: ${significance.test} — informative pairs=${significance.informativePairs} (candidate-only-right=${significance.onlyCandidateRight}, baseline-only-right=${significance.onlyBaselineRight}), p=${significance.pValue ?? 'n/a'}${significance.note ? ` (${significance.note})` : ''}\n`);
    console.log('## Darwin-style bounded weight sweep (single generation, 5 candidates)\n');
    console.log('| semantic weight | recall@1 | recall@3 | MRR |');
    console.log('|---|---|---|---|');
    for (const l of lineage) console.log(`| ${l.semanticWeight} | ${l.recallAt1.toFixed(3)} | ${l.recallAt3.toFixed(3)} | ${l.mrr.toFixed(3)} |`);
    console.log(`\nWinner: semantic weight ${winner.semanticWeight} (recall@1=${winner.recallAt1.toFixed(3)}, MRR=${winner.mrr.toFixed(3)})`);
    if (results.baselineFailures.length) {
      console.log('\n## Baseline misses (semantic-only ranked the wrong doc #1)\n');
      for (const f of results.baselineFailures) console.log(`- "${f.query}" → gold=${f.gold}, got=${f.top1} (rank ${f.rank || 'not found'})`);
    }
  }

  console.log('\n===BENCH_JSON===');
  console.log(JSON.stringify(results));
  return results;
}

main()
  .then(() => process.exit(0))
  .catch((e) => { console.error('FATAL:', e.stack || e.message); process.exit(1); });
