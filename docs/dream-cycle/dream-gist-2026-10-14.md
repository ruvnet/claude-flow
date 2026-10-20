# Swarm Coordination SOTA Report — 2026-10-14

TL;DR: Tonight's 2026 deep-dive on Ruflo's `@claude-flow/swarm` package resolves a direct factual contradiction between two prior Dream Cycle nights (10-09 vs 10-10) about whether the real `ruvector` package exports usable graph-analysis functions — it does, under different names than the dead detection code checks for — and ships a small, discriminating fix for `TaskOrchestrator.getQueuePosition()`'s priority-map key mismatch, which silently misranks every default-priority ('medium') task behind even 'low'-priority ones in the emitted `taskQueuedEvent` position.

## What's New in 2026

| Finding | Source | Confidence |
|---|---|---|
| ProtocolBench: benchmarks LLM multi-agent communication protocols on task success/latency/overhead/failure-robustness | Zheng et al., ICML 2026 / PMLR v306 | A |
| MS Agent Framework (AutoGen successor, GA ~Apr 2026) checkpoints per-superstep, explicitly at-least-once; no raft/byzantine/gossip layer | learn.microsoft.com, 2026 | B |
| AGNTCY messaging ecosystem IETF draft compares AMQP/MQTT/NATS/Kafka delivery-guarantee semantics | IETF draft-mpsb-agntcy-messaging v02, Jul 2026 | B |
| CP-WBFT: confidence-probe-weighted Byzantine consensus holds accuracy at 85.7% simulated fault rate | arXiv:2511.10400, Nov 2025/rev. Dec 2025 | B |
| `ruvector@0.2.27` (the version this repo pins) really does export `minCut`/`louvainCommunities`/`buildGraph`/`spectralClustering` — confirmed by direct install + `Object.keys()`, resolving last night-to-night's contradiction | This session, direct inspection | A |

## Ruflo Current Capability

`@claude-flow/swarm` has two parallel coordination stacks: the canonical, live `UnifiedSwarmCoordinator` (recent nights' fixes — broadcast-retry queue key #3929, mirror-edges #3357, spawnAgent pool.add #3539 — all land here) and a `@deprecated` compatibility layer, `SwarmHub` (+ its private `AgentRegistry`/`TaskOrchestrator`), kept for a documented legacy public API (`createSwarmHub()`/`initializeV3Swarm()`) but verified tonight to have **zero callers from the shipped CLI** — only docs/README reference it. Both of tonight's two leading candidates live in that compatibility layer: `AgentRegistry.heartbeat()` (zero production callers — any real `SwarmHub` user would see every spawned agent falsely flip to `'error'` status ~15s after spawn, confirmed via direct read of `agent-registry.ts`/`swarm-hub.ts`) and `TaskOrchestrator.getQueuePosition()`'s priority-map typo (confirmed: its local map has `normal`/`background` keys that never match `TaskPriority`'s real `critical|high|medium|low`, so `createTask()`'s default `'medium'` priority falls through to `priorityOrder[...] || 0`, sorting behind `'low'`(2) in the one place that reads it — the `taskQueuedEvent` position field; real dispatch via `getNextTask()`/`getPriorityQueue()` uses a separate, correct map and is unaffected).

## Competitor Comparison

| System | Mechanism handling | Grade | Source |
|---|---|---|---|
| Temporal (reference) | At-least-once activities; app-level Heartbeats distinguish stuck-vs-slow; per-op RetryPolicy | A | docs.temporal.io, 2025 |
| LangGraph | Checkpointer persists state, not execution — resume is externally triggered, no message-bus/retry layer | B | LangChain docs + Temporal's own gap analysis |
| MS Agent Framework | Per-superstep checkpoints, at-least-once; no consensus layer | B | learn.microsoft.com, 2026 |
| CrewAI | `@persist` SQLite snapshots; retry count widely reported as hard to control | C | CrewAI community threads, 2025-2026 |
| OpenAI Agents SDK | No delivery guarantee/health-check/consensus — deliberate scope decision, not a gap | C | SDK review + Swarm README lineage |
| CP-WBFT / WBFT (academic) | Confidence/trust-weighted BFT; neither ships a production message bus or topology-repair story | B/C | arXiv:2511.10400, arXiv:2505.05103 |

None of the five LLM frameworks pair delivery-retry rigor with Ruflo's raft/byzantine/gossip consensus options — that combination only exists in 2025-2026 academic prototypes, not shipped products. Nobody (Ruflo included) publishes a reproducible topology-self-repair-under-churn benchmark — a genuine open gap across the whole landscape.

## Hypothesis

> Given a `TaskOrchestrator` queue containing tasks across multiple priorities including at least one default (`'medium'`) priority task, when `getQueuePosition()`'s local `priorityOrder` map is corrected to use `TaskPriority`'s real keys (`critical`/`high`/`medium`/`low`) — matching the already-correct map in the same file's `getNextTask()`/`getPriorityQueue()` — then the `position` value emitted via `taskQueuedEvent` for a medium-priority task should rank it ahead of same-or-lower-priority `'low'` tasks instead of falling through to the unmatched-key default of `0` and sorting last, subject to: (1) real dispatch order via `getNextTask()`/`getPriorityQueue()` stays byte-identical (already correct, untouched); (2) all existing tests remain green; (3) deterministic, $0, zero-LLM evaluation.

**STEP 3.2 candidate scoring** (0.25·fit + 0.20·testability + 0.20·measurability + 0.15·production_value + 0.10·novelty + 0.10·reviewability, 1-5 each):

| Candidate | fit | test | meas. | prod. | novel | review | Score |
|---|---|---|---|---|---|---|---|
| **TaskOrchestrator.getQueuePosition() priority typo** | 5 | 5 | 5 | 3 | 4 | 5 | **4.60** |
| AgentRegistry.heartbeat() never called (false 'error' flip) | 5 | 4 | 5 | 3 | 5 | 3 | 4.30 |
| ruvector-integration: wire real `minCut`/`louvainCommunities`/`buildGraph` exports | 3.5 | 4 | 4 | 4 | 5 | 3 | 3.88 |
| TopologyManager.updateNode() 3rd edge-mirroring gap (currently unreachable — `updateNode()` has no production caller) | 4 | 4 | 4 | 2 | 3 | 4 | 3.50 |
| QueenCoordinator unbounded cache growth (leak, not correctness) | 3 | 3 | 3 | 2 | 2 | 4 | 2.85 |
| ruview-integration: unwired RuView product-plane module | 2 | 1 | 1 | 2 | 2 | 2 | 1.60 |

Highest score selected. Note on fairness: `heartbeat()` initially looked more impactful (a live false-positive vs. a telemetry-field typo), but direct verification found **both** candidates live inside the same unreachable-from-shipped-CLI `SwarmHub` layer — once `production_value` is scored consistently across both, the smaller, cleaner, equally-real fix wins on testability/measurability/reviewability. `heartbeat()`'s fix also requires a real design decision (where should a liveness signal come from?) rather than a pure wiring correction, raising its risk. Carried forward for a future night, not discarded.

## Benchmarks

No `.harness/bench.json` corpus exists in this repo (confirmed, same as every recent night). Real evaluator: Vitest 4.1.8, deterministic, $0, zero LLM calls — matching the established pattern for this correctness-bug-fix class (near-unanimous across the ledger since 2026-08-18).

## Evaluation

**evaluated: accepted.** Real evaluator: Vitest 4.1.8, deterministic, $0, zero LLM calls, against a freshly `pnpm install`-ed `v3/` workspace.

New test file `task-orchestrator.queue-position.test.ts` (3 tests). Stash-isolated (`git stash push -- .../task-orchestrator.ts`, test file kept): 2/3 fail exactly as hand-predicted (`expected 2 to be 1`; `expected 4 to be 3`); the dispatch-order control test (unaffected `getNextTask()`) passes on both. Candidate: 3/3 pass. Full `@claude-flow/swarm` suite, run both ways (not just the new file): baseline (stashed fix) 278/280 passed, 1/19 files failed — exactly the 2 discriminating tests, nothing else; candidate 280/280 passed, 19/19 files green. Zero other regressions. `tsc --noEmit`: clean, 0 errors, both ways — and the fix's `Record<TaskPriority, number>` (replacing the old untyped `Record<string, number>`) now makes TypeScript itself reject a future key mismatch at compile time. Independently re-reproduced end-to-end by an adversarial critic (own stash/pop cycle, own hand-trace of the enqueue-order math, own full-suite + tsc run): **CONFIRMED, no blocking issues.**

Blast radius: `getQueuePosition()` has exactly one call site (`queueTask()`), emitting `taskQueuedEvent`'s `position` field. Grep-confirmed no other consumer of that field anywhere in `v3/` (a same-named `taskQueuedEvent` in the sibling `@claude-flow/shared` package is a different, unrelated event shape whose handler never reads `position`).

## Darwin Results

Skipped — binary correctness fix (swap a map's keys to match the real `TaskPriority` type), no continuous/categorical parameter for Darwin's real interface (`npx ruvector harness darwin <config> --execute`, confirmed available in STEP 0.5) to search over. Same skip class as nearly every accepted fix since 2026-08-18 (#3110/.../#4138).

## SOTA Proof & Witness

```
Session commit:   55e2c9011c20d25e347a175427ca8084dacde40c
Candidate commit: (this branch's head — see PR for exact SHA)
Gist SHA-256 (pre-witness, this block stripped back to PENDING): f24b247c36ec96f21cd717fc9b760b85dda5780f087fc039ad16ceb9ad2ce348
Witness stamp:    fab09db09b34d6878ec1ee15e94fae9aaab818c3fb9c2cf7a7d4b02d6de4b444
```
Verifier: fetch `docs/dream-cycle/dream-gist-2026-10-14.md` from this branch, strip this witness block's filled-in values back to `PENDING`, SHA-256 the file, concatenate with the session commit above, SHA-256 again — must equal the witness stamp.

## Recommended Next Steps

1. **Wire a real liveness signal into `AgentRegistry.heartbeat()`** (or disable its false-positive health-check path) in `v3/@claude-flow/swarm/src/coordination/agent-registry.ts` — every `SwarmHub`-based consumer currently sees agents falsely flip to `'error'` ~15s after spawn. Needs a design call on the signal source; deferred from tonight to keep the patch to one conceptual change.
2. **Fix `graph-analyzer.ts`'s native-acceleration detection** (`v3/@claude-flow/cli/src/ruvector/graph-analyzer.ts`) to probe for the real `ruvector@0.2.27` exports (`buildGraph`/`minCut`/`louvainCommunities`) instead of the always-false `hooks_graph_mincut`/`hooks_graph_cluster`/`GraphAnalyzer` checks — resolves the 10-09/10-10 contradiction with a concrete adapter fix; `louvainCommunities()`'s real return shape needs closer verification (returned `{}` in a 3-node smoke test) before wiring.
3. **Mirror `TopologyManager.updateNode()`'s connection updates into neighbor adjacency lists** — third occurrence of the edge-mirroring bug class (after 08-29 mesh, 09-19 hierarchical/centralized); currently unreachable from production (`UnifiedSwarmCoordinator` never calls `updateNode()`), so lower urgency than #1, but a real latent correctness gap for any future caller.
