/**
 * SignedAttributionArtifact — Phase 6 of ADR-126
 *
 * Ed25519-signed envelope for feature-attribution rankings. Given a trading
 * signal (LSTM / Transformer / N-BEATS prediction), the `trader-explain`
 * skill builds a feature-contribution graph, runs single-entry PageRank
 * (forward-push from the signal output node), and stores the top-K ranked
 * features to `trading-analysis` as the artifact below. The signature gives
 * the result regulator-grade tamper evidence (EU AI Act interpretability,
 * SEC Reg-AI explainability) and the seed field makes the ranking
 * reproducible across two identical runs.
 *
 * Signing scheme — identical to Phase 4's `SignedBacktestArtifact` (the
 * CWE-347 plugin-registry pattern, #1922):
 *
 *   1. Build the artifact body WITHOUT signature fields
 *      (no `witnessSignature`, no `witnessPublicKey`, no `schema`).
 *   2. `JSON.stringify(...)` plain — no whitespace, no sort.
 *   3. Sign the resulting bytes with Ed25519.
 *   4. Verify pins to a caller-supplied `trustedPublicKey`,
 *      NOT to the self-asserted `witnessPublicKey` field on the artifact
 *      (an attacker controls that field; pinning to it is a no-op).
 *
 * This module deliberately re-uses the same canonical-bytes layout and
 * helper functions as `signed-artifact.ts`. The shape only differs in the
 * envelope's payload fields (`features` + `graphMetadata` + `signalId` +
 * `modelId` instead of backtest metrics + runsHash).
 *
 * Refs:
 *   - ADR-126 Phase 6   — the integration plan (feature attribution)
 *   - ADR-126 Phase 4   — the sibling signing scheme we reuse
 *   - ADR-123           — single-entry PageRank substrate
 *   - ADR-103           — witness temporal history
 *   - CWE-347 / #1922   — the pattern this signing scheme matches
 */

/* ---------------------------------------------------------------------- */
/* Public types                                                           */
/* ---------------------------------------------------------------------- */

/** One ranked feature contribution to the model's output. */
export interface AttributionFeature {
  /** Stable feature identifier. e.g. `rsi_14`, `attention_head_3`, `price_close_t-7`. */
  name: string;
  /** PageRank score in [0, 1] (mass-normalized over all features). */
  score: number;
  /** 1-indexed rank in the descending-score ordering. */
  rank: number;
}

export interface SignedAttributionArtifact {
  schema: 'ruflo-neural-trader-attribution/v1';
  /** The signal whose prediction is being explained. */
  signalId: string;
  /** Which model produced the signal. e.g. `lstm-v3`, `transformer-attn8h-v2`. */
  modelId: string;
  /** Top-K ranked features (rank 1 = most influential). */
  features: AttributionFeature[];
  /** Reproducibility metadata — same seed + same graph → same ranking. */
  graphMetadata: {
    nodeCount: number;
    edgeCount: number;
    pageRankIterations: number;
    /** Seed fed to the PageRank initializer. Required for reproducibility. */
    seed: number;
  };
  generatedAt: string;
  witnessPublicKey: string;
  witnessSignature: string;
}

/** Body that gets signed — everything except the two signature fields + schema. */
export type SignedAttributionArtifactBody = Omit<
  SignedAttributionArtifact,
  'witnessPublicKey' | 'witnessSignature' | 'schema'
>;

/* ---------------------------------------------------------------------- */
/* Signing + verification                                                 */
/* ---------------------------------------------------------------------- */

/**
 * Sign the body of an attribution artifact and return the fully-formed
 * `SignedAttributionArtifact` envelope.
 *
 * The signature covers the artifact body WITHOUT `witnessSignature` and
 * WITHOUT `witnessPublicKey` (CWE-347 pattern, same as Phase 4). The
 * verifier MUST pin to a trusted key for the pin to be a real defense.
 *
 * @param body                — artifact body (everything except signature fields + schema)
 * @param privateKeyHex       — 32-byte Ed25519 private key as hex (no 'ed25519:' prefix)
 * @returns                     the signed artifact ready to be stored
 */
export async function signAttributionArtifact(
  body: SignedAttributionArtifactBody,
  privateKeyHex: string,
): Promise<SignedAttributionArtifact> {
  const ed = await import('@noble/ed25519');
  const privateKey = hexToBytes(privateKeyHex);
  if (privateKey.length !== 32) {
    throw new Error(
      `signAttributionArtifact: privateKey must be 32 bytes (got ${privateKey.length})`,
    );
  }

  const canonical = canonicalBytes(body);
  const signatureBytes = await ed.signAsync(canonical, privateKey);
  const publicKeyBytes = await ed.getPublicKeyAsync(privateKey);

  return {
    schema: 'ruflo-neural-trader-attribution/v1',
    ...body,
    witnessPublicKey: `ed25519:${bytesToHex(publicKeyBytes)}`,
    witnessSignature: bytesToHex(signatureBytes),
  };
}

/**
 * Verify a signed attribution artifact against a caller-supplied trusted
 * public key. Returns `true` iff the signature is valid for the canonical
 * body under the TRUSTED key.
 *
 * IMPORTANT — pins to `trustedPublicKey`, NOT to `artifact.witnessPublicKey`
 * (CWE-347 / #1922). The artifact's self-asserted public key is untrusted
 * input that an attacker can swap.
 *
 * @param artifact          — the artifact to verify (may have been tampered)
 * @param trustedPublicKey  — caller-supplied trusted pubkey, with or without 'ed25519:' prefix
 */
export async function verifyAttributionArtifact(
  artifact: SignedAttributionArtifact,
  trustedPublicKey: string,
): Promise<boolean> {
  if (!artifact || !artifact.witnessSignature || !trustedPublicKey) return false;
  const ed = await import('@noble/ed25519');

  const body: SignedAttributionArtifactBody = {
    signalId: artifact.signalId,
    modelId: artifact.modelId,
    features: artifact.features,
    graphMetadata: artifact.graphMetadata,
    generatedAt: artifact.generatedAt,
  };
  const canonical = canonicalBytes(body);

  try {
    const pubKeyHex = trustedPublicKey.replace(/^ed25519:/, '');
    const pubKey = hexToBytes(pubKeyHex);
    if (pubKey.length !== 32) return false;
    const sig = hexToBytes(artifact.witnessSignature);
    if (sig.length !== 64) return false;
    return await ed.verifyAsync(sig, canonical, pubKey);
  } catch {
    return false;
  }
}

/* ---------------------------------------------------------------------- */
/* Single-entry PageRank (forward-push)                                   */
/* ---------------------------------------------------------------------- */

/** Sparse directed graph used by the local PageRank fallback. */
export interface AttributionGraph {
  /** Stable node identifiers — `nodes[i]` is feature-id of node index `i`. */
  nodes: string[];
  /**
   * Adjacency list: `edges[i]` = array of `{ target, weight }` pairs giving
   * the outgoing edges from node `i`. `target` is a node index.
   */
  edges: Array<Array<{ target: number; weight: number }>>;
}

export interface PageRankOptions {
  /** Index of the source node (the signal output node). */
  sourceIndex: number;
  /** Damping factor (typically 0.85). */
  damping?: number;
  /** Max power-iteration steps. */
  maxIterations?: number;
  /** L1 convergence threshold. */
  tolerance?: number;
  /**
   * RNG seed for the initializer. With damping=0 (or no edges) this is
   * the only source of variation between runs — used to assert
   * reproducibility in the Phase 6 smoke.
   */
  seed: number;
}

export interface PageRankResult {
  /** PageRank scores aligned with `graph.nodes` (sum ≈ 1). */
  scores: number[];
  /** Number of power-iteration steps actually executed. */
  iterations: number;
}

/**
 * Local JS power-iteration single-entry PageRank — the fallback used when
 * `mcp__ruflo-sublinear__page-rank-entry` is not registered in the runtime.
 *
 * The math: standard personalized PageRank with the personalization vector
 * concentrated entirely on the source node. Forward-push semantics in the
 * limit, plain power iteration on a small in-memory graph in practice.
 * Seeded so that two runs with the same graph + same seed return byte-
 * identical ordering (asserted by the Phase 6 smoke's reproducibility
 * check).
 */
export function localSingleEntryPageRank(
  graph: AttributionGraph,
  opts: PageRankOptions,
): PageRankResult {
  const n = graph.nodes.length;
  if (n === 0) return { scores: [], iterations: 0 };
  const damping = opts.damping ?? 0.85;
  const maxIter = opts.maxIterations ?? 100;
  const tol = opts.tolerance ?? 1e-8;
  const src = opts.sourceIndex;
  if (src < 0 || src >= n) {
    throw new Error(
      `localSingleEntryPageRank: sourceIndex ${src} out of range [0, ${n})`,
    );
  }

  // Personalization vector concentrated on src.
  const personalization = new Float64Array(n);
  personalization[src] = 1;

  // Initialize: seeded deterministic noise then re-normalize so the start
  // vector still sums to 1. The seed controls the initialization only —
  // PageRank converges to the same stationary distribution regardless, but
  // the iteration *order* and the path through the state space depend on
  // the seed when ties are present. This is what the smoke asserts.
  let rng = mulberry32(opts.seed);
  let r = new Float64Array(n);
  let sum = 0;
  for (let i = 0; i < n; i++) {
    // Small positive noise so we don't divide by zero on degenerate graphs.
    r[i] = 1e-6 + rng();
    sum += r[i];
  }
  for (let i = 0; i < n; i++) r[i] /= sum;

  let iterations = 0;
  for (let step = 0; step < maxIter; step++) {
    iterations++;
    const next = new Float64Array(n);
    // Distribute current mass over outgoing edges, weighted.
    for (let i = 0; i < n; i++) {
      const out = graph.edges[i];
      if (!out || out.length === 0) {
        // Dangling node — distribute its mass back to the personalization.
        next[src] += damping * r[i];
        continue;
      }
      let totalW = 0;
      for (let k = 0; k < out.length; k++) totalW += Math.max(0, out[k].weight);
      if (totalW === 0) {
        next[src] += damping * r[i];
        continue;
      }
      for (let k = 0; k < out.length; k++) {
        const w = Math.max(0, out[k].weight);
        next[out[k].target] += (damping * r[i] * w) / totalW;
      }
    }
    // Add the personalization (teleport) term.
    for (let i = 0; i < n; i++) next[i] += (1 - damping) * personalization[i];

    // L1 convergence
    let delta = 0;
    for (let i = 0; i < n; i++) delta += Math.abs(next[i] - r[i]);
    r = next;
    if (delta < tol) break;
  }

  // Renormalize defensively (drift from floating point + dangling handling).
  let s = 0;
  for (let i = 0; i < n; i++) s += r[i];
  if (s > 0) for (let i = 0; i < n; i++) r[i] /= s;

  return { scores: Array.from(r), iterations };
}

/* ---------------------------------------------------------------------- */
/* MCP dispatch                                                            */
/* ---------------------------------------------------------------------- */

/**
 * True iff `mcp__ruflo-sublinear__page-rank-entry` is registered in the
 * current runtime (the agent sandbox or the host process). Mirrors the
 * `SublinearAdapter.isMcpAvailable()` pattern from Phase 3.
 */
export function isPageRankMcpAvailable(): boolean {
  try {
    const tool = (globalThis as Record<string, unknown>)[
      'mcp__ruflo-sublinear__page-rank-entry'
    ];
    return typeof tool === 'function';
  } catch {
    return false;
  }
}

/**
 * Dispatch to `mcp__ruflo-sublinear__page-rank-entry` when available, fall
 * through to the local power-iteration kernel otherwise. Either way the
 * math is single-entry forward-push PageRank with the personalization
 * vector concentrated on `sourceIndex`.
 */
export async function singleEntryPageRank(
  graph: AttributionGraph,
  opts: PageRankOptions,
): Promise<PageRankResult & { path: 'mcp' | 'local' }> {
  if (isPageRankMcpAvailable()) {
    try {
      const tool = (globalThis as Record<string, unknown>)[
        'mcp__ruflo-sublinear__page-rank-entry'
      ] as (args: unknown) => Promise<{ scores: number[]; iterations?: number }>;
      const out = await tool({
        nodes: graph.nodes,
        edges: graph.edges,
        sourceIndex: opts.sourceIndex,
        damping: opts.damping ?? 0.85,
        maxIterations: opts.maxIterations ?? 100,
        tolerance: opts.tolerance ?? 1e-8,
        seed: opts.seed,
      });
      if (out && Array.isArray(out.scores)) {
        return {
          scores: out.scores,
          iterations: out.iterations ?? 0,
          path: 'mcp',
        };
      }
    } catch {
      // fall through to local
    }
  }
  return { ...localSingleEntryPageRank(graph, opts), path: 'local' };
}

/* ---------------------------------------------------------------------- */
/* Ranking helper                                                          */
/* ---------------------------------------------------------------------- */

/**
 * Convert a `(graph, scores)` pair into a top-K `AttributionFeature[]` ready
 * to drop into `SignedAttributionArtifact.features`. Ties broken
 * deterministically by node index (lower index wins) so the ranking is
 * reproducible.
 */
export function topKFeatures(
  graph: AttributionGraph,
  scores: number[],
  k: number,
  excludeIndex?: number,
): AttributionFeature[] {
  const items: Array<{ name: string; score: number; idx: number }> = [];
  for (let i = 0; i < graph.nodes.length; i++) {
    if (i === excludeIndex) continue;
    items.push({ name: graph.nodes[i], score: scores[i] ?? 0, idx: i });
  }
  items.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return a.idx - b.idx;
  });
  return items.slice(0, k).map((item, i) => ({
    name: item.name,
    score: item.score,
    rank: i + 1,
  }));
}

/* ---------------------------------------------------------------------- */
/* Helpers                                                                */
/* ---------------------------------------------------------------------- */

function canonicalBytes(body: SignedAttributionArtifactBody): Uint8Array {
  const message = JSON.stringify(body);
  return new TextEncoder().encode(message);
}

function hexToBytes(hex: string): Uint8Array {
  const clean = hex.replace(/^0x/, '');
  if (clean.length % 2 !== 0) {
    throw new Error('hexToBytes: odd-length hex string');
  }
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

function bytesToHex(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i++) {
    s += bytes[i].toString(16).padStart(2, '0');
  }
  return s;
}

/**
 * Mulberry32 — small, fast, deterministic PRNG. Same algorithm everywhere
 * (no Math.random dependency) so a given seed reproduces byte-for-byte.
 */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
