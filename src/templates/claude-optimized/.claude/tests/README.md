# Batchtools Integration Test Suite

This test suite validates the batch operation optimizations implemented in the SPARC methodology prompts. It ensures that parallel execution, concurrent operations, and batch processing work correctly and deliver the promised performance improvements.

## Test Structure

```
.claude/tests/
├── README.md                    # This file
├── test-harness.js             # Core test utilities and mock setup
├── unit/                       # Unit tests for individual batch operations
│   ├── batch-operations.test.js
│   └── parallel-utils.test.js
├── integration/                # Integration tests for SPARC modes
│   ├── architect-batch.test.js
│   ├── code-batch.test.js
│   ├── tdd-batch.test.js
│   ├── debug-batch.test.js
│   └── security-batch.test.js
├── performance/                # Performance benchmarks
│   ├── benchmarks.test.js
│   └── resource-usage.test.js
├── error-handling/             # Error scenario tests
│   ├── batch-errors.test.js
│   └── rollback.test.js
└── e2e/                       # End-to-end workflow tests
    └── workflows.test.js
```

## Running Tests

### Run All Tests
```bash
npm test .claude/tests
```

### Run Specific Test Categories
```bash
# Unit tests only
npm test .claude/tests/unit

# Integration tests
npm test .claude/tests/integration

# Performance benchmarks
npm test .claude/tests/performance

# Error handling tests
npm test .claude/tests/error-handling

# End-to-end tests
npm test .claude/tests/e2e
```

### Run Individual Test Files
```bash
npm test .claude/tests/unit/batch-operations.test.js
```

## Test Categories

### 1. Unit Tests
Test individual batch operation functions in isolation:
- Parallel file operations
- Concurrent search functionality
- Batch task execution
- Resource pooling

### 2. Integration Tests
Test SPARC modes with batch operations:
- Architect mode with parallel analysis
- Code mode with concurrent file generation
- TDD mode with batch test execution
- Debug mode with parallel diagnostics
- Security mode with concurrent vulnerability scanning

### 3. Performance Tests
Measure and validate performance improvements:
- Operation throughput benchmarks
- Response time measurements
- Resource utilization metrics
- Scalability tests

### 4. Error Handling Tests
Verify robust error handling in batch operations:
- Partial failure scenarios
- Rollback mechanisms
- Error propagation
- Recovery strategies

### 5. End-to-End Tests
Test complete workflows using batch operations:
- Multi-mode SPARC workflows
- Real-world project scenarios
- Cross-mode parallel execution
- Complex dependency handling

## Test Utilities

The `test-harness.js` file provides:
- Mock file system for safe testing
- Performance measurement utilities
- Batch operation simulators
- Error injection mechanisms
- Resource monitoring tools

## Performance Baselines

Expected performance improvements from batch operations:
- File operations: 3-5x faster with parallel execution
- Search operations: 2-4x faster with concurrent searches
- Multi-mode execution: 2-3x faster with parallel mode execution
- Resource utilization: 50-70% CPU usage during batch operations

## Mock Data

Tests use realistic mock data including:
- Sample project structures
- Code repositories
- Test suites
- Documentation sets
- Configuration files

## Continuous Integration

These tests should be run:
- On every pull request
- Before releases
- During nightly builds
- When batch operation code changes

## Contributing

When adding new batch operations:
1. Add unit tests for the operation
2. Add integration tests for affected SPARC modes
3. Add performance benchmarks
4. Add error handling tests
5. Update end-to-end tests if needed