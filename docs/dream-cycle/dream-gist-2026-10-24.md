# Swarm Coordination SOTA Report — 2026-10-24

TL;DR: In 2026, the sharpest open finding on multi-agent LLM coordination is that **consensus failures among agents are overwhelmingly liveness failures (timeouts/stalled convergence), not value corruption** (arXiv:2603.01213), and that **communication-topology mismatch alone can drop coordination success from >90% to <30%** (arXiv:2602.03128). Tonight's own architecture review found Ruflo's *own* default consensus algorithm has a much more basic problem on the same axis: `RaftConsensus.checkConsensus()`'s quorum arithmetic (`Math.floor(totalVoters * threshold)`) degenerates for 2–3-voter clusters so that the leader's own unconditional self-vote alone satisfies quorum — meaning an explicit peer **rejection** could be overridden and the proposal accepted anyway. Fixed tonight, with a real stash-isolated evaluation.

## What's New in 2026

| Finding | Source | Confidence |
|---|---|---|
| LLM-agent consensus fails mainly via liveness/timeouts, not corrupted votes, even with zero adversaries | "Can AI Agents Agree?", arXiv:2603.01213 (Mar 2026) | A |
| Architecture/topology mismatch drops multi-agent coordination success >90%→<30%; orchestration overhead alone can add >60x latency | "Architectural Design, Not Only Model Intelligence, Governs MAS Performance" + MAFBench, arXiv:2602.03128 | A |
| Self-Anchored Consensus (SAC): leaderless, self-report-free Byzantine-agent consensus via iterative filter-and-refine | arXiv:2605.09076 (May 2026) | B |
| Governed shared-memory failure taxonomy (leakage/stale-propagation/contradiction-persistence/provenance-collapse) + MemClaw production system | arXiv:2606.24535 (Jun 2026) | A |
| Centralized coordination contains LLM-swarm error amplification to 4.4x vs. 17.2x uncoordinated; architecture choice predicts outcome 87% of held-out configs | Google Research, arXiv:2512.08296 / blog Jan 2026 | A |

## Ruflo Current Capability

`v3/@claude-flow/swarm/src/` ships real implementations most competitors don't: `TopologyManager` (4 named topologies, BFS routing, auto-rebalance), `RaftConsensus`/`ByzantineConsensus`/`GossipConsensus` with a pluggable `ConsensusTransport` (in-process or a real signed WS wire protocol, ADR-095 G2), and a weighted-vote layer on all three (2026-08-24). Five prior swarm nights (09-19 through 10-19) fixed topology-mirroring, leader-role-promotion, pool-release, and message-bus retry-key bugs — all confirmed still correct tonight.

Tonight's finding is in the one thing none of those nights touched: `RaftConsensus.checkConsensus()`'s quorum formula itself. `propose()` unconditionally casts the leader's own `approve: true` self-vote (weight 1) before any peer votes. `checkConsensus()` runs only inside `vote()`, so the *first* peer vote to arrive triggers the accept check. With default `threshold=0.66`: `Math.floor(2*0.66)=1` and `Math.floor(3*0.66)=1` — exactly the self-vote's weight. So for any 2- or 3-total-voter cluster (a common hive-mind size), the first peer vote processed accepts the proposal **regardless of its own value**, because `approvingWeight` (1, from the self-vote) already meets quorum before that peer's vote is even counted.

## Competitor Comparison

| Competitor | Consensus/agreement mechanism | Leader election / failover |
|---|---|---|
| LangGraph (swarm/supervisor) | None — single decision-maker by design; `langgraph-supervisor-py` archived 2026-09-20 | None — no leader concept in the handoff model |
| Microsoft Agent Framework (AutoGen successor; AutoGen itself archived) | None — group-chat is iterated critique, not a vote; Magentic's manager is a single centralized arbiter | Workflow-level durability (pause/resume) only, no peer re-election |
| CrewAI | None — hierarchical mode's manager *validates*, doesn't poll peers | None documented for a failed manager/worker |
| OpenAI Agents SDK | None — handoffs are a single current-speaker baton pass | None — single-run scope only |

None of the four ship Raft/BFT/gossip consensus or peer failover at all — this is a genuine, converging gap (cost- and complexity-driven avoidance per this cycle's competitor research, not a secret internal solution), and it's exactly the surface where Ruflo's own implementation (three real consensus algorithms + failover) is differentiated — which makes a correctness bug in that exact surface higher-value to fix than it would be in a less differentiated area.

## Hypothesis

Given a `RaftConsensus` cluster with `totalVoters` (self + peers) in `{2, 3}` at the default `threshold=0.66`, when `checkConsensus()`'s quorum is computed via `Math.ceil(totalVoters * threshold)` instead of `Math.floor(...)`, then an explicit peer rejection should correctly prevent acceptance (the leader's self-vote alone cannot satisfy quorum), relative to baseline (where it incorrectly accepts) — subject to: zero change to existing Raft/weighted-consensus test assertions, zero regression to the full `@claude-flow/swarm` suite, deterministic $0 zero-LLM Vitest evaluation. Frozen before evaluation; not modified after.

## Benchmarks / Evaluation

Real evaluator: Vitest 4.1.8 against `@claude-flow/swarm` (354 pre-existing tests). 3 new tests (2 discriminating: 2-voter and 3-voter clusters with a lone peer rejection; 1 positive control: 2-voter cluster with approval). Stash-isolated baseline (`git stash` on just `raft.ts`): full suite **352/354** — the 2 new discriminating tests fail exactly as predicted (`approved: true` when the only cast peer vote was a rejection). Candidate: **354/354**, zero other regressions. `tsc --noEmit`: 0 errors both ways. By hand, re-derived against the existing `consensus.test.ts` weighted-consensus Raft cases (4-voter flat-parity and reject-prevention tests): `ceil` changes the reject-prevention test's internal timing (rejects after 2 peer votes instead of 3) but not its final `approved:false` assertion — no regression.

Independent adversarial critique (separate subagent, no authoring context): reproduced the bug and fix from scratch via its own stash/pop cycle, re-derived the quorum arithmetic by hand, and checked for a second stale quorum formula elsewhere in the package.

## Darwin Results

Skipped — binary quorum-rounding correctness fix, no continuous/categorical parameter for Darwin's real interface (`npx ruvector harness darwin <config> --execute`, confirmed available) to search over. Same skip class as nearly every accepted correctness fix since 2026-08-18.

## SOTA Proof & Witness

```
Session commit:   7c37957f55aa7509e9d4fbfeacc0c9dd1d8e2fda
Report SHA-256 (pre-witness, this block stripped back to PENDING): e5546f94791f414e36ec232148e0db4b59bdf6f45535bb92e51ec8d716ad1d4a
Witness stamp:    2337ae78dfd0b640135473f8fe73ca66c8f493108c6ff2ef185bdadb7c618af9
```
Verifier: fetch this file from the PR's branch, strip the Witness block's filled-in values back to `PENDING`, SHA-256 the file, concatenate with the session commit above, SHA-256 again — must equal the witness stamp.

## Recommended Next Steps

1. Apply the same `ceil`-vs-`floor` quorum check to `ByzantineConsensus`/`GossipConsensus` as a defensive audit — tonight's architecture review found their quorum formulas (`quorumSize()`'s `3f+1` derivation, gossip's float-ratio compare) don't degenerate the same way, but a dedicated future-night pass should confirm this holds for all configured thresholds, not just 0.66.
2. Convert `ByzantineConsensus.awaitConsensus()` and `GossipConsensus.awaitConsensus()` from `setInterval` polling to the event-driven pattern `RaftConsensus.awaitConsensus()` already uses (fixed #4215) — both already emit `'consensus.achieved'` on every accept/reject transition; nothing currently listens for it on these two paths.
3. Fix `UnifiedSwarmCoordinator.recoverAgent()` (heartbeat-timeout recovery path) to call `releaseDomainAgent()` like its three sibling terminal-transition paths (`handleTaskComplete`/`handleTaskFail`/`cancelTask`) already do — otherwise a domain task queue can stall indefinitely after a single agent crash-recovery.
