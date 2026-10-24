"""
Claude-Flow Executor - Integration layer for executing claude-flow commands.

This module provides a robust interface to execute claude-flow commands with:
- Command construction for all modes and strategies
- Subprocess execution with proper output capture
- Timeout and error handling
- Retry logic for transient failures
- Comprehensive output parsing
"""

import subprocess
import json
import os
import time
import tempfile
import shutil
from pathlib import Path
from typing import Dict, List, Optional, Any, Tuple, Union
from dataclasses import dataclass, asdict
from enum import Enum
import logging
from datetime import datetime
import asyncio
import signal
from contextlib import contextmanager

logger = logging.getLogger(__name__)


class ExecutionStrategy(str, Enum):
    """Swarm execution strategies."""
    AUTO = "auto"
    RESEARCH = "research"
    DEVELOPMENT = "development"
    ANALYSIS = "analysis"
    TESTING = "testing"
    OPTIMIZATION = "optimization"
    MAINTENANCE = "maintenance"


class CoordinationMode(str, Enum):
    """Swarm coordination modes."""
    CENTRALIZED = "centralized"
    DISTRIBUTED = "distributed"
    HIERARCHICAL = "hierarchical"
    MESH = "mesh"
    HYBRID = "hybrid"


class OutputFormat(str, Enum):
    """Output formats for swarm results."""
    JSON = "json"
    SQLITE = "sqlite"
    CSV = "csv"
    HTML = "html"


class SparcMode(str, Enum):
    """SPARC execution modes."""
    ORCHESTRATOR = "orchestrator"
    SWARM_COORDINATOR = "swarm-coordinator"
    WORKFLOW_MANAGER = "workflow-manager"
    BATCH_EXECUTOR = "batch-executor"
    CODER = "coder"
    ARCHITECT = "architect"
    REVIEWER = "reviewer"
    TDD = "tdd"
    RESEARCHER = "researcher"
    ANALYZER = "analyzer"
    OPTIMIZER = "optimizer"
    DESIGNER = "designer"
    INNOVATOR = "innovator"
    DOCUMENTER = "documenter"
    DEBUGGER = "debugger"
    TESTER = "tester"
    MEMORY_MANAGER = "memory-manager"


@dataclass
class ExecutionResult:
    """Result of a claude-flow execution."""
    success: bool
    command: List[str]
    stdout: str
    stderr: str
    exit_code: int
    duration: float
    timeout: bool = False
    output_files: Dict[str, str] = None
    metrics: Dict[str, Any] = None
    
    def to_dict(self) -> Dict[str, Any]:
        """Convert to dictionary."""
        return asdict(self)


@dataclass
class SwarmConfig:
    """Configuration for swarm execution."""
    objective: str
    strategy: ExecutionStrategy = ExecutionStrategy.AUTO
    mode: CoordinationMode = CoordinationMode.CENTRALIZED
    max_agents: int = 5
    timeout: int = 60  # minutes
    parallel: bool = False
    monitor: bool = False
    output: OutputFormat = OutputFormat.JSON
    output_dir: str = "./reports"
    dry_run: bool = False
    batch_optimized: bool = False
    memory_shared: bool = False
    file_ops_parallel: bool = False
    test_types: Optional[List[str]] = None
    coverage_target: Optional[int] = None
    
    def to_command_args(self) -> List[str]:
        """Convert config to command line arguments."""
        args = []
        args.extend(["--strategy", self.strategy.value])
        args.extend(["--mode", self.mode.value])
        args.extend(["--max-agents", str(self.max_agents)])
        args.extend(["--timeout", str(self.timeout)])
        
        if self.parallel:
            args.append("--parallel")
        if self.monitor:
            args.append("--monitor")
        if self.dry_run:
            args.append("--dry-run")
            
        args.extend(["--output", self.output.value])
        args.extend(["--output-dir", self.output_dir])
        
        # Extended options for benchmarking
        if self.batch_optimized:
            args.append("--batch-optimized")
        if self.memory_shared:
            args.append("--memory-shared")
        if self.file_ops_parallel:
            args.append("--file-ops-parallel")
        if self.test_types:
            args.extend(["--test-types", ",".join(self.test_types)])
        if self.coverage_target:
            args.extend(["--coverage-target", str(self.coverage_target)])
            
        return args


@dataclass
class SparcConfig:
    """Configuration for SPARC execution."""
    prompt: str
    mode: Optional[SparcMode] = None
    memory_key: Optional[str] = None
    parallel: bool = False
    monitor: bool = False
    batch: bool = False
    timeout: int = 60  # minutes
    
    def to_command_args(self) -> List[str]:
        """Convert config to command line arguments."""
        args = []
        
        if self.mode:
            args.extend(["--mode", self.mode.value])
        if self.memory_key:
            args.extend(["--memory-key", self.memory_key])
        if self.parallel:
            args.append("--parallel")
        if self.monitor:
            args.append("--monitor")
        if self.batch:
            args.append("--batch")
            
        args.extend(["--timeout", str(self.timeout)])
        return args


class ClaudeFlowExecutor:
    """Executor for claude-flow commands with robust error handling."""
    
    def __init__(self, 
                 claude_flow_path: Optional[str] = None,
                 working_dir: Optional[str] = None,
                 env: Optional[Dict[str, str]] = None,
                 retry_attempts: int = 3,
                 retry_delay: float = 2.0):
        """
        Initialize the executor.
        
        Args:
            claude_flow_path: Path to claude-flow executable
            working_dir: Working directory for execution
            env: Environment variables
            retry_attempts: Number of retry attempts for transient failures
            retry_delay: Delay between retries in seconds
        """
        self.claude_flow_path = claude_flow_path or self._find_claude_flow()
        self.working_dir = Path(working_dir) if working_dir else Path.cwd()
        self.env = self._prepare_environment(env)
        self.retry_attempts = retry_attempts
        self.retry_delay = retry_delay
        
        logger.info(f"Initialized ClaudeFlowExecutor with path: {self.claude_flow_path}")
        
    def _find_claude_flow(self) -> str:
        """Find the claude-flow executable."""
        # Check common locations
        locations = [
            Path(__file__).parent.parent.parent.parent.parent / "bin" / "claude-flow",
            Path(__file__).parent.parent.parent.parent.parent / "claude-flow",
            Path.cwd() / "bin" / "claude-flow",
            Path.cwd() / "claude-flow",
        ]
        
        for loc in locations:
            if loc.exists() and os.access(loc, os.X_OK):
                return str(loc)
                
        # Try system path
        result = shutil.which("claude-flow")
        if result:
            return result
            
        raise RuntimeError("Could not find claude-flow executable")
        
    def _prepare_environment(self, env: Optional[Dict[str, str]]) -> Dict[str, str]:
        """Prepare environment variables."""
        base_env = os.environ.copy()
        
        # Ensure proper working directory
        base_env["PWD"] = str(self.working_dir)
        base_env["CLAUDE_WORKING_DIR"] = str(self.working_dir)
        
        # Add custom environment variables
        if env:
            base_env.update(env)
            
        return base_env
        
    @contextmanager
    def _timeout_handler(self, timeout_seconds: int):
        """Context manager for handling timeouts."""
        def timeout_handler(signum, frame):
            raise TimeoutError(f"Execution timed out after {timeout_seconds} seconds")
            
        # Set the signal handler
        old_handler = signal.signal(signal.SIGALRM, timeout_handler)
        signal.alarm(timeout_seconds)
        
        try:
            yield
        finally:
            signal.alarm(0)
            signal.signal(signal.SIGALRM, old_handler)
            
    def _execute_command(self, 
                        command: List[str], 
                        timeout: Optional[int] = None,
                        capture_output: bool = True) -> ExecutionResult:
        """
        Execute a command with proper error handling.
        
        Args:
            command: Command to execute
            timeout: Timeout in seconds
            capture_output: Whether to capture output
            
        Returns:
            ExecutionResult with execution details
        """
        start_time = time.time()
        timeout_occurred = False
        
        try:
            logger.info(f"Executing command: {' '.join(command)}")
            
            # Use subprocess.run for better control
            result = subprocess.run(
                command,
                cwd=str(self.working_dir),
                env=self.env,
                capture_output=capture_output,
                text=True,
                timeout=timeout
            )
            
            duration = time.time() - start_time
            
            return ExecutionResult(
                success=result.returncode == 0,
                command=command,
                stdout=result.stdout if capture_output else "",
                stderr=result.stderr if capture_output else "",
                exit_code=result.returncode,
                duration=duration,
                timeout=False
            )
            
        except subprocess.TimeoutExpired as e:
            duration = time.time() - start_time
            logger.error(f"Command timed out after {timeout} seconds")
            
            return ExecutionResult(
                success=False,
                command=command,
                stdout=e.stdout.decode() if e.stdout else "",
                stderr=e.stderr.decode() if e.stderr else "",
                exit_code=-1,
                duration=duration,
                timeout=True
            )
            
        except Exception as e:
            duration = time.time() - start_time
            logger.error(f"Command execution failed: {e}")
            
            return ExecutionResult(
                success=False,
                command=command,
                stdout="",
                stderr=str(e),
                exit_code=-1,
                duration=duration,
                timeout=False
            )
            
    def _retry_execute(self, 
                      command: List[str], 
                      timeout: Optional[int] = None) -> ExecutionResult:
        """Execute command with retry logic."""
        last_result = None
        
        for attempt in range(self.retry_attempts):
            if attempt > 0:
                logger.info(f"Retry attempt {attempt + 1}/{self.retry_attempts}")
                time.sleep(self.retry_delay)
                
            result = self._execute_command(command, timeout)
            last_result = result
            
            # Success or timeout - don't retry
            if result.success or result.timeout:
                return result
                
            # Check if error is retryable
            if not self._is_retryable_error(result):
                return result
                
        return last_result
        
    def _is_retryable_error(self, result: ExecutionResult) -> bool:
        """Check if error is retryable."""
        retryable_patterns = [
            "connection",
            "network",
            "temporary",
            "rate limit",
            "timeout"
        ]
        
        error_text = (result.stderr + result.stdout).lower()
        return any(pattern in error_text for pattern in retryable_patterns)
        
    def execute_swarm(self, config: SwarmConfig) -> ExecutionResult:
        """
        Execute a swarm command.
        
        Args:
            config: Swarm configuration
            
        Returns:
            ExecutionResult with execution details
        """
        # Build command
        command = [self.claude_flow_path, "swarm", config.objective]
        command.extend(config.to_command_args())
        
        # Execute with timeout in seconds
        timeout_seconds = config.timeout * 60
        result = self._retry_execute(command, timeout=timeout_seconds)
        
        # Parse output files if successful
        if result.success and not config.dry_run:
            result.output_files = self._find_output_files(config.output_dir)
            result.metrics = self._extract_metrics(result.stdout)
            
        return result
        
    def execute_sparc(self, config: SparcConfig) -> ExecutionResult:
        """
        Execute a SPARC command.
        
        Args:
            config: SPARC configuration
            
        Returns:
            ExecutionResult with execution details
        """
        # Build command
        command = [self.claude_flow_path, "sparc"]
        
        # Add mode-specific subcommand if needed
        if config.mode:
            command.extend(["run", config.mode.value])
            
        command.append(config.prompt)
        command.extend(config.to_command_args())
        
        # Execute with timeout in seconds
        timeout_seconds = config.timeout * 60
        result = self._retry_execute(command, timeout=timeout_seconds)
        
        # Extract metrics if successful
        if result.success:
            result.metrics = self._extract_metrics(result.stdout)
            
        return result
        
    def execute_task(self, 
                    task_type: str, 
                    description: str,
                    priority: str = "medium",
                    dependencies: Optional[List[str]] = None,
                    tags: Optional[List[str]] = None) -> ExecutionResult:
        """Execute a task command."""
        command = [self.claude_flow_path, "task", "create", task_type, description]
        command.extend(["--priority", priority])
        
        if dependencies:
            command.extend(["--dependencies", ",".join(dependencies)])
        if tags:
            command.extend(["--tags", ",".join(tags)])
            
        return self._retry_execute(command)
        
    def execute_memory_store(self, key: str, value: Any) -> ExecutionResult:
        """Store data in memory."""
        # Create temporary file for complex data
        with tempfile.NamedTemporaryFile(mode='w', suffix='.json', delete=False) as f:
            json.dump(value, f)
            temp_file = f.name
            
        try:
            command = [self.claude_flow_path, "memory", "store", key, f"@{temp_file}"]
            return self._retry_execute(command)
        finally:
            os.unlink(temp_file)
            
    def execute_memory_get(self, key: str) -> Tuple[ExecutionResult, Optional[Any]]:
        """Get data from memory."""
        command = [self.claude_flow_path, "memory", "get", key]
        result = self._retry_execute(command)
        
        if result.success:
            try:
                data = json.loads(result.stdout)
                return result, data
            except json.JSONDecodeError:
                logger.error(f"Failed to parse memory data: {result.stdout}")
                return result, None
        
        return result, None
        
    def execute_status(self, swarm_id: Optional[str] = None) -> ExecutionResult:
        """Get status of swarm execution."""
        command = [self.claude_flow_path, "status"]
        if swarm_id:
            command.append(swarm_id)
            
        return self._retry_execute(command)
        
    def _find_output_files(self, output_dir: str) -> Dict[str, str]:
        """Find output files in the specified directory."""
        output_path = Path(output_dir)
        if not output_path.exists():
            return {}
            
        files = {}
        for file_path in output_path.iterdir():
            if file_path.is_file():
                files[file_path.name] = str(file_path)
                
        return files
        
    def _extract_metrics(self, output: str) -> Dict[str, Any]:
        """Extract metrics from command output."""
        metrics = {
            "lines_processed": 0,
            "agents_used": 0,
            "tasks_completed": 0,
            "errors": 0,
            "warnings": 0
        }
        
        # Parse common patterns
        lines = output.split('\n')
        for line in lines:
            line_lower = line.lower()
            
            # Agent count
            if "agents" in line_lower and any(char.isdigit() for char in line):
                try:
                    agent_count = int(''.join(filter(str.isdigit, line.split("agents")[0])))
                    metrics["agents_used"] = max(metrics["agents_used"], agent_count)
                except:
                    pass
                    
            # Task completion
            if "completed" in line_lower and "task" in line_lower:
                metrics["tasks_completed"] += 1
                
            # Errors and warnings
            if "error" in line_lower:
                metrics["errors"] += 1
            if "warning" in line_lower:
                metrics["warnings"] += 1
                
        return metrics
        
    async def execute_async(self, 
                           command_type: str,
                           config: Union[SwarmConfig, SparcConfig]) -> ExecutionResult:
        """
        Execute commands asynchronously.
        
        Args:
            command_type: Type of command ("swarm" or "sparc")
            config: Command configuration
            
        Returns:
            ExecutionResult
        """
        loop = asyncio.get_event_loop()
        
        if command_type == "swarm":
            return await loop.run_in_executor(None, self.execute_swarm, config)
        elif command_type == "sparc":
            return await loop.run_in_executor(None, self.execute_sparc, config)
        else:
            raise ValueError(f"Unknown command type: {command_type}")
            
    def validate_installation(self) -> bool:
        """Validate claude-flow installation."""
        try:
            result = self._execute_command([self.claude_flow_path, "--version"])
            if result.success:
                logger.info(f"Claude-flow version: {result.stdout.strip()}")
                return True
            else:
                logger.error(f"Version check failed: {result.stderr}")
                return False
        except Exception as e:
            logger.error(f"Installation validation failed: {e}")
            return False