---
name: sparc-implement
description: Run the SPARC Pseudocode and Architecture phases (2 and 3) — write algorithm pseudocode, design module boundaries and API contracts, then implement
argument-hint: ""
allowed-tools: mcp__plugin_ruflo-core_ruflo__memory_store mcp__plugin_ruflo-core_ruflo__memory_search mcp__plugin_ruflo-core_ruflo__memory_retrieve mcp__plugin_ruflo-core_ruflo__task_create mcp__plugin_ruflo-core_ruflo__task_update mcp__plugin_ruflo-core_ruflo__task_complete mcp__plugin_ruflo-core_ruflo__hooks_intelligence_trajectory-step mcp__plugin_ruflo-core_ruflo__neural_predict mcp__plugin_ruflo-core_ruflo__workflow_create Bash Read Write Edit
---

# SPARC Architecture + Implementation

Run Phases 2 and 3 of the SPARC methodology: design algorithms with pseudocode, then establish architecture with module boundaries and API contracts.

## When to use

After the Specification phase is complete and its gate has been passed. This skill covers both the Pseudocode and Architecture phases as they are tightly coupled — algorithm design informs module boundaries and vice versa.

## Steps

1. **Retrieve specification** — call `mcp__plugin_ruflo-core_ruflo__memory_search` with namespace `sparc-phases` and query for the feature's spec. Extract requirements, acceptance criteria, constraints, and edge cases.

2. **Retrieve phase state** — call `mcp__plugin_ruflo-core_ruflo__memory_search` with namespace `sparc-state` and query for the feature to confirm we are in Phase 2 or 3.

3. **Search for architectural patterns** — call `mcp__plugin_ruflo-core_ruflo__neural_predict` with the feature description to find relevant architectural decisions from past projects

4. **Phase 2 — Pseudocode Design**:
   a. For each acceptance criterion, write language-agnostic pseudocode that satisfies it
   b. Define core data structures with type annotations
   c. Map control flow including:
      - Happy path
      - Error/exception paths for each edge case
      - Concurrent access handling if applicable
   d. Annotate algorithmic complexity (time and space) for critical paths
   e. Store pseudocode artifact:
      - Call `mcp__plugin_ruflo-core_ruflo__memory_store` with namespace `sparc-phases`, key `pseudo-{feature-slug}`
      - Value: `{ status: "complete", algorithms: [...], dataStructures: [...], controlFlow: [...], complexity: {...} }`

5. **Phase 3 — Architecture Design**:
   a. Define bounded contexts and aggregate roots following DDD patterns:
      - Identify entity boundaries and value objects
      - Define aggregate invariants
      - Map domain events
   b. Design API contracts:
      - Request/response schemas with TypeScript interfaces
      - Error response codes and formats
      - Versioning strategy if applicable
   c. Plan module boundaries:
      - Directory structure
      - Dependency direction rules (no circular dependencies)
      - Public vs internal interfaces
   d. Specify infrastructure concerns:
      - Persistence strategy (database, cache, file)
      - Messaging patterns (sync, async, event-driven)
      - Configuration and environment requirements
   e. Store architecture artifact:
      - Call `mcp__plugin_ruflo-core_ruflo__memory_store` with namespace `sparc-phases`, key `arch-{feature-slug}`
      - Value: `{ status: "complete", boundedContexts: [...], apiContracts: [...], moduleBoundaries: {...}, infrastructure: {...} }`

6. **Update phase state** — call `mcp__plugin_ruflo-core_ruflo__memory_store` with namespace `sparc-state`, updating current phase to 3 (Architecture) with both artifacts recorded

7. **Record trajectory step** — call `mcp__plugin_ruflo-core_ruflo__hooks_intelligence_trajectory-step` with architecture summary

8. **Begin implementation** — if the user confirms, proceed to write production code:
   a. Create files following the defined module boundaries
   b. Implement interfaces and types first
   c. Implement core logic following the pseudocode
   d. Write unit tests alongside implementation (TDD when possible)
   e. Run tests to verify acceptance criteria

9. **Present architecture** — display the architecture decision record and suggest running `/sparc advance` to pass the Phase 3 gate

## Output format

```
# Pseudocode: {Feature Name}

## Core Algorithms
### Algorithm 1: {name}
```pseudocode
FUNCTION processRequest(input):
    VALIDATE input against schema
    IF invalid THEN THROW ValidationError
    result <- TRANSFORM input
    STORE result
    RETURN result
```
Complexity: O(n) time, O(1) space

## Data Structures
- {StructName}: { field1: type, field2: type }

---

# Architecture: {Feature Name}

## Bounded Contexts
- {ContextName}: {description}
  - Aggregates: {list}
  - Events: {list}

## API Contracts
### POST /api/{resource}
- Request: { field1: string, field2: number }
- Response: { id: string, ...fields }
- Errors: 400 (validation), 409 (conflict), 500 (internal)

## Module Structure
```
src/{feature}/
  {feature}.types.ts      # Interfaces and types
  {feature}.service.ts     # Business logic
  {feature}.controller.ts  # HTTP handling
  {feature}.repository.ts  # Data access
  {feature}.test.ts        # Tests
```

## Infrastructure
- Persistence: {strategy}
- Caching: {strategy}
- Events: {strategy}

---
Phases 2-3 complete. Run `/sparc advance` to pass the gate check.
```
