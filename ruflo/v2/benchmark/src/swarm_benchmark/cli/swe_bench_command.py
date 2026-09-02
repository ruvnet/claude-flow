"""SWE-Bench CLI command integration."""

import click
import asyncio
import json
from pathlib import Path
from typing import Optional

import time
from ..swe_bench import SWEBenchEngine
from ..swe_bench.official_integration import OfficialSWEBenchEngine
from ..swe_bench.multi_mode_engine import MultiModeSWEBenchEngine, ClaudeFlowMode
from ..core.models import BenchmarkConfig, StrategyType, CoordinationMode


@click.group()
@click.pass_context
def swe_bench(ctx):
    """Run SWE-Bench software engineering benchmarks."""
    ctx.ensure_object(dict)


@swe_bench.command()
@click.option('--categories', '-c', multiple=True, help='Categories to test')
@click.option('--difficulty', '-d', type=click.Choice(['easy', 'medium', 'hard']), help='Difficulty level')
@click.option('--strategy', '-s', type=click.Choice(['development', 'optimization', 'testing', 'analysis']), 
              default='development', help='Execution strategy')
@click.option('--mode', '-m', type=click.Choice(['hierarchical', 'mesh', 'distributed', 'centralized']),
              default='hierarchical', help='Coordination mode')
@click.option('--agents', '-a', type=int, default=5, help='Maximum number of agents')
@click.option('--optimize', '-o', is_flag=True, help='Enable optimization iterations')
@click.option('--iterations', '-i', type=int, default=1, help='Number of iterations')
@click.option('--output', '-o', type=click.Path(), help='Output directory for reports')
@click.pass_context
def run(ctx, categories, difficulty, strategy, mode, agents, optimize, iterations, output):
    """Run SWE-Bench benchmark suite."""
    
    # Create configuration
    config = BenchmarkConfig(
        name="SWE-Bench",
        description="Software Engineering Benchmark",
        strategy=StrategyType[strategy.upper()],
        mode=CoordinationMode[mode.upper()],
        max_agents=agents,
        output_directory=output or "benchmark/swe-bench/reports"
    )
    
    # Initialize engine
    engine = SWEBenchEngine(config)
    
    # Convert categories tuple to list
    category_list = list(categories) if categories else None
    
    # Run benchmark
    click.echo(f"\n🚀 Starting SWE-Bench with {iterations} iteration(s)")
    click.echo(f"   Strategy: {strategy}, Mode: {mode}, Agents: {agents}")
    
    if category_list:
        click.echo(f"   Categories: {', '.join(category_list)}")
    if difficulty:
        click.echo(f"   Difficulty: {difficulty}")
        
    results = asyncio.run(engine.run_swe_benchmark(
        categories=category_list,
        difficulty=difficulty,
        optimize=optimize,
        iterations=iterations
    ))
    
    # Display summary
    summary = results.get('summary', {})
    final_perf = summary.get('final_performance', {})
    
    click.echo("\n📊 SWE-Bench Results:")
    click.echo(f"   Success Rate: {final_perf.get('success_rate', 0):.1%}")
    click.echo(f"   Average Duration: {final_perf.get('average_duration', 0):.2f}s")
    click.echo(f"   Total Tasks: {final_perf.get('total_tasks', 0)}")
    
    if optimize and summary.get('improvement'):
        imp = summary['improvement']
        click.echo(f"\n📈 Optimization Impact:")
        click.echo(f"   Success Rate Change: {imp.get('success_rate_change', 0):+.1%}")
        click.echo(f"   Duration Change: {imp.get('duration_change', 0):+.2f}s")
        
    click.echo(f"\n✅ Report saved to {config.output_directory}")


@swe_bench.command()
@click.option('--output', '-o', type=click.Path(), help='Output directory')
@click.pass_context
def status(ctx, output):
    """Show current SWE-Bench status and recent results."""
    
    output_dir = Path(output or "benchmark/swe-bench/reports")
    
    if not output_dir.exists():
        click.echo("No SWE-Bench results found.")
        return
        
    # Find most recent report
    reports = list(output_dir.glob("swe_bench_report_*.json"))
    
    if not reports:
        click.echo("No SWE-Bench reports found.")
        return
        
    latest = max(reports, key=lambda p: p.stat().st_mtime)
    
    with open(latest) as f:
        data = json.load(f)
        
    click.echo(f"\n📊 Latest SWE-Bench Results ({latest.name}):")
    click.echo(f"   Timestamp: {data.get('timestamp', 'Unknown')}")
    
    summary = data.get('summary', {})
    final_perf = summary.get('final_performance', {})
    
    click.echo(f"\n   Performance:")
    click.echo(f"   - Success Rate: {final_perf.get('success_rate', 0):.1%}")
    click.echo(f"   - Tasks Completed: {final_perf.get('successful_tasks', 0)}/{final_perf.get('total_tasks', 0)}")
    click.echo(f"   - Average Duration: {final_perf.get('average_duration', 0):.2f}s")
    
    if summary.get('improvement'):
        imp = summary['improvement']
        click.echo(f"\n   Optimization Results:")
        click.echo(f"   - Success Rate Improved: {imp.get('success_rate_change', 0):+.1%}")
        click.echo(f"   - Speed Change: {imp.get('duration_change', 0):+.2f}s")
        click.echo(f"   - Optimization Effective: {'✅' if imp.get('optimization_effective') else '❌'}")


@swe_bench.command('official')
@click.option('--lite', is_flag=True, default=True, help='Use SWE-bench-Lite (300 instances)')
@click.option('--limit', '-l', type=int, help='Limit number of instances to evaluate')
@click.option('--mode', '-m', type=click.Choice(['hierarchical', 'mesh', 'distributed', 'centralized']),
              default='mesh', help='Coordination mode (default: mesh - optimal)')
@click.option('--strategy', '-s', type=click.Choice(['development', 'optimization', 'testing', 'analysis']),
              default='optimization', help='Strategy (default: optimization - optimal)')
@click.option('--agents', '-a', type=int, default=8, help='Number of agents (default: 8 - optimal)')
@click.option('--output', '-o', type=click.Path(), help='Output directory')
@click.option('--validate', is_flag=True, help='Validate submission format only')
@click.pass_context
def official(ctx, lite, limit, mode, strategy, agents, output, validate):
    """Run OFFICIAL SWE-bench evaluation with real dataset.
    
    This command uses the official SWE-bench dataset from Princeton
    and generates predictions suitable for leaderboard submission.
    
    Examples:
        # Run on first 10 instances of SWE-bench-Lite
        swarm-bench swe-bench official --limit 10
        
        # Run full SWE-bench-Lite (300 instances)
        swarm-bench swe-bench official
        
        # Validate existing predictions
        swarm-bench swe-bench official --validate --output predictions.json
    """
    
    # Create configuration with optimal settings
    config = BenchmarkConfig(
        name="Official-SWE-bench",
        description="Official SWE-bench evaluation",
        strategy=StrategyType[strategy.upper()],
        mode=CoordinationMode[mode.upper()],
        max_agents=agents,
        output_directory=output or "benchmark/swe-bench-official/results"
    )
    
    # Initialize official engine
    engine = OfficialSWEBenchEngine(config)
    
    if validate:
        # Just validate existing predictions
        predictions_file = output or "benchmark/swe-bench-official/results/predictions.json"
        click.echo(f"\n📋 Validating: {predictions_file}")
        
        is_valid = asyncio.run(engine.validate_submission(predictions_file))
        
        if is_valid:
            click.echo("✅ Submission is valid and ready for upload!")
            click.echo("\nTo submit to leaderboard:")
            click.echo("1. Visit: https://www.swebench.com/submit")
            click.echo(f"2. Upload: {predictions_file}")
        else:
            click.echo("❌ Submission has validation errors")
        return
    
    # Run evaluation
    click.echo(f"""
╔══════════════════════════════════════════════════════════════╗
║            Official SWE-bench Evaluation                      ║
║                                                                ║
║  Dataset: {'SWE-bench-Lite (300)' if lite else 'SWE-bench Full (2,294)'}{'                  ' if lite else '          '}║
║  Mode: {mode:<20}                            ║
║  Strategy: {strategy:<20}                        ║
║  Agents: {agents:<20}                          ║
╚══════════════════════════════════════════════════════════════╝
""")
    
    if limit:
        click.echo(f"⚠️ Limited to first {limit} instances for testing")
    
    click.confirm("Ready to start official evaluation?", abort=True)
    
    # Run the evaluation
    results = asyncio.run(engine.run_evaluation(
        instances_limit=limit,
        use_lite=lite,
        save_predictions=True
    ))
    
    # Display results
    if "error" not in results:
        click.echo(f"\n✅ Evaluation Complete!")
        click.echo(f"   Success Rate: {results['success_rate']:.1%}")
        click.echo(f"   Instances: {results['instances_evaluated']}")
        click.echo(f"   Avg Duration: {results['average_duration']:.1f}s")
        
        predictions_file = Path(config.output_directory) / "predictions.json"
        click.echo(f"\n📤 Predictions ready for submission: {predictions_file}")
        click.echo("\nNext steps:")
        click.echo("1. Review predictions.json")
        click.echo("2. Run validation: swarm-bench swe-bench official --validate")
        click.echo("3. Submit to: https://www.swebench.com/submit")
    else:
        click.echo(f"❌ Evaluation failed: {results['error']}")


@swe_bench.command('multi-mode')
@click.option('--instances', '-i', type=int, default=1, help='Number of instances to test per mode')
@click.option('--lite', is_flag=True, default=True, help='Use SWE-bench-Lite dataset')
@click.option('--quick', is_flag=True, help='Quick test with fewer configurations')
@click.option('--output', '-o', type=click.Path(), help='Output directory')
@click.pass_context
def multi_mode(ctx, instances, lite, quick, output):
    """Test ALL claude-flow non-interactive modes on SWE-bench.
    
    This command benchmarks all available claude-flow execution modes:
    - Swarm: Multiple strategies (auto, research, development, optimization, etc.)
    - SPARC: All subcommands (coder, architect, tdd, reviewer, etc.)
    - Hive-Mind: Various configurations (different worker counts, queen types)
    
    Examples:
        # Quick test with 1 instance across all modes
        swarm-bench swe-bench multi-mode --instances 1 --quick
        
        # Full test with 5 instances per mode
        swarm-bench swe-bench multi-mode --instances 5
        
        # Test specific modes only
        swarm-bench swe-bench multi-mode --instances 2
    """
    
    click.echo("""
╔══════════════════════════════════════════════════════════════╗
║         Multi-Mode SWE-Bench Evaluation                       ║
║     Testing All Claude-Flow Non-Interactive Modes             ║
╚══════════════════════════════════════════════════════════════╝
""")
    
    # Create configuration
    config = BenchmarkConfig(
        name="Multi-Mode-SWE-bench",
        description="Multi-mode SWE-bench evaluation",
        strategy=StrategyType.DEVELOPMENT,
        mode=CoordinationMode.MESH,
        max_agents=8,
        output_directory=output or "benchmark/swe-bench-multi-mode/results"
    )
    
    # Initialize multi-mode engine
    engine = MultiModeSWEBenchEngine(config)
    
    # Select modes to test
    if quick:
        # Quick test with fewer modes
        modes_to_test = [
            ClaudeFlowMode("swarm", strategy="optimization", mode="mesh", agents=8,
                          description="Swarm optimization (best performer)"),
            ClaudeFlowMode("sparc", subcommand="coder", agents=5,
                          description="SPARC coder mode"),
            ClaudeFlowMode("hive-mind", agents=8,
                          description="Hive-mind with 8 workers"),
        ]
        click.echo(f"⚡ Quick mode: Testing {len(modes_to_test)} configurations")
    else:
        # Test all modes
        modes_to_test = None
        click.echo(f"📊 Full mode: Testing {len(engine.CLAUDE_FLOW_MODES)} configurations")
    
    click.echo(f"📝 Instances per mode: {instances}")
    click.echo(f"📦 Dataset: {'SWE-bench-Lite (300)' if lite else 'Full SWE-bench (2,294)'}")
    
    if not quick:
        total_tests = len(engine.CLAUDE_FLOW_MODES) * instances
        click.echo(f"\n⚠️ This will run {total_tests} tests total")
        click.confirm("Ready to start multi-mode evaluation?", abort=True)
    
    # Run benchmark
    results = asyncio.run(engine.benchmark_all_modes(
        instances_limit=instances,
        modes_to_test=modes_to_test
    ))
    
    # Display results
    if "error" not in results:
        click.echo(f"\n✅ Multi-Mode Evaluation Complete!")
        click.echo(f"   Modes tested: {results['modes_tested']}")
        click.echo(f"   Total tests: {results['total_tests']}")
        click.echo(f"\n🏆 Best Mode: {results['best_mode']}")
        best = results['best_performance']
        click.echo(f"   Success Rate: {best['success_rate']:.1%}")
        click.echo(f"   Avg Duration: {best['avg_duration']:.1f}s")
        click.echo(f"   Description: {best['description']}")
        
        report_path = Path(config.output_directory) / f"multi_mode_report_{int(time.time())}.json"
        click.echo(f"\n📁 Full report: {report_path}")
    else:
        click.echo(f"❌ Evaluation failed: {results['error']}")


@swe_bench.command()
@click.option('--target-success', '-s', type=float, default=0.8, help='Target success rate')
@click.option('--target-duration', '-d', type=float, default=15.0, help='Target average duration')
@click.option('--max-iterations', '-i', type=int, default=10, help='Maximum optimization iterations')
@click.option('--output', '-o', type=click.Path(), help='Output directory')
@click.pass_context
def optimize(ctx, target_success, target_duration, max_iterations, output):
    """Run automated optimization to achieve target metrics."""
    
    from ..swe_bench.optimizer import SWEBenchOptimizer
    
    click.echo(f"\n🔧 Starting SWE-Bench Optimization")
    click.echo(f"   Target Success Rate: {target_success:.1%}")
    click.echo(f"   Target Duration: {target_duration}s")
    click.echo(f"   Max Iterations: {max_iterations}")
    
    # Initialize optimizer
    optimizer = SWEBenchOptimizer()
    
    # Run auto-tuning
    config = optimizer.auto_tune(
        target_metrics={
            'success_rate': target_success,
            'average_duration': target_duration
        },
        max_iterations=max_iterations
    )
    
    click.echo(f"\n✅ Optimization Complete!")
    click.echo(f"   Optimal Configuration:")
    click.echo(f"   - Strategy: {config.strategy.value}")
    click.echo(f"   - Mode: {config.mode.value}")
    click.echo(f"   - Max Agents: {config.max_agents}")
    click.echo(f"   - Task Timeout: {config.task_timeout}s")
    
    # Save configuration
    output_dir = Path(output or "benchmark/swe-bench/configs")
    output_dir.mkdir(parents=True, exist_ok=True)
    
    config_path = output_dir / "optimized_config.json"
    with open(config_path, 'w') as f:
        json.dump({
            'strategy': config.strategy.value,
            'mode': config.mode.value,
            'max_agents': config.max_agents,
            'task_timeout': config.task_timeout,
            'max_retries': config.max_retries
        }, f, indent=2)
        
    click.echo(f"\n💾 Configuration saved to {config_path}")