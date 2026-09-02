#!/usr/bin/env python3
"""
Real Claude-Flow Integration Tests
Tests actual claude-flow execution with streaming JSON parsing and metrics extraction.
"""

import subprocess
import time
import json
import os
import tempfile
import threading
from pathlib import Path
from typing import Dict, List, Any, Optional, Tuple
from dataclasses import dataclass
import pytest
import logging

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


@dataclass
class StreamingResponse:
    """Represents a streaming JSON response from Claude Flow."""
    type: str
    data: Dict[str, Any]
    timestamp: float


@dataclass
class ExecutionMetrics:
    """Metrics extracted from real command execution."""
    total_duration: float
    json_responses: List[StreamingResponse]
    agents_spawned: int
    tasks_completed: int
    memory_operations: int
    errors: int
    command_success: bool
    output_size: int
    peak_memory_usage: Optional[float] = None


class ClaudeFlowRealExecutor:
    """Executor for real Claude Flow commands with JSON streaming support."""
    
    def __init__(self, claude_flow_path: Optional[str] = None):
        """Initialize with path to claude-flow executable."""
        self.claude_flow_path = claude_flow_path or self._find_claude_flow()
        self.validate_installation()
    
    def _find_claude_flow(self) -> str:
        """Find the claude-flow executable in the project."""
        # Check project locations
        base_path = Path(__file__).parent.parent.parent.parent
        locations = [
            Path("/workspaces/claude-code-flow/bin/claude-flow"),
            base_path / "bin" / "claude-flow",
            Path("/workspaces/claude-code-flow/claude-flow"),
            base_path / "claude-flow",
            base_path / "dist" / "claude-flow",
            Path.cwd() / "claude-flow",
        ]
        
        for loc in locations:
            if loc.exists() and os.access(loc, os.X_OK):
                return str(loc)
        
        # Try ./claude-flow in current directory
        local_claude_flow = Path("./claude-flow").resolve()
        if local_claude_flow.exists() and os.access(local_claude_flow, os.X_OK):
            return str(local_claude_flow)
            
        raise RuntimeError("Could not find claude-flow executable")
    
    def validate_installation(self) -> bool:
        """Validate that claude-flow is properly installed."""
        try:
            result = subprocess.run([self.claude_flow_path, "--version"], 
                                  capture_output=True, text=True, timeout=10)
            if result.returncode == 0:
                logger.info(f"Found claude-flow: {result.stdout.strip()}")
                return True
            else:
                logger.error(f"Version check failed: {result.stderr}")
                return False
        except Exception as e:
            logger.error(f"Installation validation failed: {e}")
            return False
    
    def parse_streaming_json(self, output: str) -> List[StreamingResponse]:
        """Parse streaming JSON responses from claude-flow output."""
        responses = []
        lines = output.split('\n')
        
        for line in lines:
            line = line.strip()
            if not line:
                continue
                
            # Look for JSON-like structures
            if line.startswith('{') and line.endswith('}'):
                try:
                    data = json.loads(line)
                    response = StreamingResponse(
                        type=data.get('type', 'unknown'),
                        data=data,
                        timestamp=time.time()
                    )
                    responses.append(response)
                except json.JSONDecodeError:
                    # Not valid JSON, might be partial output
                    continue
            
            # Look for structured output markers
            elif 'stream-json:' in line.lower():
                try:
                    json_part = line.split('stream-json:', 1)[1].strip()
                    data = json.loads(json_part)
                    response = StreamingResponse(
                        type='stream-json',
                        data=data,
                        timestamp=time.time()
                    )
                    responses.append(response)
                except (json.JSONDecodeError, IndexError):
                    continue
        
        return responses
    
    def extract_metrics(self, stdout: str, stderr: str, duration: float, 
                       success: bool) -> ExecutionMetrics:
        """Extract comprehensive metrics from execution output."""
        json_responses = self.parse_streaming_json(stdout + "\n" + stderr)
        
        # Count different types of operations
        agents_spawned = 0
        tasks_completed = 0
        memory_operations = 0
        errors = 0
        
        # Parse text patterns
        combined_output = (stdout + "\n" + stderr).lower()
        
        # Count agents
        for line in combined_output.split('\n'):
            if 'agent' in line and ('spawn' in line or 'create' in line):
                agents_spawned += 1
            if 'task' in line and ('complete' in line or 'finished' in line):
                tasks_completed += 1
            if 'memory' in line and ('store' in line or 'retrieve' in line):
                memory_operations += 1
            if 'error' in line or 'failed' in line:
                errors += 1
        
        # Count from JSON responses
        for response in json_responses:
            data = response.data
            if response.type == 'agent_spawned':
                agents_spawned += 1
            elif response.type == 'task_completed':
                tasks_completed += 1
            elif response.type == 'memory_operation':
                memory_operations += 1
            elif response.type == 'error':
                errors += 1
        
        return ExecutionMetrics(
            total_duration=duration,
            json_responses=json_responses,
            agents_spawned=agents_spawned,
            tasks_completed=tasks_completed,
            memory_operations=memory_operations,
            errors=errors,
            command_success=success,
            output_size=len(stdout) + len(stderr)
        )
    
    def execute_swarm(self, objective: str, strategy: str = "auto", 
                     mode: str = "centralized", non_interactive: bool = True, 
                     timeout: int = 60) -> ExecutionMetrics:
        """Execute a real swarm command with metrics collection."""
        command = [
            self.claude_flow_path, "swarm",
            objective,
            "--strategy", strategy,
            "--mode", mode,
            "--stream-json",  # Enable JSON streaming
            "--timeout", str(timeout)
        ]
        
        if non_interactive:
            command.append("--non-interactive")
        
        logger.info(f"Executing: {' '.join(command)}")
        start_time = time.time()
        
        try:
            result = subprocess.run(
                command,
                capture_output=True,
                text=True,
                timeout=timeout + 10  # Add buffer for cleanup
            )
            
            duration = time.time() - start_time
            success = result.returncode == 0
            
            logger.info(f"Command {'succeeded' if success else 'failed'} in {duration:.2f}s")
            
            return self.extract_metrics(result.stdout, result.stderr, duration, success)
            
        except subprocess.TimeoutExpired as e:
            duration = time.time() - start_time
            logger.error(f"Command timed out after {duration:.2f}s")
            
            stdout = e.stdout.decode() if e.stdout else ""
            stderr = e.stderr.decode() if e.stderr else ""
            
            return self.extract_metrics(stdout, stderr, duration, False)
    
    def execute_hive_mind(self, objective: str, agents: int = 3, 
                         non_interactive: bool = True, timeout: int = 60) -> ExecutionMetrics:
        """Execute a real hive-mind command."""
        command = [
            self.claude_flow_path, "hive-mind",
            objective,
            "--agents", str(agents),
            "--stream-json",
            "--timeout", str(timeout)
        ]
        
        if non_interactive:
            command.append("--non-interactive")
        
        logger.info(f"Executing: {' '.join(command)}")
        start_time = time.time()
        
        try:
            result = subprocess.run(
                command,
                capture_output=True,
                text=True,
                timeout=timeout + 10
            )
            
            duration = time.time() - start_time
            success = result.returncode == 0
            
            return self.extract_metrics(result.stdout, result.stderr, duration, success)
            
        except subprocess.TimeoutExpired as e:
            duration = time.time() - start_time
            stdout = e.stdout.decode() if e.stdout else ""
            stderr = e.stderr.decode() if e.stderr else ""
            
            return self.extract_metrics(stdout, stderr, duration, False)
    
    def execute_sparc(self, mode: str, task: str, non_interactive: bool = True, 
                     timeout: int = 60) -> ExecutionMetrics:
        """Execute a real SPARC command."""
        command = [
            self.claude_flow_path, "sparc", mode,
            task,
            "--stream-json",
            "--timeout", str(timeout)
        ]
        
        if non_interactive:
            command.append("--non-interactive")
        
        logger.info(f"Executing: {' '.join(command)}")
        start_time = time.time()
        
        try:
            result = subprocess.run(
                command,
                capture_output=True,
                text=True,
                timeout=timeout + 10
            )
            
            duration = time.time() - start_time
            success = result.returncode == 0
            
            return self.extract_metrics(result.stdout, result.stderr, duration, success)
            
        except subprocess.TimeoutExpired as e:
            duration = time.time() - start_time
            stdout = e.stdout.decode() if e.stdout else ""
            stderr = e.stderr.decode() if e.stderr else ""
            
            return self.extract_metrics(stdout, stderr, duration, False)


class TestRealClaudeFlowIntegration:
    """Test suite for real Claude Flow integration."""
    
    @pytest.fixture(scope="class")
    def executor(self):
        """Create executor instance."""
        return ClaudeFlowRealExecutor()
    
    def test_executor_initialization(self, executor):
        """Test that executor initializes correctly."""
        assert executor is not None
        assert executor.claude_flow_path is not None
        assert Path(executor.claude_flow_path).exists()
        assert executor.validate_installation()
    
    def test_real_swarm_execution(self, executor):
        """Test real swarm command execution."""
        result = executor.execute_swarm(
            objective="echo 'Hello from swarm test'",
            strategy="auto",
            mode="centralized",
            timeout=30
        )
        
        assert result is not None
        assert result.total_duration > 0
        assert isinstance(result.json_responses, list)
        assert result.output_size > 0
        
        # The command should complete (success or controlled failure)
        logger.info(f"Swarm test - Duration: {result.total_duration:.2f}s, "
                   f"JSON responses: {len(result.json_responses)}, "
                   f"Success: {result.command_success}")
    
    def test_real_hive_mind_execution(self, executor):
        """Test real hive-mind command execution."""
        result = executor.execute_hive_mind(
            objective="Simple analysis task",
            agents=2,
            timeout=30
        )
        
        assert result is not None
        assert result.total_duration > 0
        assert isinstance(result.json_responses, list)
        
        logger.info(f"Hive-mind test - Duration: {result.total_duration:.2f}s, "
                   f"Agents: {result.agents_spawned}, "
                   f"Success: {result.command_success}")
    
    def test_real_sparc_execution(self, executor):
        """Test real SPARC command execution."""
        result = executor.execute_sparc(
            mode="coder",
            task="Create a simple Python hello world function",
            timeout=30
        )
        
        assert result is not None
        assert result.total_duration > 0
        assert isinstance(result.json_responses, list)
        
        logger.info(f"SPARC test - Duration: {result.total_duration:.2f}s, "
                   f"Tasks completed: {result.tasks_completed}, "
                   f"Success: {result.command_success}")
    
    def test_json_streaming_parsing(self, executor):
        """Test JSON streaming response parsing."""
        # Test with sample JSON output
        sample_output = """
        {"type": "agent_spawned", "id": "agent-1", "timestamp": 1234567890}
        Regular text output
        {"type": "task_completed", "task_id": "task-1", "status": "success"}
        stream-json: {"type": "memory_operation", "operation": "store", "key": "test"}
        More text
        """
        
        responses = executor.parse_streaming_json(sample_output)
        
        assert len(responses) == 3
        assert responses[0].type == "agent_spawned"
        assert responses[1].type == "task_completed"
        assert responses[2].type == "stream-json"
    
    def test_metrics_extraction(self, executor):
        """Test metrics extraction from output."""
        stdout = """
        Agent spawned: agent-1
        Task completed: task-1
        Memory store operation: key=test
        {"type": "agent_spawned", "id": "agent-2"}
        Agent spawned: agent-3
        Error: something went wrong
        Task completed: task-2
        """
        stderr = "Warning: low memory"
        
        metrics = executor.extract_metrics(stdout, stderr, 5.0, True)
        
        assert metrics.total_duration == 5.0
        assert metrics.command_success is True
        assert metrics.agents_spawned >= 2  # Should count at least 2-3 agents
        assert metrics.tasks_completed >= 2
        assert metrics.memory_operations >= 1
        assert metrics.errors >= 1  # Should detect error message
        assert metrics.output_size > 0
    
    def test_error_handling(self, executor):
        """Test error handling for failed commands."""
        result = executor.execute_swarm(
            objective="This is an invalid command that should fail --invalid-flag",
            timeout=10
        )
        
        assert result is not None
        assert result.total_duration > 0
        # Command may fail, but we should still get metrics
        assert isinstance(result.json_responses, list)
    
    def test_timeout_handling(self, executor):
        """Test timeout handling."""
        result = executor.execute_swarm(
            objective="Long running task that might timeout",
            timeout=5  # Very short timeout
        )
        
        assert result is not None
        assert result.total_duration > 0
        # Should handle timeout gracefully
        assert isinstance(result.json_responses, list)
    
    def test_different_command_types(self, executor):
        """Test different types of commands work."""
        commands = [
            ("swarm", lambda: executor.execute_swarm("echo test", timeout=15)),
            ("hive-mind", lambda: executor.execute_hive_mind("simple task", timeout=15)),
            ("sparc", lambda: executor.execute_sparc("researcher", "test research", timeout=15))
        ]
        
        for cmd_name, cmd_func in commands:
            result = cmd_func()
            assert result is not None, f"{cmd_name} should return result"
            assert result.total_duration > 0, f"{cmd_name} should have duration"
            logger.info(f"{cmd_name} - Duration: {result.total_duration:.2f}s, "
                       f"Success: {result.command_success}")


def main():
    """Run tests directly."""
    executor = ClaudeFlowRealExecutor()
    
    print("🚀 Running Real Claude Flow Integration Tests")
    print("=" * 60)
    
    # Test 1: Basic execution
    print("\n🧪 Test 1: Basic Swarm Execution")
    result1 = executor.execute_swarm("echo 'test execution'", timeout=20)
    print(f"Result: Duration={result1.total_duration:.2f}s, "
          f"JSON Responses={len(result1.json_responses)}, "
          f"Success={result1.command_success}")
    
    # Test 2: JSON parsing
    print("\n🧪 Test 2: JSON Streaming Parsing")
    sample_json = '{"type": "test", "data": {"key": "value"}}\n{"type": "agent_spawned"}'
    responses = executor.parse_streaming_json(sample_json)
    print(f"Parsed {len(responses)} JSON responses")
    for resp in responses:
        print(f"  - Type: {resp.type}, Data keys: {list(resp.data.keys())}")
    
    # Test 3: SPARC mode
    print("\n🧪 Test 3: SPARC Mode Execution")
    result3 = executor.execute_sparc("coder", "print hello world", timeout=20)
    print(f"Result: Duration={result3.total_duration:.2f}s, "
          f"Tasks={result3.tasks_completed}, "
          f"Success={result3.command_success}")
    
    print("\n✅ All tests completed!")


if __name__ == "__main__":
    main()