# ruflo-goals

Long-horizon goal planning, deep research orchestration, and adaptive replanning.

## Install

```
/plugin marketplace add ruvnet/ruflo
/plugin install ruflo-goals@ruflo
```

## Features

- **Goal planning**: GOAP-based action planning with precondition analysis and cost optimization
- **Deep research**: Multi-source research orchestration (web, memory, codebase, patterns)
- **Horizon tracking**: Persistent objectives across sessions with milestone checkpoints
- **Research synthesis**: Evidence-graded reports with contradiction resolution
- **Dossier investigation**: Recursive parallel fan-out across all ruflo sources for seed-driven investigation (ADR-099)

## Commands

- `/goals` -- List active horizons, check progress, view research

## Skills

- `deep-research` -- Orchestrate multi-phase research campaigns
- `goal-plan` -- Create and execute GOAP action plans
- `horizon-track` -- Track objectives across sessions with drift detection
- `research-synthesize` -- Synthesize findings into structured reports
- `dossier-collect` -- Recursive parallel investigation building a graph-structured dossier on a seed entity

## Agents

- `goal-planner` -- GOAP specialist with A* planning and trajectory learning
- `deep-researcher` -- Multi-source research with evidence grading (linear, question-driven)
- `horizon-tracker` -- Cross-session objective tracking with drift detection
- `dossier-investigator` -- Recursive parallel multi-source investigator (seed-driven, graph output)

## Selection guide

| You have | Use |
|---|---|
| A question | `deep-researcher` / `deep-research` |
| A seed entity to expand outward | `dossier-investigator` / `dossier-collect` |
| A multi-step objective | `goal-planner` / `goal-plan` |
| A long-running objective | `horizon-tracker` / `horizon-track` |

## Compatibility

- **CLI:** pinned to `@claude-flow/cli` v3.6 major+minor.
- **Verification:** `bash plugins/ruflo-goals/scripts/smoke.sh` is the contract.

## Namespace coordination

This plugin uses six AgentDB namespaces. They predate the namespace convention from [ruflo-agentdb ADR-0001](../ruflo-agentdb/docs/adrs/0001-agentdb-optimization.md). [ADR-0001](./docs/adrs/0001-goals-contract.md) documents the legacy-vs-canonical mapping and the forward path:

| Legacy (current) | Canonical (forward) | Status |
|------------------|---------------------|--------|
| `adr` | `adr-patterns` (owned by ruflo-adr) | Defer to canonical owner — don't write here from this plugin |
| `dossier` | `dossier` | Documented base-name exception (cf. `federation`) |
| `research` | `goals-research` | Legacy reads + new writes pending data-portability ADR |
| `research-sources` | `goals-research-sources` | Legacy reads + new writes pending |
| `horizons` | `goals-horizons` | Legacy reads + new writes pending |
| `horizon-sessions` | `goals-horizon-sessions` | Legacy reads + new writes pending |

**New writes from this plugin SHOULD use the canonical kebab-case form.** Reads check both. A future ADR will propose the rename + migration once existing-data-portability is designed.

Reserved namespaces (`pattern`, `claude-memories`, `default`) MUST NOT be shadowed.

## Deep research: cap, screening, record (ADR-438)

`/ruflo-goals:deep-research "<topic>" --cap-usd 2 --depth standard` (or the `deep-researcher` agent):

- **Cap and depth.** `--cap-usd` (default 2) is a per-run limit on top of the shared cost-tracker budget; `--depth` is `quick|standard|deep`. At the cap the run stops and the record says `truncated`.
- **Screened.** Fetched text goes through AIDefence (`aidefence_scan`) before it is stored or quoted.
- **Run marker.** `.claude-flow/research-active.json` exists only while a run is active (stale after 2 hours); the `ruflo-mods` guard reads it.
- **Consent.** The record is written to namespace `research` (`research-<slug>-<yyyymmddhhmm>`) only after you accept the report.
- **Listing.** `node scripts/research-list.mjs --limit 10` prints `{version:1,records:[...]}`; test: `node scripts/test-research-list.mjs`.

Works with no console installed. Contract: [ADR-438](../../v3/docs/adr/ADR-438-research-integration-contract.md).

## Dossier-investigator (ADR-099)

The `dossier-investigator` agent + `dossier-collect` skill implement [ADR-099](../../v3/docs/adr/ADR-099-dossier-investigator-recursive-parallel-research.md) — recursive parallel multi-source investigation that fans out across web, memory, knowledge-graph, codebase, and ADR index, building a graph-structured dossier with budget caps, de-duplication, and provenance per claim.

Key invariants per ADR-099:
- **Seed-driven** (entity, not question)
- **Graph output** (not linear report)
- **Budget caps** (hop-count, token, time)
- **Provenance per claim** (every fact carries source attribution)

## Verification

```bash
bash plugins/ruflo-goals/scripts/smoke.sh
# Expected: "16 passed, 0 failed"
```

## As a mod (0.4.3)

A function-hook mod ships beside the skills (ADR-445 pattern). Needs a Claude Code with mods (2.1.287+); older builds ignore it. No network, no process spawning: it only tightens calls to this plugin's own tools and reads through tools already connected.

| Piece | Default | What it does |
|---|---|---|
| **Write guard** | on | Refuses a write to the goals, horizons, research or dossier namespaces (`memory_store`, `agentdb_*-store`, `hooks_intelligence_pattern-store`) or a `task_create` that holds a key, token or password. |
| **Dossier ID screen** | on | Refuses a dossier or research note that holds a government ID number (SSN shape). |
| **`/goals-mod`** | — | `status`, `scan <text>`, `horizons` (reads the horizons namespace through the connected memory tool); answered locally, no model call. |
| **Status file** | — | `.claude-flow/goals-mod/status.json` (`version`, `updatedMs`, mode flags and counters); written at session start and when a counter changes. |

Options (`userConfig`): `guard` on\|off, `personal` on\|off. Refusals never echo the value they matched.

```bash
claude plugin test plugins/ruflo-goals      # 10 tests
```

## Architecture Decisions

- [`ADR-0001` — ruflo-goals plugin contract (legacy-vs-canonical namespaces, GOAP/dossier workflow contract)](./docs/adrs/0001-goals-contract.md)
