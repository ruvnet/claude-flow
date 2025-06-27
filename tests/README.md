# Claude-Flow Testing Guidelines

This document provides comprehensive guidelines for writing and running tests in the Claude-Flow project.

## Test Structure

The test suite is organized into four main categories:

### 1. Unit Tests (`tests/unit/`)
- Test individual functions, classes, and modules in isolation
- Mock all external dependencies
- Fast execution (< 5 seconds per test file)
- Target: >80% coverage

### 2. Integration Tests (`tests/integration/`)
- Test interactions between multiple components
- Use real SQLite databases (in-memory or temporary files)
- May include limited external service mocking
- Execution time: < 45 seconds per test file
- Target: >80% coverage for integration points

### 3. End-to-End Tests (`tests/e2e/`)
- Test complete user workflows
- Use real services where possible
- Test CLI commands and API endpoints
- Execution time: < 90 seconds per test file
- Target: Critical user paths covered

### 4. Memory Subsystem Tests (`memory/src/tests/`)
- Specialized tests for the memory management system
- Test persistence, replication, and synchronization
- Target: >90% coverage for critical paths

## Running Tests

### Basic Commands

```bash
# Run all tests
npm test

# Run specific test category
npm test -- --projects unit
npm test -- --projects integration
npm test -- --projects e2e
npm test -- --projects memory

# Run tests in watch mode
npm test -- --watch

# Run tests with coverage
npm test -- --coverage

# Run specific test file
npm test -- path/to/test.test.ts

# Run tests matching pattern
npm test -- --testNamePattern="should handle errors"
```

### Debug Mode

```bash
# Run tests with debug output
DEBUG_TESTS=true npm test

# Run with Node debugging
node --inspect-brk node_modules/.bin/jest --runInBand
```

### Performance Testing

```bash
# Run performance tests (not run by default)
npm test -- tests/performance

# Run with performance profiling
npm test -- --detectOpenHandles --logHeapUsage
```

## Writing Tests

### Test File Structure

```typescript
// Import test utilities
import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';
import { createTestDatabase, dbTestHelpers } from '@test/helpers/database-utils';
import { mockFactories, asyncHelpers } from '@test/helpers/test-utils';

// Import module under test
import { MyModule } from '@/modules/my-module';

describe('MyModule', () => {
  let testDb: TestDatabase;
  let module: MyModule;
  
  beforeEach(async () => {
    // Setup test environment
    testDb = createTestDatabase();
    module = new MyModule(testDb.db);
  });
  
  afterEach(async () => {
    // Cleanup
    testDb.close();
  });
  
  describe('methodName', () => {
    it('should handle normal case', async () => {
      // Arrange
      const input = { /* test data */ };
      
      // Act
      const result = await module.methodName(input);
      
      // Assert
      expect(result).toMatchObject({
        /* expected output */
      });
    });
    
    it('should handle error case', async () => {
      // Test error handling
      await expect(module.methodName(null))
        .rejects.toThrow('Expected error message');
    });
  });
});
```

### Testing Best Practices

#### 1. Use Descriptive Test Names
```typescript
// ❌ Bad
it('test 1', () => {});

// ✅ Good
it('should return user data when valid ID is provided', () => {});
```

#### 2. Follow AAA Pattern (Arrange, Act, Assert)
```typescript
it('should calculate total price including tax', () => {
  // Arrange
  const items = [
    { price: 10, quantity: 2 },
    { price: 5, quantity: 3 }
  ];
  const taxRate = 0.1;
  
  // Act
  const total = calculateTotal(items, taxRate);
  
  // Assert
  expect(total).toBe(38.5); // (20 + 15) * 1.1
});
```

#### 3. Test One Thing at a Time
```typescript
// ❌ Bad - testing multiple behaviors
it('should validate and save user', async () => {
  const user = { name: '', email: 'invalid' };
  const result = await saveUser(user);
  expect(result.errors).toContain('Name is required');
  expect(result.errors).toContain('Invalid email');
  expect(result.saved).toBe(false);
});

// ✅ Good - separate tests
it('should reject empty name', async () => {
  const user = { name: '', email: 'test@example.com' };
  await expect(saveUser(user)).rejects.toThrow('Name is required');
});

it('should reject invalid email', async () => {
  const user = { name: 'Test', email: 'invalid' };
  await expect(saveUser(user)).rejects.toThrow('Invalid email');
});
```

#### 4. Use Test Utilities
```typescript
import { createTestDatabase, dbTestHelpers } from '@test/helpers/database-utils';
import { waitForEvent, createDeferred } from '@test/helpers/test-utils';
import { createMockWebSocket } from '@test/helpers/mock-utils';

// Use database helpers
const testDb = createTestDatabase();
testDb.seed({
  agents: [{ id: '1', name: 'Agent 1', type: 'researcher', status: 'idle' }]
});

// Use async helpers
await waitForEvent(emitter, 'ready', 5000);

// Use mock factories
const ws = createMockWebSocket();
ws.send.mockImplementation((data) => {
  // Custom mock behavior
});
```

## Database Testing

### In-Memory Database
```typescript
import { createTestDatabase } from '@test/helpers/database-utils';

const testDb = createTestDatabase(); // Uses :memory:
// Fast, isolated, perfect for unit tests
```

### File-Based Database
```typescript
import { createFileTestDatabase } from '@test/helpers/database-utils';

const testDb = createFileTestDatabase('integration-test');
// Useful for debugging, can inspect DB file
```

### Seeding Test Data
```typescript
testDb.seed({
  agents: [
    { id: '1', name: 'Researcher', type: 'researcher', status: 'idle' },
    { id: '2', name: 'Coder', type: 'coder', status: 'busy' }
  ],
  tasks: [
    { id: 't1', title: 'Research task', status: 'pending', priority: 1 }
  ]
});
```

## Mocking Guidelines

### Mock External Dependencies
```typescript
// Mock file system
jest.mock('fs/promises');

// Mock child processes
jest.mock('child_process');

// Mock network requests
jest.mock('node-fetch');
```

### Create Reusable Mocks
```typescript
// tests/mocks/express.ts
export const mockApp = {
  use: jest.fn().mockReturnThis(),
  get: jest.fn().mockReturnThis(),
  post: jest.fn().mockReturnThis(),
  listen: jest.fn((port, cb) => {
    cb?.();
    return mockServer;
  })
};
```

## Coverage Requirements

### Global Thresholds
- Branches: 80%
- Functions: 80%
- Lines: 80%
- Statements: 80%

### Critical Module Thresholds
- `src/persistence/sqlite/**`: 90% all metrics
- `src/swarm/**`: 85% all metrics
- `src/memory/**`: 85% all metrics

### Checking Coverage Locally
```bash
# Generate coverage report
npm test -- --coverage

# Open HTML coverage report
open coverage/lcov-report/index.html

# Check specific file coverage
npm test -- --coverage --collectCoverageFrom="src/path/to/file.ts"
```

## CI/CD Integration

Tests run automatically on:
- Every push to main, develop, feature/*, fix/* branches
- Every pull request
- Daily at 2 AM UTC (scheduled)

### Test Matrix
- Operating Systems: Ubuntu, macOS, Windows
- Node.js versions: 18, 20
- Test categories run in parallel

### Performance Monitoring
- Performance tests run on schedule or with `[perf]` in commit message
- Results stored for 30 days
- Benchmarks tracked over time

## Troubleshooting

### Common Issues

1. **Tests timing out**
   ```bash
   # Increase timeout for specific test
   jest.setTimeout(30000);
   
   # Or use test-specific timeout
   it('long running test', async () => {
     // test code
   }, 30000);
   ```

2. **Database locked errors**
   - Ensure proper cleanup in afterEach
   - Use unique database names for parallel tests
   - Check for unclosed database connections

3. **Module resolution errors**
   - Check tsconfig.json paths configuration
   - Verify jest.config.js moduleNameMapper
   - Clear Jest cache: `npm test -- --clearCache`

4. **Memory leaks**
   ```bash
   # Detect open handles
   npm test -- --detectOpenHandles
   
   # Log heap usage
   npm test -- --logHeapUsage
   ```

### Debug Tips

1. **Use focused tests during development**
   ```typescript
   it.only('test only this', () => {});
   describe.only('test only this suite', () => {});
   ```

2. **Add debug output**
   ```typescript
   console.log('Debug:', JSON.stringify(result, null, 2));
   ```

3. **Use debugger**
   ```typescript
   debugger; // Pause here when debugging
   ```

4. **Run single file**
   ```bash
   npm test -- tests/unit/specific.test.ts --verbose
   ```

## Contributing Tests

When adding new features:
1. Write tests first (TDD approach)
2. Ensure all tests pass locally
3. Check coverage meets thresholds
4. Update this documentation if needed
5. Include tests in your PR

For bug fixes:
1. Write a failing test that reproduces the bug
2. Fix the bug
3. Ensure test now passes
4. Add regression test to prevent future issues

## Additional Resources

- [Jest Documentation](https://jestjs.io/docs/getting-started)
- [Testing Best Practices](https://github.com/goldbergyoni/javascript-testing-best-practices)
- [SQLite Testing Guide](https://www.sqlite.org/testing.html)
- Project test utilities: `/tests/helpers/`