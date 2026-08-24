# Swarm SOTA Report — 2026-08-24

TL;DR: Tonight's swarm deep-dive closed the top-recommended lead from the 2026-08-19 cycle: `QueenCoordinator.weightedConsensus()` has always computed real per-agent trust weights (`successRate * health`), but the weight computation was architecturally unreachable — `ConsensusProposal`/`ConsensusConfig` had no field to carry a weight, and `raft.ts`/`byzantine.ts`/`gossip.ts` all tallied votes as a flat one-node-one-vote count. Choosing `requiredConsensus: 'weighted'` on a decision produced byte-identical behavior to `'majority'`. Three independent 2025-2026 papers (CP-WBFT/AAAI, DySCo, DynaTrust) converge on trust-weighted tallying as the same real gap class in LLM multi-agent consensus, and a fresh competitor sweep confirms none of LangGraph/AG2/CrewAI/OpenAI Agents SDK ship it either (a maintainer of a different project, hermes-agent, has an open unimplemented issue requesting almost exactly this). Fix: thread weights through `propose()`/`vote()` into each implementation's tally logic, clamped to [0,1] per voter in all three (defaulting to weight 1 — byte-identical to today) when no weights are supplied. 226/226 tests passing (223 pre-existing incl. 1 updated to match real behavior, ~16 new cases across gossip/byzantine/raft), 0 regressions, independently adversarially reviewed with a CONFIRMED-WITH-CAVEATS verdict (caveats disclosed below, none blocking).

## What's New in 2026

| Finding | Source | Confidence |
|---|---|---|
| CP-WBFT: confidence-probe-based weighted BFT beats flat majority under extreme Byzantine fault rates (85.7%) for LLM multi-agent systems | arXiv:2511.10400 / AAAI, Nov 2025 | B |
| DySCo: trust-weighted vote aggregation over a dynamically pruned communication graph, early-terminates once consensus stabilizes | arXiv:2606.01828, Jun 2026 | B |
| DynaTrust: dynamic trust graph isolates compromised nodes for weighted consensus, +41.7pp over static-blocking baseline | arXiv:2603.15661, Mar 2026 | B |
| InfraMind: queue/cache/latency-aware multi-agent scheduling beats naive assignment, +7.6pp accuracy / 7x lower latency / 99.9% vs <50% SLO compliance | arXiv:2606.11440, Jun 2026 | B |
| No major public framework (LangGraph, AG2, CrewAI, OpenAI Agents SDK) ships weighted/reputation consensus, churn-aware topology mutation, or queue-aware pooling as a first-party feature; a real open feature request for weighted voting exists in a different project (hermes-agent#412) and remains unimplemented | Official docs for all 4 frameworks + github.com/NousResearch/hermes-agent/issues/412, checked 2026-08-24 | B |

## Ruflo Current Capability

`v3/@claude-flow/swarm/src/queen-coordinator.ts:1809` computes real per-agent weights but passed them only inside the opaque `value` blob given to `proposeConsensus()`. Traced end-to-end: `unified-coordinator.ts:482` → `consensus/index.ts:172` → each implementation's `propose(value)` — none extracted `.weights`; `types.ts`'s `ConsensusProposal`/`ConsensusConfig` had no field for it. `raft.ts:447-488`, `byzantine.ts:230-254`+`458-475`, `gossip.ts:499-543` all tallied `Array.from(proposal.votes.values()).filter(v => v.approve).length` — a flat count. Independently confirmed by a dedicated architecture-review pass (full-file reads, not grep) with exact line numbers before any code was written.

Two related no-ops surfaced by the same review, not fixed tonight (flagged as follow-ups below): `ConsensusVote.confidence` is computed on every vote cast but never read by any tally logic; `TopologyManager.rebalanceHybrid()`'s worker-mesh connection loop (`topology-manager.ts:530-540`) updates only one endpoint of each edge, producing an asymmetric adjacency graph. The message-bus broadcast-retry gap flagged 2026-08-19 remains open too (still an explicit in-code disclosed limitation).

## Competitor Comparison

| Framework | Weighted/reputation consensus? | Adaptive (churn-aware) topology? | Queue-aware pooling? |
|---|---|---|---|
| LangGraph (v1.1.3) | None — no voting primitive at all; a third-party bolt-on (OACP) adds it | None — checkpointing resumes the same static graph, doesn't rewire it | None (infra scaling only, not an API) |
| AutoGen / AG2 | None — 4 flat speaker-selection modes, no weight/reputation field | None — `AgentEligibilityPolicy` filters candidates, doesn't restructure on failure | None |
| CrewAI | None — exactly `sequential`/`hierarchical`, no voting mode | None — fixed manager→worker star | None documented |
| OpenAI Agents SDK | None — handoffs/agents-as-tools only | `Handoff.is_enabled` toggles one edge at runtime (caller-defined), not automatic | None |
| kyegomez/swarms (near-miss) | `MajorityVoting` is flat (grepped source, zero weight/reputation hits) | `HierarchicalSwarm` does LLM-directed failure reassignment inside a static star — closest real precedent found | None (queue import is a thread-sync primitive, not a scheduler) |

Ruflo is positioned ahead of all four majors here if this lands — genuine differentiation, not table stakes. The field-wide absence looks like a deliberately-avoided complexity trade for weighted consensus (persistent cross-call trust state + audit story is a second layer of non-determinism most frameworks' request-scoped execution models don't fit) and a genuinely-unsolved problem for adaptive topology (live graph rewriting breaks the deterministic-replay guarantee LangGraph's whole value prop depends on) and queue-aware pooling (nobody's unified the model-serving-layer scheduling work with the agent-framework layer yet).

## Hypothesis

> Given a Ruflo consensus proposal (raft/byzantine/gossip) where per-agent trust weights are computed by `QueenCoordinator.weightedConsensus()` but structurally cannot reach the vote tally, when weights are threaded through `ConsensusEngine.propose()`/`vote()` into each implementation's tally logic (weighted approval sum vs quorum, clamped to [0,1] per voter, defaulting to weight 1 when absent), then a proposal with a high-trust minority and low-trust majority should be approved under weighted tallying where flat tallying rejects it, subject to: (1) default (no weights) behavior is byte-identical to today's flat-count behavior; (2) existing consensus test suite remains green; (3) zero LLM/API cost.

Frozen before evaluation began; not modified after seeing results.

## Benchmarks

Deterministic, $0, zero-LLM vitest additions to `v3/@claude-flow/swarm/__tests__/consensus.test.ts` (~16 new test cases) and one updated pre-existing assertion in `__tests__/queen-coordinator.test.ts` (was checking only the now-superseded embedded-weights field). Gossip: a 4-voter ratio-based flip scenario (weights `{proposer:0.05, voter-a:0.9, voter-b:0.05, voter-c:0.05}`, 2/4 approve) — an actual accept-flip. Byzantine: a [0,1]-clamp safety test (weight=5 must not satisfy a 2f+1 quorum alone) plus a flat-quorum regression guard. Raft: a default-weights regression guard, plus a reject-*prevention* test added after adversarial review (see Evaluation) — raft's absolute-count quorum (`floor(totalVoters * threshold)`) means clamped weights ([0,1]) can never make an accept *easier* than flat counting, only a reject *harder* (denying a low-trust majority enough weighted mass to cross the reject threshold); the test proves this via timing (flat resolves via explicit reject in <200ms, weighted only resolves via the 300ms timeout/expiry path, never rejecting outright). No bespoke external benchmark script needed — Darwin's real interface (`metaharness-darwin evolve <repo> --bench <suite.json>`, confirmed via its own `--help`) evolves LLM-scored harness/prompt genomes, no analog for a scoped TS tally-logic change; skipped for scope mismatch, same class as 4 of the last 5 dream-cycle nights.

## Evaluation

**evaluated: accepted.** Baseline (pre-fix, via `git stash` on `src/` only, tests kept): the gossip flip test fails exactly as predicted — `result.approved` is `false` instead of `true` (flat 2/4=0.50 < 0.51 threshold rejects regardless of weight). All other new tests pass on baseline too, since they don't depend on the fix — confirming they're not spuriously fix-dependent. Candidate (post-fix): full package suite 226/226 (223 pre-existing incl. 1 updated + ~16 new), 0 regressions, `tsc --noEmit` clean.

**Independent adversarial critic (fresh session, no authoring context)** re-ran the suite/typecheck itself rather than trusting these numbers, traced the diff end-to-end across all 7 modified `src/` files, and returned **CONFIRMED-WITH-CAVEATS**:
- Byte-identical default behavior verified sound (weight-1 float sum is exactly representable, no rounding divergence).
- [0,1] clamp verified applied at every read site in all three implementations, including self-votes; the BFT safety argument (an unclamped weight >1 could let one node satisfy quorum alone) verified sound with a concrete example.
- No caller outside this package breaks (grepped `.propose(`/`proposeConsensus(` across `v3/`; only unrelated same-named methods on other classes exist).
- No reward-hacking signal — diff is purely additive in both test files, no weakened assertion, no tuned threshold.
- **Caveat 1 (addressed during review):** the critic found raft had no weighted-*flip* test, only a default-parity one. Added the reject-prevention test above in response — it's the correct shape for raft's design (see Benchmarks), not a flip-to-accept, since flip-to-accept is mathematically impossible there with weights ≤1.
- **Caveat 2 (disclosed, not fixed tonight):** `byzantine.ts`'s `handleCommit()` PBFT protocol-message quorum (`byzantine.ts:388-413`, pre-existing, untouched by this diff) is a second, fully separate acceptance path independent of the weighted `vote()` API — dead in today's unit tests (no transport wired) but would bypass weighting entirely if a deployment wires real multi-node PBFT transport traffic. "Weighted Byzantine consensus" governs the `vote()` API only.
- **Caveat 3 (disclosed, not a blocker):** the `weights?: Map<string, number>` parameter on `proposeConsensus`/`propose()` is now a live lever over consensus outcomes (previously inert even if misused). Today's only caller (`weightedConsensus()`) computes it from internal agent metrics, not external input — no untrusted path exists — but it's worth a guarding comment as the API surface grows.

## Darwin Results

Skipped — scope mismatch, confirmed via `metaharness-darwin --help`: real interface evolves routing/topology/prompt/memory/tool/tier/context/coordination genome parameters against an LLM-scored bench corpus (`bench create`/`bench verify`), no analog for threading an existing `Map<string,number>` through 3 TS tally implementations. Same class of skip as 4 of the last 5 nights.

## SOTA Proof & Witness

| Field | Value |
|---|---|
| Session commit | `3c99b1c84a25948c42a163253bac6effed5fbbbb` |
| Gist SHA-256 | `3c78f04ec85ed3082890e2c0766f2bdc4cc9e79944fffec80ee657039df4868d` |
| Witness stamp | `08d44c5834699e90f8020ab14b6b177b625c465ace4d5616dd732715dcc24412` |

Verifier procedure: fetch `docs/dream-cycle/dream-gist-2026-08-24.md` from this branch, SHA-256 it, concatenate with the session commit above, SHA-256 again — result must equal the witness stamp.

## Recommended Next Steps

1. **Thread `ConsensusVote.confidence` into tally logic too** (`types.ts:219-225`, computed on every vote across all 3 implementations, never read) — a per-vote confidence signal complementary to per-agent trust weight, matching CP-WBFT's confidence-probe mechanism. Mechanism-only until a real caller populates it with something other than a hardcoded `1.0`/`0.9`; don't overstate near-term production value if implemented before that wiring exists.
2. **Fix `TopologyManager.rebalanceHybrid()`'s one-directional adjacency bug** (`topology-manager.ts:530-540`) — confirmed still live, distinct from the already-rejected 2026-08-14 mesh peer-selection patch. Trivial fix (~6-10 lines, mirror the correctly-symmetric code two blocks away in the same function), cleanest patch-size-to-value ratio of the open swarm leads.
3. **Explore InfraMind-inspired queue-depth-aware task assignment** — `UnifiedCoordinator.scoreAgentForTask()` (`unified-coordinator.ts:787-819`) only reads self-reported `agent.workload`, never real `MessageBus` backlog. Real gap, fresh (Jun 2026) supporting research, but needs a per-agent queue-depth getter (`message-bus.ts` currently only exposes an aggregate) before a same-night deterministic test is feasible — scope a future night around building that getter first.
