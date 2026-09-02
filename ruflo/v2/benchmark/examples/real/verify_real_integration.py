#!/usr/bin/env python3
"""
Real Claude Flow Integration Verification
Demonstrates real command execution with JSON streaming output parsing.
"""

import subprocess
import time
import json
import os
import sys
from pathlib import Path
from typing import Dict, List, Any, Optional
from dataclasses import dataclass
import threading
import queue


@dataclass
class RealCommandResult:
    """Result from a real Claude Flow command execution."""
    command: str
    success: bool
    duration: float
    stdout: str
    stderr: str
    json_responses: List[Dict[str, Any]]
    parsed_metrics: Dict[str, Any]


class RealIntegrationVerifier:
    """Verifier for real Claude Flow integration."""
    
    def __init__(self):
        """Initialize the verifier."""
        self.claude_flow_path = self._find_claude_flow()
        print(f"🔍 Found claude-flow at: {self.claude_flow_path}")
        
        # Verify installation
        if not self._verify_installation():
            raise RuntimeError("Claude Flow installation verification failed")
        
        print("✅ Claude Flow installation verified")
    
    def _find_claude_flow(self) -> str:
        """Find the claude-flow executable."""
        # Common locations to check
        possible_paths = [
            # Binary directories (priority)
            Path("/workspaces/claude-code-flow/bin/claude-flow"),
            Path(__file__).parent.parent.parent.parent / "bin" / "claude-flow",
            
            # Project root
            Path("/workspaces/claude-code-flow/claude-flow"),
            Path(__file__).parent.parent.parent.parent / "claude-flow",
            Path(__file__).parent.parent.parent / "claude-flow", 
            Path.cwd() / "claude-flow",
            
            # Distribution directory
            Path(__file__).parent.parent.parent.parent / "dist" / "claude-flow",
        ]
        
        for path in possible_paths:
            if path.exists() and os.access(path, os.X_OK):
                return str(path.resolve())
        
        # Try system PATH
        import shutil
        system_path = shutil.which("claude-flow")
        if system_path:
            return system_path
            
        raise FileNotFoundError(
            "Could not find claude-flow executable. Please ensure it's built and accessible."
        )
    
    def _verify_installation(self) -> bool:
        """Verify claude-flow is properly installed."""
        try:
            result = subprocess.run(
                [self.claude_flow_path, "--version"],
                capture_output=True,
                text=True,
                timeout=10
            )
            
            if result.returncode == 0:
                print(f"📝 Claude Flow Version: {result.stdout.strip()}")
                return True
            else:
                print(f"❌ Version check failed: {result.stderr}")
                return False
                
        except Exception as e:
            print(f"❌ Installation verification error: {e}")
            return False
    
    def parse_streaming_output(self, output: str) -> List[Dict[str, Any]]:
        """Parse streaming JSON output from claude-flow."""
        json_responses = []
        
        for line in output.split('\n'):
            line = line.strip()
            if not line:
                continue
            
            # Look for complete JSON objects
            if line.startswith('{') and line.endswith('}'):
                try:
                    json_obj = json.loads(line)
                    json_responses.append(json_obj)
                except json.JSONDecodeError:
                    # Not valid JSON, skip
                    continue
            
            # Look for stream-json markers
            elif 'stream-json:' in line.lower():
                try:
                    # Extract JSON part after marker
                    marker_pos = line.lower().find('stream-json:')
                    json_part = line[marker_pos + len('stream-json:'):].strip()
                    json_obj = json.loads(json_part)
                    json_responses.append(json_obj)
                except (json.JSONDecodeError, ValueError):
                    continue
            
            # Look for structured output patterns
            elif any(marker in line.lower() for marker in ['agent:', 'task:', 'memory:', 'swarm:']):
                # Create structured output for text patterns
                json_responses.append({
                    "type": "structured_output",
                    "line": line,
                    "timestamp": time.time()
                })
        
        return json_responses
    
    def extract_metrics(self, stdout: str, stderr: str, json_responses: List[Dict[str, Any]]) -> Dict[str, Any]:
        """Extract performance and operational metrics."""
        metrics = {
            "output_lines": len(stdout.split('\n')),
            "error_lines": len(stderr.split('\n')),
            "json_responses_count": len(json_responses),
            "agents_detected": 0,
            "tasks_detected": 0,
            "errors_detected": 0,
            "memory_operations": 0,
            "response_types": {}
        }
        
        # Analyze combined output
        combined = (stdout + "\n" + stderr).lower()
        
        # Count text-based indicators
        for line in combined.split('\n'):
            if 'agent' in line and ('spawn' in line or 'created' in line):
                metrics["agents_detected"] += 1
            if 'task' in line and ('complete' in line or 'finished' in line):
                metrics["tasks_detected"] += 1
            if 'error' in line or 'failed' in line:
                metrics["errors_detected"] += 1
            if 'memory' in line and ('store' in line or 'retrieve' in line):
                metrics["memory_operations"] += 1
        
        # Analyze JSON responses
        for response in json_responses:
            response_type = response.get('type', 'unknown')
            metrics["response_types"][response_type] = metrics["response_types"].get(response_type, 0) + 1
            
            # Specific type handling
            if response_type == 'agent_spawned':
                metrics["agents_detected"] += 1
            elif response_type == 'task_completed':
                metrics["tasks_detected"] += 1
            elif response_type == 'error':
                metrics["errors_detected"] += 1
            elif response_type == 'memory_operation':
                metrics["memory_operations"] += 1
        
        return metrics
    
    def execute_real_command(self, command_args: List[str], timeout: int = 30) -> RealCommandResult:
        """Execute a real claude-flow command and collect comprehensive metrics."""
        full_command = [self.claude_flow_path] + command_args
        command_str = ' '.join(full_command)
        
        print(f"\n🚀 Executing: {command_str}")
        print("-" * 60)
        
        start_time = time.time()
        
        try:
            # Execute the command
            result = subprocess.run(
                full_command,
                capture_output=True,
                text=True,
                timeout=timeout
            )
            
            duration = time.time() - start_time
            success = result.returncode == 0
            
            print(f"⏱️  Duration: {duration:.2f}s")
            print(f"📊 Exit Code: {result.returncode}")
            print(f"✅ Success: {success}")
            
            # Parse JSON responses from output
            json_responses = self.parse_streaming_output(result.stdout + "\n" + result.stderr)
            
            # Extract metrics
            metrics = self.extract_metrics(result.stdout, result.stderr, json_responses)
            
            print(f"📈 JSON Responses: {len(json_responses)}")
            print(f"🤖 Agents Detected: {metrics['agents_detected']}")
            print(f"✅ Tasks Detected: {metrics['tasks_detected']}")
            
            return RealCommandResult(
                command=command_str,
                success=success,
                duration=duration,
                stdout=result.stdout,
                stderr=result.stderr,
                json_responses=json_responses,
                parsed_metrics=metrics
            )
            
        except subprocess.TimeoutExpired as e:
            duration = time.time() - start_time
            print(f"⏰ Command timed out after {duration:.2f}s")
            
            stdout = e.stdout.decode() if e.stdout else ""
            stderr = e.stderr.decode() if e.stderr else ""
            json_responses = self.parse_streaming_output(stdout + "\n" + stderr)
            metrics = self.extract_metrics(stdout, stderr, json_responses)
            
            return RealCommandResult(
                command=command_str,
                success=False,
                duration=duration,
                stdout=stdout,
                stderr=stderr,
                json_responses=json_responses,
                parsed_metrics=metrics
            )
            
        except Exception as e:
            print(f"❌ Execution error: {e}")
            return RealCommandResult(
                command=command_str,
                success=False,
                duration=time.time() - start_time,
                stdout="",
                stderr=str(e),
                json_responses=[],
                parsed_metrics={"error": str(e)}
            )
    
    def demonstrate_json_streaming(self):
        """Demonstrate JSON streaming output parsing."""
        print("\n" + "=" * 60)
        print("🎯 JSON STREAMING DEMONSTRATION")
        print("=" * 60)
        
        # Sample JSON streaming output
        sample_streaming = """
Agent initialization starting...
{"type": "agent_spawned", "id": "agent-1", "capabilities": ["research", "analysis"]}
Setting up swarm coordination...
stream-json: {"type": "swarm_status", "active_agents": 1, "mode": "centralized"}
Task assignment in progress...
{"type": "task_assigned", "task_id": "task-001", "agent_id": "agent-1"}
Processing research request...
stream-json: {"type": "progress_update", "percentage": 25, "stage": "research"}
Task completed successfully
{"type": "task_completed", "task_id": "task-001", "status": "success", "duration": 15.2}
"""
        
        print("📝 Sample Streaming Output:")
        print("-" * 40)
        print(sample_streaming)
        
        print("\n🔍 Parsing JSON Responses:")
        print("-" * 40)
        
        json_responses = self.parse_streaming_output(sample_streaming)
        
        for i, response in enumerate(json_responses, 1):
            print(f"{i}. Type: {response.get('type', 'unknown')}")
            print(f"   Data: {json.dumps(response, indent=2)}")
            print()
        
        print(f"📊 Total JSON responses parsed: {len(json_responses)}")
    
    def run_verification_suite(self):
        """Run a suite of verification tests."""
        print("\n" + "=" * 60)
        print("🧪 REAL INTEGRATION VERIFICATION SUITE")
        print("=" * 60)
        
        tests = [
            {
                "name": "Version Check",
                "command": ["--version"],
                "timeout": 5,
                "description": "Verify basic command execution"
            },
            {
                "name": "Help Command", 
                "command": ["--help"],
                "timeout": 5,
                "description": "Test help output parsing"
            },
            {
                "name": "Simple Swarm",
                "command": ["swarm", "echo 'Hello World'", "--non-interactive", "--timeout", "10"],
                "timeout": 20,
                "description": "Test swarm command with JSON streaming"
            },
            {
                "name": "SPARC Coder Mode",
                "command": ["sparc", "coder", "print('Hello from SPARC')", "--non-interactive", "--timeout", "15"],
                "timeout": 25,
                "description": "Test SPARC mode execution"
            }
        ]
        
        results = []
        
        for test in tests:
            print(f"\n🧪 Test: {test['name']}")
            print(f"📋 Description: {test['description']}")
            
            result = self.execute_real_command(test['command'], test['timeout'])
            results.append((test['name'], result))
            
            # Show sample output
            if result.stdout:
                print(f"\n📤 Sample Output (first 200 chars):")
                print(f"   {result.stdout[:200]}...")
            
            if result.json_responses:
                print(f"\n🎯 JSON Responses Sample:")
                for resp in result.json_responses[:2]:  # Show first 2
                    print(f"   - {resp.get('type', 'unknown')}: {json.dumps(resp, indent=4)}")
        
        # Summary
        print(f"\n" + "=" * 60)
        print("📊 VERIFICATION SUMMARY")
        print("=" * 60)
        
        successful = sum(1 for name, result in results if result.success)
        total = len(results)
        
        print(f"✅ Successful Tests: {successful}/{total}")
        print(f"⏱️  Total Duration: {sum(result.duration for _, result in results):.2f}s")
        print(f"📈 Total JSON Responses: {sum(len(result.json_responses) for _, result in results)}")
        
        for name, result in results:
            status = "✅" if result.success else "❌"
            print(f"   {status} {name}: {result.duration:.2f}s")
        
        return results


def main():
    """Main verification function."""
    print("🔍 Claude Flow Real Integration Verification")
    print("=" * 60)
    
    try:
        # Initialize verifier
        verifier = RealIntegrationVerifier()
        
        # Demonstrate JSON streaming parsing
        verifier.demonstrate_json_streaming()
        
        # Run verification suite
        results = verifier.run_verification_suite()
        
        # Save results
        output_file = Path(__file__).parent / "real_integration_results.json"
        with open(output_file, 'w') as f:
            json.dump({
                "timestamp": time.time(),
                "verification_results": [
                    {
                        "test_name": name,
                        "success": result.success,
                        "duration": result.duration,
                        "command": result.command,
                        "json_responses_count": len(result.json_responses),
                        "metrics": result.parsed_metrics
                    }
                    for name, result in results
                ]
            }, f, indent=2)
        
        print(f"\n💾 Results saved to: {output_file}")
        print("\n✅ Real integration verification completed successfully!")
        
    except Exception as e:
        print(f"\n❌ Verification failed: {e}")
        sys.exit(1)


if __name__ == "__main__":
    main()