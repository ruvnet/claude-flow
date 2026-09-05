---
name: dossier-collect
description: Build a graph-structured dossier on a seed entity via parallel fan-out + recursive expansion across web, memory, knowledge-graph, codebase, ADR index, and git intel
argument-hint: "<seed> [--max-depth N] [--max-breadth N] [--sources s1,s2] [--budget-usd N] [--exact]"
allowed-tools: mcp__plugin_ruflo-core_ruflo__memory_store mcp__plugin_ruflo-core_ruflo__memory_search mcp__plugin_ruflo-core_ruflo__memory_search_unified mcp__plugin_ruflo-core_ruflo__agentdb_pattern-search mcp__plugin_ruflo-core_ruflo__agentdb_pattern-store mcp__plugin_ruflo-core_ruflo__agentdb_hierarchical-recall mcp__plugin_ruflo-core_ruflo__embeddings_search mcp__plugin_ruflo-core_ruflo__hooks_intelligence_pattern-search mcp__plugin_ruflo-core_ruflo__hooks_intelligence_pattern-store mcp__plugin_ruflo-core_ruflo__hooks_intelligence_trajectory-start mcp__plugin_ruflo-core_ruflo__hooks_intelligence_trajectory-step mcp__plugin_ruflo-core_ruflo__hooks_intelligence_trajectory-end mcp__plugin_ruflo-core_ruflo__task_create Bash WebSearch WebFetch Read Write Grep Glob
---

# Dossier Collect

Recursive parallel investigation that builds a graph-structured dossier on a seed entity.

## When to use

You have a seed (a username, file, symbol, ADR-id, URL, or concept) and want to **expand outward** discovering every connected entity, with provenance per claim — rather than answering a specific question.

For specific questions use `deep-research`. For multi-step plans use `goal-plan`.

## Steps

1. **Detect seed type** — classify as one of: `username` (handle), `file` (path), `symbol` (code identifier), `adr` (ADR-NNN), `url`, or `concept` (free text).
2. **Pick sources** — match the source matrix to the seed type. Default: all applicable.
3. **Start trajectory** — call `mcp__plugin_ruflo-core_ruflo__hooks_intelligence_trajectory-start` with task `dossier:<slug>`.
4. **Round 0 fan-out** — issue ALL source queries in ONE message. Examples:
   - For `username`: `WebSearch`, `WebFetch` on github.com/<user>, `mcp__plugin_ruflo-core_ruflo__memory_search_unified`
   - For `adr`: `Read` ADR file, `Grep` references, `mcp__plugin_ruflo-core_ruflo__memory_search` namespace `adr`
   - For `symbol`: `Grep`, `Glob`, `mcp__plugin_ruflo-core_ruflo__embeddings_search`
5. **Extract entities** — from each hit, surface entities (people, repos, files, adrs, urls, terms). Lightweight regex + heuristics; no LLM extraction unless ambiguous.
6. **De-dup** — drop entities already in the dossier. If `--exact` is unset, also drop entities whose embedding cosine similarity ≥ 0.92 to an existing node.
7. **Round k recursion** — for each new entity (capped at `--max-breadth` per source), recurse to step 4 until depth ≥ `--max-depth` OR budget exhausted.
8. **Aggregate** — build `{ nodes, edges }` graph. Each node carries `{ id, type, attrs, sources: [...] }`. Each edge carries `{ from, to, kind, source, confidence }`.
9. **Render artifacts**:
   - `<slug>.md` — executive summary, entity table, mermaid graph, source-provenance footnotes
   - `<slug>.json` — machine-readable graph
   - Default location: `v3/docs/examples/dossiers/<slug>/`
10. **Persist** — `mcp__plugin_ruflo-core_ruflo__memory_store` namespace `dossier` key `<slug>`.
11. **End trajectory** — `mcp__plugin_ruflo-core_ruflo__hooks_intelligence_trajectory-end` with success status.

## Output schema (JSON)

```json
{
  "seed": "ruvnet",
  "seedType": "username",
  "depth": 2,
  "truncated": false,
  "generatedAt": "ISO-8601",
  "nodes": [
    { "id": "ruvnet", "type": "username", "attrs": { "...": "..." }, "sources": ["WebSearch", "github.com"] }
  ],
  "edges": [
    { "from": "ruvnet", "to": "ruflo", "kind": "owns", "source": "github.com", "confidence": "high" }
  ],
  "stats": { "nodesByType": {}, "sourcesUsed": [], "tokensSpent": 0 }
}
```

## Budget discipline

- If `--budget-usd` is set, track approximate cost via trajectory. On exhaustion: emit partial dossier with `truncated: true` and the entities still queued.
- BFS expansion only — finish round *k* before round *k+1*.
- Never silently truncate. Always mark and record what was skipped.

## Examples

```
/ruflo-goals:dossier-collect ruvnet
/ruflo-goals:dossier-collect ADR-097 --max-depth 1
/ruflo-goals:dossier-collect "src/memory/hnsw.ts" --sources codebase,git,memory
/ruflo-goals:dossier-collect "ruflo-goals" --max-breadth 5 --budget-usd 1
```
