---
name: deep-research
description: Orchestrate multi-phase deep research with web search, memory retrieval, pattern matching, and synthesis into structured findings
argument-hint: "<topic>"
allowed-tools: mcp__plugin_ruflo-core_ruflo__memory_store mcp__plugin_ruflo-core_ruflo__memory_search mcp__plugin_ruflo-core_ruflo__memory_search_unified mcp__plugin_ruflo-core_ruflo__agentdb_hierarchical-store mcp__plugin_ruflo-core_ruflo__agentdb_hierarchical-recall mcp__plugin_ruflo-core_ruflo__agentdb_pattern-search mcp__plugin_ruflo-core_ruflo__agentdb_pattern-store mcp__plugin_ruflo-core_ruflo__neural_predict mcp__plugin_ruflo-core_ruflo__hooks_intelligence_pattern-search mcp__plugin_ruflo-core_ruflo__hooks_intelligence_pattern-store mcp__plugin_ruflo-core_ruflo__task_create mcp__plugin_ruflo-core_ruflo__task_list mcp__plugin_ruflo-core_ruflo__task_summary Bash WebSearch WebFetch Read Write
---

# Deep Research

Orchestrate multi-phase deep research campaigns that gather, cross-reference, and synthesize information from multiple sources.

## When to use

When you need to investigate a complex topic thoroughly — spanning web sources, codebase patterns, stored memory, and external documentation — and produce a structured synthesis.

## Steps

1. **Define research scope** — break the question into 3-7 sub-questions that together answer the main question
2. **Search existing knowledge** — call `mcp__plugin_ruflo-core_ruflo__memory_search_unified` and `mcp__plugin_ruflo-core_ruflo__agentdb_pattern-search` to check what's already known
3. **Web research** — use `WebSearch` and `WebFetch` to gather external information for each sub-question
4. **Codebase analysis** — use `Bash` (grep/find), `Read` to examine relevant source files
5. **Cross-reference** — compare findings across sources, identify agreements and contradictions
6. **Store findings** — call `mcp__plugin_ruflo-core_ruflo__memory_store` with namespace `research` for each key finding
7. **Store patterns** — call `mcp__plugin_ruflo-core_ruflo__agentdb_pattern-store` for reusable patterns discovered
8. **Synthesize** — produce a structured research report with:
   - Executive summary (2-3 sentences)
   - Key findings (bulleted)
   - Evidence quality assessment (high/medium/low per finding)
   - Open questions remaining
   - Recommended next steps

## Research depth levels

- **Quick** — memory search + 1-2 web queries, 2-3 minutes
- **Standard** — memory + web + codebase scan, 5-10 minutes
- **Deep** — all sources + cross-referencing + pattern storage, 15-30 minutes
- **Exhaustive** — deep + spawn sub-agents for parallel research threads, 30+ minutes

## Memory namespaces

- `research` — raw findings keyed by topic
- `research-synthesis` — completed synthesis reports
- `research-sources` — source URLs and references
