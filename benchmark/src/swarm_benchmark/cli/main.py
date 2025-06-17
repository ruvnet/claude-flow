"""Main CLI interface for the swarm benchmark tool."""

import click
import asyncio
import json
from pathlib import Path
from typing import Optional

from swarm_benchmark import __version__
from swarm_benchmark.core.models import StrategyType, CoordinationMode, BenchmarkConfig
from swarm_benchmark.core.benchmark_engine import BenchmarkEngine


@click.group()
@click.version_option(version=__version__)
@click.option('--verbose', '-v', is_flag=True, help='Enable verbose output')
@click.option('--config', '-c', type=click.Path(exists=True), help='Configuration file path')
@click.pass_context
def cli(ctx, verbose, config):
    """Claude Flow Advanced Swarm Benchmarking Tool.
    
    A comprehensive Python-based benchmarking tool for agent swarms that interfaces 
    with the Claude Flow Advanced Swarm System.
    """
    ctx.ensure_object(dict)
    ctx.obj['verbose'] = verbose
    ctx.obj['config'] = config


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
    
    if ctx.obj.get('verbose'):
        click.echo(f"Running benchmark: {config.name}")
        click.echo(f"Objective: {objective}")
        click.echo(f"Strategy: {strategy}")
        click.echo(f"Mode: {mode}")
    
    # Run the benchmark
    try:
        result = asyncio.run(_run_benchmark(objective, config))
        
        if result:
            click.echo(f"✅ Benchmark completed successfully!")
            click.echo(f"📊 Results saved to: {output_dir}")
            if ctx.obj.get('verbose'):
                click.echo(f"📋 Summary: {result.get('summary', 'N/A')}")
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


async def _run_benchmark(objective: str, config: BenchmarkConfig) -> Optional[dict]:
    """Run a benchmark with the given objective and configuration."""
    engine = BenchmarkEngine(config)
    
    try:
        result = await engine.run_benchmark(objective)
        return result
    except Exception as e:
        click.echo(f"Error in benchmark execution: {e}")
        return None


def _get_recent_benchmarks(filter_strategy=None, filter_mode=None, limit=10):
    """Get recent benchmark runs."""
    # TODO: Implement database query
    return []


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
    
    # TODO: Implement table display
    click.echo("Benchmark results (table format not yet implemented)")


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