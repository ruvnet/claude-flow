"""
Performance Tracker for MLE-STAR Ensemble

Tracks and analyzes performance metrics for ensemble models including
individual model performance, ensemble consensus metrics, and resource utilization.
"""

import time
import asyncio
import logging
import statistics
from typing import Dict, List, Any, Optional, Union
from dataclasses import dataclass, field
from datetime import datetime, timedelta
import json


@dataclass
class EnsembleMetrics:
    """Comprehensive metrics for ensemble performance."""
    # Timing metrics
    init_time: float = 0.0
    prediction_time: float = 0.0
    consensus_time: float = 0.0
    total_time: float = 0.0
    
    # Ensemble metrics
    ensemble_size: int = 0
    successful_predictions: int = 0
    consensus_strength: float = 0.0
    model_diversity: float = 0.0
    prediction_variance: float = 0.0
    
    # Performance metrics
    accuracy: Optional[float] = None
    precision: Optional[float] = None
    recall: Optional[float] = None
    f1_score: Optional[float] = None
    auc_score: Optional[float] = None
    
    # Resource metrics
    peak_memory_mb: float = 0.0
    avg_cpu_percent: float = 0.0
    gpu_utilization: float = 0.0
    
    # Quality metrics
    prediction_confidence: float = 0.0
    ensemble_agreement: float = 0.0
    error_rate: float = 0.0
    
    def to_dict(self) -> Dict[str, Any]:
        """Convert metrics to dictionary."""
        return {
            'timing': {
                'init_time': self.init_time,
                'prediction_time': self.prediction_time,
                'consensus_time': self.consensus_time,
                'total_time': self.total_time
            },
            'ensemble': {
                'ensemble_size': self.ensemble_size,
                'successful_predictions': self.successful_predictions,
                'consensus_strength': self.consensus_strength,
                'model_diversity': self.model_diversity,
                'prediction_variance': self.prediction_variance
            },
            'performance': {
                'accuracy': self.accuracy,
                'precision': self.precision,
                'recall': self.recall,
                'f1_score': self.f1_score,
                'auc_score': self.auc_score
            },
            'resources': {
                'peak_memory_mb': self.peak_memory_mb,
                'avg_cpu_percent': self.avg_cpu_percent,
                'gpu_utilization': self.gpu_utilization
            },
            'quality': {
                'prediction_confidence': self.prediction_confidence,
                'ensemble_agreement': self.ensemble_agreement,
                'error_rate': self.error_rate
            }
        }


@dataclass
class ModelPerformance:
    """Performance metrics for individual model."""
    model_id: str
    model_type: str = ""
    training_time: float = 0.0
    prediction_time: float = 0.0
    accuracy: Optional[float] = None
    precision: Optional[float] = None
    recall: Optional[float] = None
    f1_score: Optional[float] = None
    memory_usage_mb: float = 0.0
    cpu_utilization: float = 0.0
    error_count: int = 0
    prediction_count: int = 0
    confidence_scores: List[float] = field(default_factory=list)
    
    def get_success_rate(self) -> float:
        """Calculate success rate."""
        total_attempts = self.prediction_count + self.error_count
        return self.prediction_count / total_attempts if total_attempts > 0 else 0.0
    
    def get_avg_confidence(self) -> float:
        """Calculate average confidence score."""
        return statistics.mean(self.confidence_scores) if self.confidence_scores else 0.0


@dataclass
class BenchmarkHistory:
    """Historical benchmark results."""
    timestamp: datetime
    task_name: str
    ensemble_metrics: EnsembleMetrics
    model_performances: Dict[str, ModelPerformance]
    execution_context: Dict[str, Any] = field(default_factory=dict)


class PerformanceTracker:
    """
    Track and analyze performance metrics for MLE-STAR ensembles.
    
    Provides comprehensive performance tracking including timing, accuracy,
    resource usage, and consensus metrics across multiple benchmark runs.
    """
    
    def __init__(self):
        self.logger = logging.getLogger(__name__)
        self.model_performances: Dict[str, ModelPerformance] = {}
        self.benchmark_history: List[BenchmarkHistory] = []
        self.current_session_start: Optional[datetime] = None
        self._monitoring_active = False
        self._resource_monitor_task: Optional[asyncio.Task] = None
        self._resource_samples: List[Dict[str, float]] = []
        
    async def start_tracking_session(self, session_name: str = "default"):
        """Start a new tracking session."""
        self.current_session_start = datetime.now()
        self.model_performances.clear()
        self._resource_samples.clear()
        self._monitoring_active = True
        
        # Start resource monitoring
        self._resource_monitor_task = asyncio.create_task(self._monitor_resources())
        
        self.logger.info(f"Started tracking session: {session_name}")
    
    async def end_tracking_session(self):
        """End the current tracking session."""
        self._monitoring_active = False
        
        if self._resource_monitor_task:
            self._resource_monitor_task.cancel()
            try:
                await self._resource_monitor_task
            except asyncio.CancelledError:
                pass
        
        self.logger.info("Ended tracking session")
    
    async def _monitor_resources(self):
        """Monitor system resources continuously."""
        try:
            while self._monitoring_active:
                try:
                    resource_sample = await self._collect_resource_sample()
                    self._resource_samples.append(resource_sample)
                    await asyncio.sleep(1.0)  # Sample every second
                except Exception as e:
                    self.logger.error(f"Resource monitoring failed: {e}")
                    await asyncio.sleep(5.0)  # Wait longer on error
        except asyncio.CancelledError:
            self.logger.debug("Resource monitoring cancelled")
    
    async def _collect_resource_sample(self) -> Dict[str, float]:
        """Collect a single resource sample."""
        try:
            import psutil
            
            # CPU and memory
            cpu_percent = psutil.cpu_percent(interval=None)
            memory = psutil.virtual_memory()
            
            sample = {
                'timestamp': time.time(),
                'cpu_percent': cpu_percent,
                'memory_used_mb': memory.used / 1024 / 1024,
                'memory_percent': memory.percent
            }
            
            # Add disk I/O if available
            try:
                disk_io = psutil.disk_io_counters()
                if disk_io:
                    sample['disk_read_mb'] = disk_io.read_bytes / 1024 / 1024
                    sample['disk_write_mb'] = disk_io.write_bytes / 1024 / 1024
            except:
                pass
            
            # Add network I/O if available
            try:
                net_io = psutil.net_io_counters()
                if net_io:
                    sample['network_sent_mb'] = net_io.bytes_sent / 1024 / 1024
                    sample['network_recv_mb'] = net_io.bytes_recv / 1024 / 1024
            except:
                pass
            
            # Try to get GPU utilization if available
            try:
                gpu_util = await self._get_gpu_utilization()
                if gpu_util is not None:
                    sample['gpu_utilization'] = gpu_util
            except:
                pass
            
            return sample
            
        except ImportError:
            # psutil not available
            return {
                'timestamp': time.time(),
                'cpu_percent': 0.0,
                'memory_used_mb': 0.0,
                'memory_percent': 0.0
            }
        except Exception as e:
            self.logger.error(f"Resource sample collection failed: {e}")
            return {'timestamp': time.time()}
    
    async def _get_gpu_utilization(self) -> Optional[float]:
        """Get GPU utilization if available."""
        try:
            import GPUtil
            gpus = GPUtil.getGPUs()
            if gpus:
                return sum(gpu.load for gpu in gpus) / len(gpus)
        except ImportError:
            pass
        except Exception as e:
            self.logger.debug(f"GPU utilization check failed: {e}")
        
        return None
    
    def register_model(self, model_id: str, model_type: str = "unknown"):
        """Register a new model for tracking."""
        self.model_performances[model_id] = ModelPerformance(
            model_id=model_id,
            model_type=model_type
        )
        self.logger.debug(f"Registered model for tracking: {model_id}")
    
    def record_training_time(self, model_id: str, training_time: float):
        """Record training time for a model."""
        if model_id in self.model_performances:
            self.model_performances[model_id].training_time = training_time
            self.logger.debug(f"Recorded training time for {model_id}: {training_time:.2f}s")
    
    def record_prediction_time(self, model_id: str, prediction_time: float):
        """Record prediction time for a model."""
        if model_id in self.model_performances:
            self.model_performances[model_id].prediction_time = prediction_time
            self.model_performances[model_id].prediction_count += 1
            self.logger.debug(f"Recorded prediction time for {model_id}: {prediction_time:.2f}s")
    
    def record_model_accuracy(self, model_id: str, 
                             accuracy: Optional[float] = None,
                             precision: Optional[float] = None,
                             recall: Optional[float] = None,
                             f1_score: Optional[float] = None):
        """Record accuracy metrics for a model."""
        if model_id in self.model_performances:
            perf = self.model_performances[model_id]
            perf.accuracy = accuracy
            perf.precision = precision
            perf.recall = recall
            perf.f1_score = f1_score
            self.logger.debug(f"Recorded accuracy metrics for {model_id}")
    
    def record_model_error(self, model_id: str, error: str):
        """Record an error for a model."""
        if model_id in self.model_performances:
            self.model_performances[model_id].error_count += 1
            self.logger.debug(f"Recorded error for {model_id}: {error}")
    
    def record_prediction_confidence(self, model_id: str, confidence: float):
        """Record prediction confidence for a model."""
        if model_id in self.model_performances:
            self.model_performances[model_id].confidence_scores.append(confidence)
            self.logger.debug(f"Recorded confidence for {model_id}: {confidence:.3f}")
    
    async def calculate_ensemble_metrics(self, 
                                       predictions: List[Any],
                                       final_prediction: Any,
                                       timing_metrics: Dict[str, float],
                                       ground_truth: Optional[Any] = None) -> EnsembleMetrics:
        """Calculate comprehensive ensemble metrics."""
        metrics = EnsembleMetrics()
        
        # Timing metrics
        metrics.init_time = timing_metrics.get('init_time', 0.0)
        metrics.prediction_time = timing_metrics.get('prediction_time', 0.0)
        metrics.consensus_time = timing_metrics.get('consensus_time', 0.0)
        metrics.total_time = sum(timing_metrics.values())
        
        # Basic ensemble metrics
        metrics.ensemble_size = len(self.model_performances)
        metrics.successful_predictions = len([p for p in predictions if p is not None])
        
        # Calculate consensus and diversity metrics
        metrics.consensus_strength = await self._calculate_consensus_strength(predictions, final_prediction)
        metrics.model_diversity = await self._calculate_model_diversity(predictions)
        metrics.prediction_variance = await self._calculate_prediction_variance(predictions)
        
        # Calculate performance metrics if ground truth available
        if ground_truth is not None:
            accuracy_metrics = await self._calculate_accuracy_metrics(final_prediction, ground_truth)
            metrics.accuracy = accuracy_metrics.get('accuracy')
            metrics.precision = accuracy_metrics.get('precision')
            metrics.recall = accuracy_metrics.get('recall')
            metrics.f1_score = accuracy_metrics.get('f1_score')
            metrics.auc_score = accuracy_metrics.get('auc_score')
        
        # Resource metrics from monitoring
        resource_metrics = await self._calculate_resource_metrics()
        metrics.peak_memory_mb = resource_metrics.get('peak_memory_mb', 0.0)
        metrics.avg_cpu_percent = resource_metrics.get('avg_cpu_percent', 0.0)
        metrics.gpu_utilization = resource_metrics.get('gpu_utilization', 0.0)
        
        # Quality metrics
        metrics.prediction_confidence = await self._calculate_avg_confidence()
        metrics.ensemble_agreement = await self._calculate_ensemble_agreement(predictions)
        metrics.error_rate = await self._calculate_error_rate()
        
        return metrics
    
    async def _calculate_consensus_strength(self, predictions: List[Any], final_prediction: Any) -> float:
        """Calculate how strongly the ensemble agrees on the final prediction."""
        if not predictions or final_prediction is None:
            return 0.0
        
        try:
            agreements = 0
            for pred in predictions:
                if pred is not None and self._predictions_agree(pred, final_prediction):
                    agreements += 1
            
            return agreements / len(predictions)
        except Exception as e:
            self.logger.error(f"Consensus strength calculation failed: {e}")
            return 0.0
    
    async def _calculate_model_diversity(self, predictions: List[Any]) -> float:
        """Calculate diversity among model predictions."""
        if len(predictions) < 2:
            return 0.0
        
        try:
            valid_predictions = [p for p in predictions if p is not None]
            if len(valid_predictions) < 2:
                return 0.0
            
            disagreements = 0
            total_pairs = 0
            
            for i in range(len(valid_predictions)):
                for j in range(i + 1, len(valid_predictions)):
                    total_pairs += 1
                    if not self._predictions_agree(valid_predictions[i], valid_predictions[j]):
                        disagreements += 1
            
            return disagreements / total_pairs if total_pairs > 0 else 0.0
        except Exception as e:
            self.logger.error(f"Model diversity calculation failed: {e}")
            return 0.0
    
    async def _calculate_prediction_variance(self, predictions: List[Any]) -> float:
        """Calculate variance in predictions."""
        if not predictions:
            return 0.0
        
        try:
            valid_predictions = [p for p in predictions if p is not None]
            
            # For numerical predictions
            if all(isinstance(p, (int, float)) for p in valid_predictions):
                if len(valid_predictions) < 2:
                    return 0.0
                return statistics.variance(valid_predictions)
            
            # For other predictions, use diversity as proxy
            return await self._calculate_model_diversity(predictions)
            
        except Exception as e:
            self.logger.error(f"Prediction variance calculation failed: {e}")
            return 0.0
    
    def _predictions_agree(self, pred1: Any, pred2: Any, tolerance: float = 1e-6) -> bool:
        """Check if two predictions agree."""
        try:
            if isinstance(pred1, (int, float)) and isinstance(pred2, (int, float)):
                return abs(pred1 - pred2) <= tolerance
            elif hasattr(pred1, 'argmax') and hasattr(pred2, 'argmax'):
                return pred1.argmax() == pred2.argmax()
            else:
                return str(pred1) == str(pred2)
        except:
            return False
    
    async def _calculate_accuracy_metrics(self, prediction: Any, ground_truth: Any) -> Dict[str, float]:
        """Calculate accuracy metrics given prediction and ground truth."""
        metrics = {}
        
        try:
            # This is a simplified implementation
            # In practice, you'd use sklearn.metrics or similar
            
            if isinstance(prediction, (int, float)) and isinstance(ground_truth, (int, float)):
                # Regression metrics
                error = abs(prediction - ground_truth)
                metrics['mae'] = error
                metrics['mse'] = error ** 2
                
            elif hasattr(prediction, 'argmax') and hasattr(ground_truth, 'argmax'):
                # Classification metrics
                pred_class = prediction.argmax()
                true_class = ground_truth.argmax()
                metrics['accuracy'] = 1.0 if pred_class == true_class else 0.0
                
            else:
                # Generic accuracy
                metrics['accuracy'] = 1.0 if str(prediction) == str(ground_truth) else 0.0
                
        except Exception as e:
            self.logger.error(f"Accuracy calculation failed: {e}")
        
        return metrics
    
    async def _calculate_resource_metrics(self) -> Dict[str, float]:
        """Calculate resource usage metrics from monitoring samples."""
        if not self._resource_samples:
            return {}
        
        try:
            metrics = {}
            
            # Memory metrics
            memory_values = [s.get('memory_used_mb', 0) for s in self._resource_samples]
            if memory_values:
                metrics['peak_memory_mb'] = max(memory_values)
                metrics['avg_memory_mb'] = statistics.mean(memory_values)
            
            # CPU metrics
            cpu_values = [s.get('cpu_percent', 0) for s in self._resource_samples]
            if cpu_values:
                metrics['avg_cpu_percent'] = statistics.mean(cpu_values)
                metrics['peak_cpu_percent'] = max(cpu_values)
            
            # GPU metrics
            gpu_values = [s.get('gpu_utilization', 0) for s in self._resource_samples if 'gpu_utilization' in s]
            if gpu_values:
                metrics['gpu_utilization'] = statistics.mean(gpu_values)
                metrics['peak_gpu_utilization'] = max(gpu_values)
            
            return metrics
            
        except Exception as e:
            self.logger.error(f"Resource metrics calculation failed: {e}")
            return {}
    
    async def _calculate_avg_confidence(self) -> float:
        """Calculate average confidence across all models."""
        all_confidences = []
        
        for perf in self.model_performances.values():
            all_confidences.extend(perf.confidence_scores)
        
        return statistics.mean(all_confidences) if all_confidences else 0.0
    
    async def _calculate_ensemble_agreement(self, predictions: List[Any]) -> float:
        """Calculate how much the ensemble models agree."""
        return await self._calculate_consensus_strength(predictions, predictions[0] if predictions else None)
    
    async def _calculate_error_rate(self) -> float:
        """Calculate overall error rate."""
        total_attempts = 0
        total_errors = 0
        
        for perf in self.model_performances.values():
            total_attempts += perf.prediction_count + perf.error_count
            total_errors += perf.error_count
        
        return total_errors / total_attempts if total_attempts > 0 else 0.0
    
    def save_benchmark_result(self, 
                            task_name: str,
                            ensemble_metrics: EnsembleMetrics,
                            execution_context: Optional[Dict[str, Any]] = None):
        """Save benchmark result to history."""
        benchmark_result = BenchmarkHistory(
            timestamp=datetime.now(),
            task_name=task_name,
            ensemble_metrics=ensemble_metrics,
            model_performances=self.model_performances.copy(),
            execution_context=execution_context or {}
        )
        
        self.benchmark_history.append(benchmark_result)
        self.logger.info(f"Saved benchmark result for task: {task_name}")
    
    def get_performance_summary(self) -> Dict[str, Any]:
        """Get comprehensive performance summary."""
        summary = {
            'session_info': {
                'session_start': self.current_session_start.isoformat() if self.current_session_start else None,
                'total_benchmarks': len(self.benchmark_history),
                'total_models': len(self.model_performances)
            },
            'model_performances': {
                model_id: {
                    'model_type': perf.model_type,
                    'training_time': perf.training_time,
                    'avg_prediction_time': perf.prediction_time,
                    'success_rate': perf.get_success_rate(),
                    'avg_confidence': perf.get_avg_confidence(),
                    'accuracy': perf.accuracy,
                    'prediction_count': perf.prediction_count,
                    'error_count': perf.error_count
                }
                for model_id, perf in self.model_performances.items()
            },
            'benchmark_history': [
                {
                    'timestamp': result.timestamp.isoformat(),
                    'task_name': result.task_name,
                    'ensemble_metrics': result.ensemble_metrics.to_dict()
                }
                for result in self.benchmark_history
            ]
        }
        
        return summary
    
    def export_metrics_to_file(self, filepath: str):
        """Export all metrics to a JSON file."""
        try:
            summary = self.get_performance_summary()
            with open(filepath, 'w') as f:
                json.dump(summary, f, indent=2, default=str)
            self.logger.info(f"Exported metrics to: {filepath}")
        except Exception as e:
            self.logger.error(f"Failed to export metrics: {e}")
    
    def get_best_performing_models(self, metric: str = 'accuracy', top_k: int = 5) -> List[Dict[str, Any]]:
        """Get top performing models based on specified metric."""
        model_scores = []
        
        for model_id, perf in self.model_performances.items():
            score = None
            
            if metric == 'accuracy' and perf.accuracy is not None:
                score = perf.accuracy
            elif metric == 'success_rate':
                score = perf.get_success_rate()
            elif metric == 'confidence':
                score = perf.get_avg_confidence()
            elif metric == 'speed':
                score = -perf.prediction_time  # Negative for sorting (faster = better)
            
            if score is not None:
                model_scores.append({
                    'model_id': model_id,
                    'model_type': perf.model_type,
                    'score': score,
                    'metric': metric
                })
        
        # Sort by score (descending)
        model_scores.sort(key=lambda x: x['score'], reverse=True)
        
        return model_scores[:top_k]
    
    async def cleanup(self):
        """Clean up resources."""
        await self.end_tracking_session()
        self.benchmark_history.clear()
        self.model_performances.clear()
        self.logger.info("Performance tracker cleanup completed")