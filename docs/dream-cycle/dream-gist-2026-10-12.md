# Intelligence SOTA Report — 2026-10-12

TL;DR: Tonight's `intelligence` deep-dive started from a handed-in candidate —
fix `SONAManager`'s dead EWC key-mismatch (the subject of still-open PRs
#3622 and #3879) — and **rejected it** after an independent architecture
review proved it would be behaviorally inert even if fixed (the LoRA
weights EWC would protect are never updated by gradient descent anywhere in
the codebase). Research pivoted to a more foundational finding from the same
investigation: `LearningBridge`, the only production path that exercises
`@claude-flow/neural`'s `SONAManager` (wired to Claude Code's
SessionStart/SessionEnd hooks via `auto-memory-hook.mjs`), constructs a
**fresh, empty neural learning state on every single short-lived hook
invocation** — `SONAManager.serialize()`/`deserialize()` already exist
(built for exactly this) but nothing ever called them. Tonight wires that
round-trip in, evaluated with 10 new discriminating tests plus a real,
unmocked `SONAManager` smoke test. 2026 external research confirms no
mainstream agent framework attempts anything EWC-analogous (pure-retrieval
memory has nothing for Fisher regularization to protect) but a Sept-2026
arXiv paper shows EWC/LwF genuinely working for LLM-agent skill-retriever
forgetting — informing, not blocking, tonight's scope.

## What's New in 2026

| Finding | Source | Confidence |
|---|---|---|
| EWC-LoRA: EWC over low-rank adapters, reconstructing full-dim Fisher from a low-rank representation | arXiv:2602.17559 (Feb 2026, **ICLR 2026**, public code) | A |
| EWC/LwF/embedding-anchor/L2-init all independently shown to preserve OOD retrieval while improving in-distribution retrieval 13.98% for a 34k-skill LLM-agent retriever | arXiv:2609.10750 (Sept 2026) | A (single preprint, not yet independently reproduced) |
| FOREVER: replay-cadence scheduling by optimizer-update magnitude, not fixed step intervals | arXiv:2601.03938, **ACL 2026 long paper** | A |
| ReasoningBank: agent memory via distillation/retrieval over trajectories, explicitly *not* parameter-level | arXiv:2509.25140 (Google Research, v2 Mar 2026) | A |
| No mainstream agent framework (LangGraph/AutoGen/CrewAI/OpenAI Agents SDK) implements any EWC-analogous mechanism — all use pure retrieval/curation, which has no object for a Fisher-information penalty to protect | Official docs, direct fetch | A (LangGraph, CrewAI docs); B/C (AutoGen, OpenAI — no first-party memory docs found at all) |

## Ruflo Current Capability

`@claude-flow/neural`'s `package.json` advertises "EWC++ for continual
learning." In reality there are **4-5 independently reimplemented
EWC-shaped structures** in this repo (`EWCConsolidator` in
`ewc-consolidation.ts` — actively maintained, real fixes in the last 3
weeks; `SONAManager`'s own dead `ewcState`; `TestSonaBridge`; `LearningLoop`;
a decoupled `EwcRecord` struct), no shared abstraction. `SONAManager`'s copy
is reachable from production (`auto-memory-hook.mjs` → `AutoMemoryBridge` →
`LearningBridge` → `NeuralLearningSystem.completeTask()` →
`SONAManager.completeTrajectory()` → `checkLearningTrigger()` →
`triggerLearning()` → the 3 modes' dead EWC code) but gated behind an
80%-of-`trajectoryCapacity` threshold (2400 for default `balanced` mode)
that could never practically be crossed anyway — **no process-to-process
persistence existed for any of SONA's learning state**, EWC or otherwise.

## Competitor Comparison

| # | Framework/Product | EWC-analog? | Why |
|---|---|---|---|
| 1 | LangGraph | None | Pure KV/vector `Store`, no trainable weights to protect (A) |
| 2 | AutoGen | None | Stateless by default; third-party memory (Mem0/Zep) bolted on, still no parameter-level mechanism (B) |
| 3 | CrewAI | None — opposite instinct | LLM-judged keep/update/delete/insert_new on records; actively *deletes* superseded memory rather than protecting it (A, official docs) |
| 4 | OpenAI Agents SDK | None | No first-party long-term memory at all; defers to Mem0/Hindsight/Cognee (A for the absence, by direct doc search) |
| 5 | Qdrant/Weaviate/Milvus/LanceDB/Vespa | None (one adjacent feature) | Qdrant ≥1.18 supports zero-downtime embedding-model migration (named-vector coexistence) — schema tooling, not forgetting-mitigation (B) |
| 6 | arXiv:2609.10750 (LLM-agent skill retriever) | **Yes** | EWC/LwF/embedding-anchor/L2-init tested and shown to work for exactly this agent-adjacent setting (A) |

Synthesis: every agent-framework "None" is architectural — RAG-based
memory has no shared weight space for EWC to protect. The real EWC-adjacent
work lives one layer down, in fine-tuned retrievers/LoRA adapters (also:
CURLoRA, SLoRA, ReCoLoRA — grade B/C). No competitive cover for Ruflo's
half-wired SONA-level EWC, but no pressure to fix it tonight either — it
only matters once SONA's weights actually update via gradient descent,
which they don't (see H1, rejected, below).

## Hypothesis

> Given `LearningBridge`'s production usage (repeated short-lived
> `auto-memory-hook.mjs` processes recording insights via SessionStart/
> SessionEnd hooks), when `SONAManager`'s existing `serialize()`/
> `deserialize()` round-trip is wired into `LearningBridge.loadNeural()`
> (restore from `.swarm/sona-learning-state.json` if present) and
> `LearningBridge.destroy()` (persist synchronously before the unawaited,
> short-lived process exits), then completed-trajectory counts and other
> learning-state counters should accumulate monotonically ACROSS separate
> process invocations instead of resetting to zero every time, subject to:
> zero behavior change when no real `@claude-flow/neural` resolves or a
> mock `neuralLoader` lacks `serialize`/`deserialize`; corrupt/missing/
> schema-incompatible state degrades to a fresh start rather than throwing;
> all existing tests remain green.

Frozen before evaluation; not modified after.

## Candidates Considered (STEP 3.2, scored)

score = 0.25·fit + 0.20·testability + 0.20·measurability + 0.15·production + 0.10·novelty + 0.10·reviewability

| # | Candidate | Fit | Test | Measure | Prod | Novel | Review | Score |
|---|---|---|---|---|---|---|---|---|
| H1 | Fix SONAManager EWC key-mismatch (handed-in candidate) | 3 | 5 | 3 | 2 | 2 | 3 | **3.15** |
| H2 | Wire SONAManager serialize/deserialize into LearningBridge | 5 | 4 | 5 | 5 | 4 | 3 | **4.50** ← selected |
| H3 | Replace LearningBridge's hash pseudo-embedding with real ONNX embedding | 4 | 5 | 4 | 4 | 3 | 4 | 4.10 |
| H4 | Consolidate 4-5 duplicated EWC-shaped implementations | 3 | 2 | 2 | 2 | 3 | 2 | 2.35 |
| H5 | Wire seedable RNG into MoE/SONA weight-init (reproducibility) | 4 | 5 | 5 | 3 | 4 | 5 | 4.35 |

**H1 rejected despite handed-in status**: an independent architecture
review traced `SONAManager.loraWeights.A/B` (the actual parameters EWC
would regularize) and found exactly one `.set()` call anywhere in the
package — at init. No mode's `learn()` ever writes back into it. Fixing
EWC's key mismatch alone would make the penalty computation internally
consistent (non-zero) but have **zero effect on real agent behavior** —
reachable, but behaviorally inert. H2 scored highest on the frozen rubric
*and* is independently the most foundational finding (it's the reason EWC's
trigger threshold was practically unreachable in the first place, and it
affects every SONA learning mode, not just EWC) — no override needed.

## Benchmarks / Evaluation

Real evaluator: Vitest 4.1.8, deterministic, $0, zero LLM calls, against a
freshly `pnpm install`-ed `v3/` workspace (this sandbox had no
`node_modules` at session start for either package).

- **`learning-bridge.test.ts`**: 10 new tests, own mock extension +
  `mkdtempSync`-isolated temp dirs (67 pre-existing tests/shared mock
  untouched). Stash-isolated: exactly 3 of 10 fail against baseline
  (write-on-destroy, restore-on-load, cross-instance accumulation — the
  real discriminating assertions); the other 7 (degradation/guard tests)
  pass unchanged both ways, as they should. Candidate: 77/77 pass.
- **Full `@claude-flow/memory` suite**: 3 known-flaky/pre-existing
  full-suite failures, 0 attributable (independently re-verified): a
  `chmod`-readonly test that can't trigger since this sandbox runs as
  `root`; 2 CPU-contention-sensitive timing tests that pass in isolation on
  both baseline and candidate, flaking only under full parallel load.
- **Full `@claude-flow/neural` suite**: 139/139 unchanged.
- **Real, unmocked smoke test**: built the package (tolerating 117
  pre-existing `@types/node`-missing errors — no `pnpm install` had run
  this sandbox before tonight) and ran a standalone Node script against
  `dist/index.js` (same `modes/balanced.ts` vitest load-order workaround
  PR #3879 used). Instance A completes 1 trajectory, serializes; fresh
  instance B: 0 completed before restore, 1 after `deserialize()`; a
  JSON-round-tripped copy matches exactly. **PASS.**
- `tsc --noEmit`: same `@types/node`-missing-from-sandbox error class both
  ways (117 neural; 664→666 memory, +2 from 2 new import lines) — disclosed,
  not a regression.

## Darwin Results

Skipped — this is a binary wiring/correctness fix (call the already-built
serialize/deserialize at the right two lifecycle points), not a continuous
parameter with a fitness gradient for Darwin's real interface (`ruvector
harness darwin <config> --execute`, confirmed available) to search over.
Same skip class as nearly every accepted fix in the ledger since 2026-08-18.

## SOTA Proof & Witness

```
Session commit:   aac16fbdb3af21c0ddb989aaff4513a9ec1aaca5
Gist SHA-256 (pre-witness content): 4eb310ad52ca30b5f87846db58c18d5b3564576d06dc255d7c4df6c135e2c030
Witness stamp:    2f6fe1d0a8e5eb322c2631d36d9858726772f3cee3c8349fcb2c793eef03d12a
```

Verifier: fetch this file from this branch, strip the three values above
back to `PENDING`, SHA-256 the file, concatenate with the session commit,
SHA-256 again — must equal the witness stamp.

## Recommended Next Steps

1. **H3** (replace `LearningBridge`'s hash-based pseudo-embedding, flagged
   in its own comment as a "lightweight stand-in," with the real
   `@claude-flow/embeddings` ONNX backend) scored second (4.10) and fires
   on a more frequent path (every insight record, not gated behind a
   trajectory threshold). Needs a 768→384-dim reconciliation plan first.
2. **H4** (consolidate the 4-5 duplicated EWC-shaped implementations) is
   real design debt, correctly judged too large for one night (4
   packages/plugins) — a dedicated scoping night, not a bundled fix.
3. **H5** (wire `utils/rng.ts`'s seedable PRNG into `moe-router.ts`'s
   `xavierInit()`/`addNoise()` and `research.ts`'s k-means init — currently
   zero imports from the RNG module built for this) is trivial, zero-risk,
   and directly serves CLAUDE.md's own "measured, not inherited" discipline
   — good pick for a tight-budget night.
4. Capabilities scan (ADR-451 `capabilityProbe`): the live validation
   script only loads one plugin, so `plugin.register` can structurally
   never fire — a test-harness gap, not an engine bug. One-line fix + a
   second live run (~$0.05-0.15) closes the doc's own open disclosure.
5. Memory scan (`AutoMemoryBridge.importFromAutoMemory()`): additive-only —
   never deletes entries whose heading was removed from source, so
   retracted notes resurface forever. Qdrant's sync docs (grade A) describe
   the standard fix. Distinct from the already-fixed #3351/#3352 bug.
