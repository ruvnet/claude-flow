"""
MLE-STAR Foundation Framework

A comprehensive ML engineering framework that integrates with Claude Flow's
distributed coordination system for intelligent model development and optimization.
"""

from .models.base import MLESTARModel, SupervisedModel, UnsupervisedModel, ReinforcementModel
from .pipelines.data_pipeline import DataPipeline, DataConfig
from .evaluation.evaluator import ModelEvaluator, EvalConfig
from .utils.coordination import MLCoordinator
from .config.ml_config import MLConfig

__version__ = "1.0.0"
__author__ = "Claude Flow Foundation Agent"

__all__ = [
    "MLESTARModel",
    "SupervisedModel", 
    "UnsupervisedModel",
    "ReinforcementModel",
    "DataPipeline",
    "DataConfig",
    "ModelEvaluator",
    "EvalConfig",
    "MLCoordinator",
    "MLConfig",
]