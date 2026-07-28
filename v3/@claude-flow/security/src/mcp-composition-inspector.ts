/**
 * MCP Tool Composition Inspector — ADR-320 (this ADR; ruvnet/ruflo dream-cycle
 * proposal, arXiv:2606.27027 "ShareLock").
 *
 * The attack: an adversary registers N seemingly-benign MCP tools whose
 * individual descriptions look fine in isolation, but whose CONCATENATION
 * (or pairwise overlap) forms an injection payload targeting a downstream
 * agent — a Shamir-secret-sharing-style split across tool descriptions.
 * Per-tool inspection misses this because each fragment sits under any
 * single-tool detection threshold.
 *
 * Relationship to prior art in this repo
 * ---------------------------------------
 * A CLI-only v1 of this idea already shipped directly to `main`
 * (dream-cycle #2783, commits 381b7ebcc/581cd2bf3) as
 * `v3/@claude-flow/cli/src/security/mcp-composition-inspector.ts` — an
 * on-demand `ruflo security composition-scan` command using exact
 * common-substring matching plus an injection-phrase catalog and
 * typosquat check. That module's own header explicitly scopes itself as
 * "a bounded engineering fix rather than an ADR-scope subsystem" and lists
 * "Future v2: SimHash + LSH for scale" as deliberately deferred. THIS
 * module is that v2: a reusable `@claude-flow/security` library primitive
 * (not a CLI-only tool) built around a real SimHash fingerprint, so it can
 * be called from a pre-task/pre-tool-use hook before a multi-tool chain
 * executes, per this ADR's implementation target. It does not replace or
 * import the CLI v1 — the two are independent, complementary detectors
 * (exact-substring vs. hashed-shingle-overlap) that a caller may run
 * together.
 *
 * Detection method (deterministic, no LLM call)
 * -----------------------------------------------
 * 1. Each tool description is normalized and split into overlapping
 *    word-shingles (default: 5-word windows). Shingling — rather than
 *    whole-description comparison — is what lets us find a SMALL embedded
 *    fragment inside an otherwise unrelated, benign description.
 * 2. Each tool gets a 64-bit SimHash fingerprint: every shingle is hashed
 *    (FNV-1a, 64-bit) and the fingerprint bits are set by majority vote
 *    across all of a tool's shingle hashes. Two tools whose descriptions
 *    share enough content have a SMALL Hamming distance between
 *    fingerprints — this is the O(1)-per-pair coarse filter that avoids an
 *    LLM call and stays cheap even at hundreds of registered tools (fast
 *    64-bit XOR + popcount per pair).
 * 3. An inverted shingle-hash index (hash -> set of tool indices) is built
 *    once, in O(total shingles). For each pair flagged by the SimHash
 *    filter (or found in the index) the SAME index is used to compute the
 *    actual overlapping shingle text — this is what makes the finding
 *    reportable (the SimHash score alone can't tell an operator *what*
 *    matched).
 * 4. A fragment's "population" (how many distinct tools carry it) caps
 *    false positives: shared shingles that appear in more than
 *    `maxFragmentPopulation` (default 3) tools are template language
 *    (e.g. every ruflo `memory_*` tool's boilerplate), not an attack —
 *    Shamir-split attacks concentrate a fragment in a small conspiracy of
 *    2-3 tools. Same population-cap idea as the CLI v1, reimplemented here
 *    against the hash index instead of raw substrings.
 *
 * This is a heuristic detector, not a security boundary: it reports
 * SUSPECTS. Default action is warn + log; blocking is opt-in via
 * `CLAUDE_FLOW_MCP_COMPOSITION_BLOCK=1` (see {@link evaluateToolComposition}).
 *
 * @module @claude-flow/security/mcp-composition-inspector
 */

// ============================================================================
// Types
// ============================================================================

export interface McpToolDescriptor {
  name: string;
  description: string;
}

export interface CompositionInspectorOptions {
  /** Words per shingle window. Default 5. */
  shingleSize?: number;
  /** SimHash similarity (1 - Hamming/64) at/above which a pair is a candidate. Default 0.6. */
  simhashThreshold?: number;
  /** Fraction of a tool's shingles shared with a peer (low-population only) at/above which a pair is flagged. Default 0.25. */
  fragmentOverlapThreshold?: number;
  /** Max number of distinct tools a shingle may appear in before it's treated as template language, not an attack fragment. Default 3. */
  maxFragmentPopulation?: number;
  /** Minimum character length for a shingle to be indexed (filters trivial/common short phrases). Default 12. */
  minShingleChars?: number;
  /** Max sample shared fragments recorded per finding (display only). Default 5. */
  maxSampleFragments?: number;
}

export interface CompositionFinding {
  toolA: string;
  toolB: string;
  /** 1 - (Hamming distance / 64) between the two tools' SimHash fingerprints. */
  simhashSimilarity: number;
  /** sharedLowPopulationShingles / min(shingleCount(A), shingleCount(B)). */
  fragmentOverlapScore: number;
  /** Sample of the actual shared shingle text driving the finding (truncated). */
  sharedFragments: string[];
  /** Max population (distinct tools) observed among the shared shingles that triggered this finding. */
  fragmentPopulation: number;
  reason: string;
}

export interface CompositionInspectionStats {
  toolsScanned: number;
  pairsCompared: number;
  shinglesIndexed: number;
  /** Pairs whose SimHash similarity alone crossed simhashThreshold (diagnostic — includes pairs later excluded for having no low-population shared shingle). */
  candidatePairsFromSimhash: number;
}

export interface CompositionInspectionResult {
  findings: CompositionFinding[];
  stats: CompositionInspectionStats;
}

export interface CompositionGuardResult {
  result: CompositionInspectionResult;
  action: 'none' | 'warn' | 'block';
  blocked: boolean;
  message?: string;
}

// ============================================================================
// SimHash primitives (plain TS, no dependency)
// ============================================================================

const FNV_OFFSET_BASIS_64 = 0xcbf29ce484222325n;
const FNV_PRIME_64 = 0x100000001b3n;
const MASK_64 = (1n << 64n) - 1n;

/** FNV-1a, 64-bit. Deterministic, dependency-free, good avalanche for short strings. */
export function fnv1a64(input: string): bigint {
  let hash = FNV_OFFSET_BASIS_64;
  for (let i = 0; i < input.length; i++) {
    hash ^= BigInt(input.charCodeAt(i));
    hash = (hash * FNV_PRIME_64) & MASK_64;
  }
  return hash;
}

/**
 * Classic SimHash: bit-vote a 64-bit fingerprint across a list of token
 * hashes. Near-duplicate token sets (even with some fragments differing)
 * produce fingerprints with a small Hamming distance.
 */
export function simhash64(shingles: readonly string[]): bigint {
  if (shingles.length === 0) return 0n;
  const bitVotes = new Array<number>(64).fill(0);
  for (const shingle of shingles) {
    const h = fnv1a64(shingle);
    for (let bit = 0; bit < 64; bit++) {
      const set = (h >> BigInt(bit)) & 1n;
      bitVotes[bit] += set === 1n ? 1 : -1;
    }
  }
  let fingerprint = 0n;
  for (let bit = 0; bit < 64; bit++) {
    if (bitVotes[bit] > 0) fingerprint |= 1n << BigInt(bit);
  }
  return fingerprint;
}

/** Hamming distance between two 64-bit fingerprints (0..64). */
export function hammingDistance64(a: bigint, b: bigint): number {
  let x = (a ^ b) & MASK_64;
  let count = 0;
  while (x > 0n) {
    count += Number(x & 1n);
    x >>= 1n;
  }
  return count;
}

// ============================================================================
// Shingling
// ============================================================================

function normalize(text: string): string {
  return text.toLowerCase().replace(/\s+/g, ' ').trim();
}

/** Overlapping word-shingles of `k` words each. Falls back to the whole (short) text as a single shingle. */
function wordShingles(text: string, k: number): string[] {
  const words = normalize(text).split(' ').filter(Boolean);
  if (words.length === 0) return [];
  if (words.length < k) return [words.join(' ')];
  const shingles: string[] = [];
  for (let i = 0; i + k <= words.length; i++) {
    shingles.push(words.slice(i, i + k).join(' '));
  }
  return shingles;
}

// ============================================================================
// Inspection
// ============================================================================

interface IndexedTool {
  idx: number;
  name: string;
  shingles: string[];
  hashKeys: Set<string>;
  fingerprint: bigint;
}

export function inspectToolComposition(
  tools: readonly McpToolDescriptor[],
  options: CompositionInspectorOptions = {},
): CompositionInspectionResult {
  const shingleSize = options.shingleSize ?? 5;
  const simhashThreshold = options.simhashThreshold ?? 0.6;
  const fragmentOverlapThreshold = options.fragmentOverlapThreshold ?? 0.25;
  const maxFragmentPopulation = options.maxFragmentPopulation ?? 3;
  const minShingleChars = options.minShingleChars ?? 12;
  const maxSampleFragments = options.maxSampleFragments ?? 5;

  const indexed: IndexedTool[] = tools.map((t, idx) => {
    const shingles = wordShingles(t.description, shingleSize).filter((s) => s.length >= minShingleChars);
    const hashKeys = new Set(shingles.map((s) => fnv1a64(s).toString(36)));
    return {
      idx,
      name: t.name,
      shingles,
      hashKeys,
      fingerprint: simhash64(shingles),
    };
  });

  // Inverted index: shingle-hash -> {tools that carry it, sample text}.
  const shingleToTools = new Map<string, Set<number>>();
  const shingleSampleText = new Map<string, string>();
  for (const t of indexed) {
    for (const shingle of t.shingles) {
      const key = fnv1a64(shingle).toString(36);
      const set = shingleToTools.get(key) ?? new Set<number>();
      set.add(t.idx);
      shingleToTools.set(key, set);
      if (!shingleSampleText.has(key)) shingleSampleText.set(key, shingle);
    }
  }

  const findings: CompositionFinding[] = [];
  const stats: CompositionInspectionStats = {
    toolsScanned: tools.length,
    pairsCompared: 0,
    shinglesIndexed: shingleToTools.size,
    candidatePairsFromSimhash: 0,
  };

  for (let i = 0; i < indexed.length; i++) {
    for (let j = i + 1; j < indexed.length; j++) {
      stats.pairsCompared++;
      const a = indexed[i];
      const b = indexed[j];

      const hamming = hammingDistance64(a.fingerprint, b.fingerprint);
      const simhashSimilarity = a.shingles.length > 0 && b.shingles.length > 0 ? 1 - hamming / 64 : 0;
      if (simhashSimilarity >= simhashThreshold) stats.candidatePairsFromSimhash++;

      // Low-population shared shingles between this pair, via the inverted index.
      let sharedCount = 0;
      let maxPopulationSeen = 0;
      const sample: string[] = [];
      for (const key of a.hashKeys) {
        if (!b.hashKeys.has(key)) continue;
        const population = shingleToTools.get(key)?.size ?? 0;
        if (population > maxFragmentPopulation) continue; // template language, not an attack signature
        sharedCount++;
        maxPopulationSeen = Math.max(maxPopulationSeen, population);
        if (sample.length < maxSampleFragments) {
          const text = shingleSampleText.get(key);
          if (text) sample.push(text);
        }
      }

      const minShingleCount = Math.max(1, Math.min(a.shingles.length, b.shingles.length));
      const fragmentOverlapScore = sharedCount / minShingleCount;

      const flagBySimhash = simhashSimilarity >= simhashThreshold && sharedCount > 0;
      const flagByFragment = fragmentOverlapScore >= fragmentOverlapThreshold && sharedCount > 0;
      if (!flagBySimhash && !flagByFragment) continue;

      findings.push({
        toolA: a.name,
        toolB: b.name,
        simhashSimilarity: Number(simhashSimilarity.toFixed(3)),
        fragmentOverlapScore: Number(fragmentOverlapScore.toFixed(3)),
        sharedFragments: sample,
        fragmentPopulation: maxPopulationSeen,
        reason: flagBySimhash
          ? `SimHash similarity ${simhashSimilarity.toFixed(2)} (Hamming distance ${hamming}/64) with ${sharedCount} low-population shared shingle(s) (population <= ${maxFragmentPopulation}) — possible cross-tool instruction fragment`
          : `Fragment overlap ${fragmentOverlapScore.toFixed(2)} (${sharedCount}/${minShingleCount} shingles shared, population <= ${maxFragmentPopulation}) — possible Shamir-split instruction fragment`,
      });
    }
  }

  return { findings, stats };
}

// ============================================================================
// Guard: env-var-gated warn/block decision
// ============================================================================

const COMPOSITION_BLOCK_ENV = 'CLAUDE_FLOW_MCP_COMPOSITION_BLOCK';

/** Reads `CLAUDE_FLOW_MCP_COMPOSITION_BLOCK` fresh on every call. '1' or 'true' (case-insensitive) enables blocking; unset/anything else keeps the default warn+log posture. */
export function isCompositionBlockEnabled(): boolean {
  const raw = process.env[COMPOSITION_BLOCK_ENV];
  return raw === '1' || raw?.toLowerCase() === 'true';
}

/**
 * Runs {@link inspectToolComposition} and applies the ADR-320 default
 * posture: warn + log (via `console.warn`) unless
 * `CLAUDE_FLOW_MCP_COMPOSITION_BLOCK=1`, in which case the chain is marked
 * `blocked: true` — the caller (the pre-task hook / MCP dispatcher) decides
 * what "blocked" means operationally; this function does not throw or abort
 * anything itself.
 */
export function evaluateToolComposition(
  tools: readonly McpToolDescriptor[],
  options: CompositionInspectorOptions = {},
): CompositionGuardResult {
  const result = inspectToolComposition(tools, options);
  if (result.findings.length === 0) {
    return { result, action: 'none', blocked: false };
  }

  const summary =
    `MCP Composition Inspector: ${result.findings.length} suspicious cross-tool fragment(s) ` +
    `across ${result.stats.toolsScanned} tools (${result.stats.pairsCompared} pairs compared)`;

  if (isCompositionBlockEnabled()) {
    const message = `${summary} — blocking chain (${COMPOSITION_BLOCK_ENV}=1)`;
    console.warn(`[mcp-composition-inspector] ${message}`);
    for (const f of result.findings) {
      console.warn(`  - ${f.toolA} <-> ${f.toolB}: ${f.reason}`);
    }
    return { result, action: 'block', blocked: true, message };
  }

  console.warn(`[mcp-composition-inspector] ${summary}`);
  for (const f of result.findings) {
    console.warn(`  - ${f.toolA} <-> ${f.toolB}: ${f.reason}`);
  }
  return { result, action: 'warn', blocked: false, message: summary };
}
