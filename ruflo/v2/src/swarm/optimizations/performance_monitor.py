"""
Performance Monitoring for Swarm Optimizations
Tracks and reports on optimization metrics in real-time
"""

import time
import json
from datetime import datetime
from typing import Dict, List, Any, Optional
from pathlib import Path
import asyncio

from .optimized_executor import OptimizedExecutor
from .connection_pool import ClaudeConnectionPool
from .async_file_manager import AsyncFileManager


class PerformanceMonitor:
    """Monitor and track performance metrics for swarm optimizations."""
    
    def __init__(self, 
                 sample_interval: float = 1.0,
                 history_size: int = 1000,
                 output_dir: str = "./performance_logs"):
        """
        Initialize performance monitor.
        
        Args:
            sample_interval: How often to sample metrics (seconds)
            history_size: Number of samples to keep in memory
            output_dir: Directory for performance logs
        """
        self.sample_interval = sample_interval
        self.history_size = history_size
        self.output_dir = Path(output_dir)
        self.output_dir.mkdir(exist_ok=True)
        
        self.metrics_history: List[Dict[str, Any]] = []
        self.is_monitoring = False
        self.start_time = None
        
        # Components to monitor
        self.executor: Optional[OptimizedExecutor] = None
        self.connection_pool: Optional[ClaudeConnectionPool] = None
        self.file_manager: Optional[AsyncFileManager] = None
        
    def attach_executor(self, executor: OptimizedExecutor):
        """Attach an executor to monitor."""
        self.executor = executor
        
    def attach_connection_pool(self, pool: ClaudeConnectionPool):
        """Attach a connection pool to monitor."""
        self.connection_pool = pool
        
    def attach_file_manager(self, manager: AsyncFileManager):
        """Attach a file manager to monitor."""
        self.file_manager = manager
        
    async def start_monitoring(self):
        """Start the monitoring loop."""
        self.is_monitoring = True
        self.start_time = time.time()
        
        print(f"Performance monitoring started at {datetime.now()}")
        
        while self.is_monitoring:
            # Collect metrics
            metrics = self._collect_metrics()
            self.metrics_history.append(metrics)
            
            # Trim history if needed
            if len(self.metrics_history) > self.history_size:
                self.metrics_history.pop(0)
            
            # Log current metrics
            self._log_metrics(metrics)
            
            # Check for alerts
            self._check_alerts(metrics)
            
            # Wait for next sample
            await asyncio.sleep(self.sample_interval)
    
    def stop_monitoring(self):
        """Stop the monitoring loop."""
        self.is_monitoring = False
        
        # Save final report
        self._save_report()
        
        print(f"Performance monitoring stopped at {datetime.now()}")
    
    def _collect_metrics(self) -> Dict[str, Any]:
        """Collect current metrics from all components."""
        timestamp = time.time()
        uptime = timestamp - self.start_time if self.start_time else 0
        
        metrics = {
            'timestamp': timestamp,
            'datetime': datetime.now().isoformat(),
            'uptime': uptime
        }
        
        # Executor metrics
        if self.executor:
            executor_metrics = self.executor.getMetrics()
            metrics['executor'] = {
                'total_executed': executor_metrics.get('totalExecuted', 0),
                'total_succeeded': executor_metrics.get('totalSucceeded', 0),
                'total_failed': executor_metrics.get('totalFailed', 0),
                'avg_execution_time': executor_metrics.get('avgExecutionTime', 0),
                'cache_hit_rate': executor_metrics.get('cacheHitRate', 0),
                'queue_length': executor_metrics.get('queueLength', 0),
                'active_executions': executor_metrics.get('activeExecutions', 0)
            }
            
            # Calculate success rate
            total = metrics['executor']['total_executed']
            if total > 0:
                metrics['executor']['success_rate'] = (
                    metrics['executor']['total_succeeded'] / total
                )
            else:
                metrics['executor']['success_rate'] = 0
        
        # Connection pool metrics
        if self.connection_pool:
            pool_stats = self.connection_pool.getStats()
            metrics['connection_pool'] = {
                'total_connections': pool_stats.get('total', 0),
                'in_use': pool_stats.get('inUse', 0),
                'idle': pool_stats.get('idle', 0),
                'waiting_queue': pool_stats.get('waitingQueue', 0),
                'total_use_count': pool_stats.get('totalUseCount', 0)
            }
            
            # Calculate utilization
            total_conn = metrics['connection_pool']['total_connections']
            if total_conn > 0:
                metrics['connection_pool']['utilization'] = (
                    metrics['connection_pool']['in_use'] / total_conn
                )
            else:
                metrics['connection_pool']['utilization'] = 0
        
        # File manager metrics
        if self.file_manager:
            fm_metrics = self.file_manager.getMetrics()
            metrics['file_manager'] = {
                'operations': fm_metrics.get('operations', {}),
                'total_bytes': fm_metrics.get('totalBytes', 0),
                'errors': fm_metrics.get('errors', 0),
                'write_queue_size': fm_metrics.get('writeQueueSize', 0),
                'read_queue_size': fm_metrics.get('readQueueSize', 0),
                'write_queue_pending': fm_metrics.get('writeQueuePending', 0),
                'read_queue_pending': fm_metrics.get('readQueuePending', 0)
            }
        
        # System metrics (simplified)
        try:
            import psutil
            process = psutil.Process()
            metrics['system'] = {
                'cpu_percent': process.cpu_percent(interval=0.1),
                'memory_mb': process.memory_info().rss / 1024 / 1024,
                'threads': process.num_threads()
            }
        except ImportError:
            metrics['system'] = {}
        
        return metrics
    
    def _log_metrics(self, metrics: Dict[str, Any]):
        """Log current metrics to console."""
        # Create a summary line
        summary_parts = []
        
        if 'executor' in metrics:
            exec_data = metrics['executor']
            summary_parts.append(
                f"Tasks: {exec_data['total_executed']} "
                f"(Success: {exec_data['success_rate']:.1%}, "
                f"Cache: {exec_data['cache_hit_rate']:.1%})"
            )
        
        if 'connection_pool' in metrics:
            pool_data = metrics['connection_pool']
            summary_parts.append(
                f"Connections: {pool_data['in_use']}/{pool_data['total_connections']} "
                f"(Util: {pool_data['utilization']:.1%})"
            )
        
        if 'system' in metrics and metrics['system']:
            sys_data = metrics['system']
            summary_parts.append(
                f"CPU: {sys_data.get('cpu_percent', 0):.1f}%, "
                f"Mem: {sys_data.get('memory_mb', 0):.0f}MB"
            )
        
        if summary_parts:
            print(f"[{datetime.now().strftime('%H:%M:%S')}] " + " | ".join(summary_parts))
    
    def _check_alerts(self, metrics: Dict[str, Any]):
        """Check for alert conditions."""
        alerts = []
        
        # High failure rate alert
        if 'executor' in metrics:
            failure_rate = 1 - metrics['executor']['success_rate']
            if failure_rate > 0.1:  # More than 10% failures
                alerts.append(f"High failure rate: {failure_rate:.1%}")
        
        # Connection pool exhaustion
        if 'connection_pool' in metrics:
            utilization = metrics['connection_pool']['utilization']
            if utilization > 0.9:  # More than 90% utilized
                alerts.append(f"Connection pool near capacity: {utilization:.1%}")
            
            if metrics['connection_pool']['waiting_queue'] > 5:
                alerts.append(f"Connection queue backed up: {metrics['connection_pool']['waiting_queue']} waiting")
        
        # High memory usage
        if 'system' in metrics and metrics['system']:
            memory_mb = metrics['system'].get('memory_mb', 0)
            if memory_mb > 512:  # Alert if over 512MB
                alerts.append(f"High memory usage: {memory_mb:.0f}MB")
        
        # Print alerts
        if alerts:
            print(f"[ALERT] {', '.join(alerts)}")
    
    def _save_report(self):
        """Save a performance report to file."""
        if not self.metrics_history:
            return
        
        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        report_file = self.output_dir / f"performance_report_{timestamp}.json"
        
        # Calculate summary statistics
        summary = self._calculate_summary()
        
        report = {
            'start_time': self.start_time,
            'end_time': time.time(),
            'duration': time.time() - self.start_time if self.start_time else 0,
            'sample_count': len(self.metrics_history),
            'summary': summary,
            'history': self.metrics_history[-100:]  # Last 100 samples
        }
        
        with open(report_file, 'w') as f:
            json.dump(report, f, indent=2)
        
        print(f"Performance report saved to: {report_file}")
    
    def _calculate_summary(self) -> Dict[str, Any]:
        """Calculate summary statistics from metrics history."""
        if not self.metrics_history:
            return {}
        
        summary = {}
        
        # Executor summary
        if any('executor' in m for m in self.metrics_history):
            exec_metrics = [m['executor'] for m in self.metrics_history if 'executor' in m]
            summary['executor'] = {
                'total_tasks': exec_metrics[-1]['total_executed'] if exec_metrics else 0,
                'avg_success_rate': sum(m['success_rate'] for m in exec_metrics) / len(exec_metrics) if exec_metrics else 0,
                'avg_cache_hit_rate': sum(m['cache_hit_rate'] for m in exec_metrics) / len(exec_metrics) if exec_metrics else 0,
                'avg_execution_time': sum(m['avg_execution_time'] for m in exec_metrics) / len(exec_metrics) if exec_metrics else 0
            }
        
        # Connection pool summary
        if any('connection_pool' in m for m in self.metrics_history):
            pool_metrics = [m['connection_pool'] for m in self.metrics_history if 'connection_pool' in m]
            summary['connection_pool'] = {
                'avg_utilization': sum(m['utilization'] for m in pool_metrics) / len(pool_metrics) if pool_metrics else 0,
                'max_connections': max(m['total_connections'] for m in pool_metrics) if pool_metrics else 0,
                'total_uses': pool_metrics[-1]['total_use_count'] if pool_metrics else 0
            }
        
        # System summary
        if any('system' in m and m['system'] for m in self.metrics_history):
            sys_metrics = [m['system'] for m in self.metrics_history if 'system' in m and m['system']]
            summary['system'] = {
                'avg_cpu_percent': sum(m.get('cpu_percent', 0) for m in sys_metrics) / len(sys_metrics) if sys_metrics else 0,
                'max_memory_mb': max(m.get('memory_mb', 0) for m in sys_metrics) if sys_metrics else 0,
                'avg_memory_mb': sum(m.get('memory_mb', 0) for m in sys_metrics) / len(sys_metrics) if sys_metrics else 0
            }
        
        return summary
    
    def get_current_metrics(self) -> Dict[str, Any]:
        """Get current metrics snapshot."""
        return self._collect_metrics()
    
    def get_summary(self) -> Dict[str, Any]:
        """Get summary of performance since monitoring started."""
        return self._calculate_summary()


async def demo_monitoring():
    """Demonstrate performance monitoring."""
    from .index import createOptimizedSwarmStack
    
    # Create optimized stack
    stack = createOptimizedSwarmStack()
    
    # Create monitor
    monitor = PerformanceMonitor(sample_interval=2.0)
    monitor.attach_executor(stack['executor'])
    monitor.attach_connection_pool(stack['connectionPool'])
    monitor.attach_file_manager(stack['fileManager'])
    
    # Start monitoring in background
    monitor_task = asyncio.create_task(monitor.start_monitoring())
    
    # Simulate some work
    print("Simulating workload for 30 seconds...")
    await asyncio.sleep(30)
    
    # Stop monitoring
    monitor.stop_monitoring()
    await monitor_task
    
    # Clean up
    await stack['shutdown']()
    
    # Print final summary
    summary = monitor.get_summary()
    print("\nPerformance Summary:")
    print(json.dumps(summary, indent=2))


if __name__ == "__main__":
    asyncio.run(demo_monitoring())