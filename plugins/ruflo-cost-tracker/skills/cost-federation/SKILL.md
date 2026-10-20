---
name: cost-federation
description: Consumer-side wiring for ADR-097 Phase 3 federation_spend events — per-peer rolling windows + suspension-threshold check
argument-hint: ""
allowed-tools: Bash
---

# Cost Federation

ADR-097 Phase 3 specifies a `federation_spend` event bus that publishes one event per `federation_send` completion: `{peerId, taskId, tokensUsed, usdSpent, ts}`. Cost-tracker is the declared consumer — it aggregates per-peer rolling windows (1h / 24h / 7d) and the federation breaker queries that aggregate to suspend peers exceeding the configured threshold.

**Phase 3 isn't landed upstream yet.** This skill is the consumer-side wiring; it activates the moment upstream publishes events to the `federation-spend` namespace. Until then it reports cleanly with a "no events found" notice.

## When to use

- Before opening federation traffic to a new peer — establish baseline.
- Periodically (e.g. `/loop 5m`) to monitor per-peer spend across windows.
- After ADR-097 Phase 2/3 lands — to verify breaker suspension reasoning.

## Steps

1. **Run the script**:

   ```bash
   node plugins/ruflo-cost-tracker/scripts/federation.mjs
   ```

   Optional env:
   - `FED_FORMAT=json` — JSON instead of markdown
   - `FED_NAMESPACE=federation-spend` — override target namespace
   - `FED_SUSPEND_THRESHOLD_USD=5.0` — breaker threshold (ADR-097 default)

2. **Inspect** — per-peer 1h/24h/7d windows of count + USD spent, plus a "Suspension threshold check" block flagging peers over the breaker line.

## Storage contract (consumer side)

When Phase 3 lands, events should be persisted to namespace `federation-spend` with key prefix `fed-spend-` and JSON value matching:

```json
{
  "peerId": "<peer-uuid>",
  "taskId": "<task-uuid>",
  "tokensUsed": 12345,
  "usdSpent": 0.0287,
  "ts": "2026-05-05T..."
}
```

The script reads any record matching that prefix, regardless of how upstream produces them. Multiple events per peer accumulate cleanly into the rolling-window sums.

## Cross-references

- [ADR-097: Federation budget circuit breaker](../../../../v3/docs/adr/ADR-097-federation-budget-circuit-breaker.md) — the complete spec
- `cost-report` — same data, different lens (cost-report focuses on local agent spend; this skill on per-peer federated spend)
- `ruflo-federation` plugin — the producer side (when Phase 3 lands)
