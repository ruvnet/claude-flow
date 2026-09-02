#!/usr/bin/env python3
"""
Test runner for the Real Claude-Flow Benchmark Engine
Validates the real benchmark architecture with actual executions
"""

import asyncio
import json
import sys
from pathlib import Path
from datetime import datetime

# Add the benchmark source to Python path
sys.path.insert(0, str(Path(__file__).parent / "src"))

from swarm_benchmark.core.real_benchmark_engine import RealBenchmarkEngine, SystemMonitor
from swarm_benchmark.core.models import (
    BenchmarkConfig, StrategyType, CoordinationMode, Task
)


class RealBenchmarkTester:
    """Test harness for real benchmark engine"""
    
    def __init__(self):
        self.results = {}
        self.system_monitor = SystemMonitor()
        
    async def test_basic_execution(self):
        """Test basic claude-flow execution"""
        print("\n🧪 Testing Basic Execution")
        print("=" * 60)
        
        config = BenchmarkConfig(
            name="basic-test",
            description="Basic execution test",
            strategy=StrategyType.AUTO,
            mode=CoordinationMode.CENTRALIZED,
            task_timeout=60,
            output_formats=["json"],
            output_directory="./test_output/real_benchmarks"
        )
        
        engine = RealBenchmarkEngine(config)
        
        try:
            # Test simple task
            result = await engine.run_benchmark("Create a hello world function")
            
            print(f"✅ Basic execution completed")
            print(f"   Duration: {result.get('duration', 0):.2f}s")
            print(f"   Status: {result.get('status', 'unknown')}")
            
            self.results['basic_execution'] = result
            return True
            
        except Exception as e:
            print(f"❌ Basic execution failed: {e}")
            self.results['basic_execution'] = {"error": str(e)}
            return False
    
    async def test_sparc_modes(self):
        """Test multiple SPARC modes"""
        print("\n🧪 Testing SPARC Modes")
        print("=" * 60)
        
        # Test a subset of SPARC modes
        test_modes = ["coder", "researcher", "analyzer", "documenter"]
        mode_results = {}
        
        config = BenchmarkConfig(
            name="sparc-test",
            task_timeout=45,
            output_formats=["json"]
        )
        
        engine = RealBenchmarkEngine(config)
        
        for mode in test_modes:
            print(f"\n📋 Testing SPARC mode: {mode}")
            
            try:
                # Create task for SPARC mode
                result = await engine._execute_sparc_mode(
                    mode, 
                    "Create a simple calculator function"
                )
                
                mode_results[mode] = result
                status = "✅" if result.get("success", False) else "❌"
                print(f"{status} {mode}: {result.get('duration', 0):.2f}s")
                
            except Exception as e:
                print(f"❌ {mode} failed: {e}")
                mode_results[mode] = {"error": str(e)}
        
        self.results['sparc_modes'] = mode_results
        return len([r for r in mode_results.values() if r.get("success", False)]) > 0
    
    async def test_swarm_strategies(self):
        """Test swarm execution strategies"""
        print("\n🧪 Testing Swarm Strategies")
        print("=" * 60)
        
        # Test configurations
        test_configs = [
            (StrategyType.RESEARCH, CoordinationMode.DISTRIBUTED),
            (StrategyType.DEVELOPMENT, CoordinationMode.HIERARCHICAL),
            (StrategyType.ANALYSIS, CoordinationMode.MESH),
        ]
        
        swarm_results = {}
        
        for strategy, mode in test_configs:
            print(f"\n📋 Testing {strategy.value} strategy with {mode.value} coordination")
            
            config = BenchmarkConfig(
                name=f"swarm-{strategy.value}-{mode.value}",
                strategy=strategy,
                mode=mode,
                task_timeout=60,
                max_agents=3,
                parallel=True
            )
            
            engine = RealBenchmarkEngine(config)
            
            try:
                task = Task(
                    objective="Analyze code quality patterns",
                    strategy=strategy,
                    mode=mode
                )
                
                result = await engine._execute_real_task(task)
                
                key = f"{strategy.value}_{mode.value}"
                swarm_results[key] = {
                    "success": result.status.value == "success",
                    "duration": result.performance_metrics.execution_time,
                    "resource_usage": {
                        "cpu": result.resource_usage.average_cpu_percent,
                        "memory": result.resource_usage.peak_memory_mb
                    }
                }
                
                status = "✅" if swarm_results[key]["success"] else "❌"
                print(f"{status} Duration: {swarm_results[key]['duration']:.2f}s")
                
            except Exception as e:
                print(f"❌ Failed: {e}")
                swarm_results[f"{strategy.value}_{mode.value}"] = {"error": str(e)}
        
        self.results['swarm_strategies'] = swarm_results
        return len([r for r in swarm_results.values() if r.get("success", False)]) > 0
    
    async def test_parallel_execution(self):
        """Test parallel task execution"""
        print("\n🧪 Testing Parallel Execution")
        print("=" * 60)
        
        config = BenchmarkConfig(
            name="parallel-test",
            parallel=True,
            max_agents=3,
            task_timeout=30
        )
        
        engine = RealBenchmarkEngine(config)
        
        # Create multiple tasks
        tasks = [
            Task(objective="Create a function to add numbers", strategy=StrategyType.AUTO),
            Task(objective="Create a function to multiply numbers", strategy=StrategyType.AUTO),
            Task(objective="Create a function to divide numbers", strategy=StrategyType.AUTO),
        ]
        
        try:
            print(f"📋 Executing {len(tasks)} tasks in parallel...")
            start_time = asyncio.get_event_loop().time()
            
            results = await engine.execute_batch(tasks)
            
            end_time = asyncio.get_event_loop().time()
            total_duration = end_time - start_time
            
            successful = sum(1 for r in results if r.status.value == "success")
            
            print(f"✅ Parallel execution completed")
            print(f"   Total duration: {total_duration:.2f}s")
            print(f"   Successful tasks: {successful}/{len(tasks)}")
            
            self.results['parallel_execution'] = {
                "total_duration": total_duration,
                "tasks_count": len(tasks),
                "successful_count": successful,
                "average_duration": total_duration / len(tasks) if tasks else 0
            }
            
            return successful > 0
            
        except Exception as e:
            print(f"❌ Parallel execution failed: {e}")
            self.results['parallel_execution'] = {"error": str(e)}
            return False
    
    async def test_resource_monitoring(self):
        """Test resource monitoring capabilities"""
        print("\n🧪 Testing Resource Monitoring")
        print("=" * 60)
        
        config = BenchmarkConfig(
            name="resource-test",
            monitoring=True,
            task_timeout=30
        )
        
        engine = RealBenchmarkEngine(config)
        
        try:
            # Take baseline measurement
            self.system_monitor.take_measurement()
            
            # Execute a task
            result = await engine.run_benchmark("Create a sorting algorithm")
            
            # Take final measurement
            self.system_monitor.take_measurement()
            
            # Get system summary
            system_summary = self.system_monitor.get_summary()
            
            print(f"✅ Resource monitoring completed")
            print(f"   CPU Usage: {system_summary.get('avg_cpu', 0):.1f}% (avg), {system_summary.get('max_cpu', 0):.1f}% (max)")
            print(f"   Memory Usage: {system_summary.get('avg_memory', 0):.1f}% (avg), {system_summary.get('max_memory', 0):.1f}% (max)")
            
            # Extract resource data from results
            if result.get('results') and len(result['results']) > 0:
                first_result = result['results'][0]
                resource_usage = first_result.get('resource_usage', {})
                
                print(f"   Process CPU: {resource_usage.get('average_cpu_percent', 0):.1f}%")
                print(f"   Process Memory: {resource_usage.get('peak_memory_mb', 0):.1f} MB")
            
            self.results['resource_monitoring'] = {
                "system_summary": system_summary,
                "monitoring_enabled": True
            }
            
            return True
            
        except Exception as e:
            print(f"❌ Resource monitoring failed: {e}")
            self.results['resource_monitoring'] = {"error": str(e)}
            return False
    
    async def run_all_tests(self):
        """Run all benchmark tests"""
        print("🚀 Starting Real Benchmark Engine Tests")
        print("=" * 60)
        
        test_results = []
        
        # Run tests
        test_results.append(await self.test_basic_execution())
        test_results.append(await self.test_sparc_modes())
        test_results.append(await self.test_swarm_strategies())
        test_results.append(await self.test_parallel_execution())
        test_results.append(await self.test_resource_monitoring())
        
        # Generate summary
        successful_tests = sum(test_results)
        total_tests = len(test_results)
        
        print("\n" + "=" * 60)
        print("📊 TEST SUMMARY")
        print("=" * 60)
        print(f"✅ Successful Tests: {successful_tests}/{total_tests}")
        print(f"❌ Failed Tests: {total_tests - successful_tests}/{total_tests}")
        
        # Save results
        output_file = Path("test_output/real_benchmark_test_results.json")
        output_file.parent.mkdir(exist_ok=True)
        
        with open(output_file, "w") as f:
            json.dump({
                "timestamp": datetime.now().isoformat(),
                "summary": {
                    "total_tests": total_tests,
                    "successful_tests": successful_tests,
                    "failed_tests": total_tests - successful_tests
                },
                "test_results": self.results
            }, f, indent=2)
        
        print(f"\n💾 Results saved to: {output_file}")
        
        return successful_tests == total_tests


async def main():
    """Main test runner"""
    tester = RealBenchmarkTester()
    success = await tester.run_all_tests()
    
    # Exit with appropriate code
    sys.exit(0 if success else 1)


if __name__ == "__main__":
    # Check Python version
    if sys.version_info < (3, 7):
        print("❌ Python 3.7+ required")
        sys.exit(1)
    
    # Run tests
    asyncio.run(main())