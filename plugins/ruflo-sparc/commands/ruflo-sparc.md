---
name: ruflo-sparc
description: SPARC methodology commands — initialize, track, advance, and report on Specification-Pseudocode-Architecture-Refinement-Completion workflows
---
$ARGUMENTS

Handle SPARC methodology commands based on the subcommand:

## Subcommands

### `sparc init <feature>`
Initialize a new SPARC workflow for the given feature:
1. Create a feature slug from the feature name (lowercase, hyphenated)
2. Call `mcp__plugin_ruflo-core_ruflo__memory_store` with namespace `sparc-state`, key `current-phase-{slug}`, value `{ "phase": 1, "phaseName": "Specification", "feature": "<feature>", "startedAt": "<ISO timestamp>", "gateAttempts": 0, "artifacts": [] }`
3. Call `mcp__plugin_ruflo-core_ruflo__memory_store` with namespace `sparc-phases`, key `spec-{slug}`, value `{ "status": "pending", "requirements": [], "acceptanceCriteria": [], "constraints": [], "edgeCases": [] }`
4. Display: "SPARC workflow initialized for **<feature>**. Current phase: **1 - Specification**. Run `/sparc status` to view progress or begin the specification phase with `/sparc-spec <feature-description>`."

### `sparc status`
Show current SPARC phase and gate check results:
1. Call `mcp__plugin_ruflo-core_ruflo__memory_search` with namespace `sparc-state` and query `current-phase` to list all active SPARC workflows
2. For each workflow, display:
   - Feature name and slug
   - Current phase number and name (1-Specification, 2-Pseudocode, 3-Architecture, 4-Refinement, 5-Completion)
   - Phase start time and duration
   - Gate attempt count
3. Call `mcp__plugin_ruflo-core_ruflo__memory_search` with namespace `sparc-gates` and query matching the feature slug to list gate check history
4. For each gate result, show: phase, passed/failed, criteria details, blockers if any
5. Display a progress bar: `[=====>    ] Phase 3/5 — Architecture`

### `sparc advance`
Attempt to pass the current gate and advance to the next phase:
1. Retrieve current state from `sparc-state` namespace
2. Retrieve phase artifacts from `sparc-phases` namespace
3. Run the gate check for the current phase:
   - **Phase 1 gate**: Verify spec has >= 3 acceptance criteria, explicit constraints, and edge cases identified
   - **Phase 2 gate**: Verify pseudocode covers all acceptance criteria, error paths are explicit, complexity annotated
   - **Phase 3 gate**: Verify architecture addresses all constraints, API contracts are typed, no circular dependencies
   - **Phase 4 gate**: Verify all acceptance criteria have passing tests, code review approved, coverage >= 80%
   - **Phase 5 gate**: Verify all tests green, docs complete, deployment checklist verified, traceability matrix complete
4. Store gate result in `sparc-gates` namespace with key `gate-{phase}-{slug}-{timestamp}`
5. If gate passes:
   - Increment phase in `sparc-state`
   - Display: "Gate **passed**. Advancing to Phase {N} — {PhaseName}."
   - If advancing past Phase 5: "SPARC workflow **complete** for {feature}. All gates passed."
6. If gate fails:
   - Increment `gateAttempts` in state
   - Display: "Gate **failed**. Blockers:" followed by the list of failing criteria
   - Suggest specific actions to address each blocker

### `sparc phase <phase-name>`
Jump to a specific phase (for re-entry or iteration):
1. Validate phase-name is one of: `specification`, `pseudocode`, `architecture`, `refinement`, `completion` (or `spec`, `pseudo`, `arch`, `refine`, `complete` as aliases, or a number 1-5)
2. Retrieve current state from `sparc-state` namespace
3. Update phase number and name in state
4. Store warning if jumping forward (skipping gates): "Jumping forward skips gate checks. Run `/sparc advance` from previous phases to ensure quality."
5. Display: "Phase set to **{N} — {PhaseName}** for {feature}."

### `sparc report`
Generate a full SPARC methodology report:
1. Retrieve all data from `sparc-state`, `sparc-phases`, and `sparc-gates` namespaces for the active feature
2. Generate a structured report:
   ```
   # SPARC Report: {Feature}

   ## Phase Summary
   | Phase | Status | Gate | Attempts | Duration |
   |-------|--------|------|----------|----------|
   | 1 - Specification | Complete | Passed | 1 | 2h |
   | 2 - Pseudocode | Complete | Passed | 2 | 3h |
   | 3 - Architecture | In Progress | — | 0 | 1h |
   | 4 - Refinement | Pending | — | — | — |
   | 5 - Completion | Pending | — | — | — |

   ## Specification
   - Requirements: [list]
   - Acceptance Criteria: [list]
   - Constraints: [list]

   ## Pseudocode
   - Algorithms: [summary]
   - Data Structures: [summary]

   ## Architecture
   - Bounded Contexts: [list]
   - API Contracts: [summary]

   ## Gate History
   [chronological list of gate attempts with pass/fail details]

   ## Traceability Matrix
   | Acceptance Criterion | Test | Status |
   |---------------------|------|--------|
   | AC-1: ... | test_xxx | Pass |
   ```
3. Display the report
