---
name: cost-counterfactual
description: Multi-baseline counterfactual cost analysis. Compares actual session spend to hypothetical always-haiku / always-sonnet / always-opus routing baselines. Answers "is the routing earning its keep?" Negative savings flag over-escalation; positive savings quantify the router's win.
argument-hint: "[--since 7d] [--baseline always-haiku|always-sonnet|always-opus|all] [--format table|json]"
allowed-tools: Bash
---

Multi-baseline counterfactual cost analysis. Pairs with the existing observability surface:

- **`cost-budget-check`** — "have we crossed a threshold?" (reactive)
- **`cost-projection`** — "when will we cross a threshold?" (predictive)
- **`cost-counterfactual`** — "is the routing earning its keep?" (comparative) ← this one

## Algorithm

1. Read all `session-*` records from the `cost-tracking` namespace.
2. Apply `--since` window filter (default all-time).
3. Sum tokens across `byModel[*]` entries for each session.
4. For each requested baseline (default: all three):
   - `counterfactualUsd = (input × tier.input + output × tier.output + cache_write × tier.cache_write + cache_read × tier.cache_read) / 1M`
5. Compute `savings = counterfactualUsd − actualUsd`.
6. Emit per-baseline totals + savings % across the comparison set.

## Smoke transcript (2 sessions: 50K haiku tokens + 50K sonnet tokens)

```
| Sessions considered | 2 |
| Total input tokens  | 100,000 |
| Actual spend        | $0.162500 |

| Baseline           | Hypothetical | Actual    | Savings    | %       |
| `always-haiku`     | $0.025000    | $0.162500 | -$0.137500 | -550.00% |
| `always-sonnet`    | $0.300000    | $0.162500 | +$0.137500 |   45.83% |
| `always-opus`      | $1.500000    | $0.162500 | +$1.337500 |   89.17% |
```

## How to read negative savings

A negative `always-haiku` result means **the router chose more-expensive models than haiku** on tasks haiku could have handled. That's an over-escalation signal:
- Maybe qualityBar is set too high
- Maybe the sonnet/opus session was warranted by complexity but the baseline doesn't know that
- Run `cost optimize` (or inspect specific sessions via `cost conversation`) to investigate

Positive savings quantify the router's win against that baseline. The most informative number is usually `always-sonnet` — it's the standard "safe default" baseline most teams would pick if they didn't have routing.

## When to use

- **Quarterly cost review**: "We saved $X vs always-Sonnet — here's the proof."
- **CI gate**: `cost counterfactual --format json | jq '.baselines[1].savingsPct > 30'` — fail builds if routing isn't saving ≥30% vs sonnet baseline (workload-shift detector).
- **Routing-config validation**: When introducing a new qualityBar or cost-ceiling, re-run counterfactual to confirm savings didn't regress.

## Stationarity caveat

Like all counterfactual analyses, this assumes the same tokens at the same complexity would have produced the same outcome from the baseline model. That's an upper bound — the baseline might have failed and required retries, which the math doesn't capture. Treat the numbers as a quality-blind ceiling.
