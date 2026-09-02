"""
MLE-STAR Ensemble Integration Module

This module provides ensemble learning capabilities with multiple model coordination,
voting strategies, consensus mechanisms, and performance tracking.
"""

from .ensemble_executor import MLEStarEnsembleExecutor, MLEStarConfig
from .voting_strategies import VotingStrategy, MajorityVoting, WeightedVoting, StackingEnsemble, BayesianAveraging
from .model_coordinator import ModelCoordinator, ModelAgent
from .performance_tracker import PerformanceTracker, EnsembleMetrics
from .ml_scenarios import MLScenarios, BenchmarkScenario, ClassificationScenario, RegressionScenario

__all__ = [
    'MLEStarEnsembleExecutor',
    'MLEStarConfig',
    'VotingStrategy',
    'MajorityVoting', 
    'WeightedVoting',
    'StackingEnsemble',
    'BayesianAveraging',
    'ModelCoordinator',
    'ModelAgent',
    'PerformanceTracker',
    'EnsembleMetrics',
    'MLScenarios',
    'BenchmarkScenario',
    'ClassificationScenario',
    'RegressionScenario'
]

__version__ = '1.0.0'