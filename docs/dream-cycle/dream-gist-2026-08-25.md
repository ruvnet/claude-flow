# Performance SOTA Report — 2026-08-25

TL;DR: Tonight's performance deep-dive found that Ruflo's HNSW product-quantization (PQ) feature (`quantization: { type: 'product' }`) has been silently broken since it was written: `Quantizer.productQuantize()`/`productQuantizeDistance()` correctly implement codebook-aware PQ encoding and distance (`hnsw-index.ts:1209-1360`), but the actual search path (`distance()`/`distanceOptimized()`) never called `productQuantizeDistance()` — it ran generic cosine/euclidean/dot/manhattan distance directly on raw PQ centroid-index arrays, which is numerically meaningless (index 5 vs. index 200 has no relation to embedding-space proximity). This is the same "computed-but-never-wired" bug class this pipeline has repeatedly shipped (2026-08-18 hybridSearch, 2026-08-19 MessageBus retry, 2026-08-24 weightedConsensus). Fix: dispatch to `productQuantizeDistance()` when PQ is active and codebooks are trained, guarded by a new `isValidPQEncoding()` check to avoid crashing/corrupting on vectors added before codebook training completes (a separate, disclosed, pre-existing limitation this patch does not fully solve). Measured on a deterministic synthetic clustered corpus: recall@10 recovers from 0.097 (pre-fix) to 0.270 (post-fix) — a real, reproducible ~2.8x improvement — while remaining honest that flat PQ trained globally on multi-modal data has a known ceiling well below "near-perfect," which this fix does not and should not claim to lift.

## What's New in 2026

| Finding | Source | Confidence |
|---|---|---|
| Two independent SIGMOD 2026 papers (Ada-ef, DARTH) converge on per-query *declarative-recall* adaptive `efSearch` as the fix for the exact static-ef recall/latency tradeoff that killed 2026-08-15's rejected candidate — strongest external evidence of the night, but scoped out of tonight's candidate for patch-size/risk reasons (see Recommended Next Steps) | arXiv:2512.06636 (SIGMOD 2026), arXiv:2505.19001 + github.com/MChatzakis/DARTH (SIGMOD 2026) | A |
| CVE-2026-25536: `@modelcontextprotocol/sdk` cross-client data leak via `StreamableHTTPServerTransport` reuse (1.10.0-1.25.3, fixed 1.26.0) — checked against Ruflo, not exploitable here (stdio transport, and `ruflo/src/ruvocal` already pinned to the fixed version) | GHSA-345p-7cg4-v4c7, cross-checked SentinelOne/Tenable/GitLab | A |
| OWASP Top 10 for Agentic Applications 2026 formalizes ASI07 "Insecure Inter-Agent Communication" — directly relevant to a dormant Ruflo control found tonight (see Scan Findings: security) | genai.owasp.org | A |
| SWARM+ (arXiv:2603.19431) validates at 990-agent scale that federation-style consensus quorums must shrink as members go stale/unreachable — directly on-point for a new hive-mind scan finding tonight | arXiv:2603.19431 | B |
| No production multi-agent framework (LangGraph, AutoGen/AG2, CrewAI, OpenAI Agents SDK) ships queue-aware/cost-aware model routing as a first-party feature — a genuine, well-documented open gap (layering convention, not a solved-but-unpublished capability), per InfraMIND (arXiv:2606.11440) | arXiv:2606.11440 + 4 official framework docs, checked 2026-08-25 | B |

## Ruflo Current Capability

`v3/@claude-flow/memory/src/hnsw-index.ts`: `Quantizer` supports `binary`/`scalar`/`product` quantization types. For `product`, `productQuantize()` (1209-1269) trains PQ codebooks via k-means and stores centroid indices; `productQuantizeDistance()` (1337-1360, pre-fix) correctly implements codebook-aware distance — but had **zero callers** anywhere in `v3/` (confirmed via repo-wide grep) prior to tonight. `addPoint()`/`search()` stored/queried via `this.quantizer.encode()` but then ran the generic `distance()` switch (cosine/euclidean/dot/manhattan) directly on the resulting centroid-index arrays, and even normalized those index arrays for the cosine fast-path — both operations meaningless on PQ codes. `type: 'product'` appeared in exactly one test fixture repo-wide and was exercised by zero recall/correctness tests before tonight.

Also confirmed, unrelated to tonight's fix: `binary`/`scalar` quantization have a related-but-distinct issue — `scalarQuantize()`'s output is `[min, range, ...levels]` (the prefix pollutes generic distance the same way PQ indices do), and `binaryQuantize()`'s packed-bit floats aren't cosine/Euclidean/dot-compatible either. **Disclosed, not fixed tonight** — kept out of scope to keep this patch one conceptual change (see Recommended Next Steps).

## Competitor Comparison

| Framework | Caching / KV-cache reuse | Adaptive/dynamic topology or scheduling | Queue-aware / cost-aware routing | Published perf benchmarks |
|---|---|---|---|---|
| LangGraph (v1.1.3) | Node-level output cache (`CachePolicy`, TTL) — not KV-cache | Conditional edges are task-logic-driven, not latency/cost-driven | None | Conflicting single-source claims (2.2x vs. 5.75x vs. losing to CrewAI) — B/C, not reproducible from a shared harness |
| AutoGen/AG2 | `cache_seed` exact-match completion cache | `GroupChat` speaker selection is who-talks-next logic, not a perf scheduler | None (cost/token tracking exists, unused for routing) | "8-9x token-efficiency vs LangChain" (B, academic cross-framework study); no first-party latency benchmark |
| CrewAI | Per-tool `cache_function` (developer-defined) | `Flows` branching is static, developer-defined | None — docs point to bolting on LiteLLM/Requesty | Vendor-adjacent "5.76x faster than LangGraph" contradicts the LangGraph row's own claim — neither independently reproducible (C) |
| OpenAI Agents SDK | Platform-level prompt caching (0.1x read cost, ≥1024 tokens) — real and quantified (A) but API-layer, not SDK-specific | `Handoffs` are developer-authored, not adaptive | Load-balancing exists but is infra-level, invisible to orchestration logic | OpenHands' agent SDK measured 38.8% cache-hit rate vs. reference `codex` agent's 94.8% — a **2.7-3.4x cost inflation from one missing `prompt_cache_key` parameter** (B, concrete cautionary data point) |

The "None" pattern for queue-aware/cost-aware routing is a genuine open gap, not solved-but-unpublished: InfraMIND (arXiv:2606.11440) reports +7.6pp accuracy / 7x lower latency / 99.9% vs <50% SLO compliance when routing is made infra-aware. The gap exists because all four frameworks deliberately push load-balancing/cache-affinity/cost signals down to a gateway layer (LiteLLM, vLLM Router, provider backend) to stay provider-portable — a real design tradeoff, not an oversight. Real opportunity for Ruflo, but the OpenHands `prompt_cache_key` incident is a live warning: caching is trivial to silently break in a multi-agent context, so any cache-aware routing claim needs a hit-rate-regression benchmark per release, not just a feature flag.

## Hypothesis

> Given an HNSWIndex configured with `quantization: { type: 'product' }`, where `productQuantize()`/`productQuantizeDistance()` correctly implement codebook-aware PQ encoding and distance but are never invoked by the search path, when `distance()`/`distanceOptimized()` are patched to dispatch to `quantizer.productQuantizeDistance()` whenever product quantization is active and codebooks are trained (falling back to today's generic distance during the pre-training bootstrap window, unchanged), and vector normalization is skipped for product-quantized vectors, then recall@10 of a product-quantized HNSWIndex should recover from the current near-chance-level baseline to a level materially closer to the unquantized index's recall@10, subject to: (1) non-`'product'` quantization paths are byte-identical to today's; (2) existing HNSW/memory test suite remains green; (3) `getCompressionRatio()` is unchanged; (4) zero LLM/API cost.

Frozen before evaluation began; not modified after seeing results.

## Benchmarks

Deterministic, $0, zero-LLM vitest additions: `v3/@claude-flow/memory/src/hnsw-quantization.test.ts`. Synthetic clustered corpus (8 well-separated Gaussian-ish blobs, N=1500, dim=64, seeded xorshift32 PRNG for full reproducibility), 30 held-out queries, recall@10 against brute-force ground truth computed on the *original unquantized* vectors (never leaked into the candidate).

Disclosed for transparency: initial corpus parameters (N=400, `codebookSize=16`) were adjusted twice — N=400 put an unrepresentatively large fraction of the corpus inside the PQ pre-training bootstrap window; `codebookSize=16` was arbitrarily small. `codebookSize=256` is the code's actual documented default, not a tuned value. The pass-bar (`>= 0.25`) was set *after* measuring both baseline and candidate at the final N=1500/codebookSize=256 config, disclosed in the test file's comment with both real numbers.

Darwin (`metaharness-darwin evolve --bench <suite.json>`) confirmed out of scope again tonight: its real interface evolves routing/topology/prompt/memory/tool/tier/context/coordination genome parameters against an LLM-scored bench corpus — no analog for a scoped TS distance-dispatch fix. Same class of skip as 4 of the last 5 dream-cycle nights.

## Evaluation

**evaluated: accepted.**

Baseline captured via `git stash` on `hnsw-index.ts` only (test file kept in place):

| Config | Recall@10 |
|---|---|
| Unquantized index (sanity check on corpus/harness) | 1.000 |
| Product-quantized, **pre-fix** (generic distance on raw PQ indices) | **0.097** |
| Product-quantized, **post-fix** (dispatched to `productQuantizeDistance`) | **0.270** |

A ~2.8x recall@10 improvement, fully reproducible (all seeds fixed). A diagnostic run (not part of the committed suite) isolated PQ metric quality from HNSW graph-traversal quality: brute-force search using `productQuantizeDistance()` directly gave the *same* 0.270 as the full graph search, confirming the fix's ceiling is genuine PQ fidelity (flat PQ trained globally under-resolves fine-grained same-cluster ranking on multi-modal data — a real, known PQ characteristic, not a new bug), not an HNSW graph-construction artifact compounding on top of it.

Full package suite: 461/462 passing pre- and post-fix (the 1 failure, `auto-memory-bridge.test.ts`'s read-only-file error-handling test, is environmental — this sandbox runs as root, which bypasses the `chmod`-based read-only precondition the test depends on; confirmed unrelated to this diff by identical failure on baseline). `tsc --noEmit` shows zero new errors attributable to this diff (all remaining errors are pre-existing `@types/node`/environment noise unrelated to `hnsw-index.ts`'s logic).

**Independent adversarial critic** (fresh session, no authoring context) independently re-derived the 0.097→0.270 numbers via its own `git stash` isolation (confirmed exact match), re-ran the full suite, checked the `Uint8Array`→`Float32Array` signature change against every caller in `v3/` (found one, `@claude-flow/cli/__tests__/pq-validation.test.ts`, unaffected — 7/7 tests pass, `any`-typed accessor), and generalization-tested beyond the shipped corpus shape (128d/16 clusters, 16d/4 clusters, 64d/1 cluster — improvement direction and rough magnitude held in all three, pre-fix 0.068-0.088 → post-fix 0.264-0.296). **Verdict: CONFIRMED-WITH-CAVEATS.** The one real caveat: `isValidPQEncoding()` is a *plausibility heuristic, not a proof of provenance* — the critic built a reproduction where an all-zero vector added pre-training passes the guard and gets silently (not-crashing, not-correctly-falling-back) mis-dispatched as if it were a real centroid assignment. This is a narrower manifestation of the same disclosed pre-training-fallback limitation, not a new hole; closing it fully needs per-node encoding-provenance tracking (out of scope tonight). Disclosed in-code and here rather than treated as fully solved.

## Darwin Results

Skipped — scope mismatch (see Benchmarks). Consistent with 08-14, 08-15, 08-18, 08-19, 08-24.

## SOTA Proof & Witness

(Populated in the Witness section of tonight's issue/PR; see below.)

## Recommended Next Steps

1. **Merge this candidate** (human review required) — closes a real, zero-cost correctness bug in a documented compression feature, with a permanent deterministic regression test.
2. **Follow up on 2026-08-15's rejected `efSearch` finding using tonight's Grade-A evidence** (Ada-ef/DARTH, SIGMOD 2026): per-query declarative-recall adaptive `efSearch`, materially different and better-evidenced than a `sqrt(N)` heuristic. Scoped out tonight for patch-size/risk (needs a calibration mechanism plus `deserialize()` persistence) — strongest lead of the night, deserves a dedicated future night.
3. **Wire `verifyInvocationToken` into `AgentAuthorizationPropagator.checkToolCall`** (`v3/@claude-flow/security/src/mcp-caller-identity.ts`) — an ADR-377 Ed25519 caller-identity control dormant since written, freshly relevant given OWASP's 2026 ASI07 category. Small, deterministic, env-gated.
4. **Fix `FederationHub.vote()`'s stale-vote/quorum-denominator mismatch** (`v3/@claude-flow/swarm/src/federation-hub.ts:700-728`) — a departed swarm's vote is never purged while the quorum denominator shrinks. Independent of 08-24's weightedConsensus fix, anchored by SWARM+ (arXiv:2603.19431).
5. **Harden or extend `scalar`/`binary` quantization distance dispatch** — same bug class as tonight's fix, disclosed but not fixed.
