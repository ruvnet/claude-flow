"""JSON output writer for benchmark results."""

import json
from pathlib import Path
from typing import Dict, Any
from datetime import datetime

from ..core.models import Benchmark, Result


class JSONWriter:
    """Writes benchmark results to JSON files."""
    
    def __init__(self):
        """Initialize the JSON writer."""
        pass
    
    async def save_benchmark(self, benchmark: Benchmark, output_dir: Path) -> Path:
        """Save benchmark to JSON file.
        
        Args:
            benchmark: Benchmark to save
            output_dir: Output directory
            
        Returns:
            Path to saved file
        """
        output_file = output_dir / f"{benchmark.name}_{benchmark.id}.json"
        
        benchmark_data = self._benchmark_to_dict(benchmark)
        
        with open(output_file, 'w', encoding='utf-8') as f:
            json.dump(benchmark_data, f, indent=2, default=self._json_serializer)
        
        return output_file
    
    def _benchmark_to_dict(self, benchmark: Benchmark) -> Dict[str, Any]:
        """Convert benchmark to dictionary."""
        return {
            "id": benchmark.id,
            "name": benchmark.name,
            "description": benchmark.description,
            "status": benchmark.status.value,
            "config": self._config_to_dict(benchmark.config),
            "tasks": [self._task_to_dict(task) for task in benchmark.tasks],
            "results": [self._result_to_dict(result) for result in benchmark.results],
            "metrics": self._metrics_to_dict(benchmark.metrics),
            "created_at": benchmark.created_at.isoformat(),
            "started_at": benchmark.started_at.isoformat() if benchmark.started_at else None,
            "completed_at": benchmark.completed_at.isoformat() if benchmark.completed_at else None,
            "duration": benchmark.duration(),
            "error_log": benchmark.error_log,
            "metadata": benchmark.metadata
        }
    
    def _config_to_dict(self, config) -> Dict[str, Any]:
        """Convert config to dictionary."""
        return {
            "name": config.name,
            "description": config.description,
            "strategy": config.strategy.value,
            "mode": config.mode.value,
            "max_agents": config.max_agents,
            "max_tasks": config.max_tasks,
            "timeout": config.timeout,
            "task_timeout": config.task_timeout,
            "max_retries": config.max_retries,
            "parallel": config.parallel,
            "background": config.background,
            "monitoring": config.monitoring,
            "quality_threshold": config.quality_threshold,
            "resource_limits": config.resource_limits,
            "output_formats": config.output_formats,
            "output_directory": config.output_directory,
            "verbose": config.verbose
        }
    
    def _task_to_dict(self, task) -> Dict[str, Any]:
        """Convert task to dictionary."""
        return {
            "id": task.id,
            "objective": task.objective,
            "description": task.description,
            "strategy": task.strategy.value,
            "mode": task.mode.value,
            "parameters": task.parameters,
            "timeout": task.timeout,
            "max_retries": task.max_retries,
            "priority": task.priority,
            "status": task.status.value,
            "created_at": task.created_at.isoformat(),
            "started_at": task.started_at.isoformat() if task.started_at else None,
            "completed_at": task.completed_at.isoformat() if task.completed_at else None,
            "duration": task.duration(),
            "assigned_agents": task.assigned_agents,
            "parent_task_id": task.parent_task_id,
            "subtasks": task.subtasks,
            "dependencies": task.dependencies
        }
    
    def _result_to_dict(self, result: Result) -> Dict[str, Any]:
        """Convert result to dictionary."""
        return {
            "id": result.id,
            "task_id": result.task_id,
            "agent_id": result.agent_id,
            "status": result.status.value,
            "output": result.output,
            "errors": result.errors,
            "warnings": result.warnings,
            "performance_metrics": {
                "execution_time": result.performance_metrics.execution_time,
                "queue_time": result.performance_metrics.queue_time,
                "throughput": result.performance_metrics.throughput,
                "success_rate": result.performance_metrics.success_rate,
                "error_rate": result.performance_metrics.error_rate,
                "retry_count": result.performance_metrics.retry_count,
                "coordination_overhead": result.performance_metrics.coordination_overhead,
                "communication_latency": result.performance_metrics.communication_latency
            },
            "quality_metrics": {
                "accuracy_score": result.quality_metrics.accuracy_score,
                "completeness_score": result.quality_metrics.completeness_score,
                "consistency_score": result.quality_metrics.consistency_score,
                "relevance_score": result.quality_metrics.relevance_score,
                "overall_quality": result.quality_metrics.overall_quality,
                "review_score": result.quality_metrics.review_score,
                "automated_score": result.quality_metrics.automated_score
            },
            "resource_usage": {
                "cpu_percent": result.resource_usage.cpu_percent,
                "memory_mb": result.resource_usage.memory_mb,
                "network_bytes_sent": result.resource_usage.network_bytes_sent,
                "network_bytes_recv": result.resource_usage.network_bytes_recv,
                "disk_bytes_read": result.resource_usage.disk_bytes_read,
                "disk_bytes_write": result.resource_usage.disk_bytes_write,
                "peak_memory_mb": result.resource_usage.peak_memory_mb,
                "average_cpu_percent": result.resource_usage.average_cpu_percent
            },
            "execution_details": result.execution_details,
            "created_at": result.created_at.isoformat(),
            "started_at": result.started_at.isoformat() if result.started_at else None,
            "completed_at": result.completed_at.isoformat() if result.completed_at else None,
            "duration": result.duration()
        }
    
    def _metrics_to_dict(self, metrics) -> Dict[str, Any]:
        """Convert metrics to dictionary."""
        return {
            "total_tasks": metrics.total_tasks,
            "completed_tasks": metrics.completed_tasks,
            "failed_tasks": metrics.failed_tasks,
            "total_agents": metrics.total_agents,
            "active_agents": metrics.active_agents,
            "average_execution_time": metrics.average_execution_time,
            "total_execution_time": metrics.total_execution_time,
            "success_rate": metrics.success_rate,
            "throughput": metrics.throughput,
            "resource_efficiency": metrics.resource_efficiency,
            "coordination_efficiency": metrics.coordination_efficiency,
            "quality_score": metrics.quality_score,
            "peak_memory_usage": metrics.peak_memory_usage,
            "total_cpu_time": metrics.total_cpu_time,
            "network_overhead": metrics.network_overhead
        }
    
    def _json_serializer(self, obj):
        """JSON serializer for datetime and other objects."""
        if isinstance(obj, datetime):
            return obj.isoformat()
        raise TypeError(f"Object of type {type(obj)} is not JSON serializable")