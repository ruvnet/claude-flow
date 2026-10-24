#!/usr/bin/env python3
"""
Quick test script for multi-mode SWE-bench benchmarking.
Tests a few modes on 1 instance to verify everything works.
"""

import asyncio
import sys
import json
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent))

from src.swarm_benchmark.swe_bench.multi_mode_engine import MultiModeSWEBenchEngine, ClaudeFlowMode
from src.swarm_benchmark.core.models import BenchmarkConfig

async def run_quick_test():
    """Run a quick test with 2 modes on 1 instance."""
    
    print("=" * 60)
    print("SWE-bench Multi-Mode Quick Test")
    print("=" * 60)
    
    # Create config
    config = BenchmarkConfig(
        name='Quick-Test',
        description='Quick multi-mode test',
        output_directory='benchmark/swe-bench-test/results',
        task_timeout=60  # Short timeout for testing
    )
    
    # Initialize engine
    engine = MultiModeSWEBenchEngine(config)
    
    # Define quick test modes (just 2 for speed)
    test_modes = [
        ClaudeFlowMode(
            "hive-mind", 
            agents=2,
            description="Quick hive-mind test"
        ),
        ClaudeFlowMode(
            "swarm",
            strategy="auto",
            mode="centralized", 
            agents=2,
            description="Quick swarm test"
        ),
    ]
    
    print(f"\nTesting {len(test_modes)} modes on 1 SWE-bench instance")
    print("This should take about 2-3 minutes...\n")
    
    try:
        # Run the benchmark
        results = await engine.benchmark_all_modes(
            instances_limit=1,
            modes_to_test=test_modes
        )
        
        if "error" in results:
            print(f"\n❌ Test failed: {results['error']}")
            return False
            
        # Display results
        print("\n" + "=" * 60)
        print("TEST RESULTS")
        print("=" * 60)
        
        print(f"\n✅ Test completed successfully!")
        print(f"   Modes tested: {results['modes_tested']}")
        print(f"   Total tests: {results['total_tests']}")
        
        if results.get('best_mode'):
            print(f"\n🏆 Best Mode: {results['best_mode']}")
            best = results['best_performance']
            print(f"   Success Rate: {best['success_rate']:.1%}")
            print(f"   Avg Duration: {best['avg_duration']:.1f}s")
            print(f"   Description: {best['description']}")
        
        # Save results
        output_dir = Path(config.output_directory)
        output_dir.mkdir(parents=True, exist_ok=True)
        
        report_file = output_dir / "quick_test_results.json"
        with open(report_file, 'w') as f:
            json.dump(results, f, indent=2)
        
        print(f"\n📁 Full report saved to: {report_file}")
        
        # Post to GitHub issue
        print("\nPosting results to GitHub issue #611...")
        post_results_to_issue(results)
        
        return True
        
    except Exception as e:
        print(f"\n❌ Test error: {e}")
        import traceback
        traceback.print_exc()
        return False

def post_results_to_issue(results):
    """Post test results to GitHub issue."""
    import subprocess
    
    comment = f"""## Quick Test Results

✅ Multi-mode engine test completed successfully!

**Configuration:**
- Modes tested: {results['modes_tested']}
- Instances: {results['instances_tested']}
- Total tests: {results['total_tests']}

**Best Mode:** {results.get('best_mode', 'N/A')}
"""
    
    if results.get('best_performance'):
        best = results['best_performance']
        comment += f"""- Success Rate: {best['success_rate']:.1%}
- Avg Duration: {best['avg_duration']:.1f}s
- Description: {best['description']}
"""
    
    comment += "\n\nReady for full benchmark run with all 22+ modes!"
    
    try:
        subprocess.run([
            "gh", "issue", "comment", "611",
            "--repo", "ruvnet/claude-flow",
            "--body", comment
        ], check=True)
        print("✅ Posted results to GitHub issue #611")
    except Exception as e:
        print(f"⚠️ Could not post to GitHub: {e}")

if __name__ == "__main__":
    print("\n🚀 Starting SWE-bench Multi-Mode Quick Test\n")
    
    # Check if claude-flow executable exists
    claude_flow_path = Path('./claude-flow')
    if not claude_flow_path.exists():
        claude_flow_path = Path('../claude-flow')
        
    if not claude_flow_path.exists():
        print("❌ Error: claude-flow executable not found!")
        print("Please ensure claude-flow is built and available")
        sys.exit(1)
    
    print(f"✅ Found claude-flow at: {claude_flow_path.absolute()}")
    
    # Run the test
    success = asyncio.run(run_quick_test())
    
    if success:
        print("\n✅ All tests passed! Ready for full benchmark.")
        print("\nNext steps:")
        print("1. Run full test: python -m benchmark.src.swarm_benchmark.cli.main swe-bench multi-mode --instances 5")
        print("2. Generate submission: python -m benchmark.src.swarm_benchmark.cli.main swe-bench official --lite")
    else:
        print("\n❌ Tests failed. Please check the errors above.")
        sys.exit(1)