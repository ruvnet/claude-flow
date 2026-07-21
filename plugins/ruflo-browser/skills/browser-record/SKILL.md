---
name: browser-record
description: Open a named, traced browser session into an RVF cognitive container with a ruvector trajectory recording every action
argument-hint: "<url-or-task> [--with-dom] [--viewport WxH]"
allowed-tools: mcp__plugin_ruflo-core_ruflo__browser_open mcp__plugin_ruflo-core_ruflo__browser_close mcp__plugin_ruflo-core_ruflo__browser_session-list mcp__plugin_ruflo-core_ruflo__browser_screenshot mcp__plugin_ruflo-core_ruflo__browser_snapshot mcp__plugin_ruflo-core_ruflo__browser_wait mcp__plugin_ruflo-core_ruflo__aidefence_has_pii mcp__plugin_ruflo-core_ruflo__aidefence_scan Bash Read Write
---

# Browser Record

Primitive on which every other browser skill composes. Opens a named browser session, allocates an RVF container for it, and binds every action to a ruvector trajectory step. **You do not run a browser session in this plugin without invoking this skill (or one that wraps it).**

## When to use

- Starting any browser interaction that is not a one-off throwaway probe.
- Exploring a site interactively while preserving the trace for later replay or analysis.
- Establishing a reusable session that downstream skills (`browser-extract`, `browser-form-fill`, `browser-test`) will compose.

## Steps

1. **Allocate session id and RVF container**:
   ```bash
   SID="$(date +%Y%m%d-%H%M%S)-${TASK_SLUG:-record}"
   npx -y ruvector@0.2.25 rvf create "$SID.rvf" --dimension 384
   npx -y ruvector@0.2.25 hooks trajectory-begin --session-id "$SID" --task "$1"
   ```
2. **Open the browser** via `mcp__plugin_ruflo-core_ruflo__browser_open` with the URL.
3. **Snapshot the initial state**: `browser_snapshot` for the accessibility tree, `browser_screenshot` for a baseline image.
4. **For each interaction**, record a trajectory step before and after:
   ```bash
   npx -y ruvector@0.2.25 hooks trajectory-step \
     --session-id "$SID" --action click --args '{"selector":"#login"}' --result ok
   ```
5. **End cleanly**:
   ```bash
   npx -y ruvector@0.2.25 hooks trajectory-end --session-id "$SID" --verdict pass
   npx -y ruvector@0.2.25 rvf compact "$SID.rvf"
   ```
6. **Index in AgentDB** under `browser-sessions`:
   ```bash
   npx -y @claude-flow/cli@latest memory store --namespace browser-sessions \
     --key "$SID" --value "{rvf_id:$SID,host:...,task:...,verdict:pass}"
   ```

## Caveats

- Until the `browser_session_record` MCP tool ships (ADR-0001 §7), this skill drives the lifecycle from inside its own bash steps. Do not call `mcp__plugin_ruflo-core_ruflo__browser_open` directly without these wrappers.
- The session id format is fixed: `<YYYYMMDD-HHMMSS>-<task-slug>`. Downstream `/ruflo-browser ls` parses this.
- `--with-dom` is expensive (full HTML dump per nav). Off by default.
- AIDefence gates apply at extraction time, not at navigation time. `browser-record` is a primitive; redaction is the responsibility of skills that read content (`browser-extract`, `browser-test`).
