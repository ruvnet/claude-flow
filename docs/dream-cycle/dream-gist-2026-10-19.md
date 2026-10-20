# Swarm SOTA Report — 2026-10-19

**TL;DR**: 2026 multi-agent research converges on a point Ruflo's own code quietly contradicts: majority-vote consensus is unsafe below ~50% per-agent accuracy (arXiv:2602.08586) and drops correct dissent at synthesis (arXiv:2510.10185) — so structural consensus (raft/byzantine/gossip, which Ruflo already implements, ahead of every named competitor) must not be conflated with epistemic correctness. Independently, three research roles converged on real, previously-unflagged bugs in `TopologyManager`/`ByzantineConsensus`. Tonight implements and evaluates the strongest of these: hierarchical/centralized topologies never promoted a replacement queen/coordinator after the original died, despite `failoverEnabled: true` being the documented default — silently breaking CLAUDE.md's own "queen controls workers directly" guarantee after one death, forever.

## What's New in 2026

| Finding | Source | Confidence |
|---|---|---|
| LLM-agent Byzantine consensus fails mostly on **liveness** (stalled convergence), not corrupted values, worsening with group size | Berdoz et al., "Can AI Agents Agree?", arXiv:2603.01213, Mar 2026 | B |
| MAST: 14-mode failure taxonomy across 7 MAS frameworks, 1600+ traces, κ=0.88; inter-agent misalignment + unresolved verification dominate | arXiv:2503.13657, NeurIPS 2025 | A (peer-reviewed, public dataset) |
| Majority voting actively harms multi-agent decisions below 50% per-agent accuracy; correct answers can split across variants with no plurality winner | DIANOIA, arXiv:2602.08586 | B |
| A meta-agent explicitly recorded a correct dissenting minority view, then still synthesized the wrong majority answer | Medical multi-agent audit, arXiv:2510.10185 | B |
| Coordination topology (not model choice) dominates MAS outcomes; fixed pipeline/committee topologies underperform task-adaptive selection | AdaptOrch, arXiv:2602.16873, Feb 2026 | C (single-author preprint, no public repo) |
| AutoGen → Microsoft Agent Framework merged (GA ~Apr 2026); v0.4 moved to an async event-driven actor model | AG2 docs; Medium merger writeup, Apr 2026 | B |

## Ruflo Current Capability

`v3/@claude-flow/swarm/src/` ships real `raft.ts`/`byzantine.ts`(550 lines, full 3-phase PBFT)/`gossip.ts`(624 lines) — ahead of LangGraph/AutoGen/CrewAI/OpenAI Agents SDK, none of which ship a native consensus/voting primitive. But three independent research roles, reading the actual source, found real gaps the docs don't disclose:

1. **Queen/coordinator failover is vaporware despite `failoverEnabled: true`.** `TopologyManager.removeFromRoleIndex()` (`topology-manager.ts:610-622`, pre-fix) nulls the cached `queenNode`/`coordinatorNode` on death with no replacement; `electLeader()`'s hierarchical/centralized branches (`:199-215`, pre-fix) silently fell through to generic mesh-style ranking, setting `state.leader` without ever promoting the winner's `.role`. `failoverEnabled` was read nowhere in the package (grep-confirmed). **This is tonight's implemented candidate — see Evaluation.**
2. **Byzantine view-change is dead code.** `ByzantineConsensus.initiateViewChange()` (`byzantine.ts:439-448`) correctly re-elects a primary and emits events but has zero call sites anywhere in the repo; `viewChangeTimeout` is declared, cleared on shutdown, but never armed via `setTimeout`. A stalled primary just hangs until the outer 30s proposal timeout — directly matching the ETH liveness-failure pattern above. Not implemented tonight (view-change election itself is untested machinery; higher risk than the topology fix).
3. **`crdt`/`quorum` consensus are vaporware at two different layers, independently confirmed by two roles.** `ConsensusEngine.initialize()` (`consensus/index.ts:78-118`) only implements raft/byzantine/gossip (paxos falls back to raft); selecting `crdt` or `quorum` throws `Unknown consensus algorithm`. Separately, `cli/src/mcp-tools/hive-mind-tools.ts`'s own disconnected consensus mock accepts `crdt`/`quorum` as `consensusStrategy` at init, echoes it back as confirmed, then its real vote-tally function (`calculateRequiredVotes()`) silently defaults any unmatched strategy to plain majority — `crdt`/`quorum` never actually execute CRDT merge or real quorum math anywhere. Documented in CLAUDE.md and 2+ MCP tool schemas as if real. Flagged as a capability-honesty issue spanning CLI+docs, not a single-file bugfix — left for a future night's design decision (cleanup vs. real implementation).
4. No aging/starvation-prevention in `TaskOrchestrator.getNextTask()` priority scheduling (classic MLFQ gap, general not SOTA-specific). Not implemented tonight.
5. `TaskOrchestrator.failTask()` never cascades to dependent tasks (`completeTask()` does, via `unblockDependentTasks`) — dependents sit `'blocked'` forever after a permanently-failed dependency, reachable via `SwarmHub.completeTask(result.success=false)`. Strong alternate candidate (arch-reviewer's top pick); deferred in favor of the topology fix below because it touches `task-orchestrator.ts`, already modified by the still-open 10-14 draft PR #4174.

## Competitor Comparison

| Competitor | Topology | Consensus/voting | Message-passing | Confidence |
|---|---|---|---|---|
| LangGraph | Graph-based, supervisor-routed; "dynamic" = conditional edge selection, not runtime topology mutation | None built-in; arbitration left to supervisor LLM judgment | Step-driven state passing, not an independent bus | B |
| AutoGen → MS Agent Framework | Centralized `GroupChatManager` speaker selection (LLM/round-robin/FSM) | No confirmed voting API; one unverified secondary source claims "consensus protocols" — flagged unconfirmed | v0.4 moved to async event-driven actor model | B/C |
| CrewAI | Fixed sequential/hierarchical, set at definition time, not runtime-adaptive | None — hierarchical "manager" has an open unresolved bug (GH #4783, Mar 2026) routing sequentially instead of delegating | Sequential handoff; Flows add event-triggered steps, not a real bus | B |
| OpenAI Agents SDK | Handoff-based, single-active-agent — explicitly not a graph/role topology | None — single-threaded control | Synchronous context carry on handoff | C (no official 2026 docs found) |
| Field-wide (why none ship default voting) | — | Majority voting is researched and shown harmful below 50% per-agent accuracy (DIANOIA); this is deliberate avoidance of a known failure mode, not an oversight | — | B |

No row is a bare, unexplained "None" — each absence ties to an open framework bug, an explicit design-scope decision (CrewAI pushes durability to Temporal/Diagrid), or evidence that voting is actively harmful.

## Hypothesis (frozen before evaluation)

> Given a `TopologyManager` configured for `hierarchical` or `centralized` topology with `failoverEnabled: true` (the default), when the current queen/coordinator node is removed and `electLeader()` runs (directly, or internally via `removeNode()` when the removed node was the leader), then a replacement active node should be promoted to the queen/coordinator role (`.role` updated, `queenNode`/`coordinatorNode` cache repopulated via the existing role-index pair) and set as `state.leader`, instead of silently falling through to generic mesh-style ranking that elects a leader without ever promoting its role — subject to: (1) mesh/hybrid `electLeader()` behavior is completely unchanged; (2) with `failoverEnabled: false`, pre-existing fallback behavior is preserved byte-for-byte; (3) zero regressions in the existing 332-test `@claude-flow/swarm` suite; (4) deterministic, $0, zero-LLM Vitest evaluation.

## Benchmarks / Evaluation

Real evaluator: Vitest 4.1.8 against a freshly `pnpm install`-ed `v3/` workspace. No `.harness/bench.json` corpus exists for this package — this is a deterministic correctness fix, evaluated like nearly every accepted swarm-surface fix since 2026-08-18, not a latency/throughput candidate.

Added 3 discriminating tests to `__tests__/topology.test.ts`'s existing "Leader Election" block. Stash-isolated baseline (`git stash` on `topology-manager.ts` only): **2 of 3 fail exactly as predicted** (`getQueen()`/`getCoordinator()` return `undefined` after death; role stays `'worker'`); the 3rd (`failoverEnabled: false` must preserve old behavior) is a correct non-discriminating control, passing both ways. Candidate: **3/3 pass**. Full `@claude-flow/swarm` suite: **335/335 passed** both ways except the 3 new tests (332 pre-existing), zero regressions. `tsc --noEmit`: clean, 0 errors, both ways.

The pre-existing "should handle leader removal" test (line 386) already covered this exact scenario but only asserted `newLeader` is `toBeDefined()` — too weak to catch the bug; tonight's tests sit right next to it with the actually-discriminating assertions.

**Independent adversarial critique** (separate subagent, no authoring context; reproduced stash/pop + full suite + tsc itself; grepped for consensus blast-radius and overlap with prior fixes): **CONFIRMED-WITH-CAVEATS, none blocking.** `TopologyManager` is confirmed structurally independent of raft/byzantine/gossip. Disclosed, non-blocking caveats: (1) promotion doesn't rewire `.connections`/adjacency itself — self-healing under default `autoRebalance: true` (removeNode's trailing `rebalance()` fixes edges immediately after), stale only if a caller sets `autoRebalance: false` (now an in-source KNOWN LIMITATION comment); (2) candidate pick is first-active-in-insertion-order, not capability-ranked — matches this file's existing fallback conventions; (3) no new locking/concurrency surface — pre-existing, class-wide.

## Darwin Results

Skipped — binary correctness/wiring fix (promote a node's role instead of leaving it stale), no continuous/categorical parameter for Darwin's real interface (`npx ruvector harness darwin <config> --execute`, confirmed available in STEP 0.5) to search over. Same skip class as nearly every accepted fix since 2026-08-18.

## SOTA Proof & Witness

No `.claude-flow/flywheel/` state exists in this repo (same as every prior night). Evidence retained as: 3 new tests, the stash-isolated comparison, the independent adversarial critique, issue/PR links, and the witness below.

```
Session commit:   b93144803bb171b12993b715fe7b2dd936b6edd5
Candidate commit: (this branch's head — see commit list)
Gist SHA-256 (pre-witness, witness block stripped to PENDING): 6465b7181dccf34c5ee53c27944eb8f4f3d89e53f8d9eca0fdd895d1acc02683
Witness stamp:    7cf5c70f221659f0ad17ae6c68327b6ce5cf6fb48fd717389c6730c100cc4ea6
```
Verifier: fetch `docs/dream-cycle/dream-gist-2026-10-19.md` from this branch, strip the Witness block's filled-in values back to `PENDING`, SHA-256 the file, concatenate with the session commit above, SHA-256 again — must equal the witness stamp.

## Recommended Next Steps

1. Fix `TaskOrchestrator.failTask()`'s missing dependent-cascade (finding #5) — real production path via `SwarmHub.completeTask(success:false)`, small patch, clean deterministic test already sketched by tonight's architecture reviewer using the existing `task-orchestrator.worker-release.test.ts` harness pattern. Wait for draft PR #4174 (10-14, also touches `task-orchestrator.ts`) to land first to avoid overlapping edits.
2. Decide the `crdt`/`quorum` vaporware question (finding #3) as a deliberate design call, not a drive-by fix: either strip the fake options from `hive-mind.ts`'s CLI menu + CLAUDE.md's consensus table, or wire `hive-mind-tools.ts`'s `quorum` into its own already-real majority math and have `crdt` throw a clear "not implemented" instead of silently degrading to majority vote.
3. Before arming Byzantine's dead `initiateViewChange()` (finding #2), add test coverage for the view-change election logic itself in isolation — it's currently untested machinery, and wiring it live without that coverage first risks introducing a split-brain bug worse than the liveness gap it fixes.
