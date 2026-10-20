# Ruflo on Grok Build

How to run Ruflo inside [Grok Build](https://x.ai/) after `npx ruflo init --grok`.

**Host contract checked against Grok Build 1.0.41** (`grok 1.0.41`, macOS, 2026-09-27) and the user guide shipped with that binary (`~/.grok/docs/user-guide/`). Newer Grok builds change spawn arguments and which keys a project config may set. Run the check in [When Grok updates](#when-grok-updates) before treating this page as current.

Ruflo is the ledger: memory, swarm records, the team bus, hooks. Grok is the executor: it edits files, runs the shell, and calls `spawn_subagent`. After `team_create` or `swarm_init`, keep working. Those calls record coordination. They do not write the feature.

## What `init --grok` writes

| Path | Purpose |
|------|---------|
| `.grok/config.toml` | Project MCP server `ruflo` and permission allows |
| `.grok/rules/ruflo-grok.md` | Host doctrine loaded as a project rule |
| `.grok/agents/` | Session profiles (`ruflo-architect`, `ruflo-coder`, `ruflo-tester`, `ruflo-reviewer`) |
| `.grok/skills/agent-teams-grok/` | Skill the lead follows to spawn a pipeline |
| `.grok/hooks/subagent-stop-team.json` | `SubagentStop` → team bus idle-assign |
| `scripts/grok-team-bus.mjs`, `scripts/grok-team-store.mjs` | Team bus CLI (same store as the MCP `team_*` tools) |
| `scripts/grok-subagent-stop-hook.mjs` | Hook script: advances the plan when a teammate stops |
| `scripts/host-statusline.mjs` | The "what is loaded" line (see Loaded status) |
| `docs/grok/README.md` | This guide |

## Setup

From the app you want Grok to work in (any repo, not only the Ruflo monorepo):

```bash
npx -y ruflo@latest init --grok
# see what it would write, write nothing:
# npx -y ruflo@latest init --grok --dry-run
# overwrite an earlier scaffold:
# npx -y ruflo@latest init --grok --force
```

`init --grok` writes only inside this project, and prints every path it wrote. It pins `[mcp_servers.ruflo]` to the Ruflo version that ran it (for example `ruflo@3.48.0`), because the `team_*` tools ship in that same release and an older `@latest` from a stale npx cache would lack them. Run from a Ruflo source checkout, it points the server at that checkout's `bin/cli.js` instead; re-run it from a published release before you commit `.grok/config.toml`.

Then:

1. Trust the folder. `/hooks-trust`, or launch with `grok --trust`. On 1.0.41 one grant covers project MCP, hooks, skills, and project rules together. The decision is stored in `~/.grok/trusted_folders.toml`.
2. Restart Grok with this folder as the workspace so `.grok/config.toml` loads.
3. Confirm the server:

```bash
grok mcp list          # ruflo (project)
grok mcp doctor ruflo  # handshake ok; team_create present once this build is the server
```

`init` writes the MCP block itself. To register by hand, scope it to the project. The default scope is your user config (`~/.grok/config.toml`), which would install Ruflo for every repo:

```bash
grok mcp add ruflo --scope project -- npx -y ruflo@<version> mcp start
```

Use a version that ships `team_*` (the one `init --grok` pinned). `-s project` is the same flag. Cold `npx` often exceeds the 30s default startup timeout; the scaffold sets `startup_timeout_sec = 120`.

## Use it in a session

Grok does not put each Ruflo tool on the model as its own function. The model has `search_tool` and `use_tool`.

1. `search_tool` with a keyword (`team_create`, `memory_search`, `swarm_init`).
2. `use_tool` with the catalog key: `ruflo__team_create`, `ruflo__memory_search`.
3. Stay on a small subset. A full Ruflo server exposes hundreds of tools; keyword search is how the model reaches them.

MCP parameter names on the team tools are `team` and `agent`.

### Agent teams

```
team_create → team_plan → team_spawn → spawn_subagent → team_send / team_inbox → team_on_stop → team_shutdown
```

`team_spawn` returns a plan. The lead calls `spawn_subagent` with the top-level `prompt` and **only** `host.grok.spawn`:

```text
spawn_subagent({
  prompt:      spawnPlan.prompt,
  description: spawnPlan.host.grok.spawn.description,
  background:  spawnPlan.host.grok.spawn.background,
  isolation:   spawnPlan.host.grok.spawn.isolation
})
```

`host.grok.advisory.capability_mode` and `subagent_type` describe the role. They are not arguments of `spawn_subagent` on 1.0.41. Passing them fails the call. The child is `general-purpose`. The prompt states the read-only constraint. `isolation: "worktree"` is the setting Grok enforces, and it is how writers avoid editing the lead's tree.

Only the lead spawns. A child that calls `spawn_subagent` hits the depth limit (1).

Pass `description` through unchanged. It is `<role>:<agent>@<team>`, and the `SubagentStop` hook parses it to mark that agent idle and advance that team's plan. If a description has no `@team`, the hook uses the one active team that lists the agent; when several do, it advances nothing and says so on stderr.

How the bus behaves:

- State and mail live in `.claude-flow/teams/<team>/` (`team.json`, `mailbox/<agent>/`). Mail is per team: `team_inbox` needs `team` and `agent`, and `team_status` counts only that team's mail.
- `team.json` changes take a lock and are written to a temp file and renamed, so parallel spawns and hooks do not drop updates.
- `team_spawn` refuses once the team has `maxAgents` members (re-spawning an existing member is fine).
- `team_shutdown` closes the team: spawn, send, broadcast, plan, and on-stop refuse afterwards. `team_inbox` and `team_status` still work so remaining mail can be drained. `team_create --force` reopens the name.
- A broadcast (`to: "*"`) goes to current members and is refused while the team has none.
- `priority` is an integer 0-999; lower is read first.
- Several teams can be active at once; every call names its team.

`.grok/agents/ruflo-coder.md` and the other profiles apply when you start Grok as that agent (`grok --agent-profile ruflo-coder` or `/agents`). Spawn does not select them.

CLI bus, same plan shape, no MCP required:

```bash
node scripts/grok-team-bus.mjs create --name feature-x --topology hierarchical
node scripts/grok-team-bus.mjs plan --team feature-x \
  --steps '["architect","developer","tester","reviewer"]'
node scripts/grok-team-bus.mjs spawn --team feature-x --agent architect --role architect \
  --prompt "Design the feature." --next developer
```

Map the printed `spawnPlan.host.grok.spawn` the same way. Skill: `agent-teams-grok`.

### What the project config loads

On 1.0.41, `.grok/config.toml` contributes:

- `[mcp_servers]`
- `[plugins]`
- `[permission]`
- `[mcp].max_output_bytes`

Other tables, including `[subagents]`, are read from `~/.grok/config.toml` only. The scaffold used to write `[subagents] enabled = true` into the project file. That key does nothing there. Subagents are on by default.

Permission allows in the scaffold use Grok's native forms, `Bash(...)` and `MCPTool(ruflo__*)`. Deny still beats allow.

### Hooks

`.grok/hooks/subagent-stop-team.json` runs on `SubagentStop` and calls `scripts/grok-subagent-stop-hook.mjs`. It runs only after the folder is trusted. `$CLAUDE_PROJECT_DIR` is set (alias of `GROK_WORKSPACE_ROOT`).

`UserPromptSubmit` hooks that allow the prompt do not inject stdout into the model on 1.0.41. If a route hook seems to vanish, read `.swarm/route-latest.md` or call the route tool. That is a host limit, not a missing Ruflo file.

## Loaded status

`scripts/host-statusline.mjs` is the shared "what loaded" line: `RuFlo loaded │ ruflo │ rules │ 4 agents │ skill │ hook │ trusted`, or the names of what is missing. Claude shows its own richer `statusLine`. Codex has no status row; `node scripts/host-statusline.mjs --host codex` prints the same facts.

Grok reads `[ui.status_line]` only from your user file, `~/.grok/config.toml`; a project config cannot set it. `init --grok` does not touch that file unless you ask. It prints the snippet to add, or with `--grok-statusline` it:

- copies the script to `~/.grok/ruflo/host-statusline.mjs`, and
- merges this into `~/.grok/config.toml` (parsed with a TOML parser; an existing `ui.status_line` in any form is left alone, and a file it cannot merge safely is not changed — you get the snippet instead):

```toml
[ui.status_line]
type = "command"
command = 'node "/home/you/.grok/ruflo/host-statusline.mjs"'
```

The command is an absolute path to your own copy, so no repo can substitute a script of its own. It reports on whichever folder Grok is in. Restart Grok after the user file changes.

## Prove it

From a Ruflo checkout (this script is not copied by `init --grok`; run `init --grok` in the checkout first):

```bash
node scripts/probe-host-live.mjs --host grok
node scripts/probe-host-live.mjs --host all --no-execute
node scripts/probe-host-live.mjs --host grok --live
```

One contract (discover, connect, SessionStart receipt, optional memory round trip) with a Grok, Claude, or Codex adapter. A check that CLI cannot answer is a skip, not a pass.

## When Grok updates

The July 2026 host work assumed Grok 1.0.34 and a spawn schema that accepted `subagent_type` and `capability_mode`. 1.0.41 dropped both from the model-facing tool and stopped applying `[subagents]` from project config. The same class of drift will happen again.

After `grok --version` changes:

1. Open `~/.grok/docs/user-guide/16-subagents.md` and read **Spawning Subagents**. The parameter table is the contract. Forward a key only if it is listed.
2. Open `26-config-reference.md` and confirm which sections a project `.grok/config.toml` may set (1.0.41: mcp servers, plugins, permission, mcp output cap).
3. Open `07-mcp-servers.md` and confirm `grok mcp add --scope` still defaults to `user`, and that tools are still `search_tool` / `use_tool` with `server__tool` names.
4. Open `10-hooks.md` and confirm `SubagentStop`, folder trust, and `$CLAUDE_PROJECT_DIR`.
5. Open `22-permissions-and-safety.md` and confirm `MCPTool(server__tool)` and `Bash(...)` still match the allows in `.grok/config.toml`.
6. Spawn once with `host.grok.spawn` only. If the tool rejects `background`, the user guide's name for that flag is `run_in_background` — use the name the live schema accepts.
7. Update the `contract` string in `team_spawn` / `scripts/grok-team-bus.mjs` and this page to the version you just checked.

`grok inspect` shows which rules, skills, and MCP servers the trusted folder actually loaded.

## Optional

```bash
npx -y ruflo@latest daemon start
npx -y ruflo@latest doctor
```

RuvNet Brain is off in the scaffold. Uncomment `[mcp_servers.ruvnet-brain]` in `.grok/config.toml` after `npx ruvnet-brain@latest`, and set `env.KB_DIR` to the absolute `~/.cache/ruvnet-brain/kb` path. `init --grok` fills in your home directory for those paths when it creates the file.

Architecture: ADR-402 (Host-Agnostic Agent Teams), in the Ruflo repo at `v3/docs/adr/ADR-402-host-agnostic-agent-teams.md`.
