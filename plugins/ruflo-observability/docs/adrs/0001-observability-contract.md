---
id: ADR-0001
title: ruflo-observability plugin contract — pinning, namespace-routing fix, smoke as contract
status: Accepted
date: 2026-05-04
updated: 2026-05-09
authors:
  - reviewer (Claude Code)
tags: [plugin, observability, tracing, metrics, namespace, smoke-test]
---

## Context

`ruflo-observability` (v0.1.0) — structured logging, distributed tracing, metrics with anomaly detection. 1 agent + 2 skills + 1 command.

Same namespace-routing bug class as cost-tracker / market-data / migrations: both skills called `agentdb_hierarchical-recall` with namespace `observability` argument, but `agentdb_hierarchical-*` routes by tier (`working|episodic|semantic`) and ignores namespace strings.

## Decision

1. **Functional fix:** switch namespaced reads from `agentdb_hierarchical-recall` to `memory_search` / `memory_list` (namespace-routed) in both skills. Document the dual pattern-store path in observe-metrics.
2. Add this ADR (Accepted).
3. README augment: Compatibility (pin v3.6); Namespace coordination (claims `observability`); Verification + Architecture Decisions sections.
4. Bump `0.1.0 → 0.2.0`. Keywords add `mcp`, `distributed-tracing`, `anomaly-detection`.
5. `scripts/smoke.sh` — 10 structural checks: version + keywords; both skills + agent + command; skills use `memory_*` not `hierarchical-*` with namespace; v3.6 pin; namespace coordination; ADR Accepted; no wildcard tools.

## Consequences

**Positive:** real bugs fixed (silent ignored-namespace reads). Plugin joins the cadence.

**Negative:** none — anyone scripting against the broken tool calls was already silently failing.

## Verification

```bash
bash plugins/ruflo-observability/scripts/smoke.sh
# Expected: "10 passed, 0 failed"
```

## Related

- `plugins/ruflo-cost-tracker/docs/adrs/0001-cost-tracker-contract.md` — same bug class
- `plugins/ruflo-market-data/docs/adrs/0001-market-data-contract.md` — same bug class
- `plugins/ruflo-migrations/docs/adrs/0001-migrations-contract.md` — same bug class
- `plugins/ruflo-agentdb/docs/adrs/0001-agentdb-optimization.md` — namespace convention

## Implementation status

Plugin version v0.2.0 shipped and listed in marketplace.json. Source exists at `plugins/ruflo-observability/`. Contract elements implemented: namespace-routing bug fixed in both skills (switched `agentdb_hierarchical-recall` with namespace arg to `memory_search`/`memory_list`); dual pattern-store path documented in observe-metrics; smoke-as-contract gate defined in `scripts/smoke.sh`.
