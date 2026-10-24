#!/usr/bin/env python3
"""
Example showing the improved benchmark reporting with detailed metrics and file references.
"""

import subprocess
import json
from pathlib import Path
import sys

def run_benchmark_with_report(task, strategy="auto"):
    """Run a benchmark and display the improved report."""
    
    print(f"\n🚀 Running benchmark: {task}")
    print("-" * 60)
    
    cmd = [
        "swarm-benchmark", "real", "swarm",
        task,
        "--strategy", strategy,
        "--timeout", "2",
        "--output-dir", "./my-benchmarks"
    ]
    
    result = subprocess.run(cmd, capture_output=True, text=True)
    
    # Display the output (which now includes detailed report)
    print(result.stdout)
    
    # Parse the results file if created
    results_dir = Path("./my-benchmarks")
    if results_dir.exists():
        # Find the most recent benchmark file
        json_files = list(results_dir.glob("benchmark_*.json"))
        if json_files:
            latest_file = max(json_files, key=lambda p: p.stat().st_mtime)
            
            print(f"\n📂 Reading results from: {latest_file}")
            with open(latest_file) as f:
                data = json.load(f)
                
            print("\n🔍 Key Metrics from JSON:")
            if 'metrics' in data:
                metrics = data['metrics']
                print(f"  - Execution Time: {metrics.get('wall_clock_time', 'N/A')}s")
                print(f"  - Success Rate: {metrics.get('success_rate', 'N/A')}")
                print(f"  - Peak Memory: {metrics.get('peak_memory_mb', 'N/A')} MB")
            
            print(f"\n📊 Benchmark ID: {data.get('benchmark_id', 'N/A')}")
            print(f"📋 Status: {data.get('status', 'N/A')}")
    
    return result.returncode == 0

if __name__ == "__main__":
    # Example 1: Simple task
    success = run_benchmark_with_report(
        "Create a hello world function",
        strategy="development"
    )
    
    # Example 2: More complex task
    if success:
        run_benchmark_with_report(
            "Design a REST API with authentication",
            strategy="analysis"
        )
    
    print("\n✅ Benchmark examples completed!")
    print("Check ./my-benchmarks/ for detailed results files")
    
    sys.exit(0 if success else 1)