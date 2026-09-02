"""SWE-bench metrics collection and analysis system."""

import time
import psutil
import threading
import json
from dataclasses import dataclass, field, asdict
from datetime import datetime, timedelta
from typing import Dict, List, Any, Optional, Callable
from collections import defaultdict, deque
from pathlib import Path
import statistics

from .datasets import SWEBenchTask, SWEBenchCategory
from .evaluator import EvaluationResult


@dataclass
class SystemMetrics:
    """System resource metrics snapshot."""
    timestamp: datetime
    cpu_percent: float
    memory_percent: float
    memory_available_gb: float
    memory_used_gb: float
    disk_io_read_mb: float
    disk_io_write_mb: float
    network_bytes_sent: int
    network_bytes_recv: int
    active_processes: int
    load_average: List[float] = field(default_factory=list)


@dataclass
class TaskMetrics:
    """Metrics for individual task execution."""
    task_id: str
    category: str
    difficulty: str
    start_time: datetime
    end_time: Optional[datetime] = None
    duration_seconds: float = 0.0
    peak_memory_mb: float = 0.0
    avg_cpu_percent: float = 0.0
    max_cpu_percent: float = 0.0
    network_usage_mb: float = 0.0
    disk_usage_mb: float = 0.0
    agent_count: int = 0
    coordination_calls: int = 0
    api_calls: int = 0
    tokens_used: int = 0
    error_count: int = 0
    retry_count: int = 0
    success: bool = False
    evaluation_score: float = 0.0
    
    def finalize(self, end_time: datetime, success: bool, evaluation_score: float = 0.0):
        """Finalize task metrics."""
        self.end_time = end_time
        self.duration_seconds = (end_time - self.start_time).total_seconds()
        self.success = success
        self.evaluation_score = evaluation_score


@dataclass
class SwarmMetrics:
    """Metrics for swarm coordination and performance."""
    swarm_id: str
    topology: str
    agent_count: int
    start_time: datetime
    active_agents: int = 0
    idle_agents: int = 0
    failed_agents: int = 0
    total_tasks_assigned: int = 0
    total_tasks_completed: int = 0
    total_coordination_overhead_ms: float = 0.0
    average_task_distribution_time_ms: float = 0.0
    load_balancing_efficiency: float = 0.0
    communication_latency_ms: float = 0.0
    consensus_time_ms: float = 0.0
    fault_recovery_count: int = 0
    
    def calculate_efficiency(self) -> float:
        """Calculate overall swarm efficiency."""
        if self.agent_count == 0:
            return 0.0
        
        utilization = self.active_agents / self.agent_count
        success_rate = (self.total_tasks_completed / self.total_tasks_assigned 
                       if self.total_tasks_assigned > 0 else 0.0)
        
        return (utilization * 0.6) + (success_rate * 0.4)


@dataclass
class PerformanceBaseline:
    """Performance baseline for comparison."""
    category: str
    difficulty: str
    expected_duration_seconds: float
    expected_memory_mb: float
    expected_cpu_percent: float
    expected_success_rate: float
    confidence_interval: float = 0.95
    sample_size: int = 0
    last_updated: datetime = field(default_factory=datetime.now)


class SWEBenchMetrics:
    """Comprehensive metrics collection and analysis for SWE-bench."""
    
    def __init__(self, collection_interval: float = 1.0):
        """Initialize metrics collector.
        
        Args:
            collection_interval: Interval in seconds for system metrics collection
        """
        self.collection_interval = collection_interval
        self.is_collecting = False
        self.collection_thread: Optional[threading.Thread] = None
        
        # Metrics storage
        self.system_metrics: deque = deque(maxlen=1000)  # Keep last 1000 samples
        self.task_metrics: Dict[str, TaskMetrics] = {}
        self.swarm_metrics: Dict[str, SwarmMetrics] = {}
        self.evaluation_results: Dict[str, EvaluationResult] = {}
        
        # Performance baselines
        self.baselines: Dict[str, PerformanceBaseline] = {}
        self._load_baselines()
        
        # Real-time tracking
        self.active_tasks: Dict[str, TaskMetrics] = {}
        self.current_swarm: Optional[SwarmMetrics] = None
        
        # Aggregated statistics
        self.session_start_time = datetime.now()
        self.total_tasks_executed = 0
        self.total_success_count = 0
        self.total_execution_time = 0.0
        
        # Event listeners
        self.event_listeners: Dict[str, List[Callable]] = defaultdict(list)
    
    def start_collection(self) -> None:
        """Start system metrics collection."""
        if self.is_collecting:
            return
        
        self.is_collecting = True
        self.session_start_time = datetime.now()
        self.collection_thread = threading.Thread(target=self._collect_system_metrics, daemon=True)
        self.collection_thread.start()
    
    def stop_collection(self) -> Dict[str, Any]:
        """Stop metrics collection and return summary.
        
        Returns:
            Summary of collected metrics
        """
        self.is_collecting = False
        if self.collection_thread:
            self.collection_thread.join(timeout=2.0)
        
        return self.get_session_summary()
    
    def _collect_system_metrics(self) -> None:
        """Collect system metrics in background thread."""
        while self.is_collecting:
            try:
                # Collect current system metrics
                cpu_percent = psutil.cpu_percent(interval=None)
                memory = psutil.virtual_memory()
                disk_io = psutil.disk_io_counters()
                network_io = psutil.net_io_counters()
                
                metrics = SystemMetrics(
                    timestamp=datetime.now(),
                    cpu_percent=cpu_percent,
                    memory_percent=memory.percent,
                    memory_available_gb=memory.available / (1024**3),
                    memory_used_gb=memory.used / (1024**3),
                    disk_io_read_mb=disk_io.read_bytes / (1024**2) if disk_io else 0,
                    disk_io_write_mb=disk_io.write_bytes / (1024**2) if disk_io else 0,
                    network_bytes_sent=network_io.bytes_sent if network_io else 0,
                    network_bytes_recv=network_io.bytes_recv if network_io else 0,
                    active_processes=len(psutil.pids()),
                    load_average=list(psutil.getloadavg()) if hasattr(psutil, 'getloadavg') else []
                )
                
                self.system_metrics.append(metrics)
                
                # Update active task metrics
                self._update_active_task_metrics(metrics)
                
                # Trigger events
                self._trigger_event('metrics_collected', metrics)
                
            except Exception as e:
                print(f"Error collecting system metrics: {e}")
            
            time.sleep(self.collection_interval)
    
    def start_task_tracking(self, task: SWEBenchTask, agent_count: int = 1) -> None:
        """Start tracking metrics for a task.
        
        Args:
            task: The SWE-bench task to track
            agent_count: Number of agents working on the task
        """
        metrics = TaskMetrics(
            task_id=task.id,
            category=task.category.value,
            difficulty=task.difficulty.value,
            start_time=datetime.now(),
            agent_count=agent_count
        )
        
        self.active_tasks[task.id] = metrics
        self.task_metrics[task.id] = metrics
        
        self._trigger_event('task_started', task, metrics)
    
    def end_task_tracking(
        self, 
        task_id: str, 
        success: bool, 
        evaluation_result: Optional[EvaluationResult] = None
    ) -> None:
        """End tracking for a task.
        
        Args:
            task_id: ID of the task to stop tracking
            success: Whether the task was successful
            evaluation_result: Optional evaluation result
        """
        if task_id not in self.active_tasks:
            return
        
        metrics = self.active_tasks[task_id]
        evaluation_score = evaluation_result.score if evaluation_result else 0.0
        
        metrics.finalize(datetime.now(), success, evaluation_score)
        
        if evaluation_result:
            self.evaluation_results[task_id] = evaluation_result
            metrics.error_count = len(evaluation_result.errors)
        
        # Update session totals
        self.total_tasks_executed += 1
        if success:
            self.total_success_count += 1
        self.total_execution_time += metrics.duration_seconds
        
        # Remove from active tracking
        del self.active_tasks[task_id]
        
        self._trigger_event('task_completed', task_id, metrics)
        
        # Update baselines
        self._update_baseline(metrics)
    
    def start_swarm_tracking(self, swarm_id: str, topology: str, agent_count: int) -> None:
        """Start tracking swarm metrics.
        
        Args:
            swarm_id: Unique identifier for the swarm
            topology: Swarm topology type
            agent_count: Number of agents in the swarm
        """
        metrics = SwarmMetrics(
            swarm_id=swarm_id,
            topology=topology,
            agent_count=agent_count,
            start_time=datetime.now(),
            active_agents=agent_count,
            idle_agents=0
        )
        
        self.swarm_metrics[swarm_id] = metrics
        self.current_swarm = metrics
        
        self._trigger_event('swarm_started', swarm_id, metrics)
    
    def update_swarm_metrics(
        self, 
        swarm_id: str, 
        active_agents: Optional[int] = None,
        tasks_assigned: Optional[int] = None,
        tasks_completed: Optional[int] = None,
        coordination_overhead_ms: Optional[float] = None
    ) -> None:
        """Update swarm metrics.
        
        Args:
            swarm_id: Swarm identifier
            active_agents: Current number of active agents
            tasks_assigned: Number of tasks assigned
            tasks_completed: Number of tasks completed
            coordination_overhead_ms: Coordination overhead in milliseconds
        """
        if swarm_id not in self.swarm_metrics:
            return
        
        metrics = self.swarm_metrics[swarm_id]
        
        if active_agents is not None:
            metrics.active_agents = active_agents
            metrics.idle_agents = metrics.agent_count - active_agents
        
        if tasks_assigned is not None:
            metrics.total_tasks_assigned += tasks_assigned
        
        if tasks_completed is not None:
            metrics.total_tasks_completed += tasks_completed
        
        if coordination_overhead_ms is not None:
            metrics.total_coordination_overhead_ms += coordination_overhead_ms
    
    def record_api_call(self, task_id: str, tokens_used: int = 0) -> None:
        """Record an API call for a task.
        
        Args:
            task_id: Task identifier
            tokens_used: Number of tokens consumed
        """
        if task_id in self.active_tasks:
            self.active_tasks[task_id].api_calls += 1
            self.active_tasks[task_id].tokens_used += tokens_used
    
    def record_coordination_call(self, task_id: str) -> None:
        """Record a coordination call for a task.
        
        Args:
            task_id: Task identifier
        """
        if task_id in self.active_tasks:
            self.active_tasks[task_id].coordination_calls += 1
    
    def record_error(self, task_id: str, error: str) -> None:
        """Record an error for a task.
        
        Args:
            task_id: Task identifier
            error: Error description
        """
        if task_id in self.active_tasks:
            self.active_tasks[task_id].error_count += 1
    
    def record_retry(self, task_id: str) -> None:
        """Record a retry for a task.
        
        Args:
            task_id: Task identifier
        """
        if task_id in self.active_tasks:
            self.active_tasks[task_id].retry_count += 1
    
    def get_task_metrics(self, task_id: str) -> Optional[TaskMetrics]:
        """Get metrics for a specific task.
        
        Args:
            task_id: Task identifier
            
        Returns:
            Task metrics if available
        """
        return self.task_metrics.get(task_id)
    
    def get_category_statistics(self, category: str) -> Dict[str, Any]:
        """Get statistics for a specific category.
        
        Args:
            category: Task category
            
        Returns:
            Category statistics
        """
        category_metrics = [m for m in self.task_metrics.values() if m.category == category]
        
        if not category_metrics:
            return {"error": f"No metrics found for category: {category}"}
        
        durations = [m.duration_seconds for m in category_metrics if m.duration_seconds > 0]
        scores = [m.evaluation_score for m in category_metrics if m.evaluation_score > 0]
        success_count = sum(1 for m in category_metrics if m.success)
        
        stats = {
            "category": category,
            "total_tasks": len(category_metrics),
            "successful_tasks": success_count,
            "success_rate": success_count / len(category_metrics),
            "average_duration": statistics.mean(durations) if durations else 0,
            "median_duration": statistics.median(durations) if durations else 0,
            "min_duration": min(durations) if durations else 0,
            "max_duration": max(durations) if durations else 0,
            "average_score": statistics.mean(scores) if scores else 0,
            "median_score": statistics.median(scores) if scores else 0
        }
        
        # Add difficulty breakdown
        difficulty_stats = defaultdict(lambda: {"count": 0, "success_count": 0})
        for m in category_metrics:
            difficulty_stats[m.difficulty]["count"] += 1
            if m.success:
                difficulty_stats[m.difficulty]["success_count"] += 1
        
        stats["by_difficulty"] = {
            diff: {
                "total": data["count"],
                "successful": data["success_count"],
                "success_rate": data["success_count"] / data["count"] if data["count"] > 0 else 0
            }
            for diff, data in difficulty_stats.items()
        }
        
        return stats
    
    def get_performance_comparison(self, task_id: str) -> Dict[str, Any]:
        """Compare task performance against baseline.
        
        Args:
            task_id: Task identifier
            
        Returns:
            Performance comparison data
        """
        if task_id not in self.task_metrics:
            return {"error": "Task not found"}
        
        metrics = self.task_metrics[task_id]
        baseline_key = f"{metrics.category}_{metrics.difficulty}"
        baseline = self.baselines.get(baseline_key)
        
        comparison = {
            "task_id": task_id,
            "actual_metrics": asdict(metrics),
            "has_baseline": baseline is not None
        }
        
        if baseline:
            comparison.update({
                "baseline": asdict(baseline),
                "comparison": {
                    "duration_ratio": metrics.duration_seconds / baseline.expected_duration_seconds,
                    "memory_ratio": metrics.peak_memory_mb / baseline.expected_memory_mb if baseline.expected_memory_mb > 0 else 0,
                    "cpu_ratio": metrics.avg_cpu_percent / baseline.expected_cpu_percent if baseline.expected_cpu_percent > 0 else 0,
                    "better_than_baseline": {
                        "duration": metrics.duration_seconds < baseline.expected_duration_seconds,
                        "memory": metrics.peak_memory_mb < baseline.expected_memory_mb,
                        "cpu": metrics.avg_cpu_percent < baseline.expected_cpu_percent
                    }
                }
            })
        
        return comparison
    
    def get_system_health(self) -> Dict[str, Any]:
        """Get current system health metrics.
        
        Returns:
            System health information
        """
        if not self.system_metrics:
            return {"error": "No system metrics available"}
        
        recent_metrics = list(self.system_metrics)[-10:]  # Last 10 samples
        current = recent_metrics[-1]
        
        health = {
            "timestamp": current.timestamp.isoformat(),
            "current": asdict(current),
            "status": "healthy"
        }
        
        # Determine health status
        if current.cpu_percent > 90:
            health["status"] = "critical"
            health["issues"] = health.get("issues", [])
            health["issues"].append("High CPU usage")
        elif current.cpu_percent > 75:
            health["status"] = "warning"
            health["warnings"] = health.get("warnings", [])
            health["warnings"].append("Elevated CPU usage")
        
        if current.memory_percent > 90:
            health["status"] = "critical"
            health["issues"] = health.get("issues", [])
            health["issues"].append("High memory usage")
        elif current.memory_percent > 75:
            health["status"] = "warning"
            health["warnings"] = health.get("warnings", [])
            health["warnings"].append("Elevated memory usage")
        
        # Add trends
        if len(recent_metrics) >= 5:
            cpu_trend = [m.cpu_percent for m in recent_metrics]
            memory_trend = [m.memory_percent for m in recent_metrics]
            
            health["trends"] = {
                "cpu_increasing": cpu_trend[-1] > cpu_trend[0],
                "memory_increasing": memory_trend[-1] > memory_trend[0],
                "cpu_avg": statistics.mean(cpu_trend),
                "memory_avg": statistics.mean(memory_trend)
            }
        
        return health
    
    def get_session_summary(self) -> Dict[str, Any]:
        """Get comprehensive session summary.
        
        Returns:
            Session summary with all metrics
        """
        session_duration = (datetime.now() - self.session_start_time).total_seconds()
        
        summary = {
            "session": {
                "start_time": self.session_start_time.isoformat(),
                "duration_seconds": session_duration,
                "total_tasks": self.total_tasks_executed,
                "successful_tasks": self.total_success_count,
                "success_rate": self.total_success_count / self.total_tasks_executed if self.total_tasks_executed > 0 else 0,
                "total_execution_time": self.total_execution_time,
                "efficiency": self.total_execution_time / session_duration if session_duration > 0 else 0
            },
            "categories": {},
            "system_metrics": {
                "samples_collected": len(self.system_metrics),
                "health_status": self.get_system_health().get("status", "unknown")
            },
            "swarms": {}
        }
        
        # Category summaries
        categories = set(m.category for m in self.task_metrics.values())
        for category in categories:
            summary["categories"][category] = self.get_category_statistics(category)
        
        # Swarm summaries
        for swarm_id, swarm_metrics in self.swarm_metrics.items():
            summary["swarms"][swarm_id] = {
                "topology": swarm_metrics.topology,
                "agent_count": swarm_metrics.agent_count,
                "efficiency": swarm_metrics.calculate_efficiency(),
                "tasks_completed": swarm_metrics.total_tasks_completed,
                "coordination_overhead_ms": swarm_metrics.total_coordination_overhead_ms
            }
        
        return summary
    
    def export_metrics(self, output_path: Path, format: str = "json") -> None:
        """Export all metrics to file.
        
        Args:
            output_path: Path to output file
            format: Export format ('json' or 'csv')
        """
        output_path.parent.mkdir(parents=True, exist_ok=True)
        
        if format.lower() == "json":
            data = {
                "session_summary": self.get_session_summary(),
                "task_metrics": {k: asdict(v) for k, v in self.task_metrics.items()},
                "swarm_metrics": {k: asdict(v) for k, v in self.swarm_metrics.items()},
                "evaluation_results": {k: asdict(v) for k, v in self.evaluation_results.items()},
                "system_metrics": [asdict(m) for m in self.system_metrics],
                "baselines": {k: asdict(v) for k, v in self.baselines.items()}
            }
            
            with open(output_path, 'w') as f:
                json.dump(data, f, indent=2, default=str)
        
        elif format.lower() == "csv":
            import csv
            
            # Export task metrics as CSV
            with open(output_path, 'w', newline='') as f:
                if self.task_metrics:
                    writer = csv.DictWriter(f, fieldnames=asdict(next(iter(self.task_metrics.values()))).keys())
                    writer.writeheader()
                    for metrics in self.task_metrics.values():
                        writer.writerow(asdict(metrics))
    
    def create_performance_report(self) -> Dict[str, Any]:
        """Create a comprehensive performance report.
        
        Returns:
            Detailed performance report
        """
        report = {
            "generated_at": datetime.now().isoformat(),
            "session_summary": self.get_session_summary(),
            "performance_insights": self._generate_performance_insights(),
            "recommendations": self._generate_recommendations(),
            "baseline_comparisons": self._generate_baseline_comparisons()
        }
        
        return report
    
    def add_event_listener(self, event: str, callback: Callable) -> None:
        """Add an event listener.
        
        Args:
            event: Event name
            callback: Callback function
        """
        self.event_listeners[event].append(callback)
    
    def _update_active_task_metrics(self, system_metrics: SystemMetrics) -> None:
        """Update metrics for active tasks based on current system state."""
        for task_id, task_metrics in self.active_tasks.items():
            # Update peak values
            task_metrics.peak_memory_mb = max(
                task_metrics.peak_memory_mb, 
                system_metrics.memory_used_gb * 1024
            )
            
            task_metrics.max_cpu_percent = max(
                task_metrics.max_cpu_percent,
                system_metrics.cpu_percent
            )
            
            # Update running averages (simplified)
            if task_metrics.avg_cpu_percent == 0:
                task_metrics.avg_cpu_percent = system_metrics.cpu_percent
            else:
                task_metrics.avg_cpu_percent = (
                    task_metrics.avg_cpu_percent * 0.8 + 
                    system_metrics.cpu_percent * 0.2
                )
    
    def _trigger_event(self, event: str, *args, **kwargs) -> None:
        """Trigger event listeners."""
        for callback in self.event_listeners.get(event, []):
            try:
                callback(*args, **kwargs)
            except Exception as e:
                print(f"Error in event listener for {event}: {e}")
    
    def _load_baselines(self) -> None:
        """Load performance baselines."""
        # Default baselines - would typically be loaded from data
        default_baselines = {
            "code_generation_easy": PerformanceBaseline(
                category="code_generation",
                difficulty="easy",
                expected_duration_seconds=30.0,
                expected_memory_mb=50.0,
                expected_cpu_percent=40.0,
                expected_success_rate=0.85
            ),
            "code_generation_medium": PerformanceBaseline(
                category="code_generation",
                difficulty="medium",
                expected_duration_seconds=60.0,
                expected_memory_mb=100.0,
                expected_cpu_percent=60.0,
                expected_success_rate=0.75
            ),
            "code_generation_hard": PerformanceBaseline(
                category="code_generation",
                difficulty="hard",
                expected_duration_seconds=120.0,
                expected_memory_mb=200.0,
                expected_cpu_percent=80.0,
                expected_success_rate=0.60
            ),
            "bug_fix_medium": PerformanceBaseline(
                category="bug_fix",
                difficulty="medium",
                expected_duration_seconds=45.0,
                expected_memory_mb=75.0,
                expected_cpu_percent=50.0,
                expected_success_rate=0.80
            ),
            "performance_hard": PerformanceBaseline(
                category="performance",
                difficulty="hard",
                expected_duration_seconds=90.0,
                expected_memory_mb=150.0,
                expected_cpu_percent=70.0,
                expected_success_rate=0.70
            )
        }
        
        self.baselines.update(default_baselines)
    
    def _update_baseline(self, metrics: TaskMetrics) -> None:
        """Update baseline based on new task metrics."""
        baseline_key = f"{metrics.category}_{metrics.difficulty}"
        
        if baseline_key not in self.baselines:
            # Create new baseline
            self.baselines[baseline_key] = PerformanceBaseline(
                category=metrics.category,
                difficulty=metrics.difficulty,
                expected_duration_seconds=metrics.duration_seconds,
                expected_memory_mb=metrics.peak_memory_mb,
                expected_cpu_percent=metrics.avg_cpu_percent,
                expected_success_rate=1.0 if metrics.success else 0.0,
                sample_size=1
            )
        else:
            # Update existing baseline (exponential moving average)
            baseline = self.baselines[baseline_key]
            alpha = 0.1  # Learning rate
            
            baseline.expected_duration_seconds = (
                (1 - alpha) * baseline.expected_duration_seconds + 
                alpha * metrics.duration_seconds
            )
            baseline.expected_memory_mb = (
                (1 - alpha) * baseline.expected_memory_mb + 
                alpha * metrics.peak_memory_mb
            )
            baseline.expected_cpu_percent = (
                (1 - alpha) * baseline.expected_cpu_percent + 
                alpha * metrics.avg_cpu_percent
            )
            baseline.expected_success_rate = (
                (1 - alpha) * baseline.expected_success_rate + 
                alpha * (1.0 if metrics.success else 0.0)
            )
            baseline.sample_size += 1
            baseline.last_updated = datetime.now()
    
    def _generate_performance_insights(self) -> List[str]:
        """Generate performance insights based on collected metrics."""
        insights = []
        
        if self.total_tasks_executed == 0:
            return ["No tasks executed yet"]
        
        success_rate = self.total_success_count / self.total_tasks_executed
        avg_duration = self.total_execution_time / self.total_tasks_executed
        
        # Success rate insights
        if success_rate >= 0.9:
            insights.append("Excellent success rate achieved (>90%)")
        elif success_rate >= 0.8:
            insights.append("Good success rate (80-90%), with room for improvement")
        elif success_rate >= 0.6:
            insights.append("Moderate success rate (60-80%), optimization recommended")
        else:
            insights.append("Low success rate (<60%), significant improvements needed")
        
        # Duration insights
        if avg_duration <= 30:
            insights.append("Fast task execution times (<30s average)")
        elif avg_duration <= 60:
            insights.append("Reasonable task execution times (30-60s average)")
        else:
            insights.append("Slow task execution times (>60s average)")
        
        # Category-specific insights
        categories = set(m.category for m in self.task_metrics.values())
        for category in categories:
            stats = self.get_category_statistics(category)
            if stats["success_rate"] < success_rate * 0.8:
                insights.append(f"Category '{category}' performing below average")
            elif stats["success_rate"] > success_rate * 1.2:
                insights.append(f"Category '{category}' performing above average")
        
        return insights
    
    def _generate_recommendations(self) -> List[str]:
        """Generate optimization recommendations."""
        recommendations = []
        
        if self.total_tasks_executed == 0:
            return ["Execute more tasks to generate recommendations"]
        
        success_rate = self.total_success_count / self.total_tasks_executed
        avg_duration = self.total_execution_time / self.total_tasks_executed
        
        # Performance recommendations
        if success_rate < 0.7:
            recommendations.append("Consider increasing agent count or timeout values to improve success rate")
        
        if avg_duration > 60:
            recommendations.append("Optimize for speed: consider parallel execution or lighter coordination modes")
        
        # System resource recommendations
        if self.system_metrics:
            recent_metrics = list(self.system_metrics)[-10:]
            avg_cpu = statistics.mean(m.cpu_percent for m in recent_metrics)
            avg_memory = statistics.mean(m.memory_percent for m in recent_metrics)
            
            if avg_cpu > 80:
                recommendations.append("High CPU usage detected - consider reducing concurrent tasks")
            elif avg_cpu < 30:
                recommendations.append("Low CPU usage - consider increasing parallelism")
            
            if avg_memory > 80:
                recommendations.append("High memory usage detected - optimize memory-intensive operations")
        
        # Category-specific recommendations
        categories = set(m.category for m in self.task_metrics.values())
        for category in categories:
            stats = self.get_category_statistics(category)
            if stats["success_rate"] < 0.6:
                recommendations.append(f"Focus improvement efforts on '{category}' category")
        
        return recommendations
    
    def _generate_baseline_comparisons(self) -> Dict[str, Any]:
        """Generate comparisons against baselines."""
        comparisons = {}
        
        for task_id, metrics in self.task_metrics.items():
            baseline_key = f"{metrics.category}_{metrics.difficulty}"
            if baseline_key in self.baselines:
                comparison = self.get_performance_comparison(task_id)
                if "comparison" in comparison:
                    comparisons[task_id] = comparison["comparison"]
        
        return comparisons