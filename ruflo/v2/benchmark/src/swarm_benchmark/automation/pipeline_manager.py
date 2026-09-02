"""
PipelineManager for complex benchmark pipelines with dependencies.

This module provides sophisticated pipeline management capabilities for orchestrating
multi-stage benchmark workflows with dependency resolution, parallel execution,
and comprehensive error handling.
"""

import asyncio
import time
import logging
from datetime import datetime, timedelta
from typing import List, Dict, Any, Optional, Callable, Set, Tuple
from dataclasses import dataclass, field
from enum import Enum
import networkx as nx
from abc import ABC, abstractmethod

from .models import BenchmarkTask, BenchmarkResult


class PipelineStatus(Enum):
    """Status of pipeline operations."""
    CREATED = "created"
    RUNNING = "running"
    PAUSED = "paused" 
    COMPLETED = "completed"
    FAILED = "failed"
    CANCELLED = "cancelled"


class StageStatus(Enum):
    """Status of individual pipeline stages."""
    PENDING = "pending"
    RUNNING = "running"
    COMPLETED = "completed"
    FAILED = "failed"
    SKIPPED = "skipped"


@dataclass
class StageExecution:
    """Execution tracking for a pipeline stage."""
    stage_name: str
    status: StageStatus = StageStatus.PENDING
    start_time: Optional[datetime] = None
    end_time: Optional[datetime] = None
    result: Optional[Any] = None
    error: Optional[str] = None
    retry_count: int = 0
    
    @property
    def duration(self) -> Optional[float]:
        """Get stage execution duration in seconds."""
        if self.start_time and self.end_time:
            return (self.end_time - self.start_time).total_seconds()
        return None


@dataclass
class PipelineExecution:
    """Execution tracking for entire pipeline."""
    pipeline_name: str
    context: Dict[str, Any]
    status: PipelineStatus = PipelineStatus.CREATED
    start_time: datetime = field(default_factory=datetime.now)
    end_time: Optional[datetime] = None
    stage_executions: Dict[str, StageExecution] = field(default_factory=dict)
    error: Optional[str] = None
    
    def to_result(self) -> 'PipelineResult':
        """Convert execution to result object."""
        return PipelineResult(
            pipeline_name=self.pipeline_name,
            status=self.status,
            start_time=self.start_time,
            end_time=self.end_time,
            total_duration=(self.end_time - self.start_time).total_seconds() if self.end_time else None,
            stage_results={name: exec for name, exec in self.stage_executions.items()},
            context=self.context,
            error=self.error
        )


@dataclass
class PipelineResult:
    """Result of pipeline execution."""
    pipeline_name: str
    status: PipelineStatus
    start_time: datetime
    end_time: Optional[datetime]
    total_duration: Optional[float]
    stage_results: Dict[str, StageExecution]
    context: Dict[str, Any]
    error: Optional[str] = None
    
    @property
    def success_rate(self) -> float:
        """Calculate success rate of stages."""
        if not self.stage_results:
            return 0.0
            
        completed = sum(1 for stage in self.stage_results.values() 
                       if stage.status == StageStatus.COMPLETED)
        return completed / len(self.stage_results)
    
    @property
    def failed_stages(self) -> List[str]:
        """Get list of failed stage names."""
        return [name for name, stage in self.stage_results.items() 
                if stage.status == StageStatus.FAILED]


class PipelineStage(ABC):
    """Abstract base class for pipeline stages."""
    
    def __init__(self, name: str, dependencies: List[str] = None):
        self.name = name
        self.dependencies = dependencies or []
        self.max_retries = 3
        self.retry_delay = 1.0
        
    @abstractmethod
    async def execute(self, context: Dict[str, Any]) -> Any:
        """
        Execute the stage with given context.
        
        Args:
            context: Shared execution context
            
        Returns:
            Stage execution result
        """
        pass
    
    async def validate_preconditions(self, context: Dict[str, Any]) -> bool:
        """
        Validate stage preconditions.
        
        Args:
            context: Shared execution context
            
        Returns:
            True if preconditions are met
        """
        return True
    
    async def cleanup(self, context: Dict[str, Any]):
        """
        Cleanup after stage execution.
        
        Args:
            context: Shared execution context
        """
        pass


class BenchmarkStage(PipelineStage):
    """Stage that executes benchmark tasks."""
    
    def __init__(self, name: str, tasks: List[BenchmarkTask], dependencies: List[str] = None):
        super().__init__(name, dependencies)
        self.tasks = tasks
        
    async def execute(self, context: Dict[str, Any]) -> List[BenchmarkResult]:
        """Execute benchmark tasks."""
        results = []
        
        for task in self.tasks:
            # Execute task (placeholder implementation)
            start_time = time.time()
            await asyncio.sleep(0.1)  # Simulate work
            execution_time = time.time() - start_time
            
            result = BenchmarkResult(
                task_id=task.id,
                status="completed",
                execution_time=execution_time,
                metrics={"stage": self.name},
                timestamp=datetime.now()
            )
            results.append(result)
            
        return results


class DataPreparationStage(PipelineStage):
    """Stage for data preparation and validation."""
    
    def __init__(self, name: str, data_sources: List[str], dependencies: List[str] = None):
        super().__init__(name, dependencies)
        self.data_sources = data_sources
        
    async def execute(self, context: Dict[str, Any]) -> Dict[str, Any]:
        """Prepare and validate data sources."""
        prepared_data = {}
        
        for source in self.data_sources:
            # Simulate data preparation
            await asyncio.sleep(0.05)
            prepared_data[source] = {
                "status": "ready",
                "records": 1000,
                "validation": "passed"
            }
            
        context["prepared_data"] = prepared_data
        return prepared_data


class ModelTrainingStage(PipelineStage):
    """Stage for model training operations."""
    
    def __init__(self, name: str, model_configs: List[Dict], dependencies: List[str] = None):
        super().__init__(name, dependencies)
        self.model_configs = model_configs
        
    async def execute(self, context: Dict[str, Any]) -> Dict[str, Any]:
        """Train models based on configurations."""
        trained_models = {}
        
        # Execute model training in parallel
        training_tasks = []
        for config in self.model_configs:
            training_tasks.append(self._train_model(config))
            
        results = await asyncio.gather(*training_tasks, return_exceptions=True)
        
        for i, result in enumerate(results):
            if isinstance(result, Exception):
                trained_models[f"model_{i}"] = {"status": "failed", "error": str(result)}
            else:
                trained_models[f"model_{i}"] = result
                
        context["trained_models"] = trained_models
        return trained_models
    
    async def _train_model(self, config: Dict) -> Dict[str, Any]:
        """Train a single model."""
        # Simulate model training
        training_time = config.get("training_time", 2.0)
        await asyncio.sleep(training_time)
        
        return {
            "status": "completed",
            "accuracy": 0.85 + (hash(str(config)) % 100) / 1000,  # Mock accuracy
            "training_time": training_time,
            "config": config
        }


class EvaluationStage(PipelineStage):
    """Stage for model evaluation and validation."""
    
    def __init__(self, name: str, evaluation_metrics: List[str], dependencies: List[str] = None):
        super().__init__(name, dependencies)
        self.evaluation_metrics = evaluation_metrics
        
    async def execute(self, context: Dict[str, Any]) -> Dict[str, Any]:
        """Evaluate trained models."""
        trained_models = context.get("trained_models", {})
        evaluation_results = {}
        
        for model_name, model_data in trained_models.items():
            if model_data.get("status") == "completed":
                # Simulate evaluation
                await asyncio.sleep(0.1)
                
                metrics = {}
                for metric in self.evaluation_metrics:
                    # Generate mock metric values
                    metrics[metric] = 0.8 + (hash(f"{model_name}_{metric}") % 200) / 1000
                
                evaluation_results[model_name] = {
                    "metrics": metrics,
                    "validation_passed": all(v > 0.7 for v in metrics.values())
                }
                
        context["evaluation_results"] = evaluation_results
        return evaluation_results


class ReportGenerationStage(PipelineStage):
    """Stage for generating benchmark reports."""
    
    def __init__(self, name: str, report_formats: List[str], dependencies: List[str] = None):
        super().__init__(name, dependencies)
        self.report_formats = report_formats
        
    async def execute(self, context: Dict[str, Any]) -> Dict[str, Any]:
        """Generate reports from pipeline results."""
        reports = {}
        
        for format_type in self.report_formats:
            # Generate report in specified format
            await asyncio.sleep(0.2)
            
            reports[format_type] = {
                "status": "generated",
                "file_path": f"/tmp/report_{datetime.now().strftime('%Y%m%d_%H%M%S')}.{format_type}",
                "size_kb": 156,
                "generated_at": datetime.now().isoformat()
            }
            
        context["reports"] = reports
        return reports


class Pipeline:
    """
    Pipeline for orchestrating complex multi-stage workflows.
    
    Supports:
    - Stage dependencies and execution order
    - Parallel stage execution where possible
    - Error handling and recovery
    - Context sharing between stages
    - Pipeline validation and optimization
    """
    
    def __init__(self, name: str):
        self.name = name
        self.stages: List[PipelineStage] = []
        self.dependency_graph = nx.DiGraph()
        
    def add_stage(self, stage: PipelineStage):
        """Add a stage to the pipeline."""
        self.stages.append(stage)
        self.dependency_graph.add_node(stage.name)
        
        # Add dependency edges
        for dependency in stage.dependencies:
            self.dependency_graph.add_edge(dependency, stage.name)
    
    def validate_dependencies(self) -> Tuple[bool, List[str]]:
        """
        Validate pipeline dependencies.
        
        Returns:
            Tuple of (is_valid, error_messages)
        """
        errors = []
        
        # Check for circular dependencies
        if not nx.is_directed_acyclic_graph(self.dependency_graph):
            cycles = list(nx.simple_cycles(self.dependency_graph))
            errors.append(f"Circular dependencies detected: {cycles}")
        
        # Check for missing dependencies
        stage_names = {stage.name for stage in self.stages}
        for stage in self.stages:
            for dependency in stage.dependencies:
                if dependency not in stage_names:
                    errors.append(f"Stage '{stage.name}' depends on missing stage '{dependency}'")
        
        return len(errors) == 0, errors
    
    def get_execution_order(self) -> List[List[str]]:
        """
        Get optimal execution order with parallel opportunities.
        
        Returns:
            List of stage groups that can be executed in parallel
        """
        # Topological sort to get dependency order
        try:
            topo_order = list(nx.topological_sort(self.dependency_graph))
        except nx.NetworkXError:
            # Handle case where graph has cycles
            return [[stage.name for stage in self.stages]]
        
        # Group stages that can run in parallel
        execution_groups = []
        processed = set()
        
        while len(processed) < len(topo_order):
            # Find all stages whose dependencies are satisfied
            parallel_group = []
            for stage_name in topo_order:
                if stage_name in processed:
                    continue
                    
                # Check if all dependencies are processed
                stage = next(s for s in self.stages if s.name == stage_name)
                if all(dep in processed for dep in stage.dependencies):
                    parallel_group.append(stage_name)
            
            if parallel_group:
                execution_groups.append(parallel_group)
                processed.update(parallel_group)
            else:
                # Fallback: process remaining stages one by one
                remaining = [name for name in topo_order if name not in processed]
                if remaining:
                    execution_groups.append([remaining[0]])
                    processed.add(remaining[0])
        
        return execution_groups


class PipelineManager:
    """
    Manage complex benchmark pipelines with dependencies.
    
    Features:
    - Pipeline creation and validation
    - Dependency resolution and optimization  
    - Parallel execution where possible
    - Error recovery and retry logic
    - Pipeline templates and reusability
    - Execution history and analytics
    """
    
    def __init__(self):
        self.pipelines: Dict[str, Pipeline] = {}
        self.execution_history: List[PipelineExecution] = []
        self.logger = logging.getLogger(self.__class__.__name__)
        
    def create_pipeline(self, 
                       name: str,
                       stages: List[PipelineStage]) -> Pipeline:
        """
        Create a new benchmark pipeline.
        
        Example pipeline:
        1. Data preparation stage
        2. Model training stage (parallel)
        3. Evaluation stage
        4. Report generation stage
        
        Args:
            name: Pipeline identifier
            stages: List of pipeline stages
            
        Returns:
            Created pipeline instance
        """
        pipeline = Pipeline(name=name)
        
        for stage in stages:
            pipeline.add_stage(stage)
        
        # Validate dependencies
        is_valid, errors = pipeline.validate_dependencies()
        if not is_valid:
            raise ValueError(f"Pipeline validation failed: {'; '.join(errors)}")
        
        self.pipelines[name] = pipeline
        return pipeline
    
    def create_ml_pipeline(self, name: str, config: Dict[str, Any]) -> Pipeline:
        """Create a machine learning benchmark pipeline."""
        stages = [
            DataPreparationStage(
                name="data_prep",
                data_sources=config.get("data_sources", ["dataset1", "dataset2"])
            ),
            ModelTrainingStage(
                name="model_training", 
                model_configs=config.get("model_configs", [{"type": "rf"}, {"type": "svm"}]),
                dependencies=["data_prep"]
            ),
            EvaluationStage(
                name="evaluation",
                evaluation_metrics=config.get("metrics", ["accuracy", "precision", "recall"]),
                dependencies=["model_training"] 
            ),
            ReportGenerationStage(
                name="reporting",
                report_formats=config.get("report_formats", ["json", "html"]),
                dependencies=["evaluation"]
            )
        ]
        
        return self.create_pipeline(name, stages)
    
    def create_benchmark_pipeline(self, name: str, task_groups: List[List[BenchmarkTask]]) -> Pipeline:
        """Create a benchmark execution pipeline."""
        stages = []
        
        for i, task_group in enumerate(task_groups):
            stage_name = f"benchmark_stage_{i}"
            dependencies = [f"benchmark_stage_{i-1}"] if i > 0 else []
            
            stage = BenchmarkStage(
                name=stage_name,
                tasks=task_group,
                dependencies=dependencies
            )
            stages.append(stage)
        
        return self.create_pipeline(name, stages)
    
    async def execute_pipeline(self, 
                              pipeline_name: str,
                              context: Dict[str, Any] = None) -> PipelineResult:
        """Execute a complete pipeline."""
        if pipeline_name not in self.pipelines:
            raise ValueError(f"Pipeline not found: {pipeline_name}")
        
        pipeline = self.pipelines[pipeline_name]
        context = context or {}
        
        execution = PipelineExecution(
            pipeline_name=pipeline_name,
            context=context,
            start_time=datetime.now()
        )
        
        self.logger.info(f"Starting pipeline execution: {pipeline_name}")
        
        try:
            execution.status = PipelineStatus.RUNNING
            
            # Get optimal execution order
            execution_groups = pipeline.get_execution_order()
            
            # Execute stages in dependency order
            for group in execution_groups:
                await self._execute_stage_group(pipeline, group, execution)
            
            execution.status = PipelineStatus.COMPLETED
            self.logger.info(f"Pipeline completed successfully: {pipeline_name}")
            
        except Exception as e:
            execution.status = PipelineStatus.FAILED
            execution.error = str(e)
            self.logger.error(f"Pipeline execution failed: {pipeline_name}, Error: {str(e)}")
            
        finally:
            execution.end_time = datetime.now()
            self.execution_history.append(execution)
            
        return execution.to_result()
    
    async def _execute_stage_group(self, 
                                  pipeline: Pipeline,
                                  stage_names: List[str],
                                  execution: PipelineExecution):
        """Execute a group of stages in parallel."""
        stages = [s for s in pipeline.stages if s.name in stage_names]
        
        # Execute stages in parallel
        stage_tasks = []
        for stage in stages:
            task = asyncio.create_task(self._execute_stage(stage, execution))
            stage_tasks.append(task)
        
        # Wait for all stages to complete
        await asyncio.gather(*stage_tasks, return_exceptions=True)
        
        # Check if any stages failed
        failed_stages = [name for name in stage_names 
                        if execution.stage_executions[name].status == StageStatus.FAILED]
        
        if failed_stages:
            raise Exception(f"Stages failed: {failed_stages}")
    
    async def _execute_stage(self, stage: PipelineStage, execution: PipelineExecution):
        """Execute a single stage with error handling and retry logic."""
        stage_exec = StageExecution(stage_name=stage.name)
        execution.stage_executions[stage.name] = stage_exec
        
        self.logger.info(f"Executing stage: {stage.name}")
        
        # Retry logic
        for attempt in range(stage.max_retries):
            try:
                stage_exec.status = StageStatus.RUNNING
                stage_exec.start_time = datetime.now()
                stage_exec.retry_count = attempt
                
                # Validate preconditions
                if not await stage.validate_preconditions(execution.context):
                    raise Exception("Stage preconditions not met")
                
                # Execute stage
                result = await stage.execute(execution.context)
                stage_exec.result = result
                stage_exec.status = StageStatus.COMPLETED
                stage_exec.end_time = datetime.now()
                
                self.logger.info(f"Stage completed: {stage.name} in {stage_exec.duration:.2f}s")
                break
                
            except Exception as e:
                stage_exec.error = str(e)
                self.logger.warning(f"Stage attempt {attempt + 1} failed: {stage.name}, Error: {str(e)}")
                
                if attempt < stage.max_retries - 1:
                    await asyncio.sleep(stage.retry_delay * (2 ** attempt))  # Exponential backoff
                else:
                    stage_exec.status = StageStatus.FAILED
                    stage_exec.end_time = datetime.now()
                    raise
        
        # Cleanup
        try:
            await stage.cleanup(execution.context)
        except Exception as e:
            self.logger.warning(f"Stage cleanup failed: {stage.name}, Error: {str(e)}")
    
    def get_pipeline_template(self, template_name: str) -> Dict[str, Any]:
        """Get predefined pipeline template."""
        templates = {
            "ml_classification": {
                "data_sources": ["training_set", "validation_set", "test_set"],
                "model_configs": [
                    {"type": "random_forest", "n_estimators": 100},
                    {"type": "gradient_boost", "n_estimators": 100}, 
                    {"type": "neural_network", "layers": [100, 50, 10]},
                    {"type": "svm", "kernel": "rbf"}
                ],
                "metrics": ["accuracy", "precision", "recall", "f1_score"],
                "report_formats": ["json", "html", "pdf"]
            },
            "performance_benchmark": {
                "preparation_tasks": ["system_info", "baseline_measurement"],
                "benchmark_suites": ["cpu_intensive", "memory_intensive", "io_intensive"],
                "analysis_tasks": ["statistical_analysis", "trend_analysis"],
                "report_formats": ["json", "csv", "html"]
            }
        }
        
        return templates.get(template_name, {})
    
    def get_execution_history(self, pipeline_name: Optional[str] = None) -> List[PipelineExecution]:
        """Get execution history, optionally filtered by pipeline name."""
        if pipeline_name:
            return [exec for exec in self.execution_history if exec.pipeline_name == pipeline_name]
        return self.execution_history.copy()
    
    def get_pipeline_analytics(self, pipeline_name: str) -> Dict[str, Any]:
        """Get analytics for a specific pipeline."""
        executions = self.get_execution_history(pipeline_name)
        
        if not executions:
            return {"error": "No execution history found"}
        
        completed = [e for e in executions if e.status == PipelineStatus.COMPLETED]
        failed = [e for e in executions if e.status == PipelineStatus.FAILED]
        
        avg_duration = 0
        if completed:
            durations = [(e.end_time - e.start_time).total_seconds() for e in completed if e.end_time]
            avg_duration = sum(durations) / len(durations) if durations else 0
        
        return {
            "total_executions": len(executions),
            "completed_executions": len(completed),
            "failed_executions": len(failed),
            "success_rate": len(completed) / len(executions) if executions else 0,
            "average_duration_seconds": avg_duration,
            "last_execution": executions[-1].start_time.isoformat() if executions else None
        }