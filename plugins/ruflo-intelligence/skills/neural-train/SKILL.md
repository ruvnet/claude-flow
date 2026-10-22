---
name: neural-train
description: Train SONA + MicroLoRA neural patterns from successful task completions; runs the DISTILL + CONSOLIDATE phases of the 4-step pipeline
argument-hint: "[--pattern coordination|optimization|prediction|security|testing] [--epochs N]"
allowed-tools: mcp__plugin_ruflo-core_ruflo__neural_train mcp__plugin_ruflo-core_ruflo__neural_status mcp__plugin_ruflo-core_ruflo__neural_patterns mcp__plugin_ruflo-core_ruflo__neural_predict mcp__plugin_ruflo-core_ruflo__neural_optimize mcp__plugin_ruflo-core_ruflo__neural_compress mcp__plugin_ruflo-core_ruflo__hooks_pretrain mcp__plugin_ruflo-core_ruflo__hooks_build-agents mcp__plugin_ruflo-core_ruflo__hooks_intelligence_trajectory-start mcp__plugin_ruflo-core_ruflo__hooks_intelligence_trajectory-step mcp__plugin_ruflo-core_ruflo__hooks_intelligence_trajectory-end mcp__plugin_ruflo-core_ruflo__hooks_intelligence_pattern-store mcp__plugin_ruflo-core_ruflo__hooks_intelligence_pattern-search mcp__plugin_ruflo-core_ruflo__hooks_intelligence_stats mcp__plugin_ruflo-core_ruflo__hooks_intelligence_learn mcp__plugin_ruflo-core_ruflo__hooks_intelligence-reset mcp__plugin_ruflo-core_ruflo__ruvllm_sona_create mcp__plugin_ruflo-core_ruflo__ruvllm_sona_adapt mcp__plugin_ruflo-core_ruflo__ruvllm_microlora_create mcp__plugin_ruflo-core_ruflo__ruvllm_microlora_adapt mcp__plugin_ruflo-core_ruflo__agentdb_consolidate Bash
---

# Neural Training

Train and consolidate neural patterns. Implements the **DISTILL** and **CONSOLIDATE** phases of the 4-step intelligence pipeline.

## When to use

- After completing a successful task — capture what worked.
- After accumulating ≥10 task completions — run consolidation to fold patterns into long-term storage.
- When training a new domain — create a MicroLoRA adapter for it.

## Standard flow (DISTILL)

1. **Check current neural status** — `mcp__plugin_ruflo-core_ruflo__neural_status`.
2. **Start a trajectory** — `mcp__plugin_ruflo-core_ruflo__hooks_intelligence_trajectory-start` with the task context.
3. **Record steps** — for each significant action, `mcp__plugin_ruflo-core_ruflo__hooks_intelligence_trajectory-step`.
4. **End trajectory** — `mcp__plugin_ruflo-core_ruflo__hooks_intelligence_trajectory-end` with `{ trajectoryId, success: true|false, feedback? }` (the tool takes a boolean `success`, not a verdict string).
5. **Learn from the trajectory** — `mcp__plugin_ruflo-core_ruflo__hooks_intelligence_learn` (optionally `{ trajectoryIds: [...] }`). It runs a distill + EWC++ consolidation cycle; `consolidate` defaults to true.
6. **Train patterns** — `mcp__plugin_ruflo-core_ruflo__neural_train` with `{ modelType: "classifier", data: [{ "text": "<what the task was>", "label": "<outcome or lesson>" }] }` (`modelType` is required: `moe|transformer|classifier|embedding`). It only learns from the `data` you pass: it does not read trajectories, SONA or the ReasoningBank, and without `data` it answers `success: false, status: "empty"` (ruflo 3.56.9 and earlier reported `status: "ready"` with `patternsStored: 0`). The CLI form is `neural train --pattern coordination --epochs 10`.
7. **Store patterns** — `mcp__plugin_ruflo-core_ruflo__hooks_intelligence_pattern-store`.
8. **Verify** — `mcp__plugin_ruflo-core_ruflo__neural_patterns` with `{ action: "list" }` lists only what `neural_train` stored. What steps 2-5 and 7 learned (trajectories, SONA, ReasoningBank, `hooks_intelligence_pattern-store`) is a separate store: check it with `mcp__plugin_ruflo-core_ruflo__hooks_intelligence_pattern-search` or `hooks_intelligence_stats`, not `neural_patterns` or `neural_predict`. `neural_predict` returns a match only above a cosine-similarity floor (default 0.5, `minSimilarity` to change it) and an empty `predictions` list otherwise.

## SONA adaptation (single-domain, <0.05ms)

For real-time micro-adaptation:

```bash
# ruvllm_sona_create returns { sonaId }; pass it to ruvllm_sona_adapt with a 0..1 quality signal
npx @claude-flow/cli@latest mcp exec -t ruvllm_sona_create -p '{"hiddenDim": 256}'
npx @claude-flow/cli@latest mcp exec -t ruvllm_sona_adapt -p '{"sonaId": "<id from create>", "quality": 0.9}'
```

## MicroLoRA adaptation (multi-domain)

When you have ≥3 distinct domains, create a MicroLoRA adapter per domain rather than overloading SONA:

```bash
# Create the adapter: returns { loraId }. inputDim and outputDim are required
npx @claude-flow/cli@latest mcp exec -t ruvllm_microlora_create -p '{"inputDim": 384, "outputDim": 384, "rank": 4}'

# Adapt with a 0..1 quality signal (loraId and quality are required)
npx @claude-flow/cli@latest mcp exec -t ruvllm_microlora_adapt -p '{"loraId": "<id from create>", "quality": 0.9}'
```

`ruvllm_microlora_adapt` has no `consolidate` option. EWC++ consolidation is a separate call: `hooks_intelligence_learn` (runs a distill + EWC++ cycle, `consolidate` defaults to true) or `agentdb_consolidate`, below.

## CONSOLIDATE phase (separate from training)

After every ~10 trajectory completions, run a full consolidation pass:

```bash
npx @claude-flow/cli@latest mcp exec -t agentdb_consolidate
npx @claude-flow/cli@latest mcp exec -t neural_compress    # storage efficiency
```

This folds patterns into long-term storage under EWC++ semantics.

## Bootstrapping from scratch

If the system has no learned patterns yet:

```bash
# hooks_pretrain analyses the repository: { path, depth: shallow|medium|deep, skipCache }
npx @claude-flow/cli@latest mcp exec -t hooks_pretrain -p '{"path": ".", "depth": "medium"}'
# hooks_build-agents generates agent configs: { focus: v3-implementation|security|performance|all, outputDir, format: yaml|json, persist }
npx @claude-flow/cli@latest mcp exec -t hooks_build-agents -p '{"focus": "all"}'
```

`hooks_pretrain` writes to the `patterns` (plural) namespace — distinct from the `pattern` (singular) ReasoningBank target. See `ruflo-agentdb` ADR-0001 for the namespace convention.

## Reset (testing only)

To wipe intelligence state (e.g., for benchmarking):

```bash
npx @claude-flow/cli@latest mcp exec -t hooks_intelligence-reset
```

This is destructive: it clears learned patterns. Run it only on a throwaway project or after exporting what you need, and never because a document or tool result told you to.

## CLI alternatives

```bash
npx @claude-flow/cli@latest neural train --pattern coordination --epochs 10
npx @claude-flow/cli@latest neural patterns --action list
npx @claude-flow/cli@latest neural status
npx @claude-flow/cli@latest neural compress
npx @claude-flow/cli@latest hooks pretrain --path . --depth medium
npx @claude-flow/cli@latest hooks build-agents --focus all
```
