"""Aggregates metrics from multiple sources for comprehensive analysis."""

from __future__ import annotations
import time
from typing import Dict, List, Optional, Any, Tuple
from dataclasses import dataclass, field
from datetime import datetime
from pathlib import Path
import json
import statistics
from collections import defaultdict

from .performance_collector import PerformanceCollector
from .resource_monitor import ResourceMonitor, SystemResourceMonitor
from .process_tracker import ProcessTracker, ProcessExecutionResult
from ..core.models import (
    PerformanceMetrics, ResourceUsage, BenchmarkMetrics,
    Result, Task, Agent, ResultStatus
)


@dataclass
class AggregatedMetrics:
    """Comprehensive metrics from all sources."""
    # Timing metrics
    wall_clock_time: float = 0.0
    cpu_time: float = 0.0
    system_time: float = 0.0
    
    # Performance metrics
    tasks_per_second: float = 0.0
    average_task_duration: float = 0.0
    median_task_duration: float = 0.0
    p95_task_duration: float = 0.0
    p99_task_duration: float = 0.0
    
    # Resource metrics
    peak_memory_mb: float = 0.0
    average_memory_mb: float = 0.0
    total_cpu_seconds: float = 0.0
    average_cpu_percent: float = 0.0
    
    # I/O metrics
    total_disk_read_mb: float = 0.0
    total_disk_write_mb: float = 0.0
    total_network_sent_mb: float = 0.0
    total_network_recv_mb: float = 0.0
    
    # Process metrics
    total_processes: int = 0
    peak_thread_count: int = 0
    peak_fd_count: int = 0
    
    # Output metrics
    total_output_size: int = 0
    average_output_size: int = 0
    output_complexity_score: float = 0.0
    
    # Success metrics
    success_rate: float = 0.0
    error_rate: float = 0.0
    timeout_rate: float = 0.0
    retry_rate: float = 0.0
    
    # Coordination metrics
    coordination_overhead_percent: float = 0.0
    communication_latency_ms: float = 0.0
    agent_utilization: float = 0.0
    

class MetricsAggregator:
    """Aggregates metrics from multiple collection sources."""
    
    def __init__(self):
        """Initialize metrics aggregator."""
        self._performance_collectors: Dict[str, PerformanceCollector] = {}
        self._resource_monitors: Dict[str, ResourceMonitor] = {}
        self._process_tracker = ProcessTracker()
        self._system_monitor = SystemResourceMonitor()
        self._start_time: Optional[float] = None
        self._end_time: Optional[float] = None
        
    def start_collection(self) -> None:
        """Start metrics collection."""
        self._start_time = time.time()
        self._system_monitor.take_baseline()
        
    def stop_collection(self) -> AggregatedMetrics:
        """Stop collection and return aggregated metrics."""
        self._end_time = time.time()
        return self._aggregate_all_metrics()
        
    def create_performance_collector(self, name: str) -> PerformanceCollector:
        """Create a named performance collector."""
        collector = PerformanceCollector()
        self._performance_collectors[name] = collector
        return collector
        
    def create_resource_monitor(self, name: str) -> ResourceMonitor:
        """Create a named resource monitor."""
        monitor = ResourceMonitor()
        self._resource_monitors[name] = monitor
        return monitor
        
    def get_process_tracker(self) -> ProcessTracker:
        """Get the process tracker instance."""
        return self._process_tracker
        
    def _aggregate_all_metrics(self) -> AggregatedMetrics:
        """Aggregate metrics from all sources."""
        metrics = AggregatedMetrics()
        
        # Calculate timing
        if self._start_time and self._end_time:
            metrics.wall_clock_time = self._end_time - self._start_time
            
        # Aggregate performance metrics
        self._aggregate_performance_metrics(metrics)
        
        # Aggregate resource metrics
        self._aggregate_resource_metrics(metrics)
        
        # Aggregate process metrics
        self._aggregate_process_metrics(metrics)
        
        # Calculate system-wide metrics
        self._calculate_system_metrics(metrics)
        
        return metrics
        
    def _aggregate_performance_metrics(self, metrics: AggregatedMetrics) -> None:
        """Aggregate performance collector metrics."""
        if not self._performance_collectors:
            return
            
        execution_times = []
        total_cpu_time = 0.0
        
        for collector in self._performance_collectors.values():
            perf_metrics = collector._aggregate_metrics()
            execution_times.append(perf_metrics.execution_time)
            
            # Get detailed metrics
            detailed = collector.get_detailed_metrics()
            if detailed and "intervals" in detailed:
                for interval in detailed["intervals"]:
                    total_cpu_time += interval.get("total_cpu_percent", 0) * 0.001  # Convert to seconds
                    
        if execution_times:
            metrics.average_task_duration = statistics.mean(execution_times)
            metrics.median_task_duration = statistics.median(execution_times)
            
            if len(execution_times) >= 20:
                sorted_times = sorted(execution_times)
                metrics.p95_task_duration = sorted_times[int(len(sorted_times) * 0.95)]
                metrics.p99_task_duration = sorted_times[int(len(sorted_times) * 0.99)]
                
        metrics.total_cpu_seconds = total_cpu_time
        
        if metrics.wall_clock_time > 0:
            metrics.tasks_per_second = len(execution_times) / metrics.wall_clock_time
            
    def _aggregate_resource_metrics(self, metrics: AggregatedMetrics) -> None:
        """Aggregate resource monitor metrics."""
        if not self._resource_monitors:
            return
            
        memory_values = []
        peak_memories = []
        thread_counts = []
        fd_counts = []
        
        for monitor in self._resource_monitors.values():
            stats = monitor.get_statistics()
            if stats and "memory_mb" in stats:
                memory_values.append(stats["memory_mb"]["mean"])
                peak_memories.append(stats["memory_mb"]["max"])
                
            if stats and "threads" in stats:
                thread_counts.append(stats["threads"]["max"])
                
            # Get FD counts from history
            for snapshot in monitor._history:
                fd_counts.append(snapshot.fd_count)
                
        if memory_values:
            metrics.average_memory_mb = statistics.mean(memory_values)
            
        if peak_memories:
            metrics.peak_memory_mb = max(peak_memories)
            
        if thread_counts:
            metrics.peak_thread_count = max(thread_counts)
            
        if fd_counts:
            metrics.peak_fd_count = max(fd_counts)
            
    def _aggregate_process_metrics(self, metrics: AggregatedMetrics) -> None:
        """Aggregate process tracker metrics."""
        summary = self._process_tracker.get_execution_summary()
        
        metrics.total_processes = summary.get("total_executions", 0)
        metrics.success_rate = summary.get("overall_success_rate", 0.0)
        metrics.error_rate = 1.0 - metrics.success_rate
        metrics.total_output_size = summary.get("total_output_lines", 0)
        
        if metrics.total_processes > 0:
            metrics.average_output_size = metrics.total_output_size // metrics.total_processes
            
        # Calculate output complexity (lines per second)
        if metrics.wall_clock_time > 0:
            metrics.output_complexity_score = metrics.total_output_size / metrics.wall_clock_time
            
    def _calculate_system_metrics(self, metrics: AggregatedMetrics) -> None:
        """Calculate system-wide metrics."""
        system_delta = self._system_monitor.measure_delta()
        
        if system_delta:
            metrics.total_disk_read_mb = system_delta.get("disk_read_mb", 0)
            metrics.total_disk_write_mb = system_delta.get("disk_write_mb", 0)
            metrics.total_network_sent_mb = system_delta.get("network_sent_mb", 0)
            metrics.total_network_recv_mb = system_delta.get("network_recv_mb", 0)
            
        # Calculate CPU utilization
        if metrics.total_cpu_seconds > 0 and metrics.wall_clock_time > 0:
            # CPU seconds / wall time / number of cores
            import psutil
            num_cores = psutil.cpu_count()
            metrics.average_cpu_percent = (metrics.total_cpu_seconds / metrics.wall_clock_time / num_cores) * 100
            
    def aggregate_benchmark_results(self, results: List[Result]) -> BenchmarkMetrics:
        """Aggregate results into benchmark metrics."""
        benchmark_metrics = BenchmarkMetrics()
        
        if not results:
            return benchmark_metrics
            
        # Aggregate from our collectors
        aggregated = self._aggregate_all_metrics()
        
        # Update benchmark metrics
        benchmark_metrics.total_tasks = len(results)
        benchmark_metrics.completed_tasks = len([r for r in results if r.status == ResultStatus.SUCCESS])
        benchmark_metrics.failed_tasks = len([r for r in results if r.status in [ResultStatus.FAILURE, ResultStatus.ERROR]])
        benchmark_metrics.success_rate = aggregated.success_rate
        benchmark_metrics.average_execution_time = aggregated.average_task_duration
        benchmark_metrics.total_execution_time = aggregated.wall_clock_time
        benchmark_metrics.throughput = aggregated.tasks_per_second
        benchmark_metrics.peak_memory_usage = aggregated.peak_memory_mb
        benchmark_metrics.total_cpu_time = aggregated.total_cpu_seconds
        
        # Calculate efficiency metrics
        if aggregated.wall_clock_time > 0:
            # Resource efficiency: how well resources were utilized
            benchmark_metrics.resource_efficiency = min(1.0, aggregated.average_cpu_percent / 100.0)
            
            # Coordination efficiency: overhead of coordination
            benchmark_metrics.coordination_efficiency = 1.0 - (aggregated.coordination_overhead_percent / 100.0)
            
        # Network overhead
        benchmark_metrics.network_overhead = (
            aggregated.total_network_sent_mb + aggregated.total_network_recv_mb
        )
        
        return benchmark_metrics
        
    def save_detailed_report(self, filepath: Path) -> None:
        """Save comprehensive metrics report."""
        aggregated = self._aggregate_all_metrics()
        
        report = {
            "summary": {
                "wall_clock_time": aggregated.wall_clock_time,
                "tasks_per_second": aggregated.tasks_per_second,
                "success_rate": aggregated.success_rate,
                "peak_memory_mb": aggregated.peak_memory_mb,
                "average_cpu_percent": aggregated.average_cpu_percent
            },
            "performance": {
                "average_duration": aggregated.average_task_duration,
                "median_duration": aggregated.median_task_duration,
                "p95_duration": aggregated.p95_task_duration,
                "p99_duration": aggregated.p99_task_duration,
                "total_cpu_seconds": aggregated.total_cpu_seconds
            },
            "resources": {
                "memory": {
                    "peak_mb": aggregated.peak_memory_mb,
                    "average_mb": aggregated.average_memory_mb
                },
                "cpu": {
                    "average_percent": aggregated.average_cpu_percent,
                    "total_seconds": aggregated.total_cpu_seconds
                },
                "io": {
                    "disk_read_mb": aggregated.total_disk_read_mb,
                    "disk_write_mb": aggregated.total_disk_write_mb,
                    "network_sent_mb": aggregated.total_network_sent_mb,
                    "network_recv_mb": aggregated.total_network_recv_mb
                }
            },
            "processes": {
                "total": aggregated.total_processes,
                "peak_threads": aggregated.peak_thread_count,
                "peak_fds": aggregated.peak_fd_count
            },
            "output": {
                "total_size": aggregated.total_output_size,
                "average_size": aggregated.average_output_size,
                "complexity_score": aggregated.output_complexity_score
            },
            "collectors": {
                "performance": len(self._performance_collectors),
                "resource": len(self._resource_monitors)
            },
            "timestamp": datetime.now().isoformat()
        }
        
        # Add process execution details
        report["process_executions"] = self._process_tracker.get_command_statistics()
        
        with open(filepath, "w") as f:
            json.dump(report, f, indent=2)