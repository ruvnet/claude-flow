# Self-Learning Wiring — Proof + Reproduction Guide (#2245)

> Companion to [ADR-074](../adr/ADR-074-self-learning-wiring-2245.md) and [#2245](https://github.com/ruvnet/ruflo/issues/2245).
>
> This document gives anyone the copy-paste commands needed to *verify the
> learning system actually persists what it claims*, plus the multi-path map of
> which entry point goes where.

## The system has multiple paths — pick the right one

> The single biggest cause of "self-learning reports success but persists
> nothing" is reaching for the wrong entry point. Three paths exist; each
> writes to a different store. Choose the one that matches what you want.

| Goal | Entry point | What persists | Where to query it |
|---|---|---|---|
| **Single completion → train** | `hooks_task-completed {trainPatterns:true}` | one-step trajectory → SONA + EWC++ + globalStats.{trajectories,patterns}Learned | `hooks_intelligence_stats` |
| **Multi-step learning loop** | `hooks_intelligence_trajectory-start` → `-step*` → `-end {success}` | full trajectory → SONA + ReasoningBank → memory-bridge `trajectories` namespace | `hooks_intelligence_stats` + `memory_bridge_status` |
| **Just remember this** | `memory_store` / `memory_store_episode` | row in memory-bridge default namespace | `memory_search_unified` |
| **Bootstrap from a repo** | `hooks_pretrain` | (1) summary bundle in `pretrain` namespace **+** (2) per-pattern rows in the neural store | `neural_patterns list` + `memory_search_unified` |
| **Activity counter (any write)** | any of the above | `globalStats.signalsProcessed` | `.claude-flow/neural/stats.json` |

If you call `hooks_task-completed` *without* `trainPatterns:true`, the response
explicitly says `"learningPath":"recorded-only"` and tells you what to set if
you wanted learning to fire. That's intentional — the surface is honest about
what it did and didn't do.

## Reproducing the proof

### One-shot benchmark

```bash
git clone https://github.com/ruvnet/ruflo
cd ruflo && npm install
( cd v3/@claude-flow/cli && npx tsc -b )

# Default: N=20 calls per surface; writes a run JSON.
node v3/@claude-flow/cli/scripts/benchmark-self-learning.mjs

# Optional: machine-readable output, larger sample, no-write mode for CI:
N=100 BENCH_JSON=1 node v3/@claude-flow/cli/scripts/benchmark-self-learning.mjs
BENCH_NO_WRITE=1 node v3/@claude-flow/cli/scripts/benchmark-self-learning.mjs
```

Expected output (with `N=10`):

```
# Self-learning benchmark (#2245) — N=10

| Section | Calls | Delta | Passed | Latency (ms) |
|---|---:|---:|:---:|---:|
| A recordSignalProcessed       | 10 | +10                                        | ✅ | ~0.5    |
| B task-completed (train)      | 10 | trained=10, trajectories+10                | ✅ | ~180 (~18/call) |
| C task-completed (record-only)| 10 | trajectories+0 (negative control)          | ✅ | ~0.05   |
| D pretrain → neural_patterns  | 10 | stored=10, listed=10                       | ✅ | ~5      |
| E multi-step trajectory       |  5 | persisted=5, sonaUpdate=5 (when available) | ✅ | ~25     |

Final state: signalsProcessed=10, trajectoriesRecorded=10, patternsLearned=11
Overall: ✅ ALL PASSED
Wrote .../docs/benchmarks/runs/self-learning-<ts>.json
```

The script exits non-zero if any section's `passed` is `false`, so this also
works as a CI gate: drop it in a CI step and it'll fail the build if any of the
three #2245 wirings regresses.

### Per-section assertions

Each section in the benchmark output corresponds to one of the broken behaviours
in the reporter's trace:

- **§A** — `recordSignalProcessed` increments the previously-dead counter. Repro of "signalsProcessed never changes from 0".
- **§B** — `hooks_task-completed {trainPatterns:true}` invokes the SONA + EWC++ trajectory pipeline. Repro of "task-completed is a stub that returns patternsLearned:0".
- **§C** — Negative control: without `trainPatterns:true`, trajectories do NOT increment. Confirms we didn't accidentally make the surface lie in the other direction.
- **§D** — `pretrain` writes per-pattern rows into the neural store; `neural_patterns list` reflects them. Repro of "neural_patterns list returns [] after pretrain succeeds with 47 patterns extracted".
- **§E** — Multi-step trajectory pipeline persists each cycle; SONA updates when the runtime model is loaded. Confirms the "one path that worked" still works.

### Reproducing the unit-test gate

```bash
cd v3/@claude-flow/cli
npx vitest run __tests__/self-learning-2245.test.ts
```

Expected: **9 tests pass** across three describe blocks — EASY (primitives),
MEDIUM (MCP surfaces), COMPLEX (batch + persistence + multi-step). Each test
maps to one of the three wirings, so a regression in any of them breaks CI.

### Inspecting what each surface actually persisted

After running the benchmark, the scratch directory is cleaned up. To inspect
persistence on your own machine:

```bash
mkdir -p /tmp/ruflo-learn-demo && cd /tmp/ruflo-learn-demo

# Run one task-completed with training enabled
RUFLO_CWD=$(pwd) node -e '
(async () => {
  process.chdir(process.env.RUFLO_CWD);
  const { hooksTools } = await import("/Users/cohen/Projects/ruflo/v3/@claude-flow/cli/dist/src/mcp-tools/hooks-tools.js");
  const tool = hooksTools.find(t => t.name === "hooks_task-completed");
  const r = await tool.handler({
    taskId: "demo-1",
    success: true,
    quality: 0.95,
    trainPatterns: true,
    content: "Refactor: extract helper, reduce duplication.",
  });
  console.log(JSON.stringify(r, null, 2));
})();'

# Check the persisted stats file
cat .claude-flow/neural/stats.json
# Expected: { "trajectoriesRecorded": 1+, "patternsLearned": 0..1, "signalsProcessed": 0+, ... }
```

The handler's return value tells you exactly what happened:

```json
{
  "success": true,
  "taskId": "demo-1",
  "patternsLearned": 1,
  "trajectoriesRecorded": 1,
  "learningPath": "trajectory-pipeline",
  "leadNotified": false,
  "metrics": { "duration": 0, "quality": 0.95, "learningUpdates": 1 },
  "note": "Trained via SONA + EWC++ trajectory pipeline (verdict=success, patternsLearned=1, trajectoriesRecorded=1)."
}
```

Note `learningPath: "trajectory-pipeline"` — that's the explicit "I actually
did the learning work" signal. If the pipeline had failed (e.g. SONA not
available), the handler would return `learningPath: "recorded-only"` plus a
`learningError` field, instead of silently lying about success.

## When the dashboards still show 0

If you're using `ruflo hooks metrics` and seeing zeros, check **which store**
your activity is writing to. The 4 stat aggregators sample different stores:

| Reading from | Reflects activity via |
|---|---|
| `hooks_intelligence_stats` | `globalStats` (trajectory-end + task-completed `trainPatterns:true`) + `sonaCoordinator` |
| `memory_bridge_status` | the memory-bridge SQL store directly |
| `ruflo hooks metrics` | reads `globalStats` + a different aggregator subset |
| `neural_patterns list` | the `.claude-flow/neural/patterns.json` file (pretrain + `neural_patterns store` action) |

This fragmentation is the #2245 reporter's "four contradictory sources" finding
and is being tracked for unification in a future ADR. For now, the rule of
thumb: if you want a number to move in `hooks_intelligence_stats`, drive the
*trajectory pipeline* (either via `hooks_task-completed {trainPatterns:true}` or
the trajectory tools directly). For pretrain output, query `neural_patterns
list`. The benchmark above demonstrates each path landing in its own store.
