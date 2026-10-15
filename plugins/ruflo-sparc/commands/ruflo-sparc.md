---
name: ruflo-sparc
description: SPARC methodology commands — initialize, track, advance, and report on Specification-Pseudocode-Architecture-Refinement-Completion workflows
---
$ARGUMENTS

Handle SPARC methodology commands based on the subcommand:

## Subcommands

### `/ruflo-sparc:ruflo-sparc init <feature>`
Initialize a new SPARC workflow for the given feature:
1. Create a feature slug from the feature name (lowercase, hyphenated)
2. Call `mcp__plugin_ruflo-core_ruflo__memory_store` with namespace `sparc-state`, key `current-phase-{slug}`, value `{ "phase": 1, "phaseName": "Specification", "feature": "<feature>", "startedAt": "<ISO timestamp>", "status": "active", "updatedAt": "<ISO timestamp>", "gateAttempts": 0, "artifacts": [] }`
3. Call `mcp__plugin_ruflo-core_ruflo__memory_store` with namespace `sparc-phases`, key `spec-{slug}`, value `{ "status": "pending", "requirements": [], "acceptanceCriteria": [], "constraints": [], "edgeCases": [] }`
4. Display: "SPARC workflow initialized for **<feature>**. Current phase: **1 - Specification**. Run `/ruflo-sparc:ruflo-sparc status` to view progress or begin the specification phase with `/ruflo-sparc:sparc-spec <feature-description>`."

### `/ruflo-sparc:ruflo-sparc status`
Show current SPARC phase and gate check results using exact reads:
1. Call `mcp__plugin_ruflo-core_ruflo__memory_list` with namespace `sparc-state`, `limit: 50`, `offset: 0`. Continue with `offset += entries.length` until offset reaches `total`. A listing error or an empty page before `total` means incomplete status; report it, never claim no workflows.
2. Keep keys starting with `current-phase-`. For each key call `mcp__plugin_ruflo-core_ruflo__memory_retrieve` with that exact key and namespace `sparc-state`. Listing metadata is not phase state. Decode the returned value if JSON-encoded and display the feature, slug, current phase, start time, gate attempts, and completion status. A missing/malformed value is unavailable, not a pending workflow. Do not infer the current phase from a gate or artifact.
   Exclude records with `status === "complete"` from active status. Legacy records without status remain active. Do not infer completion from phase 5 alone. Sort active records newest first by valid state `updatedAt`; for legacy/malformed timestamps fall back to listing metadata `updatedAt`, then `storedAt` (parse ISO strings or numeric epoch milliseconds). Put unknown timestamps last, breaking ties by exact key.
3. Enumerate namespace `sparc-gates` with the same `limit`, `offset`, and `total` pagination. For each feature keep only keys matching `gate-{phase}-{exact-slug}-{timestamp}` (phase 1–5, complete slug match, timestamp suffix). Retrieve each matching key exactly from `sparc-gates`; sort chronologically. Do not mix a slug with its prefix neighbors.
4. Show each gate's phase, passed/failed status, criteria and blockers. Gate history describes past checks; only `current-phase-{slug}` defines current state. Report retrieval failures and concurrent changes as incomplete; a multi-call read is not an atomic snapshot.
5. Display a progress bar based on the retrieved current phase: `[=====>    ] Phase 3/5 — Architecture`.

### `/ruflo-sparc:ruflo-sparc advance`
Attempt to pass the current gate and advance to the next phase:
1. Call `mcp__plugin_ruflo-core_ruflo__memory_retrieve` in `sparc-state` with exact key `current-phase-{slug}`. Decode state; if `status === "complete"`, refuse advance without writing state or another gate. Stop on missing/malformed state.
2. Retrieve phase artifacts from `sparc-phases` namespace
3. Run the gate check for the current phase:
   - **Phase 1 gate**: Verify spec has >= 3 acceptance criteria, explicit constraints, and edge cases identified
   - **Phase 2 gate**: Verify pseudocode covers all acceptance criteria, error paths are explicit, complexity annotated
   - **Phase 3 gate**: Verify architecture addresses all constraints, API contracts are typed, no circular dependencies
   - **Phase 4 gate**: Verify all acceptance criteria have passing tests, code review approved, coverage >= 80%
   - **Phase 5 gate**: Verify all tests green, docs complete, deployment checklist verified, traceability matrix complete
4. Store gate result in `sparc-gates` namespace with key `gate-{phase}-{slug}-{timestamp}`
5. If gate passes:
   - Preserve all existing state fields on every write to namespace `sparc-state`, exact key `current-phase-{slug}`, using `mcp__plugin_ruflo-core_ruflo__memory_store`; set `now = new Date().toISOString()`.
   - **Phases 1–4**: increment phase and update phaseName, retaining other state with `status: "active", updatedAt: now`. Display the next phase.
   - **Phase 5**: only after the final gate passes, write `{ ...state, phase: 5, phaseName: "Completion", status: "complete", completedAt: now, updatedAt: now }` once to that same exact key. Keep phase 5, never increment to 6. Display completion only after the state write succeeds.
6. If gate fails:
   - Preserve existing state and phase, increment `gateAttempts`, and set `updatedAt` to the current ISO timestamp in `sparc-state` at exact key `current-phase-{slug}` via `mcp__plugin_ruflo-core_ruflo__memory_store`. Do not mark state complete or set `completedAt`.
   - Display: "Gate **failed**. Blockers:" followed by the list of failing criteria
   - Suggest specific actions to address each blocker

### `/ruflo-sparc:ruflo-sparc phase <phase-name>`
Jump to a specific phase (for re-entry or iteration):
1. Validate phase-name is one of: `specification`, `pseudocode`, `architecture`, `refinement`, `completion` (or `spec`, `pseudo`, `arch`, `refine`, `complete` as aliases, or a number 1-5)
2. Call `mcp__plugin_ruflo-core_ruflo__memory_retrieve` in `sparc-state` with exact key `current-phase-{slug}`
3. Preserve existing state fields and update phase number and name at exact key `current-phase-{slug}` in `sparc-state` via `mcp__plugin_ruflo-core_ruflo__memory_store`; set `updatedAt` to the current ISO timestamp. Explicit re-entry reopens the workflow with `status: "active"` and removes stale `completedAt`; selecting phase 5 alone does not complete it.
4. Store warning if jumping forward (skipping gates): "Jumping forward skips gate checks. Run `/ruflo-sparc:ruflo-sparc advance` from previous phases to ensure quality."
5. Display: "Phase set to **{N} — {PhaseName}** for {feature}."

### `/ruflo-sparc:ruflo-sparc report`
Generate a full SPARC methodology report:
1. Use the status pagination and exact retrieval procedure above for `sparc-state` and `sparc-gates`. Retrieve the exact artifact keys recorded in current state from `sparc-phases` for the selected feature. A report may include completed workflows; the active-only status filter does not apply to reports.
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
