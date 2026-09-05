---
id: ADR-0001
title: ruflo-market-data plugin contract — pinning, namespace coordination, namespace-routing fix, embeddings_generate fix, smoke as contract
status: Accepted
date: 2026-05-04
updated: 2026-05-09
authors:
  - reviewer (Claude Code)
tags: [plugin, market-data, ohlcv, candlestick, namespace, hnsw, smoke-test]
---

## Context

`ruflo-market-data` (v0.1.0) — feed ingestion, OHLCV normalization, candlestick pattern detection. 1 agent + 2 skills + 1 command (5 subcommands).

### Three real bugs found in skills

1. `market-ingest/SKILL.md` referenced `mcp__plugin_ruflo-core_ruflo__embeddings_embed` — that tool name does not exist. Real tool is `embeddings_generate` (per [ruflo-knowledge-graph ADR-0001](../../ruflo-knowledge-graph/docs/adrs/0001-knowledge-graph-contract.md), same fix).
2. `market-ingest/SKILL.md` used `agentdb_hierarchical-store` with `namespace: 'market-data'`. Per [ruflo-agentdb ADR-0001 §"Namespace convention"](../../ruflo-agentdb/docs/adrs/0001-agentdb-optimization.md), `agentdb_hierarchical-*` routes by **tier** (`working|episodic|semantic`), not namespace. The namespace arg was silently ignored.
3. `market-pattern/SKILL.md` had the same hierarchical-recall + namespace bug **plus** the same pattern-store + namespace bug as ruflo-cost-tracker (`agentdb_pattern-store` with `namespace: 'market-patterns'` — ReasoningBank ignores namespace).

All three fixed in this ADR pass by switching to `memory_*` (namespace-routed) for the load/store paths and documenting the dual write path for optimization-style patterns (per the cost-tracker precedent).

### Other gaps

1. No plugin-level ADR.
2. No smoke test.
3. No Compatibility section.

## Decision

1. **Functional fixes:**
   - `market-ingest`: rename `embeddings_embed` → `embeddings_generate`; switch load/store from `agentdb_hierarchical-*` to `memory_*` (namespace-routed).
   - `market-pattern`: switch load from `agentdb_hierarchical-recall` to `memory_search`; document the dual write path for pattern-store (typed via ReasoningBank vs. namespace-routable via `memory_store`).
2. Add this ADR (Proposed).
3. README augment: Compatibility (pin v3.6); Namespace coordination (claims `market-data` and `market-patterns`); Verification + Architecture Decisions sections.
4. Bump `0.1.0 → 0.2.0`. Keywords add `mcp`, `candlestick-patterns`, `namespace-routing`.
5. `scripts/smoke.sh` — 11 structural checks: version + keywords; both skills + agent + command with valid frontmatter; **regression checks**: `embeddings_embed` not at any tool-call site, skills use `memory_*` for namespaced reads (not `agentdb_hierarchical-*` with namespace arg); 5 subcommands documented; v3.6 pin; namespace coordination; `market-data` + `market-patterns` claimed; ADR Proposed; no wildcard tools.

## Consequences

**Positive:** three real bugs fixed. Plugin joins the cadence. Sibling pattern from cost-tracker ADR-0001 (dual write path) and knowledge-graph ADR-0001 (embeddings_generate rename) is now applied consistently.

**Negative:** anyone scripting against the broken tool calls was already silently failing. Net zero on real impact.

## Verification

```bash
bash plugins/ruflo-market-data/scripts/smoke.sh
# Expected: "11 passed, 0 failed"
```

## Related

- `plugins/ruflo-cost-tracker/docs/adrs/0001-cost-tracker-contract.md` — same namespace-routing bug class
- `plugins/ruflo-knowledge-graph/docs/adrs/0001-knowledge-graph-contract.md` — same `embeddings_embed` rename
- `plugins/ruflo-agentdb/docs/adrs/0001-agentdb-optimization.md` — namespace convention this ADR fixes a violation of

## Implementation status

Plugin version v0.2.0 shipped and listed in marketplace.json. Source exists at `plugins/ruflo-market-data/`. Contract elements implemented: `embeddings_embed` → `embeddings_generate` tool-name drift fixed; `agentdb_hierarchical-*` namespace arg bug fixed (switched to `memory_*`); `agentdb_pattern-store` namespace arg bug fixed; smoke-as-contract gate defined in `scripts/smoke.sh` (11 checks).
