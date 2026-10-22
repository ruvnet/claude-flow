# Swarm SOTA Report — 2026-09-19

**TL;DR**: `TopologyManager.createEdgesForNode()` (`v3/@claude-flow/swarm/src/topology-manager.ts`) only mirrored a new node's edge back onto its connection target when `config.type === 'mesh'`. For hierarchical, centralized, and hybrid topologies — hierarchical being Ruflo's own CLAUDE.md-stated **preferred default** for coding swarms — a worker's initial connection to the queen/coordinator was never mirrored back, and `shouldRebalance()`/each `rebalance*()`'s "connect worker to leader" guard both fail to repair it (the guards check the *worker's* already-populated connection list, not the leader's). Net effect in current `main`: the queen/coordinator's own `node.connections`/`adjacencyList` entry is **permanently missing every worker** in steady-state operation, regardless of how many join — `getNeighbors(queenId)`/`findOptimalPath(queenId, *)` (which read that state) are always empty. Fixed by mirroring the edge whenever the connection target already exists in the topology, matching what `mesh` already does. **Independent adversarial critique, disclosed caveat**: this repairs the coordinator's internal ground-truth state correctly and it's live on the real `spawnAgent()` → MCP path, but no shipped code currently *calls* `getNeighbors()`/`findOptimalPath()` outside tests, and a separate, pre-existing type-drift bug in `swarm-tools.ts`'s `getStatus()`/`AgentState.connections` means the repaired data doesn't yet surface through any MCP status field either — so today's user-visible impact is smaller than the headline symptom suggests, though the state being repaired is real and is the coordinator's source of truth for any future consumer.

## What's New in 2026

| Finding | Source | Confidence |
|---|---|---|
| NeurIPS 2025 "Heterogeneous Swarms": multi-LLM DAGs with topological message passing, jointly optimizing roles+weights | neurips.cc/virtual/2025/poster/115041 | A |
| NeurIPS 2025 "Multi-Agent Collaboration via Evolving Orchestration": RL-trained orchestrator dynamically resequencing agents (vs. Ruflo's static domain-priority table) | neurips.cc/virtual/2025/poster/118584 | A |
| SWIM gossip protocol (Cornell/IEEE DSN) — canonical reference for bounded-probe-group membership convergence, contrasted against Ruflo's unconditional 50%-coinflip `GossipConsensus.addNode()` (candidate E below) | cs.cornell.edu/projects/Quicksilver/public_pdfs/SWIM.pdf | A |
| `@ruvector/router` native `VectorDb` deadlock (upstream issue #133, fixed in 0.1.27) — Ruflo already pins `^0.1.30` (fix included) but still runs the JS fallback from a now-stale assumption; empirically re-verified no-deadlock tonight | github.com ruvnet/RuVector issue #133, commit 572e893 | A (directly reproduced) |
| Mainstream frameworks (LangGraph/AutoGen/CrewAI/OpenAI Agents SDK) converge on single-controller orchestration + checkpointing, explicitly *not* consensus — LangGraph's own docs call mesh/consensus "chaos" for most teams | vendor docs, cross-checked (see Competitor Comparison) | B |

## Ruflo Current Capability

Swarm coordination has two layers: the canonical `UnifiedSwarmCoordinator` (topology + message bus + pluggable Raft/Byzantine/Gossip consensus + domain-keyed agent pools) and a deprecated `coordination/` compatibility facade. All three consensus algorithms got per-voter weight plumbing in the 2026-08-24 dream cycle (clamped `[0,1]`). `FederationHub` handles cross-swarm ephemeral agents. Tonight's fix touches `TopologyManager`, which every topology type shares; `hierarchical` is reachable live via `unified-coordinator.ts:328` (`topologyManager.addNode()`) → `v3/mcp/tools/swarm-tools.ts`'s MCP surface.

## Competitor Comparison

| Competitor | Topology/liveness mechanism | Consensus | Grade |
|---|---|---|---|
| LangGraph | Explicit graph + checkpoint/replay recovery, no peer-gossip liveness | None — deterministic graph execution | B |
| AutoGen (now maintenance-mode; successor Microsoft Agent Framework) | Conversational GroupChat turn-taking, host-managed | None — emergent from conversation | B |
| CrewAI | Hierarchical/sequential process; reported manager-delegation bugs (crewAIInc/crewai#2838, community #7010) — same *kind* of silent task-never-reaches-worker failure as tonight's bug, different codebase | None | B/C |
| OpenAI Agents SDK | Manager-as-tools or one-way handoffs, host-managed | None | B |
| DecentLLMs/SAC/CP-WBFT/DySCo (2025-26 preprints) | Byzantine/weighted-vote consensus for LLM swarms | Real, but **not shipped in any mainstream SDK** | C |

**Why "None" for consensus across every shipping competitor**: not an oversight — vendors deliberately trade consensus for traceability/cost (LangGraph explicitly argues mesh is "chaos" for most teams) and push reliability into checkpointing instead. Ruflo's Raft/BFT/Gossip stack is ahead of any shipping competitor here; the gap is in *correctness of what's already built*, which is what tonight's fix and Candidates A/B/C/E (below) target — a genuine differentiation opportunity, not parity work.

## Hypothesis

> Given `TopologyManager.addNode()` on a hierarchical/centralized/hybrid topology, when `createEdgesForNode()` is changed to mirror an edge onto its connection target whenever that target already exists in the topology (not gated on `type === 'mesh'` alone), then `getNeighbors(leaderId)`/`findOptimalPath(leaderId, workerId)` should correctly include/reach every worker immediately after `addNode()`, relative to baseline where both are always empty for non-mesh topologies regardless of join count, subject to: (1) mesh's existing correct behavior unchanged; (2) all existing `topology.test.ts` tests remain green; (3) $0, deterministic, zero LLM calls.

Frozen before evaluation; not modified after seeing results.

## Benchmarks / Evaluation

**evaluated: accepted (ACCEPT-scoped — see disclosed caveat).** Real evaluator: Vitest 4.1.8, `tsc --noEmit`, zero LLM calls, $0. 3 new discriminating regression tests added (hierarchical/centralized/hybrid), each asserting the leader's `connections` contains the newly-joined node and `getNeighbors(leaderId)` is non-empty — the two existing tests that were supposed to check this (`topology.test.ts:326`, `:449`) asserted `connections.length >= 0`, a tautology that can never fail, which is why this bug was never caught.

Baseline (`git stash` on `src/topology-manager.ts` only, test file kept): **3/3 new tests fail** exactly as predicted (`expected [] to include 'agent-2'`), 47/50 other tests in the file unaffected. Candidate: full package suite **233/233 passing** (was 230/230 before tonight's 3 additions), independently re-run twice by the adversarial critic with identical results (deterministic, no flakiness). `tsc --noEmit`: 0 errors. No other file in `v3/` references `TopologyManager`/`createEdgesForNode` outside the swarm package's own tests, confirming scoped blast radius.

**Independent adversarial critique** (separate subagent, no authoring context, independently reproduced the stash-isolated baseline/candidate result and the full 233/233 suite itself): **CONFIRMED**, with one disclosed caveat — traced every real call site and found no shipped code currently invokes `getNeighbors()`/`findOptimalPath()` outside tests, and `swarm-tools.ts`'s MCP `getStatus()` surface has a separate, pre-existing type-drift bug (`AgentState.connections` is hardcoded `[]` at agent creation, never synced from `topologyManager`'s node state) that this fix doesn't touch. So the repaired state (`node.connections`/`adjacencyList`/`state.edges`) is real, correct, and live on the production `spawnAgent()` path, but nothing downstream reads it yet today — a real fix to the coordinator's ground truth, not yet a user-visible behavior change. Flagging `swarm-tools.ts`'s `getStatus()` type-drift as a separate, out-of-scope follow-up candidate for a future night.

## Darwin Results

Confirmed real interface: `npx ruvector@0.3.1 harness darwin <config> --execute`. Skipped — binary correctness fix (an edge is mirrored or it isn't), no continuous/categorical fitness-gradient parameter. Same class as most recent swarm-surface nights.

## Flywheel Evidence

Confirmed real interface: `npx ruvector@0.3.1 harness flywheel {verify|gate}` — targets signed LLM-scored replay bundles, not deterministic code fixes; none exists for this candidate. Evidence retained as: 3 new tests, this gist, the linked issue, stash-isolated baseline/candidate comparison, independent adversarial critique.

## Reward Hack Check

No standalone reward-hack CLI reachable (`npx metaharness --help` lists no such subcommand; `@metaharness/weight-eft` loaded per `harness doctor` but has no exposed CLI entry point this session could reach). Manual checklist: no existing assertion weakened (3 new tests, purely additive); no gold data touched (none exists on this path); no cherry-picking (full 233/233 suite reported, not just the new file); no seed manipulation; zero cost; independently re-verified by an adversarial-critic subagent with no authoring context.

## Security Review

Not security-sensitive: pure in-process adjacency-list/array bookkeeping, no new I/O/network/credential/filesystem surface, no change to any trust boundary.

## SOTA Proof & Witness

| Field | Value |
|---|---|
| Session commit | `e558f0c0fc29c1a658085f6e6f80ad27d4fe811f` |
| Gist SHA-256 (pre-witness content) | `590aacd6ef2eed0ee1d6e1b5e71d8e25cef417ef47ed966965bd3cfde40574a1` |
| Witness stamp | `2cd2ea40350f3c7c2c1e75f384cacee29ab7cd3d7af42c162c2a69a345c1b84d` |

Verifier procedure: fetch this gist, strip the witness table's filled values back to `PENDING`, SHA-256 the result, concatenate with the session commit above, SHA-256 again — result must equal the witness stamp.

## Scan Findings: ruview-integration

No material change since 2026-08-24/08-29. `v3/@claude-flow/security/src/policy/product-plane.ts` (ADR-326's `ProductActionEnvelopeV1`/`RuViewSemanticObservationV1` schema+validator) remains a well-tested, fully unwired policy layer: zero runtime callers, no CLI command, no MCP tool, no live network client to any RuView service. ADR-325/326 prose unchanged. Trigger to watch: any commit wiring `product-plane.ts`'s validators into a real network client/CLI/MCP tool.

## Scan Findings: ruvector-integration

`@ruvector/router` — Ruflo's `^0.1.30` pin *is* npm's current published version (nothing to bump there). The native `VectorDb` deadlock that motivated `semantic-router.ts`'s JS fallback (upstream issue #133) was fixed in 0.1.27 (2026-01-24) — grade **A**, directly reproduced tonight via a 10-call insert loop against the actual native `0.1.30` binary with no deadlock. `@ruvector/tiny-dancer` unchanged, still a non-default optional backend. Concrete follow-up (not done tonight — separate scope from the swarm candidate): run Ruflo's own router test suite against the native path, then update `semantic-router.ts:5`'s stale comment and file a tracking issue for a feature-flagged switch to native `VectorDb`.

## Competitors Reviewed

LangGraph, AutoGen/Microsoft Agent Framework, CrewAI, OpenAI Agents SDK, DecentLLMs/SAC/CP-WBFT/DySCo/DynaTrust (academic); Qdrant/Weaviate/Milvus-class vector DBs referenced only for the ruvector-integration scan's native-vs-fallback context, not swarm-specific.

## Additional candidates surfaced but not selected tonight (STEP 3.2)

Scored under `0.25·Ruflo_fit + 0.20·testability + 0.20·measurability + 0.15·production_value + 0.10·novelty + 0.10·reviewability`. Selected candidate (leader-adjacency mirroring) scored **5.0** — re-scored higher than the deep researcher's own top pick once the guard-check root cause (not just "rebalance never triggers") was independently verified.

1. **[4.85] FederationHub.terminateAgent() non-idempotent** — double-counts `completedAgents`/`totalAgentLifespanMs` stats on repeat/late calls (e.g. `unregisterSwarm()` calling `terminateAgent()` on already-self-terminated ephemeral agents). Strong second choice, independent blast radius from tonight's fix.
2. **[4.70] UnifiedSwarmCoordinator.spawnAgent()'s auto-domain branch never calls `pool.add()`** — agents spawned via `{type}` alone (not `{agentNumber}`/`{domain}`) are visible in `listAgents()` but structurally unreachable for `assignTaskToDomain()`-routed work.
3. **[4.20] TaskOrchestrator.getQueuePosition() uses stale priority keys** (`normal`/`background` instead of `medium`) — observability-only, deprecated call path.
4. **[3.95] GossipConsensus.addNode() 50%-coinflip neighbor link** — no minimum-connectivity guarantee; small clusters can end up with zero-degree nodes, silently expiring all consensus proposals touching them.
5. **[3.50] Byzantine PBFT commit-quorum bypasses per-voter weighting** when a real transport is wired — already self-disclosed in-code from 2026-08-24, confirmed still open, needs wire-protocol changes (60-120 lines, medium risk) — deferred as genuinely larger scope.

## Recommended Next Steps

1. **Merge tonight's linked draft PR** (human review required).
2. **Fix Candidate A** (`FederationHub.terminateAgent()` idempotency) — trivial, isolated, highest-scored remaining candidate.
3. **Fix Candidate B** (`spawnAgent()` domain-pool gap) — real functional break in the documented agentic-flow-compatible spawn API.
4. **ruvector-integration follow-up**: run the existing router test suite against native `@ruvector/router` `VectorDb`, then correct `semantic-router.ts:5`'s stale bug comment.
5. **Candidate D** (Byzantine PBFT weighted-commit bypass) needs a dedicated night — real protocol-design work, not a quick fix.
6. **New tonight (adversarial critic finding)**: wire `swarm-tools.ts`'s MCP `getStatus()`/`AgentState.connections` (currently hardcoded `[]`, never synced from `TopologyManager`) so tonight's repaired queen/coordinator adjacency actually surfaces to MCP consumers — without this, the fix is correct internally but invisible externally.
