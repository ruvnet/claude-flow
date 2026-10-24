#!/usr/bin/env python3
"""
Simple swarm benchmark example using real claude-flow execution.

This example demonstrates:
- Basic swarm initialization
- Simple task execution
- Metrics collection
- Best practices for swarm coordination
"""

import subprocess
import sys
import json
from pathlib import Path

def run_swarm_benchmark():
    """Run a simple swarm benchmark using CLI commands."""
    print("🚀 Starting Simple Swarm Benchmark")
    print("=" * 50)
    
    # Example 1: Using CLI
    print("\n📋 Method 1: CLI Execution")
    cmd = [
        "swarm-benchmark", "real", "swarm",
        "Create a hello world API with basic authentication",
        "--strategy", "auto",
        "--max-agents", "3",
        "--output-format", "json"
    ]
    
    try:
        result = subprocess.run(cmd, capture_output=True, text=True, cwd="/workspaces/claude-code-flow/benchmark")
        if result.returncode == 0:
            print(f"✅ CLI execution successful")
            print(f"📊 Output: {result.stdout[:200]}...")
        else:
            print(f"❌ CLI execution failed: {result.stderr}")
    except Exception as e:
        print(f"⚠️  CLI execution error: {e}")
    
    # Example 2: Using Python API
    print("\n📋 Method 2: Python API")
    try:
        from swarm_benchmark import BenchmarkEngine
        
        # Initialize with real executor
        engine = BenchmarkEngine(use_real_executor=True)
        
        # Configure benchmark
        config = {
            "task": "Create a simple REST API",
            "strategy": "auto",
            "max_agents": 3,
            "coordination_mode": "hierarchical"
        }
        
        # Run benchmark
        result = engine.run_benchmark(**config)
        
        print(f"✅ Python API execution successful")
        print(f"📊 Result ID: {result.get('benchmark_id', 'unknown')}")
        print(f"🎯 Task completion: {result.get('status', 'unknown')}")
        
    except ImportError:
        print("⚠️  Swarm benchmark package not available, install with: pip install -e .")
    except Exception as e:
        print(f"❌ Python API error: {e}")

def demonstrate_metrics_collection():
    """Show how to collect and interpret metrics."""
    print("\n📊 Metrics Collection Example")
    print("=" * 30)
    
    # Example metrics structure
    sample_metrics = {
        "benchmark_id": "simple-swarm-demo",
        "execution_time": 45.2,
        "agents_used": 3,
        "tokens_consumed": 1250,
        "task_completion_rate": 100.0,
        "coordination_efficiency": 85.5,
        "memory_usage_mb": 128.4
    }
    
    print("Sample metrics structure:")
    print(json.dumps(sample_metrics, indent=2))
    
    # Save to file
    output_dir = Path("/workspaces/claude-code-flow/benchmark/examples/output")
    output_dir.mkdir(exist_ok=True)
    
    with open(output_dir / "simple_swarm_metrics.json", "w") as f:
        json.dump(sample_metrics, f, indent=2)
    
    print(f"📁 Metrics saved to: {output_dir / 'simple_swarm_metrics.json'}")

def show_best_practices():
    """Display best practices for swarm benchmarking."""
    print("\n💡 Best Practices")
    print("=" * 20)
    
    practices = [
        "Start with small agent counts (3-5) for testing",
        "Use 'auto' strategy to let the system choose optimal coordination",
        "Always collect metrics for performance analysis",
        "Use hierarchical coordination for complex tasks",
        "Monitor token consumption to optimize costs",
        "Test with real claude-flow integration for accurate results"
    ]
    
    for i, practice in enumerate(practices, 1):
        print(f"{i}. {practice}")

if __name__ == "__main__":
    run_swarm_benchmark()
    demonstrate_metrics_collection()
    show_best_practices()
    
    print("\n🎉 Simple Swarm Benchmark Complete!")
    print("Next steps:")
    print("- Try advanced examples in ../advanced/")
    print("- Run real benchmarks in ../real/")
    print("- Check CLI examples in ../cli/")