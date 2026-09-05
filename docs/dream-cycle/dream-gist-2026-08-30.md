# Performance SOTA Report — 2026-08-30

TL;DR: Tonight's performance deep-dive found that the audit-corrected HNSW figure ("~1.9x-4.7x vs brute force", `docs/reviews/intelligence-system-audit-2026-05-29.md`) never propagated into the CLI's own generated project docs — `ruflo init` was still writing an unsubstantiated "HNSW/DiskANN: 150x-12,500x faster search" claim into every new user's CLAUDE.md, alongside a reference to DiskANN as an active backend. Investigation found `diskann-backend.ts` (375 lines, a full 3-tier DiskANN→HNSW→brute-force fallback chain) has zero call sites anywhere in the monorepo and `@ruvector/diskann` isn't even a listed dependency — it never shipped. Fixed both in `claudemd-generator.ts` (2026-08-25/08-15's established "found-via-code-read, small-diff, deterministic-test" pattern), with a regression test pinning the corrected figure across every template. The same debunked "150x-12,500x" string also still appears live in ~14 other CLI source locations (help text, MCP tool metadata, command output) and a "2.49x-7.47x" Flash Attention figure with the identical problem in ~9 more — both **out of scope tonight** (see Recommended Next Steps) to keep this patch small and reviewable.

**Post-review update (same night):** the repo owner reviewed the first version of this candidate and rejected it on three grounds, all addressed below and re-evaluated: (1) CI red on this exact head from a repo-wide `@claude-flow/mcp@3.0.0-alpha.10` install failure — confirmed pre-existing on `main`, partially fixed here by porting the accepted `v3/pnpm-lock.yaml` fix from open PR #3104, with the remaining root-npm side correctly left to maintainer judgment per issue #3095's own text; (2) this branch had accumulated an 11-row ledger backfill (2026-08-20 through 08-29) instead of exactly one row for this run — trimmed to one row, ledger repair deferred to its own effort; (3) the replacement HNSW claim itself cited a doc (`~1.9x-4.7x, recall@10 ~0.99`) that self-contradicts elsewhere (`~0.9` vs `~0.99`) — replaced with a live re-run of `scripts/benchmark-intelligence.mjs` on this exact commit (see Evaluation) and the generated docs now point at the reproducible command instead of a hardcoded multiplier, so this can't drift stale again.

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

> Given a new project created via `ruflo init` (default or `--wizard`), when the generated CLAUDE.md's performance/intelligence sections are corrected to drop the DiskANN claim (its only integration, `diskann-backend.ts`, has zero call sites in the monorepo and `@ruvector/diskann` is not a dependency) and replace "150x-12,500x faster search" with a claim Ruflo can actually substantiate, then generated project documentation states only claims Ruflo can substantiate, subject to: (1) no other generated-doc section changes; (2) zero import/build errors anywhere in the monorepo from removing `diskann-backend.ts`; (3) existing test suite green; (4) $0 cost. Frozen before evaluation; not modified after.
>
> **Revised post-review**: "a claim Ruflo can actually substantiate" was originally instantiated as a copied number ("~1.9x-4.7x, recall@10 ~0.99") from `docs/reviews/intelligence-system-audit-2026-05-29.md`. The reviewer correctly flagged that this doc itself contains both "~0.9" and "~0.99" recall language — an unresolved ambiguity, not a citable fact. The hypothesis's *intent* (state only what Ruflo can substantiate) is unchanged; its *instantiation* is revised to point the generated docs at the live reproducible command (`node scripts/benchmark-intelligence.mjs --only=hnsw`) rather than any hardcoded number, so the claim can never re-drift stale the way "150x-12,500x" did.

## Evaluation

**evaluated: accepted.** Real evaluator: `vitest run` + `tsc --noEmit`, deterministic, $0. Baseline reproduced via `git stash` (source+test), confirmed the new test fails exactly as predicted (both stale strings present in the 'performance'/'full' template output); candidate (restored) passes 17/17 in the touched describe block. Full package suite: candidate and a controlled baseline re-run produced **byte-identical** 106-line failure lists (pre-existing, environmental — missing native `@ruvector/*-wasm` modules in this sandbox, same documented class as prior nights); an initial pair of ad hoc full-suite runs showed differing raw counts (104 vs 85) before the controlled comparison — disclosed as suite-level flakiness unrelated to this diff, not hidden. `tsc --noEmit`: pre-existing errors are all unbuilt-sibling-package (`@claude-flow/memory`, `@claude-flow/neural`, `@claude-flow/swarm`) resolution failures, none referencing either touched file.

**Reproducible benchmark receipt (added post-review, per reviewer's "one unambiguous fixture and command" ask).** Built `v3/@claude-flow/cli` (`npm run build`; the same pre-existing unbuilt-sibling-package `tsc` errors above, dist still emits) and ran the exact command now referenced in the generated docs, twice, on this session's host:

```
node scripts/benchmark-intelligence.mjs --only=hnsw --sizes 5000,20000 --queries 30
```

| N | run 1 speedup | run 2 speedup | recall@10 (both runs, identical) |
|--:|--:|--:|--:|
| 5000 | 3.62x | 2.85x | 0.9867 |
| 20000 | 6.77x | 7.58x | 0.9233 |

`recall@10` is exactly reproducible across runs (seeded RNG for vector generation); `speedup` varies with host load (wall-clock timing), always >1x in both runs. This is the reviewer's requested "unambiguous fixture" — **and it disagrees with the doc figure it was meant to confirm**: recall@10 at N=20000 measured 0.9233, not "~0.99" as both the audit doc and this candidate's first version claimed. That is itself new evidence the "~1.9x-4.7x/recall~0.99" figure needs its own re-verification night (see Recommended Next Steps) — not something to quietly paper over by picking whichever cited number looked closest. The shipped fix no longer hardcodes any of these numbers into generated docs; it names the reproduction command instead.

**Independent adversarial critic** (fresh session, no authoring context): re-verified zero call sites for every `diskann-backend.ts` export across the *whole* repo (not just `cli/src`), including ruling out a false-positive `'diskann'` string in an unrelated backend-type enum in `@claude-flow/plugins`; independently re-read `docs/reviews/intelligence-system-audit-2026-05-29.md` and confirmed "~1.9x-4.7x, recall@10 ~0.99" is the correct current figure (noting one pre-existing, not-introduced-by-this-diff wrinkle: the audit doc itself says "recall ~0.9" in one older passage vs. "~0.99" elsewhere); reran `tsc --noEmit | grep diskann` (empty) and the new test in isolation (genuinely fails pre-fix, passes post-fix — not reward-hacked). **Verdict: CONFIRMED**, with one disclosure gap: the *single most user-visible* instance of this exact bug — `v3/@claude-flow/cli/src/commands/memory.ts:1153`'s live `output.printInfo('V3 Performance: 150x-12,500x faster search...')`, printed at runtime, not just in generated docs — is in the same package this candidate touched and was not fixed here. Correct call to keep out of scope (bundling it would have meant fixing an open-ended, ~15-location, cross-package sweep in one night), but it means tonight's fix, while real, is the least-visible instance of the underlying problem, not the most-visible one. Folded into Recommended Next Steps #3 below rather than silently left out.

## CI Remediation (post-review)

Both commits on this branch failed nearly every CI check at the shared `npm ci`/`pnpm install` step — confirmed pre-existing on `main` at this PR's base commit before this branch existed (identical `ETARGET` on `@claude-flow/mcp@3.0.0-alpha.10`, which the npm registry has never published; latest published is `3.0.0-alpha.9`). Two already-tracked issues cover this: #3101 (pnpm-lockfile side, has an open fix PR #3104) and #3095 (root-npm side, no patch proposed by design — "dependency/release surfaces require maintainer validation"). Ported #3104's one-line `v3/pnpm-lock.yaml` fix into this branch (validated: `corepack pnpm install --frozen-lockfile --lockfile-only` now succeeds) — this resolves the v3-pnpm-driven jobs (Type Check V3, Test V3 Packages, etc.). The root-npm-side jobs (Integration Test Setup, Setup Verification, Audit root, CI/CD Pipeline, most smoke tests) remain blocked on #3095, which explicitly defers to a maintainer decision (publish `alpha.10` vs. revert the pin) rather than a contributor patch — not touched here for that reason, not because it was missed.

## Darwin Results

Skipped — scope mismatch. This is a documentation-accuracy/dead-code-removal fix with no continuous/categorical parameter; `darwin --execute`'s real interface evolves routing/topology/prompt/memory/tool/tier/context/coordination genome parameters against an LLM-scored bench corpus. Same skip class as 7 of the last 8 dream-cycle nights.

## SOTA Proof & Witness

| Field | Value |
|---|---|
| Session commit | `d33ef4bf8ab27a8f9ef08352c9c293b53312a861` |
| Gist SHA-256 (pre-witness content, i.e. this file before this table was filled in, post-review revision) | `2a02686c4b05dc12e8c8b6e2a539f8605dde527ab04a4a72a09602f56e3ac1ab` |
| Witness stamp | `6f56440a68f4ad0cd43acf45d8b486b263c6106898438a373a39f8914628b672` |

Verifier procedure: fetch `docs/dream-cycle/dream-gist-2026-08-30.md` from the `dream/2026-08-30-performance` branch, strip this table back to the placeholder line, SHA-256 the result, concatenate with the session commit above, SHA-256 again — result must equal the witness stamp. (Superseded the pre-review witness `3c98578c...`; this is the current one after addressing the reviewer's REJECT.)

Verifier procedure: fetch `docs/dream-cycle/dream-gist-2026-08-30.md` from the `dream/2026-08-30-performance` branch, strip this table back to the placeholder line ("See issue and PR for the full witness table..."), SHA-256 the result, concatenate with the session commit above, SHA-256 again — result must equal the witness stamp.

## Recommended Next Steps

1. **Merge this candidate** (human review required) — removes 375 lines of unreachable, misleading code, closes a real gap between this repo's own docs and what it tells every new user, and now points at a live command instead of a re-driftable number.
2. **Dedicated benchmark re-verification night**: this session's own reproducible run found `~1.9x-4.7x/recall~0.99` does not hold uniformly (0.9233 recall@10 at N=20000) — the audit doc (`docs/reviews/intelligence-system-audit-2026-05-29.md`) and root `CLAUDE.md`/`v3/CLAUDE.md` need a fresh, single, unambiguous re-run and correction, not another copied citation.
3. **The same "150x-12,500x" string is still live in ~14 other CLI source locations** (`src/index.ts` `--help` output, `mcp-tools/{memory,hooks}-tools.ts`, `init/executor.ts`'s generated CAPABILITIES.md, `commands/{ruvector,embeddings,hooks,memory,agent,performance}.ts`) and a structurally identical "2.49x-7.47x" Flash Attention figure appears in ~9 more locations, plus ~15 `.claude/skills`/`.claude/agents` SKILL.md files. **Highest-priority single instance**: `commands/memory.ts:1153`'s `output.printInfo('V3 Performance: 150x-12,500x faster search...')` is live runtime CLI output, more user-visible than what this candidate fixed. Worth a dedicated, ideally scripted, sweep night.
4. **Root-npm `@claude-flow/mcp@3.0.0-alpha.10` pin** (issue #3095) needs a maintainer decision (publish `.10` or revert to `.9`) — blocks root-npm CI jobs repo-wide, not just this PR, and only touched here via the safe, already-open, pnpm-side fix (#3104).
5. Re-open the `@claude-flow/memory` `efSearch`/`efConstruction` decoupling question **only** with a scale-adaptive default (per CHAT, arXiv:2607.04630) — not a flat low default, which is exactly what 2026-08-15's PR #3034 tested and got rejected for.
6. `Quantizer.productQuantizeDistance()` is still unwired into `HNSWIndex.distance()` five research-nights after 2026-08-25 first reported it — cheap, high-confidence, still open.
7. Consider a graded/surrogate reward signal for `model-router.ts`'s bandit using its own `predictedQuality` output (arXiv:2607.09015) — medium risk given ADR-148/149/150 already build on the current reward shape; recommend offline replay against `.swarm/model-router-state.json` before any live change.
