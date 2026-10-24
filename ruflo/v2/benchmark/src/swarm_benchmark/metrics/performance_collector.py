"""Real-time performance metrics collector for claude-flow benchmarks."""

from __future__ import annotations
import asyncio
import time
import psutil
import subprocess
import threading
from typing import Dict, List, Optional, Any, Tuple
from dataclasses import dataclass, field
from datetime import datetime
import json
import os
from pathlib import Path

from ..core.models import PerformanceMetrics, ResourceUsage


@dataclass
class ProcessMetrics:
    """Metrics for a single process."""
    pid: int
    name: str
    cpu_percent: float = 0.0
    memory_mb: float = 0.0
    num_threads: int = 0
    num_fds: int = 0  # File descriptors
    create_time: float = 0.0
    
    
@dataclass
class CollectionInterval:
    """Metrics collected during an interval."""
    timestamp: datetime
    duration_ms: float
    process_metrics: List[ProcessMetrics]
    system_metrics: Dict[str, Any]
    

class PerformanceCollector:
    """Collects real performance metrics from claude-flow executions."""
    
    def __init__(self, sample_interval: float = 0.1):
        """Initialize the performance collector.
        
        Args:
            sample_interval: How often to sample metrics (seconds)
        """
        self.sample_interval = sample_interval
        self._collection_thread: Optional[threading.Thread] = None
        self._stop_event = threading.Event()
        self._metrics_buffer: List[CollectionInterval] = []
        self._process_map: Dict[int, ProcessMetrics] = {}
        self._start_time: Optional[float] = None
        self._end_time: Optional[float] = None
        self._tracked_pids: List[int] = []
        self._main_process: Optional[psutil.Process] = None
        
    def start_collection(self, process: Optional[subprocess.Popen] = None) -> None:
        """Start collecting metrics.
        
        Args:
            process: Optional subprocess to track (will track it and all children)
        """
        self._stop_event.clear()
        self._metrics_buffer.clear()
        self._process_map.clear()
        self._start_time = time.time()
        self._end_time = None
        
        if process:
            try:
                self._main_process = psutil.Process(process.pid)
                self._tracked_pids = [process.pid]
            except psutil.NoSuchProcess:
                self._main_process = None
                
        self._collection_thread = threading.Thread(
            target=self._collect_metrics,
            daemon=True
        )
        self._collection_thread.start()
        
    def stop_collection(self) -> PerformanceMetrics:
        """Stop collecting metrics and return aggregated results."""
        self._stop_event.set()
        self._end_time = time.time()
        
        if self._collection_thread:
            self._collection_thread.join(timeout=5.0)
            
        return self._aggregate_metrics()
        
    def _collect_metrics(self) -> None:
        """Background thread that collects metrics."""
        while not self._stop_event.is_set():
            interval_start = time.time()
            
            # Collect process metrics
            process_metrics = self._collect_process_metrics()
            
            # Collect system metrics
            system_metrics = self._collect_system_metrics()
            
            interval_duration = (time.time() - interval_start) * 1000
            
            interval = CollectionInterval(
                timestamp=datetime.now(),
                duration_ms=interval_duration,
                process_metrics=process_metrics,
                system_metrics=system_metrics
            )
            
            self._metrics_buffer.append(interval)
            
            # Sleep for the remainder of the interval
            sleep_time = max(0, self.sample_interval - (time.time() - interval_start))
            if sleep_time > 0:
                time.sleep(sleep_time)
                
    def _collect_process_metrics(self) -> List[ProcessMetrics]:
        """Collect metrics for tracked processes."""
        metrics = []
        
        if self._main_process:
            try:
                # Get main process and all children
                processes = [self._main_process] + self._main_process.children(recursive=True)
                
                for proc in processes:
                    try:
                        # Get process info
                        with proc.oneshot():
                            pm = ProcessMetrics(
                                pid=proc.pid,
                                name=proc.name(),
                                cpu_percent=proc.cpu_percent(interval=None),
                                memory_mb=proc.memory_info().rss / 1024 / 1024,
                                num_threads=proc.num_threads(),
                                create_time=proc.create_time()
                            )
                            
                            # Try to get file descriptors (may not be available on all platforms)
                            try:
                                pm.num_fds = proc.num_fds()
                            except (AttributeError, psutil.AccessDenied):
                                pm.num_fds = 0
                                
                            metrics.append(pm)
                            self._process_map[pm.pid] = pm
                            
                    except (psutil.NoSuchProcess, psutil.AccessDenied):
                        continue
                        
            except (psutil.NoSuchProcess, psutil.AccessDenied):
                self._main_process = None
                
        return metrics
        
    def _collect_system_metrics(self) -> Dict[str, Any]:
        """Collect system-wide metrics."""
        try:
            # CPU metrics
            cpu_percent = psutil.cpu_percent(interval=None, percpu=True)
            cpu_freq = psutil.cpu_freq()
            
            # Memory metrics
            memory = psutil.virtual_memory()
            swap = psutil.swap_memory()
            
            # Disk I/O
            disk_io = psutil.disk_io_counters()
            
            # Network I/O
            net_io = psutil.net_io_counters()
            
            return {
                "cpu": {
                    "percent": sum(cpu_percent) / len(cpu_percent),
                    "percent_per_core": cpu_percent,
                    "frequency_mhz": cpu_freq.current if cpu_freq else 0,
                    "core_count": psutil.cpu_count()
                },
                "memory": {
                    "total_mb": memory.total / 1024 / 1024,
                    "used_mb": memory.used / 1024 / 1024,
                    "available_mb": memory.available / 1024 / 1024,
                    "percent": memory.percent,
                    "swap_used_mb": swap.used / 1024 / 1024
                },
                "disk_io": {
                    "read_bytes": disk_io.read_bytes if disk_io else 0,
                    "write_bytes": disk_io.write_bytes if disk_io else 0,
                    "read_count": disk_io.read_count if disk_io else 0,
                    "write_count": disk_io.write_count if disk_io else 0
                },
                "network_io": {
                    "bytes_sent": net_io.bytes_sent if net_io else 0,
                    "bytes_recv": net_io.bytes_recv if net_io else 0,
                    "packets_sent": net_io.packets_sent if net_io else 0,
                    "packets_recv": net_io.packets_recv if net_io else 0
                }
            }
        except Exception as e:
            return {"error": str(e)}
            
    def _aggregate_metrics(self) -> PerformanceMetrics:
        """Aggregate collected metrics into final performance metrics."""
        if not self._metrics_buffer:
            return PerformanceMetrics()
            
        # Calculate execution time
        execution_time = (self._end_time or time.time()) - self._start_time
        
        # Aggregate process metrics
        total_cpu = 0.0
        peak_memory_mb = 0.0
        avg_memory_mb = 0.0
        total_samples = 0
        
        for interval in self._metrics_buffer:
            interval_cpu = sum(pm.cpu_percent for pm in interval.process_metrics)
            interval_memory = sum(pm.memory_mb for pm in interval.process_metrics)
            
            total_cpu += interval_cpu
            peak_memory_mb = max(peak_memory_mb, interval_memory)
            avg_memory_mb += interval_memory
            total_samples += 1
            
        if total_samples > 0:
            avg_cpu_percent = total_cpu / total_samples
            avg_memory_mb = avg_memory_mb / total_samples
        else:
            avg_cpu_percent = 0.0
            avg_memory_mb = 0.0
            
        # Calculate network and disk I/O deltas
        network_bytes_sent = 0
        network_bytes_recv = 0
        disk_bytes_read = 0
        disk_bytes_write = 0
        
        if len(self._metrics_buffer) >= 2:
            first_metrics = self._metrics_buffer[0].system_metrics
            last_metrics = self._metrics_buffer[-1].system_metrics
            
            if "network_io" in first_metrics and "network_io" in last_metrics:
                network_bytes_sent = last_metrics["network_io"]["bytes_sent"] - first_metrics["network_io"]["bytes_sent"]
                network_bytes_recv = last_metrics["network_io"]["bytes_recv"] - first_metrics["network_io"]["bytes_recv"]
                
            if "disk_io" in first_metrics and "disk_io" in last_metrics:
                disk_bytes_read = last_metrics["disk_io"]["read_bytes"] - first_metrics["disk_io"]["read_bytes"]
                disk_bytes_write = last_metrics["disk_io"]["write_bytes"] - first_metrics["disk_io"]["write_bytes"]
                
        # Create ResourceUsage
        resource_usage = ResourceUsage(
            cpu_percent=avg_cpu_percent,
            memory_mb=avg_memory_mb,
            peak_memory_mb=peak_memory_mb,
            average_cpu_percent=avg_cpu_percent,
            network_bytes_sent=network_bytes_sent,
            network_bytes_recv=network_bytes_recv,
            disk_bytes_read=disk_bytes_read,
            disk_bytes_write=disk_bytes_write
        )
        
        # Calculate throughput (tasks per second)
        throughput = 1.0 / execution_time if execution_time > 0 else 0.0
        
        return PerformanceMetrics(
            execution_time=execution_time,
            throughput=throughput,
            success_rate=1.0,  # Will be updated by the caller based on success/failure
            error_rate=0.0,
            retry_count=0,
            coordination_overhead=0.0,  # Will be calculated separately
            communication_latency=0.0   # Will be calculated separately
        )
        
    def get_detailed_metrics(self) -> Dict[str, Any]:
        """Get detailed metrics for analysis."""
        return {
            "summary": {
                "start_time": self._start_time,
                "end_time": self._end_time,
                "duration": (self._end_time or time.time()) - self._start_time if self._start_time else 0,
                "sample_count": len(self._metrics_buffer),
                "process_count": len(self._process_map)
            },
            "processes": [
                {
                    "pid": pm.pid,
                    "name": pm.name,
                    "avg_cpu_percent": pm.cpu_percent,
                    "peak_memory_mb": pm.memory_mb,
                    "num_threads": pm.num_threads,
                    "num_fds": pm.num_fds
                }
                for pm in self._process_map.values()
            ],
            "intervals": [
                {
                    "timestamp": interval.timestamp.isoformat(),
                    "duration_ms": interval.duration_ms,
                    "process_count": len(interval.process_metrics),
                    "total_cpu_percent": sum(pm.cpu_percent for pm in interval.process_metrics),
                    "total_memory_mb": sum(pm.memory_mb for pm in interval.process_metrics)
                }
                for interval in self._metrics_buffer[-100:]  # Last 100 samples
            ]
        }
        
    def save_raw_metrics(self, filepath: Path) -> None:
        """Save raw metrics data for later analysis."""
        data = {
            "collection_info": {
                "start_time": self._start_time,
                "end_time": self._end_time,
                "sample_interval": self.sample_interval,
                "sample_count": len(self._metrics_buffer)
            },
            "intervals": [
                {
                    "timestamp": interval.timestamp.isoformat(),
                    "duration_ms": interval.duration_ms,
                    "processes": [
                        {
                            "pid": pm.pid,
                            "name": pm.name,
                            "cpu_percent": pm.cpu_percent,
                            "memory_mb": pm.memory_mb,
                            "num_threads": pm.num_threads,
                            "num_fds": pm.num_fds
                        }
                        for pm in interval.process_metrics
                    ],
                    "system": interval.system_metrics
                }
                for interval in self._metrics_buffer
            ]
        }
        
        with open(filepath, "w") as f:
            json.dump(data, f, indent=2)
            

class AsyncPerformanceCollector(PerformanceCollector):
    """Async version of the performance collector."""
    
    async def start_collection_async(self, process: Optional[subprocess.Popen] = None) -> None:
        """Start collecting metrics asynchronously."""
        self.start_collection(process)
        
    async def stop_collection_async(self) -> PerformanceMetrics:
        """Stop collecting metrics asynchronously."""
        return await asyncio.get_event_loop().run_in_executor(
            None, self.stop_collection
        )
        
    async def collect_for_duration(self, duration: float, process: Optional[subprocess.Popen] = None) -> PerformanceMetrics:
        """Collect metrics for a specific duration."""
        await self.start_collection_async(process)
        await asyncio.sleep(duration)
        return await self.stop_collection_async()