---
name: tdd-workflow
description: TDD London School workflow -- mock-first, outside-in test development
argument-hint: "<module-path>"
allowed-tools: Bash(npx * npm *) mcp__plugin_ruflo-core_ruflo__hooks_pre-task mcp__plugin_ruflo-core_ruflo__hooks_post-task Read Write Edit
---
Follow the TDD London School (mock-first) approach:

1. **Write the failing test first** -- define expected behavior with mocked dependencies
2. **Run the test** -- confirm it fails for the right reason
3. **Implement minimal code** -- make the test pass with the simplest solution
4. **Refactor** -- clean up while keeping tests green
5. **Repeat** -- add the next behavior

Before starting: `mcp__plugin_ruflo-core_ruflo__hooks_pre-task({ description: "TDD: FEATURE_NAME" })`
After completing: `mcp__plugin_ruflo-core_ruflo__hooks_post-task({ taskId: "tdd-FEATURE", success: true, storeResults: true })`

Principles:
- Mock external dependencies at boundaries
- Test behavior, not implementation
- One assertion per test when possible
- Descriptive names: `should [behavior] when [condition]`
