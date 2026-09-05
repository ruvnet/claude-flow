---
id: ADR-0001
title: ruflo-knowledge-graph plugin contract — pinning, namespace coordination, embeddings_generate fix, smoke as contract
status: Accepted
date: 2026-05-04
updated: 2026-05-09
authors:
  - reviewer (Claude Code)
tags: [plugin, knowledge-graph, entities, relations, pathfinder, namespace, smoke-test]
---

## Context

`ruflo-knowledge-graph` (v0.2.0) — entity extraction + relation mapping + pathfinder graph traversal. Surface: 1 agent + 2 skills + 1 command (5 subcommands). Backed by `agentdb_hierarchical-*` (entity tree), `agentdb_causal-edge` (relation tracking), `agentdb_semantic-route` (query routing), and `embeddings_*` (entity description embeddings).

### The drift this ADR fixes

Two files reference `mcp__plugin_ruflo-core_ruflo__embeddings_embed`, but the real tool is `embeddings_generate` (`v3/@claude-flow/cli/src/mcp-tools/embeddings-tools.ts:260`). There is no `embeddings_embed` MCP tool.

- `skills/kg-extract/SKILL.md:5` — `allowed-tools` line includes the wrong tool name
- `agents/graph-navigator.md:56` — agent's tool list also wrong

This is a real bug: invocations would fail with "tool not found". Fixing in this ADR pass.

### Other gaps

1. No plugin-level ADR.
2. No smoke test.
3. No Compatibility section.
4. No namespace coordination cross-reference (uses graph storage but no explicit namespace claim).

## Decision

1. **Functional fix:** rename `embeddings_embed` → `embeddings_generate` in both files.
2. Add this ADR (Proposed).
3. README augment: Compatibility (pin v3.6); Namespace coordination (claims `kg-graph`); Verification + Architecture Decisions sections.
4. Plugin metadata stays at `0.2.0` (already at the cadence). Patch bump justified by the functional fix (rename of a referenced tool name) but cadence keeps it at minor for consistency. Keywords add `mcp`, `pathfinder-traversal`, `entity-extraction`.
5. `scripts/smoke.sh` — 10 structural checks: version + keywords; both skills + agent + command with valid frontmatter; no reference to `embeddings_embed` anywhere (regression check on the bug fix); `embeddings_generate` referenced; 5 subcommands documented; v3.6 pin; namespace coordination; ADR Proposed; no wildcard tools.

## Consequences

**Positive:**
- Real bug fixed: kg-extract skill no longer references a non-existent MCP tool.
- Plugin joins the cadence.

**Negative:**
- Anyone scripting against the old (broken) tool name was already silently failing. Net zero on real impact.

## Verification

```bash
bash plugins/ruflo-knowledge-graph/scripts/smoke.sh
# Expected: "10 passed, 0 failed"
```

## Related

- `plugins/ruflo-agentdb/docs/adrs/0001-agentdb-optimization.md` — namespace convention
- `plugins/ruflo-cost-tracker/docs/adrs/0001-cost-tracker-contract.md` — sibling pattern of fixing real MCP-tool drift in skills
- `v3/@claude-flow/cli/src/mcp-tools/embeddings-tools.ts:260` — `embeddings_generate` (the real tool name)

## Implementation status

Plugin version v0.2.0 shipped and listed in marketplace.json. Source exists at `plugins/ruflo-knowledge-graph/`. Contract elements implemented: `embeddings_embed` → `embeddings_generate` tool-name drift fixed in both skill and agent files; namespace `knowledge-graph` claimed; pathfinder graph traversal via `agentdb_semantic-route` + `agentdb_causal-edge` documented; smoke-as-contract gate defined in `scripts/smoke.sh`.
