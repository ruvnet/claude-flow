"""Strategy framework for different swarm execution approaches."""

from .base_strategy import BaseStrategy
from .auto_strategy import AutoStrategy
from .research_strategy import ResearchStrategy
from .development_strategy import DevelopmentStrategy
from .analysis_strategy import AnalysisStrategy
from .testing_strategy import TestingStrategy
from .optimization_strategy import OptimizationStrategy
from .maintenance_strategy import MaintenanceStrategy

# Strategy registry
STRATEGY_REGISTRY = {
    "auto": AutoStrategy,
    "research": ResearchStrategy,
    "development": DevelopmentStrategy,
    "analysis": AnalysisStrategy,
    "testing": TestingStrategy,
    "optimization": OptimizationStrategy,
    "maintenance": MaintenanceStrategy,
}


def create_strategy(strategy_name: str) -> BaseStrategy:
    """Create a strategy instance by name.
    
    Args:
        strategy_name: Name of the strategy to create
        
    Returns:
        Strategy instance
        
    Raises:
        ValueError: If strategy name is not recognized
    """
    if strategy_name not in STRATEGY_REGISTRY:
        available = ", ".join(STRATEGY_REGISTRY.keys())
        raise ValueError(f"Unknown strategy '{strategy_name}'. Available: {available}")
    
    strategy_class = STRATEGY_REGISTRY[strategy_name]
    return strategy_class()


def get_available_strategies() -> list[str]:
    """Get list of available strategy names.
    
    Returns:
        List of strategy names
    """
    return list(STRATEGY_REGISTRY.keys())


__all__ = [
    "BaseStrategy",
    "AutoStrategy",
    "ResearchStrategy", 
    "DevelopmentStrategy",
    "AnalysisStrategy",
    "TestingStrategy",
    "OptimizationStrategy",
    "MaintenanceStrategy",
    "create_strategy",
    "get_available_strategies",
]