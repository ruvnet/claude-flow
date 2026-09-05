# Backtest throughput — bench results

Generated: 2026-05-20T20:36:00.334Z
Node: v22.22.1
Bars: 252 (1y daily)
Strategy: SMA(10) / SMA(50) crossover
Commission: 5 bps round-trip
Iterations: 100 (warmup: 10)
Seed: 314159

## Throughput

| Metric            | Value         |
|-------------------|---------------|
| Avg runtime       | 0.0402 ms |
| p50 runtime       | 0.0299 ms |
| p95 runtime       | 0.1203 ms |
| p99 runtime       | 0.3685 ms |
| Bars/sec          | 6271256 |

## Strategy metrics (last iteration)

| Metric            | Value         |
|-------------------|---------------|
| Final equity      | 1.0493 (vs 1.000 start) |
| Sharpe (ann.)     | 0.355 |
| Max drawdown      | -7.94% |
| Trade count       | 3 |

## Acceptance

- Avg runtime: **0.0402 ms** (target: <10 ms — PASS)
- Throughput: **6271256 bars/sec** (target: >25,000 bars/sec — PASS)

## Notes

- The reference scenario is deliberately small (1y / 1 symbol /
  1 strategy) so the bench measures the per-bar compute kernel,
  not memory pressure or GC behavior. Walk-forward and
  Monte-Carlo variants are upstream `npx neural-trader` features
  and are NOT modeled here.
- Commissions are applied as equity drag at fill time (5 bps
  round-trip is the SOTA mid-cap-ETF default the skill uses).

## Refs

- ADR-126 §SOTA delta — bench-driven perf work
- `plugins/ruflo-neural-trader/skills/trader-backtest/SKILL.md` — production backtest path
