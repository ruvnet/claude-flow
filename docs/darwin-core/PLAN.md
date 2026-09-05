# Darwin core-systems evolution loop — plan

Branch: `darwin/core-systems-evolution-2026-06-27`
Started: 2026-06-27
Predecessors: capability-evolution (BEIR retrieval, 30 ticks) + plugin-evolution (35 plugins, 4 ticks)
Inspired by: dream cycle #2478 (SKILL-DISCO, Verification Horizon, ContextForge — Grade A 2026 papers)

## Goal
Apply concurrent Darwin to ruflo's CORE STRENGTHS — self-learning + memory systems —
using worktree-isolated parallel agents so different code areas evolve without conflict.

## 6 dimensions

| # | Dimension | Existing bench | SOTA target |
|---|-----------|----------------|-------------|
| 1 | HNSW search (recall@10 / latency) | `scripts/benchmark-intelligence.mjs` | recall ≥ 0.99 @ N=20k, p50 < 1ms |
| 2 | SONA adaptation (per-pattern ms) | same script | < 0.005 ms/adapt (current 0.0043) |
| 3 | MoE gate convergence (rewards-to-confident) | same | < 100 episodes to 0.85 confidence |
| 4 | ReasoningBank retrieval (BEIR scifact ndcg10) | `run-beir-hybrid.mjs` | match BGE-large 0.74 (we're at 0.6256) |
| 5 | Causal memory graph (pathfinder accuracy + latency) | `smoke-graph-query-dispatch.mjs` | pass all 21 + <100ms p99 |
| 6 | Skill distillation (SKILL-DISCO baseline) | NONE YET — tick 1 writes it | +22% over no-distill (per arXiv 2026 paper) |

## Per-tick contract (per dimension, worktree-isolated)
1. Spawn `claude -p --max-budget-usd 0.50 --model haiku` in an isolated worktree
2. Read the dimension's source code + last benchmark result
3. Apply ONE focused change in the worktree (algorithm tweak, parameter, data structure swap)
4. Run that dimension's benchmark in the worktree → capture delta
5. If Δ > 0: commit in the worktree; orchestrator cherry-picks back to main branch
6. If Δ ≤ 0: discard the worktree (auto-removed)
7. Append JSONL line to docs/darwin-core/log.jsonl

## Concurrency
- 6 worktrees per tick, parallel via Workflow `parallel()` with `isolation: 'worktree'`
- Worktree setup overhead: ~200-500ms each, ~3s total — negligible vs benchmark cost

## Cron cadence
- /loop 15m (NOT 5m — benchmarks take real time)
- 7-day TTL, cron job ID will be returned on schedule

## Halt
- 3 consecutive ticks where ALL 6 dimensions log noImprovement
- OR explicit user stop (CronDelete)

## Budget envelope
- ~$3 per tick (6 agents × $0.50)
- ~30 min per tick (worst-case parallel benchmarks)
- 8-15 useful ticks before plateau → ~$40-60 total
