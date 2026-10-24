"""
CLAUDE.md Optimizer Module

This module provides intelligent optimization of CLAUDE.md configurations
for different development use cases and performance targets.
"""

from .optimizer import ClaudeMdOptimizer, ProjectContext, PerformanceTargets, BenchmarkMetrics
from .templates import TemplateEngine
from .rules_engine import OptimizationRulesEngine, OptimizationRule

__all__ = [
    "ClaudeMdOptimizer",
    "ProjectContext", 
    "PerformanceTargets",
    "BenchmarkMetrics",
    "TemplateEngine", 
    "OptimizationRulesEngine",
    "OptimizationRule"
]

__version__ = "1.0.0"