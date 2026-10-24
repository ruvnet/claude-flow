#!/usr/bin/env python3
"""
Simple Hive Mind Load Test
Quick validation of the system's load handling capabilities
"""

import os
import sys
import json
import time
import psutil
import subprocess
from datetime import datetime
from pathlib import Path
from typing import Dict, List, Any

class SimpleLoadTester:
    """Simple load tester for basic validation"""
    
    def __init__(self):
        self.cli_path = Path("../src/cli/simple-cli.js")
        self.results = []
        
    def run_cli_command(self, command: List[str], timeout: int = 30) -> Dict[str, Any]:
        """Run a CLI command with timeout"""
        start_time = time.time()
        
        try:
            result = subprocess.run(
                ["node", str(self.cli_path)] + command,
                capture_output=True,
                text=True,
                timeout=timeout,
                cwd=Path.cwd().parent
            )
            
            duration = time.time() - start_time
            
            return {
                "success": result.returncode == 0,
                "duration": duration,
                "stdout": result.stdout,
                "stderr": result.stderr,
                "returncode": result.returncode
            }
        except subprocess.TimeoutExpired:
            return {
                "success": False,
                "duration": timeout,
                "stdout": "",
                "stderr": f"Command timed out after {timeout} seconds",
                "returncode": -1
            }
        except Exception as e:
            return {
                "success": False,
                "duration": time.time() - start_time,
                "stdout": "",
                "stderr": str(e),
                "returncode": -1
            }
    
    def test_basic_commands(self) -> Dict[str, Any]:
        """Test basic CLI commands"""
        print("🧪 Testing basic CLI commands...")
        
        tests = [
            (["--help"], "Help command"),
            (["--version"], "Version command"),
            (["status"], "Status command")
        ]
        
        results = {}
        
        for command, description in tests:
            print(f"  Testing: {description}")
            result = self.run_cli_command(command, timeout=10)
            results[description] = result
            
            if result["success"]:
                print(f"    ✅ {description}: {result['duration']:.2f}s")
            else:
                print(f"    ❌ {description}: {result['stderr'][:100]}")
        
        return results
    
    def test_swarm_initialization(self) -> Dict[str, Any]:
        """Test swarm initialization"""
        print("🐝 Testing swarm initialization...")
        
        # Test swarm init
        result = self.run_cli_command(["swarm", "init", "--test"], timeout=30)
        
        if result["success"]:
            print("  ✅ Swarm initialization: SUCCESS")
            return {"swarm_init": result}
        else:
            print(f"  ❌ Swarm initialization: FAILED - {result['stderr'][:100]}")
            return {"swarm_init": result}
    
    def test_agent_spawning(self) -> Dict[str, Any]:
        """Test agent spawning"""
        print("🤖 Testing agent spawning...")
        
        agent_tests = [
            (["agent", "spawn", "researcher", "--test"], "Spawn researcher"),
            (["agent", "spawn", "coder", "--test"], "Spawn coder"),
            (["agent", "list"], "List agents")
        ]
        
        results = {}
        
        for command, description in agent_tests:
            print(f"  Testing: {description}")
            result = self.run_cli_command(command, timeout=20)
            results[description] = result
            
            if result["success"]:
                print(f"    ✅ {description}: {result['duration']:.2f}s")
            else:
                print(f"    ❌ {description}: {result['stderr'][:100]}")
        
        return results
    
    def test_memory_operations(self) -> Dict[str, Any]:
        """Test memory operations"""
        print("💾 Testing memory operations...")
        
        memory_tests = [
            (["memory", "store", "test_key", "test_value"], "Store memory"),
            (["memory", "retrieve", "test_key"], "Retrieve memory"),
            (["memory", "list"], "List memory")
        ]
        
        results = {}
        
        for command, description in memory_tests:
            print(f"  Testing: {description}")
            result = self.run_cli_command(command, timeout=15)
            results[description] = result
            
            if result["success"]:
                print(f"    ✅ {description}: {result['duration']:.2f}s")
            else:
                print(f"    ❌ {description}: {result['stderr'][:100]}")
        
        return results
    
    def measure_system_resources(self) -> Dict[str, Any]:
        """Measure current system resources"""
        try:
            memory = psutil.virtual_memory()
            cpu_percent = psutil.cpu_percent(interval=1)
            
            return {
                "memory_percent": memory.percent,
                "memory_mb": memory.used / (1024**2),
                "available_memory_mb": memory.available / (1024**2),
                "cpu_percent": cpu_percent,
                "process_count": len(psutil.pids())
            }
        except Exception as e:
            return {"error": str(e)}
    
    def run_load_simulation(self, operations: int = 10) -> Dict[str, Any]:
        """Run a simple load simulation"""
        print(f"⚡ Running load simulation with {operations} operations...")
        
        start_time = time.time()
        start_resources = self.measure_system_resources()
        
        successful_operations = 0
        failed_operations = 0
        response_times = []
        
        for i in range(operations):
            print(f"  Operation {i+1}/{operations}")
            
            # Test a simple command
            op_start = time.time()
            result = self.run_cli_command(["status"], timeout=10)
            op_duration = time.time() - op_start
            
            response_times.append(op_duration)
            
            if result["success"]:
                successful_operations += 1
            else:
                failed_operations += 1
            
            # Brief pause between operations
            time.sleep(0.5)
        
        total_duration = time.time() - start_time
        end_resources = self.measure_system_resources()
        
        # Calculate metrics
        avg_response_time = sum(response_times) / len(response_times) if response_times else 0
        throughput = successful_operations / total_duration if total_duration > 0 else 0
        success_rate = successful_operations / operations if operations > 0 else 0
        
        return {
            "total_operations": operations,
            "successful_operations": successful_operations,
            "failed_operations": failed_operations,
            "total_duration": total_duration,
            "avg_response_time": avg_response_time,
            "throughput": throughput,
            "success_rate": success_rate,
            "start_resources": start_resources,
            "end_resources": end_resources,
            "response_times": response_times
        }
    
    def run_simple_load_test(self) -> Dict[str, Any]:
        """Run the complete simple load test"""
        print("🔥 Simple Hive Mind Load Test")
        print("=" * 40)
        
        start_time = datetime.now()
        
        # Test phases
        results = {
            "test_start_time": start_time.isoformat(),
            "basic_commands": self.test_basic_commands(),
            "swarm_initialization": self.test_swarm_initialization(),
            "agent_spawning": self.test_agent_spawning(),
            "memory_operations": self.test_memory_operations(),
            "load_simulation": self.run_load_simulation(10),
            "system_info": {
                "cpu_count": psutil.cpu_count(),
                "memory_gb": psutil.virtual_memory().total / (1024**3),
                "platform": sys.platform
            }
        }
        
        end_time = datetime.now()
        results["test_end_time"] = end_time.isoformat()
        results["total_test_duration"] = (end_time - start_time).total_seconds()
        
        # Generate summary
        self.generate_summary(results)
        
        return results
    
    def generate_summary(self, results: Dict[str, Any]):
        """Generate test summary"""
        print("\\n📊 TEST SUMMARY")
        print("=" * 40)
        
        # Basic command results
        basic_success = sum(1 for r in results["basic_commands"].values() if r.get("success", False))
        basic_total = len(results["basic_commands"])
        print(f"Basic Commands: {basic_success}/{basic_total} passed")
        
        # Swarm initialization
        swarm_success = results["swarm_initialization"]["swarm_init"]["success"]
        print(f"Swarm Init: {'✅ PASS' if swarm_success else '❌ FAIL'}")
        
        # Agent spawning
        agent_success = sum(1 for r in results["agent_spawning"].values() if r.get("success", False))
        agent_total = len(results["agent_spawning"])
        print(f"Agent Operations: {agent_success}/{agent_total} passed")
        
        # Memory operations
        memory_success = sum(1 for r in results["memory_operations"].values() if r.get("success", False))
        memory_total = len(results["memory_operations"])
        print(f"Memory Operations: {memory_success}/{memory_total} passed")
        
        # Load simulation
        load_sim = results["load_simulation"]
        print(f"Load Simulation:")
        print(f"  Success Rate: {load_sim['success_rate']:.1%}")
        print(f"  Throughput: {load_sim['throughput']:.2f} ops/sec")
        print(f"  Avg Response: {load_sim['avg_response_time']:.3f}s")
        
        # Overall assessment
        total_tests = basic_total + 1 + agent_total + memory_total
        total_passed = basic_success + (1 if swarm_success else 0) + agent_success + memory_success
        overall_success_rate = total_passed / total_tests if total_tests > 0 else 0
        
        print(f"\\n🎯 OVERALL RESULT:")
        print(f"Tests Passed: {total_passed}/{total_tests} ({overall_success_rate:.1%})")
        print(f"Duration: {results['total_test_duration']:.1f} seconds")
        
        if overall_success_rate >= 0.8:
            print("✅ SYSTEM READY FOR LOAD TESTING")
        elif overall_success_rate >= 0.5:
            print("⚠️  SYSTEM PARTIALLY READY - Some issues detected")
        else:
            print("❌ SYSTEM NOT READY - Multiple failures detected")
        
        # Save results
        output_file = Path("simple_load_test_results.json")
        with open(output_file, 'w') as f:
            json.dump(results, f, indent=2)
        
        print(f"\\n📄 Results saved to: {output_file}")

def main():
    """Main execution"""
    tester = SimpleLoadTester()
    
    try:
        results = tester.run_simple_load_test()
        
        # Exit with appropriate code
        load_sim = results["load_simulation"]
        if load_sim["success_rate"] >= 0.8:
            sys.exit(0)  # Success
        else:
            sys.exit(1)  # Failure
            
    except KeyboardInterrupt:
        print("\\n⚠️ Test interrupted by user")
        sys.exit(1)
    except Exception as e:
        print(f"\\n❌ Test failed: {e}")
        sys.exit(1)

if __name__ == "__main__":
    main()