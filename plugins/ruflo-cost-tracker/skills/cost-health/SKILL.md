---
name: cost-health
description: Composite CI gate — runs cost-budget-check + cost-burn + cost-anomaly + cost-projection in parallel and surfaces a single combined health status with max exit code. The operationally-useful entry point — one shell-out covers all four alert ladders.
argument-hint: "[--alert-acceleration 100] [--alert-outliers 1] [--alert-days-to-exhaust 14] [--skip burn,anomaly] [--format table|json]"
allowed-tools: Bash
---

The four CI-gate skills (budget / burn / anomaly / projection) each answer
a different question. This skill composes them — runs all four IN PARALLEL,
returns `max(exit_codes)`, prints a one-line summary per check.

| Subcheck | Question | Default threshold |
|---|---|---|
| `budget` | "Have we crossed the configured budget?" | HARD_STOP at 100% |
| `burn` | "Is daily burn accelerating?" | +100% vs prior-week mean |
| `anomaly` | "Is any specific session a >3.5σ outlier?" | ≥1 outlier |
| `projection` | "When will we hit 100% of budget?" | <14 days |

## Algorithm

Implementation: [`scripts/health.mjs`](../../scripts/health.mjs).

1. Spawn all four subcheck scripts in parallel (`Promise.all` over `child_process.spawn`).
2. Each subcheck emits `--format json`; parse and capture exit code.
3. Projection has no built-in exit code — synthesize one from `daysUntilReached[100%] < --alert-days-to-exhaust`.
4. Final exit code = `max(subcheck exits)`. Any single failure fails the gate.
5. Print one-line summary per check + overall HEALTHY/UNHEALTHY badge.

## CI integration

```yaml
- name: Cost health gate
  run: cost health --alert-acceleration 100 --alert-outliers 1
```

A single step covers four alert ladders. Before this skill you'd wire four
separate gates that each duplicated the npx + memory-list overhead; now it's
one shell-out (and the four subcheck npx calls run in parallel internally).

## Customizing thresholds

```bash
# Quarterly review — stricter thresholds
cost health --alert-acceleration 50 --alert-outliers 1 --alert-days-to-exhaust 30

# Production drift gate — only fire on egregious changes
cost health --alert-acceleration 200 --alert-outliers 3 --alert-days-to-exhaust 7

# Skip the slow burn check during a smoke run
cost health --skip burn
```

## Smoke transcript (5 healthy sessions, then add 1 outlier)

```
# Healthy
Overall: ✓ HEALTHY (max exit code 0)
| Check | Status | Detail |
| budget | ✓ | unknown — no budget configured |
| burn | ✓ | delta within ±100% |
| anomaly | ✓ | 0 outliers — under threshold ≥1 |
| projection | ✓ | no budget configured — skipping |

# After adding $5 outlier (vs $0.10 baseline)
Overall: ⚠ UNHEALTHY (max exit code 1)
| burn | ⚠ | ALERT 5163.2% acceleration: latest bucket $5.00 is 5163.2% above prior mean $0.095 |
| anomaly | ⚠ | ALERT 1 outlier (|z|>3.5) |
```

## Skipping subchecks

```bash
cost health --skip burn,projection   # only budget + anomaly
```

Useful when:
- A subcheck doesn't apply (no budget set → skip projection)
- A subcheck is too slow for fast-feedback contexts (smoke runs)
- A subcheck is being independently CI-gated already

## Exit code semantics

| Exit | Meaning |
|---|---|
| 0 | All subchecks OK |
| 1 | At least one subcheck fired an alert (budget HARD_STOP, burn drift, anomaly outlier, projection imminent-exhaust) |
| 2 | A subcheck had a config/usage error (e.g. invalid CLI args propagated to a subscript) |
| 127 | A subcheck failed to launch (script missing, etc.) |

`max()` means the worst signal wins — exit 2 (config error) always dominates
exit 1 (alert), so you spot misconfigured pipelines before they masquerade
as healthy.
