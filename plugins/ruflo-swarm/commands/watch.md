---
name: watch
description: Live-stream swarm events and agent activity in real time
---
$ARGUMENTS

Start a live event stream for the active swarm. Use the Monitor tool to run:

`node "${CLAUDE_PLUGIN_ROOT}/scripts/swarm-watch.mjs"`

The ruflo CLI has no `swarm watch`; this script polls `swarm status --format json` (default every 10 s, `--interval 2..300`) and prints one NDJSON line only when the status changes: `swarm.snapshot` first, then `swarm.changed`, or `swarm.error` once per distinct failure. It reports status changes, not individual agent or memory events. Each line is one notification, so you do not poll yourself.

For one-shot status checks, use `/status` or `npx @claude-flow/cli@latest swarm status` instead.
