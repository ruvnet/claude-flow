---
name: horizon-track
description: Track long-horizon objectives across multiple sessions with milestone checkpoints, progress persistence, and drift detection
argument-hint: "<objective-name>"
allowed-tools: mcp__plugin_ruflo-core_ruflo__memory_store mcp__plugin_ruflo-core_ruflo__memory_search mcp__plugin_ruflo-core_ruflo__memory_list mcp__plugin_ruflo-core_ruflo__memory_retrieve mcp__plugin_ruflo-core_ruflo__task_list mcp__plugin_ruflo-core_ruflo__task_summary mcp__plugin_ruflo-core_ruflo__progress_check mcp__plugin_ruflo-core_ruflo__progress_summary mcp__plugin_ruflo-core_ruflo__agentdb_hierarchical-store mcp__plugin_ruflo-core_ruflo__agentdb_hierarchical-recall mcp__plugin_ruflo-core_ruflo__hooks_intelligence_pattern-store mcp__plugin_ruflo-core_ruflo__session_save mcp__plugin_ruflo-core_ruflo__session_restore Bash Read Write
---

# Horizon Track

Track long-running objectives that span multiple sessions, days, or weeks.

## When to use

When an objective is too large for a single session — multi-week features, research programs, migration projects, or any work that requires persistent progress tracking across conversations.

## Steps

1. **Initialize horizon** — define the objective, target date, and 3-7 milestones
2. **Store horizon** — call `mcp__plugin_ruflo-core_ruflo__memory_store` with namespace `horizons` and key `horizon-[name]`:
   ```json
   {
     "objective": "...",
     "created": "2026-04-28",
     "targetDate": "2026-05-15",
     "milestones": [
       {"id": "m1", "name": "...", "criteria": "...", "status": "pending"},
       {"id": "m2", "name": "...", "criteria": "...", "status": "pending"}
     ],
     "currentMilestone": "m1",
     "sessions": []
   }
   ```
3. **Session check-in** — at the start of each session:
   - Recall horizon: `mcp__plugin_ruflo-core_ruflo__memory_retrieve` key `horizon-[name]` namespace `horizons`
   - Review milestone status
   - Assess drift (are we still on track?)
   - Plan this session's contribution
4. **Work and record** — as work progresses:
   - Update milestone status
   - Record session summary
   - Store intermediate findings
5. **Session check-out** — at the end of each session:
   - Update horizon state in memory
   - Record what was accomplished
   - Note blockers or scope changes
   - Estimate remaining effort
6. **Milestone completion** — when a milestone is done:
   - Verify completion criteria met
   - Store learned patterns via `mcp__plugin_ruflo-core_ruflo__hooks_intelligence_pattern-store`
   - Advance to next milestone
7. **Drift detection** — flag when:
   - Progress rate suggests target date will be missed
   - Scope has grown beyond original definition
   - Dependencies have changed
   - Approach needs fundamental rethinking

## Memory namespaces

- `horizons` — active horizon definitions and state
- `horizon-sessions` — per-session summaries keyed by `[horizon]-[date]`
- `horizon-learnings` — patterns and insights discovered during the horizon
