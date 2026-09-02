// tdd.js - Test-Driven Development mode orchestration template
export function getTddOrchestration(taskDescription, memoryNamespace) {
  return `
## Task Orchestration Steps - London School TDD

1. **Test Planning & Analysis** (10 mins)
   - Analyze requirements: "${taskDescription}"
   - Query existing code and architecture:
     \\\`\\\`\\\`bash
     npx claude-flow memory query ${memoryNamespace}_architecture
     npx claude-flow memory query ${memoryNamespace}_implementation
     npx claude-flow memory query ${memoryNamespace}_tech_specs
     \\\`\\\`\\\`
   - Define test boundaries and acceptance criteria
   - Plan test structure (unit, integration, e2e)
   - Identify test doubles needed (mocks, stubs, spies)
   - Store plan: \`npx claude-flow memory store ${memoryNamespace}_test_plan "Test strategy: Unit tests for domain logic, integration for APIs, e2e for workflows. Mocking: External services, database. Coverage target: 95%."\`

2. **Red Phase - Write Failing Tests** (20 mins)
   - Create comprehensive test structure:
     \\\`\\\`\\\`
     tests/
     ├── unit/          # Isolated component tests
     ├── integration/   # Component interaction tests
     ├── e2e/          # End-to-end workflow tests
     └── fixtures/      # Test data and mocks
     \\\`\\\`\\\`
   - Write tests following London School TDD:
     - Start with behavior/contract tests
     - Use test doubles for dependencies
     - Focus on interactions, not state
   - Ensure NO hardcoded values in tests
   - Create parameterized tests for edge cases
   - Verify all tests fail with meaningful messages
   - Store status: \`npx claude-flow memory store ${memoryNamespace}_red_phase "Written: 25 unit tests (all failing), 10 integration tests (all failing), 5 e2e tests (all failing). Coverage: 0%."\`

3. **Green Phase - Minimal Implementation** (20 mins)
   - Implement ONLY enough code to pass tests:
     - Start with the simplest implementation
     - Make one test pass at a time
     - Don't add unrequested functionality
   - Maintain modularity (files < 500 lines)
   - Use dependency injection for testability
   - Implement proper error handling
   - Track coverage as you progress
   - Store progress: \`npx claude-flow memory store ${memoryNamespace}_green_phase "Progress: 20/25 unit tests passing, 8/10 integration tests passing. Current coverage: 75%. Remaining: Complex edge cases."\`

4. **Refactor Phase - Optimize & Clean** (15 mins)
   - Refactor while keeping tests green:
     - Extract common patterns into utilities
     - Improve naming and code clarity
     - Optimize algorithms and data structures
     - Reduce duplication (DRY principle)
   - Ensure files remain under 500 lines
   - Add performance tests if needed
   - Improve test maintainability
   - Document complex test scenarios
   - Store refactoring: \`npx claude-flow memory store ${memoryNamespace}_refactor "Extracted 3 common utilities, optimized database queries, improved test readability. All tests green. Coverage: 95%."\`

5. **Test Documentation & Validation** (10 mins)
   - Generate coverage reports
   - Document test scenarios and edge cases
   - Create test execution guide
   - Set up CI/CD test configuration
   - Validate against acceptance criteria
   - Store completion: \`npx claude-flow memory store ${memoryNamespace}_tdd_complete "TDD cycle complete. Coverage: 95%. All acceptance criteria met. Tests documented. CI/CD ready."\`

## Directory Safety
- **IMPORTANT**: All test files should be created in the current working directory
- **DO NOT** create files in system directories or node_modules
- For named projects, create a subdirectory: \\\`mkdir project-name && cd project-name\\\`
- Use relative paths from your working directory
- Test files should follow project structure:
  \\\`\\\`\\\`
  ./ (current directory)
  ├── tests/
  │   ├── unit/
  │   ├── integration/
  │   └── e2e/
  ├── coverage/
  └── docs/
  \\\`\\\`\\\`

## Deliverables
- tests/
  - unit/ (isolated component tests)
  - integration/ (interaction tests)
  - e2e/ (workflow tests)
  - fixtures/ (test data, no hardcoded values)
  - helpers/ (test utilities)
- coverage/
  - coverage report (HTML + JSON)
  - coverage badge
- docs/
  - TEST_GUIDE.md (how to run tests)
  - TEST_SCENARIOS.md (test case documentation)
- .github/workflows/ or .gitlab-ci.yml (CI configuration)

## Testing Best Practices
- NO hardcoded secrets or environment values in tests
- Use test fixtures and factories for test data
- Mock external dependencies at boundaries
- Test behavior, not implementation details
- Maintain test independence (no shared state)
- Use descriptive test names that document behavior

## Next Steps
After TDD cycle completes:
- \`npx claude-flow sparc run debug "Investigate any failing edge cases" --non-interactive\`
- \`npx claude-flow sparc run refinement-optimization-mode "Optimize performance bottlenecks" --non-interactive\`
- \`npx claude-flow sparc run docs-writer "Create user documentation" --non-interactive\``;
}
