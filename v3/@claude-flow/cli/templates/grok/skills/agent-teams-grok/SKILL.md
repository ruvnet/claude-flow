---
name: agent-teams-grok
description: >
  Run Ruflo-style named Agent Teams on Grok Build using the host-agnostic team bus
  (scripts/grok-team-bus.mjs). Use when coordinating multi-agent pipelines, feature
  development with architect→coder→tester→reviewer, or replacing Claude SendMessage.
---

# Agent Teams on Grok (ADR-402)

Claude `SendMessage` / TeammateTool are **not** available. Prefer **Ruflo MCP** `team_*` tools; CLI bus is the fallback.

## Preferred: MCP tools

| Tool | Purpose |
|------|---------|
| `team_create` | Create team + topology |
| `team_plan` | Ordered pipeline steps |
| `team_spawn` | Register agent; returns **spawn plan** for `spawn_subagent` |
| `team_send` / `team_broadcast` | Handoff messages |
| `team_inbox` | Drain/peek mailbox |
| `team_status` / `team_on_stop` / `team_shutdown` | Lifecycle |

Discover: `search_tool` query `team_create`. Call via `use_tool` as `ruflo__team_create` etc.

## Quick start (CLI fallback)

```bash
# 1. Create team
node scripts/grok-team-bus.mjs create --name feature-x --topology hierarchical

# 2. Register plan
node scripts/grok-team-bus.mjs plan --team feature-x \
  --steps '["architect","developer","tester","reviewer"]'

# 3. Register agents (prints spawnPlan JSON for spawn_subagent)
node scripts/grok-team-bus.mjs spawn --team feature-x --agent architect --role architect \
  --prompt "Design <feature>. Handoff to developer." --next developer
node scripts/grok-team-bus.mjs spawn --team feature-x --agent developer --role developer \
  --prompt "Implement from architect design." --next tester
node scripts/grok-team-bus.mjs spawn --team feature-x --agent tester --role tester \
  --prompt "Test implementation." --next reviewer
node scripts/grok-team-bus.mjs spawn --team feature-x --agent reviewer --role reviewer \
  --prompt "Review code and tests."
```

## Lead (you) then

Checked against **Grok Build 1.0.41**. Pass only the live spawn arguments:

```
spawn_subagent({
  prompt: spawnPlan.prompt,
  description: spawnPlan.host.grok.spawn.description,
  background: spawnPlan.host.grok.spawn.background,
  isolation: spawnPlan.host.grok.spawn.isolation,
})
```

1. Parse `spawnPlan.host.grok.spawn` (and `prompt`). Call **`spawn_subagent`** in **one message** for every agent (`background: true`).
2. Leave `host.grok.advisory` on the plan. `capability_mode` and `subagent_type` are not spawn arguments on this Grok. The prompt carries the read-only or worktree constraint. `isolation` is the knob Grok enforces.
3. `.grok/agents/ruflo-*` are session profiles (`grok --agent-profile ruflo-coder` or `/agents`). `spawn_subagent` does not select them. An omitted type is `general-purpose`.
4. Children must not call `spawn_subagent`. Nesting depth is 1. The lead spawns the whole pipeline.
5. Pass `description` unchanged (`<role>:<agent>@<team>`): the `SubagentStop` hook reads it to run `on-stop` for that team. Then spawn or resume the next step if needed.
6. Synthesize results; `shutdown` the team. A shut-down team refuses spawn and send; `team_create --force` reopens the name.

Every call names its team: mail is per team, and several teams can run at once. `team_spawn` stops at the team's `maxAgents`.

If `grok --version` is newer than 1.0.41, re-read `~/.grok/docs/user-guide/16-subagents.md` (Spawning Subagents) before forwarding extra keys. A key the schema dropped fails the spawn.

## Defaults

| Role | Prompt constraint (`advisory.capability_mode`) | `isolation` (passed through) |
|------|------------------------------------------------|------------------------------|
| architect / reviewer | read-only | `none` |
| developer / tester | full tools | **`worktree`** |

## Messaging

```bash
node scripts/grok-team-bus.mjs send --team feature-x --to developer \
  --from architect --summary "design" --message "..."
node scripts/grok-team-bus.mjs inbox --team feature-x --agent developer
node scripts/grok-team-bus.mjs status --team feature-x
```

## Also use Ruflo MCP when live

- `memory_search` / `memory_store` with namespace `team:feature-x`
- `swarm_init` for coordination records (then **you** still execute)

## Anti-patterns

- Waiting for `swarm start` to write code
- Inventing SendMessage
- Passing `capability_mode` or `subagent_type` into `spawn_subagent` (they are advisory on Grok Build 1.0.41)
- Parallel coders on the same tree without worktrees
- A child calling `spawn_subagent` (depth limit is 1)
