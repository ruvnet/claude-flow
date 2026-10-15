---
name: view
description: Watch the ruOS desktop a ruflo agent is running on — delegates to ruOS's own viewer
---
$ARGUMENTS

Open a view of a ruOS desktop that hosts a ruflo agent. ruflo-ruos does not implement a
viewer; it delegates:

1. If the ruOS Claude Code mod is installed (`/ruos` commands available), run
   `/ruos view <desktop>` — that owns the `ruos-view` pane.
2. Else, if the fleet MCP is connected, call `desktop_share` for a revocable, expiring,
   view-only link (or `computer_screenshot` for a single frame).
3. Else tell the user to open https://ruos.cognitum.one/dashboard/#desktops.

Resolve `<desktop>` from the agent's `config.host.desktopId` (`npx ruflo agent status <id>`)
or `.claude-flow/ruos/hosts.json`. Never open an interactive control session
(`desktop_control`) unless the user asks for hands-on control.
