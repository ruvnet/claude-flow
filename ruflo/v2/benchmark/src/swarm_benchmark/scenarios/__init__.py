"""
Benchmark scenarios package for executing real Claude Flow commands.
"""

from .real_benchmarks import RealSwarmBenchmark, RealHiveMindBenchmark, RealSparcBenchmark

__all__ = [
    'RealSwarmBenchmark',
    'RealHiveMindBenchmark', 
    'RealSparcBenchmark'
]