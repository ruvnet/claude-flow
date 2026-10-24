#!/usr/bin/env python3
"""
Real-time Benchmark Monitor
Monitors Claude Flow benchmark execution and displays live metrics.
"""

import json
import time
import subprocess
import threading
from pathlib import Path
from datetime import datetime
from typing import Dict, Optional, List
import sys
import os

class RealtimeMonitor:
    """Monitor benchmark execution in real-time."""
    
    def __init__(self, output_dir: Path = Path("reports")):
        self.output_dir = output_dir
        self.monitoring = False
        self.current_benchmark = None
        self.metrics = {
            'start_time': None,
            'tasks_completed': 0,
            'agents_active': 0,
            'tokens_used': 0,
            'errors': [],
            'warnings': [],
            'cpu_usage': [],
            'memory_usage': []
        }
    
    def start_benchmark_with_monitoring(self, task: str, strategy: str = "auto", 
                                       max_workers: int = 3) -> None:
        """Start a benchmark with real-time monitoring."""
        
        print("="*80)
        print(f"🚀 STARTING MONITORED BENCHMARK")
        print("="*80)
        print(f"📋 Task: {task}")
        print(f"🎯 Strategy: {strategy}")
        print(f"👥 Max Workers: {max_workers}")
        print(f"📂 Output Dir: {self.output_dir}")
        print("-"*80)
        
        # Create output directory
        self.output_dir.mkdir(parents=True, exist_ok=True)
        
        # Start monitoring in background thread
        self.monitoring = True
        monitor_thread = threading.Thread(target=self._monitor_loop)
        monitor_thread.daemon = True
        monitor_thread.start()
        
        # Run benchmark
        cmd = [
            "swarm-benchmark", "real", "swarm",
            task,
            "--strategy", strategy,
            "--max-workers", str(max_workers),
            "--output-dir", str(self.output_dir),
            "--timeout", "30"
        ]
        
        self.metrics['start_time'] = time.time()
        
        try:
            # Start subprocess
            process = subprocess.Popen(
                cmd,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                text=True,
                bufsize=1
            )
            
            # Monitor output in real-time
            self._display_header()
            
            for line in iter(process.stdout.readline, ''):
                if line:
                    self._process_output_line(line.strip())
            
            process.wait()
            
            # Get final status
            exit_code = process.returncode
            self.monitoring = False
            
            # Display final report
            self._display_final_report(exit_code == 0)
            
        except KeyboardInterrupt:
            print("\n⚠️  Benchmark interrupted by user")
            self.monitoring = False
        except Exception as e:
            print(f"\n❌ Error during benchmark: {e}")
            self.monitoring = False
    
    def _monitor_loop(self) -> None:
        """Background monitoring loop."""
        while self.monitoring:
            # Check for new report files
            self._check_new_reports()
            
            # Update system metrics
            self._update_system_metrics()
            
            time.sleep(1)
    
    def _check_new_reports(self) -> None:
        """Check for new report files and update metrics."""
        json_files = list(self.output_dir.glob("benchmark_*.json"))
        if json_files:
            latest = max(json_files, key=lambda p: p.stat().st_mtime)
            if latest != self.current_benchmark:
                self.current_benchmark = latest
                self._load_benchmark_data(latest)
    
    def _load_benchmark_data(self, file_path: Path) -> None:
        """Load and parse benchmark data."""
        try:
            with open(file_path) as f:
                data = json.load(f)
            
            # Update metrics
            results = data.get('results', [])
            self.metrics['tasks_completed'] = len([r for r in results 
                                                  if r.get('status') == 'success'])
            
            # Count errors and warnings
            for result in results:
                self.metrics['errors'].extend(result.get('errors', []))
                self.metrics['warnings'].extend(result.get('warnings', []))
            
        except Exception:
            pass  # Ignore parse errors during writing
    
    def _update_system_metrics(self) -> None:
        """Update system resource metrics."""
        try:
            # Get system stats using ps command
            result = subprocess.run(
                ["ps", "aux"],
                capture_output=True,
                text=True,
                timeout=1
            )
            
            if result.returncode == 0:
                lines = result.stdout.strip().split('\n')[1:]  # Skip header
                claude_flow_processes = [l for l in lines if 'claude-flow' in l]
                
                if claude_flow_processes:
                    # Parse CPU and memory
                    total_cpu = 0
                    total_mem = 0
                    for line in claude_flow_processes:
                        parts = line.split()
                        if len(parts) > 3:
                            total_cpu += float(parts[2])
                            total_mem += float(parts[3])
                    
                    self.metrics['cpu_usage'].append(total_cpu)
                    self.metrics['memory_usage'].append(total_mem)
                    
                    # Keep only last 60 samples
                    if len(self.metrics['cpu_usage']) > 60:
                        self.metrics['cpu_usage'] = self.metrics['cpu_usage'][-60:]
                        self.metrics['memory_usage'] = self.metrics['memory_usage'][-60:]
        except Exception:
            pass  # Ignore errors in metrics collection
    
    def _display_header(self) -> None:
        """Display monitoring header."""
        print("\n📊 REAL-TIME MONITORING")
        print("-"*80)
    
    def _process_output_line(self, line: str) -> None:
        """Process and display output line with context."""
        timestamp = datetime.now().strftime("%H:%M:%S")
        
        # Detect line type and format accordingly
        if "error" in line.lower() or "❌" in line:
            print(f"[{timestamp}] ❌ {line}")
        elif "warning" in line.lower() or "⚠️" in line:
            print(f"[{timestamp}] ⚠️  {line}")
        elif "success" in line.lower() or "✅" in line:
            print(f"[{timestamp}] ✅ {line}")
        elif "agent" in line.lower() or "spawn" in line.lower():
            print(f"[{timestamp}] 🤖 {line}")
        elif "task" in line.lower():
            print(f"[{timestamp}] 📝 {line}")
        else:
            print(f"[{timestamp}] 📄 {line}")
        
        # Update live metrics display every 10 lines
        if hasattr(self, '_line_count'):
            self._line_count += 1
        else:
            self._line_count = 1
        
        if self._line_count % 10 == 0:
            self._display_live_metrics()
    
    def _display_live_metrics(self) -> None:
        """Display live metrics bar."""
        if not self.metrics['start_time']:
            return
        
        elapsed = time.time() - self.metrics['start_time']
        
        # Build metrics line
        metrics_parts = [
            f"⏱️  {elapsed:.1f}s",
            f"✅ {self.metrics['tasks_completed']} tasks",
            f"❌ {len(self.metrics['errors'])} errors"
        ]
        
        if self.metrics['cpu_usage']:
            avg_cpu = sum(self.metrics['cpu_usage'][-10:]) / len(self.metrics['cpu_usage'][-10:])
            metrics_parts.append(f"💻 {avg_cpu:.1f}% CPU")
        
        if self.metrics['memory_usage']:
            avg_mem = sum(self.metrics['memory_usage'][-10:]) / len(self.metrics['memory_usage'][-10:])
            metrics_parts.append(f"💾 {avg_mem:.1f}% MEM")
        
        # Display inline metrics
        print(f"\r📊 {' | '.join(metrics_parts)}", end='', flush=True)
        print()  # New line after metrics
    
    def _display_final_report(self, success: bool) -> None:
        """Display final benchmark report."""
        print("\n" + "="*80)
        print(f"📊 BENCHMARK {'COMPLETED' if success else 'FAILED'}")
        print("="*80)
        
        if self.metrics['start_time']:
            total_time = time.time() - self.metrics['start_time']
            print(f"\n⏱️  Total Time: {total_time:.2f}s")
        
        print(f"✅ Tasks Completed: {self.metrics['tasks_completed']}")
        print(f"❌ Total Errors: {len(self.metrics['errors'])}")
        print(f"⚠️  Total Warnings: {len(self.metrics['warnings'])}")
        
        # System metrics summary
        if self.metrics['cpu_usage']:
            avg_cpu = sum(self.metrics['cpu_usage']) / len(self.metrics['cpu_usage'])
            peak_cpu = max(self.metrics['cpu_usage'])
            print(f"\n💻 CPU Usage:")
            print(f"   • Average: {avg_cpu:.1f}%")
            print(f"   • Peak: {peak_cpu:.1f}%")
        
        if self.metrics['memory_usage']:
            avg_mem = sum(self.metrics['memory_usage']) / len(self.metrics['memory_usage'])
            peak_mem = max(self.metrics['memory_usage'])
            print(f"\n💾 Memory Usage:")
            print(f"   • Average: {avg_mem:.1f}%")
            print(f"   • Peak: {peak_mem:.1f}%")
        
        # File references
        if self.current_benchmark:
            print(f"\n📁 Report Files:")
            print(f"   • Main: {self.current_benchmark}")
            
            benchmark_id = self.current_benchmark.stem.replace('benchmark_', '')
            metrics_file = self.output_dir / f"metrics_{benchmark_id}.json"
            process_file = self.output_dir / f"process_report_{benchmark_id}.json"
            
            if metrics_file.exists():
                print(f"   • Metrics: {metrics_file}")
            if process_file.exists():
                print(f"   • Process: {process_file}")
        
        # Top errors (if any)
        if self.metrics['errors']:
            print(f"\n⚠️  Top Errors:")
            for i, error in enumerate(self.metrics['errors'][:3], 1):
                print(f"   {i}. {error[:100]}...")
        
        print("\n" + "="*80)

def main():
    """Main entry point for realtime monitor."""
    import argparse
    
    parser = argparse.ArgumentParser(description="Monitor Claude Flow benchmarks in real-time")
    parser.add_argument("task", help="Task to benchmark")
    parser.add_argument("--strategy", default="auto", help="Execution strategy")
    parser.add_argument("--max-workers", type=int, default=3, help="Maximum workers")
    parser.add_argument("--output-dir", default="reports", help="Output directory")
    
    args = parser.parse_args()
    
    monitor = RealtimeMonitor(Path(args.output_dir))
    monitor.start_benchmark_with_monitoring(
        args.task,
        args.strategy,
        args.max_workers
    )

if __name__ == "__main__":
    main()