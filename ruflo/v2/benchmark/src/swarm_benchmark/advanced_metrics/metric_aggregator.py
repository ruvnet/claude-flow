"""
Metric Aggregator

Real-time metric collection and aggregation system for Claude Flow swarm benchmarks.
Provides unified metric collection, real-time aggregation, and comprehensive analytics.
"""

import asyncio
import time
import json
import logging
import statistics
from typing import Dict, List, Optional, Any, Union, Callable
from dataclasses import dataclass, asdict, field
from collections import defaultdict, deque
from datetime import datetime, timedelta
import threading
import weakref
from enum import Enum
import numpy as np

logger = logging.getLogger(__name__)


class MetricType(Enum):
    """Types of metrics that can be collected."""
    COUNTER = "counter"
    GAUGE = "gauge"
    HISTOGRAM = "histogram"
    TIMER = "timer"
    RATE = "rate"


@dataclass
class MetricDefinition:
    """Definition of a metric to be collected."""
    
    name: str
    type: MetricType
    description: str
    unit: str
    tags: Dict[str, str] = field(default_factory=dict)
    aggregation_window_seconds: float = 60.0
    retention_hours: int = 24
    alert_thresholds: Dict[str, float] = field(default_factory=dict)


@dataclass
class MetricPoint:
    """Individual metric data point."""
    
    timestamp: float
    value: Union[float, int]
    tags: Dict[str, str] = field(default_factory=dict)
    

@dataclass
class AggregatedMetric:
    """Aggregated metric with statistical summary."""
    
    name: str
    start_time: float
    end_time: float
    count: int
    sum: float
    min: float
    max: float
    mean: float
    median: float
    p95: float
    p99: float
    std_dev: float
    tags: Dict[str, str] = field(default_factory=dict)
    

class MetricCollector:
    """Collect and buffer individual metrics."""
    
    def __init__(self, buffer_size: int = 10000):
        self.buffer_size = buffer_size
        self.metrics_buffer = defaultdict(lambda: deque(maxlen=buffer_size))
        self.metric_definitions = {}
        self.lock = threading.RLock()
        
    def register_metric(self, definition: MetricDefinition):
        """Register a new metric definition."""
        with self.lock:
            self.metric_definitions[definition.name] = definition
            logger.debug("Registered metric: %s (%s)", definition.name, definition.type.value)
    
    def collect(self, metric_name: str, value: Union[float, int], 
               tags: Optional[Dict[str, str]] = None):
        """Collect a metric value."""
        if metric_name not in self.metric_definitions:
            logger.warning("Metric %s not registered, skipping collection", metric_name)
            return
        
        tags = tags or {}
        point = MetricPoint(
            timestamp=time.time(),
            value=value,
            tags=tags
        )
        
        with self.lock:
            self.metrics_buffer[metric_name].append(point)
    
    def collect_counter(self, name: str, increment: int = 1, tags: Optional[Dict] = None):
        """Collect counter metric."""
        self.collect(name, increment, tags)
    
    def collect_gauge(self, name: str, value: Union[float, int], tags: Optional[Dict] = None):
        """Collect gauge metric."""
        self.collect(name, value, tags)
    
    def collect_timer(self, name: str, duration_ms: float, tags: Optional[Dict] = None):
        """Collect timer metric."""
        self.collect(name, duration_ms, tags)
    
    def get_buffered_metrics(self, metric_name: str, 
                           since: Optional[float] = None) -> List[MetricPoint]:
        """Get buffered metrics for a specific metric."""
        with self.lock:
            if metric_name not in self.metrics_buffer:
                return []
            
            points = list(self.metrics_buffer[metric_name])
            
            if since is not None:
                points = [p for p in points if p.timestamp >= since]
            
            return points
    
    def clear_old_metrics(self, older_than_hours: int = 24):
        """Clear metrics older than specified hours."""
        cutoff_time = time.time() - (older_than_hours * 3600)
        
        with self.lock:
            for metric_name in self.metrics_buffer:
                buffer = self.metrics_buffer[metric_name]
                while buffer and buffer[0].timestamp < cutoff_time:
                    buffer.popleft()


class MetricAggregator:
    """Aggregate metrics over time windows."""
    
    def __init__(self):
        self.aggregation_cache = {}
        self.cache_lock = threading.RLock()
        
    def aggregate_metrics(self, metric_name: str, points: List[MetricPoint],
                         window_seconds: float = 60.0) -> AggregatedMetric:
        """Aggregate metric points over a time window."""
        if not points:
            return self._empty_aggregation(metric_name, time.time())
        
        # Filter points to window
        end_time = max(p.timestamp for p in points)
        start_time = end_time - window_seconds
        window_points = [p for p in points if p.timestamp >= start_time]
        
        if not window_points:
            return self._empty_aggregation(metric_name, end_time)
        
        # Extract values
        values = [p.value for p in window_points]
        
        # Calculate aggregations
        count = len(values)
        sum_val = sum(values)
        min_val = min(values)
        max_val = max(values)
        mean_val = statistics.mean(values)
        median_val = statistics.median(values)
        
        # Calculate percentiles
        p95_val = self._percentile(values, 95)
        p99_val = self._percentile(values, 99)
        
        # Calculate standard deviation
        std_dev = statistics.stdev(values) if count > 1 else 0.0
        
        # Aggregate tags (take most common values)
        aggregated_tags = self._aggregate_tags([p.tags for p in window_points])
        
        return AggregatedMetric(
            name=metric_name,
            start_time=start_time,
            end_time=end_time,
            count=count,
            sum=sum_val,
            min=min_val,
            max=max_val,
            mean=mean_val,
            median=median_val,
            p95=p95_val,
            p99=p99_val,
            std_dev=std_dev,
            tags=aggregated_tags
        )
    
    def aggregate_histogram(self, metric_name: str, points: List[MetricPoint],
                          buckets: List[float]) -> Dict[str, Any]:
        """Aggregate points into histogram buckets."""
        if not points:
            return {'buckets': {str(b): 0 for b in buckets}, 'total': 0}
        
        values = [p.value for p in points]
        histogram = {}
        
        for bucket in buckets:
            count = sum(1 for v in values if v <= bucket)
            histogram[str(bucket)] = count
        
        return {
            'buckets': histogram,
            'total': len(values),
            'min': min(values),
            'max': max(values)
        }
    
    def aggregate_rate(self, metric_name: str, points: List[MetricPoint],
                      window_seconds: float = 60.0) -> float:
        """Calculate rate (events per second) over time window."""
        if not points:
            return 0.0
        
        end_time = max(p.timestamp for p in points)
        start_time = end_time - window_seconds
        window_points = [p for p in points if p.timestamp >= start_time]
        
        if not window_points:
            return 0.0
        
        # For counters, calculate rate from sum of increments
        total_events = sum(p.value for p in window_points)
        actual_duration = end_time - min(p.timestamp for p in window_points)
        
        if actual_duration <= 0:
            return 0.0
        
        return total_events / actual_duration
    
    def _percentile(self, values: List[float], percentile: int) -> float:
        """Calculate percentile value."""
        if not values:
            return 0.0
        
        sorted_values = sorted(values)
        index = int((percentile / 100.0) * len(sorted_values))
        index = min(index, len(sorted_values) - 1)
        return sorted_values[index]
    
    def _aggregate_tags(self, tag_lists: List[Dict[str, str]]) -> Dict[str, str]:
        """Aggregate tags from multiple points."""
        if not tag_lists:
            return {}
        
        # Count occurrences of each tag value
        tag_counts = defaultdict(lambda: defaultdict(int))
        
        for tags in tag_lists:
            for key, value in tags.items():
                tag_counts[key][value] += 1
        
        # Select most common value for each tag key
        aggregated = {}
        for key, value_counts in tag_counts.items():
            most_common = max(value_counts.items(), key=lambda x: x[1])
            aggregated[key] = most_common[0]
        
        return aggregated
    
    def _empty_aggregation(self, metric_name: str, timestamp: float) -> AggregatedMetric:
        """Create empty aggregation for cases with no data."""
        return AggregatedMetric(
            name=metric_name,
            start_time=timestamp,
            end_time=timestamp,
            count=0,
            sum=0.0,
            min=0.0,
            max=0.0,
            mean=0.0,
            median=0.0,
            p95=0.0,
            p99=0.0,
            std_dev=0.0
        )


class RealTimeAggregator:
    """Real-time metric aggregation with sliding windows."""
    
    def __init__(self, window_size_seconds: float = 60.0, 
                 update_interval_seconds: float = 5.0):
        self.window_size = window_size_seconds
        self.update_interval = update_interval_seconds
        self.aggregator = MetricAggregator()
        self.current_aggregations = {}
        self.is_running = False
        self.aggregation_thread = None
        self.callbacks = defaultdict(list)
        
    def start(self, collector: MetricCollector):
        """Start real-time aggregation."""
        if self.is_running:
            return
        
        self.collector = collector
        self.is_running = True
        self.aggregation_thread = threading.Thread(
            target=self._aggregation_loop, 
            daemon=True
        )
        self.aggregation_thread.start()
        logger.info("Real-time aggregator started")
    
    def stop(self):
        """Stop real-time aggregation."""
        self.is_running = False
        if self.aggregation_thread:
            self.aggregation_thread.join(timeout=5.0)
        logger.info("Real-time aggregator stopped")
    
    def register_callback(self, metric_name: str, callback: Callable[[AggregatedMetric], None]):
        """Register callback for metric updates."""
        self.callbacks[metric_name].append(callback)
    
    def get_current_aggregation(self, metric_name: str) -> Optional[AggregatedMetric]:
        """Get current aggregation for a metric."""
        return self.current_aggregations.get(metric_name)
    
    def _aggregation_loop(self):
        """Main aggregation loop."""
        while self.is_running:
            try:
                self._update_aggregations()
                time.sleep(self.update_interval)
            except Exception as e:
                logger.error("Error in aggregation loop: %s", e)
                time.sleep(self.update_interval)
    
    def _update_aggregations(self):
        """Update all metric aggregations."""
        current_time = time.time()
        
        for metric_name in self.collector.metric_definitions:
            # Get recent points
            since = current_time - self.window_size
            points = self.collector.get_buffered_metrics(metric_name, since)
            
            # Aggregate
            aggregation = self.aggregator.aggregate_metrics(
                metric_name, points, self.window_size
            )
            
            # Store current aggregation
            self.current_aggregations[metric_name] = aggregation
            
            # Trigger callbacks
            for callback in self.callbacks[metric_name]:
                try:
                    callback(aggregation)
                except Exception as e:
                    logger.warning("Callback error for metric %s: %s", metric_name, e)


class MetricAnalyzer:
    """Analyze metrics for trends, anomalies, and insights."""
    
    def __init__(self):
        self.baseline_metrics = {}
        self.anomaly_thresholds = {}
        
    def analyze_trend(self, aggregations: List[AggregatedMetric]) -> Dict[str, Any]:
        """Analyze trend in metric aggregations."""
        if len(aggregations) < 2:
            return {'trend': 'insufficient_data', 'slope': 0.0}
        
        # Extract time series data
        times = [a.end_time for a in aggregations]
        values = [a.mean for a in aggregations]
        
        # Calculate trend using linear regression
        n = len(times)
        sum_x = sum(times)
        sum_y = sum(values)
        sum_xy = sum(t * v for t, v in zip(times, values))
        sum_x2 = sum(t * t for t in times)
        
        # Calculate slope
        slope = (n * sum_xy - sum_x * sum_y) / (n * sum_x2 - sum_x * sum_x)
        
        # Classify trend
        if abs(slope) < 0.01:
            trend = 'stable'
        elif slope > 0:
            trend = 'increasing'
        else:
            trend = 'decreasing'
        
        # Calculate correlation coefficient
        mean_x = sum_x / n
        mean_y = sum_y / n
        
        numerator = sum((t - mean_x) * (v - mean_y) for t, v in zip(times, values))
        denom_x = sum((t - mean_x) ** 2 for t in times)
        denom_y = sum((v - mean_y) ** 2 for v in values)
        
        correlation = 0.0
        if denom_x > 0 and denom_y > 0:
            correlation = numerator / (denom_x * denom_y) ** 0.5
        
        return {
            'trend': trend,
            'slope': slope,
            'correlation': correlation,
            'confidence': abs(correlation),
            'data_points': n
        }
    
    def detect_anomalies(self, aggregations: List[AggregatedMetric],
                        sensitivity: float = 2.0) -> List[Dict]:
        """Detect anomalies in metric aggregations."""
        if len(aggregations) < 5:
            return []
        
        values = [a.mean for a in aggregations]
        mean_val = statistics.mean(values)
        std_val = statistics.stdev(values)
        
        anomalies = []
        threshold = sensitivity * std_val
        
        for i, aggregation in enumerate(aggregations):
            deviation = abs(aggregation.mean - mean_val)
            
            if deviation > threshold:
                anomaly_type = 'spike' if aggregation.mean > mean_val else 'dip'
                severity = min(1.0, deviation / (3 * std_val))
                
                anomalies.append({
                    'timestamp': aggregation.end_time,
                    'value': aggregation.mean,
                    'expected_range': (mean_val - threshold, mean_val + threshold),
                    'deviation': deviation,
                    'type': anomaly_type,
                    'severity': severity,
                    'index': i
                })
        
        return anomalies
    
    def calculate_baseline(self, aggregations: List[AggregatedMetric]) -> Dict[str, float]:
        """Calculate baseline metrics for comparison."""
        if not aggregations:
            return {}
        
        values = [a.mean for a in aggregations]
        
        baseline = {
            'mean': statistics.mean(values),
            'median': statistics.median(values),
            'std_dev': statistics.stdev(values) if len(values) > 1 else 0.0,
            'min': min(values),
            'max': max(values),
            'p95': self._percentile(values, 95),
            'p99': self._percentile(values, 99)
        }
        
        return baseline
    
    def compare_with_baseline(self, current: AggregatedMetric, 
                            baseline: Dict[str, float]) -> Dict[str, Any]:
        """Compare current metrics with baseline."""
        if not baseline:
            return {'comparison': 'no_baseline'}
        
        comparison = {}
        
        # Compare mean
        baseline_mean = baseline.get('mean', current.mean)
        mean_diff_percent = 0.0
        if baseline_mean != 0:
            mean_diff_percent = ((current.mean - baseline_mean) / baseline_mean) * 100
        
        comparison['mean_change_percent'] = mean_diff_percent
        
        # Compare with baseline range
        baseline_p95 = baseline.get('p95', current.mean)
        if current.mean > baseline_p95:
            comparison['status'] = 'above_normal'
        elif current.mean < baseline.get('p5', current.mean):
            comparison['status'] = 'below_normal'
        else:
            comparison['status'] = 'normal'
        
        # Performance indicator
        if abs(mean_diff_percent) < 5:
            comparison['performance'] = 'stable'
        elif mean_diff_percent > 10:
            comparison['performance'] = 'improved' if 'latency' not in current.name.lower() else 'degraded'
        elif mean_diff_percent < -10:
            comparison['performance'] = 'degraded' if 'latency' not in current.name.lower() else 'improved'
        else:
            comparison['performance'] = 'slight_change'
        
        return comparison
    
    def _percentile(self, values: List[float], percentile: int) -> float:
        """Calculate percentile value."""
        if not values:
            return 0.0
        
        sorted_values = sorted(values)
        index = int((percentile / 100.0) * len(sorted_values))
        index = min(index, len(sorted_values) - 1)
        return sorted_values[index]


class MetricAggregator:
    """
    Comprehensive metric aggregation system for Claude Flow swarm benchmarks.
    
    Provides real-time metric collection, aggregation, analysis, and alerting
    capabilities for distributed swarm performance monitoring.
    """
    
    def __init__(self, config: Optional[Dict] = None):
        self.config = config or {}
        
        # Initialize components
        self.collector = MetricCollector(
            buffer_size=self.config.get('buffer_size', 10000)
        )
        
        self.aggregator = MetricAggregator()
        
        self.realtime_aggregator = RealTimeAggregator(
            window_size_seconds=self.config.get('window_size', 60.0),
            update_interval_seconds=self.config.get('update_interval', 5.0)
        )
        
        self.analyzer = MetricAnalyzer()
        
        # State management
        self.is_started = False
        self.metric_history = defaultdict(list)
        self.alerts = deque(maxlen=1000)
        
        # Default metrics
        self._register_default_metrics()
        
        logger.info("MetricAggregator initialized with %d default metrics", 
                   len(self.collector.metric_definitions))
    
    def start(self):
        """Start the metric aggregation system."""
        if self.is_started:
            return
        
        self.realtime_aggregator.start(self.collector)
        self._setup_default_callbacks()
        self.is_started = True
        
        logger.info("MetricAggregator started")
    
    def stop(self):
        """Stop the metric aggregation system."""
        if not self.is_started:
            return
        
        self.realtime_aggregator.stop()
        self.is_started = False
        
        logger.info("MetricAggregator stopped")
    
    def register_metric(self, name: str, metric_type: MetricType, 
                       description: str, unit: str = "",
                       tags: Optional[Dict[str, str]] = None,
                       **kwargs):
        """Register a new metric for collection."""
        definition = MetricDefinition(
            name=name,
            type=metric_type,
            description=description,
            unit=unit,
            tags=tags or {},
            **kwargs
        )
        
        self.collector.register_metric(definition)
    
    def collect_metric(self, name: str, value: Union[float, int], 
                      tags: Optional[Dict[str, str]] = None):
        """Collect a metric value."""
        self.collector.collect(name, value, tags)
    
    def collect_swarm_metric(self, swarm_id: str, metric_name: str, 
                           value: Union[float, int], **tags):
        """Collect a swarm-specific metric."""
        metric_tags = {'swarm_id': swarm_id, **tags}
        self.collect_metric(metric_name, value, metric_tags)
    
    def collect_agent_metric(self, agent_id: str, metric_name: str,
                           value: Union[float, int], **tags):
        """Collect an agent-specific metric."""
        metric_tags = {'agent_id': agent_id, **tags}
        self.collect_metric(metric_name, value, metric_tags)
    
    def get_current_metrics(self, metric_name: Optional[str] = None) -> Dict[str, AggregatedMetric]:
        """Get current aggregated metrics."""
        if metric_name:
            current = self.realtime_aggregator.get_current_aggregation(metric_name)
            return {metric_name: current} if current else {}
        else:
            return self.realtime_aggregator.current_aggregations.copy()
    
    def get_metric_history(self, metric_name: str, 
                          hours: int = 1) -> List[AggregatedMetric]:
        """Get historical aggregations for a metric."""
        cutoff_time = time.time() - (hours * 3600)
        history = self.metric_history.get(metric_name, [])
        return [a for a in history if a.end_time >= cutoff_time]
    
    def analyze_metric_trend(self, metric_name: str, hours: int = 1) -> Dict[str, Any]:
        """Analyze trend for a specific metric."""
        history = self.get_metric_history(metric_name, hours)
        return self.analyzer.analyze_trend(history)
    
    def detect_metric_anomalies(self, metric_name: str, 
                              hours: int = 1, sensitivity: float = 2.0) -> List[Dict]:
        """Detect anomalies in a metric."""
        history = self.get_metric_history(metric_name, hours)
        return self.analyzer.detect_anomalies(history, sensitivity)
    
    def get_performance_summary(self, swarm_id: Optional[str] = None) -> Dict[str, Any]:
        """Get performance summary for swarm or overall system."""
        current_metrics = self.get_current_metrics()
        
        # Filter by swarm if specified
        if swarm_id:
            current_metrics = {
                name: metric for name, metric in current_metrics.items()
                if metric.tags.get('swarm_id') == swarm_id
            }
        
        summary = {
            'timestamp': time.time(),
            'swarm_id': swarm_id,
            'metric_count': len(current_metrics),
            'performance_indicators': {},
            'alerts': list(self.alerts)[-10:],  # Last 10 alerts
            'health_score': 0.0
        }
        
        # Calculate performance indicators
        for name, metric in current_metrics.items():
            if metric.count > 0:
                indicator = {
                    'current_value': metric.mean,
                    'trend': self.analyze_metric_trend(name, 1).get('trend', 'unknown'),
                    'p95': metric.p95,
                    'error_rate': 0.0  # Would be calculated from error metrics
                }
                summary['performance_indicators'][name] = indicator
        
        # Calculate health score
        summary['health_score'] = self._calculate_health_score(current_metrics)
        
        return summary
    
    def export_metrics(self, format: str = 'json', 
                      time_range_hours: int = 1) -> str:
        """Export metrics in specified format."""
        cutoff_time = time.time() - (time_range_hours * 3600)
        
        export_data = {
            'export_time': time.time(),
            'time_range_hours': time_range_hours,
            'metrics': {}
        }
        
        for metric_name in self.collector.metric_definitions:
            history = self.get_metric_history(metric_name, time_range_hours)
            export_data['metrics'][metric_name] = [asdict(a) for a in history]
        
        if format == 'json':
            return json.dumps(export_data, indent=2)
        else:
            raise ValueError(f"Unsupported export format: {format}")
    
    # Private methods
    
    def _register_default_metrics(self):
        """Register default metrics for swarm benchmarking."""
        default_metrics = [
            # Performance metrics
            ('swarm_throughput', MetricType.GAUGE, 'Operations per second', 'ops/s'),
            ('swarm_latency', MetricType.TIMER, 'Operation latency', 'ms'),
            ('swarm_error_rate', MetricType.RATE, 'Error rate', 'errors/s'),
            
            # Resource metrics
            ('memory_usage', MetricType.GAUGE, 'Memory usage', 'MB'),
            ('cpu_usage', MetricType.GAUGE, 'CPU usage', '%'),
            ('network_io', MetricType.RATE, 'Network I/O rate', 'bytes/s'),
            
            # Agent metrics
            ('agent_spawn_time', MetricType.TIMER, 'Agent spawn time', 'ms'),
            ('agent_active_count', MetricType.GAUGE, 'Active agent count', 'count'),
            ('agent_task_completion', MetricType.COUNTER, 'Completed tasks', 'count'),
            
            # Token metrics
            ('token_usage', MetricType.COUNTER, 'Token usage', 'tokens'),
            ('token_efficiency', MetricType.GAUGE, 'Token efficiency', 'ratio'),
            
            # Neural metrics
            ('neural_pattern_time', MetricType.TIMER, 'Neural pattern processing time', 'ms'),
            ('neural_accuracy', MetricType.GAUGE, 'Neural processing accuracy', 'ratio'),
            
            # System metrics
            ('benchmark_duration', MetricType.TIMER, 'Benchmark execution time', 's'),
            ('benchmark_success_rate', MetricType.GAUGE, 'Benchmark success rate', 'ratio')
        ]
        
        for name, metric_type, description, unit in default_metrics:
            self.register_metric(name, metric_type, description, unit)
    
    def _setup_default_callbacks(self):
        """Setup default callbacks for metric processing."""
        # Register callback to store history
        def store_history(metric: AggregatedMetric):
            self.metric_history[metric.name].append(metric)
            
            # Limit history size
            if len(self.metric_history[metric.name]) > 1000:
                self.metric_history[metric.name] = self.metric_history[metric.name][-1000:]
        
        # Register callback for all metrics
        for metric_name in self.collector.metric_definitions:
            self.realtime_aggregator.register_callback(metric_name, store_history)
            self.realtime_aggregator.register_callback(metric_name, self._check_alerts)
    
    def _check_alerts(self, metric: AggregatedMetric):
        """Check for alert conditions."""
        definition = self.collector.metric_definitions.get(metric.name)
        if not definition or not definition.alert_thresholds:
            return
        
        # Check thresholds
        for threshold_type, threshold_value in definition.alert_thresholds.items():
            triggered = False
            message = ""
            
            if threshold_type == 'max' and metric.mean > threshold_value:
                triggered = True
                message = f"{metric.name} above maximum threshold: {metric.mean:.2f} > {threshold_value:.2f}"
            elif threshold_type == 'min' and metric.mean < threshold_value:
                triggered = True
                message = f"{metric.name} below minimum threshold: {metric.mean:.2f} < {threshold_value:.2f}"
            elif threshold_type == 'error_rate' and metric.mean > threshold_value:
                triggered = True
                message = f"High error rate for {metric.name}: {metric.mean:.2f}%"
            
            if triggered:
                alert = {
                    'timestamp': time.time(),
                    'metric_name': metric.name,
                    'threshold_type': threshold_type,
                    'threshold_value': threshold_value,
                    'actual_value': metric.mean,
                    'message': message,
                    'tags': metric.tags
                }
                
                self.alerts.append(alert)
                logger.warning("ALERT: %s", message)
    
    def _calculate_health_score(self, metrics: Dict[str, AggregatedMetric]) -> float:
        """Calculate overall system health score (0-100)."""
        if not metrics:
            return 0.0
        
        score = 100.0
        
        # Check key performance indicators
        if 'swarm_error_rate' in metrics:
            error_rate = metrics['swarm_error_rate'].mean
            if error_rate > 5.0:  # More than 5% error rate
                score -= min(30, error_rate * 2)
        
        if 'swarm_latency' in metrics:
            latency = metrics['swarm_latency'].mean
            if latency > 1000:  # More than 1 second latency
                score -= min(20, (latency - 1000) / 100)
        
        if 'memory_usage' in metrics:
            memory_usage = metrics['memory_usage'].mean
            if memory_usage > 1000:  # More than 1GB memory usage
                score -= min(15, (memory_usage - 1000) / 200)
        
        # Bonus for good performance
        if 'benchmark_success_rate' in metrics:
            success_rate = metrics['benchmark_success_rate'].mean
            if success_rate > 0.95:  # More than 95% success rate
                score += 5
        
        return max(0.0, min(100.0, score))

    async def collect_benchmark_metrics(self, benchmark_result: Dict) -> Dict[str, Any]:
        """
        Collect comprehensive metrics from a benchmark result.
        
        Args:
            benchmark_result: Benchmark execution result
            
        Returns:
            Dictionary of collected and aggregated metrics
        """
        collection_start = time.time()
        
        # Extract basic metrics
        duration = benchmark_result.get('duration', 0)
        success = benchmark_result.get('success', False)
        swarm_id = benchmark_result.get('swarm_id', 'unknown')
        
        # Collect basic performance metrics
        self.collect_swarm_metric(swarm_id, 'benchmark_duration', duration)
        self.collect_swarm_metric(swarm_id, 'benchmark_success_rate', 1.0 if success else 0.0)
        
        # Collect resource metrics if available
        if 'resource_usage' in benchmark_result:
            resource_usage = benchmark_result['resource_usage']
            
            if 'memory_mb' in resource_usage:
                self.collect_swarm_metric(swarm_id, 'memory_usage', resource_usage['memory_mb'])
            
            if 'cpu_percent' in resource_usage:
                self.collect_swarm_metric(swarm_id, 'cpu_usage', resource_usage['cpu_percent'])
        
        # Collect agent metrics
        if 'agent_metrics' in benchmark_result:
            agent_metrics = benchmark_result['agent_metrics']
            
            for agent_id, metrics in agent_metrics.items():
                if 'spawn_time_ms' in metrics:
                    self.collect_agent_metric(agent_id, 'agent_spawn_time', metrics['spawn_time_ms'])
                
                if 'tasks_completed' in metrics:
                    self.collect_agent_metric(agent_id, 'agent_task_completion', metrics['tasks_completed'])
        
        # Collect token metrics
        if 'token_usage' in benchmark_result:
            token_usage = benchmark_result['token_usage']
            
            total_tokens = token_usage.get('total_tokens', 0)
            self.collect_swarm_metric(swarm_id, 'token_usage', total_tokens)
            
            efficiency = token_usage.get('efficiency', 0.0)
            self.collect_swarm_metric(swarm_id, 'token_efficiency', efficiency)
        
        # Collect neural processing metrics
        if 'neural_metrics' in benchmark_result:
            neural_metrics = benchmark_result['neural_metrics']
            
            if 'processing_time_ms' in neural_metrics:
                self.collect_swarm_metric(swarm_id, 'neural_pattern_time', neural_metrics['processing_time_ms'])
            
            if 'accuracy' in neural_metrics:
                self.collect_swarm_metric(swarm_id, 'neural_accuracy', neural_metrics['accuracy'])
        
        collection_time = (time.time() - collection_start) * 1000
        
        # Wait a moment for real-time aggregation
        await asyncio.sleep(0.1)
        
        # Get current aggregated metrics
        current_metrics = self.get_current_metrics()
        
        # Filter metrics for this swarm
        swarm_metrics = {
            name: metric for name, metric in current_metrics.items()
            if metric.tags.get('swarm_id') == swarm_id
        }
        
        return {
            'collection_time_ms': collection_time,
            'metrics_collected': len(swarm_metrics),
            'swarm_metrics': {name: asdict(metric) for name, metric in swarm_metrics.items()},
            'performance_summary': self.get_performance_summary(swarm_id)
        }