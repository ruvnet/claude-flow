---
name: adr-create
description: Create a new Architecture Decision Record with sequential numbering and AgentDB registration
argument-hint: "<title>"
allowed-tools: mcp__plugin_ruflo-core_ruflo__agentdb_hierarchical-store mcp__plugin_ruflo-core_ruflo__agentdb_hierarchical-query mcp__plugin_ruflo-core_ruflo__agentdb_causal-edge mcp__plugin_ruflo-core_ruflo__memory_store mcp__plugin_ruflo-core_ruflo__memory_search Bash Read Write Edit Grep Glob
---

# Create ADR

Create a new Architecture Decision Record with the next sequential number, register it in the AgentDB graph, and link it to related ADRs.

## When to use

When a significant architectural decision needs to be recorded -- new technology adoption, API design choices, data model changes, infrastructure decisions, or any cross-cutting concern that affects multiple components.

## Steps

1. **Find next number** -- `Glob` for `docs/adr/ADR-*.md` and parse existing numbers to determine the next sequential ID (ADR-001, ADR-002, etc.). Create `docs/adr/` if it does not exist.

2. **Slugify title** -- Convert the title argument to a lowercase, hyphen-separated slug (e.g., "Use PostgreSQL for persistence" becomes `use-postgresql-for-persistence`).

3. **Create ADR file** -- `Write` the file at `docs/adr/ADR-NNN-<slug>.md` using the standard template:
   ```markdown
   # ADR-NNN: <Title>

   - **Status**: proposed
   - **Date**: <today's date YYYY-MM-DD>
   - **Deciders**: <leave blank for author to fill>
   - **Tags**: <leave blank>

   ## Context

   <!-- What is the issue that motivates this decision? -->

   ## Decision

   <!-- What is the change that we are proposing? -->

   ## Consequences

   ### Positive
   -

   ### Negative
   -

   ### Neutral
   -

   ## Links
   ```

4. **Store in AgentDB** -- Call `mcp__plugin_ruflo-core_ruflo__agentdb_hierarchical-store` with:
   - path: `adr/ADR-NNN`
   - value: `{ "id": "ADR-NNN", "title": "<title>", "status": "proposed", "date": "<today>", "file": "docs/adr/ADR-NNN-<slug>.md" }`

5. **Find related ADRs** -- Call `mcp__plugin_ruflo-core_ruflo__memory_search` with the title as query in namespace `adr-patterns` to find related decisions. If matches found, add them to the Links section and create causal edges with relation `depends-on`.

6. **Store pattern** -- Call `mcp__plugin_ruflo-core_ruflo__memory_store` in namespace `adr-patterns` with key `ADR-NNN` and the title + context as value for future semantic search.

7. **Report** -- Output the created file path, ADR number, and any related ADRs found.
