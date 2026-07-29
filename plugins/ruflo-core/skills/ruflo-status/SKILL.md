---
name: ruflo-status
description: Diagnose Ruflo health, then report system, MCP server, and active-agent status without changing the installation
argument-hint: "[--fix]"
allowed-tools: Bash(npx *)
---

# Ruflo status

Use this skill when the user asks for Ruflo health, diagnostics, MCP server
state, or active-agent status.

## Default read-only workflow

Run these commands in order:

```bash
npx @claude-flow/cli@latest doctor
npx @claude-flow/cli@latest status
```

Summarize the diagnostics and status together. Do not repair, reset, start,
stop, install, or otherwise change anything during the default workflow.

## Explicit repair workflow

Only when the user explicitly asks to fix or auto-repair the installation,
replace the first command with:

```bash
npx @claude-flow/cli@latest doctor --fix
npx @claude-flow/cli@latest status
```

Report what the repair changed and the resulting status. Never infer
authorization for `doctor --fix` from a request to check or diagnose Ruflo.
