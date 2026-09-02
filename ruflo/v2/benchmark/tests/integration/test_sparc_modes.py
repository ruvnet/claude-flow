#!/usr/bin/env python3
"""
Comprehensive integration tests for all 17 SPARC modes in claude-flow.
Tests each mode with real command execution and performance metrics.
"""

import subprocess
import time
import json
import os
import tempfile
import shutil
from pathlib import Path
from typing import Dict, List, Any, Optional
import pytest
import asyncio
from dataclasses import dataclass, asdict
from datetime import datetime
import statistics


@dataclass
class SPARCTestCase:
    """Test case definition for SPARC mode testing"""
    mode: str
    description: str
    test_prompts: List[str]
    expected_outputs: List[str]  # Keywords to check in output
    performance_thresholds: Dict[str, float]  # Max execution times
    special_flags: List[str] = None
    
    def __post_init__(self):
        if self.special_flags is None:
            self.special_flags = []


@dataclass
class SPARCTestResult:
    """Result of a SPARC mode test execution"""
    mode: str
    prompt: str
    success: bool
    duration: float
    stdout: str
    stderr: str
    return_code: int
    memory_usage: Optional[float] = None
    output_size: int = 0
    timestamp: str = ""
    
    def __post_init__(self):
        self.timestamp = datetime.now().isoformat()
        self.output_size = len(self.stdout) + len(self.stderr)


class TestSPARCModes:
    """Comprehensive test suite for all SPARC modes"""
    
    # Define all 17 SPARC modes with test cases
    SPARC_MODES = [
        # Core Orchestration Modes
        SPARCTestCase(
            mode="orchestrator",
            description="Multi-agent task orchestration",
            test_prompts=[
                "Coordinate a team to build a simple web app",
                "Orchestrate parallel development of microservices",
                "Manage distributed testing across multiple components"
            ],
            expected_outputs=["TodoWrite", "Task", "Memory", "coordination"],
            performance_thresholds={"max_duration": 45.0, "avg_duration": 30.0}
        ),
        SPARCTestCase(
            mode="swarm-coordinator",
            description="Specialized swarm management",
            test_prompts=[
                "Coordinate a research swarm on AI trends",
                "Manage a development swarm for API creation",
                "Coordinate testing swarm for security validation"
            ],
            expected_outputs=["swarm", "coordination", "agents", "parallel"],
            performance_thresholds={"max_duration": 50.0, "avg_duration": 35.0}
        ),
        SPARCTestCase(
            mode="workflow-manager",
            description="Process automation specialist",
            test_prompts=[
                "Create a CI/CD workflow for Python project",
                "Design automated testing pipeline",
                "Build deployment automation workflow"
            ],
            expected_outputs=["workflow", "automation", "process", "pipeline"],
            performance_thresholds={"max_duration": 40.0, "avg_duration": 25.0}
        ),
        SPARCTestCase(
            mode="batch-executor",
            description="Parallel task execution",
            test_prompts=[
                "Execute batch file processing operations",
                "Run parallel data transformations",
                "Perform batch code formatting across files"
            ],
            expected_outputs=["batch", "parallel", "execution", "concurrent"],
            performance_thresholds={"max_duration": 45.0, "avg_duration": 30.0}
        ),
        
        # Development Modes
        SPARCTestCase(
            mode="coder",
            description="Autonomous code generation",
            test_prompts=[
                "Create a Python function to calculate factorial",
                "Build a REST API endpoint for user authentication",
                "Implement a binary search algorithm"
            ],
            expected_outputs=["def", "function", "code", "implementation"],
            performance_thresholds={"max_duration": 35.0, "avg_duration": 20.0}
        ),
        SPARCTestCase(
            mode="architect",
            description="System design specialist",
            test_prompts=[
                "Design microservices architecture for e-commerce",
                "Create system architecture for real-time chat",
                "Design scalable data processing pipeline"
            ],
            expected_outputs=["architecture", "design", "components", "system"],
            performance_thresholds={"max_duration": 40.0, "avg_duration": 25.0}
        ),
        SPARCTestCase(
            mode="reviewer",
            description="Code review specialist",
            test_prompts=[
                "Review this Python code for best practices: def add(x,y): return x+y",
                "Analyze code security vulnerabilities",
                "Review code performance and suggest optimizations"
            ],
            expected_outputs=["review", "quality", "suggestions", "improvements"],
            performance_thresholds={"max_duration": 30.0, "avg_duration": 20.0}
        ),
        SPARCTestCase(
            mode="tdd",
            description="Test-driven development",
            test_prompts=[
                "Create tests for a calculator class",
                "Build test suite for user authentication",
                "Develop tests for data validation functions"
            ],
            expected_outputs=["test", "assert", "describe", "coverage"],
            performance_thresholds={"max_duration": 35.0, "avg_duration": 25.0}
        ),
        
        # Analysis and Research Modes
        SPARCTestCase(
            mode="researcher",
            description="Deep research specialist",
            test_prompts=[
                "Research best practices for Python async programming",
                "Investigate microservices design patterns",
                "Research cloud deployment strategies"
            ],
            expected_outputs=["research", "findings", "analysis", "sources"],
            performance_thresholds={"max_duration": 45.0, "avg_duration": 30.0}
        ),
        SPARCTestCase(
            mode="analyzer",
            description="Code and data analysis",
            test_prompts=[
                "Analyze code complexity metrics",
                "Perform data quality analysis",
                "Analyze system performance bottlenecks"
            ],
            expected_outputs=["analysis", "metrics", "patterns", "insights"],
            performance_thresholds={"max_duration": 40.0, "avg_duration": 25.0}
        ),
        SPARCTestCase(
            mode="optimizer",
            description="Performance optimization",
            test_prompts=[
                "Optimize database query performance",
                "Improve algorithm time complexity",
                "Optimize memory usage in data processing"
            ],
            expected_outputs=["optimization", "performance", "improved", "efficiency"],
            performance_thresholds={"max_duration": 45.0, "avg_duration": 30.0}
        ),
        
        # Creative and Support Modes
        SPARCTestCase(
            mode="designer",
            description="UI/UX design specialist",
            test_prompts=[
                "Design user interface for dashboard",
                "Create UX flow for onboarding process",
                "Design responsive layout for mobile app"
            ],
            expected_outputs=["design", "user", "interface", "experience"],
            performance_thresholds={"max_duration": 35.0, "avg_duration": 25.0}
        ),
        SPARCTestCase(
            mode="innovator",
            description="Creative problem solving",
            test_prompts=[
                "Innovate new approaches for data visualization",
                "Create novel solutions for user engagement",
                "Develop innovative caching strategies"
            ],
            expected_outputs=["innovative", "creative", "novel", "solution"],
            performance_thresholds={"max_duration": 40.0, "avg_duration": 30.0}
        ),
        SPARCTestCase(
            mode="documenter",
            description="Documentation specialist",
            test_prompts=[
                "Document API endpoints for REST service",
                "Create user guide for CLI tool",
                "Write technical documentation for architecture"
            ],
            expected_outputs=["documentation", "guide", "reference", "examples"],
            performance_thresholds={"max_duration": 35.0, "avg_duration": 25.0}
        ),
        SPARCTestCase(
            mode="debugger",
            description="Systematic debugging",
            test_prompts=[
                "Debug null pointer exception in code",
                "Find root cause of performance issue",
                "Debug async race condition"
            ],
            expected_outputs=["debug", "issue", "fix", "solution"],
            performance_thresholds={"max_duration": 40.0, "avg_duration": 30.0}
        ),
        SPARCTestCase(
            mode="tester",
            description="Comprehensive testing",
            test_prompts=[
                "Create comprehensive test suite for API",
                "Develop integration tests for database",
                "Build end-to-end tests for workflow"
            ],
            expected_outputs=["test", "validation", "coverage", "suite"],
            performance_thresholds={"max_duration": 40.0, "avg_duration": 30.0}
        ),
        SPARCTestCase(
            mode="memory-manager",
            description="Knowledge management",
            test_prompts=[
                "Organize project knowledge base",
                "Create memory structure for team coordination",
                "Build knowledge graph for system components"
            ],
            expected_outputs=["memory", "knowledge", "organization", "structure"],
            performance_thresholds={"max_duration": 35.0, "avg_duration": 25.0}
        )
    ]
    
    def __init__(self):
        """Initialize test suite"""
        self.claude_flow_path = Path(__file__).parent.parent.parent.parent / "claude-flow"
        self.results: List[SPARCTestResult] = []
        self.temp_dirs: List[Path] = []
        
    def setup_method(self):
        """Setup for each test method"""
        # Create temporary directory for test outputs
        self.test_dir = Path(tempfile.mkdtemp(prefix="sparc_test_"))
        self.temp_dirs.append(self.test_dir)
        os.chdir(self.test_dir)
        
    def teardown_method(self):
        """Cleanup after each test method"""
        # Clean up temporary directories
        for temp_dir in self.temp_dirs:
            if temp_dir.exists():
                shutil.rmtree(temp_dir)
        self.temp_dirs.clear()
        
    def execute_sparc_command(self, mode: str, prompt: str, 
                            special_flags: List[str] = None) -> SPARCTestResult:
        """Execute a single SPARC command and return results"""
        if special_flags is None:
            special_flags = []
            
        command = [
            str(self.claude_flow_path),
            "sparc",
            mode,
            prompt,
            "--non-interactive"
        ] + special_flags
        
        start_time = time.time()
        
        try:
            result = subprocess.run(
                command,
                capture_output=True,
                text=True,
                timeout=60,  # 60 second timeout
                env={**os.environ, "CLAUDE_FLOW_NON_INTERACTIVE": "true"}
            )
            
            duration = time.time() - start_time
            
            return SPARCTestResult(
                mode=mode,
                prompt=prompt,
                success=result.returncode == 0,
                duration=duration,
                stdout=result.stdout,
                stderr=result.stderr,
                return_code=result.returncode
            )
            
        except subprocess.TimeoutExpired:
            return SPARCTestResult(
                mode=mode,
                prompt=prompt,
                success=False,
                duration=60.0,
                stdout="",
                stderr="Command timed out after 60 seconds",
                return_code=-1
            )
        except Exception as e:
            return SPARCTestResult(
                mode=mode,
                prompt=prompt,
                success=False,
                duration=time.time() - start_time,
                stdout="",
                stderr=str(e),
                return_code=-1
            )
    
    @pytest.mark.parametrize("test_case", SPARC_MODES)
    def test_sparc_mode_execution(self, test_case: SPARCTestCase):
        """Test individual SPARC mode execution"""
        mode_results = []
        
        for prompt in test_case.test_prompts:
            result = self.execute_sparc_command(
                mode=test_case.mode,
                prompt=prompt,
                special_flags=test_case.special_flags
            )
            mode_results.append(result)
            self.results.append(result)
            
            # Basic assertions
            assert result.return_code != -1, f"Command execution failed for {test_case.mode}"
            
            # Check for expected output keywords (at least one should be present)
            output_text = (result.stdout + result.stderr).lower()
            keyword_found = any(keyword in output_text for keyword in test_case.expected_outputs)
            assert keyword_found, f"Expected keywords not found in {test_case.mode} output"
        
        # Performance assertions
        durations = [r.duration for r in mode_results]
        avg_duration = statistics.mean(durations)
        max_duration = max(durations)
        
        assert max_duration <= test_case.performance_thresholds["max_duration"], \
            f"{test_case.mode} exceeded max duration threshold"
        assert avg_duration <= test_case.performance_thresholds["avg_duration"], \
            f"{test_case.mode} exceeded average duration threshold"
    
    @pytest.mark.integration
    def test_all_modes_availability(self):
        """Test that all SPARC modes are available"""
        command = [str(self.claude_flow_path), "sparc", "list", "--non-interactive"]
        
        result = subprocess.run(
            command,
            capture_output=True,
            text=True,
            timeout=30
        )
        
        assert result.returncode == 0, "Failed to list SPARC modes"
        
        output = result.stdout.lower()
        for test_case in self.SPARC_MODES:
            assert test_case.mode in output, f"Mode {test_case.mode} not found in list"
    
    @pytest.mark.performance
    def test_sparc_mode_performance_comparison(self):
        """Compare performance across all SPARC modes"""
        performance_data = {}
        
        # Run a standard prompt across all modes
        standard_prompt = "Create a simple example demonstrating your capabilities"
        
        for test_case in self.SPARC_MODES:
            result = self.execute_sparc_command(
                mode=test_case.mode,
                prompt=standard_prompt
            )
            
            performance_data[test_case.mode] = {
                "duration": result.duration,
                "success": result.success,
                "output_size": result.output_size
            }
        
        # Generate performance report
        self._generate_performance_report(performance_data)
    
    @pytest.mark.stress
    def test_sparc_mode_concurrent_execution(self):
        """Test concurrent execution of multiple SPARC modes"""
        import concurrent.futures
        
        test_cases = self.SPARC_MODES[:5]  # Test first 5 modes concurrently
        
        with concurrent.futures.ThreadPoolExecutor(max_workers=5) as executor:
            futures = []
            
            for test_case in test_cases:
                future = executor.submit(
                    self.execute_sparc_command,
                    test_case.mode,
                    test_case.test_prompts[0]
                )
                futures.append((test_case.mode, future))
            
            for mode, future in futures:
                result = future.result(timeout=90)
                assert result.success or result.return_code == 0, \
                    f"Concurrent execution failed for {mode}"
    
    def _generate_performance_report(self, performance_data: Dict[str, Any]):
        """Generate detailed performance report"""
        report = {
            "timestamp": datetime.now().isoformat(),
            "test_type": "SPARC Mode Performance Comparison",
            "modes": performance_data,
            "summary": {
                "total_modes": len(performance_data),
                "successful_modes": sum(1 for v in performance_data.values() if v["success"]),
                "average_duration": statistics.mean(v["duration"] for v in performance_data.values()),
                "fastest_mode": min(performance_data.items(), key=lambda x: x[1]["duration"])[0],
                "slowest_mode": max(performance_data.items(), key=lambda x: x[1]["duration"])[0]
            }
        }
        
        # Save report
        report_path = Path(__file__).parent / "sparc_performance_report.json"
        with open(report_path, "w") as f:
            json.dump(report, f, indent=2)
        
        return report
    
    @pytest.fixture(scope="class")
    def benchmark_results(self):
        """Fixture to collect and save all benchmark results"""
        yield
        
        # Save all results after tests complete
        if self.results:
            results_path = Path(__file__).parent / "sparc_test_results.json"
            with open(results_path, "w") as f:
                json.dump({
                    "timestamp": datetime.now().isoformat(),
                    "total_tests": len(self.results),
                    "successful_tests": sum(1 for r in self.results if r.success),
                    "results": [asdict(r) for r in self.results]
                }, f, indent=2)


if __name__ == "__main__":
    # Run tests with pytest
    pytest.main([__file__, "-v", "--tb=short"])