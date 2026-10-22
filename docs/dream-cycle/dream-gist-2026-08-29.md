# Swarm SOTA Report — 2026-08-29

TL;DR: Tonight's swarm deep-dive closed the #2 recommendation from 2026-08-24's own night: `TopologyManager.rebalanceHybrid()`'s worker-mesh connection loop (`v3/@claude-flow/swarm/src/topology-manager.ts:524-541`) adds edges one-directionally — `worker.connections.push(target.agentId)` and `adjacencyList.get(worker.agentId)?.add(target.agentId)` — with no reciprocal update on the target's side. This same function's worker-to-coordinator loop, 8 lines below, and all three sibling methods (`rebalanceMesh`, `rebalanceHierarchical`, `rebalanceCentralized`) correctly update both sides. The result: choosing `type: 'hybrid'` silently degrades the intended undirected worker mesh into a random directed graph, where `isConnected(A, B)` and `isConnected(B, A)` can disagree for the same logical edge. Confirmed still live tonight by direct code read (not assumed from the 08-24 report), fixed with a 6-line reciprocal-update patch, and covered by a new deterministic (not probabilistic) regression test. Fresh 2026 literature search found no academic work on this narrow bug class (stated explicitly, not forced), but did surface an active adjacent research area (LLM multi-agent topology adaptation) and a real primary-source competitor check: none of the four major multi-agent frameworks expose a raw, hand-maintained adjacency structure like Ruflo's, making this Ruflo-specific implementation-hygiene work rather than a field-wide gap to catch up on.

## What's New in 2026

| Finding | Source | Confidence |
|---|---|---|
| No academic literature found addressing adjacency-symmetry correctness bugs in distributed/multi-agent topology code specifically — searched 4 query variants, only control-theory results (Laplacian/Fiedler-eigenvalue consensus analysis) returned, none about implementation-level edge-reciprocity defects | Searched arXiv/general web, 2026-08-29; stated as a genuine negative result, not a forced citation | — |
| Active, adjacent 2025-2026 research area: adaptive/dynamic topology reconfiguration for LLM multi-agent systems (AMAS task-conditioned topology selection; Autonomous Topology Mutation proposing safety invariants for runtime restructuring; graph-diffusion-model topology generation) | arXiv:2510.01617, arXiv:2607.20488, arXiv:2510.07799 | A (papers exist, checked directly) |
| None of LangGraph, AutoGen/AG2, CrewAI, or the OpenAI Agents SDK expose a raw, user-manipulable undirected adjacency structure a maintainer must update symmetrically by hand — LangGraph/AG2 edges are directed routing constructs by design, CrewAI/OpenAI SDK expose no graph primitive at all | Official docs for all 4, fetched 2026-08-29 | A/B (see Competitor Comparison) |
| kyegomez/swarms's `MeshSwarm` builds no adjacency structure at all underneath its name — round-robin task queue only, confirmed by direct source read | github.com/kyegomez/swarms `swarming_architectures.py`, fetched 2026-08-29 | A (primary source) |
| A real analog of "graph-construction code silently produces an asymmetric result vs. the intended undirected structure" exists in a graph *library* (not an agent framework): PyTorch Geometric issue #3873 (`to_networkx`/`to_undirected` inconsistency), closed via PR #3948 | github.com/pyg-team/pytorch_geometric#3873 | B (real, verified, different domain) |

## Ruflo Current Capability

`TopologyManager` (`v3/@claude-flow/swarm/src/topology-manager.ts`) maintains an explicit dual representation of the swarm graph: `TopologyNode.connections: string[]` (per-node) plus `adjacencyList: Map<string, Set<string>>` (global). Four `rebalance*()` methods populate it per topology type. Traced end-to-end (full-file read, not grep) before writing any code:

- `rebalanceMesh()` (438-457), `rebalanceHierarchical()` (465-486), `rebalanceCentralized()` (491-511): every edge addition updates **both** endpoints' `connections` array and `adjacencyList` entry.
- `rebalanceHybrid()` (516-541, pre-fix): the worker-mesh loop (524-541) updates **only** the initiating worker's side. Its own worker-to-coordinator loop 8 lines below (`543-557`) — and the analogous logic in the other three methods — updates both sides correctly. This is the one inconsistent code path in the file.

Independently confirmed the bug is exploitable in practice, not merely theoretical: `createEdgesForNode()` (called from `addNode()`) sets `bidirectional: this.config.type === 'mesh'` — so for `'hybrid'` topology, even a node's *initial* connections from `calculateInitialConnections()` are one-directional too. This is a related instance of the same asymmetry class in a different function; **not fixed tonight** (kept out of scope to keep this patch one conceptual change — flagged below).

Practical consequence: any caller that reasons about a hybrid worker's neighbors from `getNeighbors(workerId)`/`isConnected(A, B)` (e.g. `UnifiedCoordinator`'s task/message routing) can get a different answer than the same query from the other endpoint — a real, if narrow, correctness gap in graph-dependent logic, not just a cosmetic edge-count discrepancy.

## Competitor Comparison

| Framework | Explicit peer-mesh/graph construct? | Bidirectional-edge handling |
|---|---|---|
| LangGraph (v1.1.3) | `StateGraph` nodes/edges | Edges are directed control-flow routing transitions by design — not an undirected adjacency structure, so the reciprocal-update failure mode doesn't apply the same way |
| AutoGen/AG2 | `GroupChat` graph-based speaker transitions | Directional by nature (who may speak next); same reasoning as LangGraph |
| CrewAI | None — `Crews`/`Flows` only | No exposed mesh/adjacency structure to become asymmetric |
| OpenAI Agents SDK | None — explicitly documented as having no graph topology to author; handoffs are peer-to-peer directed tool calls | N/A |
| kyegomez/swarms | `MeshSwarm` exists **by name only** — direct source read confirms zero adjacency-list/edge structure, just a round-robin queue | N/A — no real graph underneath the name |

**Verdict**: this is Ruflo-specific implementation hygiene, not a field-wide gap. Every framework surveyed either keeps topology internal to a directed-routing abstraction where one-directional-by-design is correct, or exposes no explicit graph/mesh primitive at all — none maintains a hand-updated symmetric `Map<string, Set<string>>` the way Ruflo's `TopologyManager` does. The one real-world analog found (PyTorch Geometric #3873) confirms the general defect *pattern* (code that's supposed to produce a symmetric structure silently doesn't) is a recognized, recurring class in graph-construction code generally — supporting this as a legitimate correctness bug worth fixing, not a false alarm, even though no directly comparable multi-agent-framework precedent exists to benchmark against.

## Ruview / Ruvector Integration Scan

Both surfaces were scanned in depth 5 nights ago (2026-08-24, issue #3085 §10-11: RuView confirmed a "solved-but-unpublished front-end with no verified live back-end" per ADR-326's own text; `@ruvector/tiny-dancer`/`@ruvector/router` confirmed permanent, self-documented non-integrations). Re-verified tonight rather than re-scanned from scratch (nothing material changed, stated explicitly rather than reproducing the same table):

- `product-plane.ts` and ADR-326 last touched 2026-08-12 — no changes since the 08-24 scan.
- `semantic-router.ts`'s in-code comment ("fallback implementation since @ruvector/router's native VectorDb has bugs") is unchanged, same file, same wording.
- One material change found: `@ruvector/router` bumped 0.1.15 → 0.1.30 on npm since 08-24 (`@ruvector/tiny-dancer` also present at 0.1.22). Whether the underlying `VectorDb` bug motivating Ruflo's fork-around was fixed upstream is not verified from this repo alone — out of scope tonight, flagged as a cheap follow-up (bump + smoke-test the native path) for a future automation/ruvector-integration night.

## Hypothesis

> Given `TopologyManager` configured with `type: 'hybrid'`, when `rebalanceHybrid()`'s worker-mesh loop is patched to mirror each edge onto the target node (`connections` array and `adjacencyList` entry, matching the pattern already used by the same function's coordinator loop and all three sibling `rebalance*()` methods), then every worker-mesh edge created by `rebalance()` should be symmetric (`isConnected(A, B) === isConnected(B, A)` for every such edge), subject to: (1) `'mesh'`/`'hierarchical'`/`'centralized'` rebalance paths are byte-identical to today's; (2) the worker-to-coordinator half of `rebalanceHybrid()` is unchanged; (3) existing topology test suite remains green; (4) $0 evaluation cost.

Frozen before evaluation began; not modified after seeing results.

## Benchmarks

Deterministic, $0, zero-LLM vitest addition to `v3/@claude-flow/swarm/__tests__/topology.test.ts` (1 new test). `Math.random()` is mocked to always return `0`, making candidate selection (`candidates[Math.floor(Math.random() * candidates.length)]`) fully deterministic — every worker always picks the lowest-index remaining candidate. With 5 workers added in insertion order (`agent-2`..`agent-6`, `targetConnections = min(3, 4) = 3`) and each worker's connections reset to `[]` via the public `updateNode()` API first (isolating `rebalanceHybrid()`'s own loop from `addNode()`'s separate, out-of-scope initial-connection asymmetry noted above), this reliably reproduces — hand-traced and verified by direct test execution, not sampled probabilistically — the asymmetric edge `agent-6 → agent-2` with no reciprocal `agent-2 → agent-6` under the pre-fix code, and both directions present post-fix.

No bespoke external benchmark corpus applies: this is a scoped, deterministic graph-construction correctness fix, not a tunable parameter. `metaharness darwin`/`ruvector harness darwin --help` confirmed (again) that the real interface evolves routing/topology/prompt/memory/tool/tier/context/coordination *genome parameters* against an LLM-scored bench corpus — no analog for "mirror an edge onto its target." Same class of skip as every dream-cycle night since 2026-08-14.

## Evaluation

**evaluated: accepted.** Real evaluator: `vitest run` (deterministic, $0, zero LLM calls) + `tsc --noEmit`.

Baseline captured via `git stash` on `topology-manager.ts` only (test file kept in place): the new test fails exactly as predicted — `expect(agent2.connections).toContain('agent-6')` fails with `agent2.connections = ['agent-3','agent-4','agent-5']` (no `agent-6`), while `agent6.connections` does contain `agent-2` (the one-directional edge). Candidate (post-fix): full `@claude-flow/swarm` package suite **221/221 passing** (220 pre-existing + 1 new), 0 regressions. `tsc --noEmit` from the package directory: 0 errors.

**Independent adversarial critic** (fresh session, no authoring context) independently re-read the full source (not the diff alone), re-ran `vitest run` and `tsc --noEmit` itself rather than trusting reported numbers, byte-diffed the live working tree against the reviewed diff file (identical — no other file silently touched), and reproduced the baseline-fails/candidate-passes property itself by reverting only the 10-line source fix (keeping the new test) and rerunning — exact predicted failure, then reapplied and reran the full suite back to 221/221. **Verdict: CONFIRMED.** Also independently hand-traced the algorithm before running anything and predicted the exact pre-fix failure output, matching the actual run. No reward-hacking signal (assertions precise, diff matches what was reviewed, discriminating test independently reproduced). Grepped all consumers of `TopologyManager` connection/adjacency state (`unified-coordinator.ts`, rest of `topology.test.ts`) — nothing assumes an exact connection-count cap; existing hybrid tests already use `toBeGreaterThanOrEqual`, so a node ending up with more than its own `targetConnections=3` via other workers' reciprocal picks (observed: `agent-2` ends with 4) is pre-existing soft-cap behavior identical to `rebalanceMesh()`, not a new regression. Security: pure in-memory bookkeeping, no new I/O or external input path, no concerns. Two caveats flagged, both disclosed rather than fixed here: (1) `createEdgesForNode()`'s parallel hybrid-mode asymmetry (see Ruflo Current Capability) is correctly out of scope, not silently missed; (2) the new test's real 5.1s throttle-bypass sleep is a pre-existing pattern in this file (matches `'should emit topology.rebalanced event'`), not a new flakiness class, but worth eventually replacing with fake timers. The critic also caught that this session's local `pnpm install` (run to make the test runner available) left unrelated lockfile drift in the working tree — reverted before commit, not part of this candidate.

## Darwin Results

Skipped — scope mismatch, confirmed via `npx ruvector harness darwin --help` (real interface evolves genome-shaped parameters against an LLM-scored bench corpus; no analog for a 6-line graph-symmetry fix). Same skip class as 6 of the last 7 dream-cycle nights (08-14 through 08-28).

## SOTA Proof & Witness

| Field | Value |
|---|---|
| Session commit | `d33ef4bf8ab27a8f9ef08352c9c293b53312a861` |
| Gist SHA-256 (pre-witness content, i.e. this file before this table was filled in) | `ba1ddf4029655f99d700c54c12401be167cd1a5e1784f47c8208b73e9e970f5f` |
| Witness stamp | `9c1e9cd46b0eaab7a9ec3d9c93d747f46a53c1a2f532303ccc81d1af7fd76f5e` |

Verifier procedure: fetch `docs/dream-cycle/dream-gist-2026-08-29.md` from the `dream/2026-08-29-swarm` branch, strip this table's `Gist SHA-256`/`Witness stamp` values back to the placeholder line, SHA-256 the result, concatenate with the session commit above, SHA-256 again — result must equal the witness stamp.

## Recommended Next Steps

1. **Merge this candidate** (human review required) — closes a real, code-verified, previously-flagged-and-deferred correctness bug with a minimal, deterministic-test-covered diff.
2. **Fix `createEdgesForNode()`'s parallel asymmetry for hybrid initial connections** (`bidirectional: this.config.type === 'mesh'`, line ~375) — same underlying bug class, different code path, confirmed live tonight but deliberately not bundled into this patch to keep it one conceptual change.
3. **Follow up on 08-24's #3 recommendation**: thread `ConsensusVote.confidence` into byzantine.ts's tally — CP-WBFT (AAAI 2026, Grade A) is a peer-reviewed reference pattern for exactly this, still open.
4. **Smoke-test `@ruvector/router`'s current version (0.1.30, up from 0.1.15 at last scan)** against the documented `VectorDb` bug motivating `semantic-router.ts`'s permanent fork-around — cheap, could retire a maintenance burden if fixed upstream.
5. **The 2026-08-20..23 no-run gap remains undiagnosed after 6 consecutive nights of re-confirmation** (08-24 through 08-29) — worth a dedicated `automation`/`meta` night rather than another passive re-check.
