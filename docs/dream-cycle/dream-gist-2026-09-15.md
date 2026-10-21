# Performance SOTA Report — 2026-09-15

TL;DR: Tonight's `performance` deep-dive found that `MoERouter.route()` (`v3/@claude-flow/neural/src/moe-router.ts`) computes a Switch-Transformer-style load-balance auxiliary loss on every routing decision and returns it in `RoutingResult`, but `updateExpertWeights()` — the only method that ever mutates the gating network's weights — never read that loss or its coefficient anywhere in its REINFORCE gradient math. The load-balancing regularizer the module's own header claims ("Load balancing with auxiliary loss") had zero actual effect: the 8-expert gate was free to collapse onto a subset of experts under reward-only updates. Fixed by threading the auxiliary loss's analytic gradient (softmax-Jacobian derived, independently re-verified by an adversarial critic) into the existing gradient-update path. Five research roles ran in parallel tonight (deep researcher, security scan, hive-mind scan, competitor analyst, architecture reviewer); this was the architecture reviewer's top finding, selected over the deep researcher's own five scored candidates on evaluation-robustness grounds (see Hypothesis section).

## What's New in 2026

| Finding | Source | Confidence |
|---|---|---|
| Agent-aware KV-cache/prompt-cache management is an active 2026 research cluster (CacheScout/"Learning Agent Execution for KV-Cache Management") | arXiv:2608.14624 (Aug 2026) | C — single-source preprint |
| Session/agent-aware scheduling reduces multi-agent serving latency vs. per-request scheduling | Agentix, arXiv:2603.18897 (Mar 2026) | C |
| Congestion-based concurrency control improves agentic batch-inference throughput vs. naive continuous batching | CONCUR, arXiv:2601.22705 (Jan 2026) | C |
| Anthropic prompt caching is strictly prefix-based (tools→system→static→variable ordering); a named production case moved 7%→84% cache-hit rate, ~59% cost cut, by reordering | Cross-checked across 3+ independent write-ups of Anthropic's documented API contract, plus a named case (ProjectDiscovery) | B |
| Rule-based LLM routers add <1ms, embedding-based ~5ms, ML-classifier 50-100ms overhead — negligible next to 500-2000ms LLM latency | Vendor/blog routing-engineering guides (2026) | C |
| Qdrant shipped 4-bit TurboQuant quantization (Google Research); Weaviate shipped tenant-aware Rotational Quantization — both new 2026 compression points Ruflo's HNSW/quantization stack doesn't target | Qdrant official docs/benchmarks (A); Weaviate release notes via secondary aggregation (B) | A/B |
| No mainstream agent framework (LangGraph, Microsoft Agent Framework, CrewAI, OpenAI Agents SDK) has true Temporal-style durable execution with external-signal recovery — a shared, industry-wide gap, not a Ruflo-specific one | Diagrid critiques of LangGraph/MS Agent Framework/CrewAI/Google ADK/Strands, cross-checked against each vendor's own docs | B |

Full source list and per-claim grading detail: see tonight's research transcript (deep researcher + competitor analyst roles); condensed here per the 1500-word gist budget.

## Ruflo Current Capability

The MoE routing surface (`v3/@claude-flow/neural/src/moe-router.ts`) implements an 8-expert two-layer gating network (`Linear(384,128)+ReLU → Linear(128,8)+Softmax`) with online REINFORCE weight updates via `updateExpertWeights(expert, reward)`. It is called from production only for read-only routing (`v3/@claude-flow/cli/src/mcp-tools/hooks-tools.ts:4066`, the `memory search --mode moe` MCP tool path) — `updateExpertWeights()` itself has **zero production callers anywhere in `v3/`** (grep-confirmed, independently re-confirmed by tonight's adversarial critic). This matches recent nights' "correct-but-currently-dormant" pattern (cf. PR #3243's `AgentPool` fix). CLAUDE.md documents "MoE Gate ... converges — confidence 0.13→0.88" as a measured result; that convergence claim is about the *mechanism working when driven*, and is unaffected by tonight's fix (which restores a regularizer that only matters once real reward-driven updates are wired to a production caller — itself a candidate for a future `intelligence`/`swarm` night, see Recommended Next Steps).

Closed ground from recent performance nights (not rediscovered tonight): HNSW `efSearch`/recall tuning (2026-08-15, REJECTED), HNSW product-quantization dispatch (2026-08-25, ACCEPTED), dead `diskann-backend.ts` removal (2026-08-30), `cli-cold-start.bench.ts`'s fake `setTimeout`-based measurement (2026-09-05), MMR eager-tokenization in `smart-retrieval.ts` (2026-09-10, 5.88x measured speedup).

## Competitor Comparison

| Framework/System | Performance-relevant capability | Primary source | Grade |
|---|---|---|---|
| LangGraph | v1.0 (Oct 2025) ships durable-execution modes (`exit`/`async`/`sync`) trading checkpoint safety for latency; v1.2 (May 2026) added per-node timeouts | Official LangGraph docs/changelog | A |
| Microsoft Agent Framework (GA Apr 2026, AutoGen successor) | Checkpointing at end of each "superstep," pluggable storage w/ partition-key design for scale — but same "not true durable execution" critique as LangGraph applies | GitHub microsoft/agent-framework docs (A); Diagrid critique (B) | A/B |
| CrewAI | Role-based abstraction has real, disclosed token overhead; ChromaDB→LanceDB memory migration still has documented concurrent-writer crash reports | CrewAI GitHub issues #854/#1388 (real reported behavior) | A/B |
| OpenAI Agents SDK | Agent Builder/Evals sunsetting 2026-11-30 (announced 2026-06-03, read-only from Oct 31) — confirms and sharpens prior nights' finding; tracing on-by-default, guardrails default to parallel execution for latency | OpenAI's own deprecations page | A |
| Qdrant | 4-bit TurboQuant quantization (v1.18), 2x denser than scalar quantization at comparable recall — a genuine open gap for Ruflo (team has RaBitQ/Int8 expertise, hasn't targeted this compression point) | Qdrant official docs | A |
| Vespa | Continuous automated perf-regression suite on every release, ~4.9x speedup in a recent tensor-retrieval improvement — unusually transparent methodology for this space | Vespa benchmarks page / newsletter | A |

Synthesis: Ruflo's caveated HNSW numbers (1.9x–4.7x, honestly bounded by a documented crossover) remain more rigorous than most competitor claims in this space right now — a large fraction of "framework X benchmark 2026" search results are ungrounded SEO content (graded C, explicitly flagged rather than laundered as fact by tonight's competitor analyst). The durable-execution gap is real but shared industry-wide, not urgent to chase solo; the 4-bit/tenant-aware quantization gap (Qdrant/Weaviate) is a genuine, Ruflo-specific opportunity worth a future night.

## Hypothesis

> Given `MoERouter.route()` (`v3/@claude-flow/neural/src/moe-router.ts`) computing a Switch-Transformer-style load-balance loss `L = NUM_EXPERTS · loadBalanceCoef · Σᵢ(fᵢ·Pᵢ)` (fᵢ = historical per-expert load fraction, Pᵢ = softmax routing probability) on every call and returning it in `RoutingResult.loadBalanceLoss`, when `updateExpertWeights()` is changed to also compute this loss's analytic gradient w.r.t. the pre-softmax logits (`∂L/∂logit_k = NUM_EXPERTS·coef·P_k·(f_k − Σᵢ fᵢPᵢ)`, using a per-route() fraction snapshot cached specifically to avoid drift from intervening calls) and subtract it from the existing REINFORCE ascent gradient, then a reward=0 update on a routing history skewed toward one expert should measurably reduce that expert's future routing probability — relative to baseline, where a reward=0 call is a complete no-op (the REINFORCE gradient is identically zero, and no other gradient source exists) — subject to:
> 1. `loadBalanceCoef = 0` (explicit opt-out) keeps the update byte-for-byte the same no-op as today;
> 2. a genuine nonzero reward signal still dominates the update (additive, not replacing, REINFORCE);
> 3. all existing neural-package tests remain green;
> 4. fully deterministic, $0 evaluation cost, no LLM calls.

Frozen before evaluation; not modified after seeing results. **Selection note (STEP 3.2 override):** the deep researcher's own top-scored candidate ("instrument the already-wired Anthropic prompt cache," score 4.55) tied this candidate's score (4.55) under the same rubric, but requires live `ANTHROPIC_API_KEY` calls to demonstrate `cache_read_input_tokens > 0` — external network/cost/availability dependency, less robust to evaluate deterministically tonight. This candidate (from the architecture-reviewer role) matches the closed-ground "computed-but-discarded value" pattern (cf. PQ-dispatch #3094, HybridBackend weights #3119, MMR embedding-cosine #3169) with a proven track record of clean, fully-local, $0 evaluability — selected on that basis, not a higher raw score.

## Benchmarks / Evaluation

**evaluated: accepted (ACCEPT-scoped — see caveat below).** Real evaluator: Vitest 4.1.8, deterministic, $0, zero LLM calls. New file: `v3/@claude-flow/neural/__tests__/moe-router-load-balance.test.ts` (4 tests).

**Baseline vs. candidate, isolated via `git stash` of just the source file (test file kept):** the primary discriminating test fails against real baseline — `expected [0.1266,...] to not deeply equal [0.1266,...]` (byte-identical pre/post probability vectors, confirming reward=0 was a true no-op) — and passes against candidate. The other 3 tests pass both ways (they test orthogonal behavior: explicit opt-out via `loadBalanceCoef:0`, genuine-reward-still-works, and a basic shape sanity check) — not fix-dependent, confirming they aren't spuriously coupled. Re-run 25+ times (including by the independent critic) with **zero flakiness** despite `xavierInit()`'s unseeded `Math.random()` — the test's fixed near-zero-magnitude embedding keeps initial logits near-uniform regardless of the random draw, empirically confirmed stable.

Full `@claude-flow/neural` package suite: **136/136 passing** (132 pre-existing + 4 new), 0 regressions. `tsc --noEmit`: 0 errors.

**Independent adversarial critique (STEP 10, separate subagent, no authoring context):** verdict **CONFIRMED**. Independently re-derived the softmax-Jacobian gradient by hand and confirmed it matches the implementation exactly, including the ascent-vs-minimize sign convention; verified `lastLoadBalanceFractions` can never be read before a `route()` call (guarded by the pre-existing null-check on `lastProbs`); independently reproduced the stash-isolated baseline-fail/candidate-pass result; ran the full suite and typecheck itself; grepped the whole repo and confirmed `updateExpertWeights()` has zero production callers (while `route()` itself is live in production) — the scoping caveat reflected in this ACCEPT. One non-blocking cosmetic nit (a per-call `Float32Array` allocation inconsistent with the class's pre-allocated-buffer convention) — fixed same session (hoisted to a reused instance field), re-verified 136/136 green and clean typecheck after the fix.

## Darwin Results

Skipped — confirmed via `npx ruvector@0.3.0 harness darwin --help`: the real interface evolves routing/topology/prompt/memory/tool/tier/context/coordination genome *parameters* against a fitness-scored corpus. Tonight's fix restores an already-decided, already-parameterized mechanism (the Switch-Transformer aux loss, with its own pre-existing `loadBalanceCoef` default) to actually functioning — it isn't a search over a new parameter space. Same skip class as most recent nights (#3110, #3160, #3184, #3221, #3243, #3266, #3302).

## Flywheel Evidence

No `.claude-flow/flywheel/` state or signed `@metaharness/flywheel` bundle exists in this repo (confirmed via `npx ruvector harness flywheel --help`: real `verify`/`gate` interface exists but targets a replay bundle this deterministic code-correctness fix doesn't produce). Evidence retained as: the 4 new discriminating tests, this gist, the linked issue, the stash-isolated baseline-fails/candidate-passes comparison (reproduced independently by the critic), and the full adversarial critique transcript — consistent with every accepted dream-cycle night since 2026-08-18. Classified: OBSERVATION (`updateExpertWeights()` never referenced `loadBalanceLoss`/`loadBalanceCoef`, confirmed via direct code read + grep) / MEASUREMENT (baseline fails the discriminating assertion for the predicted mechanical reason, candidate passes, 132/132→136/136 pre-existing tests unchanged) / DECISION (ship as a scoped, additive gradient-wiring fix) / REJECTION (none this round).

## Reward Hack Check

No standalone reward-hack CLI reachable this session (`npx ruvector harness --help` lists `status`/`route`/`flywheel`/`darwin`, no generic diff/benchmark scanner — consistent with every recent night's own note). Manual checklist, independently re-verified by the adversarial critic: no existing test weakened (new file only, existing 132 untouched and re-verified green); no gold/expected data touched (none exists on this code path); no cherry-picking (full suite reported both ways); no seed manipulation (test is specifically designed to be robust to `xavierInit()`'s unseeded randomness, confirmed via 25+ repeated runs); zero cost. The unrelated `v3/pnpm-lock.yaml` diff in the working tree (from this session's fresh `pnpm install`) is lockfile metadata noise, not part of this candidate.

## Security Review

Not security-sensitive: pure in-process numeric array arithmetic on an already-validated 384-dim embedding vector; no I/O, network, credential, or filesystem surface touched. Independently confirmed by the adversarial critic. Checked for NaN/Infinity paths (fractions bounded [0,1], probs are valid softmax output with a `+1e-8` stability guard — no division in the new code at all) and for the balance term dominating a genuine reward signal at default config (bounded ≤ `coef·NUM_EXPERTS = 0.08` at default `coef=0.01`, vs. REINFORCE's ≤1 magnitude — won't realistically dominate).

## SOTA Proof & Witness

| Field | Value |
|---|---|
| Session commit | `2602b642d92234c710ffbe96bfb33007d481ceab` |
| Gist SHA-256 (pre-witness content) | `34faf6710b82b1477af9b6088329dedcff622ad90f22f37728c9083f928a0e21` |
| Witness stamp | `5e719b96e5bb13905960609266cebaf61d5979dc0b7c5f105f953eee30f4599b` |

Verifier procedure: fetch `docs/dream-cycle/dream-gist-2026-09-15.md` from this branch, strip the witness table's filled values back to `PENDING`, SHA-256 it, concatenate with the session commit above, SHA-256 again — result must equal the witness stamp.

## Scan Findings: security

`v3/@claude-flow/cli/src/mcp-tools/http-fetch-tools.ts`'s `validateUrl()` (line 46) blocks private/loopback/link-local addresses by string-matching the URL's literal hostname (IPv4 regex, `localhost`, IPv6 ULA/link-local prefixes) but never resolves DNS, and `fetch()` is called with the default `redirect: 'follow'` (deliberately kept, per an inline comment), with validation running exactly once pre-connection. This is a TOCTOU SSRF bypass of the tool's own documented "DEFAULT-REFUSES private addresses + loopback" contract: (1) an attacker-registered public hostname that resolves to `127.0.0.1`/`169.254.169.254` at fetch time passes the string check but connects internally (DNS rebinding); (2) a remote server can 302-redirect a validated request to an internal address, which `fetch()` follows without re-validation. `http_fetch` is wired into agent-invokable ops-bench tooling (ADR-164 §5.1.8), so this is reachable via normal tool use. Evidence grade: A-confidence in the underlying SSRF/DNS-rebinding/redirect-revalidation technique (well-established industry pattern per OWASP's SSRF Prevention Cheat Sheet approach), B for the specific "this exact agentic pattern" framing (no OWASP.org page found naming it precisely). Not selected as tonight's candidate (SCAN surface, lighter-weight); strong candidate for a future `security` DEEP night — fix is well-established (resolve-then-connect with IP re-validation per redirect hop).

## Scan Findings: hive-mind

Two previously-flagged gaps confirmed still live tonight (re-verified against current code, not assumed from prior nights' notes): (1) the "consensus-strategy-discard" bug flagged 2026-09-10 — `hive-mind_init` writes a 5-way strategy to `state.consensusStrategy` (`hive-mind-tools.ts:23-28,367`), but `hive-mind_consensus` reads a separate, narrower per-call `strategy` param instead (`hive-mind-tools.ts:619`, feeding `calculateRequiredVotes()`/`tryResolveProposal()`) — `consensusStrategy` never reaches vote resolution (grep-confirmed: only 4 refs, all in init/status display code), so `gossip`/`crdt` init-time strategy labels have zero corresponding resolution branch. (2) `byzantine.ts`'s `handleCommit()` dead-PBFT-path (flagged 2026-08-24) — still only reachable via direct unit-test invocation, no production transport wiring (grep-confirmed). Both are the same class of gap: a config surface structurally disconnected from the code path that actually decides outcomes. Recommendation: a future `hive-mind` DEEP night fixing both together (they both touch `calculateRequiredVotes`/`tryResolveProposal`) rather than separately.

## Competitors Reviewed

LangGraph, Microsoft Agent Framework/AutoGen, CrewAI, OpenAI Agents SDK (mandated floor); Qdrant, Weaviate, Milvus, LanceDB, Vespa (memory/vector-layer comparison, performance-scan relevant); OWASP SSRF Prevention Cheat Sheet pattern (security-scan comparison).

## Additional candidates surfaced but not selected tonight (STEP 3.2)

Scored under `0.25·Ruflo_fit + 0.20·testability + 0.20·measurability + 0.15·production_value + 0.10·novelty + 0.10·reviewability` (1-5 each):

1. **[4.55] Instrument the already-wired Anthropic prompt cache in `agent_execute` Tier-3** (`agent-execute-core.ts:263-300`) — `cache_control:ephemeral` is set but `cache_read_input_tokens`/`cache_creation_input_tokens` from the API response are discarded, so there's zero visibility into whether the caching is working. Requires live API calls to evaluate; see Hypothesis section for why this wasn't selected tonight despite the tied score.
2. **[4.40] Redundant `estimateSize()` recomputation in `CacheManager.delete()`/`evictLRU()`** (`v3/@claude-flow/memory/src/cache-manager.ts`) — re-serializes payloads already sized at `set()` time, on every eviction.
3. **[4.30] Orphaned persistent embedding cache in 3 of 4 `EmbeddingService` providers** (`v3/@claude-flow/embeddings/src/embedding-service.ts`) — `checkPersistentCache()`/`storePersistentCache()` defined, zero callers in `OpenAIEmbeddingService`/`TransformersEmbeddingService`/`AgenticFlowEmbeddingService` (the default `'auto'`-selected `RvfEmbeddingService` has its own working cache, unaffected).
4. **[4.25] `MessageBus.processQueues()` fixed 10ms-interval polling vs. event-driven delivery** (`v3/@claude-flow/swarm/src/message-bus.ts`) — every message hop waits for the next tick; a permanent 100Hz timer runs even on an idle bus. Larger/riskier patch (must preserve batching/priority/backpressure semantics), scoped as demonstrate-tonight/design-later.
5. **[4.10] Cross-process persistence for `task-embedder.ts`'s routing cache** — cold on effectively every CLI/`hook-handler.cjs` invocation given Ruflo's own prescribed short-lived-process workflow. Largest potential win, also the largest correctness-risk surface (concurrent-process writes, staleness) — design-only tonight.

Also from the architecture-reviewer role, not selected: `UnifiedSwarmCoordinator.waitForTaskCompletion()`/`waitForQueuedTask()` busy-poll `state.tasks` every 100ms via `setInterval` despite the class already emitting `task.completed`/`task.failed` events nothing subscribes to (`unified-coordinator.ts:1278-1365`) — a real latency/CPU-overhead finding (score ≈4.45 by the same rubric), close second to tonight's selection; and a minor `CacheManager.clear()` telemetry bug (`previousSize` always reports 0 — one-line fix, flagged as trivial/not worth a full candidate slot).

## Recommended Next Steps

1. **Merge tonight's linked draft PR** (human review required) — restores the MoE gate's load-balance regularizer with a discriminating, non-flaky test suite.
2. **Wire a real production caller to `updateExpertWeights()`** — tonight's fix is correct but currently dormant (no production code path calls it); pairs naturally with a future `intelligence`/`swarm` night that also revisits `priorDecay` (flagged 2026-09-12, still dead) in the same "implemented but never wired" family.
3. **`UnifiedSwarmCoordinator` event-driven task-completion wait** — close second candidate tonight (busy-poll → subscribe to already-emitted `task.completed`/`task.failed` events); good target for next `performance` or `swarm` night.
4. **`http_fetch` SSRF hardening** (security scan finding) — resolve-then-connect with per-redirect-hop IP re-validation; concrete, well-scoped future `security` night candidate.
5. **`hive-mind` consensus-strategy dispatch + byzantine dead-PBFT-path** (hive-mind scan finding) — fix together in a future `hive-mind` DEEP night, both touch the same tally-resolution functions.
