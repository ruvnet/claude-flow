"""
Integration utilities for claude-flow command execution.

Provides helper functions and classes for:
- Command construction and validation
- Output parsing and metric extraction
- Error handling and recovery
- Performance monitoring
"""

import re
import json
import time
import psutil
import threading
from typing import Dict, List, Optional, Any, Tuple, Callable
from dataclasses import dataclass, field
from datetime import datetime
from pathlib import Path
import logging
from collections import defaultdict
from contextlib import contextmanager

logger = logging.getLogger(__name__)


@dataclass
class PerformanceMetrics:
    """Performance metrics for command execution."""
    cpu_percent: List[float] = field(default_factory=list)
    memory_percent: List[float] = field(default_factory=list)
    disk_io_read: List[float] = field(default_factory=list)
    disk_io_write: List[float] = field(default_factory=list)
    network_sent: List[float] = field(default_factory=list)
    network_recv: List[float] = field(default_factory=list)
    timestamps: List[float] = field(default_factory=list)
    
    def get_summary(self) -> Dict[str, Any]:
        """Get summary statistics."""
        def safe_avg(lst):
            return sum(lst) / len(lst) if lst else 0
            
        def safe_max(lst):
            return max(lst) if lst else 0
            
        return {
            "cpu": {
                "avg": safe_avg(self.cpu_percent),
                "max": safe_max(self.cpu_percent)
            },
            "memory": {
                "avg": safe_avg(self.memory_percent),
                "max": safe_max(self.memory_percent)
            },
            "disk_io": {
                "read_total": sum(self.disk_io_read),
                "write_total": sum(self.disk_io_write)
            },
            "network": {
                "sent_total": sum(self.network_sent),
                "recv_total": sum(self.network_recv)
            }
        }


class PerformanceMonitor:
    """Monitor system performance during command execution."""
    
    def __init__(self, interval: float = 1.0):
        """
        Initialize performance monitor.
        
        Args:
            interval: Sampling interval in seconds
        """
        self.interval = interval
        self.metrics = PerformanceMetrics()
        self._monitoring = False
        self._thread = None
        self._process = psutil.Process()
        self._last_disk_io = None
        self._last_network_io = None
        
    def start(self):
        """Start monitoring."""
        self._monitoring = True
        self._thread = threading.Thread(target=self._monitor_loop)
        self._thread.daemon = True
        self._thread.start()
        logger.debug("Performance monitoring started")
        
    def stop(self) -> PerformanceMetrics:
        """Stop monitoring and return metrics."""
        self._monitoring = False
        if self._thread:
            self._thread.join()
        logger.debug("Performance monitoring stopped")
        return self.metrics
        
    def _monitor_loop(self):
        """Main monitoring loop."""
        while self._monitoring:
            try:
                # CPU and memory
                self.metrics.cpu_percent.append(psutil.cpu_percent())
                self.metrics.memory_percent.append(psutil.virtual_memory().percent)
                
                # Disk I/O
                disk_io = psutil.disk_io_counters()
                if self._last_disk_io:
                    read_delta = disk_io.read_bytes - self._last_disk_io.read_bytes
                    write_delta = disk_io.write_bytes - self._last_disk_io.write_bytes
                    self.metrics.disk_io_read.append(read_delta / self.interval)
                    self.metrics.disk_io_write.append(write_delta / self.interval)
                self._last_disk_io = disk_io
                
                # Network I/O
                net_io = psutil.net_io_counters()
                if self._last_network_io:
                    sent_delta = net_io.bytes_sent - self._last_network_io.bytes_sent
                    recv_delta = net_io.bytes_recv - self._last_network_io.bytes_recv
                    self.metrics.network_sent.append(sent_delta / self.interval)
                    self.metrics.network_recv.append(recv_delta / self.interval)
                self._last_network_io = net_io
                
                # Timestamp
                self.metrics.timestamps.append(time.time())
                
            except Exception as e:
                logger.error(f"Error in performance monitoring: {e}")
                
            time.sleep(self.interval)


@contextmanager
def performance_monitoring(interval: float = 1.0):
    """Context manager for performance monitoring."""
    monitor = PerformanceMonitor(interval)
    monitor.start()
    try:
        yield monitor
    finally:
        metrics = monitor.stop()
        logger.info(f"Performance summary: {metrics.get_summary()}")


class OutputParser:
    """Parse and extract information from claude-flow output."""
    
    # Regex patterns for common output elements
    PATTERNS = {
        "task_created": re.compile(r"Task created:\s*([^\n]+)"),
        "task_completed": re.compile(r"✅\s*Task completed:\s*([^\n]+)"),
        "agent_started": re.compile(r"Agent\s+(\w+)\s+started"),
        "agent_completed": re.compile(r"Agent\s+(\w+)\s+completed"),
        "error": re.compile(r"(?:❌|ERROR|Error):\s*([^\n]+)"),
        "warning": re.compile(r"(?:⚠️|WARNING|Warning):\s*([^\n]+)"),
        "file_created": re.compile(r"Created file:\s*([^\n]+)"),
        "file_modified": re.compile(r"Modified file:\s*([^\n]+)"),
        "test_passed": re.compile(r"✅\s*(\d+)\s+tests?\s+passed"),
        "test_failed": re.compile(r"❌\s*(\d+)\s+tests?\s+failed"),
        "coverage": re.compile(r"Coverage:\s*(\d+(?:\.\d+)?)\s*%"),
        "duration": re.compile(r"Duration:\s*(\d+(?:\.\d+)?)\s*(s|ms|m|h)"),
        "memory_stored": re.compile(r"Stored in memory:\s*([^\n]+)"),
        "swarm_id": re.compile(r"Swarm ID:\s*([^\n]+)"),
    }
    
    @classmethod
    def parse_output(cls, output: str) -> Dict[str, Any]:
        """
        Parse claude-flow output and extract structured information.
        
        Args:
            output: Raw output from claude-flow command
            
        Returns:
            Dictionary with parsed information
        """
        result = {
            "tasks": {
                "created": [],
                "completed": []
            },
            "agents": {
                "started": [],
                "completed": []
            },
            "files": {
                "created": [],
                "modified": []
            },
            "tests": {
                "passed": 0,
                "failed": 0,
                "coverage": None
            },
            "errors": [],
            "warnings": [],
            "memory_keys": [],
            "swarm_id": None,
            "duration": None
        }
        
        # Extract matches
        for line in output.split('\n'):
            # Tasks
            if match := cls.PATTERNS["task_created"].search(line):
                result["tasks"]["created"].append(match.group(1))
            if match := cls.PATTERNS["task_completed"].search(line):
                result["tasks"]["completed"].append(match.group(1))
                
            # Agents
            if match := cls.PATTERNS["agent_started"].search(line):
                result["agents"]["started"].append(match.group(1))
            if match := cls.PATTERNS["agent_completed"].search(line):
                result["agents"]["completed"].append(match.group(1))
                
            # Files
            if match := cls.PATTERNS["file_created"].search(line):
                result["files"]["created"].append(match.group(1))
            if match := cls.PATTERNS["file_modified"].search(line):
                result["files"]["modified"].append(match.group(1))
                
            # Tests
            if match := cls.PATTERNS["test_passed"].search(line):
                result["tests"]["passed"] = int(match.group(1))
            if match := cls.PATTERNS["test_failed"].search(line):
                result["tests"]["failed"] = int(match.group(1))
            if match := cls.PATTERNS["coverage"].search(line):
                result["tests"]["coverage"] = float(match.group(1))
                
            # Errors and warnings
            if match := cls.PATTERNS["error"].search(line):
                result["errors"].append(match.group(1))
            if match := cls.PATTERNS["warning"].search(line):
                result["warnings"].append(match.group(1))
                
            # Memory
            if match := cls.PATTERNS["memory_stored"].search(line):
                result["memory_keys"].append(match.group(1))
                
            # Swarm ID
            if match := cls.PATTERNS["swarm_id"].search(line):
                result["swarm_id"] = match.group(1)
                
            # Duration
            if match := cls.PATTERNS["duration"].search(line):
                value = float(match.group(1))
                unit = match.group(2)
                # Convert to seconds
                if unit == "ms":
                    value /= 1000
                elif unit == "m":
                    value *= 60
                elif unit == "h":
                    value *= 3600
                result["duration"] = value
                
        return result
        
    @classmethod
    def extract_json_blocks(cls, output: str) -> List[Dict[str, Any]]:
        """Extract JSON blocks from output."""
        json_blocks = []
        
        # Find JSON-like blocks
        json_pattern = re.compile(r'\{[^{}]*\}', re.DOTALL)
        
        for match in json_pattern.finditer(output):
            try:
                data = json.loads(match.group())
                json_blocks.append(data)
            except json.JSONDecodeError:
                pass
                
        return json_blocks


class CommandBuilder:
    """Build claude-flow commands with validation."""
    
    VALID_STRATEGIES = {
        "auto", "research", "development", "analysis", 
        "testing", "optimization", "maintenance"
    }
    
    VALID_MODES = {
        "centralized", "distributed", "hierarchical", "mesh", "hybrid"
    }
    
    VALID_SPARC_MODES = {
        "orchestrator", "swarm-coordinator", "workflow-manager", "batch-executor",
        "coder", "architect", "reviewer", "tdd", "researcher", "analyzer",
        "optimizer", "designer", "innovator", "documenter", "debugger",
        "tester", "memory-manager"
    }
    
    @classmethod
    def validate_swarm_config(cls, config: Dict[str, Any]) -> List[str]:
        """
        Validate swarm configuration.
        
        Returns:
            List of validation errors (empty if valid)
        """
        errors = []
        
        # Required fields
        if not config.get("objective"):
            errors.append("Objective is required")
            
        # Strategy validation
        if strategy := config.get("strategy"):
            if strategy not in cls.VALID_STRATEGIES:
                errors.append(f"Invalid strategy: {strategy}")
                
        # Mode validation
        if mode := config.get("mode"):
            if mode not in cls.VALID_MODES:
                errors.append(f"Invalid mode: {mode}")
                
        # Numeric validations
        if max_agents := config.get("max_agents"):
            if not isinstance(max_agents, int) or max_agents < 1:
                errors.append("max_agents must be a positive integer")
                
        if timeout := config.get("timeout"):
            if not isinstance(timeout, (int, float)) or timeout <= 0:
                errors.append("timeout must be a positive number")
                
        return errors
        
    @classmethod
    def validate_sparc_config(cls, config: Dict[str, Any]) -> List[str]:
        """
        Validate SPARC configuration.
        
        Returns:
            List of validation errors (empty if valid)
        """
        errors = []
        
        # Required fields
        if not config.get("prompt"):
            errors.append("Prompt is required")
            
        # Mode validation
        if mode := config.get("mode"):
            if mode not in cls.VALID_SPARC_MODES:
                errors.append(f"Invalid SPARC mode: {mode}")
                
        return errors
        
    @classmethod
    def build_swarm_command(cls, 
                           objective: str,
                           **kwargs) -> List[str]:
        """Build a swarm command with options."""
        command = ["swarm", objective]
        
        # Add options
        for key, value in kwargs.items():
            if value is None:
                continue
                
            # Convert to command line format
            option = f"--{key.replace('_', '-')}"
            
            # Boolean flags
            if isinstance(value, bool):
                if value:
                    command.append(option)
            # Other values
            else:
                command.extend([option, str(value)])
                
        return command
        
    @classmethod
    def build_sparc_command(cls,
                           prompt: str,
                           mode: Optional[str] = None,
                           **kwargs) -> List[str]:
        """Build a SPARC command with options."""
        command = ["sparc"]
        
        # Add mode if specified
        if mode:
            command.extend(["run", mode])
            
        command.append(prompt)
        
        # Add options
        for key, value in kwargs.items():
            if value is None:
                continue
                
            option = f"--{key.replace('_', '-')}"
            
            if isinstance(value, bool):
                if value:
                    command.append(option)
            else:
                command.extend([option, str(value)])
                
        return command


class ErrorHandler:
    """Handle and categorize errors from claude-flow execution."""
    
    ERROR_CATEGORIES = {
        "installation": [
            "command not found",
            "no such file",
            "permission denied",
            "not executable"
        ],
        "configuration": [
            "invalid option",
            "unknown command",
            "missing required",
            "invalid value"
        ],
        "runtime": [
            "runtime error",
            "execution failed",
            "process terminated",
            "segmentation fault"
        ],
        "timeout": [
            "timeout",
            "timed out",
            "deadline exceeded"
        ],
        "resource": [
            "out of memory",
            "disk full",
            "too many open files",
            "resource exhausted"
        ],
        "network": [
            "connection refused",
            "network unreachable",
            "dns resolution failed",
            "socket error"
        ]
    }
    
    @classmethod
    def categorize_error(cls, error_text: str) -> str:
        """
        Categorize an error based on its text.
        
        Args:
            error_text: Error message text
            
        Returns:
            Error category
        """
        error_lower = error_text.lower()
        
        for category, patterns in cls.ERROR_CATEGORIES.items():
            if any(pattern in error_lower for pattern in patterns):
                return category
                
        return "unknown"
        
    @classmethod
    def get_recovery_suggestion(cls, category: str) -> str:
        """Get recovery suggestion for error category."""
        suggestions = {
            "installation": "Check claude-flow installation and permissions",
            "configuration": "Verify command syntax and options",
            "runtime": "Check system resources and claude-flow logs",
            "timeout": "Increase timeout or reduce workload",
            "resource": "Free up system resources",
            "network": "Check network connectivity and firewall settings",
            "unknown": "Check logs for more details"
        }
        
        return suggestions.get(category, "Unknown error - check logs")
        
    @classmethod
    def should_retry(cls, category: str) -> bool:
        """Determine if error category is retryable."""
        retryable = {"timeout", "resource", "network"}
        return category in retryable


class ProgressTracker:
    """Track progress of claude-flow execution."""
    
    def __init__(self):
        self.events = []
        self.start_time = None
        self.task_progress = defaultdict(lambda: {"status": "pending", "start": None, "end": None})
        
    def start(self):
        """Start tracking."""
        self.start_time = time.time()
        self.add_event("tracking_started", {})
        
    def add_event(self, event_type: str, data: Dict[str, Any]):
        """Add a tracking event."""
        event = {
            "type": event_type,
            "timestamp": time.time(),
            "elapsed": time.time() - self.start_time if self.start_time else 0,
            "data": data
        }
        self.events.append(event)
        
        # Update task progress
        if event_type == "task_started":
            task_id = data.get("task_id")
            if task_id:
                self.task_progress[task_id]["status"] = "in_progress"
                self.task_progress[task_id]["start"] = event["timestamp"]
                
        elif event_type == "task_completed":
            task_id = data.get("task_id")
            if task_id:
                self.task_progress[task_id]["status"] = "completed"
                self.task_progress[task_id]["end"] = event["timestamp"]
                
    def get_summary(self) -> Dict[str, Any]:
        """Get progress summary."""
        total_tasks = len(self.task_progress)
        completed_tasks = sum(1 for t in self.task_progress.values() if t["status"] == "completed")
        
        return {
            "duration": time.time() - self.start_time if self.start_time else 0,
            "total_events": len(self.events),
            "tasks": {
                "total": total_tasks,
                "completed": completed_tasks,
                "in_progress": sum(1 for t in self.task_progress.values() if t["status"] == "in_progress"),
                "pending": sum(1 for t in self.task_progress.values() if t["status"] == "pending")
            },
            "task_details": dict(self.task_progress)
        }
        
    def parse_output_stream(self, line: str):
        """Parse a line of output and track progress."""
        # Task creation
        if "Task created:" in line:
            task_id = line.split("Task created:")[-1].strip()
            self.add_event("task_started", {"task_id": task_id, "line": line})
            
        # Task completion
        elif "✅" in line and "completed" in line.lower():
            self.add_event("task_completed", {"line": line})
            
        # Agent events
        elif "Agent" in line and "started" in line:
            self.add_event("agent_started", {"line": line})
            
        # Errors
        elif "❌" in line or "ERROR" in line:
            self.add_event("error", {"line": line})


def create_workspace(base_dir: str = None) -> Path:
    """
    Create a temporary workspace for claude-flow execution.
    
    Args:
        base_dir: Base directory for workspace (uses temp if None)
        
    Returns:
        Path to workspace directory
    """
    import tempfile
    
    if base_dir:
        workspace = Path(base_dir) / f"claude_flow_workspace_{int(time.time())}"
        workspace.mkdir(parents=True, exist_ok=True)
    else:
        workspace = Path(tempfile.mkdtemp(prefix="claude_flow_"))
        
    logger.info(f"Created workspace: {workspace}")
    return workspace


def cleanup_workspace(workspace: Path, force: bool = False):
    """
    Clean up a workspace directory.
    
    Args:
        workspace: Path to workspace
        force: Force removal even if not empty
    """
    import shutil
    
    if not workspace.exists():
        return
        
    try:
        if force:
            shutil.rmtree(workspace)
        else:
            workspace.rmdir()  # Only removes if empty
        logger.info(f"Cleaned up workspace: {workspace}")
    except Exception as e:
        logger.error(f"Failed to clean up workspace: {e}")