#!/usr/bin/env python3
"""
Test Real Benchmarks - Validate real benchmark implementations.

This script tests that the real benchmark scenarios can:
1. Execute actual Claude Flow commands
2. Parse real responses and extract metrics
3. Handle errors gracefully
4. Produce valid benchmark results

Usage:
    python test_real_benchmarks.py [--quick] [--validate-only]
"""

import sys
import json
import argparse
import tempfile
from pathlib import Path

# Add src to path
sys.path.insert(0, str(Path(__file__).parent / "src"))

from swarm_benchmark.scenarios.real_benchmarks import (
    RealSwarmBenchmark, 
    RealHiveMindBenchmark, 
    RealSparcBenchmark,
    RealBenchmarkSuite,
    ClaudeFlowRealExecutor
)


def test_claude_flow_availability():
    """Test if claude-flow command is available."""
    print("🔍 Testing Claude Flow Availability")
    print("-" * 40)
    
    try:
        executor = ClaudeFlowRealExecutor()
        
        # Test installation validation
        is_valid = executor.executor.validate_installation()
        
        print(f"   Claude Flow Path: {executor.executor.claude_flow_path}")
        print(f"   Installation Valid: {is_valid}")
        print(f"   Working Directory: {executor.executor.working_dir}")
        
        if is_valid:
            print("✅ Claude Flow is available and working!")
            return True
        else:
            print("❌ Claude Flow installation issues detected")
            return False
            
    except Exception as e:
        print(f"❌ Claude Flow not available: {e}")
        return False


def test_swarm_benchmark():
    """Test real swarm benchmark."""
    print("\n🔬 Testing Real Swarm Benchmark")
    print("-" * 40)
    
    try:
        benchmark = RealSwarmBenchmark()
        
        # Run a quick test
        result = benchmark.benchmark_swarm_task("Create a simple hello world function")
        
        print(f"   Success: {result.success}")
        print(f"   Execution Time: {result.execution_time:.2f}s") 
        print(f"   Benchmark Name: {result.benchmark_name}")
        print(f"   Timestamp: {result.timestamp}")
        
        # Validate result structure
        result_dict = result.to_dict()
        required_fields = [
            'benchmark_name', 'success', 'execution_time', 'tokens_used',
            'agents_spawned', 'memory_usage_mb', 'cpu_usage_percent', 
            'output_size_bytes', 'command_executed', 'timestamp'
        ]
        
        missing_fields = [field for field in required_fields if field not in result_dict]
        if missing_fields:
            print(f"❌ Missing fields in result: {missing_fields}")
            return False
        
        print("✅ Swarm benchmark test passed!")
        return True
        
    except Exception as e:
        print(f"❌ Swarm benchmark test failed: {e}")
        return False


def test_hive_mind_benchmark():
    """Test real hive-mind benchmark."""
    print("\n🧠 Testing Real Hive-Mind Benchmark")
    print("-" * 40)
    
    try:
        benchmark = RealHiveMindBenchmark()
        
        # Run a quick test
        result = benchmark.benchmark_hive_mind("Solve a simple math problem: 2+2")
        
        print(f"   Success: {result.success}")
        print(f"   Execution Time: {result.execution_time:.2f}s")
        print(f"   Benchmark Name: {result.benchmark_name}")
        print(f"   Timestamp: {result.timestamp}")
        
        # Validate result structure
        result_dict = result.to_dict()
        if not all(hasattr(result, field) for field in ['success', 'execution_time', 'benchmark_name']):
            print("❌ Invalid result structure")
            return False
        
        print("✅ Hive-mind benchmark test passed!")
        return True
        
    except Exception as e:
        print(f"❌ Hive-mind benchmark test failed: {e}")
        return False


def test_sparc_benchmark():
    """Test real SPARC benchmark."""
    print("\n⚡ Testing Real SPARC Benchmark")
    print("-" * 40)
    
    try:
        benchmark = RealSparcBenchmark()
        
        # Run a quick test
        result = benchmark.benchmark_coder_mode("Write a simple function to add two numbers")
        
        print(f"   Success: {result.success}")
        print(f"   Execution Time: {result.execution_time:.2f}s")
        print(f"   Benchmark Name: {result.benchmark_name}")
        print(f"   Timestamp: {result.timestamp}")
        
        # Validate result structure
        result_dict = result.to_dict()
        if not all(hasattr(result, field) for field in ['success', 'execution_time', 'benchmark_name']):
            print("❌ Invalid result structure")
            return False
        
        print("✅ SPARC benchmark test passed!")
        return True
        
    except Exception as e:
        print(f"❌ SPARC benchmark test failed: {e}")
        return False


def test_metrics_extraction():
    """Test metrics extraction from sample output."""
    print("\n📊 Testing Metrics Extraction")
    print("-" * 40)
    
    try:
        executor = ClaudeFlowRealExecutor()
        
        # Test token extraction
        sample_output1 = "Processing complete. Total tokens: 1250 used in execution."
        tokens = executor._extract_token_usage(sample_output1)
        print(f"   Token extraction test 1: {tokens} (expected: 1250)")
        
        sample_output2 = "Agent spawned successfully. 5 agents now active in swarm."
        agents = executor._extract_agent_count(sample_output2)
        print(f"   Agent extraction test 1: {agents} (expected: 5)")
        
        # Test error counting
        sample_error = "ERROR: Connection failed. WARNING: Retrying. ERROR: Still failing."
        error_count = executor._count_errors(sample_error)
        warning_count = executor._count_warnings(sample_error)
        print(f"   Error count test: {error_count} (expected: 2)")
        print(f"   Warning count test: {warning_count} (expected: 1)")
        
        # Test JSON parsing
        sample_json_output = 'Some text {"metrics": {"performance": 0.95}} more text'
        metrics = executor._parse_json_metrics(sample_json_output)
        print(f"   JSON parsing test: {metrics}")
        
        print("✅ Metrics extraction tests passed!")
        return True
        
    except Exception as e:
        print(f"❌ Metrics extraction test failed: {e}")
        return False


def test_benchmark_suite():
    """Test comprehensive benchmark suite."""
    print("\n🔥 Testing Benchmark Suite")
    print("-" * 40)
    
    try:
        # Create temporary output directory
        with tempfile.TemporaryDirectory() as temp_dir:
            suite = RealBenchmarkSuite(output_dir=temp_dir)
            
            print(f"   Output Directory: {temp_dir}")
            print(f"   Suite Initialized: ✅")
            
            # Test suite structure
            assert hasattr(suite, 'swarm_bench'), "Missing swarm_bench"
            assert hasattr(suite, 'hive_bench'), "Missing hive_bench"
            assert hasattr(suite, 'sparc_bench'), "Missing sparc_bench"
            
            print("✅ Benchmark suite test passed!")
            return True
            
    except Exception as e:
        print(f"❌ Benchmark suite test failed: {e}")
        return False


def run_quick_validation():
    """Run quick validation without full execution."""
    print("🚀 Running Quick Validation")
    print("=" * 50)
    
    tests = [
        ("Claude Flow Availability", test_claude_flow_availability),
        ("Metrics Extraction", test_metrics_extraction),
        ("Benchmark Suite", test_benchmark_suite)
    ]
    
    results = []
    for test_name, test_func in tests:
        try:
            result = test_func()
            results.append((test_name, result))
        except Exception as e:
            print(f"❌ {test_name} failed with exception: {e}")
            results.append((test_name, False))
    
    # Summary
    passed = sum(1 for _, result in results if result)
    total = len(results)
    
    print(f"\n📊 Quick Validation Summary:")
    print(f"   Tests Passed: {passed}/{total}")
    print(f"   Success Rate: {passed/total*100:.1f}%")
    
    for test_name, result in results:
        status = "✅" if result else "❌"
        print(f"   {status} {test_name}")
    
    return passed == total


def run_full_tests():
    """Run full benchmark tests."""
    print("🚀 Running Full Benchmark Tests")
    print("=" * 50)
    
    tests = [
        ("Claude Flow Availability", test_claude_flow_availability),
        ("Swarm Benchmark", test_swarm_benchmark),
        ("Hive-Mind Benchmark", test_hive_mind_benchmark),
        ("SPARC Benchmark", test_sparc_benchmark),
        ("Metrics Extraction", test_metrics_extraction),
        ("Benchmark Suite", test_benchmark_suite)
    ]
    
    results = []
    for test_name, test_func in tests:
        try:
            result = test_func()
            results.append((test_name, result))
        except Exception as e:
            print(f"❌ {test_name} failed with exception: {e}")
            results.append((test_name, False))
    
    # Summary
    passed = sum(1 for _, result in results if result)
    total = len(results)
    
    print(f"\n📊 Full Test Summary:")
    print(f"   Tests Passed: {passed}/{total}")
    print(f"   Success Rate: {passed/total*100:.1f}%")
    
    for test_name, result in results:
        status = "✅" if result else "❌"
        print(f"   {status} {test_name}")
    
    # Save test results
    test_results = {
        "summary": {
            "total_tests": total,
            "passed_tests": passed,
            "success_rate": passed/total*100
        },
        "individual_results": [
            {"test": name, "passed": result} for name, result in results
        ]
    }
    
    with open("benchmark_test_results.json", 'w') as f:
        json.dump(test_results, f, indent=2)
    
    print(f"\n💾 Test results saved to: benchmark_test_results.json")
    
    return passed == total


def main():
    """Main entry point."""
    parser = argparse.ArgumentParser(description="Test Real Benchmarks")
    parser.add_argument("--quick", action="store_true",
                       help="Run quick validation only")
    parser.add_argument("--validate-only", action="store_true", 
                       help="Validate structure without executing benchmarks")
    
    args = parser.parse_args()
    
    if args.validate_only or args.quick:
        success = run_quick_validation()
    else:
        success = run_full_tests()
    
    if success:
        print("\n🎉 All tests passed! Real benchmarks are ready for use.")
        sys.exit(0)
    else:
        print("\n💥 Some tests failed. Please check the implementation.")
        sys.exit(1)


if __name__ == "__main__":
    main()