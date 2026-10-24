#!/usr/bin/env python3
"""Quick test of claude-flow integration."""

import sys
from pathlib import Path

# Add benchmark src to path
sys.path.insert(0, str(Path(__file__).parent / "src"))

from swarm_benchmark.core.claude_flow_executor import ClaudeFlowExecutor

def main():
    print("🧪 Quick Integration Test")
    
    try:
        # Test initialization
        executor = ClaudeFlowExecutor()
        print(f"✅ Executor initialized: {executor.claude_flow_path}")
        
        # Test version check
        if executor.validate_installation():
            print("✅ Claude-flow installation validated")
        else:
            print("❌ Installation validation failed")
            return False
            
        # Test simple command
        result = executor._execute_command([executor.claude_flow_path, "--help"], timeout=5)
        print(f"✅ Help command executed: exit_code={result.exit_code}")
        
        if result.stdout:
            print("\n📄 Help output (first 500 chars):")
            print(result.stdout[:500])
            
        return True
        
    except Exception as e:
        print(f"❌ Test failed: {e}")
        return False


if __name__ == "__main__":
    success = main()
    sys.exit(0 if success else 1)