#!/usr/bin/env python3
"""
Compare Multiple Benchmark Reports
Analyze and compare performance across different benchmark runs.
"""

import json
from pathlib import Path
from typing import List, Dict, Tuple
import subprocess
from datetime import datetime

class BenchmarkComparator:
    """Compare multiple benchmark reports."""
    
    def __init__(self, report_dir: Path = Path("reports")):
        self.report_dir = report_dir
    
    def run_comparison_benchmark(self, tasks: List[Tuple[str, str]]) -> None:
        """Run multiple benchmarks for comparison."""
        
        print("="*80)
        print("🔬 BENCHMARK COMPARISON SUITE")
        print("="*80)
        print(f"Running {len(tasks)} benchmark configurations...")
        print("-"*80)
        
        results = []
        
        for i, (task, strategy) in enumerate(tasks, 1):
            print(f"\n📊 Benchmark {i}/{len(tasks)}")
            print(f"   Task: {task}")
            print(f"   Strategy: {strategy}")
            
            # Run benchmark
            cmd = [
                "swarm-benchmark", "real", "swarm",
                task,
                "--strategy", strategy,
                "--timeout", "5",
                "--output-dir", str(self.report_dir)
            ]
            
            start_time = datetime.now()
            result = subprocess.run(cmd, capture_output=True, text=True)
            end_time = datetime.now()
            
            # Parse output to find benchmark ID
            benchmark_id = None
            for line in result.stdout.split('\n'):
                if "Benchmark ID:" in line:
                    benchmark_id = line.split(":")[-1].strip()
                    break
            
            results.append({
                'task': task,
                'strategy': strategy,
                'benchmark_id': benchmark_id,
                'duration': (end_time - start_time).total_seconds(),
                'success': result.returncode == 0
            })
            
            if result.returncode == 0:
                print(f"   ✅ Success in {results[-1]['duration']:.2f}s")
            else:
                print(f"   ❌ Failed after {results[-1]['duration']:.2f}s")
        
        # Generate comparison report
        self._generate_comparison_report(results)
    
    def _generate_comparison_report(self, results: List[Dict]) -> None:
        """Generate detailed comparison report."""
        
        print("\n" + "="*80)
        print("📊 COMPARISON REPORT")
        print("="*80)
        
        # Load detailed metrics for each benchmark
        detailed_results = []
        for result in results:
            if result['benchmark_id'] and result['success']:
                report_file = self.report_dir / f"benchmark_{result['benchmark_id']}.json"
                if report_file.exists():
                    with open(report_file) as f:
                        data = json.load(f)
                        result['details'] = data
                        detailed_results.append(result)
        
        if not detailed_results:
            print("No successful benchmarks to compare")
            return
        
        # Performance comparison
        print("\n⚡ PERFORMANCE COMPARISON:")
        print("-"*80)
        print(f"{'Task':<30} {'Strategy':<15} {'Time (s)':<12} {'Success Rate':<15} {'Memory (MB)':<12}")
        print("-"*80)
        
        for result in detailed_results:
            details = result['details']
            metrics = details.get('metrics', {})
            
            task_short = result['task'][:28] + ".." if len(result['task']) > 30 else result['task']
            
            print(f"{task_short:<30} {result['strategy']:<15} "
                  f"{details.get('duration', 0):<12.2f} "
                  f"{metrics.get('success_rate', 0):<15.1%} "
                  f"{metrics.get('peak_memory_mb', 0):<12.1f}")
        
        # Find best performers
        if len(detailed_results) > 1:
            print("\n🏆 BEST PERFORMERS:")
            print("-"*80)
            
            # Fastest
            fastest = min(detailed_results, key=lambda r: r['details'].get('duration', float('inf')))
            print(f"⚡ Fastest: {fastest['task'][:40]} ({fastest['strategy']}) - {fastest['details'].get('duration', 0):.2f}s")
            
            # Most reliable
            most_reliable = max(detailed_results, 
                              key=lambda r: r['details'].get('metrics', {}).get('success_rate', 0))
            reliability = most_reliable['details'].get('metrics', {}).get('success_rate', 0)
            print(f"✅ Most Reliable: {most_reliable['task'][:40]} ({most_reliable['strategy']}) - {reliability:.1%}")
            
            # Most efficient (lowest memory)
            most_efficient = min(detailed_results,
                               key=lambda r: r['details'].get('metrics', {}).get('peak_memory_mb', float('inf')))
            memory = most_efficient['details'].get('metrics', {}).get('peak_memory_mb', 0)
            print(f"💾 Most Efficient: {most_efficient['task'][:40]} ({most_efficient['strategy']}) - {memory:.1f} MB")
        
        # Strategy analysis
        print("\n🎯 STRATEGY ANALYSIS:")
        print("-"*80)
        
        strategy_stats = {}
        for result in detailed_results:
            strategy = result['strategy']
            if strategy not in strategy_stats:
                strategy_stats[strategy] = {
                    'count': 0,
                    'total_time': 0,
                    'success_rates': [],
                    'memory_usage': []
                }
            
            stats = strategy_stats[strategy]
            stats['count'] += 1
            stats['total_time'] += result['details'].get('duration', 0)
            stats['success_rates'].append(
                result['details'].get('metrics', {}).get('success_rate', 0)
            )
            stats['memory_usage'].append(
                result['details'].get('metrics', {}).get('peak_memory_mb', 0)
            )
        
        for strategy, stats in strategy_stats.items():
            avg_time = stats['total_time'] / stats['count']
            avg_success = sum(stats['success_rates']) / len(stats['success_rates'])
            avg_memory = sum(stats['memory_usage']) / len(stats['memory_usage']) if stats['memory_usage'] else 0
            
            print(f"\n📌 Strategy: {strategy}")
            print(f"   • Benchmarks Run: {stats['count']}")
            print(f"   • Avg Time: {avg_time:.2f}s")
            print(f"   • Avg Success Rate: {avg_success:.1%}")
            print(f"   • Avg Memory: {avg_memory:.1f} MB")
        
        # Save comparison report
        comparison_file = self.report_dir / f"comparison_{datetime.now().strftime('%Y%m%d_%H%M%S')}.json"
        with open(comparison_file, 'w') as f:
            json.dump({
                'timestamp': datetime.now().isoformat(),
                'benchmarks': detailed_results,
                'strategy_analysis': strategy_stats
            }, f, indent=2, default=str)
        
        print(f"\n📄 Comparison report saved to: {comparison_file}")
        print("="*80)

def main():
    """Main entry point for benchmark comparison."""
    import argparse
    
    parser = argparse.ArgumentParser(description="Compare multiple Claude Flow benchmarks")
    parser.add_argument("--preset", choices=["quick", "thorough", "strategies"],
                       default="quick", help="Preset comparison suite")
    parser.add_argument("--output-dir", default="reports", help="Output directory")
    
    args = parser.parse_args()
    
    # Define preset benchmark suites
    presets = {
        "quick": [
            ("Create a simple function", "development"),
            ("Write unit tests", "testing"),
            ("Analyze code quality", "analysis")
        ],
        "thorough": [
            ("Build REST API with authentication", "development"),
            ("Build REST API with authentication", "planning"),
            ("Build REST API with authentication", "analysis"),
            ("Implement data processing pipeline", "development"),
            ("Implement data processing pipeline", "optimization")
        ],
        "strategies": [
            ("Design a microservice", "auto"),
            ("Design a microservice", "development"),
            ("Design a microservice", "planning"),
            ("Design a microservice", "analysis"),
            ("Design a microservice", "testing"),
            ("Design a microservice", "optimization")
        ]
    }
    
    tasks = presets[args.preset]
    
    comparator = BenchmarkComparator(Path(args.output_dir))
    comparator.run_comparison_benchmark(tasks)

if __name__ == "__main__":
    main()