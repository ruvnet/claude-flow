---
id: ADR-0001
title: ruflo-jujutsu plugin contract — pinning, namespace coordination, ADR-compliance integration, smoke as contract
status: Accepted
date: 2026-05-04
updated: 2026-05-09
authors:
  - reviewer (Claude Code)
tags: [plugin, jujutsu, git, diff, risk-analysis, namespace, smoke-test]
---

## Context

`ruflo-jujutsu` (v0.1.0) — git workflow + diff analysis. Wraps **6 `analyze_*` MCP tools** at `v3/@claude-flow/cli/src/mcp-tools/analyze-tools.ts:24, 100, 143, 185, 234, 291` (`analyze_diff`, `analyze_diff-risk`, `analyze_diff-classify`, `analyze_diff-reviewers`, `analyze_file-risk`, `analyze_diff-stats`).

Surface: 1 agent (`git-specialist`), 2 skills (`diff-analyze`, `git-workflow`), 1 command (`/jujutsu`). All 6 MCP tools correctly referenced.

Standard contract gaps: no plugin-level ADR, no smoke test, no Compatibility section, no namespace coordination, no cross-link to [ruflo-adr ADR-0001](../../ruflo-adr/docs/adrs/0001-adr-plugin-pattern.md) which the `/adr check` command depends on this plugin's diff analysis.

## Decision

1. Add this ADR (Proposed).
2. README augment: Compatibility (pin v3.6); Namespace coordination (claims `git-patterns`); ADR-compliance integration block (jujutsu's diff analysis is the substrate that `/adr check` runs on); 6-tool MCP surface table; Verification + Architecture Decisions sections.
3. Bump `0.1.0 → 0.2.0`. Keywords add `mcp`, `change-classification`, `reviewer-recommendation`.
4. `scripts/smoke.sh` — 10 structural checks: version + keywords; both skills + agent + command with valid frontmatter; all 6 `analyze_*` tools referenced; v3.6 pin; namespace coordination; ADR-compliance cross-reference (ruflo-adr); ADR Accepted; no wildcard tools.

## Consequences

**Positive:** plugin joins the cadence. ADR-compliance integration becomes contractually documented (ruflo-adr's `/adr check` uses this plugin's diff analysis).

**Negative:** none material.

## Verification

```bash
bash plugins/ruflo-jujutsu/scripts/smoke.sh
# Expected: "10 passed, 0 failed"
```

## Related

- `plugins/ruflo-adr/docs/adrs/0001-adr-plugin-pattern.md` — `/adr check` consumes this plugin's diff analysis
- `plugins/ruflo-agentdb/docs/adrs/0001-agentdb-optimization.md` — namespace convention
- `v3/@claude-flow/cli/src/mcp-tools/analyze-tools.ts` — 6 `analyze_*` tools

## Implementation status

Plugin version v0.2.0 shipped and listed in marketplace.json. Source exists at `plugins/ruflo-jujutsu/`. Contract elements implemented: all 6 `analyze_*` MCP tools covered; namespace `jujutsu-diffs` claimed; `/adr check` cross-link to ruflo-adr ADR-0001 documented; smoke-as-contract gate defined in `scripts/smoke.sh`.
