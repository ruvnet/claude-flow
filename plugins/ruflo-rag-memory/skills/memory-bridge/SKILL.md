---
name: memory-bridge
description: Bridge Claude Code auto-memory into AgentDB with ONNX embeddings, deduplicate, and enable unified cross-project search
argument-hint: "[--all-projects] [--dedupe]"
allowed-tools: Bash Read mcp__plugin_ruflo-core_ruflo__memory_import_claude mcp__plugin_ruflo-core_ruflo__memory_bridge_status mcp__plugin_ruflo-core_ruflo__memory_search_unified
---

# Memory Bridge

Import Claude Code's native auto-memory files into AgentDB for semantic search across sessions and projects.

## What it does

Claude Code stores memories as markdown files in `~/.claude/projects/*/memory/*.md`. This bridge:
1. Reads all memory files (current project or all projects)
2. Generates 384-dim ONNX embeddings (all-MiniLM-L6-v2)
3. Stores in AgentDB's `claude-memories` namespace with HNSW indexing
4. Deduplicates against existing entries (cosine similarity > 0.95)
5. Enables unified semantic search across all memory sources

## Steps

1. **Check bridge health**:
   `mcp__plugin_ruflo-core_ruflo__memory_bridge_status({})`
   Verify: Claude files count, AgentDB entries, SONA state, connection status.

2. **Import memories**:
   - Current project: `mcp__plugin_ruflo-core_ruflo__memory_import_claude({})`
   - All projects: `mcp__plugin_ruflo-core_ruflo__memory_import_claude({ allProjects: true })`

   CLI alternative:
   ```bash
   node .claude/helpers/auto-memory-hook.mjs import-all
   ```

3. **Verify import**:
   `mcp__plugin_ruflo-core_ruflo__memory_bridge_status({})`
   Confirm entry counts match expected file counts.

4. **Deduplicate** (if --dedupe):
   Search for near-duplicate entries (cosine > 0.95) and merge them, keeping the most recent version.

5. **Test unified search**:
   `mcp__plugin_ruflo-core_ruflo__memory_search_unified({ query: "test query", limit: 3 })`
   Results include source attribution: `claude-code`, `auto-memory`, or `agentdb`.

## Auto-import

The bridge runs automatically on `session-start` via the SessionStart hook. Manual invocation is only needed for:
- First-time import of all projects
- After bulk memory changes outside normal sessions
- Forcing re-embedding after model updates

## Integration with ruvector

When `ruflo-ruvector` is loaded, bridged memories are also indexed by ruvector for:
- Hybrid search (sparse + dense with RRF)
- Graph RAG multi-hop queries across memory entries
- Brain knowledge sharing across sessions
