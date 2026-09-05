---
name: cost-booster-route
description: Route tasks through hooks_route, partition by Agent Booster availability, and report Tier 1 bypass utilization with $0 cost
argument-hint: "[--from-recent] | <task-description>"
allowed-tools: mcp__plugin_ruflo-core_ruflo__hooks_route mcp__plugin_ruflo-core_ruflo__memory_search mcp__plugin_ruflo-core_ruflo__memory_list Bash
---

# Cost Booster Route

Wraps `mcp__plugin_ruflo-core_ruflo__hooks_route` and reports how many tasks the 3-tier router classified as Agent Booster (Tier 1) eligible. Tier 1 bypasses run as WASM transforms — no LLM call, structurally **$0** cost.

## When to use

Before a batch of similar tasks, or when `cost-report` shows Sonnet/Opus spend on descriptions that look like simple transforms (`var-to-const`, `add-types`, `add-error-handling`, `async-await`, `add-logging`, `remove-console`).

## Steps

1. **Collect tasks** — single arg or recent entries from `cost-tracking` via `memory_search`. Cap batch at 50.
2. **Route each** — call `hooks_route` with the description; capture the full response string.
3. **Partition** — group by whether the response contains the literal `[AGENT_BOOSTER_AVAILABLE]` (Tier 1) vs. not (Tier 2/3). Extract `[TASK_MODEL_RECOMMENDATION] Use model="X"` when present.
4. **Compute spend** — Tier 1 partition: $0. Tier 2/3 partition: per-task upper-bound from REFERENCE.md pricing × recommended model.
5. **Report**

   ```
   === Booster bypass report ===
   Tasks analyzed:        50
   Tier 1 (booster):      18 (36%)  — $0.00
   Tier 2/3 (LLM):        32 (64%)  — $X.XX (upper-bound)
   Booster intents:       var-to-const (8), add-types (5), remove-console (5)
   ```

6. **Persist** — `memory_store --namespace cost-tracking --key "booster-route-$(date +%Y%m%d-%H%M%S)" --value '{"tier1": N, "tier2_or_3": M, ...}'` so `cost-report` picks up the tier signal.

## Caveats — claimed upstream, not yet verified

- `[AGENT_BOOSTER_AVAILABLE]` fires only when the upstream router populates `routeResult.agentBoosterIntent.type` (`v3/@claude-flow/cli/src/mcp-tools/hooks-tools.ts:1228`). The published CLI's semantic-VectorDb path does not always trigger the classifier — treat the partition as a **lower bound** on Tier 1 eligibility.
- CLAUDE.md root claims `<1ms` latency and `352× faster` than LLM. `<1ms` and `$0` are structural; `352×` is **claimed upstream, not yet verified** here. Report what the router actually returns.
- See `docs/benchmarks/0002-baseline.md` for the full upstream-claims-vs-measured table.

## Cross-references

ADR-0002 Decision #1 · ruflo-intelligence ADR-0001 §"Neutral" (closes the routing-outcomes loop via `cost-optimize` step 8) · CLAUDE.md root §"3-Tier Model Routing (ADR-026)".
