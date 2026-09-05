---
name: ruflo-browser
description: Browser session lifecycle dispatcher -- ls/show/replay/export/fork/purge/doctor over RVF-backed session containers
---

$ARGUMENTS
Browser session management via RVF cognitive containers + AgentDB index. Parse the verb from $ARGUMENTS.

Usage: /ruflo-browser <verb> [args]

Verbs:

1. **ls [--query "<text>"] [--host <host>] [--verdict pass|fail|partial]**
   List browser sessions. Backs onto AgentDB `browser-sessions` namespace.
   ```bash
   npx -y @claude-flow/cli@latest memory list --namespace browser-sessions
   # or with semantic filter:
   npx -y @claude-flow/cli@latest memory search --namespace browser-sessions --query "QUERY"
   ```
   For active (live) sessions, also call `mcp__plugin_ruflo-core_ruflo__browser_session-list`.

2. **show `<session-id>`**
   Print the session manifest + last 20 trajectory entries + verdict.
   ```bash
   npx -y ruvector@0.2.25 rvf status <session-id>.rvf
   npx -y ruvector@0.2.25 rvf segments <session-id>.rvf
   ```
   Then `Read` the trajectory.ndjson tail and the findings.md.

3. **replay `<session-id>` [--url <new-url>] [--mutate <json>]**
   Invoke the `browser-replay` skill on the named session.
   When the `browser_session_replay` MCP tool ships, this verb shells through to it.

4. **export `<session-id>` [-o <path>] [--federate]**
   ```bash
   npx -y ruvector@0.2.25 rvf export <session-id>.rvf -o <path>
   ```
   With `--federate`, also push via the `ruflo-federation` plugin.

5. **fork `<session-id>` [--name <new-name>]**
   ```bash
   npx -y ruvector@0.2.25 rvf derive <session-id>.rvf <new-name>.rvf
   ```
   Lineage tracked. Cookies, selectors, templates inherited.

6. **purge `<session-id>` [--keep-manifest]**
   Destroy the RVF container. Default keeps a redacted manifest in `browser-sessions` so future searches still find the trace; pass `--no-keep-manifest` to wipe completely.

7. **doctor**
   Run the structural health check:
   ```bash
   bash plugins/ruflo-browser/scripts/smoke.sh
   ```
   Plus dependency probes:
   - Playwright runner reachable (`mcp__plugin_ruflo-core_ruflo__browser_open` against `about:blank`)
   - AgentDB controllers initialized (`mcp__plugin_ruflo-core_ruflo__agentdb_health`)
   - AIDefence loaded (`mcp__plugin_ruflo-core_ruflo__aidefence_stats`)
   - ruvector pinned to 0.2.25 (`npx -y ruvector@0.2.25 --version`)

Notes:
- Verbs `replay`, `fork`, and the `browser_session_*` MCP tools are part of the v0.2.0 architecture but their MCP-tool implementation is pending (see ADR-0001 Verification §4 spike).
- Until the lifecycle MCP tools ship, `replay` and `fork` operate at the RVF-container level; the actual browser drive is invoked through the `browser-replay` skill, not a single MCP call.
- For interactive primitive operations (open/click/fill/eval) use the existing `browser-record` / `browser-test` / `browser-extract` skills, not this dispatcher.
