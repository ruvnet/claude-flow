"""
Swarm Benchmark - Agent swarm benchmarking tool for Claude Flow.

This package provides comprehensive benchmarking capabilities for agent swarms,
supporting various strategies and coordination modes, including MLE-STAR ensemble
learning, non-interactive automation, advanced metrics collection, collective
intelligence benchmarking, and CLAUDE.md optimization.
"""

__version__ = "2.0.0"
__author__ = "Claude Flow Team"
__email__ = "support@claude-flow.dev"

# Core components (backward compatibility)
from .core.models import Task, Agent, Result, Benchmark
from .core.benchmark_engine import BenchmarkEngine
from .core.base_interfaces import (
    BenchmarkInterface, 
    MetricsCollectorInterface,
    AsyncBenchmarkBase,
    EnsembleBenchmark,
    BenchmarkContext,
    ExecutionResult,
    BenchmarkStatus
)

# Configuration management
from .config.unified_config import UnifiedConfig, ConfigManager, config

# New modules (lazy imports to avoid circular dependencies)
def get_mle_star():
    """Get MLE-STAR module (lazy import)."""
    from . import mle_star
    return mle_star

def get_automation():
    """Get automation module (lazy import)."""
    from . import automation
    return automation

def get_advanced_metrics():
    """Get advanced metrics module (lazy import)."""
    from . import advanced_metrics
    return advanced_metrics

def get_collective():
    """Get collective intelligence module (lazy import)."""
    from . import collective
    return collective

def get_claude_optimizer():
    """Get CLAUDE.md optimizer module (lazy import)."""
    from . import claude_optimizer
    return claude_optimizer

# Backward compatibility exports
__all__ = [
    # Core (backward compatible)
    "Task",
    "Agent", 
    "Result",
    "Benchmark",
    "BenchmarkEngine",
    
    # New interfaces
    "BenchmarkInterface",
    "MetricsCollectorInterface", 
    "AsyncBenchmarkBase",
    "EnsembleBenchmark",
    "BenchmarkContext",
    "ExecutionResult",
    "BenchmarkStatus",
    
    # Configuration
    "UnifiedConfig",
    "ConfigManager",
    "config",
    
    # Module accessors
    "get_mle_star",
    "get_automation", 
    "get_advanced_metrics",
    "get_collective",
    "get_claude_optimizer",
    
    # Metadata
    "__version__",
]

# Module-level configuration
def initialize_config(config_path=None):
    """Initialize configuration with optional config file."""
    if config_path:
        config.load_config_file(config_path)
    return config

def get_version_info():
    """Get detailed version information."""
    return {
        "version": __version__,
        "author": __author__,
        "email": __email__,
        "modules": [
            "core",
            "mle_star", 
            "automation",
            "advanced_metrics",
            "collective",
            "claude_optimizer",
            "config"
        ]
    }