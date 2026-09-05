---
name: wasm-agent
description: Create and manage sandboxed WASM agents for isolated code execution
argument-hint: "<create|list|prompt|terminate> [options]"
allowed-tools: mcp__plugin_ruflo-core_ruflo__wasm_agent_create mcp__plugin_ruflo-core_ruflo__wasm_agent_list mcp__plugin_ruflo-core_ruflo__wasm_agent_prompt mcp__plugin_ruflo-core_ruflo__wasm_agent_tool mcp__plugin_ruflo-core_ruflo__wasm_agent_files mcp__plugin_ruflo-core_ruflo__wasm_agent_export mcp__plugin_ruflo-core_ruflo__wasm_agent_terminate Bash
---

# WASM Agent

Create sandboxed agents that run in WebAssembly for safe, isolated execution.

## When to use

When you need to run untrusted code, experiment with agent configurations, or create portable agents that run anywhere WASM is supported.

## Steps

1. **Create agent** — call `mcp__plugin_ruflo-core_ruflo__wasm_agent_create` with agent configuration
2. **Send prompt** — call `mcp__plugin_ruflo-core_ruflo__wasm_agent_prompt` to interact with the agent
3. **Use tools** — call `mcp__plugin_ruflo-core_ruflo__wasm_agent_tool` to give the agent access to specific tools
4. **Manage files** — call `mcp__plugin_ruflo-core_ruflo__wasm_agent_files` to read/write files in the sandbox
5. **Export** — call `mcp__plugin_ruflo-core_ruflo__wasm_agent_export` to package the agent for sharing
6. **List agents** — call `mcp__plugin_ruflo-core_ruflo__wasm_agent_list` to see all running WASM agents
7. **Terminate** — call `mcp__plugin_ruflo-core_ruflo__wasm_agent_terminate` to stop an agent

## Benefits

- Full sandbox isolation — agents cannot access the host filesystem
- Portable — export and run on any WASM runtime
- Reproducible — same behavior across platforms
- Safe — no risk of system damage from agent actions
