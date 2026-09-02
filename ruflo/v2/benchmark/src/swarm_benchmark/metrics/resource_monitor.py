"""Real-time resource monitoring for claude-flow processes."""

from __future__ import annotations
import asyncio
import psutil
import time
from typing import Dict, List, Optional, Any, Callable
from dataclasses import dataclass, field
from datetime import datetime
import threading
from collections import deque
import statistics

from ..core.models import ResourceUsage


@dataclass
class ResourceSnapshot:
    """A snapshot of resource usage at a point in time."""
    timestamp: float
    cpu_percent: float
    memory_mb: float
    memory_percent: float
    thread_count: int
    fd_count: int
    io_read_bytes: int
    io_write_bytes: int
    io_read_count: int
    io_write_count: int
    

@dataclass 
class ResourceAlert:
    """Alert when resource usage exceeds thresholds."""
    timestamp: datetime
    resource_type: str
    current_value: float
    threshold: float
    message: str
    

class ResourceMonitor:
    """Monitors system and process resources with alerting."""
    
    def __init__(
        self,
        history_size: int = 1000,
        alert_callback: Optional[Callable[[ResourceAlert], None]] = None
    ):
        """Initialize resource monitor.
        
        Args:
            history_size: Number of snapshots to keep in history
            alert_callback: Function to call when alerts are triggered
        """
        self.history_size = history_size
        self.alert_callback = alert_callback
        self._history: deque[ResourceSnapshot] = deque(maxlen=history_size)
        self._alerts: List[ResourceAlert] = []
        self._thresholds = {
            "cpu_percent": 80.0,
            "memory_percent": 85.0,
            "memory_mb": 1024.0,
            "thread_count": 100,
            "fd_count": 1000
        }
        self._monitoring = False
        self._monitor_thread: Optional[threading.Thread] = None
        self._stop_event = threading.Event()
        self._process: Optional[psutil.Process] = None
        
    def set_thresholds(self, thresholds: Dict[str, float]) -> None:
        """Set resource alert thresholds."""
        self._thresholds.update(thresholds)
        
    def start_monitoring(self, pid: Optional[int] = None) -> None:
        """Start monitoring resources.
        
        Args:
            pid: Process ID to monitor (None for current process)
        """
        self._stop_event.clear()
        self._monitoring = True
        self._alerts.clear()
        self._history.clear()
        
        try:
            self._process = psutil.Process(pid) if pid else psutil.Process()
        except psutil.NoSuchProcess:
            self._process = None
            return
            
        self._monitor_thread = threading.Thread(
            target=self._monitor_loop,
            daemon=True
        )
        self._monitor_thread.start()
        
    def stop_monitoring(self) -> ResourceUsage:
        """Stop monitoring and return aggregated usage."""
        self._monitoring = False
        self._stop_event.set()
        
        if self._monitor_thread:
            self._monitor_thread.join(timeout=5.0)
            
        return self._calculate_aggregate_usage()
        
    def _monitor_loop(self) -> None:
        """Main monitoring loop."""
        while self._monitoring and not self._stop_event.is_set():
            try:
                snapshot = self._take_snapshot()
                if snapshot:
                    self._history.append(snapshot)
                    self._check_thresholds(snapshot)
                    
            except Exception:
                # Process might have terminated
                pass
                
            time.sleep(0.1)  # 100ms sampling rate
            
    def _take_snapshot(self) -> Optional[ResourceSnapshot]:
        """Take a resource usage snapshot."""
        if not self._process:
            return None
            
        try:
            with self._process.oneshot():
                # CPU and memory
                cpu_percent = self._process.cpu_percent(interval=None)
                memory_info = self._process.memory_info()
                memory_mb = memory_info.rss / 1024 / 1024
                memory_percent = self._process.memory_percent()
                
                # Thread and file descriptor count
                thread_count = self._process.num_threads()
                try:
                    fd_count = self._process.num_fds()
                except (AttributeError, psutil.AccessDenied):
                    fd_count = 0
                    
                # I/O counters
                try:
                    io_counters = self._process.io_counters()
                    io_read_bytes = io_counters.read_bytes
                    io_write_bytes = io_counters.write_bytes
                    io_read_count = io_counters.read_count
                    io_write_count = io_counters.write_count
                except (AttributeError, psutil.AccessDenied):
                    io_read_bytes = io_write_bytes = 0
                    io_read_count = io_write_count = 0
                    
                return ResourceSnapshot(
                    timestamp=time.time(),
                    cpu_percent=cpu_percent,
                    memory_mb=memory_mb,
                    memory_percent=memory_percent,
                    thread_count=thread_count,
                    fd_count=fd_count,
                    io_read_bytes=io_read_bytes,
                    io_write_bytes=io_write_bytes,
                    io_read_count=io_read_count,
                    io_write_count=io_write_count
                )
                
        except (psutil.NoSuchProcess, psutil.AccessDenied):
            self._process = None
            return None
            
    def _check_thresholds(self, snapshot: ResourceSnapshot) -> None:
        """Check if any thresholds are exceeded."""
        checks = [
            ("cpu_percent", snapshot.cpu_percent),
            ("memory_percent", snapshot.memory_percent),
            ("memory_mb", snapshot.memory_mb),
            ("thread_count", snapshot.thread_count),
            ("fd_count", snapshot.fd_count)
        ]
        
        for resource_type, current_value in checks:
            threshold = self._thresholds.get(resource_type)
            if threshold and current_value > threshold:
                alert = ResourceAlert(
                    timestamp=datetime.now(),
                    resource_type=resource_type,
                    current_value=current_value,
                    threshold=threshold,
                    message=f"{resource_type} exceeded threshold: {current_value:.2f} > {threshold}"
                )
                self._alerts.append(alert)
                
                if self.alert_callback:
                    self.alert_callback(alert)
                    
    def _calculate_aggregate_usage(self) -> ResourceUsage:
        """Calculate aggregate resource usage from history."""
        if not self._history:
            return ResourceUsage()
            
        # Calculate statistics
        cpu_values = [s.cpu_percent for s in self._history]
        memory_values = [s.memory_mb for s in self._history]
        
        # Calculate I/O deltas
        io_read_bytes = 0
        io_write_bytes = 0
        if len(self._history) >= 2:
            io_read_bytes = self._history[-1].io_read_bytes - self._history[0].io_read_bytes
            io_write_bytes = self._history[-1].io_write_bytes - self._history[0].io_write_bytes
            
        return ResourceUsage(
            cpu_percent=statistics.mean(cpu_values) if cpu_values else 0.0,
            memory_mb=statistics.mean(memory_values) if memory_values else 0.0,
            peak_memory_mb=max(memory_values) if memory_values else 0.0,
            average_cpu_percent=statistics.mean(cpu_values) if cpu_values else 0.0,
            disk_bytes_read=io_read_bytes,
            disk_bytes_write=io_write_bytes,
            network_bytes_sent=0,  # Calculated separately
            network_bytes_recv=0   # Calculated separately
        )
        
    def get_current_usage(self) -> Optional[ResourceSnapshot]:
        """Get the most recent resource snapshot."""
        return self._history[-1] if self._history else None
        
    def get_statistics(self) -> Dict[str, Any]:
        """Get statistical summary of resource usage."""
        if not self._history:
            return {}
            
        cpu_values = [s.cpu_percent for s in self._history]
        memory_values = [s.memory_mb for s in self._history]
        thread_values = [s.thread_count for s in self._history]
        
        return {
            "cpu": {
                "mean": statistics.mean(cpu_values),
                "median": statistics.median(cpu_values),
                "stdev": statistics.stdev(cpu_values) if len(cpu_values) > 1 else 0,
                "min": min(cpu_values),
                "max": max(cpu_values)
            },
            "memory_mb": {
                "mean": statistics.mean(memory_values),
                "median": statistics.median(memory_values),
                "stdev": statistics.stdev(memory_values) if len(memory_values) > 1 else 0,
                "min": min(memory_values),
                "max": max(memory_values)
            },
            "threads": {
                "mean": statistics.mean(thread_values),
                "min": min(thread_values),
                "max": max(thread_values)
            },
            "alerts": len(self._alerts),
            "samples": len(self._history)
        }
        
    def get_alerts(self) -> List[ResourceAlert]:
        """Get all resource alerts."""
        return self._alerts.copy()
        

class SystemResourceMonitor:
    """Monitor system-wide resources."""
    
    def __init__(self):
        """Initialize system monitor."""
        self._baseline: Optional[Dict[str, Any]] = None
        
    def take_baseline(self) -> Dict[str, Any]:
        """Take a baseline measurement of system resources."""
        cpu_percent = psutil.cpu_percent(interval=1.0, percpu=True)
        memory = psutil.virtual_memory()
        disk_io = psutil.disk_io_counters()
        net_io = psutil.net_io_counters()
        
        self._baseline = {
            "timestamp": time.time(),
            "cpu_percent": sum(cpu_percent) / len(cpu_percent),
            "cpu_percent_per_core": cpu_percent,
            "memory_available_mb": memory.available / 1024 / 1024,
            "memory_percent": memory.percent,
            "disk_read_bytes": disk_io.read_bytes if disk_io else 0,
            "disk_write_bytes": disk_io.write_bytes if disk_io else 0,
            "network_sent_bytes": net_io.bytes_sent if net_io else 0,
            "network_recv_bytes": net_io.bytes_recv if net_io else 0
        }
        
        return self._baseline
        
    def measure_delta(self) -> Dict[str, Any]:
        """Measure changes since baseline."""
        if not self._baseline:
            return {}
            
        current = self.take_baseline()
        
        return {
            "duration_seconds": current["timestamp"] - self._baseline["timestamp"],
            "cpu_percent_delta": current["cpu_percent"] - self._baseline["cpu_percent"],
            "memory_percent_delta": current["memory_percent"] - self._baseline["memory_percent"],
            "disk_read_mb": (current["disk_read_bytes"] - self._baseline["disk_read_bytes"]) / 1024 / 1024,
            "disk_write_mb": (current["disk_write_bytes"] - self._baseline["disk_write_bytes"]) / 1024 / 1024,
            "network_sent_mb": (current["network_sent_bytes"] - self._baseline["network_sent_bytes"]) / 1024 / 1024,
            "network_recv_mb": (current["network_recv_bytes"] - self._baseline["network_recv_bytes"]) / 1024 / 1024
        }