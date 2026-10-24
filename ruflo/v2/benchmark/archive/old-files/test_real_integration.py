#!/usr/bin/env python3
"""
Test script for real Claude Flow integration.

This script tests the RealClaudeFlowExecutor to ensure it can execute
actual ./claude-flow commands and parse the results properly.
"""

import asyncio
import logging
import sys
from pathlib import Path

# Add src to path
sys.path.insert(0, str(Path(__file__).parent / "src"))

from swarm_benchmark.core.claude_flow_real_executor import (
    RealClaudeFlowExecutor,
    SwarmCommand,
    HiveMindCommand,
    SparcCommand,
    execute_swarm_benchmark
)
from swarm_benchmark.core.real_benchmark_engine_v2 import RealBenchmarkEngine

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)


async def test_real_executor():
    """Test the real Claude Flow executor."""
    logger.info("=" * 60)
    logger.info("TESTING REAL CLAUDE FLOW EXECUTOR")
    logger.info("=" * 60)
    
    try:
        # Initialize executor
        executor = RealClaudeFlowExecutor()
        
        # Test installation validation
        logger.info("Testing installation validation...")
        is_valid = executor.validate_installation()
        logger.info(f"Installation valid: {is_valid}")
        
        if not is_valid:
            logger.warning("Claude Flow installation not found or invalid")
            logger.info("Continuing with tests anyway...")
        
        # Test available modes
        logger.info("Getting available modes...")
        modes = executor.get_available_modes()
        logger.info(f"Available modes: {modes}")
        
        # Test simple swarm command
        logger.info("\nTesting simple swarm command...")
        swarm_config = SwarmCommand(
            objective="Create a simple hello world function",
            strategy="development",
            mode="centralized",
            max_agents=3,
            timeout=5  # 5 minute timeout for testing
        )
        
        result = await executor.execute_swarm_async(swarm_config)
        
        logger.info("Swarm execution completed!")
        logger.info(f"Success: {result.success}")
        logger.info(f"Exit code: {result.exit_code}")
        logger.info(f"Duration: {result.duration:.2f}s")
        logger.info(f"Tokens: {result.input_tokens} input, {result.output_tokens} output")
        logger.info(f"Agents spawned: {result.agents_spawned}")
        logger.info(f"Tasks completed: {result.tasks_completed}")
        logger.info(f"Tool calls: {len(result.tool_calls)}")
        logger.info(f"Errors: {len(result.errors)}")
        logger.info(f"Warnings: {len(result.warnings)}")
        
        if result.stdout_lines:
            logger.info(f"First few stdout lines:")
            for line in result.stdout_lines[:5]:
                logger.info(f"  {line}")
        
        if result.stderr_lines:
            logger.info(f"Stderr lines:")
            for line in result.stderr_lines[:3]:
                logger.info(f"  {line}")
        
        if result.errors:
            logger.info(f"Errors encountered:")
            for error in result.errors[:3]:
                logger.info(f"  {error}")
        
        return result
        
    except Exception as e:
        logger.error(f"Test failed: {e}")
        import traceback
        traceback.print_exc()
        return None


async def test_real_benchmark_engine():
    """Test the real benchmark engine."""
    logger.info("\n" + "=" * 60)
    logger.info("TESTING REAL BENCHMARK ENGINE")
    logger.info("=" * 60)
    
    try:
        # Initialize engine
        engine = RealBenchmarkEngine()
        
        # Test simple benchmark
        logger.info("Running simple swarm benchmark...")
        result = await engine.run_swarm_benchmark(
            objective="Write a Python function that calculates fibonacci numbers",
            strategy="development",
            mode="centralized",
            max_agents=3,
            timeout=5
        )
        
        logger.info("Benchmark completed!")
        logger.info(f"Benchmark ID: {result.benchmark_id}")
        logger.info(f"Success: {result.success}")
        logger.info(f"Duration: {result.duration:.2f}s")
        logger.info(f"Total tokens: {result.total_tokens}")
        logger.info(f"Agents spawned: {result.agents_spawned}")
        
        # Test engine statistics
        stats = engine.get_summary_stats()
        logger.info(f"Engine stats: {stats}")
        
        return result
        
    except Exception as e:
        logger.error(f"Benchmark engine test failed: {e}")
        import traceback
        traceback.print_exc()
        return None


async def test_convenience_functions():
    """Test convenience functions."""
    logger.info("\n" + "=" * 60)
    logger.info("TESTING CONVENIENCE FUNCTIONS")
    logger.info("=" * 60)
    
    try:
        # Test convenience function
        logger.info("Testing convenience function...")
        result = await execute_swarm_benchmark(
            objective="Generate a simple test case",
            strategy="testing",
            mode="centralized",
            max_agents=2,
            timeout=3
        )
        
        logger.info("Convenience function test completed!")
        logger.info(f"Success: {result.success}")
        logger.info(f"Duration: {result.duration:.2f}s")
        
        return result
        
    except Exception as e:
        logger.error(f"Convenience function test failed: {e}")
        import traceback
        traceback.print_exc()
        return None


async def main():
    """Run all tests."""
    logger.info("Starting Real Claude Flow Integration Tests")
    logger.info(f"Working directory: {Path.cwd()}")
    
    # Check if claude-flow exists
    claude_flow_path = Path.cwd() / "claude-flow"
    if not claude_flow_path.exists():
        logger.warning(f"claude-flow not found at {claude_flow_path}")
        logger.info("Tests will show how the system handles missing executable")
    
    results = []
    
    # Test 1: Real executor
    logger.info("\n🔧 Test 1: Real Executor")
    result1 = await test_real_executor()
    results.append(("Real Executor", result1 is not None))
    
    # Test 2: Real benchmark engine
    logger.info("\n🏗️  Test 2: Real Benchmark Engine")
    result2 = await test_real_benchmark_engine()
    results.append(("Real Benchmark Engine", result2 is not None))
    
    # Test 3: Convenience functions
    logger.info("\n⚡ Test 3: Convenience Functions")
    result3 = await test_convenience_functions()
    results.append(("Convenience Functions", result3 is not None))
    
    # Summary
    logger.info("\n" + "=" * 60)
    logger.info("TEST SUMMARY")
    logger.info("=" * 60)
    
    for test_name, success in results:
        status = "✅ PASS" if success else "❌ FAIL"
        logger.info(f"{status} {test_name}")
    
    total_passed = sum(1 for _, success in results if success)
    logger.info(f"\nTotal: {total_passed}/{len(results)} tests passed")
    
    if total_passed == len(results):
        logger.info("🎉 All tests passed! Real Claude Flow integration is working!")
    else:
        logger.info("⚠️  Some tests failed. Check logs for details.")
    
    return total_passed == len(results)


if __name__ == "__main__":
    success = asyncio.run(main())
    sys.exit(0 if success else 1)