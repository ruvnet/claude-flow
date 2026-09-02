# Integration Tests - Quick Start Guide

## Overview

This directory contains 75 comprehensive integration tests across 5 test files covering all major V3 modules and their interactions.

## Test Files

| File | Tests | Coverage |
|------|-------|----------|
| `memory-integration.test.ts` | 15 | HybridBackend (SQLite + AgentDB) |
| `swarm-integration.test.ts` | 15 | Agent coordination and topologies |
| `mcp-integration.test.ts` | 15 | MCP tools (agent, memory, config) |
| `plugin-integration.test.ts` | 15 | Plugin system and extension points |
| `workflow-integration.test.ts` | 15 | End-to-end workflows and pipelines |

## Quick Commands

### Run all integration tests
```bash
npm run test:integration
```

### Run specific test file
```bash
npm run test:integration:memory      # Memory integration
npm run test:integration:swarm       # Swarm coordination
npm run test:integration:mcp         # MCP tools
npm run test:integration:plugin      # Plugin system
npm run test:integration:workflow    # Full workflows
```

### Watch mode (auto-rerun on changes)
```bash
npm run test:integration:watch
```

### Run with coverage
```bash
npm run test:coverage:integration
```

### Run single test
```bash
npx vitest run -t "should execute end-to-end agent workflow"
```

## Test Structure

Each test follows this pattern:

```typescript
describe('Module Integration Tests', () => {
  let module: Module;

  beforeEach(async () => {
    // Setup: Initialize fresh instances
    module = new Module();
    await module.initialize();
  });

  afterEach(async () => {
    // Cleanup: Shutdown and cleanup resources
    await module.shutdown();
  });

  it('should test specific integration', async () => {
    // Arrange: Setup test data
    const data = createTestData();

    // Act: Execute the operation
    const result = await module.execute(data);

    // Assert: Verify the outcome
    expect(result).toBeDefined();
  });
});
```

## Test Utilities

Import from `/v3/__tests__/integration/setup.ts`:

```typescript
import { TestUtils, MockData, PerfUtils } from './setup';

// Create test database paths
const dbPath = TestUtils.createTestDbPath('test');

// Generate mock data
const agents = MockData.generateAgents(5);
const tasks = MockData.generateTasks(10);

// Measure performance
const { duration } = await TestUtils.measureTime(async () => {
  await someOperation();
});

// Benchmark operations
const stats = await PerfUtils.benchmark('operation', async () => {
  await operation();
}, 10);
```

## Debugging Tests

### Enable verbose output
```bash
DEBUG=claude-flow:* npm run test:integration
```

### Run in watch mode with specific test
```bash
npx vitest watch -t "should handle concurrent memory operations"
```

### Generate HTML coverage report
```bash
npm run test:coverage:integration
# Open __tests__/coverage/index.html
```

### Use VS Code debugger
1. Set breakpoint in test file
2. Open "Run and Debug" panel (Ctrl+Shift+D)
3. Select "Debug Vitest Tests"
4. Click "Start Debugging" (F5)

## Common Issues

### Database lock errors
- **Cause**: Previous test didn't clean up properly
- **Fix**: Delete `/v3/__tests__/integration/.test-dbs/` directory

### Timeout errors
- **Cause**: Operation taking longer than 10s (default timeout)
- **Fix**: Increase timeout in specific test:
  ```typescript
  it('slow test', async () => {
    // ...
  }, 30000); // 30 second timeout
  ```

### Port already in use
- **Cause**: Previous test server still running
- **Fix**: Kill the process or restart terminal

### Memory leaks
- **Cause**: Not cleaning up event listeners or connections
- **Fix**: Ensure `afterEach` properly cleans up:
  ```typescript
  afterEach(async () => {
    await module.shutdown();
    eventBus.removeAllListeners();
  });
  ```

## Performance Expectations

| Operation | Target Time |
|-----------|-------------|
| Memory store | <10ms |
| Memory query | <50ms |
| Vector search | <100ms |
| Agent spawn | <50ms |
| Task execution | <200ms |
| Workflow execution | <500ms |

## Coverage Targets

From V3 ADR-008 (Vitest over Jest):
- Lines: >80%
- Branches: >75%
- Functions: >80%
- Statements: >80%

Current integration test coverage:
- All major integration points: 100%
- Cross-module interactions: >90%

## CI/CD Integration

These tests run automatically on:
- Push to `v3` branch
- Pull requests to `main`
- Nightly builds

Expected CI execution time: <5 minutes

## Best Practices

1. **Isolation**: Each test should be independent
2. **Cleanup**: Always cleanup in `afterEach`
3. **Deterministic**: No random behavior (use fixed seeds)
4. **Fast**: Keep tests under 10 seconds each
5. **Clear**: Use descriptive test names
6. **Focused**: Test one integration point per test

## Example Test Sessions

### First time running tests
```bash
# Install dependencies (if not done)
cd /workspaces/claude-flow/v3
npm install

# Run all integration tests
npm run test:integration
```

### Development workflow
```bash
# Start watch mode
npm run test:integration:watch

# Edit integration code in src/
# Tests auto-rerun on save

# Check coverage
npm run test:coverage:integration
```

### Before committing
```bash
# Run all tests with coverage
npm run test:coverage:integration

# Verify coverage thresholds met
# Fix any failing tests
# Commit changes
```

## Getting Help

- Read test file comments for specific integration details
- Check `/v3/__tests__/integration/README.md` for full documentation
- Review `/v3/docs/architecture/` for ADR decisions
- See `/CLAUDE.md` for development guidelines

## Next Steps

After running integration tests:
1. Review coverage report: `__tests__/coverage/index.html`
2. Check for uncovered code paths
3. Add tests for new features
4. Update this guide if adding new test files

## Quick Reference

```bash
# Common commands
npm run test:integration              # Run all
npm run test:integration:watch        # Watch mode
npm run test:integration:memory       # Memory only
npm run test:coverage:integration     # With coverage

# Debugging
DEBUG=* npm run test:integration      # Verbose logs
npx vitest run -t "test name"        # Single test
npx vitest run --reporter=verbose    # Detailed output

# Cleanup
rm -rf __tests__/integration/.test-dbs/  # Clean test DBs
rm -rf __tests__/coverage/              # Clean coverage
```
