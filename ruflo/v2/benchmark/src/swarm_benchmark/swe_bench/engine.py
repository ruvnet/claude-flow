"""SWE-Bench benchmark engine implementation."""

import asyncio
import json
import time
from datetime import datetime
from pathlib import Path
from typing import Dict, Any, List, Optional
import subprocess
from dataclasses import dataclass, asdict

from ..core.real_benchmark_engine import RealBenchmarkEngine
from ..core.models import (
    Benchmark, Task, Result, BenchmarkConfig, 
    TaskStatus, StrategyType, CoordinationMode
)
from .datasets import SWEBenchDataset
from .evaluator import SWEBenchEvaluator
from .metrics import SWEBenchMetrics


@dataclass
class SWEBenchTask:
    """Represents a SWE-bench task."""
    id: str
    category: str  # code_generation, bug_fix, refactoring, etc.
    description: str
    input_code: Optional[str]
    expected_output: Optional[str]
    test_cases: List[Dict[str, Any]]
    difficulty: str  # easy, medium, hard
    metadata: Dict[str, Any]


class SWEBenchEngine(RealBenchmarkEngine):
    """Engine for running SWE-bench benchmarks with Claude Flow."""
    
    def __init__(self, config: Optional[BenchmarkConfig] = None):
        """Initialize SWE-bench engine."""
        super().__init__(config or self._default_swe_config())
        self.dataset = SWEBenchDataset()
        self.evaluator = SWEBenchEvaluator()
        self.metrics = SWEBenchMetrics()
        self.optimization_history = []
        
    def _default_swe_config(self) -> BenchmarkConfig:
        """Create default SWE-bench configuration."""
        return BenchmarkConfig(
            name="SWE-Bench",
            description="Software Engineering Benchmark Suite",
            strategy=StrategyType.DEVELOPMENT,
            mode=CoordinationMode.HIERARCHICAL,
            max_agents=5,
            task_timeout=120,
            max_retries=2,
            output_directory="benchmark/swe-bench/reports"
        )
        
    async def run_swe_benchmark(
        self, 
        categories: Optional[List[str]] = None,
        difficulty: Optional[str] = None,
        optimize: bool = False,
        iterations: int = 1
    ) -> Dict[str, Any]:
        """Run comprehensive SWE-bench suite.
        
        Args:
            categories: Specific categories to test (None for all)
            difficulty: Filter by difficulty level
            optimize: Whether to run optimization iterations
            iterations: Number of optimization iterations
            
        Returns:
            Comprehensive benchmark results
        """
        results = {
            "timestamp": datetime.now().isoformat(),
            "config": asdict(self.config) if hasattr(self.config, '__dataclass_fields__') else str(self.config),
            "iterations": [],
            "summary": {}
        }
        
        for iteration in range(iterations):
            print(f"\n🚀 Running SWE-Bench Iteration {iteration + 1}/{iterations}")
            
            # Load tasks
            tasks = self.dataset.load_tasks(categories, difficulty)
            print(f"📦 Loaded {len(tasks)} tasks")
            
            # Run benchmark
            iteration_results = await self._run_iteration(tasks, iteration)
            results["iterations"].append(iteration_results)
            
            # Update GitHub issue
            await self._update_github_issue(iteration, iteration_results)
            
            # Optimize if requested
            if optimize and iteration < iterations - 1:
                print(f"\n🔧 Optimizing based on iteration {iteration + 1} results...")
                self._optimize_configuration(iteration_results)
                
        # Generate summary
        results["summary"] = self._generate_summary(results["iterations"])
        
        # Save final report
        report_path = Path(self.config.output_directory) / f"swe_bench_report_{int(time.time())}.json"
        report_path.parent.mkdir(parents=True, exist_ok=True)
        with open(report_path, 'w') as f:
            json.dump(results, f, indent=2)
            
        print(f"\n✅ SWE-Bench complete! Report saved to {report_path}")
        return results
        
    async def _run_iteration(self, tasks: List[SWEBenchTask], iteration: int) -> Dict[str, Any]:
        """Run a single benchmark iteration."""
        iteration_start = time.time()
        results = {
            "iteration": iteration + 1,
            "started_at": datetime.now().isoformat(),
            "tasks": [],
            "metrics": {}
        }
        
        # Start metrics collection
        self.metrics.start_collection()
        
        for i, task in enumerate(tasks):
            print(f"\n  📝 Task {i+1}/{len(tasks)}: {task.category} - {task.id}")
            
            # Execute task
            task_result = await self._execute_swe_task(task)
            results["tasks"].append(task_result)
            
            # Show progress
            if task_result["success"]:
                print(f"    ✅ Success in {task_result['duration']:.2f}s")
            else:
                print(f"    ❌ Failed: {task_result.get('error', 'Unknown error')}")
                
        # Collect metrics
        results["metrics"] = self.metrics.stop_collection()
        results["duration"] = time.time() - iteration_start
        results["completed_at"] = datetime.now().isoformat()
        
        # Calculate statistics
        total_tasks = len(tasks)
        successful_tasks = sum(1 for t in results["tasks"] if t["success"])
        results["statistics"] = {
            "total_tasks": total_tasks,
            "successful_tasks": successful_tasks,
            "failed_tasks": total_tasks - successful_tasks,
            "success_rate": successful_tasks / total_tasks if total_tasks > 0 else 0,
            "average_duration": sum(t["duration"] for t in results["tasks"]) / total_tasks if total_tasks > 0 else 0
        }
        
        return results
        
    async def _execute_swe_task(self, task: SWEBenchTask) -> Dict[str, Any]:
        """Execute a single SWE-bench task."""
        start_time = time.time()
        result = {
            "task_id": task.id,
            "category": task.category,
            "difficulty": task.difficulty,
            "started_at": datetime.now().isoformat()
        }
        
        try:
            # Prepare command based on task category
            command = self._prepare_command(task)
            
            # Execute with claude-flow
            process = await asyncio.create_subprocess_shell(
                command,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
                cwd=Path.cwd()
            )
            
            stdout, stderr = await asyncio.wait_for(
                process.communicate(),
                timeout=self.config.task_timeout
            )
            
            # Evaluate results
            evaluation = self.evaluator.evaluate(
                task=task,
                output=stdout.decode() if stdout else "",
                error=stderr.decode() if stderr else "",
                return_code=process.returncode
            )
            
            result.update({
                "success": evaluation["passed"],
                "score": evaluation["score"],
                "details": evaluation["details"],
                "output": stdout.decode()[:1000] if stdout else "",  # Truncate for storage
                "duration": time.time() - start_time
            })
            
        except asyncio.TimeoutError:
            result.update({
                "success": False,
                "error": "Task timeout",
                "duration": time.time() - start_time
            })
        except Exception as e:
            result.update({
                "success": False,
                "error": str(e),
                "duration": time.time() - start_time
            })
            
        result["completed_at"] = datetime.now().isoformat()
        return result
        
    def _prepare_command(self, task: SWEBenchTask) -> str:
        """Prepare claude-flow command for task."""
        # Map task categories to claude-flow strategies
        strategy_map = {
            "code_generation": "development",
            "bug_fix": "optimization",
            "refactoring": "maintenance",
            "testing": "testing",
            "documentation": "analysis",
            "code_review": "analysis",
            "performance": "optimization"
        }
        
        strategy = strategy_map.get(task.category, "auto")
        
        # Build command
        cmd = f"npx claude-flow@alpha sparc run {strategy}"
        cmd += f' "{task.description}"'
        
        # Add configuration flags
        if self.config.max_agents:
            cmd += f" --agents {self.config.max_agents}"
        if self.config.mode:
            cmd += f" --mode {self.config.mode.value}"
            
        return cmd
        
    def _optimize_configuration(self, results: Dict[str, Any]) -> None:
        """Optimize configuration based on results."""
        stats = results.get("statistics", {})
        metrics = results.get("metrics", {})
        
        # Store optimization history
        self.optimization_history.append({
            "iteration": len(self.optimization_history) + 1,
            "config": asdict(self.config) if hasattr(self.config, '__dataclass_fields__') else str(self.config),
            "performance": {
                "success_rate": stats.get("success_rate", 0),
                "avg_duration": stats.get("average_duration", 0)
            }
        })
        
        # Optimization rules
        success_rate = stats.get("success_rate", 0)
        avg_duration = stats.get("average_duration", float('inf'))
        
        # Adjust based on performance
        if success_rate < 0.6:
            # Low success rate - increase resources
            self.config.max_agents = min(self.config.max_agents + 2, 10)
            self.config.task_timeout = min(self.config.task_timeout + 30, 300)
            self.config.max_retries = min(self.config.max_retries + 1, 5)
            print(f"    📈 Increased resources: agents={self.config.max_agents}, timeout={self.config.task_timeout}")
            
        elif success_rate > 0.9 and avg_duration > 20:
            # High success but slow - optimize for speed
            if self.config.mode == CoordinationMode.HIERARCHICAL:
                self.config.mode = CoordinationMode.MESH
            self.config.max_agents = max(self.config.max_agents - 1, 3)
            print(f"    ⚡ Optimizing for speed: mode={self.config.mode.value}, agents={self.config.max_agents}")
            
        elif success_rate > 0.8:
            # Good performance - minor tweaks
            if avg_duration > 15:
                self.config.mode = CoordinationMode.DISTRIBUTED
                print(f"    🔄 Switched to distributed mode for better parallelism")
                
    async def _update_github_issue(self, iteration: int, results: Dict[str, Any]) -> None:
        """Update GitHub issue with progress."""
        stats = results.get("statistics", {})
        
        # Create issue comment
        comment = f"""## SWE-Bench Progress Update - Iteration {iteration + 1}

📊 **Performance Metrics:**
- Success Rate: {stats.get('success_rate', 0):.1%}
- Tasks Completed: {stats.get('successful_tasks', 0)}/{stats.get('total_tasks', 0)}
- Average Duration: {stats.get('average_duration', 0):.2f}s
- Total Time: {results.get('duration', 0):.2f}s

📈 **Category Breakdown:**
"""
        
        # Add category statistics
        category_stats = {}
        for task in results.get("tasks", []):
            cat = task.get("category", "unknown")
            if cat not in category_stats:
                category_stats[cat] = {"total": 0, "passed": 0}
            category_stats[cat]["total"] += 1
            if task.get("success"):
                category_stats[cat]["passed"] += 1
                
        for cat, stats in category_stats.items():
            rate = stats["passed"] / stats["total"] if stats["total"] > 0 else 0
            comment += f"- {cat}: {stats['passed']}/{stats['total']} ({rate:.1%})\n"
            
        comment += f"\n🔧 **Configuration:**\n"
        comment += f"- Strategy: {self.config.strategy.value}\n"
        comment += f"- Mode: {self.config.mode.value}\n"
        comment += f"- Max Agents: {self.config.max_agents}\n"
        
        # Save comment to file (would normally post to GitHub API)
        issue_path = Path("benchmark/swe-bench/github_updates") / f"iteration_{iteration + 1}.md"
        issue_path.parent.mkdir(parents=True, exist_ok=True)
        with open(issue_path, 'w') as f:
            f.write(comment)
            
        print(f"\n📝 GitHub issue update saved to {issue_path}")
        
    def _generate_summary(self, iterations: List[Dict[str, Any]]) -> Dict[str, Any]:
        """Generate comprehensive summary of all iterations."""
        if not iterations:
            return {}
            
        summary = {
            "total_iterations": len(iterations),
            "total_tasks_run": sum(i["statistics"]["total_tasks"] for i in iterations),
            "best_iteration": None,
            "improvement": {},
            "final_performance": {}
        }
        
        # Find best iteration
        best_score = 0
        for i, iteration in enumerate(iterations):
            score = iteration["statistics"]["success_rate"]
            if score > best_score:
                best_score = score
                summary["best_iteration"] = i + 1
                
        # Calculate improvement
        if len(iterations) > 1:
            first = iterations[0]["statistics"]
            last = iterations[-1]["statistics"]
            summary["improvement"] = {
                "success_rate_change": last["success_rate"] - first["success_rate"],
                "duration_change": last["average_duration"] - first["average_duration"],
                "optimization_effective": last["success_rate"] > first["success_rate"]
            }
            
        # Final performance
        last_iteration = iterations[-1]
        summary["final_performance"] = last_iteration["statistics"]
        
        return summary