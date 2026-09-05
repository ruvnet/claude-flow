---
name: harness-evolve
description: Run `@metaharness/darwin evolve <repo>` to mutate a harness's seven policy surfaces (planner/contextBuilder/reviewer/retryPolicy/toolPolicy/memoryPolicy/scorePolicy), sandbox-score each variant, and promote only measured wins. The model is frozen; the harness evolves. Closes the loop ADR-150 opens (score+genome describe; evolve changes). Degrades gracefully when @metaharness/darwin is absent (ADR-150 + ADR-153 architectural constraints).
argument-hint: "--repo <path> [--generations 3] [--children 3] [--concurrency 2] [--sandbox real|mock|agent] [--selection pareto|quality-diversity|...] [--mutator deterministic|ruvllm] [--diagnose] [--confirm]"
allowed-tools: Bash
---

Surfaces the upstream `metaharness-darwin evolve` CLI as a ruflo skill. The
**write** layer that pairs with ADR-150's read layer (score / genome /
mcp-scan / threat-model / oia-audit). Use when you have a harness whose
readiness scores are flat and you want to discover *which* surface mutation
moves them — without retraining the foundation model.

## When to use

- A `harness-score` result is below target and you don't know which policy
  surface is responsible.
- You're seeding a harness for a new vertical and want to find a good
  starting configuration empirically rather than hand-tuning.
- You're comparing your hand-tuned harness against an evolved baseline
  (treat darwin's champion as the strawman).

## When NOT to use

- For continuous background optimization. Darwin Mode is human-initiated.
  Wire it into CI for one-shot exploration, not for autonomous self-modification.
- For ruflo itself in CI. ADR-153 §5 explicitly rejects auto-evolving ruflo
  — the CI gate verifies graceful degradation, not convergence.

## Algorithm

Implementation: [`scripts/evolve.mjs`](../../scripts/evolve.mjs).

1. Validate args (`--repo` exists, caps on `--generations` ≤ 50, `--children`
   ≤ 20, `--concurrency` ≤ 8, sandbox/selection/mutator are known values).
2. Without `--confirm`: print plan + exit 0 (mirrors `harness-mint` safety
   convention; defense in depth over the upstream `safety.ts` checks).
3. With `--confirm`: shell to `npx -y @metaharness/darwin@~0.8.0 metaharness-darwin evolve <repo> ...`
   via the shared `_darwin.mjs` async helper. Per-generation progress is
   forwarded to stderr; final champion JSON is captured from stdout.
4. Compute timeout from `generations × children × per-variant` (per-variant
   ≈ 60s real, ≈ 2s mock). Caller may override with `--timeout-ms`.
5. Honor upstream exit code 99 — propagate as "safety-disqualified", do not
   remap. This is a designed-in tripwire (a variant tripped `inspectVariant`
   for secrets / shell-out / network / dynamic-eval). See ADR-153 §"Safety model".
6. Optional `--alert-on-no-improvement`: exit 1 when champion ≤ parent.

## The seven mutation surfaces

| Surface | What it owns |
|---|---|
| `planner` | task decomposition / step ordering |
| `contextBuilder` | what gets fed into the prompt |
| `reviewer` | self-critique / output verification |
| `retryPolicy` | when + how to retry on failure |
| `toolPolicy` | which tools the agent may use, under which conditions |
| `memoryPolicy` | what to persist, recall, forget |
| `scorePolicy` | how the agent grades its own output |

One mutation per variant. Multi-surface mutations are not allowed (causal
attribution stays clean).

## Output

Reports land under `<repo>/.metaharness/`:

```
.metaharness/
  archive.json         # full lineage tree (sampling next gen draws from this)
  lineage.json         # parent→child edges only
  variants/<id>/       # per-variant code (kept for audit)
  runs/<id>/           # per-variant sandbox test output
  reports/winner.json  # final champion + score delta vs parent
```

Skill stdout = JSON `{success, data: {champion, plan, durationMs, improved}}`
(plus `data.diagnosis` when `--diagnose` is passed — see below).

## Failure diagnosis (`--diagnose`)

GEPA's key trick is natural-language failure diagnosis from execution traces
feeding the next mutation — not just scalar fitness. `--diagnose` adds a
modest slice of that: after the evolution completes, the losing / failed
variants' transcripts are run through darwin's GEPA library ops
(`analyzeTranscript` + `classifyFailure`, via the shared `importGepa`
resolver in `scripts/_darwin.mjs`) and a `diagnosis` section is appended to
the emitted JSON:

```json
"diagnosis": {
  "available": true,
  "scope": "losing-variants",
  "variants": [
    { "id": "g1_v0", "transcripts": 2,
      "failureClasses": { "exploration-loop": 1, "edit-mechanics": 1 },
      "dominantClass": "exploration-loop" }
  ],
  "totals": { "exploration-loop": 1, "edit-mechanics": 1 }
}
```

Upstream shape caveats (verified against `@metaharness/darwin@0.8.0`):

- `metaharness-darwin evolve --json` prints a TEXT leaderboard — the stdout
  carries no JSON and no transcripts. Per-variant run records live at
  `<repo>/.metaharness/runs/<id>.json`.
- Those run records hold sandbox exec traces (`{taskId, exitCode, stdout,
  stderr}`), which are NOT GEPA `{actionRaw, obs}` transcripts. Diagnosis
  therefore uses GEPA-shaped transcripts when a run record embeds them
  (agent sandbox / future upstream), falls back to the champion's transcript,
  and otherwise emits `diagnosis: {available: false, reason, traceSummary}`
  where `traceSummary` is a mechanical per-variant tally (tasks / failed /
  timedOut / blockedActions).
- `--diagnose` NEVER fails the run — any internal error degrades to
  `{available: false, reason: "diagnosis-failed: ..."}`.

## Exit codes

| Code | Meaning |
|---|---|
| 0  | Evolved OK, or dry-run, or degraded (Darwin absent) |
| 1  | `--alert-on-no-improvement` and champion did not beat parent |
| 2  | Config error or evolution infrastructure failure |
| 99 | Upstream "safety-disqualified" (PROPAGATED, not remapped) |

## Graceful degradation (ADR-150 constraint 3 + ADR-153)

When `@metaharness/darwin` is not installed, the script emits
`{degraded: true, reason: 'metaharness-darwin-not-available', hint: ...}`
and exits 0. ruflo continues to function. CI's
`no-metaharness-smoke.yml`-style job asserts this path.
