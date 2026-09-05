---
id: ADR-0001
title: ruflo-goals plugin contract — pinning, namespace coordination + legacy mapping, GOAP/dossier workflow contract, smoke as contract
status: Accepted
date: 2026-05-04
updated: 2026-05-09
authors:
  - reviewer (Claude Code)
tags: [plugin, goals, goap, research, horizon, dossier, namespace, smoke-test]
---

## Context

`ruflo-goals` (v0.2.0) — the long-horizon planning + research + dossier plugin. Surface is rich:

- 4 agents: `goal-planner` (GOAP A*), `deep-researcher` (linear question-driven), `horizon-tracker` (cross-session), `dossier-investigator` (recursive parallel multi-source, ADR-099)
- 5 skills: `goal-plan`, `deep-research`, `research-synthesize`, `horizon-track`, `dossier-collect`
- 1 command (`/goals`)
- Selection guide already differentiates question / seed-entity / multi-step / long-running task patterns

### Namespace audit — six namespaces, mixed compliance

| Namespace | Used by | Convention compliance |
|-----------|---------|----------------------|
| `adr` | `dossier-investigator`, `dossier-collect` | **Non-compliant** — should reference the canonical `adr-patterns` from [ruflo-adr ADR-0001](../../ruflo-adr/docs/adrs/0001-adr-plugin-pattern.md) |
| `dossier` | `dossier-investigator` writes here | **Documented exception** — base-name rule (cf. `federation` from ruflo-federation) |
| `research` | `deep-researcher` | **Non-compliant** — should be `goals-research` per kebab-case `<plugin-stem>-<intent>` rule |
| `research-sources` | `deep-researcher` | **Non-compliant** — should be `goals-research-sources` |
| `horizons` | `horizon-tracker` | **Non-compliant** — should be `goals-horizons` |
| `horizon-sessions` | `horizon-tracker` | **Non-compliant** — should be `goals-horizon-sessions` |

The six namespaces predate ruflo-agentdb ADR-0001's namespace convention. Renaming them risks breaking projects that already have stored data in the legacy names. This ADR documents both:

- **Existing storage** uses the legacy names (no migration this turn).
- **New writes** SHOULD use the canonical kebab-case form (`goals-research`, `goals-horizons`, etc.).
- **Reads** check both old and new for backward compatibility.

A future ADR can propose the rename + migration once the data-portability path is designed.

### Other gaps

1. No plugin-level ADR (this fixes that).
2. No smoke test.
3. No Compatibility section.
4. ADR-099 is referenced for `dossier-collect` but the plugin doesn't link out from README.

## Decision

1. Add this ADR (Proposed).
2. README augment: Compatibility (pin v3.6); Namespace coordination block with the legacy-vs-canonical mapping above; ADR-099 cross-link for dossier-collect; Verification + Architecture Decisions sections.
3. Plugin metadata stays at `0.2.0` (already at the cadence). Keywords add `mcp`, `gop` (typo: `goap`), `legacy-namespaces`, `evidence-grading`. Actually skipping `gop` — already has `goap`.
4. `scripts/smoke.sh` — 10 structural checks: version + new keywords; all 5 skills + all 4 agents + 1 command with valid frontmatter; selection guide present (4 task patterns); ADR-099 cross-link in README; v3.6 pin; namespace coordination block with legacy mapping; ADR Accepted; no wildcard tools.

## Consequences

**Positive:** legacy namespaces are now explicitly documented as legacy, with a forward-path canonical form. New plugins reading goals as a template won't replicate the non-compliant naming.

**Negative:** the legacy-vs-canonical split adds documentation surface. Not free, but justified given existing-data concerns.

**Neutral:** no functional changes. Plugin behavior unchanged.

## Verification

```bash
bash plugins/ruflo-goals/scripts/smoke.sh
# Expected: "10 passed, 0 failed"
```

## Related

- `plugins/ruflo-agentdb/docs/adrs/0001-agentdb-optimization.md` — namespace convention (`<plugin-stem>-<intent>`)
- `plugins/ruflo-adr/docs/adrs/0001-adr-plugin-pattern.md` — owns canonical `adr-patterns` namespace
- `plugins/ruflo-federation/docs/adrs/0001-federation-contract.md` — base-name exception precedent (`federation` namespace)
- `v3/docs/adr/ADR-099-dossier-investigator-recursive-parallel-research.md` — dossier-collect spec

## Implementation status

Plugin version v0.2.0 shipped and listed in marketplace.json. Source exists at `plugins/ruflo-goals/`. Contract elements implemented: 6 namespaces mapped to correct `memory_*` routing; GOAP A* planner, dossier recursive fan-out (ADR-099), and horizon-track cross-session agents shipped; smoke-as-contract gate defined in `scripts/smoke.sh`.
