# Performance SOTA Report — 2026-10-15

TL;DR: Tonight's 2026 performance deep-dive closes out a 3-night research thread (10-09→10-10→10-14) on `graph-analyzer.ts`'s vestigial native-acceleration detection — direct inspection of the real `ruvector` package source shows its `minCut`/`louvainCommunities` exports are plain JS, not native/WASM-accelerated, so wiring them in would not be a performance win (REJECT, with evidence) — and ships a real positive fix: `RaftConsensus.awaitConsensus()` (Ruflo's default hive-mind consensus algorithm, reachable via `UnifiedSwarmCoordinator.proposeConsensus()`'s public API) busy-polled pending proposals via `setInterval(...,10)` even though `checkConsensus()` already emits the exact `'consensus.achieved'` event needed to resolve it — the third instance of a bug class the ledger has now fixed twice before (UnifiedSwarmCoordinator #3378, MessageBus #3563).

## What's New in 2026

| Finding | Source | Confidence |
|---|---|---|
| MAFBench: orchestration-framework layer alone (not model/prompt) swings latency >100x and coordination success 90%→<30% | Orogat/Rostam/Mansour, arXiv:2602.03128, Feb 2026 | B |
| "The Orchestrator Bottleneck": formalizes sequential/parallel-fanout/hierarchical coordination strategies, 28–42% cost reduction vs. sequential | ICML 2026 (accepted, peer-reviewed) | A |
| Node.js v24.19/v26.6 (2026-08-03): streams/ring-buffer overhaul, no event-loop-phase scheduling change found | Official Node.js release notes | B |
| Milvus/Weaviate/Vespa all wire *real* runtime-CPU-flag dispatch to real compiled SIMD variants — Ruflo's graph-analyzer.ts dead-detection code imitated this pattern against a backend that never shipped | Milvus Knowhere docs, Weaviate forum, Vespa Dec-2025 newsletter | B |
| `ruvector`'s real `minCut`/`louvainCommunities` exports are plain JS (confirmed by direct source read), same incremental-bookkeeping complexity class as Ruflo's already-fixed `fallbackLouvain` | This session, direct inspection | A |

## Ruflo Current Capability

`RaftConsensus` (`v3/@claude-flow/swarm/src/consensus/raft.ts`) is the default hive-mind consensus algorithm (`config.algorithm ?? 'raft'`, both in `ConsensusEngine` and `UnifiedSwarmCoordinator`), reachable from production via `UnifiedSwarmCoordinator.proposeConsensus()` → `consensusEngine.propose()` + `consensusEngine.awaitConsensus()`. `checkConsensus()` already emits `'consensus.achieved'` on every pending→accepted/rejected transition — `UnifiedSwarmCoordinator` itself already listens to this same event (`unified-coordinator.ts:712`) to re-emit its own swarm-level event. Yet `awaitConsensus()` ignored that event entirely and instead polled `this.proposals.get(proposalId)` every 10ms via `setInterval`, for the full `timeoutMs` window if a proposal happened to never resolve. `ByzantineConsensus`/`GossipConsensus` carry the exact same pattern (not fixed tonight — see Next Steps). A separate, independently-confirmed finding: `raft.ts` also has a dead, diverged duplicate inbound-RPC receiver (`handleVoteRequest`/`handleAppendEntries`, lines 513–578) exercised only by tests, never by production (the real receiver is `handleInboundRaftMessage`) — not fixed tonight, carried forward.

## Competitor Comparison

| System | Mechanism handling | Grade | Source |
|---|---|---|---|
| LangGraph | Pregel-style superstep (plan→execute(parallel)→update), sync barrier per step, checkpoint per step — not a busy-poll | B | LangChain Pregel/checkpointer docs |
| AutoGen v0.4 / MS Agent Framework | Actor-model async message-passing; event-driven agents react to messages (AutoGen now in maintenance, folded into MS Agent Framework GA Apr 2026) | B | MS Research AutoGen v0.4 |
| CrewAI | "Flows" are explicitly event-driven; no published internals on dispatch mechanics (poll vs. event) | C | CrewAI repo |
| OpenAI Swarm → Agents SDK | Swarm: stateless client loop, no server event bus. Agents SDK: session state/guardrails added, handoffs still sequential | C | SDK docs |
| Milvus/Weaviate/Vespa (vector DBs) | Real runtime CPU-feature-flag dispatch to compiled SIMD variants — the pattern Ruflo's dead `graph-analyzer.ts` detection imitated without a real backend | B | Knowhere/Weaviate forum/Vespa docs |

None of the four orchestration frameworks publish internals on poll-vs-event consensus/task-wait dispatch — genuinely unaudited territory industry-wide, not just a Ruflo gap.

## Hypothesis

> Given a pending consensus proposal in `RaftConsensus`, when `awaitConsensus()` resolves via the already-emitted `'consensus.achieved'` event (plus a single `setTimeout` for expiry) instead of polling `this.proposals` on a 10ms `setInterval`, then (a) `ConsensusResult` for accept/reject/expire/not-found cases stays behaviorally identical, and (b) proposals that resolve before timeout should resolve with lower, less-discretized latency and zero timer-tick overhead while waiting, subject to: all existing tests green; no change to quorum/vote logic in `checkConsensus()`; deterministic, $0, zero-LLM evaluation.

## Benchmarks

No `.harness/bench.json` corpus exists (confirmed, same as every recent night). Real evaluator: Vitest 4.1.8 + a standalone wall-clock probe, deterministic, $0, zero LLM calls.

## Evaluation

**evaluated: accepted.** New test file `raft-await-consensus-event-driven.test.ts` (4 tests). Stash-isolated baseline (`git stash` on just `raft.ts`): 3/4 fail exactly as predicted (`setInterval` called when asserted not-called; immediate-return case measured 11ms ≥ the <10ms bound; expiry case shows 5 `setInterval` calls) — the 4th (unknown-proposal-id immediate rejection) passes both ways, a correct non-discriminating control. Candidate: 4/4 pass. Full `@claude-flow/swarm` suite: 281/281 passed, 19/19 files green (277 pre-existing + 4 new), zero regressions. `tsc --noEmit`: clean, 0 errors, both ways. Standalone wall-clock probe (30 trials, vote arriving 3–9ms after `awaitConsensus()` starts, deliberately off the old 10ms poll grid): baseline mean 3.639ms / max 7.492ms vote→resolve latency, 30 `setInterval` timers created (1 per call); candidate mean 0.058ms / max 0.346ms, 0 `setInterval` timers created — ~63x mean-latency reduction and complete elimination of poll-timer overhead while waiting.

## Darwin Results

Skipped — binary correctness/wiring fix (listen to an already-emitted event instead of polling), no continuous/categorical parameter for Darwin's real interface (`npx ruvector harness darwin <config> --execute`, confirmed available in STEP 0.5) to search over. Same skip class as nearly every accepted fix since 2026-08-18.

## SOTA Proof & Witness

```
Session commit:   1882006a02487590c8c66a7eec8d7504f6af33c3
Candidate commit: (this branch's head — see PR for exact SHA)
Gist SHA-256 (pre-witness, this block stripped back to PENDING): df858321819d9bb00295ae21dba03fe2752975b6592a86cb845fe06dadfac367
Witness stamp:    2ca9c4955cff2ddfdba4e633a5a823cded52979f91b11423cc95fcc2e1fc5c87
```
Verifier: fetch `docs/dream-cycle/dream-gist-2026-10-15.md` from this branch, strip this witness block's filled-in values back to `PENDING`, SHA-256 the file, concatenate with the session commit above, SHA-256 again — must equal the witness stamp.

## Recommended Next Steps

1. **Apply the same busy-poll→event-driven fix to `ByzantineConsensus.awaitConsensus()` and `GossipConsensus.awaitConsensus()`** (`v3/@claude-flow/swarm/src/consensus/byzantine.ts`/`gossip.ts`) — identical pattern, lower priority than Raft since it isn't the default algorithm; deferred to keep tonight's patch to one file/one conceptual change.
2. **Remove or retarget the dead duplicate Raft receiver** (`raft.ts:513-578`, `handleVoteRequest`/`handleAppendEntries`) — exercised only by `consensus.test.ts`, zero production callers, diverges from the live `handleInboundRaftMessage` path (no index-dedup, unconditional `votedFor` mutation) and gives false test confidence.
3. **Reconcile `crdt`/`quorum` as CLI-offered but unimplemented consensus strategies** — `hive-mind.ts`'s CLI/wizard offers `crdt`/`quorum`, but `ConsensusAlgorithm` only supports `raft|byzantine|gossip|paxos` and `hive-mind.ts` never imports the real `ConsensusEngine` at all (cosmetic banner only); either wire them or remove the dead choices.
4. Security scan carried forward: `settings-risk-scanner.ts` never inspects `enabledPlugins`/`extraKnownMarketplaces` (a capability-granting settings.json surface distinct from `hooks`/`permissions.allow`), and `DENYLISTED_ENV_NAMES` is missing several CWE-427-class names (`PYTHONSTARTUP`, `RUBYOPT`, `JAVA_TOOL_OPTIONS`, `GIT_ASKPASS`, etc.) already in the same family it targets.
