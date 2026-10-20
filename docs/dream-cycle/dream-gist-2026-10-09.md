# Swarm SOTA Report — 2026-10-09

TL;DR: In 2026, multi-agent orchestration research has shifted from "does consensus work" to "does it survive stochastic LLM voters" — AAAI 2026's confidence-weighted BFT (CP-WBFT) shows classic majority-vote BFT degrades badly under realistic LLM unreliability, while a March 2026 preprint shows a single Byzantine LLM agent can collapse textbook consensus entirely via liveness loss rather than corrupted values. Against that backdrop, tonight's own swarm package review found something more mundane but concretely fixable: `MessageBus`'s broadcast-retry path has been silently dropping failed deliveries to orphaned queue entries since the event-driven rewrite (#3562/#3563) that fixed its direct-message sibling — explicitly flagged as a "KNOWN LIMITATION (pre-existing, not fixed here)" comment in the shipped code, now closed. A second, independently confirmed dead-code finding (ruvector-integration SCAN: the code-graph analyzer's native-acceleration path calls API names that have never existed in the real `ruvector` package, across its entire pinned version range) is carried as a scanned-but-deferred candidate for a future night rather than bundled into tonight's patch.

## What's New in 2026

| Finding | Source | Confidence |
|---|---|---|
| Confidence-weighted BFT (CP-WBFT) survives 85.7% Byzantine fault rates by weighting message credibility via probe-based scoring instead of flat majority vote | AAAI 2026 proceedings, arXiv:2511.10400 | A |
| RouteMoA: skipping pre-inference scoring in mixture-of-agents routing cuts cost 89.8% and latency 63.6% vs. scored routing at scale | ACL 2026 Long Papers | B |
| A single Byzantine LLM agent can collapse consensus success under a validity+liveness formalization — failures are dominated by liveness loss, not corrupted values, undercutting the assumption that textbook BFT math transfers to stochastic LLM voters | arXiv:2603.01213 (Mar 2026) | C |
| AdaptOrch: dynamic topology selection (parallel/sequential/hierarchical/hybrid) per task-dependency graph reportedly outweighs backbone model choice for system-level performance | arXiv:2602.16873 (Feb 2026) | C |
| MonoScale: familiarization tasks + contextual-bandit augmentation give a monotonic-improvement guarantee when onboarding new agents into a live pool (addresses "new agent tanks performance") | arXiv:2601.23219 | C |

No credible 2026 result found specifically combining CRDT+gossip+BFT for agent swarms — closest is a Dec-2025 position paper (arXiv:2512.03285) that is explicitly a research agenda, not evaluated results. Noted as a gap rather than padded.

## Ruflo Current Capability

`UnifiedSwarmCoordinator` (`v3/@claude-flow/swarm/src/unified-coordinator.ts`, 1931 lines) composes a `TopologyManager` (adjacency-list graph, O(1) queen/coordinator caches, symmetric edge mirroring), a per-domain `AgentPool` (acquire/release/scale with cooldown + health-check replacement), an event-driven `MessageBus` (Deque-backed priority queues, `scheduleProcessing()`), and a pluggable `ConsensusEngine` (raft/byzantine/gossip). Already fixed in recent nights (not re-proposed): MessageBus busy-poll (#3562/3563), spawnAgent pool.add() wiring (#3538/3539), topology edge-mirroring (#3356/3357), weighted-consensus trust tally, rebalanceHybrid one-directional edges, AgentPool heartbeat self-stamp, byzantine quorum sizing.

Tonight's finding sits one layer inside the already-fixed MessageBus rewrite: `handleDeliveryError()`'s retry re-queue used the broadcast sentinel `message.to === 'broadcast'` as a queue key instead of the real subscriber's `agentId` that `enqueue()` had actually fanned the message out to. Since `processQueues()` skips any queue with no matching subscription, a failing broadcast subscriber's retries — and eventual `message.failed` — were silently dropped into a queue nobody drains, leaking until `shutdown()`. The fix threads `subscription.agentId` through `deliverMessage()` → `handleDeliveryError()` → the re-queue, matching the already-correct direct-message path exactly.

## Competitor Comparison

| System | Topology/coordination | Dynamic pool & routing | Fault tolerance | Grade |
|---|---|---|---|---|
| LangGraph | supervisor / swarm (peer handoff) / hierarchical graph patterns | `create_handoff_tool` transfers control+state at runtime | Checkpointer resume, not quorum/consensus | B |
| Microsoft Agent Framework (AutoGen successor, GA Apr 2026) | sequential/concurrent/group-chat/handoff/Magentic (dynamic task ledger) | Magentic assigns open-ended sub-tasks from the ledger | No built-in consensus; durability from host runtime | B |
| CrewAI | sequential default; opt-in hierarchical (`manager_llm`); Flows adds event-driven routing | "Router Agent" pattern, not a core primitive | None documented; relies on LLM-call retries | B |
| OpenAI Agents SDK | Handoffs (single-agent-at-a-time transfer) + agents-as-tools; no branching/parallel | Triage agent picks a specialist | Guardrails/tracing, no consensus/HA | C |
| Temporal (workflow comparator) | Hand-built fan-out/fan-in, child workflows, sagas | Dynamic routing via signals/queries | Durable replay of persisted event history — closest analog to real fault tolerance | C |

None of these name Raft/Byzantine consensus as a headline feature the way ruflo's hive-mind does; Temporal's durable-replay model is the nearest real analog to fault tolerance, the rest lean on checkpoint-resume or plain retries.

**ruvector-integration SCAN note:** no competitor example found of a CI "contract test that diffs a native-wrapper's called method names against the real installed package's actual exports" — napi-rs/node-addon-api docs flag Rust snake_case→JS camelCase export drift as a known risk, but an explicit startup self-test for it doesn't appear to be documented practice anywhere searched. LangChain.js's `faiss-node`/`hnswlib-node` integrations take the safer default: throw loudly when the native binding is missing, rather than silently degrading to a JS fallback — arguably the correct pattern ruflo's `graph-analyzer.ts` lacks.

## Hypothesis (frozen before evaluation)

Given a swarm using `MessageBus.broadcast()` where at least one subscriber's delivery callback throws, when `handleDeliveryError()`'s retry re-queue is changed to use the real subscriber's `agentId` (threaded through from `deliverMessage()`) instead of the literal string `'broadcast'`, then the failing subscriber should receive bounded retries up to `config.retryAttempts` and emit `message.failed` once exhausted — matching the already-correct direct-message path — subject to: zero change to happy-path (no-error) behavior, zero regression across the existing 274-test swarm suite, and a deterministic $0 Vitest evaluation.

## Benchmarks / Evaluation

Real evaluator: Vitest 4.1.8, deterministic, $0, zero LLM calls, against a freshly `pnpm install`-ed `v3/` workspace (not pre-built at session start).

- New test file `message-bus.broadcast-retry.test.ts` (2 tests): stash-isolated baseline (fix reverted, test kept) — both fail exactly as predicted (`badInvocations` 1 vs. expected 3; `getQueueDepth()` 1 vs. expected 0, i.e. the orphaned-queue leak). Candidate: both pass.
- Full `@claude-flow/swarm` suite: baseline 274/274 (17 files) → candidate 276/276 (18 files, +2 new), zero regressions.
- `tsc --noEmit`: clean, 0 errors, both ways.
- Healthy co-subscriber in the same broadcast delivers exactly once, unaffected by the sibling's failure — explicit regression guard in the new test.

## Darwin Results

Skipped — binary correctness/wiring fix (which queue key to re-queue under), no continuous or categorical parameter for Darwin's real interface (`npx ruvector harness darwin <config> --execute`, confirmed available v0.9.2) to search over. Same skip class as nearly every accepted fix since 2026-08-18 (#3110/.../#3909).

## SOTA Proof & Witness

See issue/PR for the full reward-hack checklist, adversarial critique, and security review. Witness stamp at the end of this file.

## Recommended Next Steps

1. **Wire the real `ruvector` npm package's `minCut`/`louvainCommunities`/`buildGraph` exports into `v3/@claude-flow/cli/src/ruvector/graph-analyzer.ts`'s `loadRuVector()`** (currently checks for `ruvector.hooks_graph_mincut`/`ruvector.hooks_graph_cluster` and `@ruvector/wasm`'s `GraphAnalyzer` class, neither of which exists in any version of either real package — confirmed by downloading and inspecting `ruvector` 0.2.27 through 0.3.3 directly). Native-acceleration has been 100% dead code since introduction; a future `ruvector-integration` night should pick this up as its primary candidate.
2. **Add a CI contract test that imports the real `ruvector` package and asserts the exact method names `graph-analyzer.ts` expects actually exist** — would have caught tonight's #1 immediately and is cheap insurance against future API drift (no competitor precedent found for this pattern, but it's a clear gap).
3. **`AgentPool.updateAgentHeartbeat()` remains dead code** post the #3242/3243 fix that correctly stopped self-stamping — nothing in `v3/` currently calls it, so `replaceUnhealthyAgent()` only ever fires for genuinely-stale agents but no real agent's liveness is ever actually recorded via the pool's own API. Disclosed as a caveat in that PR, still unaddressed; candidate for a future `swarm` night once a concrete wiring path from `UnifiedSwarmCoordinator.handleHeartbeat()` is scoped.

## Scan Findings: ruview-integration

No real integration exists beyond a well-tested but **unwired** policy/schema module: `v3/@claude-flow/security/src/policy/product-plane.ts` defines a RuView product-plane profile (`RuViewSemanticObservationV1`, `validateRuViewSemanticObservation()`, privacy-ceiling P2/P3 enforcement) with substantive unit tests (`product-plane.test.ts`), but zero consumers anywhere in the codebase — no CLI command, MCP tool, or caller constructs or validates a real RuView observation. ADR-325 and ADR-326 (the design docs covering it) are both still **Proposed**. This is new-feature work (building a consumer), not a scoped bugfix, so it does not qualify as tonight's testable-tonight candidate — consistent with prior nights' findings on this surface.

## Scan Findings: ruvector-integration

See Recommended Next Steps #1-2. Independently confirmed by two separate reviews (this session's own package download + an independently-spawned architecture-reviewer agent reading the installed `ruvector` v0.2.41): `graph-analyzer.ts`'s `loadRuVector()` has never successfully loaded native acceleration since the file's introduction (`git log --follow` shows it was introduced whole, not regressed from a once-working state) — `analyzeMinCutBoundaries()`/`analyzeModuleCommunities()` always run the slower, approximate `fallbackMinCut`/`fallbackLouvain` JS implementations instead of the real package's exact Stoer-Wagner `minCut()` and `louvainCommunities()`. The existing test (`graph-analyzer.test.ts`'s `loadRuVector` describe block) doesn't catch this because its assertion (`result === null || typeof result === 'object'`) is trivially true either way, and its `@ruvector/wasm` mock (`{minCut, louvain}` as bare functions) doesn't match what the source code actually checks for (a `GraphAnalyzer` class with `.mincut()`/`.louvain()` methods) — so the mock never meaningfully exercises the real detection branch either.

## Competitors Reviewed

LangGraph, Microsoft Agent Framework (AutoGen successor), CrewAI, OpenAI Agents SDK, Temporal (coordination/topology); Qdrant, Weaviate, Milvus, LanceDB, LangChain.js `faiss-node`/`hnswlib-node` (native-fallback pattern, ruvector-integration scan).

## Witness

```
Session commit (STEP 0): 58e0ae7e14e68aab45a4127d6f42f567bbcfb328
Gist SHA-256 (pre-witness, this block's filled values stripped to PENDING): 3b02818262f559907245450201b00bb7742dc781270d60f3deea159fa568e1fc
Witness stamp: 1b7e818e917acd3925b622ec26d78632ab8c872dab78da3ecf97fb0da27d461c
```

Verifier: fetch this file from the branch, strip this block's filled values back to `PENDING`, SHA-256 the file, concatenate with the session commit above, SHA-256 again — must equal the witness stamp.
