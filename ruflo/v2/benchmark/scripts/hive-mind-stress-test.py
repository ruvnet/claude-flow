#!/usr/bin/env python3
"""
Hive Mind Stress Testing Suite - Breaking Point Discovery
Specialized stress testing to find system limits and failure modes

This script pushes the Hive Mind system beyond normal operational limits
to discover breaking points, failure recovery patterns, and system resilience.
"""

import os
import sys
import json
import time
import psutil
import threading
import subprocess
import multiprocessing
from datetime import datetime
from pathlib import Path
from dataclasses import dataclass, asdict
from typing import Dict, List, Any, Optional, Tuple
from concurrent.futures import ThreadPoolExecutor, as_completed
import statistics
import random

@dataclass
class StressTestConfig:
    """Configuration for stress testing scenarios"""
    name: str
    description: str
    stress_type: str  # memory, cpu, coordination, consensus, network, io
    initial_agents: int
    max_agents: int
    increment_size: int
    increment_interval: float  # seconds between increments
    failure_threshold: float = 0.5  # failure rate that indicates breaking point
    resource_limit_mb: int = 8000  # memory limit before stopping
    cpu_limit_percent: float = 95.0  # CPU limit before stopping
    timeout_seconds: int = 300
    chaos_mode: bool = False  # inject random failures

@dataclass
class StressTestResult:
    """Results from stress testing"""
    config: StressTestConfig
    start_time: str
    end_time: str
    breaking_point_agents: int
    max_stable_agents: int
    failure_mode: str
    total_duration: float
    peak_memory_mb: float
    peak_cpu_percent: float
    coordination_failures: int
    consensus_timeouts: int
    network_errors: int
    database_locks: int
    recovery_attempts: int
    successful_recoveries: int
    degradation_curve: List[Dict[str, Any]]
    error_patterns: Dict[str, int]
    system_metrics: Dict[str, Any]
    recommendations: List[str]

class HiveMindStressTester:
    """Specialized stress testing for Hive Mind system limits"""
    
    def __init__(self, output_dir: str = "stress-test-results"):
        self.output_dir = Path(output_dir)
        self.output_dir.mkdir(exist_ok=True)
        self.results: List[StressTestResult] = []
        self.cli_path = self._find_cli_path()
        self.active_processes: List[subprocess.Popen] = []
        self.system_monitor = StressSystemMonitor()
        
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
        return Path("claude-flow")

    def create_stress_test_scenarios(self) -> List[StressTestConfig]:
        """Create comprehensive stress testing scenarios"""
        scenarios = []
        
        # Memory stress tests
        scenarios.extend([
            StressTestConfig(
                name="memory_stress_progressive",
                description="Progressive memory stress until exhaustion",
                stress_type="memory",
                initial_agents=50,
                max_agents=2000,
                increment_size=50,
                increment_interval=10.0,
                resource_limit_mb=6000
            ),
            StressTestConfig(
                name="memory_stress_rapid",
                description="Rapid memory allocation stress",
                stress_type="memory",
                initial_agents=100,
                max_agents=1000,
                increment_size=100,
                increment_interval=2.0,
                resource_limit_mb=6000
            )
        ])
        
        # CPU stress tests
        scenarios.extend([
            StressTestConfig(
                name="cpu_stress_coordination",
                description="CPU stress through intensive coordination",
                stress_type="cpu",
                initial_agents=25,
                max_agents=500,
                increment_size=25,
                increment_interval=5.0,
                cpu_limit_percent=90.0
            ),
            StressTestConfig(
                name="cpu_stress_consensus",
                description="CPU stress through consensus algorithms",
                stress_type="cpu",
                initial_agents=20,
                max_agents=200,
                increment_size=20,
                increment_interval=8.0,
                cpu_limit_percent=90.0
            )
        ])
        
        # Coordination stress tests
        scenarios.extend([
            StressTestConfig(
                name="coordination_stress_mesh",
                description="Coordination stress in mesh topology",
                stress_type="coordination",
                initial_agents=10,
                max_agents=300,
                increment_size=10,
                increment_interval=5.0,
                failure_threshold=0.3
            ),
            StressTestConfig(
                name="coordination_stress_hierarchical",
                description="Coordination stress in hierarchical topology",
                stress_type="coordination",
                initial_agents=20,
                max_agents=500,
                increment_size=20,
                increment_interval=5.0,
                failure_threshold=0.3
            )
        ])
        
        # Consensus stress tests
        scenarios.extend([
            StressTestConfig(
                name="consensus_stress_democracy",
                description="Consensus stress in democratic coordination",
                stress_type="consensus",
                initial_agents=5,
                max_agents=100,
                increment_size=5,
                increment_interval=10.0,
                failure_threshold=0.4
            ),
            StressTestConfig(
                name="consensus_stress_hybrid",
                description="Consensus stress in hybrid coordination",
                stress_type="consensus",
                initial_agents=10,
                max_agents=150,
                increment_size=10,
                increment_interval=8.0,
                failure_threshold=0.4
            )
        ])
        
        # Network stress tests
        scenarios.extend([
            StressTestConfig(
                name="network_stress_distributed",
                description="Network stress with distributed memory",
                stress_type="network",
                initial_agents=30,
                max_agents=400,
                increment_size=30,
                increment_interval=6.0,
                failure_threshold=0.4
            )
        ])
        
        # I/O stress tests
        scenarios.extend([
            StressTestConfig(
                name="io_stress_sqlite",
                description="I/O stress with SQLite backend",
                stress_type="io",
                initial_agents=40,
                max_agents=600,
                increment_size=40,
                increment_interval=7.0,
                failure_threshold=0.4
            )
        ])
        
        # Chaos engineering tests
        scenarios.extend([
            StressTestConfig(
                name="chaos_random_failures",
                description="Chaos engineering with random failures",
                stress_type="chaos",
                initial_agents=25,
                max_agents=200,
                increment_size=25,
                increment_interval=10.0,
                failure_threshold=0.6,
                chaos_mode=True
            )
        ])
        
        return scenarios

    def run_hive_mind_command_async(self, command: List[str], timeout: int = 120) -> subprocess.Popen:
        """Execute hive-mind command asynchronously"""
        try:
            process = subprocess.Popen(
                ["node", str(self.cli_path)] + command,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                text=True,
                cwd=Path.cwd()
            )
            self.active_processes.append(process)
            return process
        except Exception as e:
            print(f"Failed to start command: {e}")
            return None

    def inject_chaos(self, chaos_type: str = "random"):
        """Inject chaos into the system for resilience testing"""
        chaos_actions = [
            self._kill_random_process,
            self._corrupt_memory_operation,
            self._simulate_network_delay,
            self._force_database_lock,
            self._simulate_consensus_failure
        ]
        
        if chaos_type == "random":
            action = random.choice(chaos_actions)
            try:
                action()
            except Exception as e:
                print(f"Chaos injection failed: {e}")

    def _kill_random_process(self):
        """Kill a random active process"""
        if self.active_processes:
            process = random.choice(self.active_processes)
            if process.poll() is None:  # Still running
                process.terminate()
                print("🔥 Chaos: Killed random process")

    def _corrupt_memory_operation(self):
        """Simulate memory corruption"""
        print("🔥 Chaos: Simulating memory corruption")
        # In a real implementation, this would interfere with memory operations

    def _simulate_network_delay(self):
        """Simulate network delays"""
        print("🔥 Chaos: Simulating network delay")
        time.sleep(random.uniform(1, 3))

    def _force_database_lock(self):
        """Force database contention"""
        print("🔥 Chaos: Forcing database contention")
        # In a real implementation, this would create database locks

    def _simulate_consensus_failure(self):
        """Simulate consensus algorithm failure"""
        print("🔥 Chaos: Simulating consensus failure")
        # In a real implementation, this would interfere with consensus

    def monitor_system_degradation(self, config: StressTestConfig) -> Tuple[bool, Dict[str, Any]]:
        """Monitor system for degradation indicators"""
        metrics = self.system_monitor.get_current_metrics()
        
        # Check resource limits
        memory_exceeded = metrics.get("memory_mb", 0) > config.resource_limit_mb
        cpu_exceeded = metrics.get("cpu_percent", 0) > config.cpu_limit_percent
        
        # Check system responsiveness
        load_average = os.getloadavg()[0] if hasattr(os, 'getloadavg') else 0
        high_load = load_average > multiprocessing.cpu_count() * 2
        
        # Check process health
        dead_processes = len([p for p in self.active_processes if p.poll() is not None])
        process_failure_rate = dead_processes / max(len(self.active_processes), 1)
        
        degraded = memory_exceeded or cpu_exceeded or high_load or process_failure_rate > config.failure_threshold
        
        return degraded, {
            "memory_exceeded": memory_exceeded,
            "cpu_exceeded": cpu_exceeded,
            "high_load": high_load,
            "process_failure_rate": process_failure_rate,
            "metrics": metrics
        }

    def attempt_system_recovery(self) -> bool:
        """Attempt to recover system from degraded state"""
        print("🔧 Attempting system recovery...")
        
        recovery_successful = False
        
        try:
            # Clean up dead processes
            dead_processes = [p for p in self.active_processes if p.poll() is not None]
            for process in dead_processes:
                self.active_processes.remove(process)
            
            # Force garbage collection
            import gc
            gc.collect()
            
            # Brief pause for system stabilization
            time.sleep(5)
            
            # Check if system is responsive
            test_metrics = self.system_monitor.get_current_metrics()
            if test_metrics.get("cpu_percent", 100) < 80:
                recovery_successful = True
                print("✅ System recovery successful")
            else:
                print("❌ System recovery failed")
                
        except Exception as e:
            print(f"❌ Recovery attempt failed: {e}")
        
        return recovery_successful

    def run_stress_test(self, config: StressTestConfig) -> StressTestResult:
        """Run a single stress test scenario"""
        print(f"🔥 Starting stress test: {config.name}")
        print(f"   📊 Type: {config.stress_type}")
        print(f"   🎯 Range: {config.initial_agents} -> {config.max_agents} agents")
        print(f"   ⚡ Increment: {config.increment_size} every {config.increment_interval}s")
        
        start_time = datetime.now().isoformat()
        test_start = time.time()
        
        # Start system monitoring
        monitor_thread = self.system_monitor.start_monitoring()
        
        # Initialize tracking variables
        current_agents = config.initial_agents
        breaking_point_agents = None
        max_stable_agents = 0
        failure_mode = "none"
        degradation_curve = []
        error_patterns = {}
        recovery_attempts = 0
        successful_recoveries = 0
        
        try:
            # Initialize Hive Mind system
            init_cmd = ["hive-mind", "init", "--stress-test", "--test-mode"]
            init_process = self.run_hive_mind_command_async(init_cmd)
            
            if init_process:
                init_process.wait(timeout=60)
                if init_process.returncode != 0:
                    raise Exception("Failed to initialize Hive Mind system")
            
            print(f"🚀 Starting with {current_agents} agents...")
            
            # Progressive stress testing loop
            while current_agents <= config.max_agents:
                iteration_start = time.time()
                
                # Spawn agent increment
                spawn_cmd = [
                    "hive-mind", "spawn",
                    f"Stress test increment to {current_agents} agents",
                    "--agents", str(config.increment_size),
                    "--topology", self._get_optimal_topology(current_agents),
                    "--coordination", self._get_optimal_coordination(current_agents, config.stress_type),
                    "--memory", self._get_optimal_memory(current_agents),
                    "--stress-mode"
                ]
                
                spawn_processes = []
                for _ in range(config.increment_size // 10 + 1):  # Batch spawning
                    process = self.run_hive_mind_command_async(spawn_cmd)
                    if process:
                        spawn_processes.append(process)
                
                # Wait for spawning to complete or timeout
                spawn_success = True
                for process in spawn_processes:
                    try:
                        process.wait(timeout=30)
                        if process.returncode != 0:
                            spawn_success = False
                    except subprocess.TimeoutExpired:
                        process.terminate()
                        spawn_success = False
                
                # Inject chaos if enabled
                if config.chaos_mode:
                    self.inject_chaos()
                
                # Monitor system state
                degraded, degradation_info = self.monitor_system_degradation(config)
                
                # Record metrics for this iteration
                iteration_metrics = {
                    "agent_count": current_agents,
                    "timestamp": time.time() - test_start,
                    "spawn_success": spawn_success,
                    "system_degraded": degraded,
                    "metrics": degradation_info["metrics"],
                    "iteration_duration": time.time() - iteration_start
                }
                degradation_curve.append(iteration_metrics)
                
                # Update tracking
                if spawn_success and not degraded:
                    max_stable_agents = current_agents
                    print(f"✅ Stable at {current_agents} agents")
                else:
                    if not breaking_point_agents:
                        breaking_point_agents = current_agents
                        
                        # Determine failure mode
                        if degradation_info["memory_exceeded"]:
                            failure_mode = "memory_exhaustion"
                        elif degradation_info["cpu_exceeded"]:
                            failure_mode = "cpu_exhaustion"
                        elif degradation_info["high_load"]:
                            failure_mode = "system_overload"
                        elif degradation_info["process_failure_rate"] > config.failure_threshold:
                            failure_mode = "process_failures"
                        else:
                            failure_mode = "coordination_breakdown"
                        
                        print(f"🚨 Breaking point reached at {current_agents} agents!")
                        print(f"   Failure mode: {failure_mode}")
                    
                    # Attempt recovery
                    if degraded:
                        recovery_attempts += 1
                        if self.attempt_system_recovery():
                            successful_recoveries += 1
                        else:
                            print("💥 System recovery failed, continuing test...")
                
                # Check if we should continue
                current_failure_rate = len([m for m in degradation_curve[-5:] if not m["spawn_success"]]) / min(5, len(degradation_curve))
                if current_failure_rate > config.failure_threshold and breaking_point_agents:
                    print(f"🛑 Stopping test due to high failure rate: {current_failure_rate:.1%}")
                    break
                
                # Resource safety checks
                current_metrics = self.system_monitor.get_current_metrics()
                if current_metrics.get("memory_mb", 0) > config.resource_limit_mb:
                    print(f"🛑 Stopping test due to memory limit: {current_metrics['memory_mb']:.1f}MB")
                    failure_mode = "memory_limit_reached"
                    break
                
                if current_metrics.get("cpu_percent", 0) > config.cpu_limit_percent:
                    print(f"🛑 Stopping test due to CPU limit: {current_metrics['cpu_percent']:.1f}%")
                    failure_mode = "cpu_limit_reached"
                    break
                
                # Increment for next iteration
                current_agents += config.increment_size
                
                # Wait before next increment
                time.sleep(config.increment_interval)
            
            # Cleanup all processes
            for process in self.active_processes:
                try:
                    if process.poll() is None:
                        process.terminate()
                        process.wait(timeout=10)
                except Exception:
                    pass
            
            self.active_processes.clear()
            
        except Exception as e:
            failure_mode = f"test_exception: {str(e)}"
            print(f"❌ Stress test failed: {e}")
        
        finally:
            # Stop monitoring
            system_metrics = self.system_monitor.stop_monitoring(monitor_thread)
            
            total_duration = time.time() - test_start
            end_time = datetime.now().isoformat()
        
        # Generate recommendations based on results
        recommendations = self._generate_stress_recommendations(
            config, breaking_point_agents, max_stable_agents, failure_mode, degradation_curve
        )
        
        return StressTestResult(
            config=config,
            start_time=start_time,
            end_time=end_time,
            breaking_point_agents=breaking_point_agents or config.max_agents,
            max_stable_agents=max_stable_agents,
            failure_mode=failure_mode,
            total_duration=total_duration,
            peak_memory_mb=system_metrics.get("peak_memory_mb", 0),
            peak_cpu_percent=system_metrics.get("peak_cpu_percent", 0),
            coordination_failures=len([m for m in degradation_curve if not m.get("spawn_success", True)]),
            consensus_timeouts=0,  # Would need specific monitoring
            network_errors=0,  # Would need specific monitoring
            database_locks=0,  # Would need specific monitoring
            recovery_attempts=recovery_attempts,
            successful_recoveries=successful_recoveries,
            degradation_curve=degradation_curve,
            error_patterns=error_patterns,
            system_metrics=system_metrics,
            recommendations=recommendations
        )

    def _get_optimal_topology(self, agent_count: int) -> str:
        """Get optimal topology for agent count"""
        if agent_count <= 50:
            return "hierarchical"
        elif agent_count <= 200:
            return "mesh"
        else:
            return "distributed"

    def _get_optimal_coordination(self, agent_count: int, stress_type: str) -> str:
        """Get optimal coordination mode for stress test"""
        if stress_type == "consensus":
            return "consensus"
        elif agent_count <= 30:
            return "queen"
        elif agent_count <= 150:
            return "hybrid"
        else:
            return "consensus"

    def _get_optimal_memory(self, agent_count: int) -> str:
        """Get optimal memory backend for agent count"""
        if agent_count <= 100:
            return "sqlite"
        else:
            return "distributed"

    def _generate_stress_recommendations(self, config: StressTestConfig, breaking_point: Optional[int], 
                                       max_stable: int, failure_mode: str, curve: List[Dict]) -> List[str]:
        """Generate recommendations based on stress test results"""
        recommendations = []
        
        if breaking_point and breaking_point < 100:
            recommendations.append(f"System shows early breaking point at {breaking_point} agents. Consider optimizing {config.stress_type} handling.")
        
        if failure_mode == "memory_exhaustion":
            recommendations.append("Memory exhaustion detected. Implement memory pooling and garbage collection optimizations.")
        elif failure_mode == "cpu_exhaustion":
            recommendations.append("CPU exhaustion detected. Consider async processing and workload distribution.")
        elif failure_mode == "coordination_breakdown":
            recommendations.append("Coordination breakdown detected. Implement hierarchical coordination for better scaling.")
        elif failure_mode == "process_failures":
            recommendations.append("Process stability issues. Implement better error handling and process supervision.")
        
        if max_stable > 500:
            recommendations.append("Excellent scaling characteristics observed. System suitable for large deployments.")
        elif max_stable > 100:
            recommendations.append("Good scaling up to medium deployments. Consider sharding for larger scales.")
        else:
            recommendations.append("Limited scaling capacity. Requires significant optimization for production use.")
        
        return recommendations

    def run_comprehensive_stress_testing(self) -> Dict[str, Any]:
        """Run complete stress testing suite"""
        print("💥 Hive Mind Comprehensive Stress Testing Suite")
        print("=" * 60)
        print("🎯 Finding breaking points and failure modes")
        print("🔥 Testing system resilience and recovery")
        print("📊 Analyzing degradation patterns")
        print("=" * 60)
        
        # Create stress test scenarios
        scenarios = self.create_stress_test_scenarios()
        print(f"📋 Created {len(scenarios)} stress test scenarios")
        
        # Run stress tests
        results = []
        start_time = time.time()
        
        for i, scenario in enumerate(scenarios):
            print(f"\\n🔥 Running stress test {i+1}/{len(scenarios)}: {scenario.name}")
            
            result = self.run_stress_test(scenario)
            results.append(result)
            
            # Report result
            print(f"📊 Breaking point: {result.breaking_point_agents} agents")
            print(f"📈 Max stable: {result.max_stable_agents} agents")
            print(f"💥 Failure mode: {result.failure_mode}")
            print(f"🔧 Recovery rate: {result.successful_recoveries}/{result.recovery_attempts}")
            
            # Brief pause between tests for system cleanup
            time.sleep(10)
        
        total_duration = time.time() - start_time
        print(f"\\n⏱️  Total stress testing time: {total_duration:.1f} seconds")
        
        # Analyze results
        analysis = self._analyze_stress_results(results)
        
        # Save results
        file_info = self._save_stress_results(results, analysis)
        
        # Add metadata
        analysis["metadata"] = {
            "total_duration_seconds": total_duration,
            "test_time": datetime.now().isoformat(),
            "scenario_count": len(scenarios),
            "system_info": {
                "cpu_count": multiprocessing.cpu_count(),
                "memory_gb": psutil.virtual_memory().total / (1024**3),
                "platform": sys.platform
            }
        }
        analysis["files"] = file_info
        
        return analysis

    def _analyze_stress_results(self, results: List[StressTestResult]) -> Dict[str, Any]:
        """Analyze stress test results"""
        if not results:
            return {"error": "No results to analyze"}
        
        # Breaking point analysis
        breaking_points = [r.breaking_point_agents for r in results if r.breaking_point_agents]
        min_breaking_point = min(breaking_points) if breaking_points else None
        avg_breaking_point = statistics.mean(breaking_points) if breaking_points else None
        
        # Stability analysis
        stable_points = [r.max_stable_agents for r in results]
        max_stability = max(stable_points) if stable_points else 0
        avg_stability = statistics.mean(stable_points) if stable_points else 0
        
        # Failure mode analysis
        failure_modes = {}
        for result in results:
            mode = result.failure_mode
            failure_modes[mode] = failure_modes.get(mode, 0) + 1
        
        # Recovery analysis
        total_recovery_attempts = sum(r.recovery_attempts for r in results)
        total_successful_recoveries = sum(r.successful_recoveries for r in results)
        recovery_rate = total_successful_recoveries / total_recovery_attempts if total_recovery_attempts > 0 else 0
        
        # Resource utilization analysis
        peak_memory = max(r.peak_memory_mb for r in results)
        peak_cpu = max(r.peak_cpu_percent for r in results)
        
        return {
            "summary": {
                "total_tests": len(results),
                "min_breaking_point": min_breaking_point,
                "avg_breaking_point": avg_breaking_point,
                "max_stable_agents": max_stability,
                "avg_stable_agents": avg_stability,
                "peak_memory_mb": peak_memory,
                "peak_cpu_percent": peak_cpu,
                "recovery_rate": recovery_rate
            },
            "failure_modes": failure_modes,
            "breaking_points_by_stress_type": {
                r.config.stress_type: r.breaking_point_agents 
                for r in results if r.breaking_point_agents
            },
            "stability_by_stress_type": {
                r.config.stress_type: r.max_stable_agents 
                for r in results
            },
            "recommendations": self._generate_overall_recommendations(results)
        }

    def _generate_overall_recommendations(self, results: List[StressTestResult]) -> List[str]:
        """Generate overall recommendations from all stress tests"""
        recommendations = []
        
        # Collect all individual recommendations
        all_recommendations = []
        for result in results:
            all_recommendations.extend(result.recommendations)
        
        # Find common themes
        if "memory" in " ".join(all_recommendations).lower():
            recommendations.append("Memory optimization is critical across multiple stress scenarios.")
        
        if "coordination" in " ".join(all_recommendations).lower():
            recommendations.append("Coordination mechanisms need optimization for high-scale deployments.")
        
        if "cpu" in " ".join(all_recommendations).lower():
            recommendations.append("CPU utilization optimization required for sustained high loads.")
        
        # Analyze breaking points
        breaking_points = [r.breaking_point_agents for r in results if r.breaking_point_agents]
        if breaking_points:
            min_bp = min(breaking_points)
            if min_bp < 100:
                recommendations.append("Early breaking points indicate fundamental scaling issues that need addressing.")
            elif min_bp < 500:
                recommendations.append("Medium-scale breaking points suggest optimization opportunities for enterprise use.")
            else:
                recommendations.append("Strong scaling characteristics observed across stress scenarios.")
        
        return recommendations

    def _save_stress_results(self, results: List[StressTestResult], analysis: Dict[str, Any]) -> Dict[str, str]:
        """Save stress test results and analysis"""
        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        
        # Save detailed results
        results_file = self.output_dir / f"hive_mind_stress_test_results_{timestamp}.json"
        with open(results_file, 'w') as f:
            json.dump([asdict(r) for r in results], f, indent=2)
        
        # Save analysis
        analysis_file = self.output_dir / f"hive_mind_stress_test_analysis_{timestamp}.json"
        with open(analysis_file, 'w') as f:
            json.dump(analysis, f, indent=2)
        
        # Save summary CSV
        csv_file = self.output_dir / f"hive_mind_stress_test_summary_{timestamp}.csv"
        with open(csv_file, 'w') as f:
            f.write("test_name,stress_type,max_stable_agents,breaking_point_agents,failure_mode,")
            f.write("peak_memory_mb,peak_cpu_percent,recovery_attempts,successful_recoveries,recovery_rate\\n")
            
            for result in results:
                config = result.config
                recovery_rate = result.successful_recoveries / result.recovery_attempts if result.recovery_attempts > 0 else 0
                f.write(f"{config.name},{config.stress_type},{result.max_stable_agents},")
                f.write(f"{result.breaking_point_agents},{result.failure_mode},")
                f.write(f"{result.peak_memory_mb:.1f},{result.peak_cpu_percent:.1f},")
                f.write(f"{result.recovery_attempts},{result.successful_recoveries},{recovery_rate:.2f}\\n")
        
        print(f"📊 Stress test results saved:")
        print(f"   📄 Detailed results: {results_file}")
        print(f"   📈 Analysis: {analysis_file}")
        print(f"   📋 Summary CSV: {csv_file}")
        
        return {
            "results_file": str(results_file),
            "analysis_file": str(analysis_file),
            "csv_file": str(csv_file)
        }

class StressSystemMonitor:
    """Enhanced system monitoring for stress testing"""
    
    def __init__(self):
        self.monitoring = False
        self.metrics = {
            "cpu_samples": [],
            "memory_samples": [],
            "load_samples": [],
            "process_counts": []
        }
    
    def start_monitoring(self) -> threading.Thread:
        """Start enhanced monitoring"""
        self.monitoring = True
        self.metrics = {
            "cpu_samples": [],
            "memory_samples": [],
            "load_samples": [],
            "process_counts": []
        }
        
        def monitor():
            while self.monitoring:
                try:
                    # Enhanced metrics collection
                    cpu_percent = psutil.cpu_percent(interval=0.1)
                    memory = psutil.virtual_memory()
                    process_count = len(psutil.pids())
                    
                    self.metrics["cpu_samples"].append(cpu_percent)
                    self.metrics["memory_samples"].append(memory.percent)
                    self.metrics["process_counts"].append(process_count)
                    
                    # Load average (Unix only)
                    if hasattr(os, 'getloadavg'):
                        load_avg = os.getloadavg()[0]
                        self.metrics["load_samples"].append(load_avg)
                    
                except Exception:
                    pass
                
                time.sleep(0.5)  # Higher frequency monitoring for stress tests
        
        thread = threading.Thread(target=monitor)
        thread.daemon = True
        thread.start()
        return thread
    
    def get_current_metrics(self) -> Dict[str, Any]:
        """Get current system metrics"""
        try:
            memory = psutil.virtual_memory()
            return {
                "cpu_percent": psutil.cpu_percent(),
                "memory_percent": memory.percent,
                "memory_mb": memory.used / (1024**2),
                "available_memory_mb": memory.available / (1024**2),
                "process_count": len(psutil.pids()),
                "load_average": os.getloadavg()[0] if hasattr(os, 'getloadavg') else 0
            }
        except Exception:
            return {}
    
    def stop_monitoring(self, thread: Optional[threading.Thread]) -> Dict[str, Any]:
        """Stop monitoring and return comprehensive metrics"""
        self.monitoring = False
        
        if thread:
            thread.join(timeout=2)
        
        if not self.metrics["cpu_samples"]:
            return {}
        
        memory_gb = psutil.virtual_memory().total / (1024**3)
        
        return {
            "peak_cpu_percent": max(self.metrics["cpu_samples"]),
            "avg_cpu_percent": statistics.mean(self.metrics["cpu_samples"]),
            "peak_memory_percent": max(self.metrics["memory_samples"]),
            "avg_memory_percent": statistics.mean(self.metrics["memory_samples"]),
            "peak_memory_mb": max(self.metrics["memory_samples"]) * memory_gb * 1024 / 100,
            "peak_process_count": max(self.metrics["process_counts"]) if self.metrics["process_counts"] else 0,
            "peak_load_average": max(self.metrics["load_samples"]) if self.metrics["load_samples"] else 0,
            "sample_count": len(self.metrics["cpu_samples"])
        }

def main():
    """Main stress testing execution"""
    import argparse
    
    parser = argparse.ArgumentParser(description="Hive Mind Stress Testing Suite")
    parser.add_argument("--quick", action="store_true", help="Run quick stress test")
    parser.add_argument("--stress-type", choices=["memory", "cpu", "coordination", "consensus", "network", "io", "chaos"], 
                       help="Run specific stress test type")
    parser.add_argument("--max-agents", type=int, default=1000, help="Maximum agents to test")
    parser.add_argument("--output", default="stress-test-results", help="Output directory")
    
    args = parser.parse_args()
    
    tester = HiveMindStressTester(output_dir=args.output)
    
    if args.quick:
        # Quick stress test
        scenario = StressTestConfig(
            name="quick_stress",
            description="Quick stress test",
            stress_type="memory",
            initial_agents=10,
            max_agents=100,
            increment_size=10,
            increment_interval=5.0
        )
        
        result = tester.run_stress_test(scenario)
        analysis = tester._analyze_stress_results([result])
        tester._save_stress_results([result], analysis)
        
    elif args.stress_type:
        # Specific stress type
        scenarios = [s for s in tester.create_stress_test_scenarios() if s.stress_type == args.stress_type]
        
        results = []
        for scenario in scenarios:
            result = tester.run_stress_test(scenario)
            results.append(result)
        
        analysis = tester._analyze_stress_results(results)
        tester._save_stress_results(results, analysis)
        
    else:
        # Full comprehensive stress testing
        analysis = tester.run_comprehensive_stress_testing()
        
        # Print summary
        summary = analysis["summary"]
        print("\\n💥 STRESS TESTING SUMMARY")
        print("=" * 50)
        print(f"Total tests: {summary['total_tests']}")
        print(f"Min breaking point: {summary['min_breaking_point']} agents" if summary['min_breaking_point'] else "No breaking point found")
        print(f"Avg breaking point: {summary['avg_breaking_point']:.0f} agents" if summary['avg_breaking_point'] else "N/A")
        print(f"Max stable agents: {summary['max_stable_agents']}")
        print(f"Peak memory usage: {summary['peak_memory_mb']:.1f}MB")
        print(f"Peak CPU usage: {summary['peak_cpu_percent']:.1f}%")
        print(f"Recovery success rate: {summary['recovery_rate']:.1%}")
        
        # Print failure modes
        if analysis["failure_modes"]:
            print("\\n💥 FAILURE MODES")
            for mode, count in analysis["failure_modes"].items():
                print(f"  {mode}: {count} occurrences")
        
        # Print recommendations
        if analysis["recommendations"]:
            print("\\n💡 RECOMMENDATIONS")
            for i, rec in enumerate(analysis["recommendations"], 1):
                print(f"{i}. {rec}")

if __name__ == "__main__":
    main()