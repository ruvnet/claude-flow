# Performance SOTA Report — 2026-09-20

TL;DR: Tonight's `performance` deep-dive fixed `UnifiedSwarmCoordinator.waitForTaskCompletion()`/`waitForQueuedTask()` (`v3/@claude-flow/swarm/src/unified-coordinator.ts`), which busy-polled `state.tasks` on a `setInterval(..., 100)` to detect task completion, even though the coordinator already `extends EventEmitter` and already fires `task.completed`/`task.failed` at every terminal task-status transition — nothing subscribed to those events. This is the exact candidate last night's (2026-09-15) performance run surfaced and scored 4.45/5 but deferred in favor of the MoE load-balance fix (PR #3330); tonight's own independent 5-role research fan-out re-scored it at 4.75/5 against 4 freshly-generated alternatives and selected it. Measured wall-clock resolution latency: **100.359ms → 0.206ms mean (~487x)** for a task that completes on the very next tick, via real (non-fake-timer) benchmark.

## What's New in 2026

| Finding | Source | Confidence |
|---|---|---|
| AutoGen's v0.4 rewrite and Microsoft Agent Framework (unified AutoGen+Semantic Kernel successor, Oct 2025) moved to an async, event-driven Core runtime — polling-vs-event is a live design axis competitors have already crossed | github.com/microsoft/autogen; MS Agent Framework docs | B |
| No mainstream competitor (LangGraph, MS Agent Framework, CrewAI, OpenAI Agents SDK) signals task/step completion via timer-based polling — all four use async control flow (await, Pregel-style superstep barrier, `@listen` event decorators, or exception-based interrupt) | Official docs for each (LangGraph Pregel model, MS Agent Framework checkpoint docs, CrewAI Flows docs, OpenAI Agents SDK `Runner` docs) | B |
| A real, on-point (if unquantified) GitHub issue describes the identical anti-pattern in an unrelated project: a shutdown loop that busy-waits via a fixed-ms sleep loop instead of `Promise.race`/awaiting in-flight promises | Lilly-Protocol/agentlily-runtime#259 (open, $100 bounty) | C |
| No canonical literature term exists for the recurring "computed/emitted signal, no subscriber" bug class this repo's dream-cycle keeps finding (cf. #3094, #3169, #3266, #3330); closest is generic "dead code" / "unreachable code," which under-describes it since the code *is* reachable and *does* run | Own search across academic/grey literature; Wikipedia "Unreachable code" | C (negative finding) |
| No rigorous, reproducible benchmark exists quantifying `setInterval`-poll vs event-driven completion cost in Node.js specifically — claims found in blogs (e.g. "30-50% CPU from 5ms timers") could not be traced to a verifiable primary source and are explicitly excluded from this report's claims | Own search; DEV.to "Polling versus events for Node background work" | C (flagged unverifiable, not used) |

## Ruflo Current Capability

`UnifiedSwarmCoordinator` (`v3/@claude-flow/swarm/src/unified-coordinator.ts`) extends Node's `EventEmitter` and coordinates up to 100+ agents across 4 topologies with pluggable Raft/Byzantine/Gossip/CRDT/Quorum consensus. Its `executeParallel()`/`executeTaskInDomain()` path (used by `WorkflowEngine`, the shared hooks executor, and the maestro plugin — confirmed via grep, not assumed) calls `waitForTaskCompletion()` (agent already assigned) or `waitForQueuedTask()` (task queued, no agent yet). Both busy-polled every 100ms despite `handleTaskComplete()`, `handleTaskFail()`'s non-retry branch, and `cancelTask()` already calling `this.emitEvent('task.completed'|'task.failed', ...)` (→ `this.emit(type, event)`) at the exact moment each terminal transition happens. Closed ground from recent performance nights (not rediscovered tonight): HNSW `efSearch` tuning (08-15, REJECTED), HNSW product-quantization dispatch (08-25, ACCEPTED), dead `diskann-backend.ts` removal (08-30), fake `cli-cold-start.bench.ts` measurement (09-05), MMR eager-tokenization (09-10, 5.88x), MoE load-balance gradient (09-15).

## Competitor Comparison

| Framework | Completion-signaling model | Grade | Source |
|---|---|---|---|
| LangGraph | Pregel/BSP "superstep" barrier — synchronous merge point per superstep, not polling | B | Atomic Object / official docs, 2026 |
| Microsoft Agent Framework (AutoGen+Semantic Kernel successor) | Same superstep model; checkpoints at superstep boundaries, event-driven within a superstep | B | Microsoft Learn "Workflows – Checkpoints," 2026 |
| CrewAI | Thread/future-join for `async_execution=True`; "Flows" are explicitly event-driven (`@listen` decorators) | B/C | CrewAI docs; GitHub issues #4168/#2997/#207 (real race-condition reports in async token accounting, analogous imprecise-completion-tracking symptom) |
| OpenAI Agents SDK | Pure async/await `Runner.run()` loop — no polling primitive documented anywhere | B | openai.github.io/openai-agents-python |

**Synthesis**: every actively-developed competitor signals completion via async control flow, not a timer poll — Ruflo's coordinator was a genuine outlier here, not just a theoretical inefficiency. No competitor publishes internal-loop latency numbers either, so tonight's own 487x figure (a real, reproducible measurement, not a vendor claim) is more concrete than anything found industry-wide for this specific pattern.

## Hypothesis

> Given `UnifiedSwarmCoordinator.waitForTaskCompletion()`/`waitForQueuedTask()` busy-polling `this.state.tasks.get(taskId)` on a `setInterval(..., 100)`, when both are rewritten to (a) synchronously check for an already-terminal task before attaching any listener (race safety), (b) subscribe to `task.completed`/`task.failed` filtered by `event.data.taskId`, re-reading the task's actual current `status` rather than trusting the event name (since `cancelTask()` emits `task.failed` even for a `cancelled` status), and (c) keep a `setTimeout` fallback for the timeout case (a client-side deadline no coordinator event ever announces), then a task that completes before the next would-be poll tick should resolve on the same microtask drain as the completion event — relative to baseline, where resolution is bounded below by the poll interval — subject to:
> 1. the timeout-fallback path (no terminal event ever fires) is byte-identical in outcome to today's behavior;
> 2. `handleTaskFail()`'s retry branch (task requeued, no event fired) does not cause a mis-resolution;
> 3. all existing `@claude-flow/swarm` tests remain green;
> 4. fully deterministic, $0 evaluation cost, no LLM calls.

Frozen before evaluation; not modified after seeing results.

## Benchmarks / Evaluation

**evaluated: accepted (ACCEPT).** Real evaluator: Vitest 4.1.8, deterministic, $0, zero LLM calls. New file: `v3/@claude-flow/swarm/__tests__/unified-coordinator-event-driven-wait.test.ts` (4 tests).

**Baseline vs. candidate, isolated via `git stash` of just the source file (test file kept):** 3 of 4 tests fail against real baseline (fake-timer assertion: promise not yet resolved after draining microtasks with zero timer advance — a `setInterval(...,100)` genuinely cannot have ticked yet) and pass against candidate; the 4th (timeout-fallback correctness) passes both ways, confirming it's a regression-safety check, not a discriminator.

**Real (non-fake-timer) wall-clock microbenchmark** (N=20 task-completion cycles, resolved on the very next `setImmediate` tick): baseline mean **100.359ms** (p50 100.185ms — matches the 100ms poll interval exactly, as expected), candidate mean **0.206ms** (p50 0.063ms) — **~487x**. Benchmark script was transient (not committed); numbers are reproducible from the description above (register agent, submit task, resolve `waitForTaskCompletion` on the next `setImmediate` via `handleTaskComplete`, measure elapsed time).

Full `@claude-flow/swarm` package suite: **234/234 passing** (230 pre-existing + 4 new), 0 regressions. `tsc --noEmit`: 0 errors.

**Independent adversarial critique (STEP 10, separate subagent, no authoring context):** verdict **CONFIRMED-WITH-CAVEATS** initially. Independently re-read the diff (not the description), confirmed the synchronous pre-check makes the "terminal-before-listener-attach" race structurally impossible (no `await` between check and `this.on(...)`), confirmed the `cancelTask`-emits-`task.failed`-but-status-is-`cancelled` subtlety is handled correctly (both functions re-read actual task status, never trust the event name), confirmed `handleTaskFail()`'s retry branch (no event emitted) correctly leaves the wait pending rather than mis-resolving, traced every exit path for listener/timer cleanup (none leak), independently re-ran the full suite (234/234) and the stash-isolated baseline-fails/candidate-passes comparison (3/4 fail on baseline as predicted), and confirmed `tsc --noEmit` clean. **One real caveat found and fixed same session**: neither function called `setMaxListeners`, and Node's default per-event-name cap is 10 — at realistic concurrency (>10 simultaneous `executeTaskInDomain()` calls, well within default `config.maxTasks`), production would emit spurious `MaxListenersExceededWarning` noise (not a correctness bug — every listener still fires — but a real regression in observable behavior vs. the old poll design). Fixed by calling `this.setMaxListeners(Math.max(EventEmitter.defaultMaxListeners, this.config.maxTasks * 2))` in the constructor; independently verified via a throwaway test asserting zero `MaxListenersExceededWarning` emissions with 30 concurrent listeners registered. Re-verified 234/234 green and clean typecheck after the fix.

## Darwin Results

Skipped — confirmed via `npx ruvector@0.3.1 harness darwin --help`: the real interface evolves routing/topology/prompt/memory/tool/tier/context/coordination genome *parameters* against a fitness-scored corpus (requires a JSON config + explicit `--execute`). Tonight's fix is a deterministic code-correctness fix (busy-poll → event-driven), not a search over a parameter space. Same skip class as #3110/#3160/#3184/#3221/#3243/#3266/#3302/#3330.

## Flywheel Evidence

No `.claude-flow/flywheel/` state exists in this repo (confirmed by direct directory check) and no signed `@metaharness/flywheel` bundle applies (confirmed via `npx ruvector@0.3.1 harness flywheel --help`: real `verify`/`gate` interface exists but targets a replay bundle this fix doesn't produce). Evidence retained as: the 4 new discriminating tests, this gist, the linked issue, the stash-isolated baseline-fails/candidate-passes comparison, the real wall-clock benchmark numbers, and the independent adversarial critique — consistent with every accepted dream-cycle night since 2026-08-18. Classified: OBSERVATION (both wait functions polled `state.tasks` despite already-emitted terminal events, confirmed via direct code read) / MEASUREMENT (baseline fails 3/4 discriminating assertions, candidate passes 4/4; 100.359ms→0.206ms wall-clock) / DECISION (ship as a scoped, additive event-driven rewrite) / REJECTION (none this round).

## Reward Hack Check

No standalone reward-hack CLI reachable (`npx ruvector@0.3.1 harness --help`: status/route/flywheel/darwin only). Manual checklist: no existing test weakened (new file only, 230 pre-existing untouched and re-verified green); no gold/expected data touched; no cherry-picking (full suite reported both ways); no seed manipulation (deterministic fake-timer + real-timer tests, no randomness); zero cost. Independent adversarial critic re-ran the full suite and the stash-isolation comparison itself rather than trusting this session's numbers.

## Security Review

Not security-sensitive: pure in-process EventEmitter listener wiring on an already-validated internal `taskId` string (generated by the coordinator itself via `submitTask()`, never caller-supplied raw text reaching this code path); no I/O/network/credential/filesystem surface. Checked for listener leaks (every exit path — immediate resolve, event resolve, timeout resolve/reject — removes both `task.completed`/`task.failed` listeners and clears the timeout) and for the retry-branch race (`handleTaskFail()`'s requeue path emits no event and leaves status `queued`, correctly not matched as terminal by either wait function).

## SOTA Proof & Witness

| Field | Value |
|---|---|
| Session commit | `e558f0c0fc29c1a658085f6e6f80ad27d4fe811f` |
| Gist SHA-256 (pre-witness content) | `eff14b59c1bf32bb8fc4296ee349c97051b877175c68d336a6f76c00a7ca5065` |
| Witness stamp | `12f7a08e367d9c2d8d63b8a86be6becbb5f59330cbb67bcbd173c41c1bd927b6` |

Verifier procedure: fetch this gist, strip the witness table's three filled values back to `PENDING` (restoring the exact three-row table above with all cells `PENDING`), SHA-256 it, concatenate with the session commit above, SHA-256 again — result must equal the witness stamp.

## Scan Findings: security

`v3/@claude-flow/cli/src/mcp-tools/terminal-tools.ts`'s `validateEnv()` denylist (`v3/@claude-flow/cli-core/src/mcp-tools/validate-input.ts:142-152`) blocks `LD_PRELOAD`/`LD_LIBRARY_PATH`/`LD_AUDIT`/`DYLD_*`/`NODE_OPTIONS`/`NODE_PATH` (added after a prior audit, `audit_1776853149979`) but **not `PATH`**. `terminal_execute` runs `execSync(command, { env: { ...process.env, ...session.env }, ... })`, so a caller-supplied `PATH` silently overrides the process `PATH` for every subsequent unqualified-binary invocation (`git`, `npm`, `node`, …) in that session — classic CWE-427 (Uncontrolled Search Path Element), persisted across calls via `.claude-flow/terminals/store.json`. `terminal_create`/`terminal_execute` are directly agent-invokable (wired into the same MCP registry as `http_fetch`). Evidence grade: **A** (CWE-427 is a well-established, precisely-matching category — cwe.mitre.org/data/definitions/427.html). Also re-verified: the 2026-09-15 `http_fetch` SSRF/DNS-rebinding finding (`validateUrl()` string-matches hostnames, never resolves DNS; `fetch()` follows redirects without per-hop re-validation) is **still live**, unchanged, still reachable via the same MCP registry. Not selected as tonight's candidate (SCAN surface); strong candidate for a future `security` DEEP night — recommend auditing the full uncontrolled-search-path family (`PATH`, `PYTHONPATH`, `PERL5LIB`, `RUBYLIB`, `GIT_EXTERNAL_DIFF`, `GIT_SSH_COMMAND`, `BASH_ENV`, `IFS`) across every MCP tool that merges caller env into a child process, not just adding `PATH` to this one denylist.

## Scan Findings: hive-mind

Two previously-flagged findings re-verified via direct code read (not assumed from prior nights' notes): (1) `hive-mind_init` writes a 5-way `state.consensusStrategy` but `hive-mind_consensus`'s handler reads a separate, narrower per-call `strategy` param instead (`hive-mind-tools.ts:619`) — **still live**, unchanged since 2026-08-24/09-15. (2) `byzantine.ts`'s `handleCommit()` PBFT path — **still live with a nuance**: ADR-095 G2 added real transport-wiring capability (constructor now wires a `transport` to `handleCommit` when passed), but the production factory (`ConsensusEngine.initialize()` → `unified-coordinator.ts:172`) never actually passes a `transport`, so `handleCommit` remains reachable only in tests. New finding tonight: `byzantine.ts`'s weighted-vote acceptance threshold (`requiredVotes = 2*f+1`, an absolute count) is never rescaled against the actual achievable weight sum after `voteWeight()`'s `[0,1]` safety clamp (added 2026-08-24) — if every voter's weight is below `(2f+1)/n`, a proposal can never reach `accepted` even with unanimous approval, silently masking true consensus as an `expired` timeout. Untested (existing `consensus.test.ts` covers single-outlier clamping and no-weights parity, not the all-voters-low-weight case). Recommended future `hive-mind` DEEP night: fix both the consensus-strategy dispatch gap and the weighted-threshold rescaling together (both touch vote-tally resolution), and decide whether to wire the byzantine transport or explicitly document `handleCommit` as unsupported in production.

## Competitors Reviewed

LangGraph, Microsoft Agent Framework/AutoGen, CrewAI, OpenAI Agents SDK (mandated floor, completion-signaling comparison); CWE/MITRE (security-scan comparison, PATH hijack); OWASP SSRF pattern (security-scan re-verification).

## Additional candidates surfaced but not selected tonight (STEP 3.2)

Scored under `0.25·Ruflo_fit + 0.20·testability + 0.20·measurability + 0.15·production_value + 0.10·novelty + 0.10·reviewability` (1-5 each):

1. **[4.75, selected] `UnifiedSwarmCoordinator` busy-poll → event-driven** (this candidate).
2. **[4.15] `ReasoningBank.retrieve()`'s MMR loop redundantly recomputes `maxSimilarity`** (`v3/@claude-flow/neural/src/reasoning-bank.ts:~302-343`) — the winning candidate's max-similarity is computed once in the inner loop, then recomputed from scratch one line later via a second call to `computeMaxSimilarity`. Smallest, safest patch of all five candidates (~5-10 lines) — good bonus/tomorrow pick.
3. **[4.05] `DualModeOrchestrator.waitForDependencies()`** (`v3/@claude-flow/codex/src/dual-mode/orchestrator.ts:~312-330`) — identical busy-poll pattern (`while` + `setTimeout(500)`) despite the same class already emitting `worker:completed`/`worker:failed`. Same shape as tonight's fix in a different file; deliberately down-weighted for novelty (would just repeat tonight's exact deferred-pick pattern elsewhere).
4. **[4.00] `HybridMemoryRepository.searchByVector()` brute-force scan** (`v3/@claude-flow/memory/src/infrastructure/repositories/hybrid-memory-repository.ts:~296-317`) — O(N·dim) cosine scan over every stored vector, no HNSW despite the repo's ADR-009 claims. Needs a real design decision (wrap `hnsw-index.ts` vs. document an N-limit), not a mechanical patch — better suited to a dedicated follow-up.
5. **[3.15] Same MMR loop, algorithmic rewrite to O(k·N) incremental max-sim** — real complexity win but changes selection semantics subtly if mishandled; correctness-risk-heavy, design-later.

## Recommended Next Steps

1. **Merge tonight's linked draft PR** (human review required).
2. **`ReasoningBank.retrieve()` MMR redundant-recompute fix** — smallest, safest of the deferred candidates; good for tomorrow or as a same-week bonus.
3. **`DualModeOrchestrator.waitForDependencies()` event-driven rewrite** — same fix class, different file; batch with candidate 2 above if a future night wants throughput.
4. **`terminal_execute` PATH-hijack hardening** (security scan finding, grade A) — add `PATH` (and ideally the full uncontrolled-search-path family) to `validateEnv()`'s denylist; concrete, well-scoped, high-confidence future `security` night candidate.
5. **`hive-mind` consensus-strategy dispatch + weighted-BFT threshold rescaling** (hive-mind scan finding) — fix together in a future `hive-mind` DEEP night, both touch vote-tally resolution.
