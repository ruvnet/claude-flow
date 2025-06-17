"""Simple test to check if the benchmark engine works."""

import asyncio
from swarm_benchmark.core.benchmark_engine import BenchmarkEngine
from swarm_benchmark.core.models import BenchmarkConfig, StrategyType

async def test_simple_benchmark():
    """Test a simple benchmark run."""
    config = BenchmarkConfig(
        name="Simple Test",
        strategy=StrategyType.AUTO,
        output_formats=["json"],
        output_directory="./test_output"
    )
    
    engine = BenchmarkEngine(config)
    
    try:
        result = await engine.run_benchmark("Build a simple REST API")
        print("Benchmark result:", result)
        return result
    except Exception as e:
        print(f"Error: {e}")
        import traceback
        traceback.print_exc()
        return None

if __name__ == "__main__":
    result = asyncio.run(test_simple_benchmark())
    print("Final result:", result)