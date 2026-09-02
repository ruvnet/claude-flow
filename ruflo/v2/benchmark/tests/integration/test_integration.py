#!/usr/bin/env python3
"""
Test script for claude-flow integration.

This script tests the integration layer to ensure proper execution
of claude-flow commands with comprehensive error handling and output capture.
"""

import sys
import json
import logging
from pathlib import Path

# Add benchmark src to path
sys.path.insert(0, str(Path(__file__).parent / "src"))

from swarm_benchmark.core.claude_flow_executor import (
    ClaudeFlowExecutor, SwarmConfig, SparcConfig, 
    ExecutionStrategy, CoordinationMode, SparcMode
)
from swarm_benchmark.core.integration_utils import (
    OutputParser, CommandBuilder, ErrorHandler, 
    ProgressTracker, performance_monitoring
)


# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)


def test_executor_initialization():
    """Test executor initialization and validation."""
    print("\n=== Testing Executor Initialization ===")
    
    try:
        # Initialize executor
        executor = ClaudeFlowExecutor()
        print(f"✅ Executor initialized with path: {executor.claude_flow_path}")
        
        # Validate installation
        if executor.validate_installation():
            print("✅ Claude-flow installation validated")
        else:
            print("❌ Claude-flow installation validation failed")
            
    except Exception as e:
        print(f"❌ Failed to initialize executor: {e}")
        return False
        
    return True


def test_swarm_execution():
    """Test swarm command execution."""
    print("\n=== Testing Swarm Execution ===")
    
    try:
        executor = ClaudeFlowExecutor()
        
        # Test configuration
        config = SwarmConfig(
            objective="Create a simple hello world function",
            strategy=ExecutionStrategy.DEVELOPMENT,
            mode=CoordinationMode.CENTRALIZED,
            max_agents=3,
            timeout=5,  # 5 minutes
            dry_run=True  # Dry run for testing
        )
        
        print(f"📋 Config: {json.dumps(config.__dict__, indent=2)}")
        
        # Execute with performance monitoring
        with performance_monitoring() as monitor:
            result = executor.execute_swarm(config)
            
        print(f"\n✅ Execution completed:")
        print(f"  - Success: {result.success}")
        print(f"  - Exit code: {result.exit_code}")
        print(f"  - Duration: {result.duration:.2f}s")
        print(f"  - Timeout: {result.timeout}")
        
        if result.stdout:
            print(f"\n📄 Output preview:")
            print(result.stdout[:500] + "..." if len(result.stdout) > 500 else result.stdout)
            
        if result.stderr:
            print(f"\n⚠️  Errors:")
            print(result.stderr[:500] + "..." if len(result.stderr) > 500 else result.stderr)
            
        # Parse output
        parsed = OutputParser.parse_output(result.stdout)
        print(f"\n📊 Parsed output: {json.dumps(parsed, indent=2)}")
        
    except Exception as e:
        print(f"❌ Swarm execution failed: {e}")
        logger.exception("Swarm execution error")
        return False
        
    return True


def test_sparc_execution():
    """Test SPARC command execution."""
    print("\n=== Testing SPARC Execution ===")
    
    try:
        executor = ClaudeFlowExecutor()
        
        # Test configuration
        config = SparcConfig(
            prompt="Analyze the current codebase structure",
            mode=SparcMode.ANALYZER,
            memory_key="codebase_analysis",
            timeout=5  # 5 minutes
        )
        
        print(f"📋 Config: {json.dumps(config.__dict__, indent=2)}")
        
        # Execute
        result = executor.execute_sparc(config)
        
        print(f"\n✅ Execution completed:")
        print(f"  - Success: {result.success}")
        print(f"  - Exit code: {result.exit_code}")
        print(f"  - Duration: {result.duration:.2f}s")
        
        if result.stdout:
            print(f"\n📄 Output preview:")
            print(result.stdout[:500] + "..." if len(result.stdout) > 500 else result.stdout)
            
    except Exception as e:
        print(f"❌ SPARC execution failed: {e}")
        logger.exception("SPARC execution error")
        return False
        
    return True


def test_command_building():
    """Test command building utilities."""
    print("\n=== Testing Command Building ===")
    
    # Test swarm command
    swarm_cmd = CommandBuilder.build_swarm_command(
        "Build a REST API",
        strategy="development",
        mode="hierarchical",
        max_agents=5,
        parallel=True,
        monitor=True
    )
    print(f"Swarm command: {' '.join(swarm_cmd)}")
    
    # Test SPARC command
    sparc_cmd = CommandBuilder.build_sparc_command(
        "Optimize database queries",
        mode="optimizer",
        memory_key="db_optimization",
        batch=True
    )
    print(f"SPARC command: {' '.join(sparc_cmd)}")
    
    # Test validation
    valid_config = {"objective": "Test", "strategy": "development"}
    errors = CommandBuilder.validate_swarm_config(valid_config)
    print(f"\nValid config errors: {errors}")
    
    invalid_config = {"strategy": "invalid_strategy"}
    errors = CommandBuilder.validate_swarm_config(invalid_config)
    print(f"Invalid config errors: {errors}")
    
    return True


def test_error_handling():
    """Test error handling and categorization."""
    print("\n=== Testing Error Handling ===")
    
    test_errors = [
        "command not found: claude-flow",
        "Error: invalid option --invalid",
        "Process terminated with signal 11",
        "Connection refused while fetching data",
        "Execution timed out after 60 seconds"
    ]
    
    for error in test_errors:
        category = ErrorHandler.categorize_error(error)
        suggestion = ErrorHandler.get_recovery_suggestion(category)
        should_retry = ErrorHandler.should_retry(category)
        
        print(f"\nError: {error}")
        print(f"  - Category: {category}")
        print(f"  - Suggestion: {suggestion}")
        print(f"  - Should retry: {should_retry}")
        
    return True


def test_progress_tracking():
    """Test progress tracking with sample output."""
    print("\n=== Testing Progress Tracking ===")
    
    tracker = ProgressTracker()
    tracker.start()
    
    # Simulate output lines
    sample_lines = [
        "🎯 Starting swarm execution...",
        "Task created: task-001-research",
        "Agent Researcher started",
        "Task created: task-002-analysis", 
        "✅ Task completed: task-001-research",
        "❌ Error: Failed to connect to API",
        "Agent Analyzer started",
        "✅ Task completed: task-002-analysis"
    ]
    
    for line in sample_lines:
        tracker.parse_output_stream(line)
        
    summary = tracker.get_summary()
    print(f"\nProgress summary:")
    print(json.dumps(summary, indent=2))
    
    return True


def main():
    """Run all integration tests."""
    print("🧪 Claude-Flow Integration Tests")
    print("=" * 50)
    
    tests = [
        ("Executor Initialization", test_executor_initialization),
        ("Command Building", test_command_building),
        ("Error Handling", test_error_handling),
        ("Progress Tracking", test_progress_tracking),
        ("Swarm Execution", test_swarm_execution),
        ("SPARC Execution", test_sparc_execution),
    ]
    
    results = []
    for test_name, test_func in tests:
        try:
            print(f"\n🔄 Running: {test_name}")
            success = test_func()
            results.append((test_name, success))
        except Exception as e:
            print(f"❌ Test failed with exception: {e}")
            logger.exception(f"Test {test_name} failed")
            results.append((test_name, False))
            
    # Summary
    print("\n" + "=" * 50)
    print("📊 Test Summary:")
    for test_name, success in results:
        status = "✅ PASS" if success else "❌ FAIL"
        print(f"  {test_name}: {status}")
        
    passed = sum(1 for _, success in results if success)
    total = len(results)
    print(f"\n🏁 Total: {passed}/{total} tests passed")
    
    return passed == total


if __name__ == "__main__":
    success = main()
    sys.exit(0 if success else 1)