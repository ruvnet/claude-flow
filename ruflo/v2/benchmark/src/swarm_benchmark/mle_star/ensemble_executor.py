"""
MLE-STAR Ensemble Executor

Coordinates multiple ML models in an ensemble, implementing voting strategies,
consensus mechanisms, and performance tracking with parallel execution.
"""

import asyncio
import time
import logging
from typing import Dict, List, Any, Optional, Union
from dataclasses import dataclass
from abc import ABC, abstractmethod

from .voting_strategies import VotingStrategy, MajorityVoting
from .model_coordinator import ModelCoordinator, ModelAgent
from .performance_tracker import PerformanceTracker, EnsembleMetrics


@dataclass
class MLEStarConfig:
    """Configuration for MLE-STAR ensemble."""
    models: List[Dict[str, Any]]
    voting_strategy: str = "majority"
    ensemble_size: int = 5
    max_parallel: int = 8
    timeout: float = 300.0
    gpu_enabled: bool = False
    distributed: bool = False
    consensus_threshold: float = 0.7
    performance_targets: Dict[str, float] = None

    def __post_init__(self):
        if self.performance_targets is None:
            self.performance_targets = {
                "accuracy": 0.9,
                "training_time": 1800.0,  # 30 minutes
                "memory_usage": 8192.0,   # 8GB
                "gpu_utilization": 0.8
            }


@dataclass
class BenchmarkResult:
    """Result of ensemble benchmark execution."""
    task: str
    ensemble_size: int
    metrics: EnsembleMetrics
    final_output: Any
    execution_time: float
    model_performances: Dict[str, Dict[str, float]]
    consensus_details: Dict[str, Any]
    resource_usage: Dict[str, float]
    success: bool = True
    error_message: Optional[str] = None


class MLEStarEnsembleExecutor:
    """
    Execute MLE-STAR ensemble benchmarks with multiple models.
    
    This class coordinates multiple ML models in an ensemble,
    implementing voting strategies, consensus mechanisms, and
    performance tracking with full parallel execution support.
    """
    
    def __init__(self, config: MLEStarConfig):
        self.config = config
        self.models: List[ModelAgent] = []
        self.voting_strategy = self._create_voting_strategy()
        self.performance_tracker = PerformanceTracker()
        self.model_coordinator = ModelCoordinator(config.max_parallel)
        self.logger = logging.getLogger(__name__)
        
    def _create_voting_strategy(self) -> VotingStrategy:
        """Create voting strategy based on configuration."""
        from .voting_strategies import (
            WeightedVoting, StackingEnsemble, BayesianAveraging
        )
        
        strategy_map = {
            "majority": MajorityVoting(),
            "weighted": WeightedVoting(),
            "stacking": StackingEnsemble(),
            "bayesian": BayesianAveraging()
        }
        
        strategy = strategy_map.get(self.config.voting_strategy)
        if strategy is None:
            self.logger.warning(f"Unknown voting strategy: {self.config.voting_strategy}, using majority")
            strategy = MajorityVoting()
            
        return strategy
        
    async def execute_ensemble_benchmark(self, 
                                        task: str,
                                        dataset: Any) -> BenchmarkResult:
        """
        Execute a complete ensemble benchmark.
        
        Process:
        1. Initialize models in parallel
        2. Distribute data across models
        3. Collect predictions
        4. Apply voting strategy
        5. Measure consensus metrics
        6. Return comprehensive results
        """
        start_time = time.time()
        
        try:
            # Phase 1: Model Initialization
            self.logger.info(f"Initializing ensemble for task: {task}")
            init_start = time.time()
            await self._initialize_models_parallel()
            init_time = time.time() - init_start
            
            # Phase 2: Parallel Prediction
            self.logger.info("Starting parallel prediction phase")
            pred_start = time.time()
            predictions = await self._gather_predictions(dataset)
            pred_time = time.time() - pred_start
            
            # Phase 3: Consensus Building
            self.logger.info("Building consensus from predictions")
            consensus_start = time.time()
            final_prediction, consensus_details = await self._build_consensus(predictions)
            consensus_time = time.time() - consensus_start
            
            # Phase 4: Performance Analysis
            self.logger.info("Analyzing ensemble performance")
            metrics = await self._analyze_ensemble_performance(
                predictions, 
                final_prediction,
                {
                    "init_time": init_time,
                    "prediction_time": pred_time,
                    "consensus_time": consensus_time
                }
            )
            
            # Phase 5: Resource Usage Analysis
            resource_usage = await self._collect_resource_usage()
            
            total_time = time.time() - start_time
            
            return BenchmarkResult(
                task=task,
                ensemble_size=len(self.models),
                metrics=metrics,
                final_output=final_prediction,
                execution_time=total_time,
                model_performances=await self._collect_model_performances(),
                consensus_details=consensus_details,
                resource_usage=resource_usage,
                success=True
            )
            
        except Exception as e:
            self.logger.error(f"Benchmark execution failed: {str(e)}")
            return BenchmarkResult(
                task=task,
                ensemble_size=0,
                metrics=EnsembleMetrics(),
                final_output=None,
                execution_time=time.time() - start_time,
                model_performances={},
                consensus_details={},
                resource_usage={},
                success=False,
                error_message=str(e)
            )
    
    async def _initialize_models_parallel(self):
        """Initialize all models in parallel using swarm agents."""
        if not self.config.models:
            raise ValueError("No models configured for ensemble")
            
        init_tasks = []
        for i, model_config in enumerate(self.config.models):
            task = self._spawn_model_agent(f"model_{i}", model_config)
            init_tasks.append(task)
        
        try:
            # Execute model initialization in parallel
            self.models = await asyncio.gather(*init_tasks, return_exceptions=True)
            
            # Filter out failed initializations
            successful_models = []
            for i, model in enumerate(self.models):
                if isinstance(model, Exception):
                    self.logger.error(f"Model {i} initialization failed: {model}")
                else:
                    successful_models.append(model)
                    
            self.models = successful_models
            
            if not self.models:
                raise RuntimeError("All model initializations failed")
                
            self.logger.info(f"Successfully initialized {len(self.models)} models")
            
        except Exception as e:
            self.logger.error(f"Parallel model initialization failed: {e}")
            raise
        
    async def _spawn_model_agent(self, 
                                 agent_id: str, 
                                 model_config: Dict) -> ModelAgent:
        """Spawn a specialized ML agent for a model."""
        try:
            # Create model agent with configuration
            agent = await self.model_coordinator.spawn_agent(
                agent_id=agent_id,
                model_type=model_config.get("type", "generic"),
                capabilities=model_config.get("capabilities", []),
                hyperparameters=model_config.get("hyperparameters", {}),
                gpu_enabled=self.config.gpu_enabled
            )
            
            self.logger.debug(f"Spawned model agent: {agent_id}")
            return agent
            
        except Exception as e:
            self.logger.error(f"Failed to spawn model agent {agent_id}: {e}")
            raise
    
    async def _gather_predictions(self, dataset: Any) -> List[Any]:
        """Gather predictions from all models in parallel."""
        prediction_tasks = []
        
        for model in self.models:
            task = model.predict(dataset)
            prediction_tasks.append(task)
        
        try:
            predictions = await asyncio.gather(
                *prediction_tasks, 
                return_exceptions=True
            )
            
            # Filter out failed predictions
            valid_predictions = []
            for i, pred in enumerate(predictions):
                if isinstance(pred, Exception):
                    self.logger.warning(f"Model {i} prediction failed: {pred}")
                else:
                    valid_predictions.append(pred)
            
            if not valid_predictions:
                raise RuntimeError("All model predictions failed")
                
            return valid_predictions
            
        except Exception as e:
            self.logger.error(f"Prediction gathering failed: {e}")
            raise
    
    async def _build_consensus(self, predictions: List[Any]) -> tuple[Any, Dict[str, Any]]:
        """
        Build consensus from multiple model predictions.
        
        Returns:
            tuple: (final_prediction, consensus_details)
        """
        try:
            # Apply voting strategy
            final_prediction = await self.voting_strategy.vote(predictions)
            
            # Calculate consensus metrics
            consensus_details = {
                "voting_strategy": self.config.voting_strategy,
                "num_predictions": len(predictions),
                "consensus_strength": await self._calculate_consensus_strength(predictions, final_prediction),
                "agreement_matrix": await self._calculate_agreement_matrix(predictions),
                "confidence_scores": await self._calculate_confidence_scores(predictions)
            }
            
            return final_prediction, consensus_details
            
        except Exception as e:
            self.logger.error(f"Consensus building failed: {e}")
            raise
    
    async def _analyze_ensemble_performance(self, 
                                          predictions: List[Any],
                                          final_prediction: Any,
                                          timing_metrics: Dict[str, float]) -> EnsembleMetrics:
        """Analyze ensemble performance and return comprehensive metrics."""
        metrics = EnsembleMetrics()
        
        try:
            # Basic timing metrics
            metrics.init_time = timing_metrics["init_time"]
            metrics.prediction_time = timing_metrics["prediction_time"]
            metrics.consensus_time = timing_metrics["consensus_time"]
            metrics.total_time = sum(timing_metrics.values())
            
            # Ensemble-specific metrics
            metrics.ensemble_size = len(self.models)
            metrics.successful_predictions = len(predictions)
            metrics.consensus_strength = await self._calculate_consensus_strength(
                predictions, final_prediction
            )
            
            # Performance metrics
            if hasattr(final_prediction, 'accuracy'):
                metrics.accuracy = final_prediction.accuracy
            if hasattr(final_prediction, 'precision'):
                metrics.precision = final_prediction.precision
            if hasattr(final_prediction, 'recall'):
                metrics.recall = final_prediction.recall
                
            # Diversity metrics
            metrics.model_diversity = await self._calculate_model_diversity(predictions)
            metrics.prediction_variance = await self._calculate_prediction_variance(predictions)
            
            return metrics
            
        except Exception as e:
            self.logger.error(f"Performance analysis failed: {e}")
            return metrics
    
    async def _calculate_consensus_strength(self, 
                                          predictions: List[Any],
                                          final_prediction: Any) -> float:
        """Calculate how strongly the ensemble agrees on the final prediction."""
        try:
            if not predictions:
                return 0.0
                
            # Simple agreement calculation - can be enhanced based on prediction type
            agreements = 0
            for pred in predictions:
                if self._predictions_agree(pred, final_prediction):
                    agreements += 1
                    
            return agreements / len(predictions)
            
        except Exception as e:
            self.logger.error(f"Consensus strength calculation failed: {e}")
            return 0.0
    
    def _predictions_agree(self, pred1: Any, pred2: Any) -> bool:
        """Check if two predictions agree (basic implementation)."""
        try:
            # This is a simple implementation - should be enhanced based on prediction type
            if hasattr(pred1, 'argmax') and hasattr(pred2, 'argmax'):
                return pred1.argmax() == pred2.argmax()
            else:
                return str(pred1) == str(pred2)
        except:
            return False
    
    async def _calculate_agreement_matrix(self, predictions: List[Any]) -> List[List[float]]:
        """Calculate pairwise agreement matrix between predictions."""
        try:
            n = len(predictions)
            matrix = [[0.0 for _ in range(n)] for _ in range(n)]
            
            for i in range(n):
                for j in range(n):
                    if i == j:
                        matrix[i][j] = 1.0
                    else:
                        matrix[i][j] = 1.0 if self._predictions_agree(
                            predictions[i], predictions[j]
                        ) else 0.0
                        
            return matrix
            
        except Exception as e:
            self.logger.error(f"Agreement matrix calculation failed: {e}")
            return []
    
    async def _calculate_confidence_scores(self, predictions: List[Any]) -> List[float]:
        """Calculate confidence scores for each prediction."""
        try:
            scores = []
            for pred in predictions:
                if hasattr(pred, 'confidence'):
                    scores.append(float(pred.confidence))
                elif hasattr(pred, 'max'):
                    scores.append(float(pred.max()))
                else:
                    scores.append(1.0)  # Default confidence
                    
            return scores
            
        except Exception as e:
            self.logger.error(f"Confidence score calculation failed: {e}")
            return [1.0] * len(predictions)
    
    async def _calculate_model_diversity(self, predictions: List[Any]) -> float:
        """Calculate diversity score across model predictions."""
        try:
            if len(predictions) < 2:
                return 0.0
                
            # Simple diversity calculation based on pairwise disagreements
            total_pairs = 0
            disagreements = 0
            
            for i in range(len(predictions)):
                for j in range(i + 1, len(predictions)):
                    total_pairs += 1
                    if not self._predictions_agree(predictions[i], predictions[j]):
                        disagreements += 1
                        
            return disagreements / total_pairs if total_pairs > 0 else 0.0
            
        except Exception as e:
            self.logger.error(f"Model diversity calculation failed: {e}")
            return 0.0
    
    async def _calculate_prediction_variance(self, predictions: List[Any]) -> float:
        """Calculate variance in predictions."""
        try:
            # This is a simplified implementation
            # In practice, this would depend on the type of predictions
            if not predictions:
                return 0.0
                
            # For numerical predictions
            if all(hasattr(p, '__float__') for p in predictions):
                values = [float(p) for p in predictions]
                mean = sum(values) / len(values)
                variance = sum((x - mean) ** 2 for x in values) / len(values)
                return variance
            else:
                # For categorical predictions, use entropy-based measure
                return await self._calculate_model_diversity(predictions)
                
        except Exception as e:
            self.logger.error(f"Prediction variance calculation failed: {e}")
            return 0.0
    
    async def _collect_resource_usage(self) -> Dict[str, float]:
        """Collect resource usage metrics."""
        try:
            import psutil
            
            return {
                "cpu_percent": psutil.cpu_percent(),
                "memory_mb": psutil.virtual_memory().used / 1024 / 1024,
                "memory_percent": psutil.virtual_memory().percent,
                "disk_io_read": psutil.disk_io_counters().read_bytes if psutil.disk_io_counters() else 0,
                "disk_io_write": psutil.disk_io_counters().write_bytes if psutil.disk_io_counters() else 0,
                "network_sent": psutil.net_io_counters().bytes_sent if psutil.net_io_counters() else 0,
                "network_recv": psutil.net_io_counters().bytes_recv if psutil.net_io_counters() else 0
            }
        except ImportError:
            self.logger.warning("psutil not available, skipping resource usage collection")
            return {}
        except Exception as e:
            self.logger.error(f"Resource usage collection failed: {e}")
            return {}
    
    async def _collect_model_performances(self) -> Dict[str, Dict[str, float]]:
        """Collect individual model performance metrics."""
        performances = {}
        
        try:
            for i, model in enumerate(self.models):
                model_id = f"model_{i}"
                performances[model_id] = await model.get_performance_metrics()
                
        except Exception as e:
            self.logger.error(f"Model performance collection failed: {e}")
            
        return performances
    
    async def cleanup(self):
        """Clean up resources and terminate model agents."""
        try:
            cleanup_tasks = []
            for model in self.models:
                cleanup_tasks.append(model.cleanup())
                
            if cleanup_tasks:
                await asyncio.gather(*cleanup_tasks, return_exceptions=True)
                
            await self.model_coordinator.cleanup()
            self.logger.info("Ensemble cleanup completed")
            
        except Exception as e:
            self.logger.error(f"Cleanup failed: {e}")