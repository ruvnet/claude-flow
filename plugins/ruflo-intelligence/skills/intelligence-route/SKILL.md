---
name: intelligence-route
description: Route tasks via the 3-tier model selector and learned patterns; emits a routing rationale via hooks_explain
argument-hint: "<task-description> [--why]"
allowed-tools: mcp__plugin_ruflo-core_ruflo__hooks_route mcp__plugin_ruflo-core_ruflo__hooks_explain mcp__plugin_ruflo-core_ruflo__hooks_model-route mcp__plugin_ruflo-core_ruflo__hooks_model-stats mcp__plugin_ruflo-core_ruflo__hooks_model-outcome mcp__plugin_ruflo-core_ruflo__hooks_intelligence_pattern-search mcp__plugin_ruflo-core_ruflo__hooks_intelligence_attention mcp__plugin_ruflo-core_ruflo__hooks_intelligence_stats mcp__plugin_ruflo-core_ruflo__neural_predict mcp__plugin_ruflo-core_ruflo__hooks_pre-task Bash
---

# Intelligence Routing

Pick the optimal agent + model tier for a task using learned patterns + the 3-tier router. Emits a `hooks_explain` rationale so the choice is auditable.

## When to use

Before starting any non-trivial task. Replaces manual agent selection with data-driven decisions.

## Steps

1. **Get an agent recommendation** — `mcp__plugin_ruflo-core_ruflo__hooks_route` with the task description. Returns `{ recommended, confidence, reasoning }`.
2. **Get a model tier recommendation** — `mcp__plugin_ruflo-core_ruflo__hooks_model-route` for Haiku/Sonnet/Opus selection.
3. **Search for similar past patterns** — `mcp__plugin_ruflo-core_ruflo__hooks_intelligence_pattern-search` to find prior successes.
4. **Predict outcome** — `mcp__plugin_ruflo-core_ruflo__neural_predict` with the task description for a confidence-scored prediction.
5. **Spawn the recommended agent** at the recommended model tier.
6. **(If `--why` was passed)** — call `mcp__plugin_ruflo-core_ruflo__hooks_explain` to surface the routing rationale to the user.
7. **After task completes** — call `mcp__plugin_ruflo-core_ruflo__hooks_model-outcome` with `success: true|false` to train the router.

## 3-Tier Model Routing

| Tier | Handler | Latency | Cost | When |
|------|---------|---------|------|------|
| 1 | Deterministic codemod (TS compiler) | ~1ms | $0 | Structural transforms with no LLM: `var-to-const`, `remove-console`, `add-logging` |
| 2 | Haiku | ~500ms | ~$0.0002 | Low complexity (<30%), bug fixes, quick patches |
| 3 | Sonnet/Opus | 2–5s | $0.003–$0.015 | Complex reasoning, architecture, security, multi-file refactors |

When `hooks_route` returns `[CODEMOD_AVAILABLE]` for a deterministic intent (`var-to-const`, `remove-console`, `add-logging`), call `mcp__plugin_ruflo-core_ruflo__hooks_codemod` with the intent + file — it applies the transform via the TypeScript compiler at $0, no LLM. Note: `add-types`, `add-error-handling`, `async-await` require judgement and route to a model (Tier 2/3) per ADR-143; they are NOT $0 codemods. Agent Booster is a fast-apply merge engine for LLM-produced edits, not the Tier-1 path.

## Recording outcomes

Closing the routing loop is mandatory:

```bash
# Success
mcp tool call hooks_model-outcome --json -- '{"taskId": "T123", "success": true, "model": "haiku"}'

# Failure with reason
mcp tool call hooks_model-outcome --json -- '{"taskId": "T123", "success": false, "model": "haiku", "reason": "complexity-misjudged"}'
```

The router learns from these calls. Skipping them = no learning.

## CLI alternative

```bash
npx @claude-flow/cli@latest hooks route --task "description"
npx @claude-flow/cli@latest hooks pre-task --description "description"
npx @claude-flow/cli@latest hooks explain --topic "routing decision"
```
