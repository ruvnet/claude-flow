---
name: rvf-manage
description: Manage RVF (Ruflo Vector Format) files for portable agent memory and cross-platform transfer
argument-hint: "<import|export|list|migrate|stats|delete> [options]"
allowed-tools: mcp__plugin_ruflo-core_ruflo__memory_store mcp__plugin_ruflo-core_ruflo__memory_retrieve mcp__plugin_ruflo-core_ruflo__memory_list mcp__plugin_ruflo-core_ruflo__memory_delete mcp__plugin_ruflo-core_ruflo__memory_stats mcp__plugin_ruflo-core_ruflo__memory_import_claude mcp__plugin_ruflo-core_ruflo__memory_migrate mcp__plugin_ruflo-core_ruflo__hooks_transfer mcp__plugin_ruflo-core_ruflo__transfer_detect-pii Bash
---

# RVF Management

Manage RVF files for portable, transferable agent memory.

## When to use

When you need to export agent memory to RVF format for backup, transfer between projects, or share knowledge between teams.

## Steps

1. **List memories** — call `mcp__plugin_ruflo-core_ruflo__memory_list` to see all stored memories
2. **Export** — `npx @claude-flow/cli@latest memory export -o <file> [-n <namespace>] [-f json|csv|binary]` (vectors included by default; `--include-vectors false` to drop them). Pick the output path inside the project, never an existing file you have not read
3. **Import** — `npx @claude-flow/cli@latest memory import -i <file> [-n <namespace>]` (merges and skips duplicates by default), or call `mcp__plugin_ruflo-core_ruflo__memory_import_claude` to pull in Claude Code auto-memories
4. **Migrate** — call `mcp__plugin_ruflo-core_ruflo__memory_migrate` for format upgrades
5. **Stats** — call `mcp__plugin_ruflo-core_ruflo__memory_stats` for storage metrics

## RVF format

RVF (Ruflo Vector Format) stores:
- Vector embeddings (384-dim ONNX)
- Metadata (timestamps, namespaces, tags)
- Causal relationships between entries
- Session context and agent scope

## Transfer between projects

Copy patterns from another local project (nothing leaves the machine):

```bash
npx @claude-flow/cli@latest hooks transfer from-project --source /path/to/other/project
```

`hooks transfer store` is different: it is the pattern **marketplace** on the public IPFS registry (`list`, `search`, `download`, `publish`). Never run `publish` for project memory unless the user asks for it, and scan the content for PII and secrets first (`mcp__plugin_ruflo-core_ruflo__transfer_detect-pii`). Anything published may be cached and cannot be recalled.

Exported files are not encrypted by the at-rest setting (see the plugin README); treat them as sensitive if the memory is.
