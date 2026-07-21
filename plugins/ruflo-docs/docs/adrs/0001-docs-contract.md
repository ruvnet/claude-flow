---
id: ADR-0001
title: ruflo-docs plugin contract — pinning, namespace coordination, document-worker integration, smoke as contract
status: Accepted
date: 2026-05-04
updated: 2026-05-09
authors:
  - reviewer (Claude Code)
tags: [plugin, docs, drift-detection, document-worker, namespace, smoke-test]
---

## Context

`ruflo-docs` (v0.1.0): docs-writer agent (Haiku model — cost-efficient for docs work), 2 skills (`api-docs`, `doc-gen`), 1 command (`/ruflo-docs`). Drives the `document` background worker via `hooks_worker-dispatch`.

Real surface used:
- `mcp__plugin_ruflo-core_ruflo__hooks_worker-dispatch` with `trigger: "document"` (works; the `document` worker is one of the 12 background workers per CLAUDE.md)
- `mcp__plugin_ruflo-core_ruflo__memory_store` for drift detection state
- `Bash`, `Read`, `Write`, `Grep`, `Glob` for source/doc analysis

Standard gaps: no plugin-level ADR, no smoke test, no Compatibility section, no namespace coordination.

## Decision

1. Add this ADR (Proposed).
2. README augment: Compatibility (pin v3.6), Namespace coordination (claims `docs-drift`), document-worker contract (which trigger maps to which output), Verification + Architecture Decisions.
3. Bump `0.1.0 → 0.2.0`. Keywords add `jsdoc`, `openapi`, `mcp`.
4. `scripts/smoke.sh` — 10 checks: version + keywords; both skills + agent + command with valid frontmatter; `hooks_worker-dispatch` referenced; `document` worker trigger documented; v3.6 pin; namespace coordination; ADR Proposed; no wildcard tools; agent uses Haiku model (cost-efficient cadence).

## Consequences

**Positive:** plugin joins the cadence. Document-worker integration becomes contractually documented.

**Negative:** none.

## Verification

```bash
bash plugins/ruflo-docs/scripts/smoke.sh
# Expected: "10 passed, 0 failed"
```

## Related

- `plugins/ruflo-agentdb/docs/adrs/0001-agentdb-optimization.md`
- `plugins/ruflo-adr/docs/adrs/0001-adr-plugin-pattern.md` — sibling docs cadence
- `plugins/ruflo-loop-workers/...` — defines the `document` background worker

## Implementation status

Plugin version v0.2.0 shipped and listed in marketplace.json. Source exists at `plugins/ruflo-docs/`. Contract elements implemented: `document` background worker dispatch via `hooks_worker-dispatch`; namespace `docs-state` claimed for drift-detection state; Haiku model pinned for cost-efficiency; smoke-as-contract gate defined in `scripts/smoke.sh`.
