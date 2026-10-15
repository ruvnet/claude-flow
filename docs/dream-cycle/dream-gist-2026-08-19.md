# Swarm SOTA Report — 2026-08-19

TL;DR: Tonight's swarm deep-dive fixed a genuine, previously-undetected correctness bug in `MessageBus.handleDeliveryError()`: the retry-attempt counter was silently discarded on every re-queue (`addToQueue()` always constructed a fresh entry with `attempts: 0`), so a permanently-failing subscriber callback retried forever instead of being bounded by `config.retryAttempts` — and the `message.failed` event that should signal "give up on this message" was unreachable. Independently reproduced by an adversarial critic: baseline showed 96-98 invocations in a 500ms window with zero `message.failed` events (unbounded); the one-line fix (thread the attempt count through the re-queue) brings it to exactly 3 invocations / 2 retries / 1 failure, stable thereafter. 220/220 tests passing (2 new, 0 regressions). This finding came from independent convergence of two research roles — a literature-grounded researcher (5 graded candidates) and a pure code-reading architecture reviewer — landing on real, code-verified bugs rather than speculative optimizations, which is the more valuable signal of the two tracks tonight.

## What's New in 2026

| Finding | Source | Confidence |
|---|---|---|
| No public multi-agent framework (LangGraph, AutoGen/AG2, CrewAI, OpenAI Agents SDK, Google ADK) ships a real BFT/Raft/voting consensus mechanism for agent coordination — Ruflo's `consensus/{byzantine,raft,gossip}.ts` is a genuine differentiator, not table stakes | Official docs for all 5 frameworks, cross-checked, fetched 2026-08-19 | B |
| Adaptive/churn-aware topology mutation is a field-wide gap across all major frameworks, but three independent research groups converged on invariant-gated safety machinery for it only in the last ~2 months | Sidik et al. "Autonomous Topology Mutation," arXiv:2607.20488 (Jun 2026); MANTA, arXiv:2607.28527; MACA, arXiv:2605.25746 (with code) | B (trend, 3 groups) / C (individual numbers) |
| Power-of-two-choices load balancing is proven at the LLM-serving/replica-routing layer (agentgateway, DualMap arXiv:2602.06502) but nobody has published it applied to agent-mesh peer selection specifically — Ruflo's 2026-08-14 rejected experiment is a genuinely novel data point, not a rediscovery | agentgateway docs; DualMap arXiv:2602.06502 (2026) | B (serving layer) / — (no prior art either way at mesh layer) |
| Queue-aware/load-aware agent-pool selection significantly outperforms naive/round-robin assignment under both formal MDP analysis and applied LLM-orchestration benchmarks | Dai, Deng, Li, Peng, arXiv:2504.07347v3 (formal stability proofs); INFRAMIND arXiv:2606.11440 (Jun 2026, +7.6pp accuracy / 7x lower latency claim) | B (formal) / C (applied numbers) |
| Reputation/stake-weighted voting is production-proven (PoS-style consensus) but Ruflo's own `weightedConsensus()` computes agent trust weights and then silently discards them — every `raft`/`byzantine`/`gossip` implementation tallies flat one-node-one-vote regardless | Production PoS precedent (A) + direct code read: `queen-coordinator.ts:1809-1828` vs `consensus/raft.ts:454-483` (grep confirms zero "weight" occurrences in `consensus/`) | A (precedent) / A (code-verified bug) |

## Ruflo Current Capability

`v3/@claude-flow/swarm/src/message-bus.ts`'s `MessageBus` is a priority-queue-backed, O(1) deque pub/sub system targeting 1000+ msg/sec. Retry-on-failure was designed (a `config.retryAttempts` field, an `attempts` counter per queue entry, a `message.retry`/`message.failed` event pair) but `handleDeliveryError()`'s re-queue call went through `addToQueue()`, which always initialized a fresh entry at `attempts: 0` — so the retry bound was structurally a no-op. This is the kind of bug that's easy to miss by reading either half of the two functions in isolation; it surfaced from a full-file architecture read specifically looking for silent policy no-ops.

Separately (not fixed tonight, scope-boundary), the same repo has two other known-but-unaddressed swarm gaps confirmed this session: `TopologyManager.rebalanceHybrid()`'s worker-mesh connection step at `topology-manager.ts:536-539` only updates one side of the adjacency edge (asymmetric graph, confirmed distinct from the already-rejected 2026-08-14 mesh peer-selection patch), and `QueenCoordinator.weightedConsensus()` computes real trust weights that never reach the actual vote tally in any consensus implementation.

## Competitor Comparison

| Framework | Explicit topology config? | Consensus mechanism? | Adaptive re-topology under churn? |
|---|---|---|---|
| LangGraph (v1.0) | Hand-wired graph shapes, no topology enum | None built-in (debate = LLM-judges-LLM) | None |
| AutoGen/AG2 (Network model) | Fixed hub-and-spoke | "Reach consensus" = unstructured dialogue, not a protocol | None |
| CrewAI | One named `hierarchical` mode only | None — unilateral manager decision | None; documented production failure mode (sequential-not-conditional execution, single-source) |
| OpenAI Agents SDK | Two hand-authored patterns (handoffs / agents-as-tools) | None | None |
| Google ADK | Sequential/Parallel/Loop + LLM supervisor | "Programmable," not implemented | Design-time composability only, not runtime |
| Swarms (kyegomez) | Most topology-explicit of any surveyed (`HierarchicalSwarm`, graph networks) | None in main orchestration repo (PSO/ACO live in a decoupled `swarms-pytorch` library) | Not documented |

Ruflo ships real Byzantine/Raft/gossip consensus and 4 named topologies where every surveyed competitor has none or a single fixed shape — genuinely ahead here, not behind, though (per the findings above) some of Ruflo's own topology/consensus machinery is itself only partially wired (dead `getNeighbors()`/`findOptimalPath()` callers, the `weightedConsensus()` no-op).

## Hypothesis

> Given a Ruflo `MessageBus` with a subscriber whose callback synchronously throws on every invocation, when `addToQueue()`'s re-queue path preserves the failed entry's `attempts` count (instead of resetting it to 0 on every re-queue), then the number of delivery attempts for that message should be bounded by `config.retryAttempts` and a `message.failed` event should fire exactly once, relative to the current unbounded-retry baseline, subject to: (1) delivery behavior for non-throwing subscribers is completely unchanged; (2) existing test suite remains green; (3) zero LLM/API cost.

Frozen before evaluation began; not modified after seeing results.

## Benchmarks

New deterministic, $0, zero-LLM test: `v3/@claude-flow/swarm/__tests__/message-bus.test.ts`. Two cases: (1) a subscriber whose callback always throws, `retryAttempts: 3`, measuring callback-invocation count and `message.retry`/`message.failed` event counts over a 500ms window plus a further 300ms stability check; (2) a healthy subscriber, confirming exactly one delivery with no retry/failed events (regression guard for the fresh-message path).

## Evaluation

**evaluated: accepted.** Baseline (pre-fix, via `git stash`): 96-98 callback invocations in 500ms, 0 `message.failed` events — reproduced independently twice (once by the authoring session at 98, once by the adversarial critic at 96; the critic's fuller trace showed `callbackInvocations === retryEvents` exactly, i.e. every single attempt retried and none ever reached the failure branch — the strongest possible confirmation of the bug mechanism). Candidate (post-fix): exactly 3 invocations, 2 retries, 1 failure, stable across a further 300ms. Full package suite: 220/220 passing (218 pre-existing + 2 new, 0 regressions), independently re-run by the critic. `tsc --noEmit` shows pre-existing environmental errors (missing `@types/node`/tsconfig lib config) identical with or without this diff (confirmed via `git stash`) — not attributable to this candidate.

## Darwin Results

Skipped — scope mismatch. This is a deterministic correctness fix (thread an existing integer through one re-queue call) with no continuous/categorical parameter space; `@metaharness/darwin`'s real interface (`darwin <config.json> --execute`) evolves scoped tunable parameters against a benchmark, which doesn't apply here. Same class of skip as 4 of the last 5 dream-cycle nights.

## SOTA Proof & Witness

| Field | Value |
|---|---|
| Session commit | `44b67bccdd23a99482aa093fbc52a0516bca7257` |
| Gist SHA-256 | `5e61580eb87fe98f7a489e55eb1fa6dc6493dc78ebd7759b8d8aedb77b15fca9` |
| Witness stamp | `62c4fdf7750c8bda9cb3101a732fbe1ea39ca56cbd484a972ce5d8cb126ef052` |

Verifier procedure: fetch `docs/dream-cycle/dream-gist-2026-08-19.md` from this branch, SHA-256 it, concatenate with the session commit above, SHA-256 again — result must equal the witness stamp.

## Recommended Next Steps

1. **Fix the disclosed broadcast-retry gap**: `handleDeliveryError()`'s re-queue for a broadcast message uses the literal string `'broadcast'` as the queue key (since `message.to` stays `'broadcast'` on the message object) instead of the actual per-subscriber agentId `enqueue()` fanned out to — a failing broadcast subscriber's retries silently vanish into an undrained queue. Confirmed pre-existing (present in commit `1d365d4`, 2026-08-11, well before tonight), not introduced or worsened by tonight's fix, but was previously completely undisclosed — now flagged in-code and here. Good candidate for a focused future-night fix.
2. **Fix `TopologyManager.rebalanceHybrid()`'s one-directional adjacency bug** (`topology-manager.ts:536-539`) — confirmed via independent code review this session, distinct from the already-evaluated-and-rejected 2026-08-14 mesh peer-selection patch. Testable via the same symmetry-invariant harness style (`isConnected(a,b) === isConnected(b,a)` for all pairs) that presumably caught the density regression in that earlier PR.
3. **Thread `QueenCoordinator.weightedConsensus()`'s trust weights into the actual vote tally** in `raft.ts`/`byzantine.ts`/`gossip.ts` (currently silently discarded, flat majority regardless) — scored 4.65/5 by tonight's research (tied for top with the load-aware `AgentPool.acquire()` candidate), backed by A-grade precedent (production PoS-style weighted voting) and a clean deterministic before/after test design already sketched by the researcher. Recommended as the very next swarm-surface implementation night, ahead of the load-aware-pool candidate, since it's the more self-contained single-conceptual bug fix of the two.
