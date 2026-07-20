---
name: adr
description: Architecture Decision Record lifecycle management
---
$ARGUMENTS

Manage Architecture Decision Records. Parse $ARGUMENTS to determine the subcommand:

### Subcommands

**`adr create <title>`** -- Create a new ADR with the next sequential number.
1. Scan `docs/adr/` for existing ADRs to determine the next number
2. Create `docs/adr/ADR-NNN-<slug>.md` from the standard template
3. Store in AgentDB: `mcp__plugin_ruflo-core_ruflo__agentdb_hierarchical-store` at path `adr/ADR-NNN`
4. Report the created file path and ADR number

**`adr list`** -- List all ADRs with their status.
1. `Glob` for `docs/adr/ADR-*.md`
2. `Read` each file's frontmatter/header to extract status
3. Present a table: Number | Title | Status | Date

**`adr status <adr-id> <new-status>`** -- Update an ADR's status.
1. Find the ADR file matching `<adr-id>` (e.g., ADR-042 or just 042)
2. Update the Status line to the new value (proposed, accepted, deprecated, superseded)
3. Update AgentDB entry

**`adr supersede <old-id> <new-id>`** -- Mark an ADR as superseded by another.
1. Update `<old-id>` status to "superseded by [ADR-<new-id>]"
2. Add "Supersedes: ADR-<old-id>" link in `<new-id>`
3. Create causal edge: `mcp__plugin_ruflo-core_ruflo__agentdb_causal-edge` from old to new with relation "supersedes"

**`adr check`** -- Scan recent git changes for ADR violations.
1. Run `git log --oneline -20` to get recent commits
2. `git diff HEAD~20..HEAD --name-only` to get changed files
3. `Grep` those files for ADR references (`ADR-\d+`)
4. For each referenced ADR, check if it is still "accepted"
5. Flag violations: code referencing deprecated/superseded ADRs, or code that contradicts accepted ADRs

**`adr graph`** -- Show ADR dependency graph.
1. Query `mcp__plugin_ruflo-core_ruflo__agentdb_causal-query` for all ADR relationships
2. Present the graph as an ASCII tree or indented list showing supersedes/amends/depends-on chains

**`adr search <query>`** -- Semantic search across ADRs.
1. Call `mcp__plugin_ruflo-core_ruflo__memory_search` with the query in namespace `adr-patterns`
2. Also `Grep` ADR files for keyword matches
3. Present ranked results with ADR number, title, relevance, and excerpt
