#!/usr/bin/env python3
"""
Continuous Performance Monitoring System for Claude-Flow Swarm Operations

This system provides real-time performance monitoring and regression detection:
- Continuous metrics collection during swarm operations
- Real-time performance alerts and notifications
- Automatic baseline updating and trend analysis
- Integration with CI/CD pipelines for regression detection
- Performance dashboard data generation

Author: Metrics Analyst Agent
Version: 1.0.0
"""

import asyncio
import time
import json
import os
import sys
import threading
import subprocess
from datetime import datetime, timedelta
from pathlib import Path
from typing import Dict, List, Any, Optional, Callable
from dataclasses import dataclass, asdict
import psutil
import sqlite3
import logging
from contextlib import asynccontextmanager
import statistics
import warnings

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s',
    handlers=[
        logging.FileHandler('performance_monitor.log'),
        logging.StreamHandler()
    ]
)
logger = logging.getLogger(__name__)


@dataclass
class PerformanceAlert:
    """Performance alert definition."""
    metric_name: str
    threshold_value: float
    comparison: str  # 'greater', 'less', 'equal'
    severity: str  # 'info', 'warning', 'critical'
    message: str
    timestamp: datetime
    
    def should_trigger(self, current_value: float) -> bool:
        """Check if alert should trigger based on current value."""
        if self.comparison == 'greater':
            return current_value > self.threshold_value
        elif self.comparison == 'less':
            return current_value < self.threshold_value
        elif self.comparison == 'equal':
            return abs(current_value - self.threshold_value) < 0.01
        return False


@dataclass
class MetricSnapshot:
    """Snapshot of performance metrics at a point in time."""
    timestamp: datetime
    swarm_init_time: float
    agent_coordination_latency: float
    memory_usage_mb: float
    token_consumption_rate: float
    mcp_response_time: float
    neural_processing_time: float
    active_agents: int
    cpu_usage_percent: float
    
    def to_dict(self) -> Dict[str, Any]:
        return {
            'timestamp': self.timestamp.isoformat(),
            'swarm_init_time': self.swarm_init_time,
            'agent_coordination_latency': self.agent_coordination_latency,
            'memory_usage_mb': self.memory_usage_mb,
            'token_consumption_rate': self.token_consumption_rate,
            'mcp_response_time': self.mcp_response_time,
            'neural_processing_time': self.neural_processing_time,
            'active_agents': self.active_agents,
            'cpu_usage_percent': self.cpu_usage_percent
        }


class PerformanceDatabase:
    """SQLite database for storing performance metrics."""
    
    def __init__(self, db_path: str = "performance_metrics.db"):
        self.db_path = db_path
        self._init_database()
    
    def _init_database(self):
        """Initialize the performance metrics database."""
        with sqlite3.connect(self.db_path) as conn:
            conn.execute('''
                CREATE TABLE IF NOT EXISTS metrics (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    timestamp TEXT NOT NULL,
                    swarm_init_time REAL,
                    agent_coordination_latency REAL,
                    memory_usage_mb REAL,
                    token_consumption_rate REAL,
                    mcp_response_time REAL,
                    neural_processing_time REAL,
                    active_agents INTEGER,
                    cpu_usage_percent REAL,
                    session_id TEXT,
                    operation_type TEXT
                )
            ''')
            
            conn.execute('''
                CREATE TABLE IF NOT EXISTS baselines (
                    metric_name TEXT PRIMARY KEY,
                    baseline_value REAL NOT NULL,
                    updated_at TEXT NOT NULL,
                    sample_count INTEGER DEFAULT 0
                )
            ''')
            
            conn.execute('''
                CREATE TABLE IF NOT EXISTS alerts (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    timestamp TEXT NOT NULL,
                    metric_name TEXT NOT NULL,
                    threshold_value REAL NOT NULL,
                    actual_value REAL NOT NULL,
                    severity TEXT NOT NULL,
                    message TEXT NOT NULL,
                    acknowledged BOOLEAN DEFAULT FALSE
                )
            ''')
            
            conn.commit()
    
    def store_metrics(self, metrics: MetricSnapshot, session_id: str = None, operation_type: str = None):
        """Store metrics snapshot in database."""
        with sqlite3.connect(self.db_path) as conn:
            conn.execute('''
                INSERT INTO metrics (
                    timestamp, swarm_init_time, agent_coordination_latency,
                    memory_usage_mb, token_consumption_rate, mcp_response_time,
                    neural_processing_time, active_agents, cpu_usage_percent,
                    session_id, operation_type
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ''', (
                metrics.timestamp.isoformat(),
                metrics.swarm_init_time,
                metrics.agent_coordination_latency,
                metrics.memory_usage_mb,
                metrics.token_consumption_rate,
                metrics.mcp_response_time,
                metrics.neural_processing_time,
                metrics.active_agents,
                metrics.cpu_usage_percent,
                session_id,
                operation_type
            ))
            conn.commit()
    
    def get_recent_metrics(self, hours: int = 24) -> List[MetricSnapshot]:
        """Get metrics from the last N hours."""
        cutoff = datetime.now() - timedelta(hours=hours)
        
        with sqlite3.connect(self.db_path) as conn:
            cursor = conn.execute('''
                SELECT * FROM metrics 
                WHERE timestamp > ? 
                ORDER BY timestamp DESC
            ''', (cutoff.isoformat(),))
            
            results = []
            for row in cursor.fetchall():
                results.append(MetricSnapshot(
                    timestamp=datetime.fromisoformat(row[1]),
                    swarm_init_time=row[2] or 0.0,
                    agent_coordination_latency=row[3] or 0.0,
                    memory_usage_mb=row[4] or 0.0,
                    token_consumption_rate=row[5] or 0.0,
                    mcp_response_time=row[6] or 0.0,
                    neural_processing_time=row[7] or 0.0,
                    active_agents=row[8] or 0,
                    cpu_usage_percent=row[9] or 0.0
                ))
            
            return results
    
    def update_baseline(self, metric_name: str, value: float):
        """Update baseline value for a metric."""
        with sqlite3.connect(self.db_path) as conn:
            conn.execute('''
                INSERT OR REPLACE INTO baselines (metric_name, baseline_value, updated_at, sample_count)
                VALUES (?, ?, ?, COALESCE((SELECT sample_count + 1 FROM baselines WHERE metric_name = ?), 1))
            ''', (metric_name, value, datetime.now().isoformat(), metric_name))
            conn.commit()
    
    def get_baseline(self, metric_name: str) -> Optional[float]:
        """Get baseline value for a metric."""
        with sqlite3.connect(self.db_path) as conn:
            cursor = conn.execute(
                'SELECT baseline_value FROM baselines WHERE metric_name = ?',
                (metric_name,)
            )
            result = cursor.fetchone()
            return result[0] if result else None
    
    def store_alert(self, alert: PerformanceAlert, actual_value: float):
        """Store performance alert in database."""
        with sqlite3.connect(self.db_path) as conn:
            conn.execute('''
                INSERT INTO alerts (timestamp, metric_name, threshold_value, actual_value, severity, message)
                VALUES (?, ?, ?, ?, ?, ?)
            ''', (
                alert.timestamp.isoformat(),
                alert.metric_name,
                alert.threshold_value,
                actual_value,
                alert.severity,
                alert.message
            ))
            conn.commit()


class SwarmMetricsCollector:
    """Collects real-time metrics from swarm operations."""
    
    def __init__(self):
        self.is_collecting = False
        self._collection_thread = None
        self._metrics_callbacks: List[Callable[[MetricSnapshot], None]] = []
        self.current_session_id = None
        
    def start_collection(self, interval_seconds: float = 10.0, session_id: str = None):
        """Start continuous metrics collection."""
        if self.is_collecting:
            logger.warning("Metrics collection already running")
            return
            
        self.is_collecting = True
        self.current_session_id = session_id or f"session_{int(time.time())}"
        
        self._collection_thread = threading.Thread(
            target=self._collect_metrics_loop,
            args=(interval_seconds,),
            daemon=True
        )
        self._collection_thread.start()
        logger.info(f"Started metrics collection with {interval_seconds}s interval")
    
    def stop_collection(self):
        """Stop metrics collection."""
        self.is_collecting = False
        if self._collection_thread:
            self._collection_thread.join(timeout=5.0)
        logger.info("Stopped metrics collection")
    
    def add_metrics_callback(self, callback: Callable[[MetricSnapshot], None]):
        """Add callback to be called when new metrics are collected."""
        self._metrics_callbacks.append(callback)
    
    def _collect_metrics_loop(self, interval_seconds: float):
        """Main metrics collection loop."""
        while self.is_collecting:
            try:
                metrics = self._collect_current_metrics()
                
                # Call all registered callbacks
                for callback in self._metrics_callbacks:
                    try:
                        callback(metrics)
                    except Exception as e:
                        logger.error(f"Error in metrics callback: {e}")
                
                time.sleep(interval_seconds)
                
            except Exception as e:
                logger.error(f"Error in metrics collection: {e}")
                time.sleep(interval_seconds)
    
    def _collect_current_metrics(self) -> MetricSnapshot:
        """Collect current performance metrics."""
        # System metrics
        process = psutil.Process()
        cpu_percent = process.cpu_percent(interval=0.1)
        memory_mb = process.memory_info().rss / 1024 / 1024
        
        # Swarm-specific metrics (these would be measured from actual operations)
        swarm_init_time = self._measure_swarm_init_time()
        agent_coordination_latency = self._measure_coordination_latency()
        token_consumption_rate = self._estimate_token_consumption()
        mcp_response_time = self._measure_mcp_response_time()
        neural_processing_time = self._measure_neural_processing_time()
        active_agents = self._count_active_agents()
        
        return MetricSnapshot(
            timestamp=datetime.now(),
            swarm_init_time=swarm_init_time,
            agent_coordination_latency=agent_coordination_latency,
            memory_usage_mb=memory_mb,
            token_consumption_rate=token_consumption_rate,
            mcp_response_time=mcp_response_time,
            neural_processing_time=neural_processing_time,
            active_agents=active_agents,
            cpu_usage_percent=cpu_percent
        )
    
    def _measure_swarm_init_time(self) -> float:
        """Measure current swarm initialization time."""
        try:
            start = time.time()
            result = subprocess.run(
                ["node", "../cli.js", "swarm", "status"],
                capture_output=True,
                timeout=5,
                cwd=str(Path(__file__).parent.parent)
            )
            return time.time() - start
        except:
            return 0.0
    
    def _measure_coordination_latency(self) -> float:
        """Measure agent coordination latency."""
        try:
            start = time.time()
            result = subprocess.run(
                ["node", "../cli.js", "swarm", "list"],
                capture_output=True,
                timeout=3,
                cwd=str(Path(__file__).parent.parent)
            )
            return (time.time() - start) * 1000  # Convert to milliseconds
        except:
            return 0.0
    
    def _estimate_token_consumption(self) -> float:
        """Estimate current token consumption rate."""
        # This would integrate with actual token tracking
        # For now, return a simulated value
        return 100.0  # tokens per minute
    
    def _measure_mcp_response_time(self) -> float:
        """Measure MCP tool response time."""
        try:
            start = time.time()
            result = subprocess.run(
                ["node", "../cli.js", "mcp", "status"],
                capture_output=True,
                timeout=3,
                cwd=str(Path(__file__).parent.parent)
            )
            return time.time() - start
        except:
            return 0.0
    
    def _measure_neural_processing_time(self) -> float:
        """Measure neural pattern processing time."""
        # This would measure actual neural processing
        # For now, simulate based on system load
        cpu_percent = psutil.cpu_percent(interval=0.1)
        return cpu_percent * 10  # Simulated processing time in ms
    
    def _count_active_agents(self) -> int:
        """Count currently active agents."""
        try:
            result = subprocess.run(
                ["node", "../cli.js", "swarm", "list"],
                capture_output=True,
                text=True,
                timeout=3,
                cwd=str(Path(__file__).parent.parent)
            )
            
            if result.returncode == 0:
                # Count agents in output (this is a simplified parsing)
                return result.stdout.count("agent") if result.stdout else 0
            return 0
        except:
            return 0


class PerformanceMonitor:
    """Main performance monitoring system."""
    
    def __init__(self, db_path: str = "performance_metrics.db"):
        self.db = PerformanceDatabase(db_path)
        self.collector = SwarmMetricsCollector()
        self.alerts: List[PerformanceAlert] = []
        self._setup_default_alerts()
        
        # Register metrics callback
        self.collector.add_metrics_callback(self._on_metrics_collected)
    
    def _setup_default_alerts(self):
        """Setup default performance alerts."""
        self.alerts = [
            PerformanceAlert(
                metric_name="swarm_init_time",
                threshold_value=5.0,
                comparison="greater",
                severity="warning",
                message="Swarm initialization time exceeded 5 seconds",
                timestamp=datetime.now()
            ),
            PerformanceAlert(
                metric_name="agent_coordination_latency",
                threshold_value=200.0,
                comparison="greater",
                severity="warning",
                message="Agent coordination latency exceeded 200ms",
                timestamp=datetime.now()
            ),
            PerformanceAlert(
                metric_name="memory_usage_mb",
                threshold_value=100.0,
                comparison="greater",
                severity="critical",
                message="Memory usage exceeded 100MB",
                timestamp=datetime.now()
            ),
            PerformanceAlert(
                metric_name="mcp_response_time",
                threshold_value=1.0,
                comparison="greater",
                severity="warning",
                message="MCP response time exceeded 1 second",
                timestamp=datetime.now()
            )
        ]
    
    def start_monitoring(self, interval_seconds: float = 10.0, session_id: str = None):
        """Start continuous performance monitoring."""
        logger.info("Starting performance monitoring...")
        self.collector.start_collection(interval_seconds, session_id)
    
    def stop_monitoring(self):
        """Stop performance monitoring."""
        logger.info("Stopping performance monitoring...")
        self.collector.stop_collection()
    
    def _on_metrics_collected(self, metrics: MetricSnapshot):
        """Handle newly collected metrics."""
        # Store in database
        self.db.store_metrics(
            metrics,
            session_id=self.collector.current_session_id,
            operation_type="continuous_monitoring"
        )
        
        # Check alerts
        self._check_alerts(metrics)
        
        # Update baselines (every 100 samples)
        if hash(metrics.timestamp) % 100 == 0:
            self._update_baselines(metrics)
        
        # Log summary
        logger.info(f"Metrics collected - Memory: {metrics.memory_usage_mb:.1f}MB, "
                   f"CPU: {metrics.cpu_usage_percent:.1f}%, "
                   f"Agents: {metrics.active_agents}")
    
    def _check_alerts(self, metrics: MetricSnapshot):
        """Check if any alerts should be triggered."""
        metrics_dict = metrics.to_dict()
        
        for alert in self.alerts:
            if alert.metric_name in metrics_dict:
                current_value = metrics_dict[alert.metric_name]
                
                if isinstance(current_value, (int, float)) and alert.should_trigger(current_value):
                    # Store alert
                    self.db.store_alert(alert, current_value)
                    
                    # Log alert
                    logger.warning(f"ALERT [{alert.severity.upper()}] {alert.message} "
                                 f"(Value: {current_value}, Threshold: {alert.threshold_value})")
                    
                    # Could send notifications here (email, slack, etc.)
                    self._send_notification(alert, current_value)
    
    def _update_baselines(self, metrics: MetricSnapshot):
        """Update performance baselines with current metrics."""
        metrics_dict = metrics.to_dict()
        
        for metric_name, value in metrics_dict.items():
            if isinstance(value, (int, float)) and metric_name != 'timestamp':
                self.db.update_baseline(metric_name, value)
    
    def _send_notification(self, alert: PerformanceAlert, actual_value: float):
        """Send performance alert notification."""
        # This would integrate with notification systems
        # For now, just log the notification
        logger.info(f"NOTIFICATION: {alert.message} (Value: {actual_value})")
    
    def get_performance_dashboard_data(self, hours: int = 24) -> Dict[str, Any]:
        """Get data for performance dashboard."""
        recent_metrics = self.db.get_recent_metrics(hours)
        
        if not recent_metrics:
            return {"error": "No recent metrics available"}
        
        # Calculate aggregated statistics
        init_times = [m.swarm_init_time for m in recent_metrics if m.swarm_init_time > 0]
        coordination_latencies = [m.agent_coordination_latency for m in recent_metrics if m.agent_coordination_latency > 0]
        memory_usage = [m.memory_usage_mb for m in recent_metrics]
        
        dashboard_data = {
            "summary": {
                "total_samples": len(recent_metrics),
                "time_range_hours": hours,
                "last_update": recent_metrics[0].timestamp.isoformat() if recent_metrics else None
            },
            "swarm_performance": {
                "avg_init_time": statistics.mean(init_times) if init_times else 0,
                "max_init_time": max(init_times) if init_times else 0,
                "avg_coordination_latency": statistics.mean(coordination_latencies) if coordination_latencies else 0,
                "max_coordination_latency": max(coordination_latencies) if coordination_latencies else 0
            },
            "resource_usage": {
                "avg_memory_mb": statistics.mean(memory_usage) if memory_usage else 0,
                "peak_memory_mb": max(memory_usage) if memory_usage else 0,
                "memory_trend": "increasing" if len(memory_usage) > 1 and memory_usage[-1] > memory_usage[0] else "stable"
            },
            "time_series": [m.to_dict() for m in recent_metrics[-100:]],  # Last 100 samples for charts
            "baselines": {
                "swarm_init_time": self.db.get_baseline("swarm_init_time"),
                "agent_coordination_latency": self.db.get_baseline("agent_coordination_latency"),
                "memory_usage_mb": self.db.get_baseline("memory_usage_mb")
            }
        }
        
        return dashboard_data
    
    def generate_regression_report(self) -> Dict[str, Any]:
        """Generate performance regression analysis report."""
        recent_metrics = self.db.get_recent_metrics(24)  # Last 24 hours
        older_metrics = self.db.get_recent_metrics(168)  # Last 7 days
        
        if len(recent_metrics) < 10 or len(older_metrics) < 50:
            return {"error": "Insufficient data for regression analysis"}
        
        # Calculate recent vs historical averages
        recent_avg_init = statistics.mean([m.swarm_init_time for m in recent_metrics if m.swarm_init_time > 0])
        historical_avg_init = statistics.mean([m.swarm_init_time for m in older_metrics if m.swarm_init_time > 0])
        
        recent_avg_memory = statistics.mean([m.memory_usage_mb for m in recent_metrics])
        historical_avg_memory = statistics.mean([m.memory_usage_mb for m in older_metrics])
        
        # Calculate regression percentages
        init_regression = ((recent_avg_init - historical_avg_init) / historical_avg_init) * 100 if historical_avg_init > 0 else 0
        memory_regression = ((recent_avg_memory - historical_avg_memory) / historical_avg_memory) * 100 if historical_avg_memory > 0 else 0
        
        return {
            "analysis_period": {
                "recent_period_hours": 24,
                "historical_period_hours": 168,
                "recent_samples": len(recent_metrics),
                "historical_samples": len(older_metrics)
            },
            "regression_analysis": {
                "swarm_init_time": {
                    "recent_avg": recent_avg_init,
                    "historical_avg": historical_avg_init,
                    "regression_percent": init_regression,
                    "regression_detected": abs(init_regression) > 10  # 10% threshold
                },
                "memory_usage": {
                    "recent_avg": recent_avg_memory,
                    "historical_avg": historical_avg_memory,
                    "regression_percent": memory_regression,
                    "regression_detected": abs(memory_regression) > 15  # 15% threshold
                }
            },
            "recommendations": self._generate_regression_recommendations(init_regression, memory_regression)
        }
    
    def _generate_regression_recommendations(self, init_regression: float, memory_regression: float) -> List[str]:
        """Generate recommendations based on regression analysis."""
        recommendations = []
        
        if init_regression > 10:
            recommendations.append("Swarm initialization time has regressed by >10% - investigate startup optimizations")
        
        if memory_regression > 15:
            recommendations.append("Memory usage has increased by >15% - check for memory leaks")
        
        if init_regression < -10:
            recommendations.append("Swarm initialization time has improved significantly - consider documenting optimizations")
        
        if not recommendations:
            recommendations.append("No significant performance regressions detected")
        
        return recommendations


async def run_continuous_monitoring(duration_minutes: int = 60, interval_seconds: float = 10.0):
    """Run continuous monitoring for specified duration."""
    monitor = PerformanceMonitor()
    
    try:
        # Start monitoring
        session_id = f"continuous_{int(time.time())}"
        monitor.start_monitoring(interval_seconds, session_id)
        
        logger.info(f"Running continuous monitoring for {duration_minutes} minutes...")
        
        # Run for specified duration
        await asyncio.sleep(duration_minutes * 60)
        
        # Generate reports
        dashboard_data = monitor.get_performance_dashboard_data()
        regression_report = monitor.generate_regression_report()
        
        # Save reports
        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        
        dashboard_file = Path(f"dashboard_data_{timestamp}.json")
        with open(dashboard_file, 'w') as f:
            json.dump(dashboard_data, f, indent=2, default=str)
        
        regression_file = Path(f"regression_report_{timestamp}.json")
        with open(regression_file, 'w') as f:
            json.dump(regression_report, f, indent=2, default=str)
        
        logger.info(f"Reports saved: {dashboard_file}, {regression_file}")
        
        return {
            "monitoring_duration_minutes": duration_minutes,
            "dashboard_data": dashboard_data,
            "regression_report": regression_report
        }
        
    finally:
        monitor.stop_monitoring()


def main():
    """Main entry point for continuous performance monitoring."""
    import argparse
    
    parser = argparse.ArgumentParser(description="Continuous Performance Monitor")
    parser.add_argument("--duration", type=int, default=60, help="Monitoring duration in minutes")
    parser.add_argument("--interval", type=float, default=10.0, help="Collection interval in seconds")
    parser.add_argument("--dashboard", action="store_true", help="Generate dashboard data only")
    parser.add_argument("--regression", action="store_true", help="Generate regression report only")
    
    args = parser.parse_args()
    
    if args.dashboard:
        # Generate dashboard data
        monitor = PerformanceMonitor()
        data = monitor.get_performance_dashboard_data()
        print(json.dumps(data, indent=2, default=str))
    elif args.regression:
        # Generate regression report
        monitor = PerformanceMonitor()
        report = monitor.generate_regression_report()
        print(json.dumps(report, indent=2, default=str))
    else:
        # Run continuous monitoring
        asyncio.run(run_continuous_monitoring(args.duration, args.interval))


if __name__ == "__main__":
    main()