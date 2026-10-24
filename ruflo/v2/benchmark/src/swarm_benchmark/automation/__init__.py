"""
Automation module for non-interactive batch processing and workflow management.

This module provides comprehensive automation capabilities for the benchmark system,
including batch processing, pipeline management, autonomous workflow execution,
resource pooling, and intelligent decision-making.

Key Components:
- BatchProcessor: Process multiple tasks in parallel batches
- PipelineManager: Manage complex multi-stage workflows
- WorkflowExecutor: Execute autonomous workflows without human intervention
- ResourcePool: Manage and allocate computational resources
- DecisionEngine: Make autonomous decisions based on context and performance
"""

from .models import BenchmarkTask, BenchmarkResult
from .batch_processor import BatchProcessor, BatchConfig, BatchResult
from .pipeline_manager import PipelineManager, Pipeline, PipelineStage, PipelineResult
from .workflow_executor import WorkflowExecutor, WorkflowConfig, WorkflowResult
from .resource_pool import ResourcePool, ResourceConfig, ResourceAllocation, ResourceSpec
from .decision_engine import DecisionEngine, DecisionContext, DecisionResult, DecisionType

__all__ = [
    "BenchmarkTask",
    "BenchmarkResult",
    "BatchProcessor",
    "BatchConfig", 
    "BatchResult",
    "PipelineManager",
    "Pipeline",
    "PipelineStage",
    "PipelineResult",
    "WorkflowExecutor",
    "WorkflowConfig",
    "WorkflowResult",
    "ResourcePool",
    "ResourceConfig", 
    "ResourceAllocation",
    "ResourceSpec",
    "DecisionEngine",
    "DecisionContext",
    "DecisionResult",
    "DecisionType"
]