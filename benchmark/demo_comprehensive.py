#!/usr/bin/env python3
"""Comprehensive demonstration of the swarm benchmarking tool."""

import asyncio
import json
from pathlib import Path
from swarm_benchmark.core.benchmark_engine import BenchmarkEngine
from swarm_benchmark.core.models import BenchmarkConfig, StrategyType, CoordinationMode


async def run_comprehensive_demo():
    """Run a comprehensive demonstration of all features."""
    print("🚀 Starting Comprehensive Swarm Benchmark Demonstration")
    print("=" * 60)
    
    # Test scenarios with different strategy/mode combinations
    test_scenarios = [
        {
            "name": "Auto Strategy - Centralized",
            "objective": "Build a user authentication system",
            "strategy": StrategyType.AUTO,
            "mode": CoordinationMode.CENTRALIZED,
            "max_agents": 3
        },
        {
            "name": "Research Strategy - Distributed", 
            "objective": "Research cloud architecture patterns and best practices",
            "strategy": StrategyType.RESEARCH,
            "mode": CoordinationMode.DISTRIBUTED,
            "max_agents": 5
        },
        {
            "name": "Development Strategy - Hierarchical",
            "objective": "Develop a microservices REST API with authentication",
            "strategy": StrategyType.DEVELOPMENT,
            "mode": CoordinationMode.HIERARCHICAL,
            "max_agents": 6
        },
        {
            "name": "Analysis Strategy - Mesh",
            "objective": "Analyze user behavior patterns and generate insights",
            "strategy": StrategyType.ANALYSIS,
            "mode": CoordinationMode.MESH,
            "max_agents": 4
        },
        {
            "name": "Optimization Strategy - Hybrid",
            "objective": "Optimize database queries and improve application performance", 
            "strategy": StrategyType.OPTIMIZATION,
            "mode": CoordinationMode.HYBRID,
            "max_agents": 7
        },
        {
            "name": "Testing Strategy - Distributed",
            "objective": "Create comprehensive test suite with unit and integration tests",
            "strategy": StrategyType.TESTING,
            "mode": CoordinationMode.DISTRIBUTED,
            "max_agents": 4
        },
        {
            "name": "Maintenance Strategy - Centralized",
            "objective": "Update documentation and refactor legacy code components",
            "strategy": StrategyType.MAINTENANCE,
            "mode": CoordinationMode.CENTRALIZED,
            "max_agents": 2
        }
    ]
    
    results_summary = []
    
    for i, scenario in enumerate(test_scenarios, 1):
        print(f"\n📋 Test {i}/{len(test_scenarios)}: {scenario['name']}")
        print(f"   Objective: {scenario['objective']}")
        print(f"   Strategy: {scenario['strategy'].value}")
        print(f"   Mode: {scenario['mode'].value}")
        print(f"   Agents: {scenario['max_agents']}")
        
        # Create configuration
        config = BenchmarkConfig(
            name=f"demo-{scenario['strategy'].value}-{scenario['mode'].value}",
            description=f"Demo: {scenario['name']}",
            strategy=scenario['strategy'],
            mode=scenario['mode'],
            max_agents=scenario['max_agents'],
            output_formats=["json"],
            output_directory="./demo_reports",
            verbose=True
        )
        
        # Run benchmark
        engine = BenchmarkEngine(config)
        
        try:
            result = await engine.run_benchmark(scenario['objective'])
            
            if result['status'] == 'success':
                print(f"   ✅ Success - Duration: {result['duration']:.2f}s")
                
                # Extract key metrics
                if result['results']:
                    first_result = result['results'][0]
                    execution_time = first_result.get('execution_time', 0)
                    cpu_usage = first_result.get('resource_usage', {}).get('cpu_percent', 0)
                    memory_usage = first_result.get('resource_usage', {}).get('memory_mb', 0)
                    
                    summary = {
                        'scenario': scenario['name'],
                        'strategy': scenario['strategy'].value,
                        'mode': scenario['mode'].value,
                        'agents': scenario['max_agents'],
                        'duration': result['duration'],
                        'execution_time': execution_time,
                        'cpu_usage': cpu_usage,
                        'memory_usage': memory_usage,
                        'status': 'success'
                    }
                else:
                    summary = {
                        'scenario': scenario['name'],
                        'strategy': scenario['strategy'].value,
                        'mode': scenario['mode'].value,
                        'agents': scenario['max_agents'],
                        'duration': result['duration'],
                        'status': 'success'
                    }
            else:
                print(f"   ❌ Failed - Error: {result.get('error', 'Unknown error')}")
                summary = {
                    'scenario': scenario['name'],
                    'strategy': scenario['strategy'].value,
                    'mode': scenario['mode'].value,
                    'agents': scenario['max_agents'],
                    'status': 'failed',
                    'error': result.get('error', 'Unknown error')
                }
            
            results_summary.append(summary)
            
        except Exception as e:
            print(f"   ❌ Exception: {e}")
            results_summary.append({
                'scenario': scenario['name'],
                'strategy': scenario['strategy'].value,
                'mode': scenario['mode'].value,
                'agents': scenario['max_agents'],
                'status': 'exception',
                'error': str(e)
            })
        
        # Small delay between tests
        await asyncio.sleep(0.5)
    
    # Generate summary report
    print("\n" + "=" * 60)
    print("📊 BENCHMARK SUMMARY REPORT")
    print("=" * 60)
    
    successful_tests = [r for r in results_summary if r['status'] == 'success']
    failed_tests = [r for r in results_summary if r['status'] != 'success']
    
    print(f"✅ Successful Tests: {len(successful_tests)}/{len(test_scenarios)}")
    print(f"❌ Failed Tests: {len(failed_tests)}")
    
    if successful_tests:
        print("\n🏆 Performance Metrics:")
        avg_duration = sum(r.get('duration', 0) for r in successful_tests) / len(successful_tests)
        avg_execution = sum(r.get('execution_time', 0) for r in successful_tests) / len(successful_tests)
        
        print(f"   Average Benchmark Duration: {avg_duration:.2f}s")
        print(f"   Average Task Execution Time: {avg_execution:.2f}s")
        
        # Strategy performance
        print("\n📈 Strategy Performance:")
        strategy_performance = {}
        for result in successful_tests:
            strategy = result['strategy']
            if strategy not in strategy_performance:
                strategy_performance[strategy] = []
            strategy_performance[strategy].append(result.get('duration', 0))
        
        for strategy, durations in strategy_performance.items():
            avg_duration = sum(durations) / len(durations)
            print(f"   {strategy.capitalize()}: {avg_duration:.2f}s avg ({len(durations)} tests)")
        
        # Coordination mode performance
        print("\n🔗 Coordination Mode Performance:")
        mode_performance = {}
        for result in successful_tests:
            mode = result['mode']
            if mode not in mode_performance:
                mode_performance[mode] = []
            mode_performance[mode].append(result.get('duration', 0))
        
        for mode, durations in mode_performance.items():
            avg_duration = sum(durations) / len(durations)
            print(f"   {mode.capitalize()}: {avg_duration:.2f}s avg ({len(durations)} tests)")
    
    if failed_tests:
        print(f"\n❌ Failed Tests:")
        for test in failed_tests:
            print(f"   {test['scenario']}: {test.get('error', 'Unknown error')}")
    
    # Save detailed summary
    summary_path = Path("./demo_reports/benchmark_summary.json")
    summary_path.parent.mkdir(exist_ok=True)
    
    with open(summary_path, 'w') as f:
        json.dump({
            "demonstration_results": results_summary,
            "summary_statistics": {
                "total_tests": len(test_scenarios),
                "successful_tests": len(successful_tests),
                "failed_tests": len(failed_tests),
                "success_rate": len(successful_tests) / len(test_scenarios) * 100,
                "strategy_coverage": len(set(r['strategy'] for r in results_summary)),
                "mode_coverage": len(set(r['mode'] for r in results_summary))
            }
        }, f, indent=2)
    
    print(f"\n💾 Detailed summary saved to: {summary_path}")
    print(f"📁 Individual benchmark reports saved to: ./demo_reports/")
    
    print("\n🎉 Comprehensive demonstration completed!")
    
    return results_summary


if __name__ == "__main__":
    results = asyncio.run(run_comprehensive_demo())