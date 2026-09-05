# Self-Learning — Usage Guide

> Copy-paste examples for the three paths ruflo's self-learning system actually
> supports, plus how to pretrain it from a repo's GitHub history and verify
> that learning happened.
>
> Companion to ADR-074 (wiring), ADR-075 (unified stats), ADR-076
> (Structured Distillation), and ADR-077 (pretrain from history).

## TL;DR — pick the path that matches your goal

| You want to… | Use | Persists where |
|---|---|---|
| Train on a single task completion | `hooks_task-completed {trainPatterns:true}` | `globalStats` + memory-bridge |
| Train on a multi-step workflow | `hooks_intelligence_trajectory-{start,step,end}` | `globalStats` + memory-bridge + sonaCoordinator |
| Just store an episode (no learning) | `memory_store` / `memory_store_episode` | memory-bridge only |
| Bootstrap from a repo's git+issues history | `scripts/pretrain-from-github.mjs` | All four stores |
| Ask "did learning happen?" | `hooks_intelligence_unified-stats` | (read-only aggregator) |

If you call the wrong tool, the response will tell you. Every learning surface
returns `learningPath: 'trajectory-pipeline' | 'recorded-only'` plus a `note`
naming exactly what fired and what didn't.

---

## 1) Train on a single task completion

```bash
# Via the MCP tool (most common — Claude Code agents use this)
mcp__ruflo__hooks_task-completed {
  taskId: 'fix-2245-stub',
  success: true,
  quality: 0.95,
  trainPatterns: true,
  content: 'Wired hooks_task-completed to feed the SONA trajectory pipeline.'
}

# Response includes:
# {
#   learningPath: 'trajectory-pipeline',
#   patternsLearned: 1,
#   trajectoriesRecorded: 1,
#   note: 'Trained via SONA + EWC++ trajectory pipeline …'
# }
```

If `trainPatterns: true` is omitted, the response says
`learningPath: 'recorded-only'` and the note explains what to set if you wanted
learning to fire. No silent stubs.

---

## 2) Train on a multi-step workflow

```javascript
// 1. Start
const { trajectoryId } = await mcp.hooks_intelligence_trajectory-start({
  task: 'Refactor auth middleware',
  agent: 'system-architect',
});

// 2. Record each step
await mcp.hooks_intelligence_trajectory-step({
  trajectoryId, type: 'observation',
  content: 'src/auth/middleware.ts has 80 lines of duplicated JWT parsing',
});
await mcp.hooks_intelligence_trajectory-step({
  trajectoryId, type: 'action',
  content: 'Extract to jwt-verify helper in @claude-flow/security',
});
await mcp.hooks_intelligence_trajectory-step({
  trajectoryId, type: 'result',
  content: 'src/auth/middleware.ts now imports verifyJwt; lines 45-128 removed',
});

// 3. Close with verdict
const end = await mcp.hooks_intelligence_trajectory-end({
  trajectoryId, success: true,
});

// `end.learning` contains: sonaUpdate, ewcConsolidation, patternsExtracted,
//                         globalStatsTrajectoriesDelta
```

This path also fires SONA + EWC++, and additionally captures the multi-step
structure so the learned pattern includes the *reasoning chain*, not just the
final outcome.

---

## 3) Just store an episode (no learning)

When you want to remember something but don't want it shaping future routing:

```bash
mcp__ruflo__memory_store {
  key: 'note-2026-05-30',
  value: 'Reminder: the Opus alias bump landed in 3.10.14',
  namespace: 'notes',
}

# memory_search_unified can find it later, but no globalStats counters move.
```

---

## 4) Pretrain from a repo's GitHub history

The fastest way to bootstrap the learning system on an existing project:

```bash
# Defaults: 50 commits + 30 issues
node v3/@claude-flow/cli/scripts/pretrain-from-github.mjs

# Larger:
COMMITS=200 ISSUES=100 node v3/@claude-flow/cli/scripts/pretrain-from-github.mjs

# Git only (no gh CLI required):
SOURCE=git node v3/@claude-flow/cli/scripts/pretrain-from-github.mjs

# Machine-readable for CI:
BENCH_JSON=1 node v3/@claude-flow/cli/scripts/pretrain-from-github.mjs
```

Each commit and each issue becomes a one-step trajectory. Structured
Distillation (ADR-076) compresses each content blob into the 4-field schema
before embedding, so high-signal tokens (file paths, action verbs) lead.

The script writes a run JSON with measured before/after counters to
`docs/benchmarks/runs/pretrain-from-github-latest.json`. The script exits
non-zero if any counter didn't move — usable as a CI gate.

---

## 5) Verify learning happened

Two complementary verifiers.

### Counter-based (any time)

```bash
mcp__ruflo__hooks_intelligence_unified-stats {}

# Returns: { global, sona, memoryBridge, neuralPatterns, consistency }
# Each sub-view names its source path. The consistency block flags drift
# between stores (e.g. globalStats moved but neural_patterns didn't).
```

### Retrieval-based (after pretrain)

```bash
node v3/@claude-flow/cli/scripts/benchmark-pretrained-retrieval.mjs

# Runs 10 sample queries against the neural store and reports top-k matches.
# If pretrain populated the store correctly, every query should match a
# relevant past entry.
```

---

## How to read the consistency block

When `hooks_intelligence_unified-stats` returns a non-empty `consistency.notes`,
that's a real cross-store drift you should look at:

```jsonc
"consistency": {
  "sonaTracksGlobal": true,                  // SONA matches globalStats within ±1
  "sonaTracksGlobalDelta": 0,
  "notes": [
    "globalStats reports 47 patterns learned but neural_patterns store is empty — pretrain has not written here, or trajectory-end isn't promoting patterns to the neural store yet"
  ]
}
```

This note from ADR-075 surfaces *exactly* the gap #2245 reported (pretrain
bumps globalStats but doesn't populate neural_patterns). Round B of the same
ADR-074 work already wired the writes; the note is the safety net that
catches future regressions.

---

## Reproduce all the proofs in this repo

```bash
git clone https://github.com/ruvnet/ruflo && cd ruflo
npm install && ( cd v3/@claude-flow/cli && npx tsc -b )

# ⓐ Self-learning wiring (5 sections — primitives → MCP surfaces → multi-step)
node v3/@claude-flow/cli/scripts/benchmark-self-learning.mjs

# ⓑ Structured Distillation MRR (raw vs distilled retrieval)
node v3/@claude-flow/cli/scripts/benchmark-trajectory-mrr.mjs

# ⓒ Pretrain from this repo's git+issues history
node v3/@claude-flow/cli/scripts/pretrain-from-github.mjs

# ⓓ Retrieval after pretrain (10 sample queries)
node v3/@claude-flow/cli/scripts/benchmark-pretrained-retrieval.mjs
```

All four scripts write run JSONs to `docs/benchmarks/runs/`. All four are
non-zero on failure, so they double as CI gates.

---

## Common gotchas

- **"My dashboard shows 0 after I called `post-edit`"** — read the
  `learningPath` field. If it's `'recorded-only'`, the trajectory pipeline
  wasn't reachable in the calling process. Run from inside ruflo's CLI
  process or set up the bridge explicitly.
- **"`neural_patterns list` is empty after `pretrain`"** — fixed in 3.10.14
  (ADR-074). Make sure you're on `npx ruflo@3.10.14` or later.
- **"`hooks_intelligence_stats` shows different numbers than
  `memory_bridge_status`"** — that's by design (they measure different
  layers). Use `hooks_intelligence_unified-stats` for one coherent view,
  per ADR-075.
- **"My recall@10 dropped"** — run `node
  v3/@claude-flow/cli/scripts/benchmark-codemods.mjs` and
  `benchmark-recall.mjs`. Both are CI gates that fail if recall regresses
  below the documented floor (0.90).
