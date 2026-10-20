---
id: ADR-0001
title: ruflo-federation plugin contract — pinning, namespace coordination, 3-gate pattern alignment, ADR-097 budget integration, smoke as contract
status: Accepted
date: 2026-05-04
updated: 2026-05-09
authors:
  - reviewer (Claude Code)
tags: [plugin, federation, zero-trust, peer-discovery, consensus, budget, namespace, smoke-test]
---

## Context

`ruflo-federation` (v0.2.0) — comms layer for cross-installation agent federation. Plugin-internal (drives `@claude-flow/plugin-agent-federation` via npx; no CLI MCP tools of its own — federation tooling is npm-package-driven). Surface:

- 1 agent (`federation-coordinator`)
- 3 skills (`federation-init`, `federation-status`, `federation-audit`)
- 1 command (`/federation`)
- README extensively documents the ADR-097 budget circuit breaker (Phase 1: send-side enforcement; Phase 2: peer state machine; Phase 3: ruflo-cost-tracker integration — both deferred)

Contract gaps relative to the established cadence:

1. No plugin-level ADR.
2. No smoke test.
3. README's "PII Pipeline" feature claim doesn't cross-reference the canonical [3-gate pattern owned by ruflo-aidefence ADR-0001](../../../ruflo-aidefence/docs/adrs/0001-aidefence-contract.md). Federation's PII pipeline is a richer 14-type detection — but it's a specialization of the same 3-gate design and should defer to the canonical contract.
4. No namespace coordination cross-reference (uses `federation` namespace — should be `federation-patterns` per kebab-case `<plugin-stem>-<intent>` rule, OR documented as the singular case where the plugin name itself is the intent).
5. Compatibility section missing the v3.6 pin.

## Decision

1. Add this ADR (Proposed).
2. README augment: Compatibility (pin v3.6); Namespace coordination (claim `federation` as the namespace — this is the documented exception where the plugin owns its base name; the kebab-case rule still applies, just with an empty intent. Cross-reference [ruflo-agentdb ADR-0001](../../../ruflo-agentdb/docs/adrs/0001-agentdb-optimization.md)); 3-gate alignment block (federation's PII pipeline is a richer specialization of the canonical 3 gates from ruflo-aidefence ADR-0001); Verification + Architecture Decisions sections.
3. Plugin metadata stays at `0.2.0` (already at the cadence). Keywords add `mcp`, `pii-pipeline`, `audit-log`.
4. `scripts/smoke.sh` — 10 structural checks: version + new keywords; all 3 skills + agent + command with valid frontmatter; ADR-097 budget block intact (`maxHops`, `maxTokens`, `maxUsd`, `BUDGET_EXCEEDED`, `HOP_LIMIT_EXCEEDED`); 5-tier trust model documented (UNTRUSTED → VERIFIED → ATTESTED → TRUSTED → PRIVILEGED); compliance modes documented (HIPAA, SOC2, GDPR); v3.6 pin; namespace coordination block; 3-gate alignment cross-reference; ADR Proposed; no wildcard tools.

## Consequences

**Positive:**
- Federation's PII pipeline is now contractually anchored to the canonical 3-gate pattern. Implementers reading both plugins won't have to reconcile two different "gate" stories.
- ADR-097 budget integration (the cross-reference between `federation_send` caps and `ruflo-cost-tracker` Phase 3 plans) becomes a smoke-checked invariant.

**Negative:** none. Plugin behavior unchanged.

## Verification

```bash
bash plugins/ruflo-federation/scripts/smoke.sh
# Expected: "10 passed, 0 failed"
```

## Related

- `plugins/ruflo-aidefence/docs/adrs/0001-aidefence-contract.md` — canonical 3-gate pattern this plugin specializes
- `plugins/ruflo-cost-tracker/docs/adrs/0001-cost-tracker-contract.md` — ADR-097 Phase 3 integration target
- `plugins/ruflo-agentdb/docs/adrs/0001-agentdb-optimization.md` — namespace convention
- `v3/docs/adr/ADR-097-federation-budget-circuit-breaker.md` — host-side enforcement reference

## Implementation status

Plugin version v0.2.0 shipped and listed in marketplace.json. Source exists at `plugins/ruflo-federation/`. Contract elements implemented: ADR-097 budget circuit breaker Phase 1 (send-side enforcement) and Phase 2 (peer state machine) documented; Phase 3 (ruflo-cost-tracker integration) deferred; 3-gate pattern alignment via ruflo-aidefence ADR-0001; smoke-as-contract gate defined in `scripts/smoke.sh`.
