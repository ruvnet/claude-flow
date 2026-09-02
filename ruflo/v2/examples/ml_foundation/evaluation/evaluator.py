"""Model evaluation framework for MLE-STAR."""

from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from datetime import datetime
from typing import Any, Dict, List, Optional, Tuple, Union, Callable
import numpy as np
from ..models.base import MLESTARModel, ModelMetrics


@dataclass
class EvalConfig:
    """Configuration for model evaluation."""
    # Metrics to compute
    regression_metrics: List[str] = field(default_factory=lambda: [
        "mse", "rmse", "mae", "r2", "explained_variance"
    ])
    classification_metrics: List[str] = field(default_factory=lambda: [
        "accuracy", "precision", "recall", "f1", "auc_roc", "confusion_matrix"
    ])
    
    # Cross-validation settings
    cv_folds: int = 5
    cv_scoring: str = "accuracy"
    cv_random_state: int = 42
    
    # Evaluation settings
    test_size: float = 0.2
    validation_size: float = 0.2
    stratify: bool = True
    
    # Reporting settings
    generate_plots: bool = True
    save_predictions: bool = True
    detailed_report: bool = True
    
    # Performance settings
    parallel_evaluation: bool = True
    n_jobs: int = -1
    
    def to_dict(self) -> Dict[str, Any]:
        """Convert config to dictionary."""
        return {
            "regression_metrics": self.regression_metrics,
            "classification_metrics": self.classification_metrics,
            "cv_folds": self.cv_folds,
            "cv_scoring": self.cv_scoring,
            "cv_random_state": self.cv_random_state,
            "test_size": self.test_size,
            "validation_size": self.validation_size,
            "stratify": self.stratify,
            "generate_plots": self.generate_plots,
            "save_predictions": self.save_predictions,
            "detailed_report": self.detailed_report,
            "parallel_evaluation": self.parallel_evaluation,
            "n_jobs": self.n_jobs
        }


@dataclass
class EvaluationResult:
    """Results from model evaluation."""
    model_id: str
    evaluation_id: str
    timestamp: datetime
    
    # Core metrics
    metrics: Dict[str, float] = field(default_factory=dict)
    cross_validation_scores: Dict[str, List[float]] = field(default_factory=dict)
    
    # Predictions and errors
    predictions: Optional[np.ndarray] = None
    prediction_errors: Optional[np.ndarray] = None
    feature_importance: Optional[Dict[str, float]] = None
    
    # Performance data
    evaluation_time: float = 0.0
    memory_usage: float = 0.0
    
    # Additional results
    confusion_matrix: Optional[np.ndarray] = None
    classification_report: Optional[Dict[str, Any]] = None
    residuals: Optional[np.ndarray] = None
    
    # Model comparison data
    baseline_comparison: Optional[Dict[str, float]] = None
    statistical_tests: Optional[Dict[str, Any]] = None
    
    def to_dict(self) -> Dict[str, Any]:
        """Convert evaluation result to dictionary."""
        return {
            "model_id": self.model_id,
            "evaluation_id": self.evaluation_id,
            "timestamp": self.timestamp.isoformat(),
            "metrics": self.metrics,
            "cross_validation_scores": self.cross_validation_scores,
            "predictions": self.predictions.tolist() if self.predictions is not None else None,
            "prediction_errors": self.prediction_errors.tolist() if self.prediction_errors is not None else None,
            "feature_importance": self.feature_importance,
            "evaluation_time": self.evaluation_time,
            "memory_usage": self.memory_usage,
            "confusion_matrix": self.confusion_matrix.tolist() if self.confusion_matrix is not None else None,
            "classification_report": self.classification_report,
            "residuals": self.residuals.tolist() if self.residuals is not None else None,
            "baseline_comparison": self.baseline_comparison,
            "statistical_tests": self.statistical_tests
        }


class MetricsCalculator:
    """Calculates various ML evaluation metrics."""
    
    @staticmethod
    def regression_metrics(y_true: np.ndarray, y_pred: np.ndarray) -> Dict[str, float]:
        """Calculate regression metrics."""
        from sklearn.metrics import (
            mean_squared_error, mean_absolute_error, r2_score, 
            explained_variance_score
        )
        
        metrics = {}
        
        try:
            metrics["mse"] = mean_squared_error(y_true, y_pred)
            metrics["rmse"] = np.sqrt(metrics["mse"])
            metrics["mae"] = mean_absolute_error(y_true, y_pred)
            metrics["r2"] = r2_score(y_true, y_pred)
            metrics["explained_variance"] = explained_variance_score(y_true, y_pred)
            
            # Additional regression metrics
            residuals = y_true - y_pred
            metrics["mean_residual"] = np.mean(residuals)
            metrics["std_residual"] = np.std(residuals)
            metrics["max_error"] = np.max(np.abs(residuals))
            
        except Exception as e:
            print(f"Error calculating regression metrics: {e}")
        
        return metrics
    
    @staticmethod
    def classification_metrics(y_true: np.ndarray, y_pred: np.ndarray, 
                             y_pred_proba: Optional[np.ndarray] = None) -> Dict[str, Any]:
        """Calculate classification metrics."""
        from sklearn.metrics import (
            accuracy_score, precision_score, recall_score, f1_score,
            confusion_matrix, classification_report, roc_auc_score
        )
        
        metrics = {}
        
        try:
            metrics["accuracy"] = accuracy_score(y_true, y_pred)
            metrics["precision"] = precision_score(y_true, y_pred, average='weighted', zero_division=0)
            metrics["recall"] = recall_score(y_true, y_pred, average='weighted', zero_division=0)
            metrics["f1"] = f1_score(y_true, y_pred, average='weighted', zero_division=0)
            
            # Confusion matrix
            cm = confusion_matrix(y_true, y_pred)
            metrics["confusion_matrix"] = cm
            
            # Detailed classification report
            metrics["classification_report"] = classification_report(
                y_true, y_pred, output_dict=True, zero_division=0
            )
            
            # ROC AUC if probabilities provided
            if y_pred_proba is not None:
                try:
                    if y_pred_proba.shape[1] == 2:  # Binary classification
                        metrics["auc_roc"] = roc_auc_score(y_true, y_pred_proba[:, 1])
                    else:  # Multi-class
                        metrics["auc_roc"] = roc_auc_score(y_true, y_pred_proba, multi_class='ovr')
                except Exception:
                    pass
            
        except Exception as e:
            print(f"Error calculating classification metrics: {e}")
        
        return metrics
    
    @staticmethod
    def clustering_metrics(X: np.ndarray, labels: np.ndarray, 
                          true_labels: Optional[np.ndarray] = None) -> Dict[str, float]:
        """Calculate clustering metrics."""
        from sklearn.metrics import (
            silhouette_score, calinski_harabasz_score, davies_bouldin_score
        )
        
        metrics = {}
        
        try:
            # Internal metrics (don't require true labels)
            if len(np.unique(labels)) > 1:  # Need at least 2 clusters
                metrics["silhouette"] = silhouette_score(X, labels)
                metrics["calinski_harabasz"] = calinski_harabasz_score(X, labels)
                metrics["davies_bouldin"] = davies_bouldin_score(X, labels)
            
            # External metrics (require true labels)
            if true_labels is not None:
                from sklearn.metrics import (
                    adjusted_rand_score, normalized_mutual_info_score, 
                    homogeneity_score, completeness_score, v_measure_score
                )
                
                metrics["adjusted_rand"] = adjusted_rand_score(true_labels, labels)
                metrics["normalized_mutual_info"] = normalized_mutual_info_score(true_labels, labels)
                metrics["homogeneity"] = homogeneity_score(true_labels, labels)
                metrics["completeness"] = completeness_score(true_labels, labels)
                metrics["v_measure"] = v_measure_score(true_labels, labels)
            
        except Exception as e:
            print(f"Error calculating clustering metrics: {e}")
        
        return metrics


class CrossValidator:
    """Handles cross-validation for model evaluation."""
    
    def __init__(self, config: EvalConfig):
        """Initialize cross validator."""
        self.config = config
    
    def cross_validate(self, model: MLESTARModel, X: np.ndarray, 
                      y: np.ndarray) -> Dict[str, List[float]]:
        """Perform cross-validation on model."""
        from sklearn.model_selection import cross_val_score, StratifiedKFold, KFold
        
        results = {}
        
        try:
            # Choose cross-validation strategy
            if self.config.stratify and len(np.unique(y)) > 1:
                cv = StratifiedKFold(
                    n_splits=self.config.cv_folds, 
                    shuffle=True, 
                    random_state=self.config.cv_random_state
                )
            else:
                cv = KFold(
                    n_splits=self.config.cv_folds, 
                    shuffle=True, 
                    random_state=self.config.cv_random_state
                )
            
            # Custom scoring function for MLE-STAR models
            def mle_star_scorer(estimator, X_test, y_test):
                predictions = estimator.predict(X_test)
                metrics = estimator.evaluate(X_test, y_test)
                return metrics.validation_accuracy
            
            # Perform cross-validation
            scores = cross_val_score(
                model, X, y, 
                cv=cv, 
                scoring=mle_star_scorer,
                n_jobs=self.config.n_jobs if self.config.parallel_evaluation else 1
            )
            
            results[self.config.cv_scoring] = scores.tolist()
            results["mean_score"] = [np.mean(scores)]
            results["std_score"] = [np.std(scores)]
            
        except Exception as e:
            print(f"Error in cross-validation: {e}")
            results["error"] = [str(e)]
        
        return results
    
    def learning_curve(self, model: MLESTARModel, X: np.ndarray, 
                      y: np.ndarray) -> Dict[str, Any]:
        """Generate learning curves for the model."""
        from sklearn.model_selection import learning_curve
        
        try:
            train_sizes, train_scores, val_scores = learning_curve(
                model, X, y,
                cv=self.config.cv_folds,
                n_jobs=self.config.n_jobs if self.config.parallel_evaluation else 1,
                train_sizes=np.linspace(0.1, 1.0, 10),
                random_state=self.config.cv_random_state
            )
            
            return {
                "train_sizes": train_sizes.tolist(),
                "train_scores_mean": np.mean(train_scores, axis=1).tolist(),
                "train_scores_std": np.std(train_scores, axis=1).tolist(),
                "val_scores_mean": np.mean(val_scores, axis=1).tolist(),
                "val_scores_std": np.std(val_scores, axis=1).tolist()
            }
            
        except Exception as e:
            print(f"Error generating learning curve: {e}")
            return {"error": str(e)}


class ReportGenerator:
    """Generates comprehensive evaluation reports."""
    
    def __init__(self, config: EvalConfig):
        """Initialize report generator."""
        self.config = config
    
    def generate_report(self, evaluation_result: EvaluationResult) -> str:
        """Generate a comprehensive evaluation report."""
        report = [
            "Model Evaluation Report",
            "=" * 50,
            f"Model ID: {evaluation_result.model_id}",
            f"Evaluation ID: {evaluation_result.evaluation_id}",
            f"Timestamp: {evaluation_result.timestamp.isoformat()}",
            f"Evaluation Time: {evaluation_result.evaluation_time:.2f} seconds",
            f"Memory Usage: {evaluation_result.memory_usage:.2f} MB",
            "",
            "Performance Metrics",
            "-" * 20
        ]
        
        # Add metrics
        for metric_name, value in evaluation_result.metrics.items():
            if isinstance(value, float):
                report.append(f"{metric_name}: {value:.4f}")
            else:
                report.append(f"{metric_name}: {value}")
        
        # Add cross-validation results
        if evaluation_result.cross_validation_scores:
            report.append("\nCross-Validation Results")
            report.append("-" * 25)
            for cv_metric, scores in evaluation_result.cross_validation_scores.items():
                if scores and isinstance(scores[0], (int, float)):
                    mean_score = np.mean(scores)
                    std_score = np.std(scores)
                    report.append(f"{cv_metric}: {mean_score:.4f} (±{std_score:.4f})")
        
        # Add feature importance if available
        if evaluation_result.feature_importance:
            report.append("\nFeature Importance")
            report.append("-" * 18)
            sorted_features = sorted(
                evaluation_result.feature_importance.items(),
                key=lambda x: x[1], reverse=True
            )
            for feature, importance in sorted_features[:10]:  # Top 10
                report.append(f"{feature}: {importance:.4f}")
        
        # Add baseline comparison if available
        if evaluation_result.baseline_comparison:
            report.append("\nBaseline Comparison")
            report.append("-" * 19)
            for metric, improvement in evaluation_result.baseline_comparison.items():
                report.append(f"{metric} improvement: {improvement:.4f}")
        
        return "\n".join(report)
    
    def save_report(self, evaluation_result: EvaluationResult, 
                   filepath: str) -> bool:
        """Save evaluation report to file."""
        try:
            report = self.generate_report(evaluation_result)
            with open(filepath, 'w') as f:
                f.write(report)
            return True
        except Exception as e:
            print(f"Error saving report: {e}")
            return False


class ModelComparator:
    """Compares multiple models and their performance."""
    
    def __init__(self):
        """Initialize model comparator."""
        self.evaluation_results: List[EvaluationResult] = []
    
    def add_evaluation(self, result: EvaluationResult):
        """Add an evaluation result for comparison."""
        self.evaluation_results.append(result)
    
    def compare_models(self, metric: str = "accuracy") -> Dict[str, Any]:
        """Compare models based on specified metric."""
        if not self.evaluation_results:
            return {"error": "No evaluation results to compare"}
        
        comparison = {
            "metric": metric,
            "models": [],
            "best_model": None,
            "rankings": []
        }
        
        # Collect metric values for all models
        model_scores = []
        for result in self.evaluation_results:
            if metric in result.metrics:
                score = result.metrics[metric]
                model_scores.append({
                    "model_id": result.model_id,
                    "score": score,
                    "evaluation_id": result.evaluation_id
                })
        
        if not model_scores:
            return {"error": f"Metric '{metric}' not found in any evaluation"}
        
        # Sort by score (descending for most metrics)
        model_scores.sort(key=lambda x: x["score"], reverse=True)
        
        comparison["models"] = model_scores
        comparison["best_model"] = model_scores[0]
        comparison["rankings"] = [
            {"rank": i+1, **model} 
            for i, model in enumerate(model_scores)
        ]
        
        return comparison
    
    def statistical_comparison(self, metric: str = "accuracy") -> Dict[str, Any]:
        """Perform statistical comparison between models."""
        from scipy import stats
        
        if len(self.evaluation_results) < 2:
            return {"error": "Need at least 2 models for statistical comparison"}
        
        # Collect cross-validation scores
        cv_scores = {}
        for result in self.evaluation_results:
            if metric in result.cross_validation_scores:
                cv_scores[result.model_id] = result.cross_validation_scores[metric]
        
        if len(cv_scores) < 2:
            return {"error": f"Need CV scores for at least 2 models"}
        
        comparisons = {}
        model_ids = list(cv_scores.keys())
        
        # Pairwise t-tests
        for i in range(len(model_ids)):
            for j in range(i+1, len(model_ids)):
                model1, model2 = model_ids[i], model_ids[j]
                scores1, scores2 = cv_scores[model1], cv_scores[model2]
                
                # Paired t-test
                t_stat, p_value = stats.ttest_rel(scores1, scores2)
                
                comparison_key = f"{model1}_vs_{model2}"
                comparisons[comparison_key] = {
                    "t_statistic": t_stat,
                    "p_value": p_value,
                    "significant": p_value < 0.05,
                    "mean_diff": np.mean(scores1) - np.mean(scores2)
                }
        
        return {
            "metric": metric,
            "pairwise_comparisons": comparisons,
            "summary": {
                "total_comparisons": len(comparisons),
                "significant_differences": sum(
                    1 for comp in comparisons.values() 
                    if comp["significant"]
                )
            }
        }


class ModelEvaluator:
    """Main evaluator for MLE-STAR models."""
    
    def __init__(self, config: Optional[EvalConfig] = None):
        """Initialize model evaluator."""
        self.config = config or EvalConfig()
        self.metrics_calculator = MetricsCalculator()
        self.cross_validator = CrossValidator(self.config)
        self.report_generator = ReportGenerator(self.config)
        self.model_comparator = ModelComparator()
    
    def evaluate_model(self, model: MLESTARModel, X_test: np.ndarray, 
                      y_test: np.ndarray, X_train: Optional[np.ndarray] = None,
                      y_train: Optional[np.ndarray] = None) -> EvaluationResult:
        """Comprehensive model evaluation."""
        import time
        import uuid
        import psutil
        import os
        
        start_time = time.time()
        start_memory = psutil.Process(os.getpid()).memory_info().rss / 1024 / 1024
        
        # Create evaluation result
        result = EvaluationResult(
            model_id=model.model_id,
            evaluation_id=str(uuid.uuid4()).split('-')[0],
            timestamp=datetime.now()
        )
        
        try:
            # Get predictions
            predictions = model.predict(X_test)
            result.predictions = predictions
            
            # Calculate prediction errors
            if y_test is not None:
                result.prediction_errors = y_test - predictions
                result.residuals = result.prediction_errors
            
            # Determine task type and calculate appropriate metrics
            task_type = self._determine_task_type(model, y_test)
            
            if task_type == "regression":
                metrics = self.metrics_calculator.regression_metrics(y_test, predictions)
                result.metrics.update(metrics)
            elif task_type == "classification":
                # Get prediction probabilities if available
                try:
                    pred_proba = getattr(model, 'predict_proba', lambda x: None)(X_test)
                except:
                    pred_proba = None
                
                metrics = self.metrics_calculator.classification_metrics(
                    y_test, predictions, pred_proba
                )
                result.metrics.update(metrics)
                
                # Store confusion matrix separately
                if "confusion_matrix" in metrics:
                    result.confusion_matrix = metrics.pop("confusion_matrix")
                if "classification_report" in metrics:
                    result.classification_report = metrics.pop("classification_report")
            
            # Cross-validation if training data provided
            if X_train is not None and y_train is not None:
                cv_scores = self.cross_validator.cross_validate(model, X_train, y_train)
                result.cross_validation_scores = cv_scores
            
            # Feature importance if available
            try:
                if hasattr(model, 'feature_importances_'):
                    importances = model.feature_importances_
                    feature_names = [f"feature_{i}" for i in range(len(importances))]
                    result.feature_importance = dict(zip(feature_names, importances))
            except:
                pass
            
        except Exception as e:
            result.metrics["evaluation_error"] = str(e)
        
        # Record performance metrics
        end_time = time.time()
        end_memory = psutil.Process(os.getpid()).memory_info().rss / 1024 / 1024
        
        result.evaluation_time = end_time - start_time
        result.memory_usage = end_memory - start_memory
        
        return result
    
    def _determine_task_type(self, model: MLESTARModel, y: Optional[np.ndarray]) -> str:
        """Determine the type of ML task based on model and target data."""
        if hasattr(model, 'config') and hasattr(model.config, 'model_type'):
            if model.config.model_type in ["supervised"]:
                if y is not None:
                    # Check if targets are continuous or discrete
                    unique_values = len(np.unique(y))
                    total_values = len(y)
                    
                    # If unique values / total values ratio is low, likely classification
                    if unique_values / total_values < 0.1 or unique_values < 20:
                        return "classification"
                    else:
                        return "regression"
            elif model.config.model_type == "unsupervised":
                return "clustering"
            elif model.config.model_type == "reinforcement":
                return "reinforcement"
        
        # Default to regression
        return "regression"
    
    def batch_evaluate(self, models: List[MLESTARModel], X_test: np.ndarray,
                      y_test: np.ndarray) -> List[EvaluationResult]:
        """Evaluate multiple models in batch."""
        results = []
        
        for model in models:
            result = self.evaluate_model(model, X_test, y_test)
            results.append(result)
            self.model_comparator.add_evaluation(result)
        
        return results
    
    def generate_comparison_report(self, metric: str = "accuracy") -> Dict[str, Any]:
        """Generate a comparison report for all evaluated models."""
        return self.model_comparator.compare_models(metric)
    
    def save_evaluation_results(self, results: List[EvaluationResult], 
                               directory: str = "./evaluation_results"):
        """Save evaluation results to disk."""
        import os
        import json
        
        os.makedirs(directory, exist_ok=True)
        
        for result in results:
            filename = f"evaluation_{result.model_id}_{result.evaluation_id}.json"
            filepath = os.path.join(directory, filename)
            
            with open(filepath, 'w') as f:
                json.dump(result.to_dict(), f, indent=2)
            
            # Save detailed report
            report_filename = f"report_{result.model_id}_{result.evaluation_id}.txt"
            report_filepath = os.path.join(directory, report_filename)
            self.report_generator.save_report(result, report_filepath)