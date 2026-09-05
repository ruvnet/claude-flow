---
name: cost-burn
description: Burn-rate trend over time with optional drift-alert exit code. Bins session spend into buckets, surfaces window-over-window delta, and can exit 1 when latest bucket exceeds prior mean by a configurable %. Distinct from `cost-trend` (benchmark drift); this tracks PRODUCTION spend trajectory.
argument-hint: "[--bucket 1d] [--lookback 14d] [--alert-on-acceleration-pct 50] [--format table|json]"
allowed-tools: Bash
---

Burn-rate trend observability. The fourth leg of the cost-tracker forward-cost stack:

| Question | Skill |
|---|---|
| "Have we crossed a threshold?" (reactive) | `cost-budget-check` |
| "When will we cross a threshold?" (predictive) | `cost-projection` |
| "Could we have spent less?" (comparative) | `cost-counterfactual` |
| "Is daily burn ACCELERATING?" (trend) | **`cost-burn`** ← this |

## Algorithm

Implementation: [`scripts/burn.mjs`](../../scripts/burn.mjs).

1. Read all `session-*` records from `cost-tracking` namespace.
2. Bin into `--bucket` duration windows (default `1d`) over `--lookback` (default `14d`).
3. For each bucket: `{n: sessions, spendUsd: sum(total_cost_usd)}`.
4. Compute `delta = latest.spendUsd - mean(prior non-empty buckets)`.
5. If `--alert-on-acceleration-pct N` is set: exit 1 when `deltaPct > N`.

## Smoke transcript (5 days @ $0.10/day, today $0.50 — 400% acceleration)

```
| Latest bucket spend | $0.500000 (1 sessions) |
| Prior bucket mean | $0.100000 (4 non-empty buckets) |
| **Delta (latest vs prior mean)** | **+$0.400000 (400.00%)** |

# | Window                              | Sessions | Spend
0 | 2026-06-15 14:16 → 2026-06-16 14:16 | 1        | $0.500000
1 | 2026-06-14 14:16 → 2026-06-15 14:16 | 0        | $0.000000
2 | 2026-06-13 14:16 → 2026-06-14 14:16 | 1        | $0.100000
3 | 2026-06-12 14:16 → 2026-06-13 14:16 | 1        | $0.100000
...
```

## Drift alert exit code

  $ cost burn --bucket 1d --lookback 7d --alert-on-acceleration-pct 50
  ⚠ ALERT: latest bucket $0.500000 is 400.0% above prior mean $0.100000 (threshold +50%)
  exit 1

  $ cost burn --bucket 1d --lookback 7d --alert-on-acceleration-pct 500
  ✓ latest bucket within +500% of prior mean (actual delta: 400.0%) — OK
  exit 0

## CI integration

```bash
# Fail the build if today's spend accelerated > 100% over the weekly mean
cost burn --bucket 1d --lookback 7d --alert-on-acceleration-pct 100 || alert-oncall
```

The alert is independent of budget — it triggers on rate ACCELERATION even
when total spend is well under budget. Catches "we shipped a hot loop that
burns 10× normal" before the budget alarm goes off.

## Distinct from `cost-trend`

| Skill | Data source | Question |
|---|---|---|
| `cost-trend` | `docs/benchmarks/runs/*.json` | "Is the benchmark drifting (win rate, latency)?" |
| `cost-burn` | `cost-tracking` namespace | "Is production spend accelerating?" |

Both useful; they answer different questions on different data.

## Edge cases

- Sparse history (no prior non-empty buckets): alert is SKIPPED with a reason string, exit 0. Operators don't get spurious alerts on cold-start.
- Prior buckets all $0 but latest > $0: delta is `Infinity`/`null` in JSON, marked `new` in the table. No alert fires (no baseline to compare against).
- `--bucket` > `--lookback`: hard error, exit 2.
