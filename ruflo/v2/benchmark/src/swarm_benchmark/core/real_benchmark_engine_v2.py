"""
Real Benchmark Engine - Uses actual Claude Flow commands for benchmarking.

This engine replaces mock/simulated execution with real Claude Flow command execution.
It integrates with the RealClaudeFlowExecutor to provide accurate benchmarking data.
"""

import asyncio
import logging
from datetime import datetime
from typing import List, Dict, Any, Optional
from pathlib import Path
from dataclasses import dataclass

from .claude_flow_real_executor import (
    RealClaudeFlowExecutor, 
    SwarmCommand, 
    HiveMindCommand, 
    SparcCommand,
    RealExecutionResult
)
from .models import Benchmark, Task, Result, BenchmarkConfig, TaskStatus, StrategyType, CoordinationMode
from ..output.json_writer import JSONWriter
from ..output.sqlite_manager import SQLiteManager

logger = logging.getLogger(__name__)


@dataclass
class RealBenchmarkResult:
    """Result from real Claude Flow benchmark execution."""
    benchmark_id: str
    objective: str
    strategy: str
    mode: str
    max_agents: int
    
    # Execution details
    success: bool
    duration: float
    exit_code: int
    
    # Token usage
    input_tokens: int
    output_tokens: int
    total_tokens: int
    
    # Agent activity
    agents_spawned: int
    tasks_completed: int
    
    # Tool usage
    tool_calls: List[Dict[str, Any]]
    tool_results: List[Dict[str, Any]]
    
    # Performance metrics
    first_response_time: Optional[float]
    completion_time: float
    
    # Output analysis
    stdout_lines: List[str]
    stderr_lines: List[str]
    errors: List[str]
    warnings: List[str]
    
    # Metadata
    timestamp: datetime
    command_executed: List[str]
    
    def to_dict(self) -> Dict[str, Any]:
        """Convert to dictionary for serialization."""
        return {
            "benchmark_id": self.benchmark_id,
            "objective": self.objective,
            "strategy": self.strategy,
            "mode": self.mode,
            "max_agents": self.max_agents,
            "success": self.success,
            "duration": self.duration,
            "exit_code": self.exit_code,
            "tokens": {
                "input": self.input_tokens,
                "output": self.output_tokens,
                "total": self.total_tokens
            },
            "agents": {
                "spawned": self.agents_spawned,
                "tasks_completed": self.tasks_completed
            },
            "tools": {
                "calls": len(self.tool_calls),
                "results": len(self.tool_results)
            },
            "performance": {
                "first_response_time": self.first_response_time,
                "completion_time": self.completion_time
            },
            "output": {
                "stdout_lines": len(self.stdout_lines),
                "stderr_lines": len(self.stderr_lines),
                "errors": len(self.errors),
                "warnings": len(self.warnings)
            },
            "timestamp": self.timestamp.isoformat(),
            "command": " ".join(self.command_executed)
        }


class RealBenchmarkEngine:
    """Benchmark engine that uses real Claude Flow execution."""
    
    def __init__(self, 
                 config: Optional[BenchmarkConfig] = None,
                 claude_flow_path: Optional[str] = None,
                 working_dir: Optional[str] = None):
        """
        Initialize the real benchmark engine.
        
        Args:
            config: Benchmark configuration
            claude_flow_path: Path to Claude Flow executable
            working_dir: Working directory for execution
        """
        self.config = config or BenchmarkConfig()
        self.executor = RealClaudeFlowExecutor(claude_flow_path, working_dir)
        self.status = "READY"
        self.current_benchmarks = {}
        
        logger.info("Initialized RealBenchmarkEngine")
        
        # Validate Claude Flow installation
        if not self.executor.validate_installation():
            logger.warning("Claude Flow installation validation failed")
    
    async def run_swarm_benchmark(self, 
                                 objective: str,
                                 strategy: str = "auto",
                                 mode: str = "centralized",
                                 max_agents: int = 5,
                                 timeout: int = 60) -> RealBenchmarkResult:
        """
        Run a real swarm benchmark.
        
        Args:
            objective: The benchmark objective
            strategy: Swarm strategy
            mode: Coordination mode
            max_agents: Maximum number of agents
            timeout: Timeout in minutes
            
        Returns:
            RealBenchmarkResult with execution details
        """
        benchmark_id = f"swarm-{objective[:20]}-{datetime.now().strftime('%Y%m%d-%H%M%S')}"
        
        logger.info(f"Starting swarm benchmark: {benchmark_id}")
        logger.info(f"Objective: {objective}")
        logger.info(f"Strategy: {strategy}, Mode: {mode}, Max Agents: {max_agents}")
        
        # Create swarm command
        swarm_config = SwarmCommand(
            objective=objective,
            strategy=strategy,
            mode=mode,
            max_agents=max_agents,
            timeout=timeout
        )
        
        # Execute the command
        start_time = datetime.now()
        result = await self.executor.execute_swarm_async(swarm_config)
        
        # Create benchmark result
        benchmark_result = RealBenchmarkResult(
            benchmark_id=benchmark_id,
            objective=objective,
            strategy=strategy,
            mode=mode,
            max_agents=max_agents,
            success=result.success,
            duration=result.duration,
            exit_code=result.exit_code,
            input_tokens=result.input_tokens,
            output_tokens=result.output_tokens,
            total_tokens=result.total_tokens,
            agents_spawned=result.agents_spawned,
            tasks_completed=result.tasks_completed,
            tool_calls=result.tool_calls,
            tool_results=result.tool_results,
            first_response_time=result.first_response_time,
            completion_time=result.completion_time,
            stdout_lines=result.stdout_lines,
            stderr_lines=result.stderr_lines,
            errors=result.errors,
            warnings=result.warnings,
            timestamp=start_time,
            command_executed=result.command
        )
        
        # Store the benchmark result
        self.current_benchmarks[benchmark_id] = benchmark_result
        
        # Save results if configured
        await self._save_benchmark_result(benchmark_result)
        
        logger.info(f"Swarm benchmark completed: {benchmark_id}")
        logger.info(f"Success: {result.success}, Duration: {result.duration:.2f}s")
        logger.info(f"Tokens: {result.total_tokens}, Agents: {result.agents_spawned}")
        
        return benchmark_result
    
    async def run_hive_mind_benchmark(self, 
                                     task: str,
                                     spawn_count: int = 3,
                                     coordination_mode: str = "collective") -> RealBenchmarkResult:
        """
        Run a real hive-mind benchmark.
        
        Args:
            task: The task description
            spawn_count: Number of agents to spawn
            coordination_mode: Coordination mode
            
        Returns:
            RealBenchmarkResult with execution details
        """
        benchmark_id = f"hive-mind-{task[:20]}-{datetime.now().strftime('%Y%m%d-%H%M%S')}"
        
        logger.info(f"Starting hive-mind benchmark: {benchmark_id}")
        logger.info(f"Task: {task}")
        logger.info(f"Spawn Count: {spawn_count}, Coordination: {coordination_mode}")
        
        # Create hive-mind command
        hive_config = HiveMindCommand(
            action="spawn",
            task=task,
            spawn_count=spawn_count,
            coordination_mode=coordination_mode
        )
        
        # Execute the command
        start_time = datetime.now()
        result = await self.executor.execute_hive_mind_async(hive_config)
        
        # Create benchmark result
        benchmark_result = RealBenchmarkResult(
            benchmark_id=benchmark_id,
            objective=task,
            strategy="hive-mind",
            mode=coordination_mode,
            max_agents=spawn_count,
            success=result.success,
            duration=result.duration,
            exit_code=result.exit_code,
            input_tokens=result.input_tokens,
            output_tokens=result.output_tokens,
            total_tokens=result.total_tokens,
            agents_spawned=result.agents_spawned,
            tasks_completed=result.tasks_completed,
            tool_calls=result.tool_calls,
            tool_results=result.tool_results,
            first_response_time=result.first_response_time,
            completion_time=result.completion_time,
            stdout_lines=result.stdout_lines,
            stderr_lines=result.stderr_lines,
            errors=result.errors,
            warnings=result.warnings,
            timestamp=start_time,
            command_executed=result.command
        )
        
        # Store and save results
        self.current_benchmarks[benchmark_id] = benchmark_result
        await self._save_benchmark_result(benchmark_result)
        
        logger.info(f"Hive-mind benchmark completed: {benchmark_id}")
        logger.info(f"Success: {result.success}, Duration: {result.duration:.2f}s")
        
        return benchmark_result
    
    async def run_sparc_benchmark(self, 
                                 mode: str,
                                 task: str,
                                 memory_key: Optional[str] = None) -> RealBenchmarkResult:
        """
        Run a real SPARC benchmark.
        
        Args:
            mode: SPARC mode (code, architect, etc.)
            task: The task description
            memory_key: Optional memory key
            
        Returns:
            RealBenchmarkResult with execution details
        """
        benchmark_id = f"sparc-{mode}-{task[:20]}-{datetime.now().strftime('%Y%m%d-%H%M%S')}"
        
        logger.info(f"Starting SPARC benchmark: {benchmark_id}")
        logger.info(f"Mode: {mode}, Task: {task}")
        
        # Create SPARC command
        sparc_config = SparcCommand(
            mode=mode,
            task=task,
            output_format="markdown" if not memory_key else None
        )
        
        # Execute the command
        start_time = datetime.now()
        result = await self.executor.execute_sparc_async(sparc_config)
        
        # Create benchmark result
        benchmark_result = RealBenchmarkResult(
            benchmark_id=benchmark_id,
            objective=task,
            strategy="sparc",
            mode=mode,
            max_agents=1,  # SPARC typically uses single agent
            success=result.success,
            duration=result.duration,
            exit_code=result.exit_code,
            input_tokens=result.input_tokens,
            output_tokens=result.output_tokens,
            total_tokens=result.total_tokens,
            agents_spawned=result.agents_spawned,
            tasks_completed=result.tasks_completed,
            tool_calls=result.tool_calls,
            tool_results=result.tool_results,
            first_response_time=result.first_response_time,
            completion_time=result.completion_time,
            stdout_lines=result.stdout_lines,
            stderr_lines=result.stderr_lines,
            errors=result.errors,
            warnings=result.warnings,
            timestamp=start_time,
            command_executed=result.command
        )
        
        # Store and save results
        self.current_benchmarks[benchmark_id] = benchmark_result
        await self._save_benchmark_result(benchmark_result)
        
        logger.info(f"SPARC benchmark completed: {benchmark_id}")
        logger.info(f"Success: {result.success}, Duration: {result.duration:.2f}s")
        
        return benchmark_result
    
    async def run_comprehensive_benchmark(self, 
                                        objective: str,
                                        strategies: List[str] = None,
                                        modes: List[str] = None,
                                        agent_counts: List[int] = None) -> Dict[str, RealBenchmarkResult]:
        """
        Run comprehensive benchmarks across multiple configurations.
        
        Args:
            objective: The benchmark objective
            strategies: List of strategies to test
            modes: List of coordination modes to test
            agent_counts: List of agent counts to test
            
        Returns:
            Dictionary of benchmark results keyed by configuration
        """
        strategies = strategies or ["auto", "development", "research", "optimization"]
        modes = modes or ["centralized", "distributed", "hierarchical"]
        agent_counts = agent_counts or [3, 5, 8]
        
        results = {}
        
        logger.info(f"Starting comprehensive benchmark for: {objective}")
        logger.info(f"Configurations: {len(strategies) * len(modes) * len(agent_counts)} total")
        
        for strategy in strategies:
            for mode in modes:
                for max_agents in agent_counts:
                    config_name = f"{strategy}-{mode}-{max_agents}agents"
                    
                    try:
                        result = await self.run_swarm_benchmark(
                            objective=f"{objective} ({config_name})",
                            strategy=strategy,
                            mode=mode,
                            max_agents=max_agents,
                            timeout=30  # Shorter timeout for comprehensive testing
                        )
                        results[config_name] = result
                        
                        logger.info(f"Completed configuration: {config_name}")
                        
                    except Exception as e:
                        logger.error(f"Failed configuration {config_name}: {e}")
                        continue
        
        logger.info(f"Comprehensive benchmark completed: {len(results)}/{len(strategies) * len(modes) * len(agent_counts)} configurations successful")
        
        return results
    
    async def _save_benchmark_result(self, result: RealBenchmarkResult):
        """Save benchmark result to configured output formats."""
        output_dir = Path(self.config.output_directory)
        output_dir.mkdir(exist_ok=True)
        
        # Save as JSON
        json_file = output_dir / f"{result.benchmark_id}.json"
        with open(json_file, 'w') as f:
            import json
            json.dump(result.to_dict(), f, indent=2)
        
        logger.debug(f"Saved benchmark result: {json_file}")
    
    def get_benchmark_result(self, benchmark_id: str) -> Optional[RealBenchmarkResult]:
        """Get a specific benchmark result."""
        return self.current_benchmarks.get(benchmark_id)
    
    def list_benchmarks(self) -> List[str]:
        """List all benchmark IDs."""
        return list(self.current_benchmarks.keys())
    
    def get_summary_stats(self) -> Dict[str, Any]:
        """Get summary statistics for all benchmarks."""
        if not self.current_benchmarks:
            return {"total": 0, "successful": 0, "failed": 0}
        
        total = len(self.current_benchmarks)
        successful = sum(1 for r in self.current_benchmarks.values() if r.success)
        failed = total - successful
        
        avg_duration = sum(r.duration for r in self.current_benchmarks.values()) / total
        avg_tokens = sum(r.total_tokens for r in self.current_benchmarks.values()) / total
        total_agents = sum(r.agents_spawned for r in self.current_benchmarks.values())
        
        return {
            "total": total,
            "successful": successful,
            "failed": failed,
            "success_rate": successful / total * 100,
            "average_duration": avg_duration,
            "average_tokens": avg_tokens,
            "total_agents_spawned": total_agents
        }


# Convenience functions for easy benchmarking
async def benchmark_swarm_objective(objective: str, **kwargs) -> RealBenchmarkResult:
    """Quick benchmark for a single swarm objective."""
    engine = RealBenchmarkEngine()
    return await engine.run_swarm_benchmark(objective, **kwargs)


async def benchmark_hive_mind_task(task: str, **kwargs) -> RealBenchmarkResult:
    """Quick benchmark for a hive-mind task."""
    engine = RealBenchmarkEngine()
    return await engine.run_hive_mind_benchmark(task, **kwargs)


async def benchmark_sparc_mode(mode: str, task: str, **kwargs) -> RealBenchmarkResult:
    """Quick benchmark for a SPARC mode."""
    engine = RealBenchmarkEngine()
    return await engine.run_sparc_benchmark(mode, task, **kwargs)