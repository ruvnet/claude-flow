"""SWE-Bench integration for Claude Flow benchmarking."""

from .engine import SWEBenchEngine
from .evaluator import SWEBenchEvaluator
from .datasets import SWEBenchDataset
from .optimizer import SWEBenchOptimizer
from .metrics import SWEBenchMetrics

__all__ = [
    'SWEBenchEngine',
    'SWEBenchEvaluator', 
    'SWEBenchDataset',
    'SWEBenchOptimizer',
    'SWEBenchMetrics'
]

__version__ = "1.0.0"