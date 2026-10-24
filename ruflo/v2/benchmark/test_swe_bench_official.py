#!/usr/bin/env python3
"""
Test script for official SWE-bench integration
"""

import asyncio
import sys
from pathlib import Path

# Add src to path
sys.path.insert(0, str(Path(__file__).parent / "src"))

from swarm_benchmark.swe_bench.official_integration import OfficialSWEBenchEngine
from swarm_benchmark.core.models import BenchmarkConfig, StrategyType, CoordinationMode


async def test_official_integration():
    """Test the official SWE-bench integration."""
    
    print("""
╔══════════════════════════════════════════════════════════════╗
║         Testing Official SWE-bench Integration                ║
╚══════════════════════════════════════════════════════════════╝
""")
    
    # Create optimal configuration
    config = BenchmarkConfig(
        name="SWE-bench-Test",
        description="Testing official integration",
        strategy=StrategyType.OPTIMIZATION,
        mode=CoordinationMode.MESH,
        max_agents=8,
        task_timeout=60,  # 1 minute for testing
        output_directory="benchmark/swe-bench-official/test-results"
    )
    
    # Initialize engine
    engine = OfficialSWEBenchEngine(config)
    
    # Test 1: Load dataset
    print("\n1️⃣ Testing dataset loading...")
    success = await engine.load_dataset(use_lite=True)
    
    if not success:
        print("❌ Failed to load dataset")
        print("\nInstalling required packages...")
        import subprocess
        subprocess.run(["pip", "install", "datasets", "swebench"], check=True)
        success = await engine.load_dataset(use_lite=True)
        
    if success:
        print(f"✅ Dataset loaded: {len(engine.dataset)} instances")
    else:
        print("❌ Could not load dataset. Please check your connection.")
        return
        
    # Test 2: Run on single instance
    print("\n2️⃣ Testing single instance execution...")
    
    if engine.dataset:
        first_instance = engine.dataset[0]
        print(f"   Instance: {first_instance['instance_id']}")
        print(f"   Repo: {first_instance['repo']}")
        
        result = await engine.run_instance(first_instance)
        
        if result['success']:
            print(f"✅ Generated patch in {result['duration']:.1f}s")
            if result['patch']:
                print(f"   Patch length: {len(result['patch'])} chars")
        else:
            print(f"⚠️ No patch generated: {result['error']}")
            
    # Test 3: Run mini evaluation
    print("\n3️⃣ Running mini evaluation (3 instances)...")
    
    report = await engine.run_evaluation(
        instances_limit=3,
        use_lite=True,
        save_predictions=True
    )
    
    if "error" not in report:
        print(f"✅ Mini evaluation complete!")
        print(f"   Success rate: {report['success_rate']:.1%}")
        print(f"   Avg duration: {report['average_duration']:.1f}s")
        
        # Test 4: Validate submission format
        print("\n4️⃣ Testing submission validation...")
        
        predictions_file = Path(config.output_directory) / "predictions.json"
        if predictions_file.exists():
            is_valid = await engine.validate_submission(str(predictions_file))
            if is_valid:
                print("✅ Submission format is valid!")
            else:
                print("❌ Submission format has issues")
        else:
            print("⚠️ No predictions file generated")
            
    print("\n" + "="*60)
    print("✅ Integration test complete!")
    print("="*60)
    print("\nTo run full evaluation:")
    print("  swarm-bench swe-bench official --limit 10")
    print("\nTo run on all 300 SWE-bench-Lite instances:")
    print("  swarm-bench swe-bench official")


if __name__ == "__main__":
    asyncio.run(test_official_integration())