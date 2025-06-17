"""SQLite database manager for benchmark results."""

import aiosqlite
import json
from pathlib import Path
from typing import Dict, Any, List, Optional
from datetime import datetime

from ..core.models import Benchmark, Task, Result, BenchmarkMetrics


class SQLiteManager:
    """Manages SQLite database for benchmark results."""
    
    def __init__(self):
        """Initialize the SQLite manager."""
        self.db_path: Optional[Path] = None
    
    async def save_benchmark(self, benchmark: Benchmark, output_dir: Path) -> Path:
        """Save benchmark to SQLite database.
        
        Args:
            benchmark: Benchmark to save
            output_dir: Output directory
            
        Returns:
            Path to database file
        """
        self.db_path = output_dir / "benchmark_results.db"
        
        await self._ensure_database()
        
        async with aiosqlite.connect(self.db_path) as db:
            # Insert benchmark
            await self._insert_benchmark(db, benchmark)
            
            # Insert tasks
            for task in benchmark.tasks:
                await self._insert_task(db, task, benchmark.id)
            
            # Insert results
            for result in benchmark.results:
                await self._insert_result(db, result, benchmark.id)
            
            await db.commit()
        
        return self.db_path
    
    async def _ensure_database(self) -> None:
        """Ensure database and tables exist."""
        async with aiosqlite.connect(self.db_path) as db:
            # Create benchmarks table
            await db.execute("""
                CREATE TABLE IF NOT EXISTS benchmarks (
                    id TEXT PRIMARY KEY,
                    name TEXT NOT NULL,
                    description TEXT,
                    status TEXT NOT NULL,
                    strategy TEXT NOT NULL,
                    mode TEXT NOT NULL,
                    config TEXT,
                    metrics TEXT,
                    created_at TEXT NOT NULL,
                    started_at TEXT,
                    completed_at TEXT,
                    duration REAL,
                    error_log TEXT,
                    metadata TEXT
                )
            """)
            
            # Create tasks table
            await db.execute("""
                CREATE TABLE IF NOT EXISTS tasks (
                    id TEXT PRIMARY KEY,
                    benchmark_id TEXT NOT NULL,
                    objective TEXT NOT NULL,
                    description TEXT,
                    strategy TEXT NOT NULL,
                    mode TEXT NOT NULL,
                    parameters TEXT,
                    timeout INTEGER,
                    max_retries INTEGER,
                    priority INTEGER,
                    status TEXT NOT NULL,
                    created_at TEXT NOT NULL,
                    started_at TEXT,
                    completed_at TEXT,
                    duration REAL,
                    assigned_agents TEXT,
                    parent_task_id TEXT,
                    subtasks TEXT,
                    dependencies TEXT,
                    FOREIGN KEY (benchmark_id) REFERENCES benchmarks (id)
                )
            """)
            
            # Create results table
            await db.execute("""
                CREATE TABLE IF NOT EXISTS results (
                    id TEXT PRIMARY KEY,
                    benchmark_id TEXT NOT NULL,
                    task_id TEXT NOT NULL,
                    agent_id TEXT NOT NULL,
                    status TEXT NOT NULL,
                    output TEXT,
                    errors TEXT,
                    warnings TEXT,
                    performance_metrics TEXT,
                    quality_metrics TEXT,
                    resource_usage TEXT,
                    execution_details TEXT,
                    created_at TEXT NOT NULL,
                    started_at TEXT,
                    completed_at TEXT,
                    duration REAL,
                    FOREIGN KEY (benchmark_id) REFERENCES benchmarks (id),
                    FOREIGN KEY (task_id) REFERENCES tasks (id)
                )
            """)
            
            # Create indexes for better query performance
            await db.execute("CREATE INDEX IF NOT EXISTS idx_benchmarks_created_at ON benchmarks (created_at)")
            await db.execute("CREATE INDEX IF NOT EXISTS idx_benchmarks_strategy ON benchmarks (strategy)")
            await db.execute("CREATE INDEX IF NOT EXISTS idx_benchmarks_mode ON benchmarks (mode)")
            await db.execute("CREATE INDEX IF NOT EXISTS idx_tasks_benchmark_id ON tasks (benchmark_id)")
            await db.execute("CREATE INDEX IF NOT EXISTS idx_results_benchmark_id ON results (benchmark_id)")
            await db.execute("CREATE INDEX IF NOT EXISTS idx_results_task_id ON results (task_id)")
            
            await db.commit()
    
    async def _insert_benchmark(self, db: aiosqlite.Connection, benchmark: Benchmark) -> None:
        """Insert benchmark into database."""
        await db.execute("""
            INSERT OR REPLACE INTO benchmarks (
                id, name, description, status, strategy, mode, config, metrics,
                created_at, started_at, completed_at, duration, error_log, metadata
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """, (
            benchmark.id,
            benchmark.name,
            benchmark.description,
            benchmark.status.value,
            benchmark.config.strategy.value,
            benchmark.config.mode.value,
            json.dumps(self._config_to_dict(benchmark.config)),
            json.dumps(self._metrics_to_dict(benchmark.metrics)),
            benchmark.created_at.isoformat(),
            benchmark.started_at.isoformat() if benchmark.started_at else None,
            benchmark.completed_at.isoformat() if benchmark.completed_at else None,
            benchmark.duration(),
            json.dumps(benchmark.error_log),
            json.dumps(benchmark.metadata)
        ))
    
    async def _insert_task(self, db: aiosqlite.Connection, task: Task, benchmark_id: str) -> None:
        """Insert task into database."""
        await db.execute("""
            INSERT OR REPLACE INTO tasks (
                id, benchmark_id, objective, description, strategy, mode, parameters,
                timeout, max_retries, priority, status, created_at, started_at,
                completed_at, duration, assigned_agents, parent_task_id, subtasks, dependencies
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """, (
            task.id,
            benchmark_id,
            task.objective,
            task.description,
            task.strategy.value,
            task.mode.value,
            json.dumps(task.parameters),
            task.timeout,
            task.max_retries,
            task.priority,
            task.status.value,
            task.created_at.isoformat(),
            task.started_at.isoformat() if task.started_at else None,
            task.completed_at.isoformat() if task.completed_at else None,
            task.duration(),
            json.dumps(task.assigned_agents),
            task.parent_task_id,
            json.dumps(task.subtasks),
            json.dumps(task.dependencies)
        ))
    
    async def _insert_result(self, db: aiosqlite.Connection, result: Result, benchmark_id: str) -> None:
        """Insert result into database."""
        await db.execute("""
            INSERT OR REPLACE INTO results (
                id, benchmark_id, task_id, agent_id, status, output, errors, warnings,
                performance_metrics, quality_metrics, resource_usage, execution_details,
                created_at, started_at, completed_at, duration
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """, (
            result.id,
            benchmark_id,
            result.task_id,
            result.agent_id,
            result.status.value,
            json.dumps(result.output),
            json.dumps(result.errors),
            json.dumps(result.warnings),
            json.dumps(self._performance_metrics_to_dict(result.performance_metrics)),
            json.dumps(self._quality_metrics_to_dict(result.quality_metrics)),
            json.dumps(self._resource_usage_to_dict(result.resource_usage)),
            json.dumps(result.execution_details),
            result.created_at.isoformat(),
            result.started_at.isoformat() if result.started_at else None,
            result.completed_at.isoformat() if result.completed_at else None,
            result.duration()
        ))
    
    async def query_benchmarks(self, 
                              strategy: Optional[str] = None,
                              mode: Optional[str] = None,
                              limit: int = 10) -> List[Dict[str, Any]]:
        """Query benchmarks from database."""
        if not self.db_path or not self.db_path.exists():
            return []
        
        query = "SELECT * FROM benchmarks WHERE 1=1"
        params = []
        
        if strategy:
            query += " AND strategy = ?"
            params.append(strategy)
        
        if mode:
            query += " AND mode = ?"
            params.append(mode)
        
        query += " ORDER BY created_at DESC LIMIT ?"
        params.append(limit)
        
        async with aiosqlite.connect(self.db_path) as db:
            db.row_factory = aiosqlite.Row
            cursor = await db.execute(query, params)
            rows = await cursor.fetchall()
            return [dict(row) for row in rows]
    
    async def get_benchmark(self, benchmark_id: str) -> Optional[Dict[str, Any]]:
        """Get specific benchmark by ID."""
        if not self.db_path or not self.db_path.exists():
            return None
        
        async with aiosqlite.connect(self.db_path) as db:
            db.row_factory = aiosqlite.Row
            cursor = await db.execute("SELECT * FROM benchmarks WHERE id = ?", (benchmark_id,))
            row = await cursor.fetchone()
            return dict(row) if row else None
    
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
    
    def _metrics_to_dict(self, metrics: BenchmarkMetrics) -> Dict[str, Any]:
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
    
    def _performance_metrics_to_dict(self, metrics) -> Dict[str, Any]:
        """Convert performance metrics to dictionary."""
        return {
            "execution_time": metrics.execution_time,
            "queue_time": metrics.queue_time,
            "throughput": metrics.throughput,
            "success_rate": metrics.success_rate,
            "error_rate": metrics.error_rate,
            "retry_count": metrics.retry_count,
            "coordination_overhead": metrics.coordination_overhead,
            "communication_latency": metrics.communication_latency
        }
    
    def _quality_metrics_to_dict(self, metrics) -> Dict[str, Any]:
        """Convert quality metrics to dictionary."""
        return {
            "accuracy_score": metrics.accuracy_score,
            "completeness_score": metrics.completeness_score,
            "consistency_score": metrics.consistency_score,
            "relevance_score": metrics.relevance_score,
            "overall_quality": metrics.overall_quality,
            "review_score": metrics.review_score,
            "automated_score": metrics.automated_score
        }
    
    def _resource_usage_to_dict(self, usage) -> Dict[str, Any]:
        """Convert resource usage to dictionary."""
        return {
            "cpu_percent": usage.cpu_percent,
            "memory_mb": usage.memory_mb,
            "network_bytes_sent": usage.network_bytes_sent,
            "network_bytes_recv": usage.network_bytes_recv,
            "disk_bytes_read": usage.disk_bytes_read,
            "disk_bytes_write": usage.disk_bytes_write,
            "peak_memory_mb": usage.peak_memory_mb,
            "average_cpu_percent": usage.average_cpu_percent
        }