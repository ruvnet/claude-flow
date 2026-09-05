---
name: cost-projection
description: Forward-looking spend extrapolation. Computes a USD-per-day rate from the recent measurement window, projects to 7d/30d/90d/365d horizons, and surfaces "days until budget exhausted" when a budget is configured. Predictive counterpart to `cost-budget-check` (reactive).
argument-hint: "[--window 7d] [--horizons 7d,30d,90d,365d] [--format table|json]"
allowed-tools: Bash
---

Forward-looking cost projection that pairs with `cost-budget-check`:

- **`cost-budget-check`** answers "have we crossed the line?" — reactive
- **`cost-projection`** answers "when will we cross the line?" — predictive

## Algorithm

1. Read all `session-*` records from the `cost-tracking` namespace (same source `cost-budget-check` uses).
2. Filter to a measurement window (default last 7 days on `capturedAt`/`startedAt`).
3. Compute the per-day burn rate: `windowSpend / windowDays`.
4. Linear-extrapolate to each requested horizon (default 7d/30d/90d/365d).
5. If a budget is configured (`budget-config` key set by `cost-budget set`):
   - Compute "days until 75% / 90% / 100% consumed" at the current rate.
   - Surface as a separate table block with `ALREADY REACHED` markers for thresholds already exceeded.

## Flags

  --window <duration>     Measurement window. `Nh|Nd|Nw|Nm`. Default `7d`.
  --horizons <csv>        Projection horizons. Default `7d,30d,90d,365d`.
  --format table|json     Default `table` (markdown).

Env: `PROJECTION_NAMESPACE` override (default `cost-tracking`), `PROJECTION_QUIET=1` (alias for `--format json`).

## Smoke transcript (3 sessions × $1 over 7d, $20 budget)

```
| Sessions in window | 3 |
| Window spend | $3.000000 |
| **USD per day** | **$0.428571** |
| All-time spend | $3.000000 across 3 sessions |

## Projected spend (linear extrapolation)
| Horizon | Days | Projected spend |
|---|---:|---:|
| 7d | 7 | $3.0000 |
| 30d | 30 | $12.8571 |

## Budget exhaustion ($20.00 configured)
| Threshold | Target | Remaining | Time at current rate |
|---|---:|---:|---|
| 75% | $15.00 | $12.00 | 28.0 days |
| 90% | $18.00 | $15.00 | 35.0 days |
| 100% | $20.00 | $17.00 | 39.7 days |
```

## When to use

- **Finance / SRE planning**: hand the JSON output to a budget dashboard for "are we on track for the quarter?".
- **CI gates**: `cost-projection --format json | jq '.budget.exhaustion[2].daysUntilReached < 7'` → fail builds when 100% exhaustion is < 1 week away.
- **Post-workload-shift sanity check**: after a big feature lands, re-run to verify the rate hasn't accelerated past expectations.

## Stationarity assumption

Linear extrapolation assumes the current rate holds. The footer reminds operators to re-run after workload shifts. For drift detection over MULTIPLE windows, pair with `cost-trend` (which already covers benchmark-drift).
