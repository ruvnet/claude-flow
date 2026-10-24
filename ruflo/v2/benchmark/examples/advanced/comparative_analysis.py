#!/usr/bin/env python3
"""
Advanced comparative analysis between different coordination strategies and methodologies.

This example demonstrates:
- Multi-strategy comparison
- Statistical analysis of performance
- Coordination pattern effectiveness
- Methodology benchmarking (Swarm vs Hive-Mind vs SPARC)
"""

import subprocess
import sys
import json
import time
import statistics
from pathlib import Path
from dataclasses import dataclass
from typing import List, Dict, Any, Optional, Tuple
from collections import defaultdict
import itertools

@dataclass
class ComparisonConfig:
    """Configuration for comparative analysis."""
    methodology: str  # 'swarm', 'hive-mind', 'sparc'
    strategy: str
    coordination: str
    agents: int
    task_complexity: str  # 'simple', 'medium', 'complex'

@dataclass
class ComparisonResult:
    """Result from a comparative benchmark."""
    config: ComparisonConfig
    execution_time: float
    success: bool
    quality_score: float
    token_consumption: int
    resource_utilization: Dict[str, float]
    metrics: Dict[str, Any]
    error: Optional[str] = None

class ComparativeAnalysisEngine:
    """Engine for running comparative analysis across methodologies."""
    
    def __init__(self):
        self.results: List[ComparisonResult] = []
        self.task_definitions = {
            "simple": "Create a hello world function with basic error handling",
            "medium": "Build a REST API with authentication and basic CRUD operations", 
            "complex": "Design and implement a distributed microservices architecture with monitoring"
        }
    
    def generate_comparison_matrix(self) -> List[ComparisonConfig]:
        """Generate comprehensive comparison matrix."""
        methodologies = ["swarm", "hive-mind", "sparc"]
        
        # Strategy mappings for each methodology
        strategy_mappings = {
            "swarm": ["development", "optimization", "research", "analysis"],
            "hive-mind": ["collective", "consensus", "distributed", "adaptive"],
            "sparc": ["tdd", "specification", "architecture", "refinement"]
        }
        
        coordination_mappings = {
            "swarm": ["hierarchical", "mesh", "ring", "star"],
            "hive-mind": ["collective", "mesh", "distributed", "consensus"],
            "sparc": ["hierarchical", "sequential", "parallel", "adaptive"]
        }
        
        agent_counts = [3, 5, 7]
        task_complexities = ["simple", "medium", "complex"]
        
        configs = []
        
        for methodology in methodologies:
            strategies = strategy_mappings[methodology]
            coordinations = coordination_mappings[methodology]
            
            # Create balanced combinations
            for strategy, coordination, agents, complexity in itertools.product(
                strategies[:2],  # Limit to 2 strategies per methodology
                coordinations[:2],  # Limit to 2 coordination modes
                agent_counts[:2],  # Limit to 2 agent counts  
                task_complexities
            ):
                configs.append(ComparisonConfig(
                    methodology=methodology,
                    strategy=strategy,
                    coordination=coordination,
                    agents=agents,
                    task_complexity=complexity
                ))
        
        return configs
    
    def execute_comparison_benchmark(self, config: ComparisonConfig) -> ComparisonResult:
        """Execute a single comparison benchmark."""
        print(f"📊 Running: {config.methodology}-{config.strategy}-{config.coordination} ({config.agents} agents, {config.task_complexity})")
        
        start_time = time.time()
        task = self.task_definitions[config.task_complexity]
        
        try:
            # Build command based on methodology
            cmd = self._build_methodology_command(config, task)
            
            # Execute benchmark
            result = subprocess.run(
                cmd,
                capture_output=True,
                text=True,
                timeout=180,  # 3 minute timeout for complex tasks
                cwd="/workspaces/claude-code-flow/benchmark"
            )
            
            execution_time = time.time() - start_time
            
            if result.returncode == 0:
                # Parse and analyze output
                metrics = self._parse_comparison_output(result.stdout)
                quality_score = self._calculate_quality_score(result.stdout, config)
                token_consumption = self._estimate_token_consumption(result.stdout)
                resource_util = self._estimate_resource_utilization(execution_time, config)
                
                return ComparisonResult(
                    config=config,
                    execution_time=execution_time,
                    success=True,
                    quality_score=quality_score,
                    token_consumption=token_consumption,
                    resource_utilization=resource_util,
                    metrics=metrics
                )
            else:
                return ComparisonResult(
                    config=config,
                    execution_time=execution_time,
                    success=False,
                    quality_score=0.0,
                    token_consumption=0,
                    resource_utilization={},
                    metrics={},
                    error=result.stderr
                )
                
        except subprocess.TimeoutExpired:
            return ComparisonResult(
                config=config,
                execution_time=180.0,
                success=False,
                quality_score=0.0,
                token_consumption=0,
                resource_utilization={},
                metrics={},
                error="Timeout exceeded"
            )
        except Exception as e:
            return ComparisonResult(
                config=config,
                execution_time=time.time() - start_time,
                success=False,
                quality_score=0.0,
                token_consumption=0,
                resource_utilization={},
                metrics={},
                error=str(e)
            )
    
    def _build_methodology_command(self, config: ComparisonConfig, task: str) -> List[str]:
        """Build command specific to methodology."""
        base_cmd = ["swarm-benchmark", "real"]
        
        if config.methodology == "swarm":
            cmd = base_cmd + [
                "swarm", task,
                "--strategy", config.strategy,
                "--coordination", config.coordination,
                "--max-agents", str(config.agents)
            ]
        elif config.methodology == "hive-mind":
            cmd = base_cmd + [
                "hive-mind", task,
                "--thinking-pattern", config.strategy,
                "--coordination", config.coordination,
                "--agents", str(config.agents)
            ]
        elif config.methodology == "sparc":
            cmd = base_cmd + [
                "sparc", task,
                "--mode", config.strategy,
                "--coordination", config.coordination,
                "--agents", str(config.agents)
            ]
        else:
            # Fallback to swarm
            cmd = base_cmd + [
                "swarm", task,
                "--strategy", "auto",
                "--max-agents", str(config.agents)
            ]
        
        return cmd
    
    def _parse_comparison_output(self, output: str) -> Dict[str, Any]:
        """Parse output for comparison metrics."""
        # Try JSON parsing first
        try:
            lines = output.strip().split('\n')
            for line in lines:
                if line.strip().startswith('{'):
                    return json.loads(line.strip())
        except:
            pass
        
        # Fallback analysis
        return {
            "output_length": len(output),
            "line_count": len(output.split('\n')),
            "success_markers": output.count("✅"),
            "warning_markers": output.count("⚠️"),
            "error_markers": output.count("❌"),
            "completion_indicators": output.count("Complete") + output.count("Finished"),
            "code_blocks": output.count("```"),
            "bullet_points": output.count("•") + output.count("-"),
        }
    
    def _calculate_quality_score(self, output: str, config: ComparisonConfig) -> float:
        """Calculate quality score based on output analysis."""
        base_score = 50.0  # Baseline
        
        # Success indicators
        success_count = output.count("✅")
        completion_count = output.count("Complete") + output.count("Finished")
        base_score += (success_count * 5) + (completion_count * 3)
        
        # Error penalties
        error_count = output.count("❌")
        warning_count = output.count("⚠️")
        base_score -= (error_count * 10) + (warning_count * 3)
        
        # Complexity bonuses
        complexity_multiplier = {"simple": 1.0, "medium": 1.2, "complex": 1.5}
        base_score *= complexity_multiplier.get(config.task_complexity, 1.0)
        
        # Methodology-specific adjustments
        if config.methodology == "sparc":
            # SPARC typically produces more structured output
            structure_indicators = output.count("Specification") + output.count("Architecture")
            base_score += structure_indicators * 2
        elif config.methodology == "hive-mind":
            # Hive-mind should show consensus
            consensus_indicators = output.count("consensus") + output.count("collective")
            base_score += consensus_indicators * 3
        
        return max(0.0, min(100.0, base_score))
    
    def _estimate_token_consumption(self, output: str) -> int:
        """Estimate token consumption from output."""
        # Rough estimation: 1 token ≈ 0.75 words
        word_count = len(output.split())
        return int(word_count * 1.33)  # Conservative estimate
    
    def _estimate_resource_utilization(self, execution_time: float, config: ComparisonConfig) -> Dict[str, float]:
        """Estimate resource utilization patterns."""
        # Model-based estimation
        base_cpu = 30.0  # Base CPU %
        base_memory = 100.0  # Base memory MB
        
        # Agent scaling
        agent_multiplier = 1.0 + (config.agents - 1) * 0.15
        
        # Methodology scaling
        methodology_multipliers = {
            "swarm": {"cpu": 1.0, "memory": 1.0},
            "hive-mind": {"cpu": 1.3, "memory": 1.2},  # More intensive
            "sparc": {"cpu": 0.9, "memory": 1.1}  # More structured
        }
        
        multipliers = methodology_multipliers.get(config.methodology, {"cpu": 1.0, "memory": 1.0})
        
        # Complexity scaling
        complexity_multipliers = {"simple": 1.0, "medium": 1.5, "complex": 2.2}
        complexity_mult = complexity_multipliers.get(config.task_complexity, 1.0)
        
        estimated_cpu = base_cpu * agent_multiplier * multipliers["cpu"] * complexity_mult
        estimated_memory = base_memory * agent_multiplier * multipliers["memory"] * complexity_mult
        
        return {
            "cpu_percent": min(100.0, estimated_cpu),
            "memory_mb": estimated_memory,
            "efficiency_score": max(0.0, 100.0 - (execution_time / 120.0) * 50)  # Efficiency based on time
        }
    
    def run_comparative_analysis(self) -> Dict[str, Any]:
        """Run complete comparative analysis."""
        print("📊 Starting Comparative Analysis")
        print("=" * 45)
        
        configs = self.generate_comparison_matrix()
        print(f"🔍 Generated {len(configs)} comparison configurations")
        
        results = []
        successful_results = []
        
        for i, config in enumerate(configs[:12], 1):  # Limit to 12 for demo
            print(f"\n[{i}/12] ", end="")
            result = self.execute_comparison_benchmark(config)
            results.append(result)
            
            if result.success:
                successful_results.append(result)
                status = "✅"
            else:
                status = "❌"
            
            print(f"{status} {result.execution_time:.1f}s (Quality: {result.quality_score:.1f})")
        
        self.results = results
        
        # Perform statistical analysis
        statistical_analysis = self._perform_statistical_analysis(successful_results)
        
        # Generate comparative insights
        comparative_insights = self._generate_comparative_insights(successful_results)
        
        # Performance rankings
        performance_rankings = self._calculate_performance_rankings(successful_results)
        
        return {
            "total_comparisons": len(results),
            "successful_comparisons": len(successful_results),
            "success_rate": len(successful_results) / len(results) if results else 0,
            "statistical_analysis": statistical_analysis,
            "comparative_insights": comparative_insights,
            "performance_rankings": performance_rankings,
            "raw_results": [self._serialize_result(r) for r in results]
        }
    
    def _perform_statistical_analysis(self, results: List[ComparisonResult]) -> Dict[str, Any]:
        """Perform statistical analysis on results."""
        if not results:
            return {}
        
        # Group by methodology
        by_methodology = defaultdict(list)
        for result in results:
            by_methodology[result.config.methodology].append(result)
        
        methodology_stats = {}
        for methodology, method_results in by_methodology.items():
            execution_times = [r.execution_time for r in method_results]
            quality_scores = [r.quality_score for r in method_results]
            token_consumptions = [r.token_consumption for r in method_results]
            
            methodology_stats[methodology] = {
                "count": len(method_results),
                "execution_time": {
                    "mean": statistics.mean(execution_times),
                    "median": statistics.median(execution_times),
                    "stdev": statistics.stdev(execution_times) if len(execution_times) > 1 else 0,
                    "min": min(execution_times),
                    "max": max(execution_times)
                },
                "quality_score": {
                    "mean": statistics.mean(quality_scores),
                    "median": statistics.median(quality_scores),
                    "stdev": statistics.stdev(quality_scores) if len(quality_scores) > 1 else 0,
                    "min": min(quality_scores),
                    "max": max(quality_scores)
                },
                "token_consumption": {
                    "mean": statistics.mean(token_consumptions),
                    "median": statistics.median(token_consumptions),
                    "total": sum(token_consumptions)
                }
            }
        
        return methodology_stats
    
    def _generate_comparative_insights(self, results: List[ComparisonResult]) -> List[str]:
        """Generate insights from comparative analysis."""
        insights = []
        
        if not results:
            return ["No successful results to analyze"]
        
        # Methodology comparison
        by_methodology = defaultdict(list)
        for result in results:
            by_methodology[result.config.methodology].append(result)
        
        if len(by_methodology) > 1:
            avg_times = {}
            avg_quality = {}
            
            for methodology, method_results in by_methodology.items():
                avg_times[methodology] = statistics.mean([r.execution_time for r in method_results])
                avg_quality[methodology] = statistics.mean([r.quality_score for r in method_results])
            
            fastest_method = min(avg_times.items(), key=lambda x: x[1])
            highest_quality = max(avg_quality.items(), key=lambda x: x[1])
            
            insights.append(f"Fastest methodology: {fastest_method[0]} ({fastest_method[1]:.1f}s avg)")
            insights.append(f"Highest quality: {highest_quality[0]} ({highest_quality[1]:.1f} avg score)")
        
        # Coordination analysis
        by_coordination = defaultdict(list)
        for result in results:
            by_coordination[result.config.coordination].append(result)
        
        if len(by_coordination) > 1:
            coord_performance = {}
            for coordination, coord_results in by_coordination.items():
                avg_time = statistics.mean([r.execution_time for r in coord_results])
                avg_quality = statistics.mean([r.quality_score for r in coord_results])
                coord_performance[coordination] = (avg_time + (100 - avg_quality)) / 2  # Combined score
            
            best_coordination = min(coord_performance.items(), key=lambda x: x[1])
            insights.append(f"Most effective coordination: {best_coordination[0]}")
        
        # Complexity scaling
        by_complexity = defaultdict(list)
        for result in results:
            by_complexity[result.config.task_complexity].append(result)
        
        if len(by_complexity) > 1:
            complexity_scaling = {}
            for complexity, comp_results in by_complexity.items():
                avg_time = statistics.mean([r.execution_time for r in comp_results])
                complexity_scaling[complexity] = avg_time
            
            if "simple" in complexity_scaling and "complex" in complexity_scaling:
                scaling_factor = complexity_scaling["complex"] / complexity_scaling["simple"]
                insights.append(f"Complexity scaling factor: {scaling_factor:.1f}x (simple to complex)")
        
        # Agent scaling insights
        agent_groups = defaultdict(list)
        for result in results:
            agent_groups[result.config.agents].append(result)
        
        if len(agent_groups) > 1:
            agent_efficiency = {}
            for agent_count, agent_results in agent_groups.items():
                avg_time = statistics.mean([r.execution_time for r in agent_results])
                agent_efficiency[agent_count] = avg_time / agent_count  # Time per agent
            
            most_efficient = min(agent_efficiency.items(), key=lambda x: x[1])
            insights.append(f"Most efficient agent count: {most_efficient[0]} agents")
        
        return insights
    
    def _calculate_performance_rankings(self, results: List[ComparisonResult]) -> Dict[str, List[Dict[str, Any]]]:
        """Calculate performance rankings across different metrics."""
        if not results:
            return {}
        
        rankings = {
            "fastest_execution": sorted(results, key=lambda r: r.execution_time)[:5],
            "highest_quality": sorted(results, key=lambda r: r.quality_score, reverse=True)[:5],
            "most_efficient_tokens": sorted(results, key=lambda r: r.token_consumption)[:5],
            "best_overall": sorted(results, key=lambda r: (r.quality_score / max(r.execution_time, 1)), reverse=True)[:5]
        }
        
        serialized_rankings = {}
        for category, ranked_results in rankings.items():
            serialized_rankings[category] = [
                {
                    "methodology": r.config.methodology,
                    "strategy": r.config.strategy,
                    "coordination": r.config.coordination,
                    "agents": r.config.agents,
                    "complexity": r.config.task_complexity,
                    "execution_time": r.execution_time,
                    "quality_score": r.quality_score,
                    "token_consumption": r.token_consumption
                }
                for r in ranked_results
            ]
        
        return serialized_rankings
    
    def _serialize_result(self, result: ComparisonResult) -> Dict[str, Any]:
        """Serialize result for JSON storage."""
        return {
            "config": {
                "methodology": result.config.methodology,
                "strategy": result.config.strategy,
                "coordination": result.config.coordination,
                "agents": result.config.agents,
                "task_complexity": result.config.task_complexity
            },
            "execution_time": result.execution_time,
            "success": result.success,
            "quality_score": result.quality_score,
            "token_consumption": result.token_consumption,
            "resource_utilization": result.resource_utilization,
            "metrics": result.metrics,
            "error": result.error
        }

def save_comparative_analysis(analysis_results: Dict[str, Any]):
    """Save comparative analysis results."""
    output_dir = Path("/workspaces/claude-code-flow/benchmark/examples/output")
    output_dir.mkdir(exist_ok=True)
    
    # Save complete analysis
    with open(output_dir / "comparative_analysis_results.json", "w") as f:
        json.dump(analysis_results, f, indent=2)
    
    # Save statistical summary
    stats = analysis_results.get("statistical_analysis", {})
    with open(output_dir / "comparative_statistics.json", "w") as f:
        json.dump(stats, f, indent=2)
    
    # Save performance rankings
    rankings = analysis_results.get("performance_rankings", {})
    with open(output_dir / "performance_rankings.json", "w") as f:
        json.dump(rankings, f, indent=2)
    
    print(f"📁 Comparative analysis saved to: {output_dir}")

if __name__ == "__main__":
    print("📊 Advanced Comparative Analysis")
    print("=" * 50)
    
    # Run comparative analysis
    engine = ComparativeAnalysisEngine()
    results = engine.run_comparative_analysis()
    
    # Display key findings
    print(f"\n📈 Analysis Results")
    print("=" * 25)
    print(f"Total comparisons: {results['total_comparisons']}")
    print(f"Success rate: {results['success_rate']:.1%}")
    
    # Show insights
    insights = results.get("comparative_insights", [])
    if insights:
        print(f"\n💡 Key Insights:")
        for insight in insights[:5]:
            print(f"  • {insight}")
    
    # Show top performers
    rankings = results.get("performance_rankings", {})
    if "best_overall" in rankings and rankings["best_overall"]:
        best = rankings["best_overall"][0]
        print(f"\n🏆 Best Overall Performer:")
        print(f"   {best['methodology']} with {best['strategy']} strategy")
        print(f"   Quality: {best['quality_score']:.1f}, Time: {best['execution_time']:.1f}s")
        print(f"   Coordination: {best['coordination']}, Agents: {best['agents']}")
    
    # Statistical summary
    stats = results.get("statistical_analysis", {})
    if stats:
        print(f"\n📊 Methodology Performance Summary:")
        for methodology, method_stats in stats.items():
            avg_time = method_stats.get("execution_time", {}).get("mean", 0)
            avg_quality = method_stats.get("quality_score", {}).get("mean", 0)
            print(f"   {methodology}: {avg_time:.1f}s avg, {avg_quality:.1f} quality")
    
    # Save results
    save_comparative_analysis(results)
    
    print(f"\n🎉 Comparative Analysis Complete!")
    print("Analysis provides insights on:")
    print("- Methodology effectiveness comparison")
    print("- Coordination pattern performance")
    print("- Agent scaling characteristics")
    print("- Task complexity impact")
    print("- Optimization recommendations")