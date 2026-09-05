---
name: cost-budget-check
description: Read accumulated cost-tracking spend + budget config, compute utilization, emit 50/75/90/100% alert ladder
argument-hint: "[--period today|week|month|all]"
allowed-tools: Bash mcp__plugin_ruflo-core_ruflo__memory_retrieve mcp__plugin_ruflo-core_ruflo__memory_list mcp__plugin_ruflo-core_ruflo__memory_store
---

# Cost Budget Check

Reads `cost-tracking:budget-config` for the project's budget limit, sums `total_cost_usd` across `session-*` records produced by `cost-track`, computes utilization, and emits the **measured** 4-tier alert ladder (50% INFO / 75% WARNING / 90% CRITICAL / 100% HARD_STOP).

Until P2 (this skill) landed, the README documented the alert ladder but no code checked it. Now this skill is the gate.

## When to use

- After every cost-track run, to surface the alert level.
- Before spawning a swarm — if utilization ≥ 90%, escalate to `/cost-optimize` first.
- Cron-friendly via `/loop 30m` for continuous monitoring.

## Steps

1. **Run the check**:

   ```bash
   node plugins/ruflo-cost-tracker/scripts/budget.mjs check
   ```

   Filter by period: `BUDGET_PERIOD=today` (default `all`). Use `BUDGET_QUIET=1` for machine-readable JSON.

2. **Inspect the markdown summary** — budget, spent, remaining, utilization percentage, alert level (🟢 OK · 🟡 INFO · 🟠 WARNING · 🔴 CRITICAL · 🛑 HARD_STOP), and the recommended action.

3. **Set / inspect the budget**:

   ```bash
   node plugins/ruflo-cost-tracker/scripts/budget.mjs set 50.00
   node plugins/ruflo-cost-tracker/scripts/budget.mjs get
   ```

4. **HARD_STOP path** — `budget.mjs check` exits with code `1` when utilization ≥ 100%. Wrap critical agent spawns in a `budget.mjs check && spawn …` guard to fail closed.

## Storage shape (`cost-tracking:budget-config`)

```json
{
  "budget_usd": 50.00,
  "setAt": "2026-05-05T...",
  "thresholds": { "info": 0.50, "warning": 0.75, "critical": 0.90, "hard_stop": 1.00 }
}
```

## Alert ladder (from REFERENCE.md, now enforced)

| Threshold | Level | Action |
|---|---|---|
| 50% | INFO 🟡 | log notification, no UX disruption |
| 75% | WARNING 🟠 | display warning, suggest `/cost-optimize` |
| 90% | CRITICAL 🔴 | urgent alert, recommend model downgrades |
| 100% | HARD_STOP 🛑 | halt non-essential spawns; exit code 1 |

## Cross-references

- `cost-track` (producer) — populates `cost-tracking:session-*`
- `cost-report` — same data source, narrative format
- `cost-optimize` — recommended action when WARNING/CRITICAL
- REFERENCE.md "Budget alert thresholds" — the documented ladder this enforces
