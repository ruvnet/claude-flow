---
name: run
description: Run a ruflo agent (claude -p) on one of your ruOS desktops and stream its output into the swarm
---
$ARGUMENTS

Place one swarm agent on a ruOS desktop. Follow the `ruos-host-run` skill. Summary:

- **Target**: a desktop from the caller's own `desktop_status` list (id, Fly id or exact
  name). Anything else is refused.
- **Stopped desktop**: do not start it unless the user asked (`--start`); starting is billable.
- **Auto-stop**: refuse a run whose timeout crosses the next weekday 23:00
  America/Toronto stop unless the user passes `--ignore-autostop`.
- **CLI path** (env-configured fleet MCP or SSH):

  `node "${CLAUDE_PLUGIN_ROOT}/scripts/cli.mjs" run --desktop "<ref>" --prompt-file <file> [--model sonnet] [--timeout 900] [--start]`

- **Session path** (fleet MCP connected in Claude Code): `cli.mjs build` prints the exact
  `desktop_exec` command strings; send them in order, poll, and report lifecycle with
  `cli.mjs record start|output|end` so the swarm ledger stays one source.

Never put task text into a `desktop_exec` command yourself — only the strings `build` prints.
Never contact a desktop on port 17870.
