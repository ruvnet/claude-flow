# ADR-170: agenticow Copy-On-Write Memory as an Agent-Scoped Workspace Substrate

**ID**: ADR-170
**Status**: Proposed — implemented on `feat/agenticow-integration` (ships in 3.21.0)
**Date**: 2026-07-04
**Authors**: rUv (drafted with Claude Code)
**Related ADRs**:
- ADR-150 (MetaHarness integration — the optional-dependency / graceful-degradation posture reused here)
- ADR-103 (Witness manifest — provenance discipline echoed by ADR-171)
- ADR-171 (Provenance-tiered evaluation oracle — gates promotion of the branches this ADR creates)

---

## 1. Context

`agenticow` (ruvnet, MIT, `@ruvector/rvf-node`-backed) is "Git for Agent Memory" — copy-on-write vector branching over `.rvf` files. A branch is a constant ~162 bytes regardless of base size, with read-through semantics (parent ∪ edits, child wins) and lifecycle verbs (checkpoint / rollback / promote).

ruflo already wrapped four lifecycle verbs (branch/checkpoint/rollback/promote) as MCP tools, but:
- The read/write verbs that make a branch *usable* — `ingest`, `query`, `diff`, `lineage`, `status` — were not wrapped. You could create a COW branch but not populate or read it.
- **Zero orchestration paths consumed any of it** — the tools sat in the registry, unreachable from swarm / autopilot / workflow.
- A load-bearing upstream bug: `save()` dropped per-node text payloads, so query hits lost their `text` after any manifest round-trip (fixed upstream in agenticow 0.2.4, ruvnet/agenticow#3).

The original motivation was the v3.14.4 **3.3 GB worktree-bloat regression** from Darwin's git-worktree-per-agent pattern (full-copy snapshot semantics).

## 2. Decision

Adopt agenticow as ruflo's **agent-scoped memory workspace substrate**, complete the verb surface, and wire it into orchestration behind opt-in flags. Five parts:

### 2.1 Complete verb surface (9 tools)
Add `agenticow_ingest / _query / _diff / _lineage / _status` alongside the existing four, plus a `nativeAnn` fast-path option on `agenticow_branch` (Rust dual-graph ANN, recall@10=1.0) and a targeted-`checkpointId` rollback. Floor bumped `~0.2.4` (the text-persistence fix).

### 2.2 Per-agent COW branches (opt-in)
`SwarmMemoryBranches` — `branchForAgent / promoteAgent / discardAgent` — wired into `agent_spawn` / `agent_terminate`. **Honest scope**: the swarm spawn path does not do a full `.rvf` copy today (agents are JSON metadata; the 3.3 GB bloat was the *external* Darwin worktree pattern). So this is delivered as an **opt-in agent workspace** (`memoryBase` input), not a replacement for a copy that doesn't exist — pretending otherwise would be benchmark theater.

### 2.3 Speculative branch-and-promote
`explore(base, candidates, score)` — fork a branch per candidate, run each in isolation, promote the winner, discard losers (delete 162-byte files). Exposed as `agenticow_speculate`. **Promotion is gated per ADR-171** — a winner is not eligible to graduate to base on scorer rank alone.

### 2.4 Checkpoint/rollback gate
`CheckpointGate.guard(memPath, label, fn)` — checkpoint before a risky tick, rollback on failure — wired opt-in into the autopilot loop's re-engage (checkpoint) and stall (rollback) seams. Cross-tick bracketing because the loop's memory mutation is out-of-process.

### 2.5 One shared optional-dep loader
A single `_agenticow.ts` module owns `loadAgenticow` / `resolveMemoryPath` / `manifestFor` / `validateLabel` / `openWithLineage`. Every consumer (MCP verbs, swarm branches, checkpoint gate, speculative, oracle) imports it — **first-class compatibility layer**, not per-consumer copies. (Three parallel implementations were consolidated at merge; divergent loaders are the highest merge-break risk in this integration.)

## 3. Constraints (all preserved)

- **ADR-150 optional-dependency posture**: `agenticow` in `optionalDependencies`; every path graceful-degrades to `{degraded:true, reason:'agenticow-not-found'}`; ruflo runs fully without it.
- **Startup**: agenticow is lazy-loaded — `ruflo --help` stays ~0.08s (verified).
- **Kill switches**: `CLAUDE_FLOW_NO_COW_MEMORY` / `CLAUDE_FLOW_AGENTICOW_DISABLE` per subsystem.
- **Security**: `resolveMemoryPath` rejects `..` traversal and NUL; labels constrained to `[A-Za-z0-9_.\-:/@]`.

## 4. Consequences

- Branches are real infrastructure: populable, queryable (COW read-through with provenance in the hit's `branch` field), diff-able before promote.
- The measured claims are honest: 162-byte branches confirmed; the "0.5ms / 83×" marketing is *not* reproduced (fixed ~10ms fork cost, wins full-copy only past ~30k-vector crossover — documented in `docs/agenticow/findings.md`).
- Everything is opt-in; default behavior is byte-identical. The value is *available*, not imposed.
- Enables the governed learning loop: branch → test → judge → promote → rollback (ADR-171).

## 5. Alternatives rejected

- **Re-track the git-worktree copy**: that was the bloat. Rejected.
- **Force branching on every spawn**: invents a workspace nothing consumes; inflates every run. Rejected in favor of opt-in.
- **Per-consumer loaders**: caused the merge-break risk; consolidated to one.
