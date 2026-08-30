# Performance SOTA Report — 2026-08-30

TL;DR: Tonight's performance deep-dive found that the audit-corrected HNSW figure ("~1.9x-4.7x vs brute force", `docs/reviews/intelligence-system-audit-2026-05-29.md`) never propagated into the CLI's own generated project docs — `ruflo init` was still writing an unsubstantiated "HNSW/DiskANN: 150x-12,500x faster search" claim into every new user's CLAUDE.md, alongside a reference to DiskANN as an active backend. Investigation found `diskann-backend.ts` (375 lines, a full 3-tier DiskANN→HNSW→brute-force fallback chain) has zero call sites anywhere in the monorepo and `@ruvector/diskann` isn't even a listed dependency — it never shipped. Fixed both in `claudemd-generator.ts` (2026-08-25/08-15's established "found-via-code-read, small-diff, deterministic-test" pattern), with a regression test pinning the corrected figure across every template. The same debunked "150x-12,500x" string also still appears live in ~14 other CLI source locations (help text, MCP tool metadata, command output) and a "2.49x-7.47x" Flash Attention figure with the identical problem in ~9 more — both **out of scope tonight** (see Recommended Next Steps) to keep this patch small and reviewable.

## What's New in 2026

| Finding | Source | Confidence |
|---|---|---|
| CHAT: constraint-aware, feasibility-boundary HNSW parameter tuning (M/efConstruction/efSearch) under recall/latency/memory constraints | arXiv:2607.04630 (2026) | B (preprint, methodology directly applicable) |
| RaBitQ 1-bit quantization with theoretical error bound, SIMD/bitwise distance estimation | Gao & Long, SIGMOD/PACMMOD 2024 (dl.acm.org/doi/10.1145/3654970) | A (peer-reviewed; this is the algorithm Ruflo's `rabitq-index.ts` already wraps) |
| SegPQ — lossless PQ codebook compression for memory-constrained ANN | VLDB 2025 (dl.acm.org/doi/10.14778/3749646.3749650) | A |
| CS-PQ — cache-friendly SIMD product quantization for ANNS construction | arXiv:2605.25521 (2026) | B — directly relevant: Ruflo's PQ `kMeans`/`encode` use naive nested loops, no SIMD/cache-blocking |
| Correlation-aware/surrogate-reward contextual bandits for LLM routing | arXiv:2607.09015 (2026) | B — matches a real gap: Ruflo's `model-router.ts` bandit reward is a flat `{model,outcome}` constant table, blind to the router's own continuous `predictedQuality` signal |
| Multi-agent KV-cache sharing (PolyKV, QKVShare, TokenDance, DroidSpeak) | arXiv:2604.24971, 2605.03884, 2604.03143, 2411.02820 | B/C — **not applicable to Ruflo**: these all assume the caller hosts the model/attention state; Ruflo orchestrates hosted-API calls per agent and has no local KV cache to share |
| CLEAR framework: 37% average gap between lab-benchmark and production performance for multi-agent systems | Cited via 2026 framework survey | B (secondhand) — a caution worth internalizing for Ruflo's own benchmark claims |

## Ruflo Current Capability

Vector search in this repo is fragmented across **three non-interoperating stacks**, only one of which is actually benchmarked end-to-end: `@claude-flow/memory`'s pure-JS `HNSWIndex`/`AgentDBAdapter` (the package's own documented public API, never recall-tested against brute force); `@claude-flow/cli/src/ruvector/vector-db.ts`'s NAPI-accelerated `VectorDb` (the *only* path `scripts/benchmark-intelligence.mjs` measures — source of the real "~1.9x-4.7x" number); and `memory-initializer.ts`'s own third, independent `HNSWIndex` interface backed by `@ruvector/core` with a correctly-split `efConstruction`/`efSearch` schema. A fourth, `rabitq-index.ts`'s 32x-compression path, is structurally unreachable from `@claude-flow/memory` consumers. `@claude-flow/memory`'s own `HNSWIndex.search()` has no `efSearch` field distinct from `efConstruction` at all — every call through the documented `AgentDBAdapter.semanticSearch()` API runs at `ef = efConstruction = 200` with no speed/recall tradeoff knob. (Note: 2026-08-15's PR #3034 tried adding exactly this field with a flat `efSearch=50` default and was **REJECTED** — recall dropped to 0.8767 at N=8000, breaching the 0.90 floor. Tonight's research treats that as still-standing evidence against a flat low default, not reopened without a scale-adaptive redesign — see Recommended Next Steps.)

Separately, `diskann-backend.ts` implements a complete `diskann → hnsw → cosine-js` fallback chain, including its own benchmark utility, but is imported by **nothing** — not `ruvector/index.ts`'s barrel export, not any command, not any test. `claudemd-generator.ts`'s generated CLAUDE.md told every new project to "Use HNSW/DiskANN for vector search" and claimed "HNSW/DiskANN: 150x-12,500x faster search" — a number this repo's own May 2026 audit explicitly could not reproduce and corrected to ~1.9x-4.7x in its own source-of-truth docs, five months before tonight.

## Competitor Comparison

| Framework | 2025-2026 performance work | Grade |
|---|---|---|
| Qdrant | GPU-accelerated HNSW build; 1.5/2-bit + asymmetric quantization beyond int8; inline-storage quantized-in-graph layout | B |
| Weaviate | Native BM25+vector hybrid; "Search Mode" test-time-compute scaling across 12 benchmarks (BEIR/LoTTe/BRIGHT/...); SQ8 ~4x memory, 1-2% recall loss | B |
| Milvus | GPU CAGRA (NVIDIA cuVS): ~50x search throughput, 12.5x better time-to-cost at top100@98% recall | A (methodology + hardware stated) |
| LanceDB | RaBitQ GA (1-bit + centroid-only routing, O(D log D) query prep) targeting 10B-vector scale | B |
| Vespa | 8.5-12.9x throughput/core vs Elasticsearch | B (Jan 2025, aging) |
| LangGraph / AutoGen / CrewAI / OpenAI Agents SDK | None ship a built-in cost/latency model router or cross-agent KV-cache sharing — LangGraph/OpenAI SDK leave caching to the model provider by design, not by omission | B |

**Verdict**: every major vector DB now ships GPU-accelerated indexing that Ruflo lacks — a genuine, open, unhidden gap. Where Ruflo differentiates (3-tier cost/latency routing, SONA) is unclaimed territory for all four agent-framework competitors surveyed, deliberately so in two cases.

## Hypothesis

> Given a new project created via `ruflo init` (default or `--wizard`), when the generated CLAUDE.md's performance/intelligence sections are corrected to drop the DiskANN claim (its only integration, `diskann-backend.ts`, has zero call sites in the monorepo and `@ruvector/diskann` is not a dependency) and replace "150x-12,500x faster search" with this repo's own measured figure ("~1.9x-4.7x vs brute force, recall@10 ~0.99"), then generated project documentation states only claims Ruflo can substantiate, subject to: (1) no other generated-doc section changes; (2) zero import/build errors anywhere in the monorepo from removing `diskann-backend.ts`; (3) existing test suite green; (4) $0 cost. Frozen before evaluation; not modified after.

## Evaluation

**evaluated: accepted.** Real evaluator: `vitest run` + `tsc --noEmit`, deterministic, $0. Baseline reproduced via `git stash` (source+test), confirmed the new test fails exactly as predicted (both stale strings present in the 'performance'/'full' template output); candidate (restored) passes 17/17 in the touched describe block. Full package suite: candidate and a controlled baseline re-run produced **byte-identical** 106-line failure lists (pre-existing, environmental — missing native `@ruvector/*-wasm` modules in this sandbox, same documented class as prior nights); an initial pair of ad hoc full-suite runs showed differing raw counts (104 vs 85) before the controlled comparison — disclosed as suite-level flakiness unrelated to this diff, not hidden. `tsc --noEmit`: pre-existing errors are all unbuilt-sibling-package (`@claude-flow/memory`, `@claude-flow/neural`, `@claude-flow/swarm`) resolution failures, none referencing either touched file.

**Independent adversarial critic** (fresh session, no authoring context): re-verified zero call sites for every `diskann-backend.ts` export across the *whole* repo (not just `cli/src`), including ruling out a false-positive `'diskann'` string in an unrelated backend-type enum in `@claude-flow/plugins`; independently re-read `docs/reviews/intelligence-system-audit-2026-05-29.md` and confirmed "~1.9x-4.7x, recall@10 ~0.99" is the correct current figure (noting one pre-existing, not-introduced-by-this-diff wrinkle: the audit doc itself says "recall ~0.9" in one older passage vs. "~0.99" elsewhere); reran `tsc --noEmit | grep diskann` (empty) and the new test in isolation (genuinely fails pre-fix, passes post-fix — not reward-hacked). **Verdict: CONFIRMED**, with one disclosure gap: the *single most user-visible* instance of this exact bug — `v3/@claude-flow/cli/src/commands/memory.ts:1153`'s live `output.printInfo('V3 Performance: 150x-12,500x faster search...')`, printed at runtime, not just in generated docs — is in the same package this candidate touched and was not fixed here. Correct call to keep out of scope (bundling it would have meant fixing an open-ended, ~15-location, cross-package sweep in one night), but it means tonight's fix, while real, is the least-visible instance of the underlying problem, not the most-visible one. Folded into Recommended Next Steps #2 below rather than silently left out.

## Darwin Results

Skipped — scope mismatch. This is a documentation-accuracy/dead-code-removal fix with no continuous/categorical parameter; `darwin --execute`'s real interface evolves routing/topology/prompt/memory/tool/tier/context/coordination genome parameters against an LLM-scored bench corpus. Same skip class as 7 of the last 8 dream-cycle nights.

## SOTA Proof & Witness

| Field | Value |
|---|---|
| Session commit | `d33ef4bf8ab27a8f9ef08352c9c293b53312a861` |
| Gist SHA-256 (pre-witness content, i.e. this file before this table was filled in) | `e7e49ab0d00defdb79d300bbf5bda8406e50571e3e7ad4c7c34d5b802e57f6c1` |
| Witness stamp | `3c98578c914fbef2cf1e264b788660d729f5a65b33965ca3d2d3b850ed3de450` |

Verifier procedure: fetch `docs/dream-cycle/dream-gist-2026-08-30.md` from the `dream/2026-08-30-performance` branch, strip this table back to the placeholder line ("See issue and PR for the full witness table..."), SHA-256 the result, concatenate with the session commit above, SHA-256 again — result must equal the witness stamp.

## Recommended Next Steps

1. **Merge this candidate** (human review required) — removes 375 lines of unreachable, misleading code and closes a real, reproducible gap between this repo's own corrected audit and what it tells every new user.
2. **The same "150x-12,500x" string is still live in ~14 other CLI source locations** (`src/index.ts` `--help` output, `mcp-tools/{memory,hooks}-tools.ts`, `init/executor.ts`'s generated CAPABILITIES.md, `commands/{ruvector,embeddings,hooks,memory,agent,performance}.ts`) and a structurally identical "2.49x-7.47x" Flash Attention figure (already flagged as unreproduced in root CLAUDE.md) appears in ~9 more locations, plus ~15 `.claude/skills`/`.claude/agents` SKILL.md files (per the adversarial critic's independent grep). **Highest-priority single instance**: `commands/memory.ts:1153`'s `output.printInfo('V3 Performance: 150x-12,500x faster search...')` is live runtime CLI output, not generated docs — more user-visible than what this candidate fixed tonight. Deliberately not bundled here to keep tonight's diff to one small, reviewable file — worth a dedicated `automation`/`meta` sweep night, ideally scripted (grep + verified replacement) rather than hand-edited file by file.
3. Re-open the `@claude-flow/memory` `efSearch`/`efConstruction` decoupling question **only** with a scale-adaptive default (per CHAT, arXiv:2607.04630) — not a flat low default, which is exactly what 2026-08-15's PR #3034 tested and got rejected for.
4. `Quantizer.productQuantizeDistance()` is still unwired into `HNSWIndex.distance()` five research-nights after 2026-08-25 first reported it — cheap, high-confidence, still open.
5. Consider a graded/surrogate reward signal for `model-router.ts`'s bandit using its own `predictedQuality` output (arXiv:2607.09015) — medium risk given ADR-148/149/150 already build on the current reward shape; recommend offline replay against `.swarm/model-router-state.json` before any live change.
