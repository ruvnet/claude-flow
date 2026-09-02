# Benchmark Test Suite

Comprehensive test suite for the Claude Flow benchmark enhancement project, providing thorough validation of all new functionality including MLE-STAR integration, automation systems, advanced metrics, collective intelligence, and CLAUDE.md optimization.

## 🎯 Test Coverage

The test suite is organized into multiple layers to ensure comprehensive validation:

### Unit Tests (95% coverage target)
- **MLE-STAR Integration** (`test_mle_star.py`)
  - Ensemble executor functionality
  - Voting strategies (majority, weighted, stacking, bayesian)
  - Model coordination and performance tracking
  - Integration with Claude Flow MCP tools

- **Automation Systems** (`test_automation.py`)
  - Batch processor with resource pooling
  - Pipeline manager with dependency resolution
  - Workflow executor for autonomous execution
  - Error handling and retry mechanisms

- **Advanced Metrics** (`test_metrics.py`)
  - Token optimization tracker
  - Memory persistence profiler
  - Neural processing benchmarks
  - Performance analysis and optimization

- **Collective Intelligence** (`test_collective.py`)
  - Hive mind benchmark system
  - Swarm coordination and consensus mechanisms
  - Knowledge sharing across agents
  - Emergent behavior detection

- **CLAUDE.md Optimizer** (`test_claude_optimizer.py`)
  - Configuration generation for different use cases
  - Optimization rules engine
  - Effectiveness benchmarking
  - Project context handling

### Integration Tests
- **Full Pipeline Workflows** (`test_full_pipeline.py`)
  - End-to-end scenario testing
  - Component interaction validation
  - Real-world use case simulation
  - Cross-system coordination

### Performance Tests
- **Benchmark Suite** (`test_benchmarks.py`)
  - Performance baseline establishment
  - Regression detection and alerting
  - Scalability testing under load
  - Memory leak detection
  - Stress testing scenarios

## 🚀 Quick Start

### Prerequisites
```bash
cd benchmark
pip install -r requirements.txt
pip install -r tests/requirements-test.txt
```

### Running Tests

#### Fast Tests (recommended for development)
```bash
python tests/run_tests.py fast
```

#### All Tests
```bash
python tests/run_tests.py all --coverage
```

#### Specific Test Categories
```bash
# Unit tests only
python tests/run_tests.py unit --coverage

# Integration tests
python tests/run_tests.py integration

# Performance tests  
python tests/run_tests.py performance

# Specific module
python tests/run_tests.py module --module mle_star
```

#### Parallel Execution
```bash
python tests/run_tests.py parallel --workers 4
```

## 📊 Test Markers

Tests are categorized using pytest markers:

- `@pytest.mark.unit` - Unit tests
- `@pytest.mark.integration` - Integration tests  
- `@pytest.mark.performance` - Performance tests
- `@pytest.mark.slow` - Slow-running tests
- `@pytest.mark.stress` - Stress tests
- `@pytest.mark.regression` - Regression tests

### Running Specific Categories
```bash
# Run only fast tests
pytest -m "not slow"

# Run performance tests
pytest -m "performance"

# Run integration tests
pytest -m "integration"
```

## 🔧 Test Configuration

### Pytest Configuration (`pytest.ini`)
- Test discovery patterns
- Marker definitions
- Output formatting
- Coverage settings
- Timeout configuration

### Fixtures (`conftest.py`)
- Shared test fixtures for all modules
- Mock data generators
- Temporary file management
- Performance monitoring utilities

## 📈 Performance Testing

### Baseline Establishment
The test suite establishes performance baselines for:
- CPU-intensive operations
- Memory usage patterns
- Async operation throughput
- Batch processing efficiency
- Concurrent execution scaling

### Regression Detection
Automated regression detection with:
- 20% regression threshold
- Historical performance tracking
- Alerting on significant degradations
- Performance improvement recognition

### Scalability Testing
- Load testing under various conditions
- Concurrent execution validation
- Memory pressure testing
- Resource contention handling

## 🤖 Continuous Integration

The test suite integrates with GitHub Actions for:
- Automated testing on push/PR
- Daily regression testing
- Performance monitoring
- Security scanning
- Code quality checks

### Workflow Jobs
1. **Fast Tests** - Quick feedback on all Python versions
2. **Unit Tests** - Comprehensive unit testing with coverage
3. **Integration Tests** - End-to-end workflow validation
4. **Performance Tests** - Performance regression detection
5. **Stress Tests** - Load and stress testing
6. **Code Quality** - Linting and formatting checks

## 📋 Test Data and Fixtures

### Mock Components
Comprehensive mock implementations for:
- MLE-STAR ensemble executors
- Batch processing systems
- Memory profilers
- Swarm coordination systems
- CLAUDE.md optimizers

### Test Data Generators
Realistic test data for:
- Project structures (web API, ML, data pipeline)
- Performance scenarios
- Code samples for analysis
- Time series data for metrics

### Fixtures Categories
- **Component Fixtures** - Mock systems and components
- **Data Fixtures** - Sample data and configurations
- **Environment Fixtures** - Temporary directories and databases
- **Performance Fixtures** - Baseline metrics and monitors

## 🎖️ Best Practices

### Test Design Principles
1. **Isolation** - Tests don't depend on each other
2. **Repeatability** - Same results on every run
3. **Fast Feedback** - Quick tests for development workflow
4. **Comprehensive Coverage** - All code paths tested
5. **Realistic Scenarios** - Tests mirror real usage

### Mock Strategy
- Mock external dependencies (file systems, networks)
- Use realistic data and behaviors
- Verify component interactions
- Test error conditions and edge cases

### Performance Testing
- Establish baselines early
- Test under realistic conditions
- Monitor for regressions continuously
- Test scalability characteristics

## 📝 Writing New Tests

### Unit Test Template
```python
import pytest
from unittest.mock import Mock, AsyncMock

class TestMyComponent:
    @pytest.fixture
    def mock_component(self):
        return Mock()
    
    def test_basic_functionality(self, mock_component):
        # Arrange
        mock_component.setup_method.return_value = "expected"
        
        # Act
        result = mock_component.method_under_test()
        
        # Assert
        assert result == "expected"
        mock_component.setup_method.assert_called_once()
    
    @pytest.mark.asyncio
    async def test_async_functionality(self, mock_component):
        # Test async behavior
        pass
    
    @pytest.mark.slow
    def test_performance_scenario(self, mock_component):
        # Test performance characteristics
        pass
```

### Integration Test Template
```python
@pytest.mark.integration
class TestIntegratedWorkflow:
    @pytest.mark.asyncio
    async def test_end_to_end_workflow(self):
        # Test complete workflow
        pass
```

## 📊 Coverage Reports

Coverage reports are generated in multiple formats:
- **Terminal** - Quick summary during test runs
- **HTML** - Detailed interactive reports (`htmlcov/index.html`)
- **XML** - CI/CD integration (`coverage.xml`)

### Coverage Targets
- **Unit Tests**: 95% minimum
- **Integration Tests**: 80% minimum
- **Overall Project**: 85% minimum

## 🔍 Debugging Tests

### Common Issues
1. **Async Test Failures** - Use proper `@pytest.mark.asyncio`
2. **Mock Assertions** - Verify mock calls and return values
3. **Fixture Dependencies** - Check fixture scope and lifecycle
4. **Performance Flakiness** - Use appropriate timeouts and retries

### Debug Commands
```bash
# Run with detailed output
pytest -vvv --tb=long

# Run specific test
pytest tests/unit/test_mle_star.py::TestMLEStarEnsembleExecutor::test_ensemble_initialization

# Run with debugging
pytest --pdb tests/unit/test_automation.py

# Profile test performance
pytest --profile tests/performance/
```

## 📞 Support

For test-related issues:
1. Check the test output and logs
2. Verify fixture and mock setup
3. Run tests with increased verbosity
4. Refer to existing test examples
5. Check GitHub Actions workflow results

---

This test suite ensures the benchmark enhancement project meets the highest quality standards with comprehensive validation, performance monitoring, and continuous integration.