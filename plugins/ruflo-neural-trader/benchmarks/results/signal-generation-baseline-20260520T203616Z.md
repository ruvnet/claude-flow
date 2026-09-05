# trader-signal scan latency — bench results

Generated: 2026-05-20T20:35:54.111Z
Node: v22.22.1
Symbols: AAPL, MSFT, NVDA, TSLA, SPY
Window: 252 bars per symbol
Iterations per symbol: 200 (warmup: 20)
Seed: 137

## Per-symbol latency

| Symbol | Avg (µs) | p50 (µs) | p95 (µs) | p99 (µs) | Ops/sec   | Anomaly        |
|--------|----------|----------|----------|----------|-----------|----------------|
| AAPL   | 22.24    | 16.79    | 36.63    | 190.96   | 44965     | spike          |
| MSFT   | 8.68     | 7.25     | 7.87     | 98.29    | 115194    | normal         |
| NVDA   | 5.18     | 3.96     | 4.58     | 79.00    | 193229    | normal         |
| TSLA   | 5.41     | 4.04     | 4.54     | 99.38    | 184843    | spike          |
| SPY    | 8.78     | 7.75     | 8.08     | 79.63    | 113893    | spike          |

## Aggregate (full scan)

- Sum-of-avgs across 5 symbols: **0.050 ms**
- Sum-of-p95s across 5 symbols: **0.062 ms**

## Acceptance

- Worst-symbol avg latency: **22.24 µs** (target: <1000 µs — PASS)
- Full scan (sum-of-avgs) latency: **0.050 ms** (target: <10 ms — PASS)

## Notes

- This bench measures the **anomaly-detection arithmetic core**
  shared between the JS skill and the upstream `npx neural-trader`
  binary. It does NOT cover network fetch latency (~200 ms tail
  per cloud roundtrip), which dominates real-world `--signal scan`
  and is amortized across all symbols in one batch.
- Synthetic OHLCV is mulberry32-seeded, so results are stable
  across runs and CI workers.

## Refs

- ADR-126 §SOTA delta — bench-driven perf work
- `plugins/ruflo-neural-trader/skills/trader-signal/SKILL.md` — production scan path
