"""Main CLI interface for the swarm benchmark tool."""

import click
import asyncio
import json
from pathlib import Path
from typing import Optional
from datetime import datetime

from swarm_benchmark import __version__
from swarm_benchmark.core.models import StrategyType, CoordinationMode, BenchmarkConfig
from swarm_benchmark.core.benchmark_engine import BenchmarkEngine
from swarm_benchmark.core.real_benchmark_engine import RealBenchmarkEngine
from swarm_benchmark.cli.swe_bench_command import swe_bench


@click.group()
@click.version_option(version=__version__)
@click.option('--verbose', '-v', is_flag=True, help='Enable verbose output')
@click.option('--config', '-c', type=click.Path(exists=True), help='Configuration file path')
@click.option('--mock', is_flag=True, default=False, help='Use mock execution instead of real claude-flow')
@click.option('--claude-flow-path', default='./claude-flow', help='Path to claude-flow')
@click.option('--timeout', default=300, help='Command timeout in seconds')
@click.option('--stream/--no-stream', default=True, help='Stream output')
@click.pass_context
def cli(ctx, verbose, config, mock, claude_flow_path, timeout, stream):
    """Claude Flow Advanced Swarm Benchmarking Tool.
    
    A comprehensive Python-based benchmarking tool for agent swarms that interfaces 
    with the Claude Flow Advanced Swarm System.
    """
    ctx.ensure_object(dict)
    ctx.obj['verbose'] = verbose
    ctx.obj['config'] = config
    ctx.obj['real'] = not mock  # Default to real execution unless --mock is specified
    ctx.obj['claude_flow_path'] = claude_flow_path
    ctx.obj['timeout'] = timeout
    ctx.obj['stream'] = stream


@cli.command()
@click.argument('objective')
@click.option('--strategy', 
              type=click.Choice(['auto', 'research', 'development', 'analysis', 'testing', 'optimization', 'maintenance']),
              default='auto',
              help='Execution strategy (default: auto)')
@click.option('--mode',
              type=click.Choice(['centralized', 'distributed', 'hierarchical', 'mesh', 'hybrid']),
              default='centralized', 
              help='Coordination mode (default: centralized)')
@click.option('--max-agents', type=int, default=5, help='Maximum agents (default: 5)')
@click.option('--max-tasks', type=int, default=100, help='Maximum tasks (default: 100)')
@click.option('--timeout', type=int, default=60, help='Timeout in minutes (default: 60)')
@click.option('--task-timeout', type=int, default=300, help='Individual task timeout in seconds (default: 300)')
@click.option('--max-retries', type=int, default=3, help='Maximum retries per task (default: 3)')
@click.option('--parallel', is_flag=True, help='Enable parallel execution')
@click.option('--monitor', is_flag=True, help='Enable monitoring')
@click.option('--output', '-o', 'output_formats', multiple=True, 
              type=click.Choice(['json', 'sqlite', 'csv', 'html']),
              help='Output formats (default: json)')
@click.option('--output-dir', type=click.Path(), default='./reports', 
              help='Output directory (default: ./reports)')
@click.option('--name', help='Benchmark name')
@click.option('--description', help='Benchmark description')
@click.pass_context
def run(ctx, objective, strategy, mode, max_agents, max_tasks, timeout, task_timeout, 
        max_retries, parallel, monitor, output_formats, output_dir, name, description):
    """Run a swarm benchmark with the specified objective.
    
    OBJECTIVE: The goal or task for the swarm to accomplish
    
    Examples:
      swarm-benchmark run "Build a REST API" --strategy development
      swarm-benchmark run "Research cloud architecture" --strategy research --mode distributed
      swarm-benchmark run "Analyze data trends" --strategy analysis --parallel
      swarm-benchmark run "Optimize performance" --mode distributed --monitor
    """
    # Create benchmark configuration
    config = BenchmarkConfig(
        name=name or f"benchmark-{strategy}-{mode}",
        description=description or f"Benchmark: {objective}",
        strategy=getattr(StrategyType, strategy.upper()),
        mode=getattr(CoordinationMode, mode.upper()),
        max_agents=max_agents,
        max_tasks=max_tasks,
        timeout=timeout * 60,  # Convert to seconds
        task_timeout=task_timeout,
        max_retries=max_retries,
        parallel=parallel,
        monitoring=monitor,
        output_formats=list(output_formats) if output_formats else ['json'],
        output_directory=output_dir,
        verbose=ctx.obj.get('verbose', False)
    )
    
    # Always use real execution by default unless --mock flag is set
    use_real = ctx.obj.get('real', True)
    
    if ctx.obj.get('verbose'):
        click.echo(f"Running benchmark: {config.name}")
        click.echo(f"Objective: {objective}")
        click.echo(f"Strategy: {strategy}")
        click.echo(f"Mode: {mode}")
        click.echo(f"Execution: {'Real claude-flow' if use_real else 'Mock'}")
    
    # Run the benchmark
    try:
        result = asyncio.run(_run_benchmark(objective, config, use_real))
        
        if result:
            click.echo(f"✅ Benchmark completed successfully!")
            click.echo(f"📊 Results saved to: {output_dir}")
            if ctx.obj.get('verbose'):
                click.echo(f"📋 Summary: {result.get('summary', 'N/A')}")
                
            # Display metrics if available
            if 'metrics' in result and use_real:
                click.echo("\n📈 Performance Metrics:")
                metrics = result['metrics']
                click.echo(f"  • Wall clock time: {metrics.get('wall_clock_time', 0):.2f}s")
                click.echo(f"  • Tasks per second: {metrics.get('tasks_per_second', 0):.2f}")
                click.echo(f"  • Success rate: {metrics.get('success_rate', 0):.1%}")
                click.echo(f"  • Peak memory: {metrics.get('peak_memory_mb', 0):.1f} MB")
                click.echo(f"  • Average CPU: {metrics.get('average_cpu_percent', 0):.1f}%")
                click.echo(f"  • Total output: {metrics.get('total_output_lines', 0)} lines")
        else:
            click.echo("❌ Benchmark failed!")
            return 1
            
    except Exception as e:
        click.echo(f"❌ Error running benchmark: {e}")
        return 1
    
    return 0


@cli.command()
@click.option('--format', 'output_format', 
              type=click.Choice(['json', 'table', 'csv']),
              default='table',
              help='Output format (default: table)')
@click.option('--filter-strategy', help='Filter by strategy')
@click.option('--filter-mode', help='Filter by coordination mode')
@click.option('--limit', type=int, default=10, help='Limit number of results (default: 10)')
@click.pass_context
def list(ctx, output_format, filter_strategy, filter_mode, limit):
    """List recent benchmark runs."""
    try:
        benchmarks = _get_recent_benchmarks(filter_strategy, filter_mode, limit)
        
        if output_format == 'table':
            _display_benchmarks_table(benchmarks)
        elif output_format == 'json':
            click.echo(json.dumps(benchmarks, indent=2))
        elif output_format == 'csv':
            _display_benchmarks_csv(benchmarks)
            
    except Exception as e:
        click.echo(f"❌ Error listing benchmarks: {e}")
        return 1
    
    return 0


@cli.command()
@click.argument('benchmark_id')
@click.option('--format', 'output_format',
              type=click.Choice(['json', 'summary', 'detailed']),
              default='summary',
              help='Output format (default: summary)')
@click.pass_context
def show(ctx, benchmark_id, output_format):
    """Show details for a specific benchmark run."""
    try:
        benchmark = _get_benchmark_details(benchmark_id)
        
        if not benchmark:
            click.echo(f"❌ Benchmark {benchmark_id} not found")
            return 1
        
        if output_format == 'json':
            click.echo(json.dumps(benchmark, indent=2))
        elif output_format == 'summary':
            _display_benchmark_summary(benchmark)
        elif output_format == 'detailed':
            _display_benchmark_detailed(benchmark)
            
    except Exception as e:
        click.echo(f"❌ Error showing benchmark: {e}")
        return 1
    
    return 0


@cli.command()
@click.option('--all', is_flag=True, help='Delete all benchmark results')
@click.option('--older-than', type=int, help='Delete results older than N days')
@click.option('--strategy', help='Delete results for specific strategy')
@click.confirmation_option(prompt='Are you sure you want to delete benchmark results?')
@click.pass_context
def clean(ctx, all, older_than, strategy):
    """Clean up benchmark results."""
    try:
        deleted_count = _clean_benchmarks(all, older_than, strategy)
        click.echo(f"✅ Deleted {deleted_count} benchmark results")
        
    except Exception as e:
        click.echo(f"❌ Error cleaning benchmarks: {e}")
        return 1
    
    return 0


@cli.command()
@click.option('--port', type=int, default=8080, help='Server port (default: 8080)')
@click.option('--host', default='localhost', help='Server host (default: localhost)')
@click.pass_context
def serve(ctx, port, host):
    """Start the benchmark web interface."""
    try:
        click.echo(f"🚀 Starting benchmark server at http://{host}:{port}")
        click.echo("Press Ctrl+C to stop")
        
        # TODO: Implement web interface
        click.echo("⚠️  Web interface not yet implemented")
        
    except KeyboardInterrupt:
        click.echo("\n👋 Server stopped")
    except Exception as e:
        click.echo(f"❌ Error starting server: {e}")
        return 1
    
    return 0


# Top-level commands for direct real execution
@cli.command('swarm')
@click.argument('objective')
@click.option('--strategy', 
              type=click.Choice(['auto', 'research', 'development', 'analysis', 'testing', 'optimization', 'maintenance']),
              default='auto',
              help='Execution strategy (default: auto)')
@click.option('--mode',
              type=click.Choice(['centralized', 'distributed', 'hierarchical', 'mesh', 'hybrid']),
              default='centralized', 
              help='Coordination mode (default: centralized)')
@click.option('--sparc-mode',
              help='Specific SPARC mode to test (e.g., coder, architect, reviewer)')
@click.option('--all-modes', is_flag=True, help='Test all SPARC modes and swarm strategies')
@click.option('--max-agents', type=int, default=5, help='Maximum agents (default: 5)')
@click.option('--timeout', type=int, default=60, help='Timeout in minutes (default: 60)')
@click.option('--task-timeout', type=int, default=300, help='Individual task timeout in seconds (default: 300)')
@click.option('--parallel', is_flag=True, help='Enable parallel execution')
@click.option('--monitor', is_flag=True, help='Enable monitoring')
@click.option('--output', '-o', 'output_formats', multiple=True, 
              type=click.Choice(['json', 'sqlite']),
              help='Output formats (default: json)')
@click.option('--output-dir', type=click.Path(), default='./reports', 
              help='Output directory (default: ./reports)')
@click.option('--name', help='Benchmark name')
@click.option('--description', help='Benchmark description')
@click.pass_context
def swarm_cmd(ctx, objective, strategy, mode, sparc_mode, all_modes, max_agents, timeout, 
         task_timeout, parallel, monitor, output_formats, output_dir, name, description):
    """Run real claude-flow swarm benchmarks.
    
    OBJECTIVE: The goal or task for claude-flow to accomplish
    
    Examples:
      swarm-bench swarm "Build a REST API" --strategy development
      swarm-bench swarm "Create a parser" --sparc-mode coder
      swarm-bench swarm "Analyze code" --all-modes --parallel
      swarm-bench swarm "Optimize performance" --mode distributed --monitor
    """
    # Forward to the real swarm implementation
    ctx.invoke(swarm, objective=objective, strategy=strategy, mode=mode, 
               sparc_mode=sparc_mode, all_modes=all_modes, max_agents=max_agents,
               timeout=timeout, task_timeout=task_timeout, parallel=parallel,
               monitor=monitor, output_formats=output_formats, output_dir=output_dir,
               name=name, description=description)


@cli.command('hive-mind')
@click.argument('task')
@click.option('--queen-type', 
              type=click.Choice(['strategic', 'tactical', 'adaptive']),
              default='strategic',
              help='Queen coordinator type (default: strategic)')
@click.option('--max-workers', type=int, default=8, help='Maximum worker agents (default: 8)')
@click.option('--consensus', 
              type=click.Choice(['majority', 'weighted', 'byzantine']),
              default='majority',
              help='Consensus algorithm (default: majority)')
@click.option('--timeout', type=int, default=60, help='Timeout in minutes (default: 60)')
@click.option('--monitor', is_flag=True, help='Enable monitoring')
@click.option('--output-dir', type=click.Path(), default='./reports', 
              help='Output directory (default: ./reports)')
@click.pass_context
def hive_mind_cmd(ctx, task, queen_type, max_workers, consensus, timeout, monitor, output_dir):
    """Run real claude-flow hive-mind benchmarks.
    
    TASK: The task for the hive-mind to accomplish
    
    Examples:
      swarm-bench hive-mind "Design architecture" --max-workers 8
      swarm-bench hive-mind "Solve problem" --queen-type adaptive
      swarm-bench hive-mind "Build system" --consensus byzantine
    """
    # Forward to the real hive-mind implementation
    ctx.invoke(hive_mind, task=task, queen_type=queen_type, max_workers=max_workers,
               consensus=consensus, timeout=timeout, monitor=monitor, output_dir=output_dir)


@cli.command('sparc')
@click.argument('mode', type=click.Choice(['coder', 'architect', 'tdd', 'reviewer', 'tester', 
                                          'optimizer', 'documenter', 'debugger']))
@click.argument('task')
@click.option('--namespace', help='Memory namespace')
@click.option('--timeout', type=int, default=60, help='Timeout in minutes (default: 60)')
@click.option('--non-interactive', is_flag=True, default=True, help='Non-interactive mode (default: True)')
@click.option('--output-dir', type=click.Path(), default='./reports', 
              help='Output directory (default: ./reports)')
@click.pass_context
def sparc_cmd(ctx, mode, task, namespace, timeout, non_interactive, output_dir):
    """Run real claude-flow SPARC mode benchmarks.
    
    MODE: The SPARC mode to use (coder, architect, tdd, etc.)
    TASK: The task to accomplish
    
    Examples:
      swarm-bench sparc coder "Implement authentication"
      swarm-bench sparc architect "Design microservices"
      swarm-bench sparc tdd "Create test suite"
      swarm-bench sparc reviewer "Review codebase"
    """
    # Forward to the real sparc implementation
    ctx.invoke(sparc, mode=mode, task=task, namespace=namespace, 
               timeout=timeout, non_interactive=non_interactive, output_dir=output_dir)


# Add SWE-Bench command group
cli.add_command(swe_bench)

# Keep the real group for backward compatibility but mark as deprecated
@cli.group()
@click.pass_context
def real(ctx):
    """[DEPRECATED] Use direct commands instead: swarm, hive-mind, sparc."""
    click.echo("⚠️  The 'real' subcommand is deprecated. Use direct commands instead:")
    click.echo("   swarm-bench swarm ...")
    click.echo("   swarm-bench hive-mind ...")
    click.echo("   swarm-bench sparc ...")
    pass


@real.command('swarm')
@click.argument('objective')
@click.option('--strategy', 
              type=click.Choice(['auto', 'research', 'development', 'analysis', 'testing', 'optimization', 'maintenance']),
              default='auto',
              help='Execution strategy (default: auto)')
@click.option('--mode',
              type=click.Choice(['centralized', 'distributed', 'hierarchical', 'mesh', 'hybrid']),
              default='centralized', 
              help='Coordination mode (default: centralized)')
@click.option('--sparc-mode',
              help='Specific SPARC mode to test (e.g., coder, architect, reviewer)')
@click.option('--all-modes', is_flag=True, help='Test all SPARC modes and swarm strategies')
@click.option('--max-agents', type=int, default=5, help='Maximum agents (default: 5)')
@click.option('--timeout', type=int, default=60, help='Timeout in minutes (default: 60)')
@click.option('--task-timeout', type=int, default=300, help='Individual task timeout in seconds (default: 300)')
@click.option('--parallel', is_flag=True, help='Enable parallel execution')
@click.option('--monitor', is_flag=True, help='Enable monitoring')
@click.option('--output', '-o', 'output_formats', multiple=True, 
              type=click.Choice(['json', 'sqlite']),
              help='Output formats (default: json)')
@click.option('--output-dir', type=click.Path(), default='./reports', 
              help='Output directory (default: ./reports)')
@click.option('--name', help='Benchmark name')
@click.option('--description', help='Benchmark description')
@click.pass_context
def swarm(ctx, objective, strategy, mode, sparc_mode, all_modes, max_agents, timeout, 
         task_timeout, parallel, monitor, output_formats, output_dir, name, description):
    """Run real claude-flow swarm benchmarks with actual command execution.
    
    OBJECTIVE: The goal or task for claude-flow to accomplish
    
    Examples:
      swarm-benchmark real swarm "Build a REST API" --strategy development
      swarm-benchmark real swarm "Create a parser" --sparc-mode coder
      swarm-benchmark real swarm "Analyze code" --all-modes --parallel
      swarm-benchmark real swarm "Optimize performance" --mode distributed --monitor
    """
    # Create benchmark configuration
    config = BenchmarkConfig(
        name=name or f"real-benchmark-{strategy}-{mode}",
        description=description or f"Real Benchmark: {objective}",
        strategy=getattr(StrategyType, strategy.upper()),
        mode=getattr(CoordinationMode, mode.upper()),
        max_agents=max_agents,
        timeout=timeout * 60,  # Convert to seconds
        task_timeout=task_timeout,
        parallel=parallel,
        monitoring=monitor,
        output_formats=list(output_formats) if output_formats else ['json'],
        output_directory=output_dir,
        verbose=ctx.obj.get('verbose', False),
        parameters={'force_swarm': True}  # Force use of swarm command
    )
    
    if ctx.obj.get('verbose'):
        click.echo(f"Running real benchmark: {config.name}")
        click.echo(f"Objective: {objective}")
        click.echo(f"Strategy: {strategy}")
        click.echo(f"Mode: {mode}")
        if sparc_mode:
            click.echo(f"SPARC Mode: {sparc_mode}")
        if all_modes:
            click.echo("Testing all modes: Yes")
    
    # Run the real benchmark
    try:
        result = asyncio.run(_run_real_benchmark(objective, config, sparc_mode, all_modes))
        
        if result:
            # Generate detailed report
            click.echo(f"\n{'='*60}")
            click.echo(f"✅ Real Benchmark Completed Successfully!")
            click.echo(f"{'='*60}")
            
            # Basic info
            click.echo(f"📋 Objective: {objective}")
            click.echo(f"🎯 Strategy: {strategy.upper()}")
            click.echo(f"🔄 Mode: {mode.upper()}")
            
            # Metrics if available
            if 'metrics' in result:
                metrics = result['metrics']
                click.echo(f"\n📊 Performance Metrics:")
                if 'wall_clock_time' in metrics:
                    click.echo(f"  ⏱️  Execution Time: {metrics['wall_clock_time']:.2f}s")
                if 'tasks_per_second' in metrics:
                    click.echo(f"  ⚡ Tasks/Second: {metrics['tasks_per_second']:.2f}")
                if 'success_rate' in metrics:
                    click.echo(f"  ✓ Success Rate: {metrics['success_rate']:.1%}")
                if 'peak_memory_mb' in metrics:
                    click.echo(f"  💾 Peak Memory: {metrics['peak_memory_mb']:.1f} MB")
                if 'average_cpu_percent' in metrics:
                    click.echo(f"  🖥️  Avg CPU: {metrics['average_cpu_percent']:.1f}%")
            
            # File outputs
            import os
            from pathlib import Path
            output_path = Path(output_dir)
            output_path.mkdir(parents=True, exist_ok=True)
            
            benchmark_id = result.get('benchmark_id', 'latest')
            
            click.echo(f"\n📁 Output Files:")
            
            # Main results file
            results_file = output_path / f"benchmark_{benchmark_id}.json"
            click.echo(f"  📄 Results: {results_file}")
            
            # Save results
            import json
            with open(results_file, 'w') as f:
                json.dump(result, f, indent=2, default=str)
            
            # Check for additional files
            metrics_file = output_path / f"metrics_{benchmark_id}.json"
            if metrics_file.exists():
                click.echo(f"  📊 Metrics: {metrics_file}")
            
            process_file = output_path / f"process_report_{benchmark_id}.json"
            if process_file.exists():
                click.echo(f"  🔄 Process Report: {process_file}")
            
            # Summary
            click.echo(f"\n📈 Summary:")
            click.echo(f"  {result.get('summary', 'Benchmark completed successfully')}")
            
            if ctx.obj.get('verbose'):
                click.echo(f"\n🔍 Detailed Results:")
                click.echo(json.dumps(result.get('metrics', {}), indent=2, default=str))
            
            click.echo(f"{'='*60}\n")
        else:
            click.echo("❌ Real benchmark failed!")
            return 1
            
    except Exception as e:
        click.echo(f"❌ Error running real benchmark: {e}")
        if ctx.obj.get('verbose'):
            import traceback
            click.echo(traceback.format_exc())
        return 1
    
    return 0


@real.command('hive-mind')
@click.argument('task')
@click.option('--queen-type', 
              type=click.Choice(['strategic', 'tactical', 'adaptive']),
              default='strategic',
              help='Queen coordinator type (default: strategic)')
@click.option('--max-workers', type=int, default=8, help='Maximum worker agents (default: 8)')
@click.option('--consensus', 
              type=click.Choice(['majority', 'weighted', 'byzantine']),
              default='majority',
              help='Consensus algorithm (default: majority)')
@click.option('--timeout', type=int, default=60, help='Timeout in minutes (default: 60)')
@click.option('--monitor', is_flag=True, help='Enable monitoring')
@click.option('--output-dir', type=click.Path(), default='./reports', 
              help='Output directory (default: ./reports)')
@click.pass_context
def hive_mind(ctx, task, queen_type, max_workers, consensus, timeout, monitor, output_dir):
    """Run real claude-flow hive-mind benchmarks.
    
    TASK: The task for the hive-mind to accomplish
    
    Examples:
      swarm-benchmark real hive-mind "Design architecture" --max-workers 8
      swarm-benchmark real hive-mind "Solve problem" --queen-type adaptive
      swarm-benchmark real hive-mind "Build system" --consensus byzantine
    """
    if ctx.obj.get('verbose'):
        click.echo(f"Running real hive-mind benchmark")
        click.echo(f"Task: {task}")
        click.echo(f"Queen Type: {queen_type}")
        click.echo(f"Max Workers: {max_workers}")
        click.echo(f"Consensus: {consensus}")
    
    # Execute real hive-mind command
    try:
        from ..core.claude_flow_real_executor import RealClaudeFlowExecutor, HiveMindCommand
        executor = RealClaudeFlowExecutor()
        
        # Create hive-mind configuration
        config = HiveMindCommand(
            task=task,
            action="spawn",
            spawn_count=max_workers,
            coordination_mode=consensus
        )
        
        # Add additional flags if needed
        if monitor:
            config.additional_flags.append("--monitor")
        
        result = executor.execute_hive_mind(config)
        
        if result.success:
            # Generate detailed report
            click.echo(f"\n{'='*60}")
            click.echo(f"✅ Hive-Mind Benchmark Completed!")
            click.echo(f"{'='*60}")
            
            # Basic info
            click.echo(f"📋 Task: {task}")
            click.echo(f"👑 Queen Type: {queen_type.upper()}")
            click.echo(f"👷 Max Workers: {max_workers}")
            click.echo(f"🤝 Consensus: {consensus.upper()}")
            
            # Performance metrics
            click.echo(f"\n📊 Performance Metrics:")
            click.echo(f"  ⏱️  Execution Time: {result.duration:.2f}s")
            click.echo(f"  🤖 Agents Spawned: {result.agents_spawned}")
            click.echo(f"  ✅ Tasks Completed: {result.tasks_completed}")
            if result.total_tokens > 0:
                click.echo(f"  🔤 Total Tokens: {result.total_tokens}")
                click.echo(f"    📥 Input: {result.input_tokens}")
                click.echo(f"    📤 Output: {result.output_tokens}")
            
            # Save results
            import json
            from pathlib import Path
            output_path = Path(output_dir)
            output_path.mkdir(parents=True, exist_ok=True)
            
            timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
            results_file = output_path / f"hive_mind_{timestamp}.json"
            
            with open(results_file, 'w') as f:
                json.dump(result.to_dict(), f, indent=2, default=str)
            
            click.echo(f"\n📁 Output Files:")
            click.echo(f"  📄 Results: {results_file}")
            
            if ctx.obj.get('verbose'):
                click.echo(f"\n🔍 Command Executed:")
                click.echo(f"  {' '.join(result.command)}")
            
            click.echo(f"{'='*60}\n")
        else:
            error_msg = ""
            if result.errors:
                error_msg = "; ".join(result.errors)
            elif result.exit_code == -9:
                error_msg = "Command timed out (requires Claude CLI for execution)"
                click.echo(f"❌ Hive-mind benchmark failed: {error_msg}")
                click.echo("💡 Tip: Hive-mind requires Claude CLI. Install with: npm install -g @anthropic-ai/claude-code")
                click.echo("    Or use SPARC commands which work without Claude CLI:")
                click.echo("    swarm-benchmark real sparc tdd \"Your task\"")
            elif result.exit_code != 0:
                error_msg = f"Command failed with exit code: {result.exit_code}"
                click.echo(f"❌ Hive-mind benchmark failed: {error_msg}")
            if ctx.obj.get('verbose') and result.stderr_lines:
                click.echo(f"Stderr: {' '.join(result.stderr_lines[:5])}")
            return 1
            
    except Exception as e:
        click.echo(f"❌ Error running hive-mind: {e}")
        return 1
    
    return 0


@real.command('sparc')
@click.argument('mode', type=click.Choice(['coder', 'architect', 'tdd', 'reviewer', 'tester', 
                                          'optimizer', 'documenter', 'debugger']))
@click.argument('task')
@click.option('--namespace', help='Memory namespace')
@click.option('--timeout', type=int, default=60, help='Timeout in minutes (default: 60)')
@click.option('--non-interactive', is_flag=True, default=True, help='Non-interactive mode (default: True)')
@click.option('--output-dir', type=click.Path(), default='./reports', 
              help='Output directory (default: ./reports)')
@click.pass_context
def sparc(ctx, mode, task, namespace, timeout, non_interactive, output_dir):
    """Run real claude-flow SPARC mode benchmarks.
    
    MODE: The SPARC mode to use (coder, architect, tdd, etc.)
    TASK: The task to accomplish
    
    Examples:
      swarm-benchmark real sparc coder "Implement authentication"
      swarm-benchmark real sparc architect "Design microservices"
      swarm-benchmark real sparc tdd "Create test suite"
      swarm-benchmark real sparc reviewer "Review codebase"
    """
    if ctx.obj.get('verbose'):
        click.echo(f"Running real SPARC benchmark")
        click.echo(f"Mode: {mode}")
        click.echo(f"Task: {task}")
        if namespace:
            click.echo(f"Namespace: {namespace}")
    
    # Execute real SPARC command
    try:
        from ..core.claude_flow_real_executor import RealClaudeFlowExecutor, SparcCommand
        executor = RealClaudeFlowExecutor()
        
        # Create SPARC configuration
        config = SparcCommand(
            mode=mode,
            task=task,
            output_format="markdown" if not namespace else None
        )
        
        result = executor.execute_sparc(config)
        
        if result.success:
            # Generate detailed report
            click.echo(f"\n{'='*60}")
            click.echo(f"✅ SPARC {mode.upper()} Benchmark Completed!")
            click.echo(f"{'='*60}")
            
            # Basic info
            click.echo(f"📋 Task: {task}")
            click.echo(f"🎯 Mode: {mode.upper()}")
            if namespace:
                click.echo(f"📦 Namespace: {namespace}")
            
            # Performance metrics
            click.echo(f"\n📊 Performance Metrics:")
            click.echo(f"  ⏱️  Execution Time: {result.duration:.2f}s")
            click.echo(f"  🤖 Agents Spawned: {result.agents_spawned}")
            click.echo(f"  ✅ Tasks Completed: {result.tasks_completed}")
            if result.total_tokens > 0:
                click.echo(f"  🔤 Total Tokens: {result.total_tokens}")
                click.echo(f"    📥 Input: {result.input_tokens}")
                click.echo(f"    📤 Output: {result.output_tokens}")
            
            # Save results
            import json
            from pathlib import Path
            output_path = Path(output_dir)
            output_path.mkdir(parents=True, exist_ok=True)
            
            timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
            results_file = output_path / f"sparc_{mode}_{timestamp}.json"
            
            with open(results_file, 'w') as f:
                json.dump(result.to_dict(), f, indent=2, default=str)
            
            click.echo(f"\n📁 Output Files:")
            click.echo(f"  📄 Results: {results_file}")
            
            if ctx.obj.get('verbose'):
                click.echo(f"\n🔍 Command Executed:")
                click.echo(f"  {' '.join(result.command)}")
            
            click.echo(f"{'='*60}\n")
        else:
            error_msg = ""
            if result.errors:
                error_msg = "; ".join(result.errors)
            elif result.exit_code == -9:
                error_msg = f"Command timed out or was killed (exit code: {result.exit_code})"
            elif result.exit_code != 0:
                error_msg = f"Command failed with exit code: {result.exit_code}"
            else:
                error_msg = "Unknown error"
            click.echo(f"❌ SPARC benchmark failed: {error_msg}")
            if ctx.obj.get('verbose') and result.stderr_lines:
                click.echo(f"Stderr: {' '.join(result.stderr_lines[:5])}")
            return 1
            
    except Exception as e:
        click.echo(f"❌ Error running SPARC: {e}")
        return 1
    
    return 0


async def _run_benchmark(objective: str, config: BenchmarkConfig, use_real_metrics: bool = False) -> Optional[dict]:
    """Run a benchmark with the given objective and configuration."""
    # Choose engine based on metrics flag
    if use_real_metrics:
        engine = RealBenchmarkEngine(config)
    else:
        engine = BenchmarkEngine(config)
    
    try:
        result = await engine.run_benchmark(objective)
        return result
    except Exception as e:
        click.echo(f"Error in benchmark execution: {e}")
        return None


async def _run_real_benchmark(objective: str, config: BenchmarkConfig, 
                              sparc_mode: Optional[str] = None,
                              all_modes: bool = False) -> Optional[dict]:
    """Run a real benchmark with actual claude-flow execution."""
    engine = RealBenchmarkEngine(config)
    
    try:
        if all_modes:
            # Test all modes comprehensively
            result = await engine.benchmark_all_modes(objective)
        elif sparc_mode:
            # Test specific SPARC mode
            result = await engine._execute_sparc_mode(sparc_mode, objective)
            result = {"sparc_mode": sparc_mode, "result": result}
        else:
            # Standard benchmark run
            result = await engine.run_benchmark(objective)
        
        return result
    except Exception as e:
        import traceback
        click.echo(f"Error in real benchmark execution: {e}")
        if config.verbose:
            click.echo(traceback.format_exc())
        return None
    finally:
        # Ensure cleanup
        engine.cleanup()


def _get_recent_benchmarks(filter_strategy=None, filter_mode=None, limit=10):
    """Get recent benchmark runs."""
    import os
    from pathlib import Path
    import json
    
    # Look for benchmark files in the reports directory
    reports_dir = Path('./reports')
    if not reports_dir.exists():
        return []
    
    benchmarks = []
    
    # Find all JSON files that look like benchmark results
    for file_path in reports_dir.glob('*.json'):
        # Skip metrics and process report files
        if 'metrics_' in file_path.name or 'process_report_' in file_path.name:
            continue
            
        try:
            with open(file_path, 'r') as f:
                data = json.load(f)
                
            # Extract benchmark info
            benchmark_info = {
                'id': file_path.stem,
                'file': str(file_path),
                'timestamp': file_path.stat().st_mtime,
                'name': data.get('name', file_path.stem),
                'strategy': data.get('strategy', 'unknown'),
                'mode': data.get('mode', 'unknown'),
                'objective': data.get('objective', data.get('description', 'N/A')),
                'success': data.get('success', False),
                'duration': data.get('duration', 0)
            }
            
            # Apply filters if provided
            if filter_strategy and benchmark_info['strategy'].lower() != filter_strategy.lower():
                continue
            if filter_mode and benchmark_info['mode'].lower() != filter_mode.lower():
                continue
                
            benchmarks.append(benchmark_info)
            
        except Exception as e:
            # Skip files that can't be parsed
            continue
    
    # Sort by timestamp (most recent first)
    benchmarks.sort(key=lambda x: x['timestamp'], reverse=True)
    
    # Limit results
    return benchmarks[:limit]


def _get_benchmark_details(benchmark_id: str):
    """Get details for a specific benchmark."""
    # TODO: Implement database query
    return None


def _clean_benchmarks(all_results=False, older_than=None, strategy=None):
    """Clean up benchmark results."""
    # TODO: Implement cleanup logic
    return 0


def _display_benchmarks_table(benchmarks):
    """Display benchmarks in table format."""
    if not benchmarks:
        click.echo("No benchmarks found.")
        return
    
    from datetime import datetime
    
    # Header
    click.echo("\n" + "="*100)
    click.echo(f"{'ID':<40} {'Strategy':<12} {'Mode':<12} {'Duration':<10} {'Date':<20}")
    click.echo("="*100)
    
    # Rows
    for bench in benchmarks:
        # Format timestamp
        dt = datetime.fromtimestamp(bench['timestamp'])
        date_str = dt.strftime('%Y-%m-%d %H:%M:%S')
        
        # Format duration
        duration = bench.get('duration', 0)
        if duration > 0:
            duration_str = f"{duration:.1f}s"
        else:
            duration_str = "N/A"
        
        # Truncate ID if too long
        bench_id = bench['id']
        if len(bench_id) > 38:
            bench_id = bench_id[:35] + "..."
            
        click.echo(f"{bench_id:<40} {bench['strategy']:<12} {bench['mode']:<12} {duration_str:<10} {date_str:<20}")
    
    click.echo("="*100)
    click.echo(f"\nTotal: {len(benchmarks)} benchmark(s)")
    click.echo("\nUse 'swarm-bench show <id>' to view details of a specific benchmark")


def _display_benchmarks_csv(benchmarks):
    """Display benchmarks in CSV format."""
    # TODO: Implement CSV display
    click.echo("CSV output not yet implemented")


def _display_benchmark_summary(benchmark):
    """Display benchmark summary."""
    # TODO: Implement summary display
    click.echo("Summary display not yet implemented")


def _display_benchmark_detailed(benchmark):
    """Display detailed benchmark information."""
    # TODO: Implement detailed display
    click.echo("Detailed display not yet implemented")


def main():
    """Main entry point."""
    return cli()