"""
Swarm Benchmark - Agent swarm benchmarking tool for Claude Flow.

This package provides comprehensive benchmarking capabilities for agent swarms,
supporting various strategies and coordination modes.
"""

__version__ = "1.0.0"
__author__ = "Claude Flow Team"
__email__ = "support@claude-flow.dev"

from .core.models import Task, Agent, Result, Benchmark
from .core.benchmark_engine import BenchmarkEngine

__all__ = [
    "Task",
    "Agent", 
    "Result",
    "Benchmark",
    "BenchmarkEngine",
    "__version__",
]