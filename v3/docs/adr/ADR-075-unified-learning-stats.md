# ADR-075 — Unified Learning Stats Aggregator (#2245 follow-up)

**Status**: Accepted — Implemented in ruflo 3.10.15
**Date**: 2026-05-30
**Tracking**: [#2245](https://github.com/ruvnet/ruflo/issues/2245) — self-learning subsystem audit
**Supersedes**: the "future-rounds" item in ADR-074 §"Deliberately NOT in this round" titled *"Unify the 4 stat sources"*

## Context

ADR-074 (#2245 round 1) wired the three broken self-learning surfaces (`hooks_task-completed`, `signalsProcessed`, `pretrain`) and made every handler return an honest `learningPath`/`sources.stores`/`note` so callers see which path ran. It left one item to a future round:

> Unify the 4 stat sources — designate `globalStats` as authoritative, derive `memory_bridge_status`, `hooks metrics`, and `neural_patterns count` from it. Multi-PR design work.

When we tried that, we found the premise was wrong: the four sources **genuinely measure different things**. They look like duplicates of one number because they all answer "did learning happen?" — but each store is the authoritative record for a different layer:

| Aggregator | Authoritative for |
|---|---|
| `globalStats` (`.claude-flow/neural/stats.json`) | "did the SONA/trajectory pipeline persist a learning event" (counter form) |
| `sonaCoordinator` (in-memory) | "in this process, how much has SONA trained" (live, resets per process) |
| `memory-bridge` (AgentDB) | "how many memory entries exist across all namespaces" — way broader than learning |
| `neural_patterns` store | "what pattern artefacts are queryable by `neural_patterns list`" |

Designating one as authoritative would either lose information or force lossy back-fill. The right move is to *aggregate the view*, not the store.

## Decision

Add a **read-only aggregator** that calls all four stores and returns them in one shape, with each sub-view explicitly naming its source. No new store. No migration. No data motion. One honest answer.

### Public surface

`getUnifiedLearningStats()` in `intelligence.ts` returns:

```ts
interface UnifiedLearningStats {
  global:        { patternsLearned, trajectoriesRecorded, signalsProcessed, lastAdaptation, source };
  sona:          { trajectoriesTotal, patternsLearned, reasoningBankSize, avgAdaptationTimeMs, source, available };
  memoryBridge:  { totalEntries, perNamespace, source, reachable };
  neuralPatterns:{ patternCount, byType, modelCount, source };
  consistency:   { sonaTracksGlobal, sonaTracksGlobalDelta, notes };
  generatedAt:   string;
}
```

### MCP surface

`hooks_intelligence_unified-stats` exposes the aggregator to MCP clients. Description names every sub-view's store and the kind of question each answers, so an LLM agent can choose between this (one coherent dashboard) and the original narrow aggregators (one specific slice).

### Helpers that fell out

- `getMemoryBridgeStats({ namespaces? })` in `memory-bridge.ts` — read-only top-level + per-namespace entry counts. Best-effort: returns `reachable:false` instead of throwing when the bridge isn't loadable.
- `getNeuralStoreStats()` in `neural-tools.ts` — top-level + per-`type` pattern count from the neural store file.

Both are exported so anything wanting a coherent learning-state snapshot can build it from the same primitives.

### The `consistency` block

Instead of *enforcing* an invariant between stores (which would require schema-level work in the data path), we *describe* the relationships and flag drift:

- `sona.trajectoriesTotal` is expected to track `globalStats.trajectoriesRecorded` within ±1 between a process restart and the next `clearIntelligence()`. Drift outside ±2 is a `consistency.notes` entry.
- When `globalStats.patternsLearned > 0` but `neuralPatterns.patternCount === 0`, the consistency block reports it explicitly — that's the pretrain-vs-trajectory-vs-neural-store gap the reporter caught in #2245.
- When the memory-bridge is unreachable, that's named in `consistency.notes` so bridge-dependent counters showing 0 aren't misread as "no activity."

This is the same shape as the per-handler `learningPath`/`note` design from ADR-074: report what you did *and* what you couldn't do, never silently lie.

## Deliberately NOT in this ADR

- Schema-level unification (one store, others derived). Wrong design — see Context.
- Persisting `sonaCoordinator` stats across process restarts. Out of scope; tracked under #2245's "background consolidation worker" item.
- Wiring `post-edit` / `post-command` to feed the trajectory pipeline. Tracked as round B of the post-ADR-074 work.
- Structured Distillation of trajectory content (arXiv:2603.13017, #2241). Tracked as round C.

## Consequences

- One call answers "did learning happen?" across all 4 layers, with each layer's source path named.
- The `consistency.notes` array catches the specific drifts the reporter found (the "four contradictory sources" complaint) — they're now surfaced as flags on the unified call rather than as silent disagreement between separate dashboards.
- The original aggregators stay where they are; nothing depends on them being merged. Code paths that need exactly the SONA slice still call `hooks_intelligence_stats`. Code paths that need the bridge slice still call `memory_bridge_status`. The unified call exists alongside them.
- No data migration. No back-compat shim. New surface, new MCP tool, additive.

## Verification

- `__tests__/unified-stats-2245.test.ts` — 7 tests:
  - Shape: all four sub-views present with `source` fields ✅
  - Driving each path moves the right counter:
    - `recordSignalProcessed` → `global.signalsProcessed` up ✅
    - `storeNeuralPatterns` → `neuralPatterns.patternCount` up ✅
    - `hooks_task-completed {trainPatterns:true}` → `global.trajectoriesRecorded` up ✅
  - Consistency block flags drift instead of staying silent ✅
  - MCP tool registered + returns the unified shape ✅
- `scripts/benchmark-self-learning.mjs §F` — proof artifact in `docs/benchmarks/runs/self-learning-latest.json`.
- Build clean (`tsc -b`); full CLI suite green (modulo the 3 pre-existing flakes documented in ADR-074).

## Reproduce

```bash
git clone https://github.com/ruvnet/ruflo && cd ruflo
npm install && ( cd v3/@claude-flow/cli && npx tsc -b )

# Cross-store consistency tests
( cd v3/@claude-flow/cli && npx vitest run __tests__/unified-stats-2245.test.ts )

# 6-section benchmark including §F unified-stats
node v3/@claude-flow/cli/scripts/benchmark-self-learning.mjs
```
