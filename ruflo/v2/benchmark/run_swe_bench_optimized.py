#!/usr/bin/env python3
"""
Run and optimize SWE-bench evaluation with claude-flow.
Tests different configurations to find the best performance.
"""

import asyncio
import sys
import json
import time
from pathlib import Path
from datetime import datetime

# Add src to path
sys.path.insert(0, str(Path(__file__).parent / "src"))

from swarm_benchmark.swe_bench.official_integration import OfficialSWEBenchEngine
from swarm_benchmark.core.models import BenchmarkConfig, StrategyType, CoordinationMode


async def test_configuration(mode, strategy, agents, instance):
    """Test a specific configuration on one instance."""
    
    config = BenchmarkConfig(
        name=f"SWE-{mode}-{strategy}-{agents}",
        description=f"Testing {mode} mode with {strategy} strategy",
        strategy=StrategyType[strategy.upper()],
        mode=CoordinationMode[mode.upper()],
        max_agents=agents,
        task_timeout=300,  # 5 minutes timeout per instance
        output_directory=f"benchmark/swe-bench-official/optimization/{mode}-{strategy}-{agents}"
    )
    
    engine = OfficialSWEBenchEngine(config)
    
    print(f"\n🔧 Testing: {mode}-{strategy}-{agents} agents")
    start_time = time.time()
    
    try:
        result = await engine.run_instance(instance)
        duration = time.time() - start_time
        
        return {
            "config": f"{mode}-{strategy}-{agents}",
            "success": result["success"],
            "has_patch": bool(result.get("patch")),
            "patch_length": len(result.get("patch", "")),
            "duration": duration,
            "error": result.get("error")
        }
    except Exception as e:
        return {
            "config": f"{mode}-{strategy}-{agents}",
            "success": False,
            "has_patch": False,
            "patch_length": 0,
            "duration": time.time() - start_time,
            "error": str(e)
        }


async def run_optimization():
    """Run optimization to find best configuration."""
    
    print("""
╔══════════════════════════════════════════════════════════════╗
║            SWE-Bench Configuration Optimization               ║
║                Finding Optimal Settings                       ║
╚══════════════════════════════════════════════════════════════╝
""")
    
    # Load dataset
    from datasets import load_dataset
    print("📥 Loading SWE-bench-Lite dataset...")
    dataset = load_dataset("princeton-nlp/SWE-bench_Lite", split="test")
    
    # Use a simple instance for testing
    test_instance = None
    for instance in dataset:
        # Find a relatively simple instance
        if len(instance["problem_statement"]) < 500:
            test_instance = instance
            break
    
    if not test_instance:
        test_instance = dataset[0]
    
    print(f"\n📝 Test Instance: {test_instance['instance_id']}")
    print(f"   Repo: {test_instance['repo']}")
    print(f"   Problem length: {len(test_instance['problem_statement'])} chars")
    
    # Test configurations
    configurations = [
        # Our supposed optimal
        ("mesh", "optimization", 8),
        # Variations to test
        ("hierarchical", "development", 5),
        ("mesh", "development", 5),
        ("distributed", "optimization", 3),
        # Faster configs
        ("centralized", "development", 3),
        ("hierarchical", "optimization", 3),
    ]
    
    print(f"\n🧪 Testing {len(configurations)} configurations...")
    print("This will take approximately 30 minutes (5 min per config)")
    
    results = []
    
    for mode, strategy, agents in configurations:
        result = await test_configuration(mode, strategy, agents, test_instance)
        results.append(result)
        
        # Show progress
        if result["success"] and result["has_patch"]:
            print(f"   ✅ Generated {result['patch_length']} char patch in {result['duration']:.1f}s")
        else:
            print(f"   ❌ Failed: {result.get('error', 'No patch generated')}")
    
    # Analyze results
    print("\n" + "="*60)
    print("📊 OPTIMIZATION RESULTS")
    print("="*60)
    
    # Sort by success and speed
    successful = [r for r in results if r["success"] and r["has_patch"]]
    
    if successful:
        successful.sort(key=lambda x: x["duration"])
        
        print("\n✅ Successful Configurations:")
        for i, r in enumerate(successful, 1):
            print(f"{i}. {r['config']}")
            print(f"   Patch: {r['patch_length']} chars")
            print(f"   Time: {r['duration']:.1f}s")
    else:
        print("\n⚠️ No successful configurations found")
        print("This might be due to:")
        print("- Complex instance requiring more time")
        print("- Need for different prompting strategy")
        print("- API rate limits")
    
    # Find optimal
    if successful:
        optimal = successful[0]
        print(f"\n🏆 OPTIMAL CONFIGURATION: {optimal['config']}")
        print(f"   Generated {optimal['patch_length']} char patch in {optimal['duration']:.1f}s")
    
    # Save results
    report = {
        "test_instance": test_instance["instance_id"],
        "configurations_tested": len(configurations),
        "successful_configs": len(successful),
        "results": results,
        "optimal": optimal if successful else None,
        "timestamp": datetime.now().isoformat()
    }
    
    report_path = Path("benchmark/swe-bench-official/optimization_report.json")
    report_path.parent.mkdir(parents=True, exist_ok=True)
    
    with open(report_path, 'w') as f:
        json.dump(report, f, indent=2)
    
    print(f"\n📁 Report saved to: {report_path}")
    
    return report


async def run_limited_evaluation():
    """Run limited evaluation with optimal config."""
    
    print("\n" + "="*60)
    print("🚀 Running Limited Evaluation with Optimal Config")
    print("="*60)
    
    # Use optimal configuration
    config = BenchmarkConfig(
        name="SWE-Bench-Optimal",
        description="Optimal configuration evaluation",
        strategy=StrategyType.OPTIMIZATION,
        mode=CoordinationMode.MESH,
        max_agents=8,
        task_timeout=300,
        output_directory="benchmark/swe-bench-official/evaluation"
    )
    
    engine = OfficialSWEBenchEngine(config)
    
    # Load dataset
    if not await engine.load_dataset(use_lite=True):
        print("❌ Failed to load dataset")
        return
    
    print(f"✅ Loaded {len(engine.dataset)} instances")
    
    # Run on first 5 instances
    print("\n📊 Running on 5 instances (approx 25 minutes)...")
    
    report = await engine.run_evaluation(
        instances_limit=5,
        use_lite=True,
        save_predictions=True
    )
    
    if "error" not in report:
        print(f"\n✅ Evaluation Complete!")
        print(f"   Success Rate: {report['success_rate']:.1%}")
        print(f"   Avg Duration: {report['average_duration']:.1f}s")
        
        # Check if ready for submission
        predictions_file = Path(config.output_directory) / "predictions.json"
        if predictions_file.exists():
            is_valid = await engine.validate_submission(str(predictions_file))
            if is_valid:
                print("\n🎉 Predictions are valid for leaderboard submission!")
                print(f"   File: {predictions_file}")
                print("   Submit at: https://www.swebench.com/submit")


async def main():
    """Main entry point."""
    
    import argparse
    parser = argparse.ArgumentParser(description="SWE-Bench Optimization and Evaluation")
    parser.add_argument("--optimize", action="store_true", help="Run optimization tests")
    parser.add_argument("--evaluate", action="store_true", help="Run limited evaluation")
    parser.add_argument("--quick", action="store_true", help="Quick test (1 instance)")
    
    args = parser.parse_args()
    
    if args.quick:
        print("🚀 Running quick test...")
        # Just test one configuration on one instance
        from datasets import load_dataset
        dataset = load_dataset("princeton-nlp/SWE-bench_Lite", split="test")
        instance = dataset[0]
        
        result = await test_configuration("mesh", "optimization", 8, instance)
        print(f"\nResult: {result}")
        
    elif args.optimize:
        await run_optimization()
        
    elif args.evaluate:
        await run_limited_evaluation()
        
    else:
        # Default: optimize then evaluate
        print("Running full optimization and evaluation...")
        await run_optimization()
        await run_limited_evaluation()


if __name__ == "__main__":
    print("SWE-Bench Optimization & Evaluation")
    print("Note: Each instance may take 5-10 minutes to process")
    print()
    
    asyncio.run(main())