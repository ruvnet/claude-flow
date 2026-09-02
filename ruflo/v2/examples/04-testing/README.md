# Testing Examples

Scripts for testing Claude Flow functionality and validating system features.

## Directory Structure

```
04-testing/
├── unit/           # Unit tests for individual components
├── integration/    # Integration tests for workflows
├── performance/    # Performance benchmarks
├── sparc/          # SPARC-specific tests
├── sparc-swarm-test.sh    # Original SPARC test suite
└── test-swarm-cli.sh      # Original CLI tests
```

## Test Categories

### Unit Tests (`unit/`)
- **test-memory-system.sh**: Complete memory system unit tests
  - Store, query, update, delete operations
  - Bulk operations and stats
  - Export/import functionality
  ```bash
  cd examples/04-testing/unit
  ./test-memory-system.sh
  ```

### Integration Tests (`integration/`)
- **test-workflow-execution.sh**: End-to-end workflow testing
  - Workflow execution verification
  - Output validation
  - Error handling
  - Resource cleanup
  ```bash
  cd examples/04-testing/integration
  ./test-workflow-execution.sh
  ```

### Performance Tests (`performance/`)
- **benchmark-swarm.sh**: Performance benchmarking suite
  - Execution time measurements
  - Resource usage analysis
  - Performance recommendations
  ```bash
  cd examples/04-testing/performance
  ./benchmark-swarm.sh
  ```

## Original Test Files

### sparc-swarm-test.sh
**Comprehensive SPARC TDD test suite** (235 lines)
- Tests all SPARC modes
- Validates TDD workflow
- Memory integration tests

### test-swarm-cli.sh
**CLI functionality tests** (129 lines)
- Command validation
- Strategy testing
- Error handling

## Running Tests

```bash
# Run full SPARC test suite
./sparc-swarm-test.sh

# Run CLI tests
./test-swarm-cli.sh

# Verbose mode for debugging
./sparc-swarm-test.sh --verbose

# Test specific strategy
./test-swarm-cli.sh --strategy development
```

## Test Coverage

### SPARC Modes Tested
- `spec-pseudocode`: Requirements and pseudocode
- `architect`: System design
- `tdd`: Test-driven development
- `code`: Implementation
- `debug`: Troubleshooting
- `security-review`: Vulnerability scanning
- `integration`: System integration

### Strategies Tested
- `development`: Building applications
- `research`: Information gathering
- `analysis`: Code quality review
- `testing`: Test creation
- `optimization`: Performance tuning

### Features Validated
- Multi-agent coordination
- Task scheduling
- Memory persistence
- Quality thresholds
- Error recovery
- Progress monitoring

## Writing New Tests

When adding tests:
1. Follow existing test structure
2. Use clear test names
3. Include both positive and negative cases
4. Test edge conditions
5. Verify output quality
6. Check performance impact

## Test Utilities

Both scripts include helper functions:
- `run_test`: Execute test with timing
- `check_output`: Validate results
- `assert_equals`: Value comparison
- `assert_contains`: String matching
- `measure_performance`: Timing checks