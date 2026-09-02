// debug.js - Debugger mode orchestration template
export function getDebugOrchestration(taskDescription, memoryNamespace) {
  return `
## Task Orchestration Steps

1. **Issue Analysis & Reproduction** (10 mins)
   - Understand the reported issue: "${taskDescription}"
   - Query relevant context and previous issues:
     \`\`\`bash
     npx claude-flow memory query ${memoryNamespace}_bugs
     npx claude-flow memory query ${memoryNamespace}_implementation
     npx claude-flow memory query ${memoryNamespace}_tests
     \`\`\`
   - Set up debugging environment:
     - Enable verbose logging
     - Configure debugging tools
     - Prepare monitoring setup
   - Reproduce the issue consistently
   - Collect error messages, stack traces, and logs
   - Identify affected components and dependencies
   - Store findings: \`npx claude-flow memory store ${memoryNamespace}_issue_analysis "Issue: ${taskDescription}. Reproduction: Steps 1-3. Error: Stack trace at line X. Affected: auth-service, user-repository."\`

2. **Root Cause Investigation** (20 mins)
   - Add strategic debug logging:
     - Entry/exit points of suspect functions
     - State before/after transformations
     - External service call results
   - Use debugging tools:
     - Debugger breakpoints
     - Memory profilers (if memory issue)
     - Network analyzers (if API issue)
   - Trace execution flow systematically:
     - Follow data through the system
     - Check assumptions at each step
     - Verify external dependencies
   - Analyze patterns:
     - When does it fail? (timing, load, specific data)
     - What changed recently? (code, config, dependencies)
   - Avoid changing env configuration directly
   - Store investigation: \`npx claude-flow memory store ${memoryNamespace}_root_cause "Root cause: Race condition in auth token refresh. Occurs under high load when token expires during request processing. Fix approach: Implement token refresh mutex."\`

3. **Solution Development** (15 mins)
   - Develop targeted fix approach:
     - Minimal change to resolve issue
     - Maintain backward compatibility
     - Consider edge cases
   - Implement the solution:
     - Keep changes modular
     - Don't exceed 500 lines per file
     - Add inline comments explaining the fix
   - Add regression tests:
     - Test the specific failure scenario
     - Test related edge cases
     - Ensure fix doesn't break existing tests
   - Implement defensive coding:
     - Add validation where missing
     - Improve error messages
     - Add circuit breakers if needed
   - Store solution: \`npx claude-flow memory store ${memoryNamespace}_solution "Fix: Added mutex lock for token refresh. Tests: 3 regression tests added. Validation: Added token expiry check. No breaking changes."\`

4. **Validation & Performance Check** (10 mins)
   - Run comprehensive test suite:
     \`\`\`bash
     npm test
     npm run test:integration
     npm run test:e2e
     \`\`\`
   - Verify original issue is resolved
   - Check performance impact:
     - Run performance benchmarks
     - Monitor memory usage
     - Check response times
   - Test in conditions that triggered the bug
   - Verify no new issues introduced
   - Document the fix with context
   - Store validation: \`npx claude-flow memory store ${memoryNamespace}_debug_validation "All tests passing. Performance impact: <5ms latency increase. Memory usage unchanged. Original issue resolved."\`

5. **Documentation & Cleanup** (5 mins)
   - Create detailed fix documentation
   - Remove debug logging (keep useful ones)
   - Update error handling guides
   - Create runbook for similar issues
   - Submit for code review

## Deliverables
- Fixed code with:
  - Inline comments explaining the fix
  - Improved error messages
  - Defensive coding additions
- tests/regression/
  - Test cases for the specific bug
  - Edge case coverage
- docs/
  - DEBUG_REPORT.md (root cause analysis)
  - FIX_DOCUMENTATION.md (what was changed and why)
  - RUNBOOK.md (guide for similar issues)
- Performance comparison report

## Debugging Best Practices
- Use structured logging with correlation IDs
- Avoid changing production env during debugging
- Keep debug changes isolated and reversible
- Test fixes under same conditions as bug
- Document investigation process for future reference
- Consider using feature flags for gradual rollout

## Next Steps
After debugging completes:
- \`npx claude-flow sparc run security-review "Review security impact of ${taskDescription} fix" --non-interactive\`
- \`npx claude-flow sparc run refinement-optimization-mode "Refactor affected modules for better maintainability" --non-interactive\`
- \`npx claude-flow sparc run post-deployment-monitoring-mode "Monitor ${taskDescription} fix in production" --non-interactive\``;
}
