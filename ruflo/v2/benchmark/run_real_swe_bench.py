#!/usr/bin/env python3
"""
Run REAL SWE-bench evaluation with actual claude-flow commands.
This generates actual code fixes for real GitHub issues.
"""

import asyncio
import sys
import json
from pathlib import Path

# Add src to path
sys.path.insert(0, str(Path(__file__).parent / "src"))

from swarm_benchmark.swe_bench.official_integration import OfficialSWEBenchEngine
from swarm_benchmark.core.models import BenchmarkConfig, StrategyType, CoordinationMode


async def run_real_swe_bench():
    """Run real SWE-bench with actual claude-flow execution."""
    
    print("""
╔══════════════════════════════════════════════════════════════╗
║            REAL SWE-Bench Evaluation                          ║
║         Using Claude Flow to Generate Actual Fixes            ║
╚══════════════════════════════════════════════════════════════╝
""")
    
    # Use the optimal configuration we found
    config = BenchmarkConfig(
        name="Real-SWE-bench",
        description="Real SWE-bench evaluation with code generation",
        strategy=StrategyType.OPTIMIZATION,  # Best for bug fixes
        mode=CoordinationMode.MESH,  # Best performance
        max_agents=8,  # Optimal agent count
        task_timeout=180,  # 3 minutes per instance
        output_directory="benchmark/swe-bench-official/real-results"
    )
    
    print(f"Configuration:")
    print(f"  Mode: {config.mode.value}")
    print(f"  Strategy: {config.strategy.value}")
    print(f"  Agents: {config.max_agents}")
    print(f"  Timeout: {config.task_timeout}s per instance")
    print()
    
    # Initialize engine
    engine = OfficialSWEBenchEngine(config)
    
    # Load dataset
    print("📥 Loading SWE-bench-Lite dataset...")
    if not await engine.load_dataset(use_lite=True):
        print("❌ Failed to load dataset")
        return
        
    print(f"✅ Loaded {len(engine.dataset)} instances")
    
    # Select a few specific instances to test
    # These are real GitHub issues that need fixing
    test_instances = [
        # Start with simpler instances
        "django__django-11099",  # Django issue
        "sympy__sympy-13437",    # SymPy math library
        "matplotlib__matplotlib-23299",  # Matplotlib plotting
    ]
    
    print(f"\n🔧 Testing on {len(test_instances)} selected instances:")
    for inst_id in test_instances:
        print(f"  - {inst_id}")
    
    # Filter dataset to our test instances
    selected = []
    for instance in engine.dataset:
        if instance["instance_id"] in test_instances:
            selected.append(instance)
            if len(selected) == len(test_instances):
                break
    
    if not selected:
        # If specific instances not found, just use first 3
        selected = list(engine.dataset)[:3]
        print("\n⚠️ Using first 3 instances instead")
    
    print("\n" + "="*60)
    print("Starting Real Evaluation")
    print("="*60)
    
    results = []
    for i, instance in enumerate(selected, 1):
        print(f"\n📝 [{i}/{len(selected)}] Processing: {instance['instance_id']}")
        print(f"   Repository: {instance['repo']}")
        print(f"   Problem: {instance['problem_statement'][:100]}...")
        
        # Run claude-flow to generate fix
        result = await engine.run_instance(instance)
        results.append(result)
        
        if result["success"] and result["patch"]:
            print(f"   ✅ Generated patch ({len(result['patch'])} chars)")
            print(f"   ⏱️ Duration: {result['duration']:.1f}s")
            
            # Show first few lines of patch
            patch_lines = result['patch'].split('\n')[:5]
            for line in patch_lines:
                print(f"      {line}")
            if len(result['patch'].split('\n')) > 5:
                print(f"      ... ({len(result['patch'].split('\n'))} total lines)")
        else:
            print(f"   ❌ Failed: {result.get('error', 'No patch generated')}")
    
    # Calculate metrics
    successful = sum(1 for r in results if r["success"])
    total = len(results)
    success_rate = successful / total if total > 0 else 0
    avg_duration = sum(r["duration"] for r in results) / total if total > 0 else 0
    
    print("\n" + "="*60)
    print("📊 RESULTS")
    print("="*60)
    print(f"Success Rate: {success_rate:.1%} ({successful}/{total})")
    print(f"Average Duration: {avg_duration:.1f}s")
    
    # Save predictions
    if engine.predictions:
        predictions_file = Path(config.output_directory) / "predictions.json"
        predictions_file.parent.mkdir(parents=True, exist_ok=True)
        
        with open(predictions_file, 'w') as f:
            json.dump(engine.predictions, f, indent=2)
        
        print(f"\n💾 Predictions saved to: {predictions_file}")
        
        # Validate format
        is_valid = await engine.validate_submission(str(predictions_file))
        if is_valid:
            print("✅ Submission format is valid for leaderboard!")
        else:
            print("⚠️ Submission format needs adjustment")
    
    # Show next steps
    print("\n📋 Next Steps:")
    print("1. Review generated patches in predictions.json")
    print("2. Run full evaluation: swarm-bench swe-bench official")
    print("3. Submit to leaderboard: https://www.swebench.com/submit")
    
    # Save detailed report
    report = {
        "config": {
            "mode": config.mode.value,
            "strategy": config.strategy.value,
            "agents": config.max_agents
        },
        "results": results,
        "metrics": {
            "success_rate": success_rate,
            "avg_duration": avg_duration,
            "successful": successful,
            "total": total
        }
    }
    
    report_file = Path(config.output_directory) / "evaluation_report.json"
    with open(report_file, 'w') as f:
        json.dump(report, f, indent=2)
    
    print(f"\n📁 Detailed report: {report_file}")


if __name__ == "__main__":
    print("🚀 Starting Real SWE-bench Evaluation")
    print("This will use claude-flow to generate actual code fixes")
    print()
    
    asyncio.run(run_real_swe_bench())