"""
Real Claude Flow Executor - Executes actual ./claude-flow commands with subprocess.

This module provides real command execution for Claude Flow integration:
- Executes real ./claude-flow commands via subprocess
- Uses --non-interactive flag for automation
- Parses stream-json output line by line
- Extracts real metrics from responses
- Handles streaming output properly
- Measures real execution time and token usage
"""

import subprocess
import json
import os
import time
import logging
import asyncio
from pathlib import Path
from typing import Dict, List, Optional, Any, Tuple, Union, Iterator
from dataclasses import dataclass, asdict
from enum import Enum
from datetime import datetime
import threading
import queue

logger = logging.getLogger(__name__)


class CommandType(str, Enum):
    """Claude Flow command types."""
    SWARM = "swarm"
    HIVE_MIND = "hive-mind"
    SPARC = "sparc"
    TASK = "task"
    MEMORY = "memory"
    STATUS = "status"


class OutputFormat(str, Enum):
    """Output formats."""
    STREAM_JSON = "stream-json"
    JSON = "json"
    TEXT = "text"


@dataclass
class RealExecutionResult:
    """Result of real Claude Flow command execution."""
    success: bool
    command: List[str]
    exit_code: int
    duration: float
    
    # Raw output
    stdout_lines: List[str]
    stderr_lines: List[str]
    
    # Parsed metrics
    input_tokens: int = 0
    output_tokens: int = 0
    total_tokens: int = 0
    agents_spawned: int = 0
    tasks_completed: int = 0
    
    # Tool usage
    tool_calls: List[Dict[str, Any]] = None
    tool_results: List[Dict[str, Any]] = None
    
    # Error details
    errors: List[str] = None
    warnings: List[str] = None
    
    # Timing details
    first_response_time: Optional[float] = None
    completion_time: Optional[float] = None
    
    def __post_init__(self):
        """Initialize mutable defaults."""
        if self.tool_calls is None:
            self.tool_calls = []
        if self.tool_results is None:
            self.tool_results = []
        if self.errors is None:
            self.errors = []
        if self.warnings is None:
            self.warnings = []
    
    def to_dict(self) -> Dict[str, Any]:
        """Convert to dictionary."""
        return asdict(self)


@dataclass
class SwarmCommand:
    """Configuration for swarm commands."""
    objective: str
    strategy: str = "auto"
    mode: str = "centralized"
    max_agents: int = 5
    timeout: int = 60
    output_format: OutputFormat = OutputFormat.STREAM_JSON
    additional_flags: List[str] = None
    
    def __post_init__(self):
        """Initialize mutable defaults."""
        if self.additional_flags is None:
            self.additional_flags = []


@dataclass
class HiveMindCommand:
    """Configuration for hive-mind commands."""
    action: str
    task: str = ""
    spawn_count: int = 3
    coordination_mode: str = "collective"
    additional_flags: List[str] = None
    
    def __post_init__(self):
        """Initialize mutable defaults."""
        if self.additional_flags is None:
            self.additional_flags = []


@dataclass
class SparcCommand:
    """Configuration for SPARC commands."""
    mode: str  # spec, architect, tdd, integration, refactor, etc.
    task: str
    output_format: Optional[str] = None  # markdown, json, yaml
    additional_flags: List[str] = None
    
    def __post_init__(self):
        """Initialize mutable defaults."""
        if self.additional_flags is None:
            self.additional_flags = []


class StreamingOutputParser:
    """Parser for streaming JSON output from Claude Flow."""
    
    def __init__(self):
        self.input_tokens = 0
        self.output_tokens = 0
        self.agents_spawned = 0
        self.tasks_completed = 0
        self.tool_calls = []
        self.tool_results = []
        self.errors = []
        self.warnings = []
        self.first_response_time = None
        self.start_time = None
    
    def parse_line(self, line: str, timestamp: float) -> Optional[Dict[str, Any]]:
        """Parse a single line of streaming JSON output."""
        if not line.strip():
            return None
            
        try:
            data = json.loads(line.strip())
            
            # Track first response time
            if self.first_response_time is None and self.start_time:
                self.first_response_time = timestamp - self.start_time
            
            # Parse different message types
            if isinstance(data, dict):
                self._parse_message(data)
                return data
                
        except json.JSONDecodeError:
            # Not JSON, might be plain text output
            self._parse_text_line(line.strip())
            
        return None
    
    def _parse_message(self, data: Dict[str, Any]):
        """Parse a structured message."""
        msg_type = data.get("type", "")
        
        if msg_type == "assistant":
            # Assistant message with usage info
            message = data.get("message", {})
            usage = message.get("usage", {})
            
            if "input_tokens" in usage:
                self.input_tokens += usage["input_tokens"]
            if "output_tokens" in usage:
                self.output_tokens += usage["output_tokens"]
                
        elif msg_type == "user":
            # User message, might contain tool calls
            message = data.get("message", {})
            content = message.get("content", [])
            
            for item in content if isinstance(content, list) else []:
                if isinstance(item, dict):
                    if "tool_use" in item or item.get("type") == "tool_use":
                        self.tool_calls.append(item)
                        
        elif msg_type == "tool_result":
            # Tool execution result
            self.tool_results.append(data)
            
        elif msg_type == "agent_spawned":
            # Agent spawning event
            self.agents_spawned += 1
            
        elif msg_type == "task_completed":
            # Task completion event
            self.tasks_completed += 1
            
        elif msg_type == "error":
            # Error message
            self.errors.append(data.get("message", str(data)))
            
        elif msg_type == "warning":
            # Warning message
            self.warnings.append(data.get("message", str(data)))
    
    def _parse_text_line(self, line: str):
        """Parse plain text line for patterns."""
        line_lower = line.lower()
        
        # Look for agent spawning patterns
        if "spawned" in line_lower and "agent" in line_lower:
            self.agents_spawned += 1
            
        # Look for task completion patterns
        if "completed" in line_lower and ("task" in line_lower or "objective" in line_lower):
            self.tasks_completed += 1
            
        # Look for error patterns
        if "error" in line_lower:
            self.errors.append(line)
            
        # Look for warning patterns
        if "warning" in line_lower:
            self.warnings.append(line)


class RealClaudeFlowExecutor:
    """Executor for real Claude Flow commands."""
    
    def __init__(self, 
                 claude_flow_path: Optional[str] = None,
                 working_dir: Optional[str] = None,
                 force_non_interactive: bool = True):
        """
        Initialize the real executor.
        
        Args:
            claude_flow_path: Path to ./claude-flow executable
            working_dir: Working directory for execution
            force_non_interactive: Always use non-interactive mode (default: True)
        """
        self.force_non_interactive = force_non_interactive
        self.claude_flow_path = claude_flow_path or self._find_claude_flow()
        self.working_dir = Path(working_dir) if working_dir else Path.cwd()
        
        logger.info(f"Initialized RealClaudeFlowExecutor with path: {self.claude_flow_path}")
        logger.info(f"Working directory: {self.working_dir}")
        
        # Validate claude-flow exists
        if not Path(self.claude_flow_path).exists():
            raise RuntimeError(f"Claude Flow executable not found: {self.claude_flow_path}")
    
    def _find_claude_flow(self) -> str:
        """Find the ./claude-flow executable."""
        # Look for ./claude-flow in current directory and parent directories
        current_dir = Path.cwd()
        
        # Check current directory and up to 3 levels up
        for _ in range(4):
            claude_flow_path = current_dir / "claude-flow"
            if claude_flow_path.exists() and os.access(claude_flow_path, os.X_OK):
                return str(claude_flow_path)
            current_dir = current_dir.parent
        
        # Check benchmark directory specifically
        benchmark_root = Path(__file__).parent.parent.parent.parent
        claude_flow_path = benchmark_root / "claude-flow"
        if claude_flow_path.exists() and os.access(claude_flow_path, os.X_OK):
            return str(claude_flow_path)
            
        # Default to ./claude-flow in current directory
        return "./claude-flow"
    
    def execute_swarm(self, config: SwarmCommand) -> RealExecutionResult:
        """Execute a real swarm command with built-in executor (non-interactive)."""
        # Build command: swarm "objective" --strategy S --mode M --max-agents N --executor --non-interactive
        command = [
            self.claude_flow_path,
            "swarm",
            config.objective,  # Objective comes right after swarm
            "--strategy", config.strategy,
            "--mode", config.mode,
            "--max-agents", str(config.max_agents),
            "--executor",  # Use built-in executor
            "--non-interactive"  # Non-interactive flag at the end
        ]
        
        # Add additional flags
        if config.additional_flags:
            command.extend(config.additional_flags)
        
        # Use the configured timeout (can be hours)
        timeout = config.timeout * 60  # Convert minutes to seconds
        
        return self._execute_streaming_command(command, timeout)
    
    def execute_hive_mind(self, config: HiveMindCommand) -> RealExecutionResult:
        """Execute a real hive-mind command with built-in executor (non-interactive)."""
        # For hive-mind, we need to handle the spawn command differently
        if config.action == "spawn":
            # Build command: hive-mind spawn "task" --count N --coordination MODE --non-interactive
            command = [
                self.claude_flow_path,
                "hive-mind", 
                "spawn",
                config.task,  # Task comes right after spawn
                "--count", str(config.spawn_count),
                "--coordination", config.coordination_mode,
                "--non-interactive"  # Non-interactive flag at the end
            ]
        else:
            # Other hive-mind commands
            command = [
                self.claude_flow_path,
                "hive-mind",
                config.action,
                "--non-interactive"  # Add non-interactive for all commands
            ]
            
            if config.task:
                command.append(config.task)
        
        # Add additional flags
        if config.additional_flags:
            command.extend(config.additional_flags)
        
        # Use a long timeout for benchmarks (default 6 hours)
        timeout = 6 * 60 * 60  # 6 hours in seconds
        return self._execute_streaming_command(command, timeout)
    
    def execute_sparc(self, config: SparcCommand) -> RealExecutionResult:
        """Execute a real SPARC command."""
        # Build real SPARC command
        command = [
            self.claude_flow_path,
            "sparc",
            config.mode,
            config.task
        ]
        
        # Add output format if specified
        if config.output_format:
            command.extend(["--format", config.output_format])
        
        # Add verbose for better output
        command.append("--verbose")
        
        # Add non-interactive flag for automation
        if self.force_non_interactive:
            command.append("--non-interactive")
        
        # Add file output if task contains a path
        if " in " in config.task:
            output_path = config.task.split(" in ")[-1].strip('"').strip("'")
            command.extend(["--file", output_path])
        
        # Add additional flags
        if config.additional_flags:
            command.extend(config.additional_flags)
        
        # Use a long timeout for SPARC benchmarks (default 2 hours)
        timeout = 2 * 60 * 60  # 2 hours in seconds
        return self._execute_streaming_command(command, timeout)
    
    def _execute_streaming_command(self, command: List[str], timeout_seconds: int) -> RealExecutionResult:
        """Execute command and parse streaming output."""
        # Log command with proper shell quoting for clarity
        import shlex
        logger.info(f"Executing command: {' '.join(shlex.quote(arg) for arg in command)}")
        
        # Check if this is a swarm/hive-mind command that might fail without Claude CLI
        is_ai_command = any(cmd in command for cmd in ["swarm", "hive-mind"])
        needs_fallback = False
        
        start_time = time.time()
        parser = StreamingOutputParser()
        parser.start_time = start_time
        
        stdout_lines = []
        stderr_lines = []
        
        try:
            # Start process
            process = subprocess.Popen(
                command,
                cwd=str(self.working_dir),
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                text=True,
                bufsize=1,
                universal_newlines=True
            )
            
            # Create queues for thread communication
            stdout_queue = queue.Queue()
            stderr_queue = queue.Queue()
            
            # Start threads to read stdout and stderr
            def read_stdout():
                for line in iter(process.stdout.readline, ""):
                    stdout_queue.put(("stdout", line, time.time()))
                stdout_queue.put(("stdout", None, time.time()))  # Signal end
            
            def read_stderr():
                for line in iter(process.stderr.readline, ""):
                    stderr_queue.put(("stderr", line, time.time()))
                stderr_queue.put(("stderr", None, time.time()))  # Signal end
            
            stdout_thread = threading.Thread(target=read_stdout)
            stderr_thread = threading.Thread(target=read_stderr)
            
            stdout_thread.start()
            stderr_thread.start()
            
            # Process output as it comes
            stdout_done = False
            stderr_done = False
            
            while not (stdout_done and stderr_done):
                # Check for timeout
                if time.time() - start_time > timeout_seconds:
                    process.kill()
                    break
                
                # Process stdout
                try:
                    stream_type, line, timestamp = stdout_queue.get_nowait()
                    if line is None:
                        stdout_done = True
                    else:
                        stdout_lines.append(line.rstrip())
                        parser.parse_line(line, timestamp)
                except queue.Empty:
                    pass
                
                # Process stderr
                try:
                    stream_type, line, timestamp = stderr_queue.get_nowait()
                    if line is None:
                        stderr_done = True
                    else:
                        stderr_lines.append(line.rstrip())
                except queue.Empty:
                    pass
                
                # Small sleep to prevent busy waiting
                time.sleep(0.01)
            
            # Wait for process to complete
            try:
                exit_code = process.wait(timeout=5)  # Give it 5 more seconds
            except subprocess.TimeoutExpired:
                process.kill()
                exit_code = -9  # SIGKILL
                stderr_lines.append(f"Process timed out after {timeout_seconds} seconds and was killed")
            
            # Wait for threads to complete
            stdout_thread.join(timeout=1)
            stderr_thread.join(timeout=1)
            
            duration = time.time() - start_time
            
            # No fallback - always use real execution
            # If Claude CLI is not available, the command will fail and that's expected
            
            # Create result
            result = RealExecutionResult(
                success=(exit_code == 0),
                command=command,
                exit_code=exit_code,
                duration=duration,
                stdout_lines=stdout_lines,
                stderr_lines=stderr_lines,
                input_tokens=parser.input_tokens,
                output_tokens=parser.output_tokens,
                total_tokens=parser.input_tokens + parser.output_tokens,
                agents_spawned=parser.agents_spawned,
                tasks_completed=parser.tasks_completed,
                tool_calls=parser.tool_calls,
                tool_results=parser.tool_results,
                errors=parser.errors,
                warnings=parser.warnings,
                first_response_time=parser.first_response_time,
                completion_time=duration
            )
            
            logger.info(f"Command completed in {duration:.2f}s with exit code {exit_code}")
            logger.info(f"Tokens: {result.input_tokens} input, {result.output_tokens} output")
            logger.info(f"Agents spawned: {result.agents_spawned}, Tasks completed: {result.tasks_completed}")
            
            return result
            
        except Exception as e:
            duration = time.time() - start_time
            logger.error(f"Command execution failed: {e}")
            
            return RealExecutionResult(
                success=False,
                command=command,
                exit_code=-1,
                duration=duration,
                stdout_lines=stdout_lines,
                stderr_lines=stderr_lines + [f"Execution error: {str(e)}"],
                errors=[str(e)]
            )
    
    # Removed fallback - always use real execution
    
    async def execute_swarm_async(self, config: SwarmCommand) -> RealExecutionResult:
        """Execute swarm command asynchronously."""
        loop = asyncio.get_event_loop()
        return await loop.run_in_executor(None, self.execute_swarm, config)
    
    async def execute_hive_mind_async(self, config: HiveMindCommand) -> RealExecutionResult:
        """Execute hive-mind command asynchronously."""
        loop = asyncio.get_event_loop()
        return await loop.run_in_executor(None, self.execute_hive_mind, config)
    
    async def execute_sparc_async(self, config: SparcCommand) -> RealExecutionResult:
        """Execute SPARC command asynchronously."""
        loop = asyncio.get_event_loop()
        return await loop.run_in_executor(None, self.execute_sparc, config)
    
    def validate_installation(self) -> bool:
        """Validate Claude Flow installation."""
        try:
            result = subprocess.run(
                [self.claude_flow_path, "--version"],
                cwd=str(self.working_dir),
                capture_output=True,
                text=True,
                timeout=10
            )
            
            if result.returncode == 0:
                logger.info(f"Claude Flow version: {result.stdout.strip()}")
                return True
            else:
                logger.error(f"Version check failed: {result.stderr}")
                return False
                
        except Exception as e:
            logger.error(f"Installation validation failed: {e}")
            return False
    
    def get_available_modes(self) -> List[str]:
        """Get available Claude Flow modes."""
        try:
            result = subprocess.run(
                [self.claude_flow_path, "--help"],
                cwd=str(self.working_dir),
                capture_output=True,
                text=True,
                timeout=10
            )
            
            if result.returncode == 0:
                # Parse help output to extract available commands
                lines = result.stdout.split('\n')
                modes = []
                
                in_commands = False
                for line in lines:
                    if "Commands:" in line or "Available commands:" in line:
                        in_commands = True
                        continue
                    
                    if in_commands and line.strip():
                        if line.startswith(' '):
                            # Extract command name
                            parts = line.strip().split()
                            if parts:
                                modes.append(parts[0])
                        else:
                            break  # End of commands section
                
                return modes
            
        except Exception as e:
            logger.error(f"Failed to get available modes: {e}")
        
        # Return default modes if detection fails
        return ["swarm", "hive-mind", "sparc", "task", "memory", "status"]


# Convenience functions for easy usage
def execute_swarm_benchmark(objective: str, 
                          strategy: str = "auto",
                          mode: str = "centralized", 
                          max_agents: int = 5,
                          timeout: int = 60) -> RealExecutionResult:
    """Execute a swarm benchmark with real Claude Flow."""
    executor = RealClaudeFlowExecutor()
    config = SwarmCommand(
        objective=objective,
        strategy=strategy,
        mode=mode,
        max_agents=max_agents,
        timeout=timeout
    )
    return executor.execute_swarm(config)


def execute_hive_mind_spawn(task: str,
                           spawn_count: int = 3,
                           coordination_mode: str = "collective") -> RealExecutionResult:
    """Execute a hive-mind spawn with real Claude Flow."""
    executor = RealClaudeFlowExecutor()
    config = HiveMindCommand(
        action="spawn",
        task=task,
        spawn_count=spawn_count,
        coordination_mode=coordination_mode
    )
    return executor.execute_hive_mind(config)


def execute_sparc_mode(mode: str, task: str, output_format: Optional[str] = None) -> RealExecutionResult:
    """Execute a SPARC mode with real Claude Flow."""
    executor = RealClaudeFlowExecutor()
    config = SparcCommand(
        mode=mode,
        task=task,
        output_format=output_format
    )
    return executor.execute_sparc(config)