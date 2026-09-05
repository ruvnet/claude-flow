---
name: goal-plan
description: Create and execute Goal-Oriented Action Plans (GOAP) with precondition analysis, cost optimization, and adaptive replanning
argument-hint: "<goal-description>"
allowed-tools: mcp__plugin_ruflo-core_ruflo__task_create mcp__plugin_ruflo-core_ruflo__task_list mcp__plugin_ruflo-core_ruflo__task_status mcp__plugin_ruflo-core_ruflo__task_assign mcp__plugin_ruflo-core_ruflo__task_update mcp__plugin_ruflo-core_ruflo__task_complete mcp__plugin_ruflo-core_ruflo__task_summary mcp__plugin_ruflo-core_ruflo__memory_store mcp__plugin_ruflo-core_ruflo__memory_search mcp__plugin_ruflo-core_ruflo__neural_predict mcp__plugin_ruflo-core_ruflo__workflow_create mcp__plugin_ruflo-core_ruflo__workflow_execute mcp__plugin_ruflo-core_ruflo__workflow_status mcp__plugin_ruflo-core_ruflo__hooks_intelligence_trajectory-start mcp__plugin_ruflo-core_ruflo__hooks_intelligence_trajectory-step mcp__plugin_ruflo-core_ruflo__hooks_intelligence_trajectory-end Bash Read Write Edit
---

# Goal Plan

Create and execute intelligent plans using Goal-Oriented Action Planning (GOAP).

## When to use

When you have a complex objective that requires multiple steps, has dependencies between steps, and may need adaptive replanning as conditions change.

## Steps

1. **Define goal state** — what does "done" look like? List concrete success criteria
2. **Assess current state** — what's true now? What assets, code, infrastructure exist?
3. **Identify gap** — what must change between current and goal state?
4. **Inventory actions** — list available actions with:
   - Preconditions (what must be true before this action)
   - Effects (what becomes true after this action)
   - Cost estimate (time, complexity, risk)
5. **Generate plan** — find the optimal action sequence using A* through the state space
6. **Record trajectory** — call `mcp__plugin_ruflo-core_ruflo__hooks_intelligence_trajectory-start` to begin tracking
7. **Create tasks** — call `mcp__plugin_ruflo-core_ruflo__task_create` for each action in the plan
8. **Execute** — work through tasks in dependency order:
   - Before each action: verify preconditions still hold
   - After each action: verify effects achieved
   - Record each step via `mcp__plugin_ruflo-core_ruflo__hooks_intelligence_trajectory-step`
9. **Monitor & replan** — if an action fails or produces unexpected results:
   - Reassess current state
   - Recalculate optimal path from new state
   - Update remaining tasks
10. **Complete trajectory** — call `mcp__plugin_ruflo-core_ruflo__hooks_intelligence_trajectory-end`
11. **Store successful plan** — call `mcp__plugin_ruflo-core_ruflo__memory_store` with namespace `goap-plans`

## Plan output format

```
Goal: [concrete objective]
Current State: [key facts]
Plan Cost: [estimated effort]
Steps:
  1. [action] — precondition: [X], effect: [Y], cost: [Z]
  2. [action] — precondition: [Y], effect: [W], cost: [Z]
  ...
Risk Factors: [what could force a replan]
Fallback: [alternative approach if primary path fails]
```

## Replanning triggers

- Action fails (precondition no longer met)
- Unexpected side effects detected
- New information changes goal definition
- Cost exceeds threshold
- External dependency becomes unavailable
