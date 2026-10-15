# Intelligence SOTA Report — 2026-09-22

TL;DR: Tonight's `intelligence` deep-dive fixes an inverted exponential-moving-average (EMA) direction in `EWCConsolidator.updateFisherFromConfidences()` (`v3/@claude-flow/cli/src/memory/ewc-consolidation.ts`), the Fisher-matrix update wired into production at `intelligence.ts:413` after every SONA `distillLearning()` pass. The buggy formula gave the new batch 99% weight and the accumulated Fisher signal only 1% (`alpha*old + (1-alpha)*new`, alpha=`fisherDecayRate`=0.01) — inverted vs. the two sibling `globalFisher`-updating sites in the same class (`computeFisherMatrix()`, `recordGradient()`), which correctly do `(1-decay)*old + decay*new`. This defeated EWC++'s single stated purpose ("prevents catastrophic forgetting... during continual learning") on this path: importance from many prior distill passes was wiped by the very next low-signal one. Flagged as tonight's lead candidate by yesterday's security-night scan (issue #3384), independently re-verified here by reading the code directly, and confirmed against the actual EWC++ literature by tonight's research.

## What's New in 2026

| Finding | Source | Confidence |
|---|---|---|
| EWC++'s standard online-Fisher update is a slow-moving EMA — small weight (~0.01) on the new batch, large weight on accumulated old Fisher — not a per-task snapshot | Chaudhry et al., "Riemannian Walk for Incremental Learning" (coined EWC++), ECCV 2018, arXiv:1801.10112 | A |
| `F^t = α·F_current + (1-α)·F^(t-1)` is still the reference baseline in 2025 continual-learning work; small α belongs on the *current* term | "On the Computation of the Fisher Information in Continual Learning", arXiv:2502.11756 (2025) | A |
| Online-EWC/EWC++ remains the benchmark being critiqued (for importance-estimation quality, not EMA direction) in the newest work | "Elastic Weight Consolidation Done Right for Continual Learning", CVPR 2026 | A |
| No mainstream agent-memory framework implements an EWC++-style parameter-layer importance EMA; the field solves "protect important memories" at the record layer instead (LLM-assigned tags, recency re-ranking, temporal validity windows) | see Competitor Comparison | A/B |
| Mem0's own maintainers are actively debating (unresolved) the exact problem EWC++ addresses — importance frozen at write time vs. needing dynamic, usage-weighted importance | github.com/mem0ai/mem0 issue #5330 | B |

No 2026-dated source documents this specific EMA-inversion pattern — a project-local defect, not a literature failure mode. The case rests on the cited papers plus internal self-consistency: the same `fisherDecayRate` field has opposite effective semantics at this one call site vs. the other two in the identical class.

## Ruflo Current Capability

EWC++ lives in `v3/@claude-flow/cli/src/memory/ewc-consolidation.ts` (`EWCConsolidator`), wired into the intelligence pipeline's CONSOLIDATE stage via `intelligence.ts`'s `distillLearning()`. The 2026-08-27 dream cycle (#3110, unmerged) fixed a related-but-distinct bug: `distillLearning()` was calling `getPenalty([oldConf],[newConf])` (collapses to reading `globalFisher[0]` alone) instead of `computeConfidencePenalty()` (correctly averages the full 384-dim diagonal) — that fix is *why* `updateFisherFromConfidences()` has a live production caller at all. Tonight's bug is one level deeper: even with the correct read path wired in, the write path building `globalFisher` was discarding ~99% of what it had already learned on every call. Three `globalFisher`-mutating methods exist; two (`computeFisherMatrix`, `recordGradient`) use the correct EMA direction, the third (`updateFisherFromConfidences`, the only one reachable from production) used the inverted one. No existing test exercised it twice from non-zero state.

## Competitor Comparison

| Framework | Importance/forgetting mechanism | Layer | Source | Grade |
|---|---|---|---|---|
| CrewAI | "Cognitive Memory" (2026): LLM-assigned importance at write time; blended similarity/recency/importance retrieval; decay+pruning | Memory record | crewai.com blog, Mar 2026 | B |
| Mem0 | "Memory Decay" (May 2026): search-time re-rank only (1.5x/0.3x boost/damp); importance otherwise frozen at write time (open issue) | Memory record | mem0.ai blog + GitHub #5330 | B |
| Zep / Graphiti | Bi-temporal knowledge graph, 5 forgetting mechanisms (decay, TTL, LRU, semantic importance, temporal invalidation) on graph edges | KG edge | arXiv:2501.13956 | B |
| Letta (MemGPT) | Agent-driven, non-systematic: agent judges importance and self-edits; eviction is plain FIFO, no decay function | Agent-judged | Letta vs. Hindsight comparison, 2026 | B |
| LangGraph (core) | None native; community `langgraph-memory` add-on does LLM-assigned importance + composite ranking | Memory record | GitHub, Mar 2026 | C |
| AutoGen / MS Agent Framework | None shipped; biologically-inspired forgetting is external research, not integrated | — | github.com/microsoft/autogen #7794 | B |
| OpenAI Agents SDK | None — no persistent memory by default; forgetting is total at session end, delegated to third parties | — | OpenAI Agents SDK docs | A |

No competitor implements anything structurally like EWC++'s online-Fisher-EMA at the parameter/weight layer — the field solves a retrieval/pruning problem (which record to keep) rather than a continual-learning problem (how much a learned signal should move). Genuine open gap, not solved-elsewhere: unresolved even inside a well-resourced competitor (Mem0 #5330). Ruflo's approach is more rigorous for its stated goal, but the rigor was undone by an operand-order bug in the one wired-to-production write path.

## Hypothesis

Given `EWCConsolidator.updateFisherFromConfidences()` using an inverted EMA (`alpha*old + (1-alpha)*new`, alpha=`fisherDecayRate`=0.01, new dominates), when corrected to `(1-decay)*old + decay*new` matching the two sibling sites and the standard online-EWC/EWC++ convention, then accumulated Fisher values should persist across subsequent low-signal calls (retain ≥90% after 5 near-zero-signal calls, vs. ~0.01^5≈0 under the bug) rather than being ~99% overwritten each time, subject to: (1) `computeConfidencePenalty()`'s scalar-average semantics unchanged; (2) the two correct sites untouched; (3) `fisherDecayRate`'s default (0.01) and meaning preserved, no new config knob; (4) all existing EWC/intelligence tests green; (5) deterministic, $0 evaluation. Frozen before evaluation; not modified after.

## Benchmarks

No existing corpus targets this call path. A new deterministic test (`__tests__/ewc-fisher-ema-direction.test.ts`) was added: (a) establishes a high Fisher signal from one batch, applies 5 near-zero-signal batches, asserts ≥90% retention (correct EMA retains ~95.1% at decay=0.01; the bug retained ~1.7e-9); (b) cross-checks `updateFisherFromConfidences()` vs. `recordGradient()` for numerically identical output on equivalent inputs at decay=0.25, chosen to diverge sharply if mismatched.

## Evaluation

**evaluated: accepted.** Real evaluator: Vitest 4.1.8, deterministic, $0, zero LLM calls. Baseline-fails/candidate-passes isolated via `git stash` (both new tests fail against baseline with a >1e9x retention discrepancy and a 3x EMA mismatch; pass against candidate). Full `@claude-flow/cli` suite both ways: failed-file set byte-identical (96 pre-existing files, same unbuilt-dist class documented every prior night) — zero new failures, 155/155 in EWC-adjacent tests (153 pre-existing + 2 new). `tsc --noEmit`: 463 pre-existing errors, identical both ways, none in changed files.

## Darwin Results

Skipped: binary EMA-direction correctness fix, not a continuous parameter with a fitness gradient — same skip class as #3110/#3160/#3184/#3221/#3243/#3266/#3302/#3330/#3378/#3385. Future night: `fisherDecayRate` (default 0.01) is now a legitimate Darwin-explorable parameter — deliberately out of scope tonight to avoid widening the hypothesis after evaluation began.

## SOTA Proof & Witness

**Reward hack check** (manual checklist — no standalone reward-hack CLI reachable in this environment): test weakening — none, diff purely corrective/additive; gold-data tampering — N/A; cherry-picking — none; evaluator exploitation — none; cost hiding — none, $0 deterministic. Independently re-verified by the adversarial critic, who ran every item itself.

**Adversarial critique**: independent critic (no access to this session's reasoning) re-derived the bug's correctness from the two sibling `globalFisher` sites itself, independently reproduced the stash-isolated fail/pass proof from a fresh `git stash`/`vitest run`/`git stash pop` cycle, reran the regression set (155/155), and checked the EMA math by hand. **Verdict: CONFIRMED**, no blocking issues. Two non-blocking notes: no NaN/Infinity guard added (matches pre-existing sibling style, not a new gap); pre-fix persisted `.swarm/ewc-fisher.json` state (none exists here) would carry over safely — `resetFisher()`/`clear()` exist as an escape hatch if ever needed.

**Security review**: no security-sensitive surface — pure internal arithmetic on an ML importance signal, no user input, no auth/filesystem/network scope change beyond the pre-existing `saveToDisk()` path (unchanged).

**Promotion gate** (advisory only — this session does not self-promote): evaluation_complete ✓, effect_positive ✓, significance_sufficient ✓ (>1e9x retention discrepancy), no_material_regression ✓ (byte-identical 96-file failure set, 463 tsc errors both ways), tests_green ✓ (158/158 after hardening), reward_hack_clear ✓, critic_clear ✓, witness_valid ✓ (below), receipt_reproducible ✓. **VERDICT: ACCEPT** — recommended for human review, not self-promoted.

**Post-review hardening** (ruvnet's evidence-gate REJECT on PR #3395, at head `1cc7231`): the EMA-direction fix itself was confirmed correct (retention 1.01e-8% → 95.099% after 5 low-signal updates), but `updateFisherFromConfidences()` had no defenses against malformed runtime input or a corrupted persisted state file. Fixed same-session: non-finite embedding/confidence values now drop that sample instead of poisoning the shared accumulator; a batch where no sample contributes leaves `globalFisher` and disk state untouched (previously it still decayed and persisted a no-op); `loadFromDisk()` now validates the loaded Fisher array (exact dimensions, finite, non-negative) and quarantines (resets to zero) the whole array if invalid rather than silently resuming with corrupted entries. 3 new regression tests, each independently confirmed to fail against the pre-hardening code via `git stash` isolation. 158/158 EWC-adjacent tests, full-suite failed-file set still byte-identical (96 files), `tsc --noEmit` still byte-identical (463 errors). The witness below is rebound to this hardened candidate commit rather than the pre-session base commit, per the same review's finding that the original receipt didn't bind the candidate.

| Field | Value |
|---|---|
| Candidate commit | `290959f99a3a019f25dd046a47512a2c35c7ea41` |
| Gist SHA-256 (pre-witness content) | `b6b2cae23b1377263fe53c08d98f68a02de0b09a83c502bf467cc5fe9c9ac5f0` |
| Witness stamp | `fc2088df4df6d1ba3a82a499d4f5ed77199af85241091262bcd9612695ebd507` |

Verifier: fetch this gist from the branch, strip the witness table's filled values back to `PENDING`, SHA-256 it, concatenate with the candidate commit, SHA-256 again — must equal the stamp.

## Recommended Next Steps

1. **This fix**: human review and merge of the linked draft PR — small (~10 net lines, 1 source file + 1 new test file), one conceptual change, zero regressions.
2. **`fisherDecayRate` tuning** (future `intelligence` night): direction is now correct, so Darwin has a real continuous parameter to explore — is 0.01 optimal, or does another value trade off responsiveness vs. forgetting-resistance better?
3. **`mmrRerank()` redundant cosine recomputation** (`v3/@claude-flow/memory/src/smart-retrieval.ts:286-339`, newly found tonight, distinct from the already-fixed #3266 tokenization bug): recomputes similarity against all selected items every outer-loop pass, no running-max cache — good `memory`/`performance`-night candidate.
4. **HNSW binary/scalar quantization dispatch** (`v3/@claude-flow/memory/src/hnsw-index.ts:1018-1153`, re-confirmed unfixed, same bug class as the fixed product-quantization case #3093/#3094): `distance()` still falls through to generic cosine/euclidean on packed vectors, zero recall coverage. Note: a real wasm-backed RaBitQ implementation now exists (`v3/@claude-flow/cli/src/memory/rabitq-index.ts`), just not wired into this function — the CLAUDE.md claim is stale, not fictional.
5. **Plugin install permission/trust-level enforcement** (`v3/@claude-flow/cli/src/commands/plugins.ts:224-320` → `plugins/manager.ts:149-221`, re-confirmed unfixed): `installFromNpm()` never checks declared `permissions`/`trustLevel` against `PluginStoreConfig`; `--verify` is parsed, unused, and has no checksum/signature to check against even if wired up. Good `capabilities`/security-night candidate.
