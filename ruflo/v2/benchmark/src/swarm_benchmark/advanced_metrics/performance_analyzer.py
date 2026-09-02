"""
Performance Analyzer

Comprehensive performance analysis and optimization system for Claude Flow swarm benchmarks.
Provides advanced analytics, bottleneck identification, optimization recommendations,
and performance trend analysis.
"""

import asyncio
import time
import json
import logging
import statistics
import numpy as np
from typing import Dict, List, Optional, Any, Tuple, Union
from dataclasses import dataclass, asdict, field
from collections import defaultdict, deque
from datetime import datetime, timedelta
from enum import Enum
import concurrent.futures
import threading

logger = logging.getLogger(__name__)


class PerformanceCategory(Enum):
    """Categories of performance analysis."""
    THROUGHPUT = "throughput"
    LATENCY = "latency"
    RESOURCE_UTILIZATION = "resource_utilization"
    SCALABILITY = "scalability"
    RELIABILITY = "reliability"
    EFFICIENCY = "efficiency"


@dataclass
class PerformanceMetric:
    """Individual performance metric with context."""
    
    name: str
    value: float
    unit: str
    category: PerformanceCategory
    timestamp: float
    context: Dict[str, Any] = field(default_factory=dict)
    baseline: Optional[float] = None
    target: Optional[float] = None
    

@dataclass
class PerformanceAnalysis:
    """Results of performance analysis."""
    
    analysis_id: str
    timestamp: float
    duration_seconds: float
    metrics: Dict[str, PerformanceMetric]
    bottlenecks: List[Dict[str, Any]]
    optimization_opportunities: List[Dict[str, Any]]
    performance_score: float
    trends: Dict[str, Any]
    recommendations: List[str]
    comparative_analysis: Optional[Dict] = None


@dataclass
class BottleneckIdentification:
    """Identified performance bottleneck."""
    
    component: str
    type: str  # 'cpu', 'memory', 'network', 'algorithm', 'coordination'
    severity: float  # 0.0 - 1.0
    impact_percent: float
    description: str
    evidence: Dict[str, Any]
    suggested_solutions: List[str]


@dataclass
class OptimizationOpportunity:
    """Performance optimization opportunity."""
    
    area: str
    type: str  # 'algorithmic', 'resource', 'architectural', 'configuration'
    potential_improvement_percent: float
    implementation_effort: str  # 'low', 'medium', 'high'
    confidence: float  # 0.0 - 1.0
    description: str
    implementation_steps: List[str]
    expected_roi: float


class BottleneckDetector:
    """Detect performance bottlenecks in swarm operations."""
    
    def __init__(self, config: Optional[Dict] = None):
        self.config = config or {}
        self.bottleneck_thresholds = {
            'cpu_utilization': 80.0,
            'memory_utilization': 85.0,
            'network_saturation': 90.0,
            'latency_p95': 1000.0,  # ms
            'error_rate': 5.0,  # percent
            'queue_depth': 100
        }
        self.bottleneck_patterns = self._initialize_bottleneck_patterns()
        
    def detect_bottlenecks(self, metrics: Dict[str, PerformanceMetric],
                          historical_data: Optional[Dict] = None) -> List[BottleneckIdentification]:
        """Detect bottlenecks from performance metrics."""
        bottlenecks = []
        
        # Resource utilization bottlenecks
        resource_bottlenecks = self._detect_resource_bottlenecks(metrics)
        bottlenecks.extend(resource_bottlenecks)
        
        # Algorithmic bottlenecks
        algo_bottlenecks = self._detect_algorithmic_bottlenecks(metrics, historical_data)
        bottlenecks.extend(algo_bottlenecks)
        
        # Coordination bottlenecks
        coord_bottlenecks = self._detect_coordination_bottlenecks(metrics)
        bottlenecks.extend(coord_bottlenecks)
        
        # Network bottlenecks
        network_bottlenecks = self._detect_network_bottlenecks(metrics)
        bottlenecks.extend(network_bottlenecks)
        
        # Sort by severity
        bottlenecks.sort(key=lambda x: x.severity, reverse=True)
        
        return bottlenecks
    
    def _detect_resource_bottlenecks(self, metrics: Dict[str, PerformanceMetric]) -> List[BottleneckIdentification]:
        """Detect resource-related bottlenecks."""
        bottlenecks = []
        
        # CPU bottleneck
        cpu_metric = metrics.get('cpu_usage')
        if cpu_metric and cpu_metric.value > self.bottleneck_thresholds['cpu_utilization']:
            severity = min(1.0, cpu_metric.value / 100.0)
            impact = (cpu_metric.value - self.bottleneck_thresholds['cpu_utilization']) / 20.0
            
            bottlenecks.append(BottleneckIdentification(
                component='cpu',
                type='cpu',
                severity=severity,
                impact_percent=impact,
                description=f'High CPU utilization: {cpu_metric.value:.1f}%',
                evidence={'cpu_usage': cpu_metric.value},
                suggested_solutions=[
                    'Optimize CPU-intensive operations',
                    'Increase parallelization',
                    'Consider algorithmic improvements',
                    'Scale horizontally if possible'
                ]
            ))
        
        # Memory bottleneck
        memory_metric = metrics.get('memory_usage')
        if memory_metric and memory_metric.value > self.bottleneck_thresholds['memory_utilization']:
            severity = min(1.0, memory_metric.value / 100.0)
            impact = (memory_metric.value - self.bottleneck_thresholds['memory_utilization']) / 15.0
            
            bottlenecks.append(BottleneckIdentification(
                component='memory',
                type='memory',
                severity=severity,
                impact_percent=impact,
                description=f'High memory utilization: {memory_metric.value:.1f}%',
                evidence={'memory_usage': memory_metric.value},
                suggested_solutions=[
                    'Implement memory pooling',
                    'Optimize data structures',
                    'Add garbage collection tuning',
                    'Increase available memory'
                ]
            ))
        
        return bottlenecks
    
    def _detect_algorithmic_bottlenecks(self, metrics: Dict[str, PerformanceMetric],
                                       historical_data: Optional[Dict]) -> List[BottleneckIdentification]:
        """Detect algorithmic performance bottlenecks."""
        bottlenecks = []
        
        # High latency bottleneck
        latency_metric = metrics.get('swarm_latency')
        if latency_metric and latency_metric.value > self.bottleneck_thresholds['latency_p95']:
            severity = min(1.0, latency_metric.value / 2000.0)
            impact = (latency_metric.value - self.bottleneck_thresholds['latency_p95']) / 1000.0
            
            bottlenecks.append(BottleneckIdentification(
                component='algorithm',
                type='algorithm',
                severity=severity,
                impact_percent=impact,
                description=f'High operation latency: {latency_metric.value:.1f}ms',
                evidence={'latency_ms': latency_metric.value},
                suggested_solutions=[
                    'Optimize critical path algorithms',
                    'Implement caching strategies',
                    'Reduce synchronous operations',
                    'Optimize data access patterns'
                ]
            ))
        
        # Low throughput bottleneck
        throughput_metric = metrics.get('swarm_throughput')
        if throughput_metric and throughput_metric.baseline:
            throughput_ratio = throughput_metric.value / throughput_metric.baseline
            if throughput_ratio < 0.7:  # 30% below baseline
                severity = 1.0 - throughput_ratio
                impact = (1.0 - throughput_ratio) * 100
                
                bottlenecks.append(BottleneckIdentification(
                    component='algorithm',
                    type='algorithm',
                    severity=severity,
                    impact_percent=impact,
                    description=f'Low throughput: {throughput_metric.value:.1f} ops/s (baseline: {throughput_metric.baseline:.1f})',
                    evidence={'current_throughput': throughput_metric.value, 'baseline_throughput': throughput_metric.baseline},
                    suggested_solutions=[
                        'Optimize processing pipelines',
                        'Increase parallelization',
                        'Reduce serialization bottlenecks',
                        'Optimize resource utilization'
                    ]
                ))
        
        return bottlenecks
    
    def _detect_coordination_bottlenecks(self, metrics: Dict[str, PerformanceMetric]) -> List[BottleneckIdentification]:
        """Detect swarm coordination bottlenecks."""
        bottlenecks = []
        
        # Agent coordination delays
        agent_spawn_time = metrics.get('agent_spawn_time')
        if agent_spawn_time and agent_spawn_time.value > 5000:  # 5 seconds
            severity = min(1.0, agent_spawn_time.value / 10000.0)
            impact = (agent_spawn_time.value - 5000) / 1000.0
            
            bottlenecks.append(BottleneckIdentification(
                component='coordination',
                type='coordination',
                severity=severity,
                impact_percent=impact,
                description=f'Slow agent spawning: {agent_spawn_time.value:.1f}ms',
                evidence={'spawn_time_ms': agent_spawn_time.value},
                suggested_solutions=[
                    'Optimize agent initialization',
                    'Implement agent pooling',
                    'Reduce coordination overhead',
                    'Parallelize agent spawning'
                ]
            ))
        
        # High error rates indicate coordination issues
        error_rate = metrics.get('swarm_error_rate')
        if error_rate and error_rate.value > self.bottleneck_thresholds['error_rate']:
            severity = min(1.0, error_rate.value / 20.0)
            impact = error_rate.value * 2  # Errors have high impact
            
            bottlenecks.append(BottleneckIdentification(
                component='coordination',
                type='coordination',
                severity=severity,
                impact_percent=impact,
                description=f'High error rate: {error_rate.value:.1f}%',
                evidence={'error_rate_percent': error_rate.value},
                suggested_solutions=[
                    'Improve error handling',
                    'Add retry mechanisms',
                    'Enhance agent communication',
                    'Implement circuit breakers'
                ]
            ))
        
        return bottlenecks
    
    def _detect_network_bottlenecks(self, metrics: Dict[str, PerformanceMetric]) -> List[BottleneckIdentification]:
        """Detect network-related bottlenecks."""
        bottlenecks = []
        
        # Network I/O saturation
        network_io = metrics.get('network_io')
        if network_io and network_io.value > self.bottleneck_thresholds['network_saturation']:
            severity = min(1.0, network_io.value / 100.0)
            impact = (network_io.value - self.bottleneck_thresholds['network_saturation']) / 10.0
            
            bottlenecks.append(BottleneckIdentification(
                component='network',
                type='network',
                severity=severity,
                impact_percent=impact,
                description=f'High network utilization: {network_io.value:.1f}%',
                evidence={'network_utilization': network_io.value},
                suggested_solutions=[
                    'Optimize data serialization',
                    'Implement compression',
                    'Batch network operations',
                    'Use connection pooling'
                ]
            ))
        
        return bottlenecks
    
    def _initialize_bottleneck_patterns(self) -> Dict[str, Any]:
        """Initialize patterns for bottleneck detection."""
        return {
            'resource_exhaustion': {
                'cpu_memory_correlation': 0.8,
                'sustained_high_usage': 30.0  # seconds
            },
            'coordination_delays': {
                'agent_spawn_variance': 2.0,
                'message_queue_buildup': 50
            },
            'algorithmic_inefficiency': {
                'latency_growth_rate': 1.5,
                'throughput_degradation': 0.3
            }
        }


class OptimizationEngine:
    """Generate performance optimization recommendations."""
    
    def __init__(self):
        self.optimization_strategies = {
            'algorithmic': self._generate_algorithmic_optimizations,
            'resource': self._generate_resource_optimizations,
            'architectural': self._generate_architectural_optimizations,
            'configuration': self._generate_configuration_optimizations
        }
        
        self.optimization_templates = self._load_optimization_templates()
    
    def generate_optimizations(self, metrics: Dict[str, PerformanceMetric],
                              bottlenecks: List[BottleneckIdentification],
                              context: Dict[str, Any]) -> List[OptimizationOpportunity]:
        """Generate optimization opportunities based on analysis."""
        optimizations = []
        
        for strategy_name, strategy_func in self.optimization_strategies.items():
            strategy_optimizations = strategy_func(metrics, bottlenecks, context)
            optimizations.extend(strategy_optimizations)
        
        # Remove duplicates and sort by potential impact
        optimizations = self._deduplicate_optimizations(optimizations)
        optimizations.sort(key=lambda x: x.potential_improvement_percent * x.confidence, reverse=True)
        
        return optimizations
    
    def _generate_algorithmic_optimizations(self, metrics: Dict[str, PerformanceMetric],
                                          bottlenecks: List[BottleneckIdentification],
                                          context: Dict[str, Any]) -> List[OptimizationOpportunity]:
        """Generate algorithmic optimization opportunities."""
        optimizations = []
        
        # Check for high latency
        latency_metric = metrics.get('swarm_latency')
        if latency_metric and latency_metric.value > 500:  # 500ms
            optimizations.append(OptimizationOpportunity(
                area='latency_reduction',
                type='algorithmic',
                potential_improvement_percent=30.0,
                implementation_effort='medium',
                confidence=0.8,
                description='Optimize critical path to reduce latency',
                implementation_steps=[
                    'Profile and identify slowest operations',
                    'Implement parallel processing where possible',
                    'Add result caching for repeated operations',
                    'Optimize data structures and algorithms'
                ],
                expected_roi=2.5
            ))
        
        # Check for low throughput
        throughput_metric = metrics.get('swarm_throughput')
        if throughput_metric and throughput_metric.baseline and throughput_metric.value < throughput_metric.baseline * 0.8:
            optimizations.append(OptimizationOpportunity(
                area='throughput_improvement',
                type='algorithmic',
                potential_improvement_percent=25.0,
                implementation_effort='medium',
                confidence=0.85,
                description='Improve processing throughput through algorithm optimization',
                implementation_steps=[
                    'Implement batch processing',
                    'Optimize hot code paths',
                    'Reduce synchronization points',
                    'Implement work stealing'
                ],
                expected_roi=3.0
            ))
        
        # Check for neural processing optimization
        neural_time = metrics.get('neural_pattern_time')
        if neural_time and neural_time.value > 100:  # 100ms
            optimizations.append(OptimizationOpportunity(
                area='neural_processing',
                type='algorithmic',
                potential_improvement_percent=40.0,
                implementation_effort='high',
                confidence=0.7,
                description='Optimize neural pattern processing algorithms',
                implementation_steps=[
                    'Implement model caching',
                    'Use SIMD optimizations',
                    'Parallelize pattern recognition',
                    'Optimize model inference'
                ],
                expected_roi=2.0
            ))
        
        return optimizations
    
    def _generate_resource_optimizations(self, metrics: Dict[str, PerformanceMetric],
                                       bottlenecks: List[BottleneckIdentification],
                                       context: Dict[str, Any]) -> List[OptimizationOpportunity]:
        """Generate resource optimization opportunities."""
        optimizations = []
        
        # Memory optimization
        memory_bottlenecks = [b for b in bottlenecks if b.type == 'memory']
        if memory_bottlenecks:
            optimizations.append(OptimizationOpportunity(
                area='memory_optimization',
                type='resource',
                potential_improvement_percent=20.0,
                implementation_effort='medium',
                confidence=0.9,
                description='Optimize memory usage and reduce allocations',
                implementation_steps=[
                    'Implement object pooling',
                    'Optimize data structures',
                    'Add memory monitoring and alerts',
                    'Tune garbage collection'
                ],
                expected_roi=1.8
            ))
        
        # CPU optimization
        cpu_bottlenecks = [b for b in bottlenecks if b.type == 'cpu']
        if cpu_bottlenecks:
            optimizations.append(OptimizationOpportunity(
                area='cpu_optimization',
                type='resource',
                potential_improvement_percent=35.0,
                implementation_effort='low',
                confidence=0.85,
                description='Optimize CPU usage through parallel processing',
                implementation_steps=[
                    'Increase parallelization',
                    'Optimize CPU-intensive operations',
                    'Use SIMD instructions where applicable',
                    'Implement work load balancing'
                ],
                expected_roi=2.8
            ))
        
        # Network optimization
        network_bottlenecks = [b for b in bottlenecks if b.type == 'network']
        if network_bottlenecks:
            optimizations.append(OptimizationOpportunity(
                area='network_optimization',
                type='resource',
                potential_improvement_percent=25.0,
                implementation_effort='medium',
                confidence=0.75,
                description='Optimize network communication and reduce bandwidth usage',
                implementation_steps=[
                    'Implement message compression',
                    'Batch network operations',
                    'Use connection pooling',
                    'Optimize serialization'
                ],
                expected_roi=2.2
            ))
        
        return optimizations
    
    def _generate_architectural_optimizations(self, metrics: Dict[str, PerformanceMetric],
                                            bottlenecks: List[BottleneckIdentification],
                                            context: Dict[str, Any]) -> List[OptimizationOpportunity]:
        """Generate architectural optimization opportunities."""
        optimizations = []
        
        # Coordination optimization
        coord_bottlenecks = [b for b in bottlenecks if b.type == 'coordination']
        if coord_bottlenecks:
            optimizations.append(OptimizationOpportunity(
                area='coordination_architecture',
                type='architectural',
                potential_improvement_percent=45.0,
                implementation_effort='high',
                confidence=0.7,
                description='Optimize swarm coordination architecture',
                implementation_steps=[
                    'Implement hierarchical coordination',
                    'Add agent pooling and reuse',
                    'Optimize message passing',
                    'Implement distributed consensus'
                ],
                expected_roi=3.5
            ))
        
        # Scalability improvements
        if context.get('agent_count', 0) > 10:
            optimizations.append(OptimizationOpportunity(
                area='scalability_architecture',
                type='architectural',
                potential_improvement_percent=50.0,
                implementation_effort='high',
                confidence=0.8,
                description='Implement scalable architecture patterns',
                implementation_steps=[
                    'Design for horizontal scaling',
                    'Implement load balancing',
                    'Add auto-scaling capabilities',
                    'Optimize resource allocation'
                ],
                expected_roi=4.0
            ))
        
        return optimizations
    
    def _generate_configuration_optimizations(self, metrics: Dict[str, PerformanceMetric],
                                            bottlenecks: List[BottleneckIdentification],
                                            context: Dict[str, Any]) -> List[OptimizationOpportunity]:
        """Generate configuration optimization opportunities."""
        optimizations = []
        
        # Token usage optimization
        token_efficiency = metrics.get('token_efficiency')
        if token_efficiency and token_efficiency.value < 0.8:
            optimizations.append(OptimizationOpportunity(
                area='token_optimization',
                type='configuration',
                potential_improvement_percent=20.0,
                implementation_effort='low',
                confidence=0.9,
                description='Optimize token usage configuration',
                implementation_steps=[
                    'Enable aggressive caching',
                    'Implement batching strategies',
                    'Optimize prompt templates',
                    'Use compression where possible'
                ],
                expected_roi=2.5
            ))
        
        # Timeout and retry configuration
        error_rate = metrics.get('swarm_error_rate')
        if error_rate and error_rate.value > 2.0:
            optimizations.append(OptimizationOpportunity(
                area='resilience_configuration',
                type='configuration',
                potential_improvement_percent=15.0,
                implementation_effort='low',
                confidence=0.85,
                description='Optimize timeout and retry configurations',
                implementation_steps=[
                    'Tune timeout values',
                    'Implement exponential backoff',
                    'Add circuit breakers',
                    'Configure health checks'
                ],
                expected_roi=1.8
            ))
        
        return optimizations
    
    def _load_optimization_templates(self) -> Dict[str, Any]:
        """Load optimization templates and best practices."""
        return {
            'caching': {
                'description': 'Implement intelligent caching strategies',
                'impact': 'high',
                'complexity': 'medium'
            },
            'parallelization': {
                'description': 'Increase parallel processing capabilities',
                'impact': 'high',
                'complexity': 'medium'
            },
            'resource_pooling': {
                'description': 'Implement resource pooling and reuse',
                'impact': 'medium',
                'complexity': 'low'
            }
        }
    
    def _deduplicate_optimizations(self, optimizations: List[OptimizationOpportunity]) -> List[OptimizationOpportunity]:
        """Remove duplicate optimizations."""
        seen = set()
        deduplicated = []
        
        for opt in optimizations:
            key = (opt.area, opt.type)
            if key not in seen:
                seen.add(key)
                deduplicated.append(opt)
        
        return deduplicated


class TrendAnalyzer:
    """Analyze performance trends over time."""
    
    def __init__(self):
        self.trend_models = {
            'linear': self._analyze_linear_trend,
            'exponential': self._analyze_exponential_trend,
            'seasonal': self._analyze_seasonal_trend
        }
    
    def analyze_trends(self, metric_history: Dict[str, List[float]],
                      timestamps: List[float]) -> Dict[str, Any]:
        """Analyze performance trends across multiple metrics."""
        trends = {}
        
        for metric_name, values in metric_history.items():
            if len(values) < 3:
                trends[metric_name] = {'trend': 'insufficient_data'}
                continue
            
            metric_trends = {}
            
            # Analyze different trend types
            for trend_type, analyzer in self.trend_models.items():
                trend_result = analyzer(values, timestamps)
                metric_trends[trend_type] = trend_result
            
            # Determine best fit trend
            best_trend = self._select_best_trend(metric_trends)
            metric_trends['best_fit'] = best_trend
            
            # Generate predictions
            predictions = self._generate_predictions(values, timestamps, best_trend)
            metric_trends['predictions'] = predictions
            
            trends[metric_name] = metric_trends
        
        return trends
    
    def _analyze_linear_trend(self, values: List[float], timestamps: List[float]) -> Dict[str, Any]:
        """Analyze linear trend using least squares."""
        n = len(values)
        if n < 2:
            return {'slope': 0.0, 'correlation': 0.0, 'trend': 'stable'}
        
        # Normalize timestamps to start from 0
        min_time = min(timestamps)
        norm_times = [t - min_time for t in timestamps]
        
        # Calculate linear regression
        sum_x = sum(norm_times)
        sum_y = sum(values)
        sum_xy = sum(x * y for x, y in zip(norm_times, values))
        sum_x2 = sum(x * x for x in norm_times)
        
        # Calculate slope
        denominator = n * sum_x2 - sum_x * sum_x
        if denominator == 0:
            slope = 0.0
        else:
            slope = (n * sum_xy - sum_x * sum_y) / denominator
        
        # Calculate correlation coefficient
        mean_x = sum_x / n
        mean_y = sum_y / n
        
        numerator = sum((x - mean_x) * (y - mean_y) for x, y in zip(norm_times, values))
        denom_x = sum((x - mean_x) ** 2 for x in norm_times)
        denom_y = sum((y - mean_y) ** 2 for y in values)
        
        correlation = 0.0
        if denom_x > 0 and denom_y > 0:
            correlation = numerator / (denom_x * denom_y) ** 0.5
        
        # Classify trend
        if abs(slope) < 0.01:
            trend = 'stable'
        elif slope > 0:
            trend = 'increasing'
        else:
            trend = 'decreasing'
        
        return {
            'slope': slope,
            'correlation': correlation,
            'trend': trend,
            'r_squared': correlation ** 2
        }
    
    def _analyze_exponential_trend(self, values: List[float], timestamps: List[float]) -> Dict[str, Any]:
        """Analyze exponential trend."""
        if len(values) < 3 or any(v <= 0 for v in values):
            return {'growth_rate': 0.0, 'trend': 'stable', 'fit': 0.0}
        
        # Use log transform for exponential fitting
        log_values = [np.log(v) for v in values]
        linear_result = self._analyze_linear_trend(log_values, timestamps)
        
        growth_rate = linear_result['slope']
        fit_quality = abs(linear_result['correlation'])
        
        # Classify exponential trend
        if abs(growth_rate) < 0.01:
            trend = 'stable'
        elif growth_rate > 0:
            trend = 'exponential_growth'
        else:
            trend = 'exponential_decay'
        
        return {
            'growth_rate': growth_rate,
            'trend': trend,
            'fit': fit_quality
        }
    
    def _analyze_seasonal_trend(self, values: List[float], timestamps: List[float]) -> Dict[str, Any]:
        """Analyze seasonal/cyclical trends."""
        if len(values) < 10:
            return {'seasonality': False, 'period': 0, 'amplitude': 0.0}
        
        # Simple seasonality detection using autocorrelation
        max_period = min(len(values) // 3, 24)  # Max period of 24 or 1/3 of data
        best_period = 0
        best_correlation = 0.0
        
        for period in range(2, max_period + 1):
            correlation = self._calculate_autocorrelation(values, period)
            if correlation > best_correlation:
                best_correlation = correlation
                best_period = period
        
        seasonality = best_correlation > 0.5
        amplitude = statistics.stdev(values) if seasonality else 0.0
        
        return {
            'seasonality': seasonality,
            'period': best_period,
            'amplitude': amplitude,
            'correlation': best_correlation
        }
    
    def _calculate_autocorrelation(self, values: List[float], lag: int) -> float:
        """Calculate autocorrelation at given lag."""
        if lag >= len(values):
            return 0.0
        
        n = len(values) - lag
        if n <= 1:
            return 0.0
        
        x1 = values[:-lag] if lag > 0 else values
        x2 = values[lag:]
        
        mean1 = statistics.mean(x1)
        mean2 = statistics.mean(x2)
        
        numerator = sum((a - mean1) * (b - mean2) for a, b in zip(x1, x2))
        denom1 = sum((a - mean1) ** 2 for a in x1)
        denom2 = sum((b - mean2) ** 2 for b in x2)
        
        if denom1 <= 0 or denom2 <= 0:
            return 0.0
        
        return numerator / (denom1 * denom2) ** 0.5
    
    def _select_best_trend(self, trend_results: Dict[str, Any]) -> str:
        """Select the best fitting trend model."""
        # Score each trend type
        scores = {}
        
        linear = trend_results.get('linear', {})
        scores['linear'] = abs(linear.get('correlation', 0.0))
        
        exponential = trend_results.get('exponential', {})
        scores['exponential'] = exponential.get('fit', 0.0)
        
        seasonal = trend_results.get('seasonal', {})
        scores['seasonal'] = seasonal.get('correlation', 0.0) if seasonal.get('seasonality', False) else 0.0
        
        # Return trend with highest score
        best_trend = max(scores.items(), key=lambda x: x[1])
        return best_trend[0]
    
    def _generate_predictions(self, values: List[float], timestamps: List[float],
                            trend_type: str) -> Dict[str, Any]:
        """Generate future predictions based on trend."""
        if len(values) < 2:
            return {'next_value': values[-1] if values else 0.0, 'confidence': 0.0}
        
        # Simple prediction based on trend type
        if trend_type == 'linear':
            # Linear extrapolation
            recent_values = values[-5:]  # Use last 5 points
            if len(recent_values) >= 2:
                slope = (recent_values[-1] - recent_values[0]) / len(recent_values)
                next_value = values[-1] + slope
            else:
                next_value = values[-1]
        
        elif trend_type == 'exponential':
            # Exponential extrapolation
            if len(values) >= 3 and all(v > 0 for v in values[-3:]):
                growth_rate = (values[-1] / values[-3]) ** (1.0 / 2.0)  # 2-period growth rate
                next_value = values[-1] * growth_rate
            else:
                next_value = values[-1]
        
        else:  # stable or seasonal
            # Use recent average
            recent_values = values[-min(5, len(values)):]
            next_value = statistics.mean(recent_values)
        
        # Calculate confidence based on recent variance
        if len(values) >= 3:
            recent_variance = statistics.variance(values[-5:])
            confidence = max(0.0, min(1.0, 1.0 - (recent_variance / (values[-1] ** 2))))
        else:
            confidence = 0.5
        
        return {
            'next_value': next_value,
            'confidence': confidence,
            'prediction_horizon': 1  # 1 time step ahead
        }


class PerformanceAnalyzer:
    """
    Comprehensive performance analysis system for Claude Flow swarm benchmarks.
    
    Provides advanced analytics, bottleneck identification, optimization recommendations,
    trend analysis, and comparative performance evaluation.
    """
    
    def __init__(self, config: Optional[Dict] = None):
        self.config = config or {}
        
        # Initialize components
        self.bottleneck_detector = BottleneckDetector(self.config.get('bottleneck_config'))
        self.optimization_engine = OptimizationEngine()
        self.trend_analyzer = TrendAnalyzer()
        
        # Performance baselines
        self.baselines = {}
        self.historical_data = defaultdict(list)
        
        # Analysis cache
        self.analysis_cache = {}
        self.cache_lock = threading.RLock()
        
        logger.info("PerformanceAnalyzer initialized")
    
    def analyze_performance(self, metrics: Dict[str, Any], 
                          context: Optional[Dict[str, Any]] = None) -> PerformanceAnalysis:
        """
        Perform comprehensive performance analysis.
        
        Args:
            metrics: Dictionary of performance metrics
            context: Optional context information about the benchmark
            
        Returns:
            PerformanceAnalysis with complete analysis results
        """
        analysis_id = f"perf_analysis_{int(time.time())}"
        start_time = time.time()
        context = context or {}
        
        logger.info("Starting performance analysis: %s", analysis_id)
        
        # Convert metrics to PerformanceMetric objects
        perf_metrics = self._convert_to_performance_metrics(metrics)
        
        # Detect bottlenecks
        bottlenecks = self.bottleneck_detector.detect_bottlenecks(
            perf_metrics, self.historical_data
        )
        
        # Generate optimization opportunities
        optimizations = self.optimization_engine.generate_optimizations(
            perf_metrics, bottlenecks, context
        )
        
        # Analyze trends
        trends = self._analyze_performance_trends(perf_metrics)
        
        # Calculate performance score
        performance_score = self._calculate_performance_score(perf_metrics, bottlenecks)
        
        # Generate recommendations
        recommendations = self._generate_recommendations(
            perf_metrics, bottlenecks, optimizations, trends
        )
        
        # Comparative analysis
        comparative_analysis = self._perform_comparative_analysis(perf_metrics, context)
        
        end_time = time.time()
        
        analysis = PerformanceAnalysis(
            analysis_id=analysis_id,
            timestamp=start_time,
            duration_seconds=end_time - start_time,
            metrics=perf_metrics,
            bottlenecks=[asdict(b) for b in bottlenecks],
            optimization_opportunities=[asdict(o) for o in optimizations],
            performance_score=performance_score,
            trends=trends,
            recommendations=recommendations,
            comparative_analysis=comparative_analysis
        )
        
        # Store for historical analysis
        self._store_analysis_results(analysis)
        
        logger.info("Performance analysis completed: %s (score: %.1f)", 
                   analysis_id, performance_score)
        
        return analysis
    
    def set_baseline(self, baseline_name: str, metrics: Dict[str, Any]):
        """Set performance baseline for comparison."""
        perf_metrics = self._convert_to_performance_metrics(metrics)
        self.baselines[baseline_name] = perf_metrics
        logger.info("Performance baseline set: %s", baseline_name)
    
    def compare_with_baseline(self, metrics: Dict[str, Any], 
                            baseline_name: str) -> Dict[str, Any]:
        """Compare current metrics with a baseline."""
        if baseline_name not in self.baselines:
            logger.warning("Baseline not found: %s", baseline_name)
            return {'error': 'baseline_not_found'}
        
        current_metrics = self._convert_to_performance_metrics(metrics)
        baseline_metrics = self.baselines[baseline_name]
        
        comparison = {
            'baseline_name': baseline_name,
            'comparison_time': time.time(),
            'metric_comparisons': {},
            'overall_change': {},
            'significant_changes': []
        }
        
        # Compare each metric
        for metric_name in current_metrics:
            if metric_name in baseline_metrics:
                current = current_metrics[metric_name]
                baseline = baseline_metrics[metric_name]
                
                change_percent = 0.0
                if baseline.value != 0:
                    change_percent = ((current.value - baseline.value) / baseline.value) * 100
                
                metric_comparison = {
                    'current_value': current.value,
                    'baseline_value': baseline.value,
                    'change_percent': change_percent,
                    'change_absolute': current.value - baseline.value,
                    'improvement': self._is_improvement(metric_name, change_percent)
                }
                
                comparison['metric_comparisons'][metric_name] = metric_comparison
                
                # Track significant changes (>10% change)
                if abs(change_percent) > 10:
                    comparison['significant_changes'].append({
                        'metric': metric_name,
                        'change_percent': change_percent,
                        'improvement': metric_comparison['improvement']
                    })
        
        # Calculate overall performance change
        if comparison['metric_comparisons']:
            improvements = sum(1 for c in comparison['metric_comparisons'].values() 
                             if c['improvement'])
            total_metrics = len(comparison['metric_comparisons'])
            
            comparison['overall_change'] = {
                'improvement_ratio': improvements / total_metrics,
                'avg_change_percent': statistics.mean([
                    c['change_percent'] for c in comparison['metric_comparisons'].values()
                ]),
                'significant_changes_count': len(comparison['significant_changes'])
            }
        
        return comparison
    
    def generate_performance_report(self, analysis: PerformanceAnalysis) -> str:
        """Generate comprehensive performance report."""
        report = f"""
# Performance Analysis Report

**Analysis ID**: {analysis.analysis_id}
**Timestamp**: {datetime.fromtimestamp(analysis.timestamp).strftime('%Y-%m-%d %H:%M:%S')}
**Duration**: {analysis.duration_seconds:.2f} seconds
**Performance Score**: {analysis.performance_score:.1f}/100

## Executive Summary

The performance analysis identified {len(analysis.bottlenecks)} bottlenecks and {len(analysis.optimization_opportunities)} optimization opportunities.

## Performance Metrics

| Metric | Value | Category | Status |
|--------|-------|----------|--------|
"""
        
        for name, metric in analysis.metrics.items():
            status = "🟢" if metric.baseline is None or metric.value <= metric.baseline * 1.1 else "🟡" if metric.value <= metric.baseline * 1.3 else "🔴"
            report += f"| {name} | {metric.value:.2f} {metric.unit} | {metric.category.value} | {status} |\n"
        
        # Bottlenecks section
        if analysis.bottlenecks:
            report += "\n## Identified Bottlenecks\n\n"
            for i, bottleneck in enumerate(analysis.bottlenecks, 1):
                severity_emoji = "🔥" if bottleneck['severity'] > 0.8 else "⚠️" if bottleneck['severity'] > 0.5 else "ℹ️"
                report += f"{i}. {severity_emoji} **{bottleneck['component']}**: {bottleneck['description']}\n"
                report += f"   - **Impact**: {bottleneck['impact_percent']:.1f}%\n"
                report += f"   - **Solutions**: {', '.join(bottleneck['suggested_solutions'][:2])}\n\n"
        
        # Optimization opportunities
        if analysis.optimization_opportunities:
            report += "## Optimization Opportunities\n\n"
            for i, opt in enumerate(analysis.optimization_opportunities[:5], 1):
                report += f"{i}. **{opt['area']}** ({opt['type']})\n"
                report += f"   - **Potential Improvement**: {opt['potential_improvement_percent']:.1f}%\n"
                report += f"   - **Effort**: {opt['implementation_effort']}\n"
                report += f"   - **Confidence**: {opt['confidence']:.1f}\n"
                report += f"   - **Description**: {opt['description']}\n\n"
        
        # Recommendations
        if analysis.recommendations:
            report += "## Recommendations\n\n"
            for i, rec in enumerate(analysis.recommendations, 1):
                report += f"{i}. {rec}\n"
        
        # Trends
        if analysis.trends:
            report += "\n## Performance Trends\n\n"
            for metric_name, trend_data in analysis.trends.items():
                best_fit = trend_data.get('best_fit', 'unknown')
                report += f"- **{metric_name}**: {best_fit} trend\n"
        
        return report
    
    # Private methods
    
    def _convert_to_performance_metrics(self, metrics: Dict[str, Any]) -> Dict[str, PerformanceMetric]:
        """Convert raw metrics to PerformanceMetric objects."""
        perf_metrics = {}
        
        for name, value in metrics.items():
            # Determine category and unit based on metric name
            category = self._determine_metric_category(name)
            unit = self._determine_metric_unit(name)
            
            # Handle both simple values and complex metric objects
            if isinstance(value, dict):
                metric_value = value.get('value', value.get('mean', 0.0))
                baseline = value.get('baseline')
                target = value.get('target')
                context = value.get('context', {})
            else:
                metric_value = float(value)
                baseline = None
                target = None
                context = {}
            
            perf_metric = PerformanceMetric(
                name=name,
                value=metric_value,
                unit=unit,
                category=category,
                timestamp=time.time(),
                context=context,
                baseline=baseline,
                target=target
            )
            
            perf_metrics[name] = perf_metric
        
        return perf_metrics
    
    def _determine_metric_category(self, metric_name: str) -> PerformanceCategory:
        """Determine performance category from metric name."""
        name_lower = metric_name.lower()
        
        if 'throughput' in name_lower or 'ops' in name_lower:
            return PerformanceCategory.THROUGHPUT
        elif 'latency' in name_lower or 'time' in name_lower or 'duration' in name_lower:
            return PerformanceCategory.LATENCY
        elif 'memory' in name_lower or 'cpu' in name_lower or 'network' in name_lower:
            return PerformanceCategory.RESOURCE_UTILIZATION
        elif 'error' in name_lower or 'success' in name_lower:
            return PerformanceCategory.RELIABILITY
        elif 'token' in name_lower or 'efficiency' in name_lower:
            return PerformanceCategory.EFFICIENCY
        else:
            return PerformanceCategory.THROUGHPUT  # Default
    
    def _determine_metric_unit(self, metric_name: str) -> str:
        """Determine unit from metric name."""
        name_lower = metric_name.lower()
        
        if 'ms' in name_lower or 'time' in name_lower:
            return 'ms'
        elif 'throughput' in name_lower:
            return 'ops/s'
        elif 'memory' in name_lower:
            return 'MB'
        elif 'cpu' in name_lower:
            return '%'
        elif 'rate' in name_lower:
            return '%'
        elif 'count' in name_lower:
            return 'count'
        else:
            return 'units'
    
    def _analyze_performance_trends(self, metrics: Dict[str, PerformanceMetric]) -> Dict[str, Any]:
        """Analyze performance trends for metrics."""
        trends = {}
        
        for metric_name, metric in metrics.items():
            # Get historical data for this metric
            historical_values = [h['value'] for h in self.historical_data[metric_name]]
            historical_timestamps = [h['timestamp'] for h in self.historical_data[metric_name]]
            
            if len(historical_values) >= 3:
                metric_trends = self.trend_analyzer.analyze_trends(
                    {metric_name: historical_values}, 
                    historical_timestamps
                )
                trends.update(metric_trends)
        
        return trends
    
    def _calculate_performance_score(self, metrics: Dict[str, PerformanceMetric],
                                   bottlenecks: List[BottleneckIdentification]) -> float:
        """Calculate overall performance score."""
        base_score = 100.0
        
        # Penalize for bottlenecks
        for bottleneck in bottlenecks:
            penalty = bottleneck.severity * bottleneck.impact_percent * 0.5
            base_score -= penalty
        
        # Penalize for poor metrics vs baselines/targets
        for metric in metrics.values():
            if metric.target and metric.value > metric.target:
                if metric.category == PerformanceCategory.LATENCY:
                    # Higher latency is bad
                    penalty = min(10, (metric.value - metric.target) / metric.target * 20)
                    base_score -= penalty
            
            if metric.baseline:
                change_ratio = metric.value / metric.baseline
                if change_ratio > 1.2:  # 20% worse than baseline
                    if metric.category in [PerformanceCategory.LATENCY]:
                        penalty = min(15, (change_ratio - 1.2) * 30)
                        base_score -= penalty
        
        return max(0.0, min(100.0, base_score))
    
    def _generate_recommendations(self, metrics: Dict[str, PerformanceMetric],
                                bottlenecks: List[BottleneckIdentification],
                                optimizations: List[OptimizationOpportunity],
                                trends: Dict[str, Any]) -> List[str]:
        """Generate performance recommendations."""
        recommendations = []
        
        # High-priority bottleneck recommendations
        critical_bottlenecks = [b for b in bottlenecks if b.severity > 0.8]
        if critical_bottlenecks:
            recommendations.append(
                f"Address {len(critical_bottlenecks)} critical performance bottlenecks immediately"
            )
        
        # High-impact optimization recommendations
        high_impact_opts = [o for o in optimizations if o.potential_improvement_percent > 30]
        if high_impact_opts:
            recommendations.append(
                f"Implement {len(high_impact_opts)} high-impact optimizations for significant gains"
            )
        
        # Trend-based recommendations
        for metric_name, trend_data in trends.items():
            if isinstance(trend_data, dict) and trend_data.get('best_fit') == 'exponential':
                if 'error' in metric_name.lower() or 'latency' in metric_name.lower():
                    recommendations.append(
                        f"Monitor {metric_name} closely - showing exponential growth pattern"
                    )
        
        # Resource utilization recommendations
        high_resource_metrics = [
            m for m in metrics.values() 
            if m.category == PerformanceCategory.RESOURCE_UTILIZATION and m.value > 80
        ]
        if high_resource_metrics:
            recommendations.append("Consider scaling resources to handle high utilization")
        
        return recommendations[:10]  # Limit to top 10 recommendations
    
    def _perform_comparative_analysis(self, metrics: Dict[str, PerformanceMetric],
                                    context: Dict[str, Any]) -> Optional[Dict]:
        """Perform comparative analysis with similar configurations."""
        # This would compare with historical data of similar configurations
        # For now, return basic comparison info
        if not context:
            return None
        
        return {
            'context_similarity': 0.8,
            'historical_comparisons': 0,
            'peer_comparisons': 0
        }
    
    def _store_analysis_results(self, analysis: PerformanceAnalysis):
        """Store analysis results for historical tracking."""
        # Store key metrics for trend analysis
        for name, metric in analysis.metrics.items():
            self.historical_data[name].append({
                'timestamp': analysis.timestamp,
                'value': metric.value,
                'analysis_id': analysis.analysis_id
            })
            
            # Limit historical data size
            if len(self.historical_data[name]) > 1000:
                self.historical_data[name] = self.historical_data[name][-1000:]
    
    def _is_improvement(self, metric_name: str, change_percent: float) -> bool:
        """Determine if a change is an improvement based on metric type."""
        name_lower = metric_name.lower()
        
        # For latency, error rate, memory usage - lower is better
        if any(word in name_lower for word in ['latency', 'error', 'memory', 'cpu']):
            return change_percent < 0
        
        # For throughput, success rate, efficiency - higher is better
        if any(word in name_lower for word in ['throughput', 'success', 'efficiency']):
            return change_percent > 0
        
        # Default: higher is better
        return change_percent > 0

    async def benchmark_performance_analyzer(self, test_scenarios: List[Dict]) -> Dict[str, Any]:
        """
        Benchmark the performance analyzer itself.
        
        Args:
            test_scenarios: List of test scenarios with different metric patterns
            
        Returns:
            Benchmark results for the performance analyzer
        """
        benchmark_results = {
            'scenarios_tested': len(test_scenarios),
            'analysis_times': [],
            'bottleneck_detection_accuracy': [],
            'optimization_relevance_scores': [],
            'trend_prediction_accuracy': [],
            'overall_analyzer_performance': {}
        }
        
        for scenario in test_scenarios:
            scenario_name = scenario.get('name', f'scenario_{len(benchmark_results["analysis_times"])}')
            
            # Generate test metrics based on scenario
            test_metrics = self._generate_test_metrics(scenario)
            
            # Benchmark analysis time
            start_time = time.time()
            analysis = self.analyze_performance(test_metrics, scenario)
            analysis_time = time.time() - start_time
            
            benchmark_results['analysis_times'].append(analysis_time)
            
            # Evaluate bottleneck detection accuracy (if known bottlenecks provided)
            if 'known_bottlenecks' in scenario:
                accuracy = self._evaluate_bottleneck_accuracy(
                    analysis.bottlenecks, scenario['known_bottlenecks']
                )
                benchmark_results['bottleneck_detection_accuracy'].append(accuracy)
            
            # Evaluate optimization relevance
            relevance_score = self._evaluate_optimization_relevance(
                analysis.optimization_opportunities, test_metrics
            )
            benchmark_results['optimization_relevance_scores'].append(relevance_score)
            
            # If historical data available, evaluate trend prediction
            if len(self.historical_data) > 5:
                prediction_accuracy = self._evaluate_trend_predictions(analysis.trends)
                benchmark_results['trend_prediction_accuracy'].append(prediction_accuracy)
        
        # Calculate overall performance metrics
        benchmark_results['overall_analyzer_performance'] = {
            'avg_analysis_time_ms': statistics.mean(benchmark_results['analysis_times']) * 1000,
            'max_analysis_time_ms': max(benchmark_results['analysis_times']) * 1000,
            'avg_bottleneck_accuracy': statistics.mean(benchmark_results['bottleneck_detection_accuracy']) if benchmark_results['bottleneck_detection_accuracy'] else 0.0,
            'avg_optimization_relevance': statistics.mean(benchmark_results['optimization_relevance_scores']),
            'avg_trend_accuracy': statistics.mean(benchmark_results['trend_prediction_accuracy']) if benchmark_results['trend_prediction_accuracy'] else 0.0
        }
        
        logger.info("Performance analyzer benchmark completed: %.2f ms average analysis time",
                   benchmark_results['overall_analyzer_performance']['avg_analysis_time_ms'])
        
        return benchmark_results
    
    def _generate_test_metrics(self, scenario: Dict) -> Dict[str, Any]:
        """Generate test metrics based on scenario specification."""
        metrics = {}
        
        scenario_type = scenario.get('type', 'normal')
        
        if scenario_type == 'high_latency':
            metrics.update({
                'swarm_latency': 1500.0,  # High latency
                'swarm_throughput': 10.0,  # Low throughput
                'cpu_usage': 60.0,
                'memory_usage': 70.0,
                'swarm_error_rate': 2.0
            })
        elif scenario_type == 'resource_constrained':
            metrics.update({
                'swarm_latency': 800.0,
                'swarm_throughput': 15.0,
                'cpu_usage': 95.0,  # Very high CPU
                'memory_usage': 90.0,  # Very high memory
                'swarm_error_rate': 1.0
            })
        elif scenario_type == 'coordination_issues':
            metrics.update({
                'swarm_latency': 600.0,
                'swarm_throughput': 8.0,
                'cpu_usage': 40.0,
                'memory_usage': 50.0,
                'agent_spawn_time': 8000.0,  # Very slow spawning
                'swarm_error_rate': 8.0  # High error rate
            })
        else:  # normal
            metrics.update({
                'swarm_latency': 200.0,
                'swarm_throughput': 50.0,
                'cpu_usage': 45.0,
                'memory_usage': 60.0,
                'swarm_error_rate': 0.5
            })
        
        return metrics
    
    def _evaluate_bottleneck_accuracy(self, detected_bottlenecks: List[Dict], 
                                    known_bottlenecks: List[str]) -> float:
        """Evaluate accuracy of bottleneck detection."""
        if not known_bottlenecks:
            return 1.0
        
        detected_types = set(b['type'] for b in detected_bottlenecks)
        known_types = set(known_bottlenecks)
        
        # Calculate precision and recall
        true_positives = len(detected_types & known_types)
        false_positives = len(detected_types - known_types)
        false_negatives = len(known_types - detected_types)
        
        if true_positives + false_positives == 0:
            precision = 1.0
        else:
            precision = true_positives / (true_positives + false_positives)
        
        if true_positives + false_negatives == 0:
            recall = 1.0
        else:
            recall = true_positives / (true_positives + false_negatives)
        
        # F1 score
        if precision + recall == 0:
            return 0.0
        
        return 2 * (precision * recall) / (precision + recall)
    
    def _evaluate_optimization_relevance(self, optimizations: List[Dict], 
                                       metrics: Dict[str, Any]) -> float:
        """Evaluate relevance of optimization suggestions."""
        if not optimizations:
            return 0.0
        
        relevant_count = 0
        
        for opt in optimizations:
            opt_area = opt['area'].lower()
            
            # Check if optimization is relevant to current metrics
            if 'latency' in opt_area and metrics.get('swarm_latency', 0) > 500:
                relevant_count += 1
            elif 'memory' in opt_area and metrics.get('memory_usage', 0) > 80:
                relevant_count += 1
            elif 'cpu' in opt_area and metrics.get('cpu_usage', 0) > 80:
                relevant_count += 1
            elif 'throughput' in opt_area and metrics.get('swarm_throughput', 100) < 20:
                relevant_count += 1
            elif 'coordination' in opt_area and metrics.get('swarm_error_rate', 0) > 5:
                relevant_count += 1
        
        return relevant_count / len(optimizations)
    
    def _evaluate_trend_predictions(self, trends: Dict[str, Any]) -> float:
        """Evaluate accuracy of trend predictions (simplified)."""
        # This would require actual future data to evaluate properly
        # For now, return a score based on trend detection confidence
        if not trends:
            return 0.0
        
        confidence_scores = []
        for trend_data in trends.values():
            if isinstance(trend_data, dict):
                predictions = trend_data.get('predictions', {})
                confidence = predictions.get('confidence', 0.5)
                confidence_scores.append(confidence)
        
        return statistics.mean(confidence_scores) if confidence_scores else 0.5