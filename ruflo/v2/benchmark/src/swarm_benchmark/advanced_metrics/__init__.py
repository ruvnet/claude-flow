"""
Advanced Metrics Collection Module

This module provides comprehensive performance metrics collection and optimization
for Claude Flow swarm benchmarking systems.

Features:
- Token usage optimization tracking
- Memory persistence profiling
- Neural processing benchmarks
- Real-time metric aggregation
- Performance analysis and optimization suggestions
"""

from .token_optimizer import TokenOptimizationTracker, TokenMetrics, OptimizationPlan
from .memory_profiler import MemoryPersistenceProfiler, MemoryProfile, MemorySnapshot
from .neural_benchmarks import NeuralProcessingBenchmark, NeuralBenchmarkResult, CognitivePattern
from .metric_aggregator import MetricAggregator as MetricAggregatorClass, MetricDefinition, MetricPoint
from .performance_analyzer import PerformanceAnalyzer, PerformanceAnalysis, BottleneckIdentification

# Export with cleaner names
MetricAggregator = MetricAggregatorClass

__all__ = [
    # Token optimization
    'TokenOptimizationTracker',
    'TokenMetrics', 
    'OptimizationPlan',
    
    # Memory profiling
    'MemoryPersistenceProfiler',
    'MemoryProfile',
    'MemorySnapshot',
    
    # Neural benchmarking
    'NeuralProcessingBenchmark',
    'NeuralBenchmarkResult',
    'CognitivePattern',
    
    # Metric aggregation
    'MetricAggregator',
    'MetricDefinition',
    'MetricPoint',
    
    # Performance analysis
    'PerformanceAnalyzer',
    'PerformanceAnalysis',
    'BottleneckIdentification'
]

__version__ = '1.0.0'