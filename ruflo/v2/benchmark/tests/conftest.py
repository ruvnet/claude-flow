"""
Pytest configuration and shared fixtures for benchmark tests.

Provides common test fixtures, data generators, and configuration
for all test modules in the benchmark testing suite.
"""

import pytest
import asyncio
import tempfile
import shutil
from pathlib import Path
from datetime import datetime, timedelta
from typing import Dict, List, Any, Optional
from unittest.mock import Mock, AsyncMock, MagicMock
import json
import numpy as np

# Import test data generators
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent.parent / "src"))
from fixtures.test_data import TestDataGenerator


# Pytest configuration
def pytest_configure(config):
    """Configure pytest with custom markers and settings."""
    config.addinivalue_line(
        "markers", "slow: marks tests as slow (deselect with '-m \"not slow\"')"
    )
    config.addinivalue_line(
        "markers", "integration: marks tests as integration tests"
    )
    config.addinivalue_line(
        "markers", "performance: marks tests as performance tests"
    )
    config.addinivalue_line(
        "markers", "stress: marks tests as stress tests"
    )
    config.addinivalue_line(
        "markers", "regression: marks tests as regression tests"
    )


def pytest_collection_modifyitems(config, items):
    """Automatically mark tests based on their location and name."""
    for item in items:
        # Mark integration tests
        if "integration" in str(item.fspath):
            item.add_marker(pytest.mark.integration)
        
        # Mark performance tests
        if "performance" in str(item.fspath) or "performance" in item.name:
            item.add_marker(pytest.mark.performance)
        
        # Mark slow tests
        if "slow" in item.name or any(marker.name == "slow" for marker in item.iter_markers()):
            item.add_marker(pytest.mark.slow)


# Event loop fixture for async tests
@pytest.fixture(scope="session")
def event_loop():
    """Create an instance of the default event loop for the test session."""
    loop = asyncio.new_event_loop()
    yield loop
    loop.close()


# Test data fixtures
@pytest.fixture
def test_data_generator():
    """Provide test data generator instance."""
    return TestDataGenerator()


@pytest.fixture
def sample_project_structure(test_data_generator):
    """Create a sample project structure for testing."""
    project_path = test_data_generator.create_sample_project("web_api")
    yield project_path
    # Cleanup after test
    if project_path.exists():
        shutil.rmtree(project_path)


@pytest.fixture
def ml_project_structure(test_data_generator):
    """Create an ML project structure for testing."""
    project_path = test_data_generator.create_sample_project("ml_model")
    yield project_path
    # Cleanup after test
    if project_path.exists():
        shutil.rmtree(project_path)


@pytest.fixture
def data_pipeline_structure(test_data_generator):
    """Create a data pipeline project structure for testing."""
    project_path = test_data_generator.create_sample_project("data_pipeline")
    yield project_path
    # Cleanup after test
    if project_path.exists():
        shutil.rmtree(project_path)


@pytest.fixture
def test_prompts(test_data_generator):
    """Provide categorized test prompts."""
    return test_data_generator.get_test_prompts()


@pytest.fixture
def performance_scenarios(test_data_generator):
    """Provide performance testing scenarios."""
    return test_data_generator.get_performance_scenarios()


@pytest.fixture
def code_samples(test_data_generator):
    """Provide code samples for testing."""
    return test_data_generator.get_code_samples()


# Mock component fixtures
@pytest.fixture
def mock_benchmark_config():
    """Provide mock benchmark configuration."""
    return {
        "name": "test_benchmark",
        "description": "Test benchmark configuration",
        "max_agents": 5,
        "timeout": 300,
        "parallel": True,
        "monitoring": True,
        "output_formats": ["json"],
        "output_directory": "./test_output"
    }


@pytest.fixture
def mock_task():
    """Provide mock task for testing."""
    return {
        "id": "test_task_001",
        "objective": "Test objective",
        "description": "Test task description",
        "strategy": "auto",
        "mode": "centralized",
        "timeout": 300,
        "created_at": datetime.now(),
        "parameters": {"param1": "value1", "param2": "value2"}
    }


@pytest.fixture
def mock_agent():
    """Provide mock agent for testing."""
    agent = Mock()
    agent.id = "test_agent_001"
    agent.type = "specialist"
    agent.name = "Test Agent"
    agent.capabilities = ["analysis", "coordination"]
    agent.status = "idle"
    agent.performance_metrics = {
        "tasks_completed": 0,
        "success_rate": 1.0,
        "avg_execution_time": 0.0
    }
    return agent


@pytest.fixture
def mock_result():
    """Provide mock result for testing."""
    return {
        "id": "test_result_001",
        "task_id": "test_task_001", 
        "agent_id": "test_agent_001",
        "status": "success",
        "output": {"result": "test output"},
        "execution_time": 1.5,
        "created_at": datetime.now(),
        "completed_at": datetime.now() + timedelta(seconds=1.5)
    }


# Temporary directory fixtures
@pytest.fixture
def temp_directory():
    """Provide temporary directory for test files."""
    temp_dir = Path(tempfile.mkdtemp())
    yield temp_dir
    # Cleanup after test
    if temp_dir.exists():
        shutil.rmtree(temp_dir)


@pytest.fixture
def temp_output_directory():
    """Provide temporary output directory for test results."""
    output_dir = Path(tempfile.mkdtemp(prefix="test_output_"))
    yield output_dir
    # Cleanup after test
    if output_dir.exists():
        shutil.rmtree(output_dir)


# Database and file fixtures
@pytest.fixture
def mock_sqlite_db():
    """Provide mock SQLite database for testing."""
    db_file = Path(tempfile.mkdtemp()) / "test.db"
    yield str(db_file)
    # Cleanup
    if db_file.exists():
        db_file.unlink()
    if db_file.parent.exists():
        shutil.rmtree(db_file.parent)


@pytest.fixture
def sample_json_data():
    """Provide sample JSON data for testing."""
    return {
        "benchmark_id": "test_benchmark_001",
        "created_at": datetime.now().isoformat(),
        "config": {
            "name": "test",
            "max_agents": 5,
            "strategy": "auto"
        },
        "results": [
            {
                "task_id": "task_1",
                "status": "completed",
                "execution_time": 1.2,
                "output": {"result": "success"}
            },
            {
                "task_id": "task_2", 
                "status": "completed",
                "execution_time": 2.1,
                "output": {"result": "success"}
            }
        ],
        "metrics": {
            "total_tasks": 2,
            "success_rate": 1.0,
            "avg_execution_time": 1.65
        }
    }


# Performance testing fixtures
@pytest.fixture
def performance_baseline():
    """Provide performance baseline metrics."""
    return {
        "cpu_intensive": {
            "execution_time": 0.5,
            "operations_per_second": 2000
        },
        "memory_intensive": {
            "memory_used_mb": 10.0,
            "peak_memory_mb": 15.0
        },
        "async_operation": {
            "execution_time": 0.2,
            "throughput": 50.0
        },
        "batch_processing": {
            "batches_per_second": 100.0,
            "success_rate": 0.95
        }
    }


@pytest.fixture
def mock_performance_monitor():
    """Provide mock performance monitor."""
    monitor = Mock()
    monitor.start_monitoring = Mock()
    monitor.stop_monitoring = Mock()
    monitor.get_metrics = Mock(return_value={
        "cpu_percent": 45.0,
        "memory_mb": 512.0,
        "network_bytes": 1024,
        "timestamp": datetime.now()
    })
    monitor.check_thresholds = Mock(return_value={"violations": []})
    return monitor


# MLE-STAR testing fixtures
@pytest.fixture
def mock_mle_star_config():
    """Provide mock MLE-STAR configuration."""
    return {
        "ensemble_size": 5,
        "voting_strategy": "weighted",
        "model_diversity": "high",
        "models": [
            {"type": "random_forest", "n_estimators": 100},
            {"type": "gradient_boost", "n_estimators": 100},
            {"type": "neural_network", "layers": [100, 50, 10]},
            {"type": "svm", "kernel": "rbf"},
            {"type": "logistic_regression", "penalty": "l2"}
        ]
    }


@pytest.fixture
def mock_ensemble_results():
    """Provide mock ensemble results."""
    return {
        "ensemble_size": 5,
        "accuracy": 0.94,
        "precision": 0.92,
        "recall": 0.91,
        "f1_score": 0.915,
        "consensus_time": 2.1,
        "training_time": 45.2,
        "voting_strategy": "weighted",
        "model_performance": [
            {"model": "random_forest", "accuracy": 0.92},
            {"model": "gradient_boost", "accuracy": 0.94},
            {"model": "neural_network", "accuracy": 0.96},
            {"model": "svm", "accuracy": 0.89},
            {"model": "logistic_regression", "accuracy": 0.91}
        ]
    }


# Automation testing fixtures
@pytest.fixture
def mock_batch_config():
    """Provide mock batch configuration."""
    return {
        "max_resources": 10,
        "max_parallel_per_type": 3,
        "timeout": 300,
        "retry_attempts": 3,
        "retry_delay": 1.0
    }


@pytest.fixture
def mock_pipeline_stages():
    """Provide mock pipeline stages."""
    return [
        {
            "name": "preparation",
            "tasks": ["analyze_requirements", "setup_environment"],
            "dependencies": [],
            "estimated_duration": 30
        },
        {
            "name": "implementation", 
            "tasks": ["develop_features", "write_tests"],
            "dependencies": ["preparation"],
            "estimated_duration": 120
        },
        {
            "name": "validation",
            "tasks": ["run_tests", "performance_check"],
            "dependencies": ["implementation"],
            "estimated_duration": 45
        }
    ]


# Memory and metrics fixtures
@pytest.fixture
def mock_memory_snapshot():
    """Provide mock memory snapshot."""
    return {
        "timestamp": datetime.now(),
        "heap_used_mb": 256.5,
        "heap_total_mb": 512.0,
        "external_memory_mb": 32.1,
        "gc_count": 5,
        "process_memory_mb": 412.3
    }


@pytest.fixture
def mock_token_metrics():
    """Provide mock token metrics."""
    return {
        "input_tokens": 150,
        "output_tokens": 300,
        "tool_tokens": 75,
        "cache_hit_rate": 0.25,
        "compression_ratio": 0.85,
        "total_tokens": 525,
        "optimization_potential": 0.3
    }


# Collective intelligence fixtures
@pytest.fixture
def mock_swarm_agents():
    """Provide mock swarm agents."""
    agents = []
    capabilities_pool = [
        ["analysis", "research"],
        ["development", "testing"],
        ["coordination", "monitoring"],
        ["optimization", "benchmarking"],
        ["documentation", "review"]
    ]
    
    for i in range(5):
        agent = Mock()
        agent.id = f"agent_{i}"
        agent.capabilities = capabilities_pool[i]
        agent.status = "idle"
        agent.performance_metrics = {
            "tasks_completed": np.random.randint(0, 20),
            "consensus_participation": np.random.randint(0, 10),
            "knowledge_contributions": np.random.randint(0, 15)
        }
        agent.is_healthy = Mock(return_value=True)
        agents.append(agent)
    
    return agents


@pytest.fixture
def mock_consensus_proposal():
    """Provide mock consensus proposal."""
    return {
        "id": "proposal_001",
        "type": "resource_allocation",
        "priority": "high",
        "description": "Allocate additional resources to critical tasks",
        "proposed_by": "agent_0",
        "timestamp": datetime.now(),
        "details": {
            "additional_agents": 2,
            "resource_type": "computational",
            "duration": 3600
        }
    }


# CLAUDE.md optimizer fixtures
@pytest.fixture
def mock_project_context():
    """Provide mock project context."""
    return {
        "project_name": "Test Project",
        "description": "A test project for benchmarking",
        "team_size": 4,
        "tech_stack": ["Python", "FastAPI", "PostgreSQL", "Docker"],
        "deadline": "normal",
        "requirements": ["testing", "optimization", "documentation"],
        "constraints": {
            "budget": "medium",
            "timeline": "8_weeks",
            "complexity": "medium"
        }
    }


@pytest.fixture
def mock_performance_targets():
    """Provide mock performance targets."""
    return {
        "speed": True,
        "accuracy": True,
        "tokens": True,
        "memory": False,
        "swarm": True
    }


@pytest.fixture
def mock_claude_config_content():
    """Provide mock CLAUDE.md configuration content."""
    return """# CLAUDE.md - Test Configuration

## 🎯 Project Configuration
- **Use Case**: api_development
- **Project**: Test Project
- **Team Size**: Medium complexity

## 🚀 Swarm Configuration
- **Topology**: hierarchical
- **Max Agents**: 5
- **Preferred Agents**: backend-dev, api-docs, tester

## 📋 Focus Areas
- REST endpoints
- OpenAPI documentation
- Comprehensive testing

## 🔧 Critical Rules
- Always validate input parameters
- Implement proper error handling
- Follow RESTful conventions
- Generate comprehensive tests

## ⚡ Performance Optimizations
- **Batch Operations**: True
- **Parallel Testing**: True
- **Cache Responses**: True
- **Memory Optimization**: False

## 🛠️ Tool Priorities
1. Edit
2. MultiEdit
3. Grep
4. Test

## 📊 Generated Configuration
- **Generated**: 2024-01-15 10:30:00
- **Optimization Level**: Advanced
- **Configuration Version**: 1.0
"""


# Utility fixtures
@pytest.fixture
def mock_execution_log():
    """Provide mock execution log."""
    log_entries = []
    
    # Add various types of log entries
    base_time = datetime.now()
    for i in range(10):
        log_entries.append({
            "timestamp": base_time + timedelta(seconds=i),
            "level": "info",
            "message": f"Operation {i} completed",
            "stage": f"stage_{i % 3}",
            "agent_id": f"agent_{i % 2}",
            "execution_time": np.random.uniform(0.1, 2.0)
        })
    
    return log_entries


@pytest.fixture
def async_mock():
    """Provide async mock helper."""
    def _async_mock(*args, **kwargs):
        mock = AsyncMock(*args, **kwargs)
        return mock
    return _async_mock


@pytest.fixture
def mock_time_series_data():
    """Provide mock time series data for performance analysis."""
    timestamps = [datetime.now() - timedelta(minutes=i) for i in range(60, 0, -1)]
    
    return [
        {
            "timestamp": ts,
            "cpu_percent": np.random.uniform(20, 80),
            "memory_mb": np.random.uniform(200, 800),
            "throughput": np.random.uniform(50, 200),
            "error_rate": np.random.uniform(0, 0.1),
            "response_time": np.random.uniform(0.1, 2.0)
        }
        for ts in timestamps
    ]


# Test categories and markers
@pytest.fixture(autouse=True)
def setup_test_environment():
    """Set up test environment for all tests."""
    # Set random seed for reproducible tests
    np.random.seed(42)
    
    # Ensure clean state
    import gc
    gc.collect()
    
    yield
    
    # Cleanup after test
    gc.collect()


# Parametrized fixtures for various test scenarios
@pytest.fixture(params=["api_development", "ml_pipeline", "frontend_react", "backend_microservices"])
def use_case_scenarios(request):
    """Provide different use case scenarios for parametrized tests."""
    return request.param


@pytest.fixture(params=["centralized", "distributed", "hierarchical", "mesh", "hybrid"])
def coordination_modes(request):
    """Provide different coordination modes for parametrized tests."""
    return request.param


@pytest.fixture(params=[1, 3, 5, 8, 12])
def agent_counts(request):
    """Provide different agent counts for parametrized tests."""
    return request.param


@pytest.fixture(params=["simple", "medium", "complex"])
def task_complexities(request):
    """Provide different task complexities for parametrized tests."""
    return request.param


# Skip markers for CI/CD environments
@pytest.fixture
def skip_in_ci():
    """Skip tests that shouldn't run in CI environment."""
    import os
    if os.environ.get("CI") or os.environ.get("GITHUB_ACTIONS"):
        pytest.skip("Skipping in CI environment")


@pytest.fixture
def skip_slow():
    """Skip slow tests unless explicitly requested."""
    import os
    if not os.environ.get("RUN_SLOW_TESTS"):
        pytest.skip("Skipping slow test (set RUN_SLOW_TESTS=1 to run)")