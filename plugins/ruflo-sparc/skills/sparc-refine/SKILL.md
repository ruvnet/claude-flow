---
name: sparc-refine
description: Run the SPARC Refinement and Completion phases — review code, improve test coverage, validate against specification, and generate documentation
argument-hint: ""
allowed-tools: mcp__plugin_ruflo-core_ruflo__memory_store mcp__plugin_ruflo-core_ruflo__memory_search mcp__plugin_ruflo-core_ruflo__memory_retrieve mcp__plugin_ruflo-core_ruflo__task_create mcp__plugin_ruflo-core_ruflo__task_update mcp__plugin_ruflo-core_ruflo__task_complete mcp__plugin_ruflo-core_ruflo__hooks_intelligence_trajectory-step mcp__plugin_ruflo-core_ruflo__hooks_intelligence_trajectory-end mcp__plugin_ruflo-core_ruflo__neural_train mcp__plugin_ruflo-core_ruflo__neural_predict Bash Read Write Edit
---

# SPARC Refinement + Completion

Run Phases 4 and 5 of the SPARC methodology: iteratively improve through code review and testing, then finalize with validation, documentation, and deployment readiness.

## When to use

After the Architecture phase is complete and its gate has been passed. This skill covers the final two phases that bring a feature from implemented to production-ready.

## Steps

### Phase 4 — Refinement

1. **Retrieve all prior artifacts** — call `mcp__plugin_ruflo-core_ruflo__memory_search` with namespace `sparc-phases` and query for the feature slug. Load spec (acceptance criteria), pseudocode, and architecture.

2. **Retrieve phase state** — call `mcp__plugin_ruflo-core_ruflo__memory_search` with namespace `sparc-state` to confirm we are in Phase 4.

3. **Code review** — review the implementation against:
   a. **Specification compliance**: does every acceptance criterion have a corresponding code path?
   b. **Architecture adherence**: do modules follow the defined boundaries and dependency rules?
   c. **Pseudocode fidelity**: does the implementation match the designed algorithms?
   d. **Code quality**: naming conventions, single responsibility, error handling, no dead code
   e. Document findings as review comments

4. **Test coverage analysis**:
   a. Run existing tests and measure coverage
   b. Identify uncovered acceptance criteria
   c. Write missing tests:
      - Unit tests for each public function
      - Integration tests for cross-module interactions
      - Edge case tests for each identified edge case from the spec
   d. Target coverage >= 80% on new code

5. **Performance validation** — if the spec includes performance constraints:
   a. Profile critical paths identified in the pseudocode
   b. Compare measured performance against constraint thresholds
   c. Optimize if thresholds are not met

6. **Iterate** — repeat steps 3-5 until:
   - All acceptance criteria have passing tests
   - Code review has no critical or high-severity issues
   - Coverage meets the threshold
   - Performance constraints are satisfied

7. **Store refinement artifact** — call `mcp__plugin_ruflo-core_ruflo__memory_store` with namespace `sparc-phases`, key `refine-{feature-slug}`, value: `{ status: "complete", reviewFindings: [...], coveragePercent: N, performanceResults: {...}, iterations: N }`

8. **Record trajectory step** — call `mcp__plugin_ruflo-core_ruflo__hooks_intelligence_trajectory-step` with refinement summary

### Phase 5 — Completion

9. **Full regression** — run the complete test suite to verify no regressions from refinement changes

10. **Traceability matrix** — build a matrix mapping every acceptance criterion to:
    - The test(s) that verify it
    - The code file(s) that implement it
    - The current pass/fail status

11. **Documentation**:
    a. Generate API documentation from code comments and type definitions
    b. Write usage examples for key public interfaces
    c. Update any existing documentation affected by the changes

12. **Deployment readiness checklist**:
    - [ ] All tests passing
    - [ ] Documentation complete
    - [ ] Database migrations prepared (if applicable)
    - [ ] Configuration changes documented
    - [ ] Feature flags configured (if applicable)
    - [ ] Rollback plan defined
    - [ ] Security review complete (no secrets, inputs validated)

13. **Store completion artifact** — call `mcp__plugin_ruflo-core_ruflo__memory_store` with namespace `sparc-phases`, key `complete-{feature-slug}`, value: `{ status: "complete", traceabilityMatrix: [...], documentationFiles: [...], deploymentChecklist: {...}, regressionResult: "pass" }`

14. **End trajectory** — call `mcp__plugin_ruflo-core_ruflo__hooks_intelligence_trajectory-end` with the full SPARC cycle summary

15. **Train neural patterns** — call `mcp__plugin_ruflo-core_ruflo__neural_train` with the successful SPARC cycle data to improve future predictions

16. **Store learned pattern** — call `mcp__plugin_ruflo-core_ruflo__memory_store` with namespace `patterns`, key `sparc-{feature-slug}`, value summarizing what worked, phase durations, and common blockers encountered

17. **Present completion report** — display the traceability matrix, deployment checklist, and final status. Suggest running `/sparc advance` to pass the final gate, or `/sparc report` for the full methodology report.

## Output format

```
# Refinement: {Feature Name}

## Code Review Summary
- Critical issues: {N} (must be 0 to pass gate)
- High issues: {N}
- Medium issues: {N}
- Resolved: {N}/{total}

## Test Coverage
- Overall: {N}%
- New code: {N}%
- Acceptance criteria covered: {N}/{total}

## Performance
| Constraint | Target | Measured | Status |
|-----------|--------|----------|--------|
| Response time | <200ms | 145ms | Pass |

---

# Completion: {Feature Name}

## Traceability Matrix
| AC | Test | Code | Status |
|----|------|------|--------|
| AC-1 | test_xxx | service.ts:42 | Pass |
| AC-2 | test_yyy | controller.ts:18 | Pass |
| AC-3 | test_zzz | repository.ts:31 | Pass |

## Deployment Checklist
- [x] All tests passing
- [x] Documentation complete
- [x] Migrations prepared
- [x] Config documented
- [x] Rollback plan defined
- [x] Security reviewed

---
SPARC workflow complete. Run `/sparc report` for the full methodology report.
```
