#!/usr/bin/env python3
"""
SWE-Bench Configuration Matrix Runner
Tests multiple configurations to find the optimal setup
"""

import asyncio
import json
import time
from datetime import datetime
from pathlib import Path
import subprocess
import sys

# Add src to path
sys.path.insert(0, str(Path(__file__).parent.parent / "src"))

from swarm_benchmark.swe_bench import SWEBenchEngine
from swarm_benchmark.core.models import BenchmarkConfig, StrategyType, CoordinationMode


class BenchmarkMatrix:
    """Run benchmarks across multiple configurations."""
    
    def __init__(self, issue_number=610):
        self.issue_number = issue_number
        self.results = []
        self.start_time = time.time()
        
    async def run_configuration(self, mode, strategy, agents, categories=None):
        """Run a single configuration test."""
        config_name = f"{mode}-{strategy}-{agents}agents"
        print(f"\n{'='*60}")
        print(f"🔬 Testing: {config_name}")
        print(f"{'='*60}")
        
        # Create configuration
        config = BenchmarkConfig(
            name=f"SWE-{config_name}",
            description=f"SWE-Bench: {mode} mode, {strategy} strategy, {agents} agents",
            strategy=StrategyType[strategy.upper()],
            mode=CoordinationMode[mode.upper()],
            max_agents=agents,
            task_timeout=60,  # Reduced for testing
            output_directory=f"benchmark/swe-bench/reports/{config_name}"
        )
        
        # Initialize engine
        engine = SWEBenchEngine(config)
        
        # Run benchmark (single iteration for speed)
        try:
            result = await engine.run_swe_benchmark(
                categories=categories,
                difficulty="easy",  # Start with easy for testing
                optimize=False,
                iterations=1
            )
            
            # Extract key metrics
            summary = result.get('summary', {})
            final_perf = summary.get('final_performance', {})
            
            config_result = {
                'config': config_name,
                'mode': mode,
                'strategy': strategy,
                'agents': agents,
                'success_rate': final_perf.get('success_rate', 0),
                'avg_duration': final_perf.get('average_duration', 0),
                'total_tasks': final_perf.get('total_tasks', 0),
                'successful_tasks': final_perf.get('successful_tasks', 0),
                'timestamp': datetime.now().isoformat()
            }
            
            self.results.append(config_result)
            
            # Update GitHub issue
            await self.update_github_issue(config_result)
            
            return config_result
            
        except Exception as e:
            print(f"❌ Error testing {config_name}: {e}")
            return None
            
    async def update_github_issue(self, result):
        """Post update to GitHub issue."""
        comment = f"""## 📊 Configuration Test Result

**Config**: `{result['config']}`
- Mode: {result['mode']}
- Strategy: {result['strategy']}
- Agents: {result['agents']}

**Performance**:
- ✅ Success Rate: **{result['success_rate']:.1%}**
- ⏱️ Avg Duration: **{result['avg_duration']:.2f}s**
- 📝 Tasks: {result['successful_tasks']}/{result['total_tasks']}

---"""
        
        # Save to file (would normally post to GitHub)
        comment_file = Path(f"benchmark/swe-bench/comments/result_{result['config']}.md")
        comment_file.parent.mkdir(parents=True, exist_ok=True)
        comment_file.write_text(comment)
        
        # Post to GitHub
        try:
            cmd = f'gh issue comment {self.issue_number} --body "{comment}"'
            subprocess.run(cmd, shell=True, capture_output=True, text=True)
            print(f"✅ Updated issue #{self.issue_number}")
        except:
            print(f"⚠️ Could not update issue (saved to {comment_file})")
            
    async def run_matrix(self):
        """Run the full configuration matrix."""
        print("""
╔══════════════════════════════════════════════════════════════╗
║           SWE-Bench Configuration Matrix Runner               ║
║                  Finding Optimal Configuration                ║
╚══════════════════════════════════════════════════════════════╝
""")
        
        # Test configurations (reduced for demo)
        test_configs = [
            # Baseline
            ('hierarchical', 'development', 5),
            
            # Vary modes
            ('mesh', 'development', 5),
            ('distributed', 'development', 5),
            
            # Vary strategies
            ('hierarchical', 'optimization', 5),
            ('hierarchical', 'testing', 5),
            
            # Vary agent counts
            ('hierarchical', 'development', 3),
            ('hierarchical', 'development', 8),
            
            # Best combinations
            ('mesh', 'optimization', 8),
            ('distributed', 'testing', 3),
        ]
        
        # Run each configuration
        for mode, strategy, agents in test_configs:
            result = await self.run_configuration(
                mode, strategy, agents,
                categories=['code_generation', 'bug_fix']  # Limited for testing
            )
            
            if result:
                print(f"✅ Completed: {result['config']}")
                print(f"   Success Rate: {result['success_rate']:.1%}")
                
        # Find optimal configuration
        await self.analyze_results()
        
    async def analyze_results(self):
        """Analyze results and find optimal configuration."""
        if not self.results:
            print("No results to analyze")
            return
            
        print(f"\n{'='*60}")
        print("📊 ANALYSIS RESULTS")
        print(f"{'='*60}\n")
        
        # Sort by success rate
        by_success = sorted(self.results, key=lambda x: x['success_rate'], reverse=True)
        
        # Sort by speed
        by_speed = sorted(self.results, key=lambda x: x['avg_duration'])
        
        # Combined score (70% success, 30% speed)
        for r in self.results:
            r['combined_score'] = (r['success_rate'] * 0.7) + ((1 - r['avg_duration']/30) * 0.3)
        by_combined = sorted(self.results, key=lambda x: x['combined_score'], reverse=True)
        
        # Print rankings
        print("🏆 TOP CONFIGURATIONS BY SUCCESS RATE:")
        for i, r in enumerate(by_success[:3], 1):
            print(f"{i}. {r['config']}: {r['success_rate']:.1%}")
            
        print("\n⚡ TOP CONFIGURATIONS BY SPEED:")
        for i, r in enumerate(by_speed[:3], 1):
            print(f"{i}. {r['config']}: {r['avg_duration']:.2f}s")
            
        print("\n🎯 OPTIMAL CONFIGURATION (Combined Score):")
        optimal = by_combined[0]
        print(f"Winner: {optimal['config']}")
        print(f"  - Success Rate: {optimal['success_rate']:.1%}")
        print(f"  - Avg Duration: {optimal['avg_duration']:.2f}s")
        print(f"  - Combined Score: {optimal['combined_score']:.3f}")
        
        # Save full report
        report = {
            'test_matrix': self.results,
            'optimal_config': optimal,
            'rankings': {
                'by_success': [r['config'] for r in by_success],
                'by_speed': [r['config'] for r in by_speed],
                'by_combined': [r['config'] for r in by_combined]
            },
            'test_duration': time.time() - self.start_time,
            'timestamp': datetime.now().isoformat()
        }
        
        report_path = Path("benchmark/swe-bench/reports/matrix_analysis.json")
        report_path.parent.mkdir(parents=True, exist_ok=True)
        with open(report_path, 'w') as f:
            json.dump(report, f, indent=2)
            
        print(f"\n📁 Full report saved to: {report_path}")
        
        # Update GitHub issue with final results
        await self.post_final_results(optimal, by_combined[:3])
        
    async def post_final_results(self, optimal, top3):
        """Post final analysis to GitHub issue."""
        comment = f"""## 🎉 Benchmark Matrix Complete!

### 🏆 **OPTIMAL CONFIGURATION FOUND**

**Winner**: `{optimal['config']}`
- ✅ Success Rate: **{optimal['success_rate']:.1%}**
- ⚡ Avg Duration: **{optimal['avg_duration']:.2f}s**
- 🎯 Combined Score: **{optimal['combined_score']:.3f}**

### 📊 Top 3 Configurations

| Rank | Configuration | Success Rate | Avg Duration | Score |
|------|--------------|--------------|--------------|-------|
"""
        
        for i, r in enumerate(top3, 1):
            comment += f"| {i} | {r['config']} | {r['success_rate']:.1%} | {r['avg_duration']:.2f}s | {r['combined_score']:.3f} |\n"
            
        comment += f"""

### 🔧 Recommended Settings

Based on the analysis, the optimal Claude Flow configuration for SWE tasks is:

```yaml
mode: {optimal['mode']}
strategy: {optimal['strategy']}
max_agents: {optimal['agents']}
```

### 📈 Performance vs Targets

| Metric | Target | Achieved | Status |
|--------|--------|----------|--------|
| Success Rate | 80% | {optimal['success_rate']:.1%} | {'✅' if optimal['success_rate'] >= 0.8 else '⚠️'} |
| Avg Duration | 15s | {optimal['avg_duration']:.2f}s | {'✅' if optimal['avg_duration'] <= 15 else '⚠️'} |

---
*Test completed in {time.time() - self.start_time:.1f} seconds*"""
        
        # Save and post
        final_comment = Path("benchmark/swe-bench/comments/final_results.md")
        final_comment.parent.mkdir(parents=True, exist_ok=True)
        final_comment.write_text(comment)
        
        try:
            # Post to GitHub
            subprocess.run(
                f'gh issue comment {self.issue_number} --body-file {final_comment}',
                shell=True, capture_output=True, text=True
            )
            print(f"✅ Posted final results to issue #{self.issue_number}")
        except:
            print(f"⚠️ Saved final results to {final_comment}")


async def main():
    """Run the benchmark matrix."""
    matrix = BenchmarkMatrix(issue_number=610)
    await matrix.run_matrix()


if __name__ == "__main__":
    asyncio.run(main())