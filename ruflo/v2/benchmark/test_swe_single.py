#!/usr/bin/env python3
"""
Test SWE-bench with a single instance to debug
"""

import asyncio
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent / "src"))

from swarm_benchmark.swe_bench.official_integration import OfficialSWEBenchEngine
from swarm_benchmark.core.models import BenchmarkConfig, StrategyType, CoordinationMode


async def test_single():
    """Test a single SWE-bench instance."""
    
    print("Testing single SWE-bench instance...")
    
    config = BenchmarkConfig(
        name="SWE-Test",
        description="Testing",
        strategy=StrategyType.OPTIMIZATION,
        mode=CoordinationMode.MESH,
        max_agents=8,
        task_timeout=120,  # 2 minutes for testing
        output_directory="benchmark/swe-bench-official/test"
    )
    
    engine = OfficialSWEBenchEngine(config)
    
    # Load dataset
    print("Loading dataset...")
    if not await engine.load_dataset(use_lite=True):
        print("Failed to load dataset")
        return
    
    # Get first instance
    instance = engine.dataset[0]
    print(f"\nTesting: {instance['instance_id']}")
    print(f"Repo: {instance['repo']}")
    
    # Run it
    result = await engine.run_instance(instance)
    
    print(f"\nResult:")
    print(f"  Success: {result['success']}")
    print(f"  Duration: {result['duration']:.1f}s")
    print(f"  Patch length: {len(result.get('patch', ''))} chars")
    print(f"  Error: {result.get('error')}")
    
    if result.get('patch'):
        print(f"\nPatch preview:")
        print(result['patch'][:500])


if __name__ == "__main__":
    asyncio.run(test_single())