---
name: harness-security-bench
description: Run `@metaharness/darwin security bench` (upstream "Darwin Shield" / ADR-155) — evolves a champion security-detection harness against a 10-vuln / 9-decoy corpus and grades it on TPR/FPR/patch-pass/repro/unsafe vs four baselines (B0 static, B1 LLM-single-pass, B2 fixed-agent, B3 Darwin-champion). Closest reference implementation for ruflo's own ADR-155 nightly self-learning security harness (PR #2417). Degrades gracefully when @metaharness/darwin is absent.
argument-hint: "[--population 2] [--cycles 1] [--seed N] [--alert-on-fail]"
allowed-tools: Bash
---

Surfaces the upstream `metaharness-darwin security bench` command. **This is
the upstream's own ADR-155 — Darwin Shield — and is the closest reference
implementation for ruflo's nightly self-learning security harness ([#2417](https://github.com/ruvnet/ruflo/pull/2417)).**

## Why this matters for ruflo's ADR-155

ruflo's ADR-155 proposes three learning loops (per-dimension confidence,
severity calibration, auto-fix bid). Loop A trains on accumulated
`(finding, dimension, human_outcome)` tuples — but the gradient signal is
only sound if the underlying detection mechanism converges on a known-good
corpus. Darwin Shield evolves exactly that mechanism on a 10-vuln/9-decoy
ground-truth set. Running this nightly gives us:

- **Empirical floor:** if Darwin Shield's champion can't reach
  TPR=1/FPR=0 on the bench corpus, our Loop A's reward signal is noise.
- **Drift detection:** week-over-week champion fitness deltas surface
  when the security landscape (or our mutator policy) shifts.
- **Baseline diversity:** the 4 baselines (B0–B3) give us 4 anchor
  points to weight per-dimension confidence against.

## Algorithm

Implementation: [`scripts/security-bench.mjs`](../../scripts/security-bench.mjs).

1. Shell to `npx -y @metaharness/darwin@~0.8.0 metaharness-darwin security bench --population N --cycles N [--seed S]`.
2. Default timeout = `3s × 19 evaluations × population × cycles + 30s overhead`.
   At default `--population 2 --cycles 1` ≈ 144s; at `--population 4 --cycles 3` ≈ 12 min.
3. Parse the markdown report — overall PASS/FAIL plus per-gate
   pass/fail rows (gate examples: "TPR improvement ≥ 25% vs fixed",
   "FPR reduction ≥ 40%", "Patch-test pass rate ≥ 80%", "Reproduction
   success ≥ 90%", "Unsafe outputs = 0", "Cost increase ≤ 2× fixed",
   "Beyond SOTA: champion statistically beats previous champion",
   "Compounding: false-positive repeat-rate drop ≥ 35%").
4. Parse the baselines-vs-champion table (4 rows: fitness/TPR/FPR/patchPass/
   repro/unsafe/cost per harness).
5. Emit structured JSON. With `--alert-on-fail`, exit 1 when overall = FAIL.

## Output shape

```json
{
  "success": true,
  "data": {
    "overall": { "ok": true, "icon": "✅" },
    "gates": {
      "total": 11,
      "passed": 11,
      "failed": 0,
      "details": [{ "ok": true, "criterion": "TPR improvement ≥ 25% vs fixed harness", "measured": "+150% (B2 0.4 → B3 1)" }, ...]
    },
    "baselines": [
      { "harness": "static-only", "fitness": 0.5665, "tpr": 0.3, "fpr": 1, "unsafe": 0, ... },
      { "harness": "LLM single-pass", "fitness": 0.1365, ... },
      { "harness": "fixed agent", "fitness": 0.598, ... },
      { "harness": "Darwin champion", "fitness": 0.93275, "tpr": 1, "fpr": 0, ... }
    ],
    "rawMarkdown": "...",
    "shape": { "population": 2, "cycles": 1, "seed": null },
    "durationMs": 142000
  }
}
```

## Wiring into ADR-155 nightly harness

The ADR-155 nightly workflow (per #2418 task `W1.5`) will spawn this as
one of the active-pentest dimension's calls — its results become a
trajectory record:

```jsonc
{
  "dimension": "mcp-pentest",
  "subdimension": "darwin-shield-bench",
  "champion_fitness": 0.93275,
  "champion_tpr": 1, "champion_fpr": 0,
  "gates_passed": 11, "gates_failed": 0,
  "shape": { "population": 4, "cycles": 3 }
}
```

Loop A learns: if `darwin-shield-bench` consistently passes on the seeded
corpus, weight findings caught only by `mcp-pentest` higher.

## Exit codes

| Code | Meaning |
|---|---|
| 0 | Bench ran (overall PASS or FAIL — distinguish via JSON `overall.ok`), or degraded |
| 1 | `--alert-on-fail` and `overall.ok === false` |
| 2 | Config error or upstream infrastructure failure |

## Graceful degradation

When `@metaharness/darwin` is absent, emits `{degraded: true, reason: 'metaharness-darwin-not-available'}` and exits 0.
