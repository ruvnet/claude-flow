---
name: adr-review
description: Review code changes against accepted ADRs for compliance violations
argument-hint: "[--branch BRANCH]"
allowed-tools: mcp__plugin_ruflo-core_ruflo__agentdb_hierarchical-query mcp__plugin_ruflo-core_ruflo__agentdb_causal-query mcp__plugin_ruflo-core_ruflo__memory_search Bash Read Grep Glob
---

# ADR Review

Review code changes against accepted Architecture Decision Records to detect violations, drift, and non-compliance.

## When to use

Before merging a PR, after significant code changes, or as part of a periodic compliance check. Use this to ensure code changes respect the architectural decisions the team has agreed upon.

## Steps

1. **Get diff** -- Run `git diff main...HEAD --name-only` (or the specified branch) to list changed files. Then run `git diff main...HEAD` to get the full diff content.

2. **Find relevant ADRs** -- For each changed file:
   - `Grep` the file for ADR references (`ADR-\d+`)
   - `Grep` `docs/adr/` for ADRs that mention the changed file paths or modules
   - Call `mcp__plugin_ruflo-core_ruflo__memory_search` with the file path and change summary to find semantically related ADRs

3. **Load ADR content** -- `Read` each relevant ADR file. Focus on:
   - The **Decision** section (what was decided)
   - The **Status** (only enforce "accepted" ADRs)
   - The **Consequences** (expected constraints)

4. **Check for violations** -- Analyze each changed file against its relevant ADRs:
   - Does the code change contradict an accepted decision?
   - Does it use a technology/pattern that an ADR explicitly rejected?
   - Does it modify a module in a way the ADR's consequences warned against?
   - Is the code referencing a deprecated or superseded ADR?

5. **Query relationship graph** -- Call `mcp__plugin_ruflo-core_ruflo__agentdb_causal-query` to check if any referenced ADRs have been superseded. If so, flag that the code references an outdated decision.

6. **Report** -- Present findings as a compliance report:
   ```
   ## ADR Compliance Report

   ### Violations
   - [ ] <file>:<line> — violates ADR-NNN: <reason>

   ### Warnings
   - [!] <file> references superseded ADR-NNN (replaced by ADR-MMM)

   ### Compliant
   - [x] <file> — consistent with ADR-NNN

   ### Unlinked Changes
   - [?] <file> — no ADR coverage (consider creating one)
   ```

7. **Suggest actions** -- For each violation, suggest whether to update the code or propose a new ADR to supersede the violated one.
