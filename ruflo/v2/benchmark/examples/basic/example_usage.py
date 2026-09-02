#!/usr/bin/env python3
"""
Example usage of the claude-flow integration layer.

This script demonstrates how to use the ClaudeFlowExecutor for various tasks.
"""

import sys
import json
from pathlib import Path

# Add benchmark src to path
sys.path.insert(0, str(Path(__file__).parent / "src"))

from swarm_benchmark.core.claude_flow_executor import (
    ClaudeFlowExecutor, SwarmConfig, SparcConfig,
    ExecutionStrategy, CoordinationMode, SparcMode, OutputFormat
)
from swarm_benchmark.core.integration_utils import (
    OutputParser, ErrorHandler, performance_monitoring
)


def example_basic_swarm():
    """Example: Basic swarm execution with dry run."""
    print("\n=== Example: Basic Swarm Execution ===")
    
    executor = ClaudeFlowExecutor()
    
    # Configure swarm
    config = SwarmConfig(
        objective="Create a Python REST API with FastAPI",
        strategy=ExecutionStrategy.DEVELOPMENT,
        mode=CoordinationMode.HIERARCHICAL,
        max_agents=5,
        parallel=True,
        monitor=True,
        dry_run=True  # Dry run to see what would happen
    )
    
    print(f"📋 Configuration:")
    print(json.dumps(config.to_dict(), indent=2))
    
    # Execute
    result = executor.execute_swarm(config)
    
    print(f"\n📊 Results:")
    print(f"  Success: {result.success}")
    print(f"  Duration: {result.duration:.2f}s")
    print(f"  Command: {' '.join(result.command)}")
    
    if result.stdout:
        print(f"\n📄 Output:")
        print(result.stdout)


def example_research_swarm():
    """Example: Research swarm with output parsing."""
    print("\n=== Example: Research Swarm ===")
    
    executor = ClaudeFlowExecutor()
    
    config = SwarmConfig(
        objective="Research best practices for microservices architecture",
        strategy=ExecutionStrategy.RESEARCH,
        mode=CoordinationMode.DISTRIBUTED,
        max_agents=8,
        parallel=True,
        batch_optimized=True,
        memory_shared=True,
        output=OutputFormat.JSON,
        output_dir="./research_output",
        dry_run=True
    )
    
    # Execute with performance monitoring
    with performance_monitoring() as monitor:
        result = executor.execute_swarm(config)
    
    # Parse output
    if result.stdout:
        parsed = OutputParser.parse_output(result.stdout)
        print(f"\n📊 Parsed Results:")
        print(f"  Agents started: {parsed['agents']['started']}")
        print(f"  Tasks created: {parsed['tasks']['created']}")
        print(f"  Memory keys: {parsed['memory_keys']}")


def example_sparc_modes():
    """Example: Using different SPARC modes."""
    print("\n=== Example: SPARC Modes ===")
    
    executor = ClaudeFlowExecutor()
    
    # Example 1: TDD mode
    tdd_config = SparcConfig(
        prompt="Create unit tests for a user authentication module",
        mode=SparcMode.TDD,
        memory_key="auth_tests",
        parallel=True
    )
    
    print("\n1. TDD Mode:")
    print(f"   Command: claude-flow sparc run {tdd_config.mode.value} \"{tdd_config.prompt}\"")
    
    # Example 2: Optimizer mode
    optimizer_config = SparcConfig(
        prompt="Optimize database queries for better performance",
        mode=SparcMode.OPTIMIZER,
        memory_key="db_optimization",
        batch=True
    )
    
    print("\n2. Optimizer Mode:")
    print(f"   Command: claude-flow sparc run {optimizer_config.mode.value} \"{optimizer_config.prompt}\"")
    
    # Example 3: Workflow manager
    workflow_config = SparcConfig(
        prompt="Orchestrate CI/CD pipeline setup",
        mode=SparcMode.WORKFLOW_MANAGER,
        monitor=True
    )
    
    print("\n3. Workflow Manager Mode:")
    print(f"   Command: claude-flow sparc run {workflow_config.mode.value} \"{workflow_config.prompt}\"")


def example_error_handling():
    """Example: Handling errors and retries."""
    print("\n=== Example: Error Handling ===")
    
    executor = ClaudeFlowExecutor(
        retry_attempts=3,
        retry_delay=2.0
    )
    
    # Simulate a command that might fail
    config = SwarmConfig(
        objective="Complex task that might timeout",
        timeout=1,  # Very short timeout
        dry_run=True
    )
    
    result = executor.execute_swarm(config)
    
    if not result.success:
        error_category = ErrorHandler.categorize_error(result.stderr)
        suggestion = ErrorHandler.get_recovery_suggestion(error_category)
        
        print(f"❌ Execution failed:")
        print(f"  Category: {error_category}")
        print(f"  Suggestion: {suggestion}")
        print(f"  Should retry: {ErrorHandler.should_retry(error_category)}")


def example_batch_operations():
    """Example: Batch operations for testing."""
    print("\n=== Example: Batch Testing Operations ===")
    
    executor = ClaudeFlowExecutor()
    
    config = SwarmConfig(
        objective="Run comprehensive test suite with coverage analysis",
        strategy=ExecutionStrategy.TESTING,
        mode=CoordinationMode.DISTRIBUTED,
        max_agents=12,
        parallel=True,
        test_types=["unit", "integration", "e2e", "performance"],
        coverage_target=90,
        file_ops_parallel=True,
        output=OutputFormat.HTML,
        output_dir="./test_reports",
        dry_run=True
    )
    
    print("📋 Test Configuration:")
    print(f"  Test types: {config.test_types}")
    print(f"  Coverage target: {config.coverage_target}%")
    print(f"  Parallel execution: {config.parallel}")
    print(f"  Max agents: {config.max_agents}")
    
    result = executor.execute_swarm(config)
    
    if result.success:
        print("\n✅ Test execution configured successfully")


def example_memory_operations():
    """Example: Using memory for cross-session data."""
    print("\n=== Example: Memory Operations ===")
    
    executor = ClaudeFlowExecutor()
    
    # Store data in memory
    test_data = {
        "project": "claude-flow-benchmark",
        "metrics": {
            "performance": 95,
            "reliability": 98,
            "scalability": 92
        },
        "timestamp": "2025-06-17T10:00:00Z"
    }
    
    print("💾 Storing data in memory...")
    store_result = executor.execute_memory_store("benchmark_results", test_data)
    
    if store_result.success:
        print("✅ Data stored successfully")
        
        # Retrieve data
        print("\n📥 Retrieving data from memory...")
        get_result, retrieved_data = executor.execute_memory_get("benchmark_results")
        
        if get_result.success and retrieved_data:
            print("✅ Data retrieved:")
            print(json.dumps(retrieved_data, indent=2))


def main():
    """Run all examples."""
    print("🚀 Claude-Flow Integration Examples")
    print("=" * 50)
    
    examples = [
        ("Basic Swarm", example_basic_swarm),
        ("Research Swarm", example_research_swarm),
        ("SPARC Modes", example_sparc_modes),
        ("Error Handling", example_error_handling),
        ("Batch Operations", example_batch_operations),
        ("Memory Operations", example_memory_operations)
    ]
    
    for name, func in examples:
        try:
            func()
        except Exception as e:
            print(f"\n❌ Example '{name}' failed: {e}")
    
    print("\n✅ Examples completed!")
    print("\nFor production use:")
    print("  - Remove dry_run=True to execute real commands")
    print("  - Set appropriate timeouts for your workloads")
    print("  - Monitor performance metrics for optimization")
    print("  - Use memory for cross-agent coordination")


if __name__ == "__main__":
    main()