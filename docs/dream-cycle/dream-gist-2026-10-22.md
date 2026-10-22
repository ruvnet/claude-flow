# Intelligence SOTA Report — 2026-10-22

**TL;DR**: Tonight's rotation is `DEEP=intelligence`, `SCAN=capabilities,memory` (slot 2, `DAYINT=20261022`, no bonus deep-dive). Five-role parallel research fan-out confirmed, via direct source inspection (not just the subagent's claim), a genuine, previously-unreported statistical defect in `MoERouter.computeLoadBalanceLoss()` (`v3/@claude-flow/neural/src/moe-router.ts`): the auxiliary load-balance loss mixes a long-run historical routing fraction with a single most-recent query's instantaneous gate probability, contradicting its own docstring ("P_i = average routing probability to expert i"). Fixed by adding a proper running average. Two other viable candidates (a confirmed-dead `AgentDB` integration in `reasoning-bank.ts`, and a stale hardcoded perf claim actively served to Claude at session start) were scored lower and deferred.

## What's New in 2026

| Finding | Source | Confidence |
|---|---|---|
| Graph-ANN dynamic-deletion benchmark: tombstone+scan-merge beats full rebuild on recall under churn, but latency degrades as live-tombstone count grows | arXiv:2512.18060 | A |
| Skill-MoE: training-free instance-level MoE router, top-k expert selection + aggregation, ICML 2026 | arXiv:2503.05641 | A |
| Google's own ReasoningBank: distills strategies from both successful and failed trajectories | research.google blog + ICLR 2026 submission | A/B |
| ATLAS: gradient-free continual learning via distilled-guidance memory instead of weight updates, 86% cost cut vs. GPT-5(High) | arXiv:2511.01093 | A |
| RouteLLM cost-aware routing (85%/45%/35% cost cuts); independently re-tested by LLMRouterBench (2026), which found several routers converge under unified eval | ICLR 2025 + 2026 re-benchmark | A |
| No paper combines LoRA online distillation with ReasoningBank-style trajectory memory; no EWC-for-agent-memory-store study exists (2026 agent-optimizer survey treats EWC only as a weight-level analogy) | arXiv:2607.14004 + targeted search | A (negative result) |
| No credible reproducible current FlashAttention CPU benchmark exists to replace Ruflo's own removed 2.49x–7.47x claim | targeted search, C-grade source only | — (confirms Ruflo's doc correction was right) |

## Ruflo Current Capability

`v3/@claude-flow/neural/src/moe-router.ts` (882 lines) is a real, from-scratch 384→128→8 gating network (matmul/softmax/REINFORCE backprop, no stub). A prior, already-merged fix (visible in-source, pre-dating tonight, not a dream-cycle ledger row found in the last 14) wired the load-balance auxiliary loss into `updateExpertWeights()`'s gradient — that mechanism is correct and untouched tonight. What remained broken: `computeLoadBalanceLoss()` itself, the diagnostic value returned in every `RoutingResult`, used `this.probs[i]` — literally commented `// Current routing prob` — as if it were `P_i = average routing probability to expert i` (the method's own docstring). Confirmed via direct read (not assumed): `fraction` is a cumulative average since start; the paired `avgProb` was never averaged at all, so the reported loss swings on single-query noise instead of reflecting real historical skew. Zero consumers outside the file itself (grepped whole repo) — purely a monitoring-correctness gap, zero risk to actual routing or the already-correct gradient.

## Competitor Comparison

| System | Capability | Evidence | Grade |
|---|---|---|---|
| Qdrant | index-maintenance | soft-delete; physical purge gated on size AND count thresholds — a lone deletion can sit un-purged | A |
| Weaviate | index-maintenance | async tombstone sweep (~300s cycle); deleted objects remain queryable until it runs | B |
| LangGraph/CrewAI/AutoGen/OpenAI Agents SDK | continual-learning | **None** implement weight-level adaptation (EWC/SONA-style) — "learning" is entirely extrinsic memory writes | — (deliberate boundary, not a gap: fine-tuning per-agent weights is operationally fragile; field externalizes learning into a memory layer instead) |
| LangGraph/CrewAI/AutoGen/OpenAI Agents SDK | routing | **None** ship a native benchmarked cost-aware router — delegated to Azure Model Router / RouteLLM | — (same boundary: framework authors don't want to own model-quality tradeoffs) |
| Microsoft Foundry Model Router | routing | single deployment routes 18 models on Quality/Cost/Balanced modes | B |
| Zep/Graphiti | continual-learning | bi-temporal model — contradicted facts get `invalid_at`, not deletion | B |
| Mem0 | benchmark | vendor self-report 94.4% LongMemEval vs. independent third-party 49.0%, non-comparable harnesses | C |
| EWC on Gemma2-2B continual pretraining | continual-learning | full-param EWC mitigated forgetting across 7 NLU benchmarks | B |

Ruflo's SONA (0.0043ms/adapt) and MoE convergence numbers sit ahead of a field where almost nobody publishes in-loop-adaptation numbers at all (no apples-to-apples baseline exists — grade that comparison itself C). The HNSW 1.9x–4.7x figure is modest but credible against the churn literature above, which documents the exact orphan/tombstone tradeoff Ruflo already fixed once (#4270/#4271).

## Candidate Generation (STEP 3.2, scored 1–5 per axis; score = 0.25·fit + 0.20·testability + 0.20·measurability + 0.15·production + 0.10·novelty + 0.10·reviewability)

| # | Candidate | fit | test | meas | prod | novel | rev | **score** |
|---|---|---|---|---|---|---|---|---|
| 1 | **MoE `computeLoadBalanceLoss()` timescale-mismatch fix** (selected) | 5 | 5 | 5 | 4 | 5 | 4 | **4.75** |
| 2 | `reasoning-bank.ts` dead `AgentDB` integration (confirmed doubly-dead: methods no-op AND `initialize()` never called in production) | 5 | 5 | 4 | 3 | 2 | 5 | 4.20 |
| 3 | `guidance-provider.ts:84-85` stale hardcoded "150x-12,500x"/"2.49x-7.47x" fed into live SessionStart context | 4 | 4 | 3 | 4 | 3 | 5 | 3.85 |
| 4 | `claims check/grant/revoke` RBAC surface — advisory-only, zero enforcement consumer in MCP/CLI dispatch | 3 | 3 | 2 | 3 | 4 | 3 | 2.95 |
| 5 | HNSW tombstone-threshold hardening inspired by Qdrant/arXiv:2512.18060 | 2 | 2 | 2 | 2 | 3 | 2 | 2.10 |

#1 wins on every axis-pair except reviewability (a pure-deletion fix is marginally easier to review) and is the only candidate with both high novelty (fresh, zero prior ledger history) and high measurability (hand-computable expected loss value). #2's low score is driven by novelty (4th instance of the "dead native-integration" bug class: diskann-backend.ts 08-30, graph-analyzer.ts 10-10, agentdb-backend.ts 10-17/#4322) and the architecture reviewer's finding that it's currently cosmetic (the AgentDB path is never reached in production today — a live landmine, not an active bug). #3 is compelling and arguably higher-urgency (actively-served false claims) but is `memory`-surface SCAN territory tonight, not `intelligence`-surface DEEP — deferred with full detail to a future `memory` night. #4/#5 deferred as `capabilities`/future-`intelligence` scan findings.

## Hypothesis (frozen before evaluation)

> Given `MoERouter.computeLoadBalanceLoss()`, when the per-expert `avgProb` term is changed from the single most-recent `route()` call's instantaneous gate probability to a properly maintained running mean of `this.probs[i]` across all prior calls (mirroring the existing `fraction = routingCounts[i]/totalRoutings` running-average pattern, including matching update timing), then the returned `loadBalanceLoss` should correctly track long-run per-expert probability-assignment history instead of single-query noise — concretely, on a call following a run of N identical-input calls, the fixed loss must equal the hand-computed value using that run's stable probability vector, which the baseline does not — subject to: (1) zero change to `route()`'s expert-selection output for any input; (2) zero change to `updateExpertWeights()`'s gradient formula/values; (3) zero regression to the existing 7-test `moe-router-load-balance.test.ts` suite; (4) deterministic, $0, zero-LLM Vitest evaluation. Not modified after evaluation begins.

## Benchmarks / Evaluation

PENDING — see PR for the full evaluation receipt (stash-isolated baseline-vs-candidate, `tsc --noEmit`, full `@claude-flow/neural` suite, persistence round-trip).

## Darwin Results

PENDING — see PR.

## SOTA Proof & Witness

PENDING — witness computed after this report is finalized (STEP 16).

## Recommended Next Steps

1. **Fix `guidance-provider.ts:84-85`** (memory scan, this session): hardcoded `150x-12,500x`/`2.49x-7.47x` strings are still actively served to Claude via the `session`/`guidance` CLI's `generateSessionContext()` — the exact SessionStart hook injection path — contradicting every corrected doc site in the repo. Add a regression test asserting the output never contains those retracted substrings.
2. **Wire real enforcement for `claims check/grant/revoke`** (capabilities scan, this session) or stop documenting it as "authorization" — it is pure advisory JSON CRUD with zero consumer in `mcp-server.ts`/`server.ts`'s real `tools/call` dispatch, unlike `.harness/mcp-policy.json`'s PolicyEnforcer, which *is* wired in.
3. **Revisit `reasoning-bank.ts`'s dead `AgentDB` integration** before anyone wires `initialize()` into production (easy, "obviously correct" change someone will eventually make) — today it's cosmetic; the moment it's wired, it opens a real SQLite-backed AgentDB for zero benefit since the controller calls still throw/no-op. Mirror #4322's real-fix shape (import `HNSWIndex` directly) rather than pure deletion, if production value is wanted.
4. **Correct `v3/@claude-flow/cli/src/commands/neural.ts:1993`**: tells users `npm install @metaharness/router@^0.4.0` (caret), contradicting ADR-150's explicit tilde-pin mandate (`~0.3.2`) for this exact upstream package's documented rapid-breaking-0.x-release risk.
