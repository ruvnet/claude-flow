# Intelligence SOTA Report — 2026-10-22

**TL;DR**: Tonight's rotation is `DEEP=intelligence`, `SCAN=capabilities,memory` (slot 2, no bonus deep-dive). Five-role research fan-out confirmed, via direct source inspection, a genuine statistical defect in `MoERouter.computeLoadBalanceLoss()` (`v3/@claude-flow/neural/src/moe-router.ts`): the load-balance loss mixes a historical routing fraction with one query's instantaneous gate probability, contradicting its own docstring ("P_i = average routing probability to expert i"). Fixed with a proper running average. Two other candidates (a confirmed-dead `AgentDB` path in `reasoning-bank.ts`; a stale perf claim served to Claude at session start) scored lower and were deferred.

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

`v3/@claude-flow/neural/src/moe-router.ts` (882 lines) is a real, from-scratch 384→128→8 gating network (matmul/softmax/REINFORCE backprop). A prior, already-merged fix (visible in-source, not in the last 14 ledger rows) wired the load-balance auxiliary loss into `updateExpertWeights()`'s gradient — correct, untouched tonight. What remained broken: `computeLoadBalanceLoss()`'s diagnostic value, returned in every `RoutingResult`, used `this.probs[i]` — commented `// Current routing prob` — as if it were `P_i = average routing probability to expert i`. Confirmed via direct read: `fraction` is a cumulative average since start; the paired `avgProb` was never averaged, so the reported loss swings on single-query noise. Zero consumers outside the file (grepped whole repo) — a monitoring-correctness gap, zero risk to routing or the gradient.

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

Ruflo's SONA/MoE convergence numbers sit ahead of a field where almost nobody publishes in-loop-adaptation numbers (no apples-to-apples baseline exists — grade C). HNSW 1.9x–4.7x is modest but credible against the churn literature above, matching the orphan/tombstone tradeoff Ruflo already fixed once (#4270/#4271).

## Candidate Generation (STEP 3.2, scored 1–5 per axis; score = 0.25·fit + 0.20·testability + 0.20·measurability + 0.15·production + 0.10·novelty + 0.10·reviewability)

| # | Candidate | fit | test | meas | prod | novel | rev | **score** |
|---|---|---|---|---|---|---|---|---|
| 1 | **MoE `computeLoadBalanceLoss()` timescale-mismatch fix** (selected) | 5 | 5 | 5 | 4 | 5 | 4 | **4.75** |
| 2 | `reasoning-bank.ts` dead `AgentDB` integration (confirmed doubly-dead: methods no-op AND `initialize()` never called in production) | 5 | 5 | 4 | 3 | 2 | 5 | 4.20 |
| 3 | `guidance-provider.ts:84-85` stale hardcoded "150x-12,500x"/"2.49x-7.47x" fed into live SessionStart context | 4 | 4 | 3 | 4 | 3 | 5 | 3.85 |
| 4 | `claims check/grant/revoke` RBAC surface — advisory-only, zero enforcement consumer in MCP/CLI dispatch | 3 | 3 | 2 | 3 | 4 | 3 | 2.95 |
| 5 | HNSW tombstone-threshold hardening inspired by Qdrant/arXiv:2512.18060 | 2 | 2 | 2 | 2 | 3 | 2 | 2.10 |

#1 wins on novelty and measurability, the two axes separating it from #2, whose score is held down by being the 4th instance of the "dead native-integration" bug class (diskann-backend.ts 08-30, graph-analyzer.ts 10-10, agentdb-backend.ts 10-17/#4322) and by being currently cosmetic in production (confirmed: `initialize()` is never called today). #3 is compelling and arguably higher-urgency (actively-served false claims) but is `memory`-surface SCAN territory tonight — deferred to a future `memory` night. #4/#5 deferred as `capabilities`/future-`intelligence` scan findings.

## Hypothesis (frozen before evaluation)

> Given `MoERouter.computeLoadBalanceLoss()`, when the per-expert `avgProb` term is changed from the single most-recent `route()` call's instantaneous gate probability to a properly maintained running mean of `this.probs[i]` across all prior calls (mirroring the existing `fraction = routingCounts[i]/totalRoutings` running-average pattern, including matching update timing), then the returned `loadBalanceLoss` should correctly track long-run per-expert probability-assignment history instead of single-query noise — concretely, on a call following a run of N identical-input calls, the fixed loss must equal the hand-computed value using that run's stable probability vector, which the baseline does not — subject to: (1) zero change to `route()`'s expert-selection output for any input; (2) zero change to `updateExpertWeights()`'s gradient formula/values; (3) zero regression to the existing 7-test `moe-router-load-balance.test.ts` suite; (4) deterministic, $0, zero-LLM Vitest evaluation. Not modified after evaluation begins.

## Benchmarks / Evaluation

**evaluated: accepted.** Real evaluator: Vitest 4.1.8, `@claude-flow/neural`, after a fresh `pnpm install --filter @claude-flow/neural...`. 4 new tests (2 discriminating, 2 persistence/compat). Stash-isolated baseline: **2/2 discriminating tests fail exactly as predicted** — loss `7.993` vs. hand-computed-expected `1.020` on a deliberately-divergent input; `saved.stats.probSums` undefined pre-fix. Candidate: **11/11 pass**. Independently reproduced from scratch by an adversarial-critic subagent (own stash/pop cycle, hand-traced the averaging timing, verified `route()`'s selection output and `updateExpertWeights()`'s gradient are both unaffected): same result (`7.914` vs. `1.018` — small numeric difference from a separate random init, same qualitative gap). Full `@claude-flow/neural` suite: **143/143 both ways**, zero regressions, independently reproduced. `tsc --noEmit`: clean both ways.

## Darwin Results

Skipped — binary diagnostic-correctness fix, no continuous/categorical parameter for Darwin's real interface (`npx ruvector harness darwin <config> --execute`, confirmed available v0.9.2) to search over. Same skip class as nearly every accepted fix in this repo's history.

## SOTA Proof & Witness

```
Session commit:   5d99b57e7862c0623cf26e0c152dff60e3b50346
Report SHA-256:   6d784e25a52a2428c418d1866244eac8eb078f084b1c0f450e09591e74bc9c88
Witness stamp:    c2d961941a3a88676ad7aec4c1298cd83ee8aaaf473641e6b2832957fccbe945
```
Verifier: fetch this file from `dream/2026-10-22-intelligence`, strip the Witness block back to the two `PENDING` placeholders above, SHA-256 the file, concatenate that hash with the session commit, SHA-256 again — must equal the witness stamp.

**Reward hack check**: clean, independently re-verified by the adversarial critic from a fresh context — no test weakened, no gold data touched, no cherry-picking (full suite disclosed both ways), no evaluator exploitation, $0 cost, no seed/RNG manipulation, both new discriminating tests confirmed to actually discriminate rather than being vacuous. No standalone reward-hack CLI reachable this session (same disclosed gap as every recent night).

**Security review**: not security-sensitive — pure in-memory `Float32Array` arithmetic plus one new field in a JSON model file the module already owns. Independent critic: **CONFIRMED-WITH-CAVEATS, no blocking issues.** Two non-blocking caveats: (1) `probSums` is a plain running sum, not numerically-stabilized — disclosed in-source as a KNOWN LIMITATION comment, affects only the diagnostic value at very large (>=1e6) `totalRoutings`, never training; (2) `loadWeights()`'s fallback has no array-length validation, mirroring the pre-existing, unchanged `routingCounts` fallback — not a new gap.

## Recommended Next Steps

1. **Fix `guidance-provider.ts:84-85`** (memory scan): hardcoded `150x-12,500x`/`2.49x-7.47x` strings are still actively served to Claude via `generateSessionContext()` — the SessionStart hook injection path — contradicting every corrected doc site in the repo. Add a regression test asserting the output never contains those retracted substrings.
2. **Wire real enforcement for `claims check/grant/revoke`** (capabilities scan) or stop documenting it as "authorization" — pure advisory JSON CRUD with zero consumer in `mcp-server.ts`/`server.ts`'s real `tools/call` dispatch, unlike `.harness/mcp-policy.json`'s PolicyEnforcer, which *is* wired in.
3. **Revisit `reasoning-bank.ts`'s dead `AgentDB` integration** before anyone wires `initialize()` into production — today it's cosmetic; once wired it opens a real SQLite-backed AgentDB for zero benefit since the controller calls still throw/no-op. Mirror #4322's real-fix shape (import `HNSWIndex` directly) rather than pure deletion, if production value is wanted.
4. **Correct `v3/@claude-flow/cli/src/commands/neural.ts:1993`**: tells users `npm install @metaharness/router@^0.4.0` (caret), contradicting ADR-150's tilde-pin mandate (`~0.3.2`) for this exact package's documented rapid-breaking-release risk.
