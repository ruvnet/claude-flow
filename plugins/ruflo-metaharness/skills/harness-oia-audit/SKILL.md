---
name: harness-oia-audit
description: Composite Phase-2 audit worker (ADR-150). Bundles harness oia-manifest + threat-model + mcp-scan into one timestamped audit record stored in the `metaharness-audit` memory namespace. Designed for cron-scheduled drift detection.
argument-hint: "[--path .] [--dry-run] [--alert-on-worst clean|low|medium|high] [--format table|json]"
allowed-tools: Bash
---

The 13th worker (ADR-150 Phase 2) — runs three MetaHarness static
surfaces in one shot, computes a composite worst-severity signal, and
persists the audit record to memory so drift over time is visible.

## Algorithm

Implementation: [`scripts/oia-audit.mjs`](../../scripts/oia-audit.mjs).

1. Run `harness oia-manifest <path>` — Open Infrastructure Architecture
   layer alignment (L1-L9).
2. Run `harness threat-model <path>` — categorized MCP-surface threat
   report with `worst: clean|low|medium|high`.
3. Run `harness mcp-scan <path>` — per-server/tool policy + permissions
   + dep findings.
4. Composite worst = `max(threatModel.worst, max(mcpScan.findings.severity))`.
5. Persist payload to memory namespace `metaharness-audit` with key
   `audit-<iso-timestamp>` (unless `--dry-run`).
6. `--alert-on-worst <severity>`: exit 1 if composite worst ≥ threshold.

## Graceful degradation

When ALL three components report `metaharness-not-available`, the script
emits the standard degraded payload and exits 0. When only some are
degraded, each individual component carries its own `degraded: true`
flag in the audit record — the audit still runs and persists what it
could gather.

## CI / cron integration

Designed for weekly cron in `.github/workflows/`:

```yaml
on:
  schedule:
    - cron: '17 4 * * 0'  # Sundays at 04:17 UTC
jobs:
  oia-audit:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
      - run: node plugins/ruflo-metaharness/scripts/oia-audit.mjs --alert-on-worst high
```

`--alert-on-worst high` fails the job on any HIGH-severity finding;
drift below HIGH is logged but doesn't block.

## Memory namespace

Each audit run stores under `metaharness-audit:audit-<iso-ts>`. To list
recent audits:

```bash
npx @claude-flow/cli@latest memory list --namespace metaharness-audit --limit 10
```

To diff two audits (drift detection):

```bash
A=$(npx ... memory retrieve --key audit-2026-06-01... --namespace metaharness-audit)
B=$(npx ... memory retrieve --key audit-2026-06-15... --namespace metaharness-audit)
# Compare composite.worst, components.threatModel.worst, etc.
```

A future ADR can wire this into a dedicated `cost-diff`-style diff
viewer specifically for audit drift.

## Pairs with

- `harness-threat-model` — the underlying threat-model component
- `harness-mcp-scan` — the underlying MCP-scan component
- `harness-score` + `harness-genome` — readiness metrics (orthogonal to audit)
