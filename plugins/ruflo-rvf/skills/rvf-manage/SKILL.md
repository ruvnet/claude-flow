---
name: rvf-manage
description: Manage RVF (Ruflo Vector Format) files for portable agent memory and cross-platform transfer
argument-hint: "<import|export|list|migrate|stats|delete> [options]"
allowed-tools: mcp__plugin_ruflo-core_ruflo__memory_store mcp__plugin_ruflo-core_ruflo__memory_retrieve mcp__plugin_ruflo-core_ruflo__memory_list mcp__plugin_ruflo-core_ruflo__memory_delete mcp__plugin_ruflo-core_ruflo__memory_stats mcp__plugin_ruflo-core_ruflo__memory_import_claude mcp__plugin_ruflo-core_ruflo__memory_migrate mcp__plugin_ruflo-core_ruflo__hooks_transfer Bash
---

# RVF Management

Manage RVF files for portable, transferable agent memory.

## When to use

When you need to export agent memory to RVF format for backup, transfer between projects, or share knowledge between teams.

## Steps

1. **List memories** — call `mcp__plugin_ruflo-core_ruflo__memory_list` to see all stored memories
2. **Export** — use the `mcp__plugin_ruflo-core_ruflo__hooks_transfer` tool with `store` action to export patterns
3. **Import** — call `mcp__plugin_ruflo-core_ruflo__memory_import_claude` to import from Claude Code memories
4. **Migrate** — call `mcp__plugin_ruflo-core_ruflo__memory_migrate` for format upgrades
5. **Stats** — call `mcp__plugin_ruflo-core_ruflo__memory_stats` for storage metrics

## RVF format

RVF (Ruflo Vector Format) stores:
- Vector embeddings (384-dim ONNX)
- Metadata (timestamps, namespaces, tags)
- Causal relationships between entries
- Session context and agent scope

## Transfer between projects

```bash
npx @claude-flow/cli@latest hooks transfer store --pattern "project-knowledge"
npx @claude-flow/cli@latest hooks transfer from-project --source /path/to/other/project
```
