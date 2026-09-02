#!/usr/bin/env python3
"""
Comprehensive integration tests for all swarm strategies and coordination modes.
Tests each strategy with different coordination modes and measures performance.
"""

import subprocess
import time
import json
import os
import tempfile
import shutil
from pathlib import Path
from typing import Dict, List, Any, Optional, Tuple
import pytest
import asyncio
from dataclasses import dataclass, asdict, field
from datetime import datetime
import statistics
import itertools
import concurrent.futures
import psutil
import threading


@dataclass
class SwarmTestCase:
    """Test case definition for swarm strategy testing"""
    strategy: str
    description: str
    test_objectives: List[str]
    coordination_modes: List[str]  # Applicable coordination modes
    expected_behaviors: Dict[str, List[str]]  # Expected behaviors per mode
    performance_thresholds: Dict[str, float]
    max_agents: int = 5
    special_flags: List[str] = field(default_factory=list)
    parallel_enabled: bool = True
    monitor_enabled: bool = True


@dataclass
class SwarmTestResult:
    """Result of a swarm execution test"""
    strategy: str
    coordination_mode: str
    objective: str
    success: bool
    duration: float
    stdout: str
    stderr: str
    return_code: int
    agent_count: int = 0
    memory_usage: Optional[float] = None
    cpu_usage: Optional[float] = None
    output_size: int = 0
    timestamp: str = ""
    performance_metrics: Dict[str, Any] = field(default_factory=dict)
    
    def __post_init__(self):
        self.timestamp = datetime.now().isoformat()
        self.output_size = len(self.stdout) + len(self.stderr)


class TestSwarmStrategies:
    """Comprehensive test suite for swarm strategies and coordination modes"""
    
    # Define all swarm strategies with test cases
    SWARM_STRATEGIES = [
        SwarmTestCase(
            strategy="auto",
            description="Automatically determine best approach",
            test_objectives=[
                "Build a REST API for user management",
                "Research cloud computing best practices",
                "Analyze code quality metrics",
                "Test security vulnerabilities",
                "Optimize database performance",
                "Maintain and update dependencies"
            ],
            coordination_modes=["centralized", "distributed", "hierarchical"],
            expected_behaviors={
                "centralized": ["coordinator", "central", "master"],
                "distributed": ["peer", "distributed", "parallel"],
                "hierarchical": ["hierarchy", "team", "leader"]
            },
            performance_thresholds={"max_duration": 60.0, "avg_duration": 40.0}
        ),
        SwarmTestCase(
            strategy="research",
            description="Research and information gathering",
            test_objectives=[
                "Research microservices architecture patterns",
                "Investigate machine learning frameworks",
                "Analyze industry best practices for DevOps"
            ],
            coordination_modes=["distributed", "mesh", "hierarchical"],
            expected_behaviors={
                "distributed": ["parallel research", "distributed search", "concurrent"],
                "mesh": ["peer coordination", "shared findings", "collaborative"],
                "hierarchical": ["research teams", "specialized roles", "coordinated"]
            },
            performance_thresholds={"max_duration": 70.0, "avg_duration": 45.0},
            max_agents=6
        ),
        SwarmTestCase(
            strategy="development",
            description="Software development and coding",
            test_objectives=[
                "Build e-commerce shopping cart feature",
                "Develop real-time chat application",
                "Create data processing pipeline"
            ],
            coordination_modes=["hierarchical", "distributed", "hybrid"],
            expected_behaviors={
                "hierarchical": ["architect", "developer teams", "code review"],
                "distributed": ["parallel development", "module ownership"],
                "hybrid": ["flexible coordination", "adaptive teams"]
            },
            performance_thresholds={"max_duration": 80.0, "avg_duration": 50.0},
            max_agents=8
        ),
        SwarmTestCase(
            strategy="analysis",
            description="Code and data analysis",
            test_objectives=[
                "Analyze codebase for performance bottlenecks",
                "Perform security vulnerability assessment",
                "Analyze user behavior patterns in logs"
            ],
            coordination_modes=["mesh", "distributed", "centralized"],
            expected_behaviors={
                "mesh": ["collaborative analysis", "shared insights"],
                "distributed": ["parallel analysis", "domain expertise"],
                "centralized": ["coordinated analysis", "unified report"]
            },
            performance_thresholds={"max_duration": 75.0, "avg_duration": 45.0}
        ),
        SwarmTestCase(
            strategy="testing",
            description="Comprehensive testing strategy",
            test_objectives=[
                "Create comprehensive test suite for API",
                "Perform load testing on web application",
                "Execute security penetration testing"
            ],
            coordination_modes=["distributed", "hierarchical", "mesh"],
            expected_behaviors={
                "distributed": ["parallel testing", "test distribution"],
                "hierarchical": ["test planning", "execution teams"],
                "mesh": ["collaborative testing", "shared results"]
            },
            performance_thresholds={"max_duration": 90.0, "avg_duration": 60.0},
            max_agents=10
        ),
        SwarmTestCase(
            strategy="optimization",
            description="Performance and resource optimization",
            test_objectives=[
                "Optimize application memory usage",
                "Improve database query performance",
                "Optimize frontend bundle size"
            ],
            coordination_modes=["hybrid", "mesh", "hierarchical"],
            expected_behaviors={
                "hybrid": ["adaptive optimization", "flexible approach"],
                "mesh": ["collaborative optimization", "shared metrics"],
                "hierarchical": ["structured optimization", "team coordination"]
            },
            performance_thresholds={"max_duration": 85.0, "avg_duration": 55.0}
        ),
        SwarmTestCase(
            strategy="maintenance",
            description="System maintenance and updates",
            test_objectives=[
                "Update system dependencies safely",
                "Perform database maintenance tasks",
                "Clean up and refactor legacy code"
            ],
            coordination_modes=["centralized", "hierarchical", "distributed"],
            expected_behaviors={
                "centralized": ["controlled updates", "safety checks"],
                "hierarchical": ["maintenance teams", "approval workflow"],
                "distributed": ["parallel maintenance", "component ownership"]
            },
            performance_thresholds={"max_duration": 65.0, "avg_duration": 40.0}
        )
    ]
    
    # Define coordination modes
    COORDINATION_MODES = [
        "centralized",   # Single orchestrator manages all agents
        "distributed",   # Agents work independently with minimal coordination
        "hierarchical",  # Tree structure with team leaders
        "mesh",         # All agents coordinate with each other
        "hybrid"        # Adaptive coordination based on task needs
    ]
    
    def __init__(self):
        """Initialize test suite"""
        self.claude_flow_path = Path(__file__).parent.parent.parent.parent / "claude-flow"
        self.results: List[SwarmTestResult] = []
        self.temp_dirs: List[Path] = []
        self.process_monitor = None
        
    def setup_method(self):
        """Setup for each test method"""
        # Create temporary directory for test outputs
        self.test_dir = Path(tempfile.mkdtemp(prefix="swarm_test_"))
        self.temp_dirs.append(self.test_dir)
        os.chdir(self.test_dir)
        
    def teardown_method(self):
        """Cleanup after each test method"""
        # Stop process monitor if running
        if self.process_monitor:
            self.process_monitor.stop()
            
        # Clean up temporary directories
        for temp_dir in self.temp_dirs:
            if temp_dir.exists():
                shutil.rmtree(temp_dir)
        self.temp_dirs.clear()
        
    def execute_swarm_command(self, strategy: str, objective: str,
                            coordination_mode: str, max_agents: int = 5,
                            special_flags: List[str] = None,
                            monitor_performance: bool = True) -> SwarmTestResult:
        """Execute a single swarm command and return results"""
        if special_flags is None:
            special_flags = []
            
        command = [
            str(self.claude_flow_path),
            "swarm",
            objective,
            "--strategy", strategy,
            "--mode", coordination_mode,
            "--max-agents", str(max_agents),
            "--non-interactive"
        ] + special_flags
        
        # Add common flags
        if "--parallel" not in special_flags:
            command.append("--parallel")
        if "--monitor" not in special_flags:
            command.append("--monitor")
            
        start_time = time.time()
        
        # Start performance monitoring
        performance_data = {"cpu": [], "memory": []}
        monitor_thread = None
        
        if monitor_performance:
            stop_monitoring = threading.Event()
            
            def monitor_resources():
                process = psutil.Process()
                while not stop_monitoring.is_set():
                    try:
                        performance_data["cpu"].append(process.cpu_percent(interval=0.1))
                        performance_data["memory"].append(process.memory_info().rss / 1024 / 1024)  # MB
                        time.sleep(0.5)
                    except:
                        break
                        
            monitor_thread = threading.Thread(target=monitor_resources)
            monitor_thread.start()
        
        try:
            result = subprocess.run(
                command,
                capture_output=True,
                text=True,
                timeout=120,  # 2 minute timeout
                env={**os.environ, "CLAUDE_FLOW_NON_INTERACTIVE": "true"}
            )
            
            duration = time.time() - start_time
            
            # Stop monitoring
            if monitor_thread:
                stop_monitoring.set()
                monitor_thread.join(timeout=1)
            
            # Calculate performance metrics
            performance_metrics = {}
            if performance_data["cpu"]:
                performance_metrics["avg_cpu"] = statistics.mean(performance_data["cpu"])
                performance_metrics["max_cpu"] = max(performance_data["cpu"])
            if performance_data["memory"]:
                performance_metrics["avg_memory_mb"] = statistics.mean(performance_data["memory"])
                performance_metrics["max_memory_mb"] = max(performance_data["memory"])
            
            # Extract agent count from output if available
            agent_count = self._extract_agent_count(result.stdout)
            
            return SwarmTestResult(
                strategy=strategy,
                coordination_mode=coordination_mode,
                objective=objective,
                success=result.returncode == 0,
                duration=duration,
                stdout=result.stdout,
                stderr=result.stderr,
                return_code=result.returncode,
                agent_count=agent_count,
                cpu_usage=performance_metrics.get("avg_cpu"),
                memory_usage=performance_metrics.get("avg_memory_mb"),
                performance_metrics=performance_metrics
            )
            
        except subprocess.TimeoutExpired:
            if monitor_thread:
                stop_monitoring.set()
                monitor_thread.join(timeout=1)
                
            return SwarmTestResult(
                strategy=strategy,
                coordination_mode=coordination_mode,
                objective=objective,
                success=False,
                duration=120.0,
                stdout="",
                stderr="Command timed out after 120 seconds",
                return_code=-1
            )
        except Exception as e:
            if monitor_thread:
                stop_monitoring.set()
                monitor_thread.join(timeout=1)
                
            return SwarmTestResult(
                strategy=strategy,
                coordination_mode=coordination_mode,
                objective=objective,
                success=False,
                duration=time.time() - start_time,
                stdout="",
                stderr=str(e),
                return_code=-1
            )
    
    def _extract_agent_count(self, output: str) -> int:
        """Extract agent count from command output"""
        # Look for patterns like "agents: 5" or "5 agents"
        import re
        patterns = [
            r"(\d+)\s+agents?",
            r"agents?:\s*(\d+)",
            r"spawned\s+(\d+)",
            r"created\s+(\d+)\s+agents?"
        ]
        
        for pattern in patterns:
            match = re.search(pattern, output, re.IGNORECASE)
            if match:
                return int(match.group(1))
        return 0
    
    @pytest.mark.parametrize("test_case", SWARM_STRATEGIES)
    def test_swarm_strategy_execution(self, test_case: SwarmTestCase):
        """Test individual swarm strategy execution with different coordination modes"""
        strategy_results = []
        
        # Test each applicable coordination mode
        for coord_mode in test_case.coordination_modes:
            # Test with first objective
            result = self.execute_swarm_command(
                strategy=test_case.strategy,
                objective=test_case.test_objectives[0],
                coordination_mode=coord_mode,
                max_agents=test_case.max_agents,
                special_flags=test_case.special_flags
            )
            strategy_results.append(result)
            self.results.append(result)
            
            # Basic assertions
            assert result.return_code != -1, \
                f"Command execution failed for {test_case.strategy} with {coord_mode}"
            
            # Check for expected behaviors
            output_text = (result.stdout + result.stderr).lower()
            expected_keywords = test_case.expected_behaviors.get(coord_mode, [])
            if expected_keywords:
                keyword_found = any(keyword.lower() in output_text for keyword in expected_keywords)
                assert keyword_found, \
                    f"Expected behaviors not found for {test_case.strategy} with {coord_mode}"
        
        # Performance assertions
        durations = [r.duration for r in strategy_results if r.success]
        if durations:
            avg_duration = statistics.mean(durations)
            max_duration = max(durations)
            
            assert max_duration <= test_case.performance_thresholds["max_duration"], \
                f"{test_case.strategy} exceeded max duration threshold"
            assert avg_duration <= test_case.performance_thresholds["avg_duration"], \
                f"{test_case.strategy} exceeded average duration threshold"
    
    @pytest.mark.integration
    def test_strategy_coordination_matrix(self):
        """Test all valid strategy-coordination mode combinations"""
        results = []
        
        for strategy_case in self.SWARM_STRATEGIES[:3]:  # Test first 3 strategies
            for coord_mode in strategy_case.coordination_modes:
                result = self.execute_swarm_command(
                    strategy=strategy_case.strategy,
                    objective=strategy_case.test_objectives[0],
                    coordination_mode=coord_mode,
                    max_agents=3,  # Smaller for matrix test
                    monitor_performance=False  # Faster execution
                )
                results.append({
                    "strategy": strategy_case.strategy,
                    "coordination_mode": coord_mode,
                    "success": result.success,
                    "duration": result.duration
                })
        
        # Generate compatibility matrix
        self._generate_compatibility_matrix(results)
    
    @pytest.mark.performance
    def test_swarm_scalability(self):
        """Test swarm performance with different agent counts"""
        agent_counts = [2, 5, 8, 10]
        scalability_results = []
        
        # Test development strategy with hierarchical mode
        for agent_count in agent_counts:
            result = self.execute_swarm_command(
                strategy="development",
                objective="Build a simple REST API",
                coordination_mode="hierarchical",
                max_agents=agent_count
            )
            
            scalability_results.append({
                "agents": agent_count,
                "duration": result.duration,
                "success": result.success,
                "cpu_usage": result.cpu_usage,
                "memory_usage": result.memory_usage
            })
        
        # Analyze scalability
        self._analyze_scalability(scalability_results)
    
    @pytest.mark.stress
    def test_concurrent_swarm_execution(self):
        """Test concurrent execution of multiple swarms"""
        import concurrent.futures
        
        # Define concurrent test cases
        concurrent_tests = [
            ("research", "Research API design patterns", "distributed"),
            ("development", "Build user service", "hierarchical"),
            ("testing", "Test authentication flow", "mesh"),
            ("analysis", "Analyze code metrics", "distributed")
        ]
        
        with concurrent.futures.ThreadPoolExecutor(max_workers=4) as executor:
            futures = []
            
            for strategy, objective, mode in concurrent_tests:
                future = executor.submit(
                    self.execute_swarm_command,
                    strategy, objective, mode,
                    max_agents=3,
                    monitor_performance=False
                )
                futures.append((strategy, future))
            
            for strategy, future in futures:
                result = future.result(timeout=180)
                assert result.success or result.return_code == 0, \
                    f"Concurrent execution failed for {strategy}"
    
    @pytest.mark.advanced
    def test_complex_swarm_scenarios(self):
        """Test complex real-world swarm scenarios"""
        complex_scenarios = [
            {
                "name": "Full Stack Development",
                "objective": "Build complete web application with frontend, backend, and database",
                "strategy": "development",
                "mode": "hierarchical",
                "agents": 8,
                "flags": ["--parallel", "--monitor", "--batch-optimized"]
            },
            {
                "name": "Comprehensive Security Audit",
                "objective": "Perform full security assessment including code review, penetration testing, and vulnerability scanning",
                "strategy": "testing",
                "mode": "mesh",
                "agents": 6,
                "flags": ["--parallel", "--monitor", "--safety-checks"]
            },
            {
                "name": "System Performance Optimization",
                "objective": "Analyze and optimize entire system performance including database, backend, and frontend",
                "strategy": "optimization",
                "mode": "hybrid",
                "agents": 7,
                "flags": ["--parallel", "--monitor", "--benchmarking-automated"]
            }
        ]
        
        for scenario in complex_scenarios:
            result = self.execute_swarm_command(
                strategy=scenario["strategy"],
                objective=scenario["objective"],
                coordination_mode=scenario["mode"],
                max_agents=scenario["agents"],
                special_flags=scenario["flags"]
            )
            
            # Store detailed scenario results
            scenario["result"] = asdict(result)
            
            # Basic success check
            assert result.success or result.return_code == 0, \
                f"Complex scenario '{scenario['name']}' failed"
        
        # Generate complex scenario report
        self._generate_scenario_report(complex_scenarios)
    
    def _generate_compatibility_matrix(self, results: List[Dict]):
        """Generate strategy-coordination mode compatibility matrix"""
        matrix = {}
        
        for result in results:
            strategy = result["strategy"]
            mode = result["coordination_mode"]
            
            if strategy not in matrix:
                matrix[strategy] = {}
            
            matrix[strategy][mode] = {
                "compatible": result["success"],
                "avg_duration": result["duration"]
            }
        
        # Save matrix
        matrix_path = Path(__file__).parent / "strategy_coordination_matrix.json"
        with open(matrix_path, "w") as f:
            json.dump({
                "timestamp": datetime.now().isoformat(),
                "matrix": matrix
            }, f, indent=2)
    
    def _analyze_scalability(self, results: List[Dict]):
        """Analyze swarm scalability metrics"""
        analysis = {
            "timestamp": datetime.now().isoformat(),
            "scalability_data": results,
            "analysis": {}
        }
        
        if len(results) > 1:
            # Calculate scalability metrics
            durations = [r["duration"] for r in results if r["success"]]
            agent_counts = [r["agents"] for r in results if r["success"]]
            
            if len(durations) > 1:
                # Simple linear regression for scalability
                n = len(durations)
                sum_x = sum(agent_counts)
                sum_y = sum(durations)
                sum_xy = sum(x * y for x, y in zip(agent_counts, durations))
                sum_x2 = sum(x ** 2 for x in agent_counts)
                
                slope = (n * sum_xy - sum_x * sum_y) / (n * sum_x2 - sum_x ** 2)
                
                analysis["analysis"] = {
                    "scalability_factor": slope,
                    "interpretation": "linear" if abs(slope) < 5 else "non-linear",
                    "efficiency": "good" if slope < 10 else "poor"
                }
        
        # Save analysis
        analysis_path = Path(__file__).parent / "swarm_scalability_analysis.json"
        with open(analysis_path, "w") as f:
            json.dump(analysis, f, indent=2)
    
    def _generate_scenario_report(self, scenarios: List[Dict]):
        """Generate detailed report for complex scenarios"""
        report = {
            "timestamp": datetime.now().isoformat(),
            "scenarios": scenarios,
            "summary": {
                "total_scenarios": len(scenarios),
                "successful_scenarios": sum(1 for s in scenarios 
                                         if s.get("result", {}).get("success", False)),
                "average_duration": statistics.mean(
                    s["result"]["duration"] for s in scenarios 
                    if "result" in s and "duration" in s["result"]
                ) if scenarios else 0
            }
        }
        
        # Save report
        report_path = Path(__file__).parent / "complex_scenario_report.json"
        with open(report_path, "w") as f:
            json.dump(report, f, indent=2)
    
    @pytest.fixture(scope="class")
    def benchmark_results(self):
        """Fixture to collect and save all benchmark results"""
        yield
        
        # Save all results after tests complete
        if self.results:
            results_path = Path(__file__).parent / "swarm_test_results.json"
            
            # Group results by strategy and coordination mode
            grouped_results = {}
            for result in self.results:
                key = f"{result.strategy}-{result.coordination_mode}"
                if key not in grouped_results:
                    grouped_results[key] = []
                grouped_results[key].append(asdict(result))
            
            # Calculate summary statistics
            summary = {
                "total_tests": len(self.results),
                "successful_tests": sum(1 for r in self.results if r.success),
                "strategies_tested": len(set(r.strategy for r in self.results)),
                "coordination_modes_tested": len(set(r.coordination_mode for r in self.results)),
                "average_duration": statistics.mean(r.duration for r in self.results),
                "average_cpu_usage": statistics.mean(
                    r.cpu_usage for r in self.results if r.cpu_usage is not None
                ) if any(r.cpu_usage for r in self.results) else None,
                "average_memory_usage": statistics.mean(
                    r.memory_usage for r in self.results if r.memory_usage is not None
                ) if any(r.memory_usage for r in self.results) else None
            }
            
            with open(results_path, "w") as f:
                json.dump({
                    "timestamp": datetime.now().isoformat(),
                    "summary": summary,
                    "grouped_results": grouped_results,
                    "all_results": [asdict(r) for r in self.results]
                }, f, indent=2)


if __name__ == "__main__":
    # Run tests with pytest
    pytest.main([__file__, "-v", "--tb=short"])