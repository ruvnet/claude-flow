---
id: ADR-0001
title: ruflo-testgen plugin contract — pinning, namespace coordination, testgaps-worker contract, smoke as contract
status: Accepted
date: 2026-05-04
updated: 2026-05-09
authors:
  - reviewer (Claude Code)
tags: [plugin, testgen, tdd, coverage, namespace, smoke-test]
---

## Context

`ruflo-testgen` (v0.1.0) — test gap detection + TDD London School workflow + automated test generation. 1 agent (`tester`), 2 skills (`tdd-workflow`, `test-gaps`), 1 command (`/testgen`).

Drives the `testgaps` background worker (one of 12 documented in [ruflo-loop-workers ADR-0001](../../ruflo-loop-workers/docs/adrs/0001-loop-workers-contract.md)) via `hooks_worker-dispatch`. Also uses three coverage CLI commands: `hooks coverage-gaps`, `hooks coverage-route`, `hooks coverage-suggest`.

This plugin is the canonical owner of the **Refinement phase** in the SPARC methodology per [ruflo-sparc ADR-0001](../../ruflo-sparc/docs/adrs/0001-sparc-contract.md) §"Phase-to-plugin alignment".

## Decision

1. Add this ADR (Proposed).
2. README augment: Compatibility (pin v3.6); testgaps worker + coverage CLI command surface; SPARC Refinement phase ownership cross-reference; Namespace coordination (claims `test-gaps`); Verification + Architecture Decisions sections.
3. Bump `0.1.0 → 0.2.0`. Keywords add `mcp`, `tdd-london-school`, `coverage-routing`.
4. `scripts/smoke.sh` — 10 structural checks: version + keywords; both skills + agent + command with valid frontmatter; `hooks_worker-dispatch` referenced; `testgaps` trigger documented; coverage CLI commands referenced; v3.6 pin; namespace coordination; SPARC Refinement cross-reference; ADR Proposed; no wildcard tools.

## Consequences

**Positive:** plugin joins the cadence. testgaps-worker consumer relationship is now contractually documented; SPARC Refinement-phase ownership is cross-linked.

**Negative:** none material.

## Verification

```bash
bash plugins/ruflo-testgen/scripts/smoke.sh
# Expected: "10 passed, 0 failed"
```

## Related

- `plugins/ruflo-loop-workers/docs/adrs/0001-loop-workers-contract.md` — defines the `testgaps` worker
- `plugins/ruflo-sparc/docs/adrs/0001-sparc-contract.md` — Refinement phase ownership
- `plugins/ruflo-jujutsu/docs/adrs/0001-jujutsu-contract.md` — diff analysis for PR-time coverage gating
- `plugins/ruflo-agentdb/docs/adrs/0001-agentdb-optimization.md` — namespace convention

## Implementation status

Plugin version v0.2.0 shipped and listed in marketplace.json. Source exists at `plugins/ruflo-testgen/`. Contract elements implemented: `testgaps` background worker dispatch via `hooks_worker-dispatch` documented; `hooks coverage-gaps|coverage-route|coverage-suggest` CLI coverage commands covered; SPARC Refinement-phase ownership cross-linked; namespace `test-gaps` claimed; smoke-as-contract gate defined in `scripts/smoke.sh`.
