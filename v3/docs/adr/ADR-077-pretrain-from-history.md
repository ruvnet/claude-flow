# ADR-077 — Pretrain Self-Learning From Repository History

**Status**: Accepted — Implemented in ruflo 3.10.17
**Date**: 2026-05-30
**Tracking**: continuation of [#2245](https://github.com/ruvnet/ruflo/issues/2245) self-learning hardening cluster
**Related**: ADR-074 (wiring), ADR-075 (unified stats), ADR-076 (Structured Distillation)

## Context

ADRs 074–076 fixed *honesty* (no silent stubs), *coherence* (one aggregator) and *retrieval quality* (Structured Distillation). What was still missing: a way for a fresh ruflo install to start with a **non-empty** learning state. Users on day-one of a project had zero patterns, zero trajectories, and an empty neural store — every "did learning happen?" check legitimately returned 0. The system was honest but useless until many sessions had accumulated.

The natural seed source for any repo is the repo itself: git history (commits = intent), and the issue tracker (closed = success, open = in-progress). Both are already-curated, project-specific learning signal.

## Decision

Ship `scripts/pretrain-from-github.mjs` — a deterministic one-shot harvester that pretrains the self-learning system from a repo's GitHub history. Each commit and issue becomes one trajectory, fed through the same code paths that real-time learning uses (no shortcuts):

1. **Harvest** — `git log -n N` (commits) + `gh issue list --json …` (issues). Issues are optional; `SOURCE=git` works without `gh`.
2. **Distill** — every item goes through `distillAndSerialise()` from ADR-076 so high-signal tokens (file paths, action verbs) lead the embedding.
3. **Feed** — call `recordTrajectory([step], verdict)` for each item. Commits are `success`; closed issues are `success`; open issues are `partial`.
4. **Seed** — also call `storeNeuralPatterns()` so the `neural_patterns list` surface reflects the work (closes the ADR-075 consistency note: "globalStats moved but neural store empty").
5. **Measure** — capture `getUnifiedLearningStats()` before and after; write a run JSON with the delta.

Per-trajectory latency: **~3 ms** (measured: 3.12 ms at N=15, 3.36 ms at N=80 in this repo). End-to-end for the default config (50 commits + 30 issues = 80 trajectories) is dominated by ONNX model load, not the trajectory pipeline itself.

### Reusable infrastructure shipped

- `scripts/pretrain-from-github.mjs` — the harvester (env: `COMMITS`, `ISSUES`, `SOURCE`, `BENCH_JSON`, `BENCH_NO_WRITE`).
- `scripts/benchmark-pretrained-retrieval.mjs` — 10 sample queries against the populated store; reports match rate + per-query top-3. Acts as the after-pretrain validator.
- `__tests__/pretrain-from-github.test.ts` — CI guard using an embedded 5-item fixture (no `git`/`gh` shell-outs in tests). Asserts globalStats moves, neural store grows, unified stats coherent.
- `v3/docs/learning/self-learning-usage.md` — copy-paste guide for all three learning paths plus this pretrain flow.

## Measured proof (this checkout, 2026-05-30)

`docs/benchmarks/runs/pretrain-from-github-latest.json` after the default run:

| Counter | Before | After | Δ |
|---|---:|---:|---:|
| trajectoriesRecorded | 0 | 95 | **+95** |
| patternsLearned | 0 | 85 | **+85** |
| neuralPatternCount | 15 | 95 | **+80** |
| memoryBridgeTotal | 0 | 0 | +0 (bridge not initialised in standalone script — flagged in consistency notes) |
| Trained / harvested | — | — | **80 / 80** |
| Avg latency per trajectory | — | — | **3.36 ms** |

`docs/benchmarks/runs/pretrained-retrieval-latest.json` against the populated store:

| | Value |
|---|---|
| Store size | 95 patterns |
| Queries | 10 |
| Match rate | **100% (10/10)** |
| Avg query latency | **7.67 ms** |

Every query returns a non-empty top-K. Semantic alignment is mixed (small corpus → some weak matches), but the **wiring is proven**: pretrain populates the store, retrieval reads it back, and the unified aggregator stays internally coherent (consistency notes name the exact stores that drifted and why).

### Honest limits

- **Standalone-process drift** — when the script runs outside the live MCP daemon, `sonaCoordinator` and `memory-bridge` start empty. The script's consistency block flags this explicitly: `"sona.trajectoriesTotal (0) drifts from globalStats.trajectoriesRecorded (95) by -95"`. From inside the daemon both stores are warm and the drift disappears. This is a documented operating mode, not a bug.
- **Match-rate is not relevance** — 100% match means every query found *something*, not that it found the *right* thing. The pretrain corpus is small (a few hundred commits/issues) so cosine similarity is noisy. ADR-076's MRR benchmark is the right gauge for relevance quality.
- **Commits don't have outcomes** — all commits are recorded as `success`. A finer signal (e.g. "was this commit reverted within 7 days?") would improve verdict quality; tracked for a follow-up.

## Deliberately NOT in this round

- A `ruflo pretrain` CLI subcommand wrapping this script — the script-as-tool pattern keeps the contract explicit during the initial rollout. A subcommand can land in a follow-up once flags settle.
- Auto-running pretrain at `init` time — opt-in via the script keeps `init` fast and avoids unexpected GitHub API calls. The usage doc points users to it.
- A learned distiller (paper's 11× byte compression) — same scope-line as ADR-076. Rule-based extractor is what ships; a learned drop-in replacement is tracked.

## Verification

```bash
# Repro from a fresh checkout
git clone https://github.com/ruvnet/ruflo && cd ruflo
npm install && ( cd v3/@claude-flow/cli && npx tsc -b )

# Pretrain on this repo's history (default 50 commits + 30 issues)
node v3/@claude-flow/cli/scripts/pretrain-from-github.mjs
# → +80 trajectories, +80 neural patterns, run JSON in docs/benchmarks/runs/

# Validate that what was learned is retrievable
node v3/@claude-flow/cli/scripts/benchmark-pretrained-retrieval.mjs
# → 100% match rate across 10 sample queries

# Regression guard (no live git/gh — embedded fixture)
( cd v3/@claude-flow/cli && npx vitest run __tests__/pretrain-from-github.test.ts )
# → 6 passed
```
