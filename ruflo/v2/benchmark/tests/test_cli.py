#!/usr/bin/env python3
"""Test script for CLI commands."""

import subprocess
import sys
import json
import pytest
from pathlib import Path
from unittest.mock import patch, MagicMock

# Add the src directory to the path
test_dir = Path(__file__).parent
project_root = test_dir.parent
src_dir = project_root / "src"
sys.path.insert(0, str(src_dir))

from swarm_benchmark.cli.main import cli
from click.testing import CliRunner


class TestCLICommands:
    """Test all CLI commands are available and working."""
    
    def setup_method(self):
        """Setup test environment."""
        self.runner = CliRunner()
    
    def test_cli_help(self):
        """Test main CLI help command."""
        result = self.runner.invoke(cli, ['--help'])
        assert result.exit_code == 0
        assert 'Claude Flow Advanced Swarm Benchmarking Tool' in result.output
        assert 'Usage:' in result.output
    
    def test_cli_version(self):
        """Test CLI version command."""
        result = self.runner.invoke(cli, ['--version'])
        assert result.exit_code == 0
        # Should contain version information
        assert len(result.output.strip()) > 0
    
    def test_global_options_available(self):
        """Test that all global options are available."""
        result = self.runner.invoke(cli, ['--help'])
        assert result.exit_code == 0
        
        # Check for new global options
        assert '--real / --mock' in result.output
        assert '--claude-flow-path' in result.output
        assert '--timeout' in result.output
        assert '--stream / --no-stream' in result.output
        assert '--verbose' in result.output
        assert '--config' in result.output
    
    def test_run_command_help(self):
        """Test run command help."""
        result = self.runner.invoke(cli, ['run', '--help'])
        assert result.exit_code == 0
        assert 'Run a swarm benchmark' in result.output
        assert 'OBJECTIVE:' in result.output
    
    def test_real_command_group_help(self):
        """Test real command group help."""
        result = self.runner.invoke(cli, ['real', '--help'])
        assert result.exit_code == 0
        assert 'Real claude-flow command execution' in result.output
        assert 'Commands:' in result.output
    
    def test_real_swarm_command_help(self):
        """Test real swarm command help."""
        result = self.runner.invoke(cli, ['real', 'swarm', '--help'])
        assert result.exit_code == 0
        assert 'Run real claude-flow swarm benchmarks' in result.output
        assert 'OBJECTIVE:' in result.output
        assert '--strategy' in result.output
        assert '--mode' in result.output
    
    def test_list_command_help(self):
        """Test list command help."""
        result = self.runner.invoke(cli, ['list', '--help'])
        assert result.exit_code == 0
        assert 'List recent benchmark runs' in result.output
    
    def test_show_command_help(self):
        """Test show command help."""
        result = self.runner.invoke(cli, ['show', '--help'])
        assert result.exit_code == 0
        assert 'Show details for a specific benchmark' in result.output
    
    def test_clean_command_help(self):
        """Test clean command help."""
        result = self.runner.invoke(cli, ['clean', '--help'])
        assert result.exit_code == 0
        assert 'Clean up benchmark results' in result.output
    
    def test_serve_command_help(self):
        """Test serve command help."""
        result = self.runner.invoke(cli, ['serve', '--help'])
        assert result.exit_code == 0
        assert 'Start the benchmark web interface' in result.output
    
    def test_run_command_with_mock_objective(self):
        """Test run command with a simple objective (mock mode)."""
        with patch('swarm_benchmark.cli.main._run_benchmark') as mock_run:
            mock_run.return_value = {
                'summary': 'Test completed successfully',
                'metrics': {
                    'wall_clock_time': 10.5,
                    'tasks_per_second': 2.5,
                    'success_rate': 0.95,
                    'peak_memory_mb': 128.0,
                    'average_cpu_percent': 45.0,
                    'total_output_lines': 100
                }
            }
            
            result = self.runner.invoke(cli, [
                'run', 'Test objective',
                '--strategy', 'research',
                '--mode', 'centralized',
                '--max-agents', '3',
                '--real-metrics'
            ])
            
            assert result.exit_code == 0
            assert 'Benchmark completed successfully' in result.output
            mock_run.assert_called_once()
    
    def test_real_swarm_command_with_mock_objective(self):
        """Test real swarm command with a simple objective (mock mode)."""
        with patch('swarm_benchmark.cli.main._run_real_benchmark') as mock_run:
            mock_run.return_value = {
                'summary': 'Real benchmark completed successfully'
            }
            
            result = self.runner.invoke(cli, [
                'real', 'swarm', 'Test real objective',
                '--strategy', 'development',
                '--mode', 'distributed',
                '--max-agents', '2'
            ])
            
            assert result.exit_code == 0
            assert 'Real benchmark completed successfully' in result.output
            mock_run.assert_called_once()
    
    def test_list_command_empty_results(self):
        """Test list command with no results."""
        result = self.runner.invoke(cli, ['list'])
        assert result.exit_code == 0
        # Should not crash even with no results
    
    def test_global_options_passed_to_context(self):
        """Test that global options are properly passed to context."""
        with patch('swarm_benchmark.cli.main._run_benchmark') as mock_run:
            mock_run.return_value = {'summary': 'Test'}
            
            result = self.runner.invoke(cli, [
                '--verbose',
                '--real',
                '--claude-flow-path', '/custom/path',
                '--timeout', '600',
                '--no-stream',
                'run', 'Test objective'
            ])
            
            # Should not crash and should handle global options
            assert result.exit_code == 0


class TestCLIIntegration:
    """Integration tests for CLI functionality."""
    
    def test_real_execution_simulation(self):
        """Test real command execution simulation."""
        runner = CliRunner()
        
        # This would normally execute real claude-flow commands
        # but we're testing the CLI structure
        with patch('swarm_benchmark.core.real_benchmark_engine.RealBenchmarkEngine') as mock_engine:
            mock_instance = MagicMock()
            mock_instance.run_benchmark.return_value = {
                'summary': 'Real execution completed',
                'metrics': {'tasks_completed': 5}
            }
            mock_instance.cleanup.return_value = None
            mock_engine.return_value = mock_instance
            
            result = runner.invoke(cli, [
                'real', 'swarm', 'Simple test task',
                '--strategy', 'auto',
                '--max-agents', '1',
                '--timeout', '1'
            ])
            
            assert result.exit_code == 0
            assert 'Real benchmark completed successfully' in result.output


def test_cli_commands():
    """Test all CLI commands are available."""
    # This can be run as a standalone function
    test_instance = TestCLICommands()
    test_instance.setup_method()
    
    # Run basic tests
    test_instance.test_cli_help()
    test_instance.test_cli_version()
    test_instance.test_global_options_available()
    test_instance.test_real_command_group_help()
    test_instance.test_real_swarm_command_help()
    
    print("✅ All CLI command tests passed!")


def test_real_execution():
    """Test real command execution."""
    # This would test with actual claude-flow if available
    runner = CliRunner()
    
    # Test that the command structure is correct
    result = runner.invoke(cli, ['real', 'swarm', '--help'])
    assert result.exit_code == 0
    assert 'OBJECTIVE:' in result.output
    
    print("✅ Real execution structure test passed!")


if __name__ == "__main__":
    print("🧪 Running CLI tests...")
    
    try:
        test_cli_commands()
        test_real_execution()
        print("\n🎉 All tests passed successfully!")
    except Exception as e:
        print(f"\n❌ Test failed: {e}")
        sys.exit(1)