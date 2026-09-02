#\!/usr/bin/env python3
"""
Simple hive-mind benchmark example using real claude-flow execution.
"""

import subprocess
import sys

def run_hive_mind_benchmark():
    """Run a simple hive-mind benchmark."""
    
    cmd = [
        "swarm-benchmark", "real", "hive-mind",
        "Design a simple REST API",
        "--max-workers", "3",
        "--timeout", "2"
    ]
    
    print("Running hive-mind benchmark...")
    print(f"Command: {' '.join(cmd)}")
    
    result = subprocess.run(cmd, capture_output=True, text=True)
    
    if result.returncode == 0:
        print("✅ Benchmark completed\!")
        print(result.stdout)
    else:
        print(f"❌ Failed: {result.stderr}")
        
    return result.returncode == 0

if __name__ == "__main__":
    success = run_hive_mind_benchmark()
    sys.exit(0 if success else 1)
