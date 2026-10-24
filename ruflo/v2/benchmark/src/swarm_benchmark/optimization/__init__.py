"""
Optimization module for swarm benchmark performance enhancements.

This module provides real optimization capabilities including:
- Parallel execution optimization
- Caching mechanisms
- Resource pooling
- Batch processing
- Connection pooling
"""

from .engine import (
    OptimizedBenchmarkEngine,
    OptimizedExecutor,
    CircularBuffer,
    TTLMap,
    AsyncFileManager
)

__all__ = [
    "OptimizedBenchmarkEngine",
    "OptimizedExecutor", 
    "CircularBuffer",
    "TTLMap",
    "AsyncFileManager"
]