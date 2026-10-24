#!/usr/bin/env python3
"""
Hive Mind Load Testing Suite - Comprehensive Stress Testing
Benchmark-Tester Agent Implementation

This script executes comprehensive load and stress testing of the Hive Mind system,
testing scalability from 1 to 1000+ agents with various topologies and coordination modes.
"""

import os
import sys
import json
import time
import sqlite3
import threading
import subprocess
import psutil
import multiprocessing
from datetime import datetime
from pathlib import Path
from dataclasses import dataclass, asdict
from typing import Dict, List, Any, Optional, Tuple
from concurrent.futures import ThreadPoolExecutor, ProcessPoolExecutor, as_completed
import statistics

@dataclass
class LoadTestConfig:
    """Configuration for load testing scenarios"""
    name: str
    description: str
    agent_count: int
    topology: str  # hierarchical, mesh, ring, star
    coordination: str  # queen, consensus, hybrid, democracy
    memory_type: str  # sqlite, memory, distributed
    concurrent_swarms: int = 1
    task_complexity: str = "medium"  # simple, medium, complex, enterprise
    duration_seconds: int = 60
    ramp_up_seconds: int = 10
    expected_success_rate: float = 0.95
    stress_mode: bool = False

@dataclass
class LoadTestResult:
    """Results from load testing"""
    config: LoadTestConfig
    start_time: str
    end_time: str
    total_duration: float
    successful_agents: int
    failed_agents: int
    peak_memory_mb: float
    peak_cpu_percent: float
    average_response_time_ms: float
    p95_response_time_ms: float
    p99_response_time_ms: float
    throughput_ops_per_sec: float
    error_rate: float
    coordination_failures: int
    consensus_timeouts: int
    memory_operations: int
    database_locks: int
    network_errors: int
    recovery_time_seconds: float
    breaking_point_reached: bool
    system_stable: bool
    resource_exhaustion: bool
    error_messages: List[str]

class HiveMindLoadTester:
    """Comprehensive load testing for Hive Mind system"""
    
    def __init__(self, output_dir: str = "load-test-results"):
        self.output_dir = Path(output_dir)
        self.output_dir.mkdir(exist_ok=True)
        self.results: List[LoadTestResult] = []
        self.cli_path = self._find_cli_path()
        self.system_monitor = SystemMonitor()
        
    def _find_cli_path(self) -> Path:
        """Find the claude-flow CLI executable"""
        possible_paths = [
            Path("../src/cli/simple-cli.js"),
            Path("./src/cli/simple-cli.js"),
            Path("./claude-flow"),
            Path("../claude-flow")
        ]
        
        for path in possible_paths:
            if path.exists():
                return path
        
        # Fallback to system claude-flow
        return Path("claude-flow")

    def create_load_test_scenarios(self) -> List[LoadTestConfig]:
        """Create comprehensive load testing scenarios"""
        scenarios = []
        
        # Progressive scaling tests (1 -> 1000 agents)
        scaling_tests = [
            (1, "Baseline single agent", 30),
            (5, "Small team coordination", 30),
            (10, "Small organization", 45),
            (25, "Medium team", 60),
            (50, "Large team", 90),
            (100, "Department scale", 120),
            (250, "Enterprise division", 180),
            (500, "Large enterprise", 240),
            (1000, "Massive scale", 300)
        ]
        
        for count, desc, duration in scaling_tests:
            # Test optimal configuration for each scale
            scenarios.append(LoadTestConfig(
                name=f"scale_test_{count}_agents",
                description=f"{desc} - {count} agents",
                agent_count=count,
                topology="hierarchical" if count <= 100 else "mesh",
                coordination="queen" if count <= 50 else "consensus",
                memory_type="sqlite" if count <= 100 else "distributed",
                duration_seconds=duration,
                ramp_up_seconds=max(5, count // 10)
            ))
        
        # Topology stress tests
        topologies = ["hierarchical", "mesh", "ring", "star"]
        for topology in topologies:
            scenarios.append(LoadTestConfig(
                name=f"topology_stress_{topology}",
                description=f"Stress test {topology} topology with 100 agents",
                agent_count=100,
                topology=topology,
                coordination="consensus",
                memory_type="distributed",
                duration_seconds=120,
                stress_mode=True
            ))
        
        # Coordination mode stress tests
        coordination_modes = ["queen", "consensus", "hybrid", "democracy"]
        for mode in coordination_modes:
            scenarios.append(LoadTestConfig(
                name=f"coordination_stress_{mode}",
                description=f"Stress test {mode} coordination with 50 agents",
                agent_count=50,
                topology="mesh",
                coordination=mode,
                memory_type="sqlite",
                duration_seconds=90,
                stress_mode=True
            ))
        
        # Concurrent swarm tests
        scenarios.extend([
            LoadTestConfig(
                name="concurrent_swarms_2",
                description="2 concurrent swarms of 25 agents each",
                agent_count=25,
                topology="hierarchical",
                coordination="queen",
                memory_type="sqlite",
                concurrent_swarms=2,
                duration_seconds=90
            ),
            LoadTestConfig(
                name="concurrent_swarms_5",
                description="5 concurrent swarms of 20 agents each",
                agent_count=20,
                topology="mesh",
                coordination="consensus",
                memory_type="memory",
                concurrent_swarms=5,
                duration_seconds=120
            ),
            LoadTestConfig(
                name="concurrent_swarms_10",
                description="10 concurrent swarms of 10 agents each",
                agent_count=10,
                topology="star",
                coordination="hybrid",
                memory_type="distributed",
                concurrent_swarms=10,
                duration_seconds=180,
                stress_mode=True
            )
        ])
        
        # Memory system stress tests
        scenarios.extend([
            LoadTestConfig(
                name="memory_stress_sqlite",
                description="SQLite memory stress with 200 agents",
                agent_count=200,
                topology="hierarchical",
                coordination="queen",
                memory_type="sqlite",
                duration_seconds=150,
                task_complexity="complex",
                stress_mode=True
            ),
            LoadTestConfig(
                name="memory_stress_distributed",
                description="Distributed memory stress with 500 agents",
                agent_count=500,
                topology="mesh",
                coordination="consensus",
                memory_type="distributed",
                duration_seconds=200,
                task_complexity="enterprise",
                stress_mode=True
            )
        ])
        
        # Breaking point discovery tests
        scenarios.extend([
            LoadTestConfig(
                name="breaking_point_1500",
                description="Find breaking point at 1500 agents",
                agent_count=1500,
                topology="mesh",
                coordination="consensus",
                memory_type="distributed",
                duration_seconds=300,
                expected_success_rate=0.5,
                stress_mode=True
            ),
            LoadTestConfig(
                name="breaking_point_2000",
                description="Find breaking point at 2000 agents",
                agent_count=2000,
                topology="hierarchical",
                coordination="queen",
                memory_type="distributed",
                duration_seconds=300,
                expected_success_rate=0.3,
                stress_mode=True
            )
        ])
        
        return scenarios

    def run_hive_mind_command(self, command: List[str], timeout: int = 120) -> Dict[str, Any]:
        """Execute hive-mind command with performance monitoring"""
        start_time = time.time()
        
        try:
            # Start system monitoring
            monitor_process = self.system_monitor.start_monitoring()
            
            # Execute command
            result = subprocess.run(
                ["node", str(self.cli_path)] + command,
                capture_output=True,
                text=True,
                timeout=timeout,
                cwd=Path.cwd()
            )
            
            end_time = time.time()
            duration = end_time - start_time
            
            # Stop monitoring and get metrics
            metrics = self.system_monitor.stop_monitoring(monitor_process)
            
            return {
                "success": result.returncode == 0,
                "duration": duration,
                "stdout": result.stdout,
                "stderr": result.stderr,
                "returncode": result.returncode,
                "metrics": metrics
            }
            
        except subprocess.TimeoutExpired:
            self.system_monitor.stop_monitoring(None)
            return {
                "success": False,
                "duration": timeout,
                "stdout": "",
                "stderr": f"Command timed out after {timeout} seconds",
                "returncode": -1,
                "metrics": {}
            }
        except Exception as e:
            self.system_monitor.stop_monitoring(None)
            return {
                "success": False,
                "duration": time.time() - start_time,
                "stdout": "",
                "stderr": str(e),
                "returncode": -1,
                "metrics": {}
            }

    def run_single_swarm_load_test(self, config: LoadTestConfig, swarm_id: int = 0) -> Dict[str, Any]:
        """Run load test for a single swarm"""
        print(f"🔥 Starting swarm {swarm_id} load test: {config.name}")
        
        start_time = time.time()
        response_times = []
        errors = []
        
        try:
            # Initialize swarm
            init_cmd = [
                "hive-mind", "init",
                "--test-mode",
                "--swarm-id", f"{config.name}_swarm_{swarm_id}"
            ]
            
            init_result = self.run_hive_mind_command(init_cmd, timeout=60)
            if not init_result["success"]:
                raise Exception(f"Swarm initialization failed: {init_result['stderr']}")
            
            # Ramp up agents gradually
            agents_spawned = 0
            ramp_increment = max(1, config.agent_count // (config.ramp_up_seconds // 2))
            
            while agents_spawned < config.agent_count:
                batch_size = min(ramp_increment, config.agent_count - agents_spawned)
                
                spawn_start = time.time()
                spawn_cmd = [
                    "hive-mind", "spawn",
                    f"Load test batch {agents_spawned}-{agents_spawned + batch_size}",
                    "--topology", config.topology,
                    "--coordination", config.coordination,
                    "--memory", config.memory_type,
                    "--agents", str(batch_size),
                    "--stress-test" if config.stress_mode else "--load-test"
                ]
                
                spawn_result = self.run_hive_mind_command(spawn_cmd, timeout=120)
                spawn_time = time.time() - spawn_start
                response_times.append(spawn_time * 1000)  # Convert to ms
                
                if not spawn_result["success"]:
                    errors.append(f"Agent spawn failed: {spawn_result['stderr']}")
                    break
                
                agents_spawned += batch_size
                
                # Brief pause between batches during ramp-up
                if agents_spawned < config.agent_count:
                    time.sleep(1)
            
            # Run sustained load for duration
            test_start = time.time()
            operations_completed = 0
            
            while time.time() - test_start < config.duration_seconds:
                # Execute coordination tasks
                task_start = time.time()
                task_cmd = [
                    "hive-mind", "task",
                    f"Load test operation {operations_completed}",
                    "--complexity", config.task_complexity,
                    "--timeout", "30"
                ]
                
                task_result = self.run_hive_mind_command(task_cmd, timeout=30)
                task_time = time.time() - task_start
                response_times.append(task_time * 1000)
                
                if not task_result["success"]:
                    errors.append(f"Task execution failed: {task_result['stderr']}")
                
                operations_completed += 1
                
                # Brief pause between operations
                time.sleep(0.5)
            
            # Cleanup swarm
            cleanup_cmd = ["hive-mind", "cleanup", "--swarm-id", f"{config.name}_swarm_{swarm_id}"]
            cleanup_result = self.run_hive_mind_command(cleanup_cmd, timeout=60)
            
            total_duration = time.time() - start_time
            
            return {
                "swarm_id": swarm_id,
                "success": len(errors) == 0,
                "duration": total_duration,
                "agents_spawned": agents_spawned,
                "operations_completed": operations_completed,
                "response_times": response_times,
                "errors": errors,
                "throughput": operations_completed / config.duration_seconds if config.duration_seconds > 0 else 0
            }
            
        except Exception as e:
            return {
                "swarm_id": swarm_id,
                "success": False,
                "duration": time.time() - start_time,
                "agents_spawned": 0,
                "operations_completed": 0,
                "response_times": [],
                "errors": [str(e)],
                "throughput": 0
            }

    def run_load_test(self, config: LoadTestConfig) -> LoadTestResult:
        """Run comprehensive load test for a configuration"""
        print(f"🚀 Running load test: {config.name}")
        print(f"   📊 {config.agent_count} agents, {config.concurrent_swarms} swarms")
        print(f"   🏗️ Topology: {config.topology}, Coordination: {config.coordination}")
        print(f"   💾 Memory: {config.memory_type}, Duration: {config.duration_seconds}s")
        
        start_time = datetime.now().isoformat()
        test_start = time.time()
        
        # Start system monitoring
        system_monitor_process = self.system_monitor.start_monitoring()
        
        try:
            # Run concurrent swarms if specified
            if config.concurrent_swarms > 1:
                with ThreadPoolExecutor(max_workers=config.concurrent_swarms) as executor:
                    futures = {
                        executor.submit(self.run_single_swarm_load_test, config, i): i 
                        for i in range(config.concurrent_swarms)
                    }
                    
                    swarm_results = []
                    for future in as_completed(futures):
                        result = future.result()
                        swarm_results.append(result)
                        swarm_id = futures[future]
                        status = "✅" if result["success"] else "❌"
                        print(f"   {status} Swarm {swarm_id}: {result['operations_completed']} ops")
            else:
                # Single swarm test
                swarm_result = self.run_single_swarm_load_test(config, 0)
                swarm_results = [swarm_result]
            
            # Stop system monitoring and collect metrics
            system_metrics = self.system_monitor.stop_monitoring(system_monitor_process)
            
            # Aggregate results from all swarms
            total_duration = time.time() - test_start
            end_time = datetime.now().isoformat()
            
            # Calculate aggregate metrics
            all_response_times = []
            all_errors = []
            total_agents = 0
            total_operations = 0
            successful_swarms = 0
            
            for result in swarm_results:
                all_response_times.extend(result["response_times"])
                all_errors.extend(result["errors"])
                total_agents += result["agents_spawned"]
                total_operations += result["operations_completed"]
                if result["success"]:
                    successful_swarms += 1
            
            # Calculate performance metrics
            avg_response_time = statistics.mean(all_response_times) if all_response_times else 0
            p95_response_time = statistics.quantiles(all_response_times, n=20)[18] if len(all_response_times) > 20 else 0
            p99_response_time = statistics.quantiles(all_response_times, n=100)[98] if len(all_response_times) > 100 else 0
            
            throughput = total_operations / config.duration_seconds if config.duration_seconds > 0 else 0
            error_rate = len(all_errors) / (total_operations + len(all_errors)) if (total_operations + len(all_errors)) > 0 else 0
            
            # Determine system stability
            success_rate = successful_swarms / len(swarm_results) if swarm_results else 0
            system_stable = success_rate >= config.expected_success_rate
            breaking_point_reached = success_rate < 0.5
            resource_exhaustion = system_metrics.get("peak_memory_mb", 0) > 8000 or system_metrics.get("peak_cpu_percent", 0) > 95
            
            return LoadTestResult(
                config=config,
                start_time=start_time,
                end_time=end_time,
                total_duration=total_duration,
                successful_agents=total_agents,
                failed_agents=max(0, config.agent_count * config.concurrent_swarms - total_agents),
                peak_memory_mb=system_metrics.get("peak_memory_mb", 0),
                peak_cpu_percent=system_metrics.get("peak_cpu_percent", 0),
                average_response_time_ms=avg_response_time,
                p95_response_time_ms=p95_response_time,
                p99_response_time_ms=p99_response_time,
                throughput_ops_per_sec=throughput,
                error_rate=error_rate,
                coordination_failures=len([e for e in all_errors if "coordination" in e.lower()]),
                consensus_timeouts=len([e for e in all_errors if "timeout" in e.lower()]),
                memory_operations=total_operations * 3,  # Estimated
                database_locks=len([e for e in all_errors if "lock" in e.lower()]),
                network_errors=len([e for e in all_errors if "network" in e.lower()]),
                recovery_time_seconds=0,  # Would need additional monitoring
                breaking_point_reached=breaking_point_reached,
                system_stable=system_stable,
                resource_exhaustion=resource_exhaustion,
                error_messages=all_errors[:10]  # Keep first 10 errors
            )
            
        except Exception as e:
            self.system_monitor.stop_monitoring(system_monitor_process)
            return LoadTestResult(
                config=config,
                start_time=start_time,
                end_time=datetime.now().isoformat(),
                total_duration=time.time() - test_start,
                successful_agents=0,
                failed_agents=config.agent_count * config.concurrent_swarms,
                peak_memory_mb=0,
                peak_cpu_percent=0,
                average_response_time_ms=0,
                p95_response_time_ms=0,
                p99_response_time_ms=0,
                throughput_ops_per_sec=0,
                error_rate=1.0,
                coordination_failures=1,
                consensus_timeouts=0,
                memory_operations=0,
                database_locks=0,
                network_errors=0,
                recovery_time_seconds=0,
                breaking_point_reached=True,
                system_stable=False,
                resource_exhaustion=True,
                error_messages=[str(e)]
            )

    def run_progressive_load_testing(self, scenarios: List[LoadTestConfig]) -> List[LoadTestResult]:
        """Run load tests progressively, stopping at breaking points"""
        results = []
        
        # Sort scenarios by agent count for progressive testing
        sorted_scenarios = sorted(scenarios, key=lambda s: s.agent_count)
        
        print("🎯 Starting Progressive Load Testing")
        print("=" * 50)
        
        for i, scenario in enumerate(sorted_scenarios):
            print(f"\n📈 Test {i+1}/{len(sorted_scenarios)}: {scenario.name}")
            
            result = self.run_load_test(scenario)
            results.append(result)
            
            # Report result
            status = "✅" if result.system_stable else "❌"
            print(f"{status} {scenario.name}: {result.successful_agents}/{scenario.agent_count * scenario.concurrent_swarms} agents")
            print(f"   ⚡ Throughput: {result.throughput_ops_per_sec:.1f} ops/sec")
            print(f"   🧠 Memory: {result.peak_memory_mb:.1f}MB, CPU: {result.peak_cpu_percent:.1f}%")
            print(f"   🎯 Response time: {result.average_response_time_ms:.1f}ms (P95: {result.p95_response_time_ms:.1f}ms)")
            
            # Check if we should continue
            if result.breaking_point_reached:
                print(f"🚨 Breaking point reached at {scenario.agent_count} agents!")
                if scenario.agent_count >= 500:  # Continue testing if we've reached a reasonable scale
                    print("   Continuing with remaining tests for completeness...")
                else:
                    print("   Stopping progressive testing due to early failure.")
                    break
            
            # Brief pause between tests for system recovery
            time.sleep(5)
        
        return results

    def analyze_load_test_results(self, results: List[LoadTestResult]) -> Dict[str, Any]:
        """Analyze load test results and generate insights"""
        if not results:
            return {"error": "No results to analyze"}
        
        successful_results = [r for r in results if r.system_stable]
        failed_results = [r for r in results if not r.system_stable]
        breaking_points = [r for r in results if r.breaking_point_reached]
        
        # Find scaling limits
        max_stable_agents = max([r.successful_agents for r in successful_results], default=0)
        breaking_point_agents = min([r.config.agent_count for r in breaking_points], default=None)
        
        # Performance characteristics
        performance_by_scale = {}
        for result in successful_results:
            scale = self._categorize_scale(result.config.agent_count)
            if scale not in performance_by_scale:
                performance_by_scale[scale] = []
            performance_by_scale[scale].append({
                "agents": result.config.agent_count,
                "throughput": result.throughput_ops_per_sec,
                "response_time": result.average_response_time_ms,
                "memory_mb": result.peak_memory_mb,
                "cpu_percent": result.peak_cpu_percent
            })
        
        # Topology performance comparison
        topology_performance = {}
        for result in successful_results:
            topology = result.config.topology
            if topology not in topology_performance:
                topology_performance[topology] = []
            topology_performance[topology].append({
                "agents": result.config.agent_count,
                "throughput": result.throughput_ops_per_sec,
                "response_time": result.average_response_time_ms,
                "coordination_failures": result.coordination_failures
            })
        
        # Resource utilization analysis
        resource_analysis = {
            "memory_efficiency": {},
            "cpu_efficiency": {},
            "breaking_points": {}
        }
        
        for result in results:
            agent_count = result.config.agent_count
            if result.successful_agents > 0:
                memory_per_agent = result.peak_memory_mb / result.successful_agents
                cpu_per_agent = result.peak_cpu_percent / result.successful_agents
                
                resource_analysis["memory_efficiency"][agent_count] = memory_per_agent
                resource_analysis["cpu_efficiency"][agent_count] = cpu_per_agent
            
            if result.breaking_point_reached:
                resource_analysis["breaking_points"][agent_count] = {
                    "error_rate": result.error_rate,
                    "resource_exhaustion": result.resource_exhaustion,
                    "coordination_failures": result.coordination_failures
                }
        
        # Recommendations
        recommendations = []
        
        if max_stable_agents < 100:
            recommendations.append("System shows scaling issues below 100 agents. Consider optimizing coordination mechanisms.")
        elif max_stable_agents < 500:
            recommendations.append("Good performance up to medium scale. Consider distributed memory for larger deployments.")
        else:
            recommendations.append("Excellent scaling characteristics. System ready for enterprise deployment.")
        
        if breaking_point_agents and breaking_point_agents < 1000:
            recommendations.append(f"Breaking point identified at {breaking_point_agents} agents. Implement sharding or federation for larger scales.")
        
        # Performance targets assessment
        targets_met = {
            "response_time_target": len([r for r in successful_results if r.average_response_time_ms < 1000]),
            "throughput_target": len([r for r in successful_results if r.throughput_ops_per_sec > 10]),
            "memory_target": len([r for r in successful_results if r.peak_memory_mb < 2000]),
            "stability_target": len([r for r in successful_results if r.error_rate < 0.05])
        }
        
        return {
            "summary": {
                "total_tests": len(results),
                "successful_tests": len(successful_results),
                "failed_tests": len(failed_results),
                "max_stable_agents": max_stable_agents,
                "breaking_point_agents": breaking_point_agents,
                "avg_throughput": statistics.mean([r.throughput_ops_per_sec for r in successful_results]) if successful_results else 0,
                "avg_response_time_ms": statistics.mean([r.average_response_time_ms for r in successful_results]) if successful_results else 0,
                "peak_memory_usage_mb": max([r.peak_memory_mb for r in results], default=0),
                "peak_cpu_usage_percent": max([r.peak_cpu_percent for r in results], default=0)
            },
            "performance_by_scale": performance_by_scale,
            "topology_performance": topology_performance,
            "resource_analysis": resource_analysis,
            "recommendations": recommendations,
            "targets_assessment": targets_met,
            "scaling_characteristics": {
                "linear_scaling_limit": max_stable_agents,
                "degradation_point": breaking_point_agents,
                "resource_efficiency_curve": resource_analysis["memory_efficiency"]
            }
        }
    
    def _categorize_scale(self, agent_count: int) -> str:
        """Categorize agent count into scale categories"""
        if agent_count <= 10:
            return "small"
        elif agent_count <= 100:
            return "medium"
        elif agent_count <= 500:
            return "large"
        else:
            return "enterprise"

    def save_load_test_results(self, results: List[LoadTestResult], analysis: Dict[str, Any]):
        """Save load test results and analysis"""
        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        
        # Save detailed results
        results_file = self.output_dir / f"hive_mind_load_test_results_{timestamp}.json"
        with open(results_file, 'w') as f:
            json.dump([asdict(r) for r in results], f, indent=2)
        
        # Save analysis
        analysis_file = self.output_dir / f"hive_mind_load_test_analysis_{timestamp}.json"
        with open(analysis_file, 'w') as f:
            json.dump(analysis, f, indent=2)
        
        # Save performance summary CSV
        csv_file = self.output_dir / f"hive_mind_load_test_summary_{timestamp}.csv"
        with open(csv_file, 'w') as f:
            f.write("test_name,agent_count,concurrent_swarms,topology,coordination,memory_type,")
            f.write("successful_agents,throughput_ops_sec,avg_response_ms,p95_response_ms,")
            f.write("peak_memory_mb,peak_cpu_percent,error_rate,system_stable,breaking_point\\n")
            
            for result in results:
                config = result.config
                f.write(f"{config.name},{config.agent_count},{config.concurrent_swarms},")
                f.write(f"{config.topology},{config.coordination},{config.memory_type},")
                f.write(f"{result.successful_agents},{result.throughput_ops_per_sec:.2f},")
                f.write(f"{result.average_response_time_ms:.1f},{result.p95_response_time_ms:.1f},")
                f.write(f"{result.peak_memory_mb:.1f},{result.peak_cpu_percent:.1f},")
                f.write(f"{result.error_rate:.3f},{result.system_stable},{result.breaking_point_reached}\\n")
        
        print(f"📊 Load test results saved:")
        print(f"   📄 Detailed results: {results_file}")
        print(f"   📈 Analysis: {analysis_file}")
        print(f"   📋 Summary CSV: {csv_file}")
        
        return {
            "results_file": str(results_file),
            "analysis_file": str(analysis_file),
            "csv_file": str(csv_file)
        }

    def run_comprehensive_load_testing(self) -> Dict[str, Any]:
        """Run complete load testing suite"""
        print("🔥 Hive Mind Comprehensive Load Testing Suite")
        print("=" * 60)
        print("🎯 Testing scalability from 1 to 1000+ agents")
        print("🚀 Multiple topologies and coordination modes")
        print("💾 Different memory backends")
        print("🔍 Breaking point discovery")
        print("=" * 60)
        
        # Create test scenarios
        scenarios = self.create_load_test_scenarios()
        print(f"📋 Created {len(scenarios)} load test scenarios")
        
        # Run progressive load testing
        start_time = time.time()
        results = self.run_progressive_load_testing(scenarios)
        total_duration = time.time() - start_time
        
        print(f"\\n⏱️  Total testing time: {total_duration:.1f} seconds")
        
        # Analyze results
        analysis = self.analyze_load_test_results(results)
        
        # Save results
        file_info = self.save_load_test_results(results, analysis)
        
        # Add metadata
        analysis["metadata"] = {
            "total_duration_seconds": total_duration,
            "test_time": datetime.now().isoformat(),
            "scenario_count": len(scenarios),
            "system_info": {
                "cpu_count": multiprocessing.cpu_count(),
                "memory_gb": psutil.virtual_memory().total / (1024**3),
                "python_version": sys.version,
                "platform": sys.platform
            }
        }
        analysis["files"] = file_info
        
        return analysis

class SystemMonitor:
    """Monitor system resources during load testing"""
    
    def __init__(self):
        self.monitoring = False
        self.metrics = {
            "cpu_samples": [],
            "memory_samples": [],
            "io_samples": []
        }
    
    def start_monitoring(self) -> threading.Thread:
        """Start monitoring system resources"""
        self.monitoring = True
        self.metrics = {"cpu_samples": [], "memory_samples": [], "io_samples": []}
        
        def monitor():
            while self.monitoring:
                try:
                    # CPU usage
                    cpu_percent = psutil.cpu_percent(interval=1)
                    self.metrics["cpu_samples"].append(cpu_percent)
                    
                    # Memory usage
                    memory = psutil.virtual_memory()
                    self.metrics["memory_samples"].append(memory.percent)
                    
                    # I/O stats
                    io_counters = psutil.disk_io_counters()
                    if io_counters:
                        self.metrics["io_samples"].append({
                            "read_bytes": io_counters.read_bytes,
                            "write_bytes": io_counters.write_bytes
                        })
                    
                except Exception:
                    pass  # Continue monitoring despite errors
                
                time.sleep(1)
        
        thread = threading.Thread(target=monitor)
        thread.daemon = True
        thread.start()
        return thread
    
    def stop_monitoring(self, thread: Optional[threading.Thread]) -> Dict[str, Any]:
        """Stop monitoring and return collected metrics"""
        self.monitoring = False
        
        if thread:
            thread.join(timeout=2)
        
        if not self.metrics["cpu_samples"]:
            return {}
        
        return {
            "peak_cpu_percent": max(self.metrics["cpu_samples"]),
            "avg_cpu_percent": statistics.mean(self.metrics["cpu_samples"]),
            "peak_memory_percent": max(self.metrics["memory_samples"]),
            "avg_memory_percent": statistics.mean(self.metrics["memory_samples"]),
            "peak_memory_mb": max(self.metrics["memory_samples"]) * psutil.virtual_memory().total / (1024**2) / 100,
            "sample_count": len(self.metrics["cpu_samples"])
        }

def main():
    """Main load testing execution"""
    import argparse
    
    parser = argparse.ArgumentParser(description="Hive Mind Load Testing Suite")
    parser.add_argument("--quick", action="store_true", help="Run quick load test with reduced scenarios")
    parser.add_argument("--scale", type=int, help="Test specific agent scale")
    parser.add_argument("--output", default="load-test-results", help="Output directory")
    parser.add_argument("--max-agents", type=int, default=1000, help="Maximum agents to test")
    
    args = parser.parse_args()
    
    tester = HiveMindLoadTester(output_dir=args.output)
    
    if args.quick:
        # Quick test scenarios
        scenarios = [
            LoadTestConfig("quick_small", "Quick small scale test", 5, "hierarchical", "queen", "sqlite", duration_seconds=30),
            LoadTestConfig("quick_medium", "Quick medium scale test", 25, "mesh", "consensus", "memory", duration_seconds=45),
            LoadTestConfig("quick_large", "Quick large scale test", 100, "hierarchical", "queen", "distributed", duration_seconds=60)
        ]
        
        print("🚀 Running quick load test...")
        results = []
        for scenario in scenarios:
            result = tester.run_load_test(scenario)
            results.append(result)
        
        analysis = tester.analyze_load_test_results(results)
        tester.save_load_test_results(results, analysis)
        
    elif args.scale:
        # Test specific scale
        scenario = LoadTestConfig(
            f"custom_scale_{args.scale}",
            f"Custom scale test with {args.scale} agents",
            args.scale,
            "hierarchical" if args.scale <= 100 else "mesh",
            "queen" if args.scale <= 50 else "consensus", 
            "sqlite" if args.scale <= 100 else "distributed",
            duration_seconds=max(60, args.scale // 10)
        )
        
        print(f"🎯 Running custom scale test with {args.scale} agents...")
        result = tester.run_load_test(scenario)
        analysis = tester.analyze_load_test_results([result])
        tester.save_load_test_results([result], analysis)
        
    else:
        # Full comprehensive load testing
        analysis = tester.run_comprehensive_load_testing()
        
        # Print summary
        summary = analysis["summary"]
        print("\\n🎯 LOAD TESTING SUMMARY")
        print("=" * 50)
        print(f"Total tests: {summary['total_tests']}")
        print(f"Successful tests: {summary['successful_tests']}")
        print(f"Max stable agents: {summary['max_stable_agents']}")
        print(f"Breaking point: {summary['breaking_point_agents']} agents" if summary['breaking_point_agents'] else "No breaking point found")
        print(f"Average throughput: {summary['avg_throughput']:.1f} ops/sec")
        print(f"Average response time: {summary['avg_response_time_ms']:.1f}ms")
        print(f"Peak memory usage: {summary['peak_memory_usage_mb']:.1f}MB")
        print(f"Peak CPU usage: {summary['peak_cpu_usage_percent']:.1f}%")
        
        # Print recommendations
        if analysis["recommendations"]:
            print("\\n💡 RECOMMENDATIONS")
            for i, rec in enumerate(analysis["recommendations"], 1):
                print(f"{i}. {rec}")

if __name__ == "__main__":
    main()