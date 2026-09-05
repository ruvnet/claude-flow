---
name: federation-status
description: Show federation health — peers, sessions, trust levels, and message metrics. Use when the user asks "is federation healthy?", "show peers", "federation status", or wants to inspect cross-installation agent connectivity.
allowed-tools: Bash(npx *) mcp__plugin_ruflo-core_ruflo__memory_search Read
argument-hint: ""
---
Show the current state of the federation.

Steps:
1. `npx -y -p @claude-flow/plugin-agent-federation@latest ruflo-federation status` -- overall health
2. `npx -y -p @claude-flow/plugin-agent-federation@latest ruflo-federation peers` -- list peers with trust levels and scores
3. Summarize: active sessions, messages exchanged, PII redactions, threat detections

Search memory for federation history:
`mcp__plugin_ruflo-core_ruflo__memory_search({ query: "federation peer trust", namespace: "federation" })`
