---
name: trader-explain
description: Regulator-grade feature attribution for any LSTM/Transformer signal — single-entry PageRank ranks the top-K features that drove the prediction (ADR-126 Phase 6, ADR-123 single-entry PR)
allowed-tools: Bash Read mcp__plugin_ruflo-core_ruflo__memory_retrieve mcp__plugin_ruflo-core_ruflo__memory_store mcp__ruflo-sublinear__page-rank-entry
argument-hint: "<signalId> [--top-k 10] [--seed 42]"
---
Explain a trading signal by building a feature-contribution graph and running single-entry forward-push PageRank from the signal output node. Top-K ranked features are returned as a markdown table AND persisted to `trading-analysis` as a `SignedAttributionArtifact` (ADR-126 Phase 6).

**Why this skill matters:**
- EU AI Act + SEC Reg-AI guidance require interpretable model output for any algorithmic trading system that touches retail capital. This is the regulator-grade attribution path the rest of the substrate has been waiting for.
- The same call site picks up the full native-WASM PageRank from `mcp__ruflo-sublinear__page-rank-entry` once that tool is registered in the runtime — until then, the local power-iteration kernel ships in `signed-attribution.mjs` and produces the same ordering (seeded mulberry32).

Steps:

1. **Retrieve the signal** from the canonical `trading-signals` namespace (ADR-126 Phase 1 + Phase 2 lifecycle):
   ```text
   mcp__plugin_ruflo-core_ruflo__memory_retrieve({
     key: "SIGNAL_ID",
     namespace: "trading-signals"
   })
   ```
   The signal entry includes `modelId`, `prediction`, and the feature vector at the time of inference.

2. **Extract per-feature contribution scores** from the model:
   ```bash
   npx neural-trader --predict --signal "$SIGNAL_ID" --explain --json
   ```
   The expected output shape:
   ```ts
   {
     features: Array<{ name: string; contribution: number }>;
     // for Transformers, also includes per-head attention co-occurrence:
     attention?: Array<{ head: string; cooccur: Array<[number, number, number]> }>;
   }
   ```

   **Fallback path** — if `--explain` is not shipped on the installed `neural-trader` build (older versions; the flag was scoped for a follow-up upstream PR), the skill degrades to a deterministic feature-importance heuristic over the signal's input vector: `contribution_i = |input_i - μ_i| / σ_i` (z-score magnitude). This is a known proxy — not as faithful as attention/SHAP — and the resulting artifact is tagged `attribution_method: "input-zscore-fallback"` so downstream consumers can filter it out for regulator filings. Document the fallback path in the resulting markdown summary so the agent surfaces it to the user.

3. **Build the feature-contribution graph**:
   - **Nodes**: one node per feature + one source node `__signal_output__` for the prediction.
   - **Edges**: outgoing edges from `__signal_output__` to each feature node, weighted by `contribution_i`. When attention co-occurrence data is available, also add edges between feature nodes weighted by `cooccur` — this is what makes the PageRank single-entry rather than degenerating to plain top-K.
   - **Source**: `__signal_output__` (index 0 by convention so the smoke can assert reproducibility).

4. **Run single-entry PageRank** — preferred path when `mcp__ruflo-sublinear__page-rank-entry` is registered:
   ```text
   mcp__ruflo-sublinear__page-rank-entry({
     nodes: GRAPH_NODES,
     edges: GRAPH_EDGES,
     sourceIndex: 0,
     damping: 0.85,
     maxIterations: 100,
     tolerance: 1e-8,
     seed: 42
   })
   ```
   The local fallback (`localSingleEntryPageRank` in `plugins/ruflo-neural-trader/src/signed-attribution.mjs`) runs ~30 LOC of seeded power-iteration when the MCP tool is not available — same math, same result up to floating-point tolerance, same ordering for the same seed (the Phase 6 smoke asserts this).

5. **Build the top-K `AttributionFeature[]`** via `topKFeatures(graph, scores, k=10, excludeIndex=0)` — excludes the source node from the ranked output. Ties broken by node index (lower index wins) so the ranking is deterministic.

6. **Sign the artifact** (reuses the Phase 4 signing primitives — same Ed25519 + canonicalization):
   - Build the `SignedAttributionArtifact` body:
     ```ts
     {
       signalId: SIGNAL_ID,
       modelId: SIGNAL.modelId,
       features: TOP_K_FEATURES,             // from step 5
       graphMetadata: {
         nodeCount: GRAPH.nodes.length,
         edgeCount: COUNT_EDGES,
         pageRankIterations: PR_RESULT.iterations,
         seed: SEED                          // load-bearing for reproducibility
       },
       generatedAt: NEW_DATE_ISO
     }
     ```
   - Resolve the witness signing key — same lookup order as Phase 4:
     1. `RUFLO_WITNESS_KEY_PATH` env var — JSON file with `{ "privateKey": "<hex>" }`.
     2. `verification/witness-key.json` (the ADR-103 default path).
   - If a key resolves: `signAttributionArtifact(body, privateKeyHex)` from `plugins/ruflo-neural-trader/src/signed-attribution.mjs`.
   - If NEITHER path resolves: log `"[WARN] ruflo-neural-trader: no witness signing key found — storing attribution artifact in UNSIGNED degraded mode. Regulator filings will reject UNSIGNED artifacts."` and store the body unsigned. NEVER silently fall back.

7. **Store the (possibly signed) artifact** to the canonical `trading-analysis` namespace (ADR-126 Phase 1):
   ```text
   mcp__plugin_ruflo-core_ruflo__memory_store({
     key: "attribution-SIGNAL_ID-TIMESTAMP",
     namespace: "trading-analysis",
     value: JSON.stringify(signedArtifact)
   })
   ```
   The `trading-analysis` namespace is the canonical home for model-analysis output (regime classifications, technical-indicator summaries, model-training results — and now attribution rankings). Long-lived — no TTL — because the audit trail is the deliverable.

8. **Return the markdown summary** to the agent. Suggested format:
   ```
   ## Feature attribution for signal `SIGNAL_ID` (model: MODEL_ID)

   | Rank | Feature | Score |
   |------|---------|-------|
   | 1    | NAME    | 0.42  |
   | 2    | NAME    | 0.18  |
   | …    | …       | …     |

   - PageRank iterations: N
   - Graph: nodeCount nodes, edgeCount edges
   - Seed: 42 (reproducible — same seed → same ordering)
   - Path: mcp | local
   - Signature: ed25519:abcd… (or UNSIGNED — degraded warning above)
   ```

### Verification

Downstream consumers verify the artifact before any regulator-facing report or paper→live promotion:

```ts
import { verifyAttributionArtifact } from 'plugins/ruflo-neural-trader/src/signed-attribution.mjs';

const ok = await verifyAttributionArtifact(artifact, trustedPublicKey);
if (!ok) {
  // [ERROR] attribution verification failed — refuse to publish.
  // Pin to trustedPublicKey from project config; do NOT trust the
  // artifact.witnessPublicKey field (CWE-347 / #1922 — attacker-controllable).
  return;
}
```

**Acceptance criteria (ADR-126 Phase 6):**
- `trader-explain <signalId>` returns a ranked feature list whose top-3 features overlap the model's attention argmax (when `--explain` available; documented tolerance).
- Reproducibility: two runs with the same `signalId` + same `--seed` produce byte-identical rank ordering (asserted by `scripts/smoke-neural-trader-feature-attribution.mjs`).
- Signed artifact verifies under the trusted pubkey; tampering any feature score or `graphMetadata.seed` invalidates the signature.
- Fallback paths engage cleanly: when MCP unavailable, local kernel runs; when `--explain` flag missing, z-score heuristic runs and the artifact is tagged.

**Refs:**
- ADR-126 Phase 6 (this skill's authoring ADR)
- ADR-126 Phase 4 (the signing scheme this reuses)
- ADR-123 (single-entry PageRank substrate; the same family that Phase 3 leverages for portfolio CG)
- `plugins/ruflo-neural-trader/src/signed-attribution.ts` (the typed contract)
- `plugins/ruflo-neural-trader/src/signed-attribution.mjs` (the runtime mirror)
- `scripts/smoke-neural-trader-feature-attribution.mjs` (the regression smoke)
