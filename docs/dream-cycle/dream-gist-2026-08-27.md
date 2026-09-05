# Intelligence SOTA Report — 2026-08-27

TL;DR: SONA's production DISTILL step (`LocalSonaCoordinator.distillLearning()`, `v3/@claude-flow/cli/src/memory/intelligence.ts`) has been calling `EWCConsolidator.getPenalty([oldConf],[newConf])` with 1-element arrays since this code existed — a call shape that `getPenalty`'s own length guard (`Math.min(len_a, len_b, len_fisher)`) silently collapses to reading only `globalFisher[0]`, one arbitrary dimension out of 384, regardless of a pattern's actual embedding. Two purpose-built replacement methods (`computeConfidencePenalty`, `updateFisherFromConfidences`) already existed in the same file — docstrings say "used by SONA after distillLearning" — but were dead code, called from nowhere. Fixed tonight: ~14 changed lines, wiring the existing correct methods in. Not a Fisher-matrix-quality improvement (the heuristic-proxy nature of `F_i` is unchanged and already honestly documented in-repo); this fixes a wiring defect that made even that existing heuristic non-functional in its one production use. **Post-review correction:** the fix does not make the penalty per-pattern (`computeConfidencePenalty` takes no embedding) — it corrects which *shared* Fisher signal informs the penalty (full 384-dim average vs. one arbitrary dimension). See Hypothesis section.

## What's New in 2026

| Finding | Source | Confidence |
|---|---|---|
| LoRAC-IPC: QR-orthogonal LoRA composition for continual learning, ViT-only | arXiv:2504.13407 / Pattern Recognition | B |
| CPE ("Do Self-Evolving Agents Forget?"): capability erosion across workflow/skill/model/memory-evolution channels in self-evolving LLM agents | arXiv:2605.09315 (May 2026) | C |
| ReCoLoRA: SVD-based consolidation directly on LoRA weight matrices | arXiv:2607.07719 (Jul 2026) | C |
| FOREVER: "model-time" (optimizer-update-magnitude) replay/consolidation scheduling vs. fixed-cadence triggers | arXiv:2601.03938 (Jan 2026) | C |
| ReasoningBank (Google Research): distills generalizable reasoning strategies from success *and* failure into reusable memory — closest external analog to Ruflo's own ReasoningBank | arXiv:2509.25140 (ICLR 2026) | A |
| DSPy/GEPA: Pareto-frontier prompt evolution as a soft forgetting-mitigation (multi-candidate retention vs. single-point overwrite) | GEPA paper (ICLR 2026), dspy.ai docs | A |

None of these were adopted tonight (see Recommended Next Steps) — the selected candidate is a code-verified wiring bug, not an adoption of external SOTA.

## Ruflo Current Capability

Three separate EWC-labeled implementations exist in the repo; only one is production-live:

- **`EWCConsolidator`** (`v3/@claude-flow/cli/src/memory/ewc-consolidation.ts`) — production, used by `intelligence.ts`'s `distillLearning()` and by `hooks-tools.ts`'s trajectory-end consolidation (a separate, correctly-shaped `recordGradient()` call using a real 384-dim embedding gradient — unaffected by tonight's fix, confirmed by direct read).
- **`SONAManager` EWC state** (`v3/@claude-flow/neural/src/sona-manager.ts`) — dead. `consolidateEWC()` only decays existing Fisher/means Maps, never populates them (nothing ever calls `.fisher.set(...)`), and `consolidateEWC()` itself is called from nowhere outside its own file/tests. `computeEWCPenalty()` in `modes/{balanced,batch,research}.ts` therefore always returns 0. Unreachable from production; not touched tonight (fixing it would have zero production effect).
- **`sona-bridge.ts` EWC** (`v3/plugins/test-intelligence/src/bridges/sona-bridge.ts`) — plugin-only, reachable only via `plugin-cognitive-kernel`, does compute a live (if still heuristic) Fisher signal within its own scope.

`F_i` in the production path is honestly documented in-repo (`ewc-consolidation.ts` L21-29) as a heuristic importance proxy (accumulated squared embedding magnitude), not a true Fisher Information Matrix — this was already known and correctly disclosed before tonight; not a new finding.

Also found and not pursued (real LoRA A/B adapter matrices, `v3/@claude-flow/cli/src/ruvector/lora-adapter.ts`, have zero EWC/forgetting-protection coupling — `grep` for `ewc|EWC|consolidat|forget` in that file returns nothing). ReCoLoRA (above) would be a plausible direction for a future night that wants to close that gap specifically, but requires real weight/gradient trajectories the pattern-memory system doesn't currently produce.

## Competitor Comparison

| System | Mechanism | Grade |
|---|---|---|
| LangGraph / LangChain | Cross-thread fact Store (write/read facts); no forgetting-mitigation, no adaptive routing | A |
| AutoGen / AG2 | `TeachableAgent` / `MemoryStream` vector recall; no forgetting-mitigation, no adaptive routing | A |
| CrewAI | "Cognitive Memory" — 5 ops incl. contradiction-resolved forgetting; curation, not parameter/policy-level learning | A (mechanism) |
| OpenAI Agents SDK | None built-in; durable memory explicitly deferred to third parties (Mem0 etc.) | A |
| Letta (MemGPT) | Tiered Core/Recall/Archival memory shipped; "continual learning in token space" is an explicitly-labeled 2026 research vision, not production | A (tiered memory) / C (vision) |
| DSPy/GEPA | Pareto-frontier prompt evolution — soft forgetting-mitigation via multi-candidate retention | A |
| Standalone bandit LLM routers (OrcaRouter, LLM Bandit, etc.) | Real online contextual-bandit routing policies exist as research infra, never integrated into an agent-orchestration framework | B |

Why the "None" rows are like that (not just filled in): LangGraph and the OpenAI Agents SDK deliberately position themselves as thin, memory/model-agnostic orchestration layers per their own docs — continual adaptation is explicitly punted to pluggable external stores, a scope decision rather than an unsolved problem. AutoGen/AG2's 2026 changelog is still focused on session/API stabilization post-fork, not learning mechanisms. Adaptive bandit-style model routing is real and active in the research literature but has not been absorbed into any named agent-orchestration framework's core loop — plausibly because framework maintainers are wary of owning unpredictable online-routing regressions by default. Synthesis: Ruflo's SONA+EWC++/ReasoningBank stack is differently-shaped rather than simply "ahead" of the field — it is the only system found bundling a weight/gate-level continual-learning mechanism together with trajectory-distilled reasoning memory inside an agent-orchestration framework, but its own quantitative claims (0.0043ms/adapt, MoE 0.13→0.88) remain internally measured with no external baseline comparison found.

## Hypothesis

> Given SONA's `distillLearning()` DISTILL step, when the confidence-forgetting gate is switched from `EWCConsolidator.getPenalty(oldWeights=[oldConf], newWeights=[newConf])` (silently reads only `globalFisher[0]`, 1 of 384 dimensions) to the pre-existing `computeConfidencePenalty()` (averages the full 384-dim Fisher diagonal) paired with `updateFisherFromConfidences()` (replacing an ad-hoc per-pattern `recordGradient` loop with the batch method built for this exact call site), then EWC's forgetting-penalty should become a function of the full accumulated Fisher signal rather than one arbitrary dimension, subject to: (1) existing tests remain green; (2) `distillLearning()`'s public return shape and callers stay compatible; (3) $0 evaluation cost; (4) the fix changes only which shared Fisher signal informs the forgetting-penalty gate, not which patterns get distilled.

Frozen before evaluation began; not modified after seeing results.

**Correction, post-review (ruvnet, 2026-08-27):** the hypothesis as originally frozen overclaimed that this fix makes the penalty "a function of each pattern's own embedding-derived importance." **REJECT for that claim, as written** — `computeConfidencePenalty(oldConfidence, newConfidence)` takes no per-pattern embedding; it only reads `avg(globalFisher)`, a value shared across every pattern at a given point in time. Under one fixed consolidator state, two different patterns with the same confidence delta get an *identical* penalty, both before and after this fix — the original tests demonstrated sensitivity to *changing the global Fisher state* between two test cases, not to *per-pattern* discrimination within one state, and that distinction was not caught before evaluation. The hypothesis above has been rewritten to the narrower, true claim: this fix corrects *which shared signal* (`avg(globalFisher)` vs. `globalFisher[0]`) informs the confidence-update gate, and does not add per-pattern discrimination. A new acceptance test (`ewc-distill-confidence-gate.test.ts`, "acceptance test (ruvnet review)") makes this explicit and permanent — it asserts two differently-described patterns get the *same* penalty under one fixed state, and will need deliberate updating if a future change adds real per-pattern weighting.

## Benchmarks

No LLM-scored bench corpus applies (deterministic algorithmic wiring bug, zero model calls). Evaluation is a real, deterministic Vitest suite:
- 4 new unit tests directly against `EWCConsolidator.computeConfidencePenalty`/`updateFisherFromConfidences` (previously completely untested — 0 prior coverage) in `__tests__/memory-ruvector-deep.test.ts`, including a test that reproduces the exact defect shape (`getPenalty([old],[new])` returns 0 under a Fisher diagonal that is 0 at index 0 but large everywhere else, while `computeConfidencePenalty` correctly returns a nonzero, importance-reflecting penalty from the same underlying Fisher state).
- 1 new integration/regression-guard test (`__tests__/ewc-distill-confidence-gate.test.ts`) driving the real, exported `distillLearning()`/`recordTrajectory()` production API (temp-cwd-isolated, no repo-tree side effects) with `vi.spyOn` on all four `EWCConsolidator` methods, asserting the fixed methods are called and the old defect-shaped ones are not.
- 1 new acceptance test (same file, added post-review) directly encoding ruvnet's required proof: under one fixed consolidator state, two differently-described patterns with the same confidence delta get the *same* penalty — proving no per-pattern discrimination exists, while separately confirming the shared penalty differs from the old `getPenalty([x],[y])` call shape on that same state.

## Evaluation

**evaluated: accepted, scoped (post-review correction).** ruvnet's PR review (2026-08-27) rejected the hypothesis as originally written — see the Hypothesis section's correction note above — and required a fixed-state, differing-embedding acceptance test before accepting any per-pattern claim. That test now exists and proves the narrower claim: no per-pattern discrimination, only a corrected shared Fisher signal. The underlying wiring defect (production code calling a 1-element-truncating method instead of the purpose-built scalar-confidence one) is still real, still fixed, and still evidenced below; only the characterization of what the fix achieves was corrected.

An independent adversarial critic (fresh session, no authoring context) reviewed the diff and returned **CONFIRMED-SAFE-WITH-CAVEATS**, both disclosed here rather than fixed silently:

1. `updateFisherFromConfidences()` calls `saveToDisk()` internally, so this fix adds a new synchronous disk-write of the EWC Fisher state (`.swarm/ewc-fisher.json` by default) into the `recordTrajectory()`/`distillLearning()` hot path — the old `recordGradient()`-based call site never persisted from here (only the separate `consolidate()` path did). Gitignored, error-swallowed (`saveToDisk`'s catch is empty), and the critic did not reproduce any stray-file pollution across the touched test files — but it's a real, previously-absent I/O cost the diff's comments didn't call out as a side effect in its own right.
2. This is a genuine behavioral change to EWC damping frequency/magnitude, **not purely a bug fix restoring one obviously-intended behavior**: old penalty = `(lambda/2) * globalFisher[0] * diff²` (one arbitrary, noise-accumulated dimension, identical across all patterns in a call); new penalty = `(lambda/2) * avg(globalFisher) * diff²`, fed by a different Fisher-update formula (`updateFisherFromConfidences`'s confidence-delta-scaled embedding vs. `recordGradient`'s raw embedding). The new tests validate correct monotonicity/sign properties of `computeConfidencePenalty` in isolation, but **the direction of the resulting change in real damping frequency (more vs. less confidence-update throttling on typical all-MiniLM-L6-v2-scale embeddings) is not empirically measured** — this ships as "wire up the code that was clearly designed for this," not as a characterized tuning improvement.

Baseline vs. candidate isolated via `git stash` of only `intelligence.ts`: the new regression-guard test fails against baseline (`computeConfidencePenalty`/`updateFisherFromConfidences` never called — confirmed) and passes against the candidate. Combined `memory-ruvector-deep.test.ts` + `ewc-distill-confidence-gate.test.ts`: 153/153 passing (148 pre-existing + 5 new: 4 direct `EWCConsolidator` unit tests, 1 regression-guard integration test, plus the post-review acceptance test added to the same file). `tsc --noEmit`: zero errors referencing either changed file. Two pre-existing, environment-caused failures (`@claude-flow/neural` package-entry resolution in `hooks-intelligence-learning.test.ts`; unbuilt `dist/` in `hooks-intelligence-train-2940.test.ts`) confirmed identical with and without the candidate via the same stash-isolation method — not caused by tonight's change.

## Darwin Results

Skipped — scope mismatch. This is a wiring/correctness bug fix (calling the right existing method with the right shape), not a tunable numeric/categorical parameter with a genome-shaped search space. Confirmed via `npx ruvector harness darwin --help`: real interface takes a JSON genome config with `--execute`; no analog for "call method A instead of method B." Same skip class as most recent nights' non-parameter wiring fixes.

## SOTA Proof & Witness

| Field | Value |
|---|---|
| Session commit | `e21aa352fdc80fd2d3cc4e83404a76a18d118b96` |
| Gist SHA-256 (pre-witness content) | `282261b39cd2cc24117aea321e74549b664c3d5886fd697f5f0fc7a70f1a1036` |
| Witness stamp | `0df6bc4fafa778b396fea2db36fee356047c2026448a637b12160b9e400e17c9` |

Verifier procedure: fetch this file from the `dream/2026-08-27-intelligence` branch, strip this table's `Gist SHA-256`/`Witness stamp` values back to `PENDING`, SHA-256 the result, concatenate with the session commit above, SHA-256 again — result must equal the witness stamp.

## Recommended Next Steps

1. **Merge the linked draft PR** (human review required) — a small (~14 net changed lines in production code, +161 lines of new tests), fully reversible fix that wires already-implemented, already-documented-for-this-purpose methods into the one place they were designed for.
2. **Follow-up**: investigate whether `EWCConsolidator.consolidate()` (the full Fisher-weighted pattern-blending method, currently only exercised by tests) has any real production target — pattern embeddings appear to be static post-creation in the current design, so this may be dead-by-design rather than a gap; needs more investigation before treating it as a candidate.
3. **Follow-up**: `SONAManager`'s EWC state in `@claude-flow/neural` (`sona-manager.ts`) is fully inert (dead Fisher/means maps, `consolidateEWC()` uncalled) — worth a decision on whether that package's SONA path is meant to eventually replace `intelligence.ts`'s (in which case it needs the same kind of wiring fix) or should be removed/documented as unused.
