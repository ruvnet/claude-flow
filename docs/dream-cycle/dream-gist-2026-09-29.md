# Swarm SOTA Report — 2026-09-29

TL;DR: Ruflo's own `@claude-flow/swarm` package ships real Raft/Byzantine/gossip consensus and a domain-based agent-pool router, ahead of every LLM-orchestration competitor surveyed on multi-agent liveness/consensus — but `UnifiedSwarmCoordinator.spawnAgent()`'s plain agentic-flow-compatible call path (no `domain`/`agentNumber` given) silently never added the new agent to its domain's `AgentPool`, so `assignTaskToDomain()` either scale-up-created a *different*, duplicate agent or queued forever, while the original agent sat idle and permanently unused. Fixed with a 6-line, single-file change; independent adversarial critique found one real edge-case regression the fix introduced (a new uncaught throw when an auto-domain spawn pushes a small/full domain pool over capacity), closed same session with a try/catch + a new event. 4 new discriminating tests, baseline-fails/candidate-passes, full 241/241 package suite green, `tsc --noEmit` clean.

## What's New in 2026

| Finding | Source | Confidence |
|---|---|---|
| Microsoft Agent Framework reached 1.0 GA (Apr 2026), converging AutoGen + Semantic Kernel; AutoGen itself moved to maintenance mode Oct 2025 | Official Microsoft devblogs + learn.microsoft.com, cross-checked | B |
| LangGraph ships real per-node `RetryPolicy`/idle-timeout liveness (2026-06-04 blog); Temporal's Activity Heartbeats are the closest production analog to Ruflo's own heartbeat-timeout health checks | Official LangChain + Temporal docs, both read directly | A |
| No LLM-orchestration framework surveyed (LangGraph, Microsoft Agent Framework, CrewAI, OpenAI Agents SDK) implements cross-agent voting/quorum/BFT — each has exactly one authoritative decision-maker per turn | Official docs for all 4, read directly | A |
| A 2026 arXiv position paper proposes SWIM/Fireflies-style gossip failure-suspicion for agentic multi-agent systems — architecturally exactly what Ruflo's already-shipped `GossipConsensusEngine` could be repurposed for, but currently isn't (used only for consensus, not liveness) | Single arXiv position paper, not independently reproduced | C |
| "Centralized orchestration has limited scalability (3-7 agents) and low fault tolerance" is a widely-repeated 2026 blog claim, but no primary benchmark was cited or independently reproduced | Single dev.to synthesis post | C |

## Ruflo Current Capability

`@claude-flow/swarm/src/{consensus/{raft,byzantine,gossip}.ts, unified-coordinator.ts, agent-pool.ts, topology-manager.ts, federation-hub.ts, message-bus.ts}` implement real Raft election/heartbeat, Byzantine voting, and gossip dissemination, plus a domain-sharded `AgentPool` (min/max size, auto scale-up/down) that `assignTaskToDomain()` draws from via `pool.acquire()`. Tonight's fix closes a wiring gap in the third of `spawnAgent()`'s three branches — the two domain-aware branches (`agentNumber`/`domain` given) already call `pool.add()` via `registerAgentWithDomain()`; the auto-domain branch (`unified-coordinator.ts:1685-1690`) did not.

## Competitor Comparison

| Framework | Coordination/Consensus mechanism | Liveness/health mechanism | Gap type vs Ruflo | Grade |
|---|---|---|---|---|
| LangGraph | Single-writer supervisor/swarm handoff, no voting | Per-node `RetryPolicy` + idle-timeout, scoped to one process | Solved differently — single authoritative thread substitutes checkpoint-resume for consensus | A |
| Microsoft Agent Framework (AutoGen successor, GA 2026-04) | Centralized group-chat orchestrator picks next speaker; no cross-agent vote | Undocumented — no heartbeat/health policy for a stuck participant | Open gap, not deliberately avoided | A |
| CrewAI | Hierarchical manager delegates by role, no voting mechanism | `max_iterations` only; no worker health/liveness signal documented | Open gap — closest to "no liveness at all" among surveyed frameworks | A (mechanism) / B (production-gap claim) |
| OpenAI Agents SDK | LLM-driven tool-call handoffs; "no consensus or voting mechanism" by design | Not documented — one LLM call in flight at a time, liveness not a first-class question | Open gap by design omission | A |
| Temporal (distributed-systems-adjacent) | Single authoritative service, not peer voting | Activity Heartbeats + Schedule/Start-To-Close timeouts — real, production-proven pattern | Solved, but centralizes trust in one service rather than tolerating the coordinator itself failing | A |

No competitor attempts Ruflo's actual hardest problem (agreement that survives the coordinator itself failing); Ruflo's differentiation is real at the algorithm-library level, though — per tonight's own research — its top-level `SwarmCoordinator.reachConsensus()` convenience API (a *different*, DDD-application-layer class from the fixed `UnifiedSwarmCoordinator`) is still a `Math.random()` stub with zero production callers, a good candidate for a future night.

## Hypothesis

> Given `UnifiedSwarmCoordinator.spawnAgent()` called with no `domain`/`agentNumber` (the plain agentic-flow-compatible call shape), when the auto-domain branch is fixed to call `pool.add(agent)` after `registerAgent()` — mirroring `registerAgentWithDomain()`'s existing pattern — then `assignTaskToDomain(taskId, domain)` should route work to the agent `spawnAgent()` actually returned, relative to baseline where it silently acquires/creates a different orphaned agent (if the pool isn't at `maxSize`) or queues forever (if it is), subject to: (1) the two existing domain-aware branches are unaffected; (2) all existing `@claude-flow/swarm` tests remain green; (3) $0, deterministic, zero LLM calls.

Frozen before evaluation; not modified after seeing results.

## Benchmarks / Evaluation

**evaluated: accepted (post-hardening).** Real evaluator: Vitest 4.1.8, deterministic, $0, zero LLM calls, against a freshly `pnpm install`-ed `v3/` workspace. New file `v3/@claude-flow/swarm/__tests__/spawn-agent-domain-pool.test.ts` (4 tests). Baseline (`git stash` isolated to `unified-coordinator.ts` only): 2/3 fail exactly as predicted — pool stats report `total: 0` after spawn, and `assignTaskToDomain()` returns a different, freshly scale-up-created agent id (`core-domain-pool_agent_1`) instead of the one `spawnAgent()` returned (`agent_swarm_..._1`). Candidate (round 1): 3/3 pass; full `@claude-flow/swarm` package suite 237/237 (13 files) → 240/240 (14 files, +3 new), zero regressions, `tsc --noEmit` 0 errors — independently re-reproduced by an adversarial critic subagent with byte-identical results.

**Post-critique hardening**: the critic found that `pool.add()` throws once a domain pool is at its small fixed `maxSize` (e.g. `queen` caps at 1 — `agentTypeToDomain()` maps `queen`/`coordinator` there), and the new call wasn't wrapped in try/catch — a second auto-domain `queen`/`coordinator` spawn now threw `Pool queen-domain-pool is at maximum capacity`, a regression versus baseline's silent (if buggy) success, and at least one caller (`v3/mcp/tools/swarm-tools.ts`'s scale-up loop) doesn't try/catch individual `spawnAgent()` calls. Reproduced independently against the patched code before fixing. Closed same session: `pool.add()` wrapped in try/catch, emitting a new `agent.domain_pool_full` event on the caught path instead of throwing — the agent stays registered/idle either way, degrading to the pre-fix pool-invisible state rather than failing the caller. New 4th test: manually reverted just the try/catch, confirmed it reproduces the critic's exact throw, restored, reconfirmed green. Full suite (with hardening): **241/241** (14 files), `tsc --noEmit` 0 errors.

## Darwin Results

Skipped — binary wiring/correctness fix (an agent is pool-visible or it isn't), no continuous/categorical parameter with a fitness gradient for Darwin's real interface (`npx ruvector harness darwin <config> --execute`, confirmed available, v0.9.2) to search over. Same skip class as nearly every accepted dream-cycle night since 2026-08-18.

## SOTA Proof & Witness

Reward-hack check (manual checklist, no standalone reward-hack CLI reachable — confirmed via `npx ruvector harness --help`): no test weakened (new file only, existing 237 tests untouched); no gold data touched (none exists on this path); no cherry-picking (full suite disclosed at every stage, both ways); no seed manipulation; zero cost; no undocumented caching; no error suppression hiding a real failure (the hardening's `catch` re-emits an observable event rather than silently swallowing). Security review: not security-sensitive — pure in-process `Map`/`Set` bookkeeping on an internally-generated `agentId`, no new I/O/network/credential/filesystem surface (independently confirmed by the critic).

**Independent adversarial critique** (separate subagent, no authoring context): **CONFIRMED-WITH-CAVEATS** on round 1 (fix mechanism verified correct via its own independent stash/pop reproduction; one real edge-case regression found — see Evaluation above); the caveat was closed same session and re-verified.

| Field | Value |
|---|---|
| Session commit | `6d5699e8521d03286090e006afa8e6eba61c6495` |
| Gist SHA-256 (pre-witness content) | `ccabbc459ac0466a6f481a11a81b9248fd114a01bde91afadf9f4a435d2cc0f5` |
| Witness stamp | `7fca8c149f8d59107ff1bba9f523483399bfaf2728d22dc623ef6958dfcc07ac` |

Verifier procedure: fetch this gist from the branch, strip the witness table's three filled values back to `PENDING`, SHA-256 it, concatenate with the session commit above, SHA-256 again — result must equal the witness stamp.

## Recommended Next Steps

1. **This fix**: human review and merge — two small source edits (the pool-add wiring plus its own hardening) and one new test file, one conceptual change, zero regressions, matches the precedent class of #3357/#3378.
2. **Future `swarm`/`security` night**: wire `SwarmCoordinator.reachConsensus()` (`v3/src/coordination/application/SwarmCoordinator.ts:368-394`) off its `Math.random() > 0.5` stub — it is a live, exported public API (from `v3/src/index.ts`) with a currently non-discriminating test, though zero in-repo production callers today.
3. **Future `swarm` night**: port the event-driven-wait pattern (#3378/#3443) into the 4 sibling busy-polls still live in `consensus/{raft,byzantine,gossip}.ts`'s `awaitConsensus()` and `federation-hub.ts`'s `waitForAgentCompletion()` — all four already emit the exact event being polled for at 10-100ms granularity, on every real consensus decision and cross-swarm ephemeral spawn.
4. **Future `swarm` night**: `FederationHub.terminateAgent()` is not idempotent (double-counts `completedAgents`/`totalAgentLifespanMs` when called twice, e.g. from `shutdown()` racing `unregisterSwarm()`) — zero test coverage today, ~3-line fix.
