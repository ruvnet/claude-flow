---
name: sparc-spec
description: Run the SPARC Specification phase — gather requirements, define acceptance criteria, identify constraints, and store the spec in memory
argument-hint: "<feature-description>"
allowed-tools: mcp__plugin_ruflo-core_ruflo__memory_store mcp__plugin_ruflo-core_ruflo__memory_search mcp__plugin_ruflo-core_ruflo__memory_retrieve mcp__plugin_ruflo-core_ruflo__task_create mcp__plugin_ruflo-core_ruflo__task_update mcp__plugin_ruflo-core_ruflo__task_complete mcp__plugin_ruflo-core_ruflo__hooks_intelligence_trajectory-start mcp__plugin_ruflo-core_ruflo__hooks_intelligence_trajectory-step mcp__plugin_ruflo-core_ruflo__neural_predict Bash Read Edit
---

# SPARC Specification Phase

Run Phase 1 of the SPARC methodology: define what must be built and how success is measured.

## When to use

When starting a new feature or project that needs structured requirements gathering before any code is written. This phase produces the foundational specification that all subsequent phases (Pseudocode, Architecture, Refinement, Completion) build upon.

## Steps

1. **Initialize phase tracking** — call `mcp__plugin_ruflo-core_ruflo__hooks_intelligence_trajectory-start` with metadata `{ "phase": "specification", "feature": "$ARGUMENTS" }`

2. **Check for prior work** — call `mcp__plugin_ruflo-core_ruflo__memory_search` with namespace `sparc-state` and query for the feature to see if a SPARC workflow already exists. If it does, retrieve existing artifacts. If not, initialize state with phase 1.

3. **Search for similar patterns** — call `mcp__plugin_ruflo-core_ruflo__neural_predict` with the feature description to find relevant past specifications and learned patterns

4. **Gather requirements** — analyze the feature description and the codebase to identify:
   - **Functional requirements**: what the feature must do (user-facing behaviors)
   - **Non-functional requirements**: performance targets, security constraints, scalability needs
   - **Integration points**: what existing systems or APIs are affected
   - **Data requirements**: what data is created, read, updated, or deleted

5. **Define acceptance criteria** — write at least 3 concrete, testable acceptance criteria in Given/When/Then format:
   ```
   AC-1: Given [precondition], when [action], then [expected result]
   AC-2: Given [precondition], when [action], then [expected result]
   AC-3: Given [precondition], when [action], then [expected result]
   ```

6. **Identify constraints** — document:
   - Performance constraints (latency, throughput, resource limits)
   - Security constraints (authentication, authorization, data sensitivity)
   - Compatibility constraints (browser support, API versions, backward compatibility)
   - Infrastructure constraints (deployment environment, dependencies)

7. **Map edge cases** — list at least 3 edge cases or failure scenarios:
   - What happens with invalid input?
   - What happens under concurrent access?
   - What happens when external dependencies fail?

8. **Store specification** — call `mcp__plugin_ruflo-core_ruflo__memory_store` with:
   - Namespace: `sparc-phases`
   - Key: `spec-{feature-slug}`
   - Value: JSON with `{ status: "complete", requirements, acceptanceCriteria, constraints, edgeCases, integrationPoints }`

9. **Update phase state** — call `mcp__plugin_ruflo-core_ruflo__memory_store` with:
   - Namespace: `sparc-state`
   - Key: `current-phase-{feature-slug}`
   - Value: updated state with artifacts list including the spec key

10. **Record trajectory step** — call `mcp__plugin_ruflo-core_ruflo__hooks_intelligence_trajectory-step` with the specification summary

11. **Present specification** — display the full specification document to the user with a summary table and suggest running `/sparc advance` to pass the gate and move to the Pseudocode phase

## Output format

```
# Specification: {Feature Name}

## Requirements
### Functional
- FR-1: ...
- FR-2: ...

### Non-Functional
- NFR-1: ...

## Acceptance Criteria
- AC-1: Given ..., when ..., then ...
- AC-2: Given ..., when ..., then ...
- AC-3: Given ..., when ..., then ...

## Constraints
- Performance: ...
- Security: ...
- Compatibility: ...

## Edge Cases
- EC-1: ...
- EC-2: ...
- EC-3: ...

## Integration Points
- IP-1: ...

---
Phase 1 complete. Run `/sparc advance` to pass the gate check.
```
