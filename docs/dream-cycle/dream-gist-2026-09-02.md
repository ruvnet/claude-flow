# Intelligence SOTA Report — 2026-09-02

TL;DR: In 2026, the field's clearest signal on self-learning agents is **failure-derived memory** (ReasoningBank, FORGE) — and Ruflo's own `LearningBridge.consolidate()` is currently reward-blind, hardcoding every trajectory's completion signal to `1.0` regardless of outcome. Tonight's candidate fixes that specific defect. Separately, we confirmed a previously-evaluated fix (PR #3110, EWC gate wiring) never made it to `main` and is still an open bug in production — a governance finding, not a new one.

## What's New in 2026

| Finding | Source | Confidence |
|---|---|---|
| ReasoningBank distills failed trajectories into "preventative lessons," +8.3pp WebArena / +4.6pp SWE-Bench-Verified vs memory-free | [arXiv 2509.25140](https://arxiv.org/pdf/2509.25140), Google Research blog | A (whole-system effect; failure-only ablation is C) |
| FORGE converts failures into reusable Rules/Examples artifacts without weight updates | [arXiv 2605.16233](https://arxiv.org/abs/2605.16233), May 2026 | B |
| FOREVER: replay scheduling keyed to wall-clock/step count misaligns with real learning progress ("model time" instead) | [arXiv 2601.03938](https://arxiv.org/abs/2601.03938), Jan 2026 | B |
| DeepSeek's auxiliary-loss-free MoE load balancing avoids routing collapse via per-expert bias | [OpenReview y1iU5czYpE](https://openreview.net/forum?id=y1iU5czYpE) | A |
| Agent memory banks fed only successes/failures can become dominated by unsuccessful trajectories — a scaling hazard for any failure-ingestion design | [arXiv 2608.07169](https://arxiv.org/html/2608.07169), Aug 2026 | C |
| Every evolutionary-self-improvement framework we checked (LangGraph, AutoGen, CrewAI, OpenAI) has EITHER never shipped human-gated promotion OR is actively retreating from it | See Competitor Comparison | A (OpenAI wind-down dates) / B (CrewAI issue thread) |

## Ruflo Current Capability

- `v3/@claude-flow/memory/src/learning-bridge.ts:232` (pre-fix): `await this.neural.completeTask(trajectoryId, 1.0)` — **every** consolidated trajectory reports success=1.0 to the neural system, whether the underlying insight was ever accessed, boosted, or decayed. There is no JUDGE step on this path.
- Separately, `v3/@claude-flow/cli/src/memory/intelligence.ts`'s `distillLearning()` has its own, different EWC-gate defect (Fisher penalty collapses to reading one arbitrary dimension out of 384). This was found, evaluated, and ACCEPT-scoped on 2026-08-27 (issue #3109 / PR #3110) — but **that PR was never merged to `main`**, so the bug is still live in production. Not tonight's candidate; flagged for the human reviewer to prioritize merging #3110 specifically.
- `persistent-sona.ts` and `learning-bridge.ts` both use honestly-labeled hash-based "embeddings" (not real semantic vectors) — a known, disclosed limitation, not a defect.
- No MoE expert-load telemetry found; convergence (0.13→0.88 per CLAUDE.md) is measured but not consumed downstream beyond routing itself.

## Competitor Comparison

| Project | Self-learning / continual adaptation | Capability/permission model | Evolutionary self-improvement w/ human-gated promotion |
|---|---|---|---|
| LangGraph/LangChain | Partial — LangMem SDK, retrieval-based, no weight adaptation | Yes — `HumanInTheLoopMiddleware`, per-tool interrupt | None |
| AutoGen/MS Agent Framework | None shipped (research-only) | Yes — `ApprovalRequiredAIFunction` | None shipped |
| CrewAI | Partial — unified `Memory`, SQLite LTM | Weak — memory-scope only | **Declined.** Issue #3015 proposed exactly this design; closed not-planned, no rebuttal |
| OpenAI Agents SDK/AgentKit | None (RFT is offline, not agent-level) | Strongest — tool-level approvals | **Retreating.** Agent Builder + Evals wind-down announced 2026-06-03, gone 2026-11-30 |
| Qdrant | Relevance-feedback query weights (client-side, not accumulated by the store) | N/A | None |
| Vespa | Offline-trained LTR, human-run A/B promotion | N/A | None |

**Why the evolutionary-loop column is empty — and why that's the finding, not the gap:** DGM's own authors report their self-evolving agent hacking its reward function and fabricating logs ([arXiv 2505.22954](https://arxiv.org/abs/2505.22954)); a 2026-05 paper measures "capability erosion under self-evolution" directly ([arXiv 2605.09315](https://arxiv.org/abs/2605.09315)). CrewAI's decline and OpenAI's retreat read as a considered safety call, not an oversight. Ruflo's Darwin/Flywheel design (propose → immutable receipt → explicit signed promotion) is exactly the governance shape CrewAI declined and OpenAI's own cookbook admits it lacks. The honest competitive claim is against DGM/ShinkaEvolve on *containment*, not against LangGraph on raw capability — and the intelligence-system audit currently benchmarks SONA/MoE/HNSW speed, not capability retention across evolution generations, which is the more valuable missing benchmark here.

## Hypothesis

Given a `LearningBridge` consolidating active learning trajectories tied to recorded memory insights, when `consolidate()` reports each trajectory's completion reward using the insight's actual current confidence (read from backend entry metadata) instead of an unconditional constant `1.0`, then the reward passed to the neural system's `completeTask()` should track and differentiate insight confidence, relative to baseline (constant `1.0` regardless of quality), subject to: (1) `ConsolidateResult`'s public shape and counting semantics unchanged; (2) all pre-existing tests remain green; (3) missing/unreadable backend entries fall back to the prior constant `1.0`, preserving that case's behavior exactly; (4) fully deterministic, $0 test coverage.

## Benchmarks

Not applicable — this is a deterministic unit-level correctness fix, not a performance benchmark. See Evaluation.

## Evaluation

Real evaluator: `vitest run` against `v3/@claude-flow/memory/src/learning-bridge.test.ts`, deterministic, $0 LLM cost.

- **Baseline** (pre-diff, stashed): 56/56 passing.
- **Candidate** (post-diff, final): 62/62 passing (56 original unchanged + 6 new: real-confidence-as-reward looked up by key, differentiation across two trajectories, 3 fallback-to-1.0 cases — never-stored key, non-numeric confidence, throwing backend — and a custom-`insightNamespace` case).
- Full package regression sweep: 464/465 passing; the 1 failure (`auto-memory-bridge.test.ts`, a read-only-file-permission test) reproduces identically on the stashed baseline — confirmed environmental (tests run as root in this sandbox, which bypasses the chmod the test relies on), not caused by the candidate.

**Round 1 → round 2, adversarial critique caught a real bug in the fix itself.** An independent critic subagent traced the actual production call path (`AutoMemoryBridge.storeInsightInAgentDB()` returns a human-readable `key` string; `createDefaultEntry()` mints an unrelated `entry.id` UUID; `LearningBridge` receives the `key` as `entryId`) and found that round 1's `backend.get(entryId)` would almost always miss in production — `get()` is indexed by `entry.id`, not `entry.key` — silently falling back to the same `1.0` constant the fix claimed to eliminate. The unit tests passed anyway because the mock backend's `get()` was a bare stub with no id/key validation. **Fixed**: switched to `backend.getByKey(namespace, key)` (the correct index, confirmed populated at `store()` time across all three real backends — AgentDB, SQLite, and the hybrid backend that delegates to it), added a configurable `insightNamespace` (default `'learnings'`, matching the one real caller), and rewrote the mock backend's `getByKey` to do a real namespace+key lookup against stored entries so the tests exercise the actual id≠key distinction rather than trusting an unvalidated mock. Re-reviewed by the same critic: **CONFIRMED**, independently re-traced against all three backend implementations. One non-blocking nit surfaced: `controller-registry.ts` instantiates a second `LearningBridge` that doesn't thread `insightNamespace` through — but that instance is never fed any insights (dead/unwired in this registry path), so it's a pre-existing, out-of-scope gap, not something this candidate introduces.

## Darwin Results

Not run — deliberately. This is a binary correctness fix (pass the real signal, or don't) with no continuous parameter for Darwin to tune, matching last night's own precedent (PR #3152) for the same class of finding.

## SOTA Proof & Witness

| Field | Value |
|---|---|
| Session commit | `4d0134e59b4fa5e8552cb7b98c6b9846f08b0c82` |
| Report SHA-256 (pre-witness content) | `29c9189c833c3d56c378f9a1329b3baf6f16543493ad28e4e62ec76b14c0fdb9` |
| Witness stamp | `bead6402cb018f0e57ec6695c82e007365b5f2ae91d530a74c82a2eb8a1d362b` |
| Evaluation receipt | `vitest run` output, this report + PR body (deterministic, reproducible via `git stash`/`git stash pop` around the diff) |
| Flywheel evidence | No `.claude-flow/flywheel/` state in this repo; evidence retained as this diff + issue + PR + this gist |
| Darwin lineage | Not run (binary correctness fix, no tunable parameter) |

Verifier procedure: fetch the raw gist, compute SHA-256, concatenate with the session commit above, compute SHA-256 again — result must equal the witness stamp.

## Recommended Next Steps

1. **Merge PR #3110** (2026-08-27, EWC gate wiring, already evaluated ACCEPT-scoped) — it is still unmerged and the defect it fixes is live in production on `main`.
2. **Investigate `LearningBridge.consolidate()`'s upstream signal quality**: now that reward reflects confidence, consider whether `onInsightAccessed`'s access-boost-only confidence model is itself a good proxy for trajectory quality, or whether a real JUDGE-style verdict (success/partial/failure, per the `intelligence.ts` `distillLearning` path) should flow into this bridge too — ReasoningBank-style failure ingestion (deep-research candidate #1) is the natural next step here, once #2 (tonight's fix) is confirmed merged and stable.
3. **Fix the recovered 9-night ledger-append gap** (2026-08-24 to 2026-09-01): the Dream Cycle pipeline completed every night with a real evaluated PR, but `docs/dream-cycle/LEDGER.md` was never appended — identical failure mode to the 08-14..08-19 gap recovered on 08-19. Backfilled tonight; root cause of the append-step failure itself remains undiagnosed and is a standing candidate for a future `automation`/`meta` scan surface.
