---
name: agent-teams
description: >
  Host-agnostic Agent Teams on the Ruflo team bus: plan a pipeline, register
  teammates, run Codex or other exec hosts as headless turns, and hand off
  through team mailboxes.
  Use when: a task splits into ordered roles (research, design, build, test,
  review) or needs agents on different hosts (Codex, Claude Code, Grok, or a
  custom command host).
  Skip when: one agent can do the whole task, or the work is a single edit.
---

# Agent Teams Skill

## Purpose
Coordinate several agents through Ruflo's team bus instead of a host-specific
messaging tool. Each team's state and mailboxes live in
`.claude-flow/teams/<team>/`, so any host can read and write them.

## When to Trigger
- the task has distinct roles that hand work to each other
- teammates run on different hosts
- you want each step's result recorded and the plan advanced automatically

## When to Skip
- a single agent can finish the task
- single file edits or quick fixes

## Lead loop

1. `team_create` with `host: "codex"` (or `grok`, `claude`, or a label from `.claude-flow/team-hosts.json`).
2. `team_plan` with the ordered agent names.
3. `team_spawn` for each agent with its `role`, `prompt` and `next`. This only registers the agent and returns a plan; it runs nothing.
4. Run each exec-host agent in order:

   ```bash
   ruflo team run --team <team> --agent <agent>
   ```

   The runner starts one headless turn (`codex exec` for Codex), writes a run
   file, delivers the agent's final reply to the next agent (or to `lead`),
   and advances the plan. A non-zero exit, a timeout or a failed turn marks
   the step `failed` and does not advance it; retry with the same command.
   Parallel work means several `ruflo team run` processes, one per agent; a
   second run of an agent that is already running is refused.
5. `team_status` to check progress, and `team_inbox` with `team` and `agent: "lead"` to read results.
6. `team_shutdown` when the plan is complete.

Use `ruflo team run ... --dry-run` to see the exact command before running it.

## Child rules

- Read the "Messages for you" block in your prompt first: the runner moves
  your queued messages there. If the Ruflo MCP tools are available,
  `team_inbox` shows anything that arrived later.
- Stay inside your role's constraint (read-only roles do not change files).
- End with a complete, self-contained reply. The runner delivers it as your
  handoff even if you cannot call `team_send`.

## Commands

### Script access without MCP
```bash
ruflo team status --params '{"team":"<team>"}'
ruflo team inbox --params '{"team":"<team>","agent":"lead","peek":true}'
```

### Custom command host
Declare any one-shot agent CLI in `.claude-flow/team-hosts.json`:

```json
{ "hosts": { "myagent": { "kind": "exec", "command": "myagent",
  "args": ["run", "--message", "{prompt}"], "promptVia": "arg",
  "passEnv": ["MYAGENT_HOME"], "isolation": "none" } } }
```

Placeholders (`{prompt}`, `{team}`, `{agent}`, `{role}`, `{cwd}`,
`{teamRoot}`, `{resultFile}`) must each fill a whole argument. Ruflo never
runs these through a shell. `passEnv` cannot name secrets (keys, tokens,
passwords): the host reads its own credentials. Prefer `"promptVia": "stdin"`
when the CLI supports it, so the prompt is not visible in the process list.

`ruflo team run` runs a command host only after you have reviewed the entry
and trusted it:

```bash
ruflo team trust-host myagent
```

Trust is stored in your home directory and tied to the exact entry; editing
it needs a new trust step. A shell, a command wrapper, or a path as the
command also needs `--allow-unsafe-command`.
