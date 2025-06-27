# Comprehensive Mocking Guidelines for Claude Flow

## Overview

This document provides comprehensive guidelines for creating robust, maintainable, and Jest-compatible mocks in the Claude Flow project. These patterns solve the Phase 1 test failures and provide a sustainable architecture for future test development.

## Table of Contents

1. [Quick Start](#quick-start)
2. [Core Principles](#core-principles)
3. [Common Patterns](#common-patterns)
4. [Template Usage](#template-usage)
5. [Anti-Patterns to Avoid](#anti-patterns-to-avoid)
6. [Troubleshooting](#troubleshooting)
7. [Migration Guide](#migration-guide)

## Quick Start

### Using Enhanced Mock Factory

```typescript
import { EnhancedMockFactory, AsyncMockBuilder } from './enhanced-mock-factory.js';

// ✅ CORRECT: Create a safe mock
const mockObject = EnhancedMockFactory.createSafeMock({
  initialize: async () => {},
  getData: () => 'data',
  process: async (input: string) => `processed: ${input}`
});

// ✅ CORRECT: Using AsyncMockBuilder for complex objects
const terminalMock = AsyncMockBuilder.create({
  initialize: async () => {},
  executeCommand: async (cmd: string) => `output: ${cmd}`
})
.spyOnAsync('initialize')
.spyOnAsync('executeCommand')
.build();
```

### Using Pre-built Templates

```typescript
import { 
  createTerminalManagerMock,
  createDatabaseMock,
  createEventBusMock 
} from './mock-templates.js';

// ✅ CORRECT: Use pre-built templates
const terminalManager = createTerminalManagerMock();
const database = createDatabaseMock();
const eventBus = createEventBusMock();
```

## Core Principles

### 1. Use `jest.fn()` Instead of `jest.spyOn()` for Function Creation

**❌ WRONG:**
```typescript
// This causes "Property does not have access type" errors
mock[key] = jest.spyOn(mock, key as keyof T, value);
```

**✅ CORRECT:**
```typescript
// Use jest.fn().mockImplementation() instead
mock[key] = jest.fn().mockImplementation(value);
```

### 2. Distinguish Between Async and Sync Mocking

**✅ CORRECT: Async Function Mocking**
```typescript
const asyncMock = jest.fn().mockImplementation(async (param: string) => {
  return `async result: ${param}`;
});

// Or for rejections
const failingAsyncMock = jest.fn().mockRejectedValue(new Error('Async failure'));
```

**✅ CORRECT: Sync Function Mocking**
```typescript
const syncMock = jest.fn().mockImplementation((param: string) => {
  return `sync result: ${param}`;
});

// Or for thrown errors
const failingSyncMock = jest.fn().mockImplementation(() => {
  throw new Error('Sync failure');
});
```

### 3. Use TypeScript for Type Safety

```typescript
// Define proper types for your mocks
type MockedFunction<T extends (...args: any[]) => any> = jest.MockedFunction<T>;

interface MockedTerminalManager {
  initialize: MockedFunction<() => Promise<void>>;
  executeCommand: MockedFunction<(cmd: string) => Promise<string>>;
}
```

### 4. Always Clean Up Mocks

```typescript
afterEach(() => {
  jest.clearAllMocks();
});

afterAll(() => {
  jest.restoreAllMocks();
});
```

## Common Patterns

### Pattern 1: Simple Object Mocking

```typescript
// ✅ CORRECT: For simple objects with a few methods
const mockService = EnhancedMockFactory.createSafeMock({
  getData: async () => ({ id: 1, name: 'test' }),
  saveData: async (data: any) => { return data; },
  isReady: () => true
});

// Use in tests
expect(mockService.getData).toHaveBeenCalled();
```

### Pattern 2: Complex Object with Builder Pattern

```typescript
// ✅ CORRECT: For complex objects with many async methods
const mockManager = AsyncMockBuilder.create({
  initialize: async () => {},
  shutdown: async () => {},
  process: async (input: string) => `processed: ${input}`,
  getStatus: () => 'active'
})
.spyOnAsync('initialize')
.spyOnAsync('shutdown') 
.spyOnAsync('process')
.spyOnSync('getStatus')
.build();
```

### Pattern 3: Conditional Mocking

```typescript
// ✅ CORRECT: Mock different behaviors based on input
const mockDatabase = AsyncMockBuilder.create({
  query: async (sql: string) => {
    if (sql.includes('SELECT')) return [{ id: 1 }];
    if (sql.includes('INSERT')) return { changes: 1 };
    throw new Error('Invalid SQL');
  }
})
.spyOnAsync('query')
.build();
```

### Pattern 4: Stateful Mocking

```typescript
// ✅ CORRECT: Mocks that maintain state
let isConnected = false;

const mockConnection = AsyncMockBuilder.create({
  connect: async () => { isConnected = true; },
  disconnect: async () => { isConnected = false; },
  isConnected: () => isConnected
})
.spyOnAsync('connect')
.spyOnAsync('disconnect')
.spyOnSync('isConnected')
.build();
```

### Pattern 5: Error Testing

```typescript
// ✅ CORRECT: Testing error scenarios
const failingMock = AsyncMockBuilder.create({
  riskyOperation: async () => 'success'
})
.spyOnAsyncWithError('riskyOperation', new Error('Operation failed'))
.build();

// Test the error
await expect(failingMock.riskyOperation()).rejects.toThrow('Operation failed');
```

## Template Usage

### Pre-built Templates

The `mock-templates.ts` file provides ready-to-use templates for common interfaces:

```typescript
import {
  createTerminalManagerMock,
  createDatabaseMock,
  createEventBusMock,
  createLoggerMock,
  createTaskCoordinatorMock,
  createMcpServerMock,
  createAgentMock,
  createFileSystemMock
} from './mock-templates.js';

// Use directly with defaults
const terminalManager = createTerminalManagerMock();

// Override specific methods
const customTerminalManager = createTerminalManagerMock({
  executeCommand: async (sessionId: string, command: string) => {
    return `Custom output for ${command}`;
  }
});
```

### Template Modifiers

```typescript
import { createFailingMock, createDelayedMock } from './mock-templates.js';

// Create a version that fails on specific methods
const failingDatabase = createFailingMock(
  () => createDatabaseMock(),
  ['connect', 'query'],
  new Error('Database connection failed')
);

// Create a version with simulated latency
const slowDatabase = createDelayedMock(
  () => createDatabaseMock(),
  500 // 500ms delay
);
```

## Anti-Patterns to Avoid

### ❌ Wrong: Using jest.spyOn as Function Factory

```typescript
// DON'T DO THIS - causes access type errors
const mock = {
  method: jest.spyOn(async () => {})  // ❌ Wrong
};
```

### ❌ Wrong: Mixing spy syntax

```typescript
// DON'T DO THIS - inconsistent patterns
mock[key] = jest.spyOn(mock, key, value);  // ❌ Wrong syntax
```

### ❌ Wrong: Not handling async properly

```typescript
// DON'T DO THIS - mixing sync/async inappropriately
const mock = jest.fn().mockReturnValue(Promise.resolve('value'));  // ❌ Use mockResolvedValue
```

### ❌ Wrong: Not typing mocks

```typescript
// DON'T DO THIS - untyped mocks
const mock: any = createMock();  // ❌ No type safety
```

## Troubleshooting

### Common Error: "Property does not have access type"

**Error Message:**
```
Property `initialize` does not have access type async () => { }
```

**Solution:**
Replace `jest.spyOn(mock, method, implementation)` with:
```typescript
mock[method] = jest.fn().mockImplementation(implementation);
```

### Common Error: "Cannot read property 'mockImplementation' of undefined"

**Cause:** Trying to call mock methods on non-function properties.

**Solution:**
```typescript
// Check if it's a function before mocking
if (typeof original[key] === 'function') {
  mock[key] = jest.fn().mockImplementation(original[key]);
}
```

### Common Error: "Expected function to be called but it wasn't"

**Cause:** Mock wasn't properly configured or test logic error.

**Solution:**
```typescript
// Verify mock is properly set up
const mockFn = mock.someMethod as jest.MockedFunction<any>;
expect(mockFn).toHaveBeenCalled();

// Or check if method exists
expect(typeof mock.someMethod).toBe('function');
```

### Performance Issues with Large Mocks

**Problem:** Tests running slowly with complex mocks.

**Solution:**
Use partial mocking and only mock what you need:
```typescript
const partialMock = EnhancedMockFactory.createPartialMock(
  originalObject,
  ['onlyMethodINeed'],
  { onlyMethodINeed: jest.fn() }
);
```

## Migration Guide

### Step 1: Identify Broken Patterns

Look for these patterns in your tests:
- `jest.spyOn(fn)` used as function factory
- `jest.spyOn(obj, method, implementation)` with three parameters
- Untyped mock objects

### Step 2: Replace with Enhanced Patterns

**Before:**
```typescript
const mock = MockFactory.createMock({
  method: async () => {}
});
```

**After:**
```typescript
const mock = EnhancedMockFactory.createSafeMock({
  method: async () => {}
});
```

### Step 3: Use Templates Where Possible

**Before:**
```typescript
const mockTerminal = {
  initialize: jest.fn(),
  shutdown: jest.fn(),
  // ... many more methods
};
```

**After:**
```typescript
const mockTerminal = createTerminalManagerMock();
```

### Step 4: Update Test Assertions

**Before:**
```typescript
expect(mock.method.mock.calls.length).toBe(1);
```

**After:**
```typescript
expect(mock.method).toHaveBeenCalledTimes(1);
```

## Best Practices Checklist

- [ ] ✅ Use `EnhancedMockFactory` or `AsyncMockBuilder` for all mocks
- [ ] ✅ Use pre-built templates when available
- [ ] ✅ Type your mocks properly with TypeScript
- [ ] ✅ Distinguish between async and sync method mocking
- [ ] ✅ Clean up mocks between tests with `jest.clearAllMocks()`
- [ ] ✅ Test both success and failure scenarios
- [ ] ✅ Use meaningful mock implementations that reflect real behavior
- [ ] ✅ Document custom mock behavior in tests
- [ ] ✅ Use performance tracking for critical mocks
- [ ] ✅ Validate mock calls with proper Jest matchers

## Examples in Practice

### Complete Test File Example

```typescript
import { AsyncMockBuilder } from '../utils/enhanced-mock-factory.js';
import { createTerminalManagerMock } from '../utils/mock-templates.js';

describe('Terminal Service', () => {
  let terminalService: TerminalService;
  let mockTerminalManager: any;

  beforeEach(() => {
    mockTerminalManager = createTerminalManagerMock();
    terminalService = new TerminalService(mockTerminalManager);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should initialize terminal manager', async () => {
    await terminalService.start();
    
    expect(mockTerminalManager.initialize).toHaveBeenCalledTimes(1);
  });

  it('should handle initialization failure', async () => {
    mockTerminalManager.initialize.mockRejectedValue(new Error('Init failed'));
    
    await expect(terminalService.start()).rejects.toThrow('Init failed');
  });
});
```

This comprehensive guide provides everything needed to create robust, maintainable mocks that work with Jest and TypeScript while avoiding the common pitfalls that caused the Phase 1 test failures.