// SignedAttributionArtifact — runtime ES module mirror of signed-attribution.ts.
//
// Why this file exists:
//   The plugin (ruflo-neural-trader) has no package.json / tsconfig /
//   build step — it ships skills + agents + scripts only. The `.ts`
//   file is the documented type-shape + source of truth (ADR-126
//   Phase 6 spec). This `.mjs` file is the runtime that the smoke
//   (`scripts/smoke-neural-trader-feature-attribution.mjs`) imports
//   directly, with zero compile step.
//
// Both files MUST stay in sync — any change to one is a change to the
// other. The smoke contract-checks the .ts file and runtime-tests the
// .mjs file; a divergence will fail one half of the smoke.
//
// Refs: ADR-126 Phase 6, CWE-347 pattern (#1922), ADR-103 witness.

/* ---------------------------------------------------------------------- */
/* Signing + verification (Ed25519, same scheme as Phase 4)               */
/* ---------------------------------------------------------------------- */

export async function signAttributionArtifact(body, privateKeyHex) {
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

export async function verifyAttributionArtifact(artifact, trustedPublicKey) {
  if (!artifact || !artifact.witnessSignature || !trustedPublicKey) return false;
  const ed = await import('@noble/ed25519');
  const body = {
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
/* Single-entry PageRank (forward-push) — local power-iteration fallback  */
/* ---------------------------------------------------------------------- */

export function localSingleEntryPageRank(graph, opts) {
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

  const personalization = new Float64Array(n);
  personalization[src] = 1;

  const rng = mulberry32(opts.seed);
  let r = new Float64Array(n);
  let sum = 0;
  for (let i = 0; i < n; i++) {
    r[i] = 1e-6 + rng();
    sum += r[i];
  }
  for (let i = 0; i < n; i++) r[i] /= sum;

  let iterations = 0;
  for (let step = 0; step < maxIter; step++) {
    iterations++;
    const next = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      const out = graph.edges[i];
      if (!out || out.length === 0) {
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
    for (let i = 0; i < n; i++) next[i] += (1 - damping) * personalization[i];

    let delta = 0;
    for (let i = 0; i < n; i++) delta += Math.abs(next[i] - r[i]);
    r = next;
    if (delta < tol) break;
  }

  let s = 0;
  for (let i = 0; i < n; i++) s += r[i];
  if (s > 0) for (let i = 0; i < n; i++) r[i] /= s;

  return { scores: Array.from(r), iterations };
}

/* ---------------------------------------------------------------------- */
/* MCP dispatch                                                            */
/* ---------------------------------------------------------------------- */

export function isPageRankMcpAvailable() {
  try {
    const tool = globalThis['mcp__ruflo-sublinear__page-rank-entry'];
    return typeof tool === 'function';
  } catch {
    return false;
  }
}

export async function singleEntryPageRank(graph, opts) {
  if (isPageRankMcpAvailable()) {
    try {
      const tool = globalThis['mcp__ruflo-sublinear__page-rank-entry'];
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

export function topKFeatures(graph, scores, k, excludeIndex) {
  const items = [];
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

function canonicalBytes(body) {
  const message = JSON.stringify(body);
  return new TextEncoder().encode(message);
}

function hexToBytes(hex) {
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

function bytesToHex(bytes) {
  let s = '';
  for (let i = 0; i < bytes.length; i++) {
    s += bytes[i].toString(16).padStart(2, '0');
  }
  return s;
}

function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
