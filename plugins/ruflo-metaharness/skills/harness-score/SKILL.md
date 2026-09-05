---
name: harness-score
description: 5-dimension harness readiness scorecard from `metaharness score <path>`. Returns harnessFit / compileConfidence / taskCoverage / toolSafety / memoryUsefulness + estCostPerRunUsd + scaffoldReady. Pure-read; subprocess invocation; degrades gracefully when MetaHarness is absent (ADR-150 architectural constraint).
argument-hint: "[--path .] [--alert-on-fit-below 70] [--format table|json]"
allowed-tools: Bash
---

Surfaces the upstream `metaharness score` CLI as a ruflo skill. Use when
Claude Code needs to assess whether a repo is ready for harness adoption
before recommending the user run `npx ruflo init` or `harness-mint`.

## Algorithm

Implementation: [`scripts/score.mjs`](../../scripts/score.mjs).

1. Shell out to `npx metaharness score <path> --json` (single subprocess,
   60s hard timeout).
2. Parse the JSON shape: `{ harnessFit, compileConfidence, taskCoverage,
   toolSafety, memoryUsefulness, estCostPerRunUsd, recommendedMode,
   archetype, template, scaffoldReady, hardConstraints }`.
3. If `--alert-on-fit-below N`: exit 1 when `harnessFit < N`.
4. Output JSON (default) or markdown table.

## Phase-0 baseline (ruflo's own scorecard, measured 2026-06-16)

| Dimension | Value |
|---|---:|
| harnessFit | 82/100 |
| compileConfidence | 100 |
| taskCoverage | 79 |
| toolSafety | 100 |
| memoryUsefulness | 40 |
| estCostPerRunUsd | $0.048 |
| recommendedMode | CLI + MCP |
| archetype | typescript-sdk-harness |
| template | vertical:coding |
| scaffoldReady | true |

Ruflo passes its own readiness check. `memoryUsefulness: 40` is the
weakest dimension — track this as a leading indicator for future memory
work in the AgentDB layer.

## CI integration

```bash
node plugins/ruflo-metaharness/scripts/score.mjs --alert-on-fit-below 70 --format json
```

Exit 1 fails the build. Pair with `harness-genome` for the full
7-section view.

## Graceful degradation (ADR-150 architectural constraint rule #3)

When `metaharness` is not installed and `npx` can't fetch it (offline,
no network, registry unreachable), the script emits:

```json
{
  "degraded": true,
  "reason": "metaharness-not-available",
  "hint": "Install with `npm i -D metaharness@~0.3.0` (pinned range — this plugin never fetches @latest) or verify network access for the one-time cache install."
}
```

and exits 0. Ruflo continues to function — this is the architectural
constraint in action.
