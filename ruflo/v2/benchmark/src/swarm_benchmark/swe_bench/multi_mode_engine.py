"""
Multi-mode SWE-bench engine that tests all claude-flow non-interactive options.
Tests swarm, sparc, hive-mind with various configurations.
"""

import asyncio
import json
import time
from datetime import datetime
from pathlib import Path
from typing import Dict, Any, List, Optional, Tuple
from dataclasses import dataclass

from .official_integration import OfficialSWEBenchEngine
from .prompt_builder import SWEBenchPromptBuilder, SWEBenchPromptConfig
from ..core.models import BenchmarkConfig, StrategyType, CoordinationMode


@dataclass
class ClaudeFlowMode:
    """Represents a claude-flow execution mode."""
    command_type: str  # swarm, sparc, hive-mind
    subcommand: Optional[str] = None  # for sparc modes, hive-mind spawn
    strategy: Optional[str] = None  # for swarm
    mode: Optional[str] = None  # coordination mode
    agents: Optional[int] = None
    extra_args: List[str] = None
    description: str = ""
    
    def __post_init__(self):
        if self.extra_args is None:
            self.extra_args = []
    
    def build_command(self, claude_flow_path: str, prompt: str) -> List[str]:
        """Build the complete command array."""
        cmd = [claude_flow_path]
        
        if self.command_type == "swarm":
            cmd.extend(["swarm", prompt])
            if self.strategy:
                cmd.extend(["--strategy", self.strategy])
            if self.mode:
                cmd.extend(["--mode", self.mode])
            if self.agents:
                cmd.extend(["--max-agents", str(self.agents)])
                
        elif self.command_type == "sparc":
            cmd.extend(["sparc", "run", self.subcommand or "coder", prompt])
            if self.agents:
                cmd.extend(["--agents", str(self.agents)])
                
        elif self.command_type == "hive-mind":
            cmd.extend(["hive-mind", "spawn", prompt])
            cmd.append("--claude")  # Generate Claude Code coordination
            if self.agents:
                cmd.extend(["--max-workers", str(self.agents)])
        
        # Add extra arguments
        cmd.extend(self.extra_args)
        
        # Non-interactive must be last
        cmd.append("--non-interactive")
        
        return cmd
    
    def get_name(self) -> str:
        """Get a descriptive name for this mode."""
        parts = [self.command_type]
        if self.subcommand:
            parts.append(self.subcommand)
        if self.strategy:
            parts.append(self.strategy)
        if self.mode:
            parts.append(self.mode)
        if self.agents:
            parts.append(f"{self.agents}agents")
        return "-".join(parts)


class MultiModeSWEBenchEngine(OfficialSWEBenchEngine):
    """SWE-bench engine that tests multiple claude-flow modes."""
    
    # Define all modes to test
    CLAUDE_FLOW_MODES = [
        # Swarm modes with different strategies
        ClaudeFlowMode("swarm", strategy="auto", mode="centralized", agents=5, 
                      description="Swarm auto strategy, centralized"),
        ClaudeFlowMode("swarm", strategy="research", mode="distributed", agents=5,
                      description="Swarm research strategy, distributed"),
        ClaudeFlowMode("swarm", strategy="development", mode="hierarchical", agents=8,
                      description="Swarm development strategy, hierarchical"),
        ClaudeFlowMode("swarm", strategy="optimization", mode="mesh", agents=8,
                      description="Swarm optimization strategy, mesh (optimal)"),
        ClaudeFlowMode("swarm", strategy="testing", mode="centralized", agents=3,
                      description="Swarm testing strategy, centralized"),
        ClaudeFlowMode("swarm", strategy="analysis", mode="distributed", agents=5,
                      description="Swarm analysis strategy, distributed"),
        ClaudeFlowMode("swarm", strategy="maintenance", mode="hierarchical", agents=5,
                      description="Swarm maintenance strategy, hierarchical"),
        
        # SPARC modes
        ClaudeFlowMode("sparc", subcommand="coder", agents=5,
                      description="SPARC coder mode"),
        ClaudeFlowMode("sparc", subcommand="architect", agents=5,
                      description="SPARC architect mode"),
        ClaudeFlowMode("sparc", subcommand="tdd", agents=5,
                      description="SPARC TDD mode"),
        ClaudeFlowMode("sparc", subcommand="reviewer", agents=3,
                      description="SPARC reviewer mode"),
        ClaudeFlowMode("sparc", subcommand="tester", agents=3,
                      description="SPARC tester mode"),
        ClaudeFlowMode("sparc", subcommand="optimizer", agents=5,
                      description="SPARC optimizer mode"),
        ClaudeFlowMode("sparc", subcommand="debugger", agents=5,
                      description="SPARC debugger mode"),
        ClaudeFlowMode("sparc", subcommand="documenter", agents=3,
                      description="SPARC documenter mode"),
        
        # Hive-mind configurations
        ClaudeFlowMode("hive-mind", agents=4,
                      description="Hive-mind default (4 workers)"),
        ClaudeFlowMode("hive-mind", agents=8,
                      description="Hive-mind with 8 workers"),
        ClaudeFlowMode("hive-mind", agents=2, extra_args=["--queen-type", "tactical"],
                      description="Hive-mind tactical queen, 2 workers"),
        ClaudeFlowMode("hive-mind", agents=6, extra_args=["--queen-type", "adaptive"],
                      description="Hive-mind adaptive queen, 6 workers"),
        
        # Special configurations
        ClaudeFlowMode("swarm", strategy="auto", mode="hybrid", agents=10,
                      extra_args=["--parallel"], description="Swarm hybrid mode with parallel execution"),
        ClaudeFlowMode("sparc", subcommand="batch", agents=8,
                      extra_args=["--parallel"], description="SPARC batch mode with parallel"),
    ]
    
    def __init__(self, config: Optional[BenchmarkConfig] = None):
        """Initialize multi-mode engine."""
        super().__init__(config)
        self.mode_results = {}
        
    async def run_instance_with_mode(self, instance: Dict[str, Any], mode: ClaudeFlowMode) -> Dict[str, Any]:
        """Run a single instance with a specific claude-flow mode."""
        
        instance_id = instance["instance_id"]
        repo = instance["repo"]
        problem = instance["problem_statement"]
        
        print(f"\n🔧 Testing mode: {mode.get_name()}")
        print(f"   Description: {mode.description}")
        
        start_time = time.time()
        
        try:
            # Build prompt using the prompt builder
            prompt_config = SWEBenchPromptConfig(
                mode=mode.command_type,
                subcommand=mode.subcommand,
                max_agents=mode.agents or 4,
                include_validation=False,
                output_format="patch"
            )
            
            prompt_builder = SWEBenchPromptBuilder(prompt_config)
            simple_prompt = prompt_builder.build_prompt(instance)
            
            # Get claude-flow path
            claude_flow_path = './claude-flow'
            if Path.cwd().name == 'benchmark':
                claude_flow_path = '../claude-flow'
            
            # Build command
            cmd_args = mode.build_command(claude_flow_path, simple_prompt)
            
            # Display FULL command without truncation
            if len(cmd_args) > 3 and cmd_args[3] == simple_prompt:
                # Show with quotes around the prompt
                cmd_display = f"{' '.join(cmd_args[:3])} \"{cmd_args[3]}\" {' '.join(cmd_args[4:])}"
            else:
                cmd_display = ' '.join(cmd_args)
            
            print(f"   📋 Full command: {cmd_display}")
            
            # Run the command
            process = await asyncio.create_subprocess_exec(
                *cmd_args,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
                cwd=Path.cwd()
            )
            
            stdout, stderr = await asyncio.wait_for(
                process.communicate(),
                timeout=self.config.task_timeout
            )
            
            # Extract patch
            output = stdout.decode() if stdout else ""
            error_output = stderr.decode() if stderr else ""
            
            print(f"   📊 Process exit code: {process.returncode}")
            print(f"   📝 Output length: {len(output)} chars")
            
            patch = self._extract_patch(output)
            if not patch and error_output:
                patch = self._extract_patch(error_output)
            
            duration = time.time() - start_time
            
            return {
                "mode": mode.get_name(),
                "instance_id": instance_id,
                "success": bool(patch),
                "patch": patch if patch else "",
                "duration": duration,
                "exit_code": process.returncode,
                "output_length": len(output),
                "error": None if patch else "No patch generated"
            }
            
        except asyncio.TimeoutError:
            return {
                "mode": mode.get_name(),
                "instance_id": instance_id,
                "success": False,
                "patch": "",
                "duration": self.config.task_timeout,
                "error": "Timeout"
            }
        except Exception as e:
            return {
                "mode": mode.get_name(),
                "instance_id": instance_id,
                "success": False,
                "patch": "",
                "duration": time.time() - start_time,
                "error": str(e)
            }
    
    async def benchmark_all_modes(
        self,
        instances_limit: int = 1,
        modes_to_test: Optional[List[ClaudeFlowMode]] = None
    ) -> Dict[str, Any]:
        """Benchmark all claude-flow modes on SWE-bench instances."""
        
        print("""
╔══════════════════════════════════════════════════════════════╗
║         Multi-Mode SWE-Bench Evaluation                       ║
║     Testing All Claude-Flow Non-Interactive Modes             ║
╚══════════════════════════════════════════════════════════════╝
""")
        
        # Load dataset
        if not await self.load_dataset(use_lite=True):
            return {"error": "Failed to load dataset"}
        
        # Select instances
        instances = list(self.dataset)[:instances_limit]
        
        # Select modes to test
        modes = modes_to_test or self.CLAUDE_FLOW_MODES
        
        print(f"\n📊 Testing {len(modes)} modes on {len(instances)} instances")
        print(f"   Total tests: {len(modes) * len(instances)}")
        
        all_results = []
        
        for instance in instances:
            print(f"\n{'='*60}")
            print(f"Instance: {instance['instance_id']}")
            print(f"Repo: {instance['repo']}")
            print(f"{'='*60}")
            
            for mode in modes:
                result = await self.run_instance_with_mode(instance, mode)
                all_results.append(result)
                
                if result["success"]:
                    print(f"   ✅ {mode.get_name()}: Generated {len(result['patch'])} char patch in {result['duration']:.1f}s")
                else:
                    print(f"   ❌ {mode.get_name()}: {result['error']}")
        
        # Analyze results by mode
        mode_performance = {}
        for mode in modes:
            mode_name = mode.get_name()
            mode_results = [r for r in all_results if r["mode"] == mode_name]
            
            if mode_results:
                successful = sum(1 for r in mode_results if r["success"])
                total = len(mode_results)
                avg_duration = sum(r["duration"] for r in mode_results) / total
                
                mode_performance[mode_name] = {
                    "success_rate": successful / total,
                    "successful": successful,
                    "total": total,
                    "avg_duration": avg_duration,
                    "description": mode.description
                }
        
        # Find best mode
        best_mode = max(mode_performance.items(), 
                       key=lambda x: (x[1]["success_rate"], -x[1]["avg_duration"]))
        
        # Generate report
        report = {
            "timestamp": datetime.now().isoformat(),
            "instances_tested": len(instances),
            "modes_tested": len(modes),
            "total_tests": len(all_results),
            "mode_performance": mode_performance,
            "best_mode": best_mode[0],
            "best_performance": best_mode[1],
            "all_results": all_results
        }
        
        # Save report
        report_path = Path(self.config.output_directory) / f"multi_mode_report_{int(time.time())}.json"
        report_path.parent.mkdir(parents=True, exist_ok=True)
        
        with open(report_path, 'w') as f:
            json.dump(report, f, indent=2)
        
        # Display summary
        print(f"\n{'='*60}")
        print("📊 MULTI-MODE BENCHMARK RESULTS")
        print(f"{'='*60}\n")
        
        print("Mode Performance Rankings:")
        sorted_modes = sorted(mode_performance.items(), 
                            key=lambda x: (x[1]["success_rate"], -x[1]["avg_duration"]),
                            reverse=True)
        
        for i, (mode_name, perf) in enumerate(sorted_modes[:10], 1):
            print(f"{i:2}. {mode_name:40} - Success: {perf['success_rate']:.1%}, Avg: {perf['avg_duration']:.1f}s")
        
        print(f"\n🏆 BEST MODE: {best_mode[0]}")
        print(f"   Success Rate: {best_mode[1]['success_rate']:.1%}")
        print(f"   Avg Duration: {best_mode[1]['avg_duration']:.1f}s")
        print(f"   Description: {best_mode[1]['description']}")
        
        print(f"\n📁 Full report saved to: {report_path}")
        
        return report