# Claude-Flow Integration Tests

This directory contains comprehensive integration tests for benchmarking claude-flow's SPARC modes and swarm strategies.

## Test Files

### test_sparc_modes.py
Tests all 17 SPARC modes with real command execution:
- **Core Orchestration Modes**: orchestrator, swarm-coordinator, workflow-manager, batch-executor
- **Development Modes**: coder, architect, reviewer, tdd
- **Analysis and Research Modes**: researcher, analyzer, optimizer
- **Creative and Support Modes**: designer, innovator, documenter, debugger, tester, memory-manager

Each mode is tested with:
- Multiple test prompts
- Performance measurement
- Output validation
- Concurrent execution testing

### test_swarm_strategies.py
Tests all swarm strategies with different coordination modes:
- **Strategies**: auto, research, development, analysis, testing, optimization, maintenance
- **Coordination Modes**: centralized, distributed, hierarchical, mesh, hybrid

Features tested:
- Strategy-coordination mode compatibility
- Scalability with different agent counts
- Concurrent swarm execution
- Complex real-world scenarios
- Performance monitoring (CPU, memory)

## Running Tests

### Run All Integration Tests
```bash
python -m pytest benchmark/tests/integration/ -v
```

### Run Specific Test Suite
```bash
# Test only SPARC modes
python -m pytest benchmark/tests/integration/test_sparc_modes.py -v

# Test only swarm strategies
python -m pytest benchmark/tests/integration/test_swarm_strategies.py -v
```

### Run Specific Test Categories
```bash
# Run only performance tests
python -m pytest benchmark/tests/integration/ -m performance -v

# Skip stress tests (for faster execution)
python -m pytest benchmark/tests/integration/ -k "not stress" -v

# Run only integration-marked tests
python -m pytest benchmark/tests/integration/ -m integration -v
```

### Using the Benchmark Runner
```bash
# Run all benchmarks
python benchmark/tests/run_benchmarks.py

# Run only integration tests
python benchmark/tests/run_benchmarks.py --suite integration

# Run specific integration tests
python benchmark/tests/run_benchmarks.py --suite integration --integration-type sparc

# Verbose output
python benchmark/tests/run_benchmarks.py -v
```

## Test Markers

- `@pytest.mark.parametrize`: Tests multiple configurations
- `@pytest.mark.integration`: Basic integration tests
- `@pytest.mark.performance`: Performance-focused tests
- `@pytest.mark.stress`: Stress tests (concurrent execution)
- `@pytest.mark.advanced`: Complex scenario tests

## Test Data and Fixtures

Test fixtures are available in `benchmark/tests/fixtures/`:
- Sample project structures (web API, data pipeline, ML model)
- Test prompts for different complexity levels
- Code samples for testing various scenarios
- Performance testing scenarios

## Output Files

Tests generate several output files:
- `sparc_test_results.json`: Detailed SPARC mode test results
- `swarm_test_results.json`: Detailed swarm strategy test results
- `sparc_performance_report.json`: SPARC mode performance comparison
- `strategy_coordination_matrix.json`: Strategy-coordination compatibility matrix
- `swarm_scalability_analysis.json`: Scalability analysis results
- `complex_scenario_report.json`: Complex scenario test results

## Performance Thresholds

Each test has defined performance thresholds:
- **Max Duration**: Maximum allowed execution time
- **Average Duration**: Expected average execution time

Tests will fail if these thresholds are exceeded.

## Requirements

- Python 3.8+
- pytest
- psutil (for performance monitoring)
- claude-flow installed and accessible
- Non-interactive mode support in claude-flow