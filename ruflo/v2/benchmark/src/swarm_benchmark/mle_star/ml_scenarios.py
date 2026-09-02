"""
ML Benchmark Scenarios for MLE-STAR Ensemble

Provides predefined benchmark scenarios for testing ensemble learning
capabilities including classification, regression, and specialized ML tasks.
"""

import asyncio
import logging
import numpy as np
from typing import Dict, List, Any, Optional, Tuple, Union
from dataclasses import dataclass
from abc import ABC, abstractmethod
from enum import Enum


class TaskType(Enum):
    """Types of ML tasks."""
    CLASSIFICATION = "classification"
    REGRESSION = "regression"
    CLUSTERING = "clustering"
    DIMENSIONALITY_REDUCTION = "dimensionality_reduction"
    ANOMALY_DETECTION = "anomaly_detection"
    TIME_SERIES = "time_series"
    NLP = "natural_language_processing"
    COMPUTER_VISION = "computer_vision"


class DatasetSize(Enum):
    """Dataset size categories."""
    SMALL = "small"      # < 1K samples
    MEDIUM = "medium"    # 1K - 10K samples
    LARGE = "large"      # 10K - 100K samples
    XLARGE = "xlarge"    # > 100K samples


@dataclass
class BenchmarkScenario:
    """Configuration for a benchmark scenario."""
    name: str
    description: str
    task_type: TaskType
    models: List[Dict[str, Any]]
    voting_strategy: str
    metrics: List[str]
    dataset_config: Dict[str, Any]
    performance_targets: Dict[str, float]
    timeout_seconds: float = 300.0
    max_parallel_models: int = 8
    cross_validation_folds: int = 5
    random_seed: int = 42


@dataclass
class DatasetInfo:
    """Information about a generated dataset."""
    X_train: Any
    X_test: Any
    y_train: Any
    y_test: Any
    feature_names: List[str]
    target_names: List[str]
    dataset_size: DatasetSize
    n_features: int
    n_classes: Optional[int] = None


class BaseScenario(ABC):
    """Base class for benchmark scenarios."""
    
    def __init__(self, scenario_config: BenchmarkScenario):
        self.config = scenario_config
        self.logger = logging.getLogger(f"{__name__}.{scenario_config.name}")
        
    @abstractmethod
    async def generate_dataset(self) -> DatasetInfo:
        """Generate or load dataset for the scenario."""
        pass
    
    @abstractmethod
    async def evaluate_predictions(self, predictions: Any, ground_truth: Any) -> Dict[str, float]:
        """Evaluate predictions against ground truth."""
        pass
    
    async def run_scenario(self) -> Dict[str, Any]:
        """Run the complete benchmark scenario."""
        self.logger.info(f"Starting benchmark scenario: {self.config.name}")
        
        try:
            # Generate dataset
            dataset = await self.generate_dataset()
            
            # Initialize ensemble
            from .ensemble_executor import MLEStarEnsembleExecutor, MLEStarConfig
            
            ensemble_config = MLEStarConfig(
                models=self.config.models,
                voting_strategy=self.config.voting_strategy,
                ensemble_size=len(self.config.models),
                max_parallel=self.config.max_parallel_models,
                timeout=self.config.timeout_seconds
            )
            
            ensemble = MLEStarEnsembleExecutor(ensemble_config)
            
            # Run benchmark
            result = await ensemble.execute_ensemble_benchmark(
                task=self.config.name,
                dataset=dataset
            )
            
            # Evaluate results
            if result.success:
                evaluation = await self.evaluate_predictions(
                    result.final_output,
                    dataset.y_test
                )
                result.metrics.accuracy = evaluation.get('accuracy')
                result.metrics.precision = evaluation.get('precision')
                result.metrics.recall = evaluation.get('recall')
                result.metrics.f1_score = evaluation.get('f1_score')
            
            # Cleanup
            await ensemble.cleanup()
            
            return {
                'scenario': self.config.name,
                'success': result.success,
                'metrics': result.metrics.to_dict(),
                'dataset_info': {
                    'size': dataset.dataset_size.value,
                    'n_features': dataset.n_features,
                    'n_classes': dataset.n_classes
                },
                'performance_targets_met': self._check_performance_targets(result.metrics),
                'execution_time': result.execution_time
            }
            
        except Exception as e:
            self.logger.error(f"Scenario execution failed: {e}")
            return {
                'scenario': self.config.name,
                'success': False,
                'error': str(e),
                'metrics': {},
                'dataset_info': {},
                'performance_targets_met': False,
                'execution_time': 0.0
            }
    
    def _check_performance_targets(self, metrics) -> bool:
        """Check if performance targets were met."""
        try:
            targets_met = 0
            total_targets = 0
            
            for target_metric, target_value in self.config.performance_targets.items():
                total_targets += 1
                actual_value = getattr(metrics, target_metric, None)
                
                if actual_value is not None and actual_value >= target_value:
                    targets_met += 1
            
            return targets_met == total_targets if total_targets > 0 else True
            
        except Exception as e:
            self.logger.error(f"Performance target check failed: {e}")
            return False


class ClassificationScenario(BaseScenario):
    """Multi-class classification ensemble benchmark scenario."""
    
    async def generate_dataset(self) -> DatasetInfo:
        """Generate classification dataset."""
        try:
            from sklearn.datasets import make_classification
            from sklearn.model_selection import train_test_split
            
            dataset_config = self.config.dataset_config
            
            # Generate synthetic classification data
            X, y = make_classification(
                n_samples=dataset_config.get('n_samples', 1000),
                n_features=dataset_config.get('n_features', 20),
                n_informative=dataset_config.get('n_informative', 15),
                n_redundant=dataset_config.get('n_redundant', 2),
                n_clusters_per_class=dataset_config.get('n_clusters_per_class', 1),
                n_classes=dataset_config.get('n_classes', 3),
                random_state=self.config.random_seed
            )
            
            # Split data
            X_train, X_test, y_train, y_test = train_test_split(
                X, y, 
                test_size=dataset_config.get('test_size', 0.2),
                random_state=self.config.random_seed,
                stratify=y
            )
            
            # Determine dataset size
            n_samples = len(X)
            if n_samples < 1000:
                dataset_size = DatasetSize.SMALL
            elif n_samples < 10000:
                dataset_size = DatasetSize.MEDIUM
            elif n_samples < 100000:
                dataset_size = DatasetSize.LARGE
            else:
                dataset_size = DatasetSize.XLARGE
            
            return DatasetInfo(
                X_train=X_train,
                X_test=X_test,
                y_train=y_train,
                y_test=y_test,
                feature_names=[f'feature_{i}' for i in range(X.shape[1])],
                target_names=[f'class_{i}' for i in range(len(np.unique(y)))],
                dataset_size=dataset_size,
                n_features=X.shape[1],
                n_classes=len(np.unique(y))
            )
            
        except ImportError:
            self.logger.error("sklearn not available for dataset generation")
            raise
        except Exception as e:
            self.logger.error(f"Dataset generation failed: {e}")
            raise
    
    async def evaluate_predictions(self, predictions: Any, ground_truth: Any) -> Dict[str, float]:
        """Evaluate classification predictions."""
        try:
            from sklearn.metrics import accuracy_score, precision_score, recall_score, f1_score, roc_auc_score
            
            # Handle different prediction formats
            if hasattr(predictions, 'argmax'):
                y_pred = predictions.argmax(axis=1) if len(predictions.shape) > 1 else predictions.argmax()
            else:
                y_pred = predictions
            
            # Calculate metrics
            metrics = {
                'accuracy': float(accuracy_score(ground_truth, y_pred)),
                'precision': float(precision_score(ground_truth, y_pred, average='weighted', zero_division=0)),
                'recall': float(recall_score(ground_truth, y_pred, average='weighted', zero_division=0)),
                'f1_score': float(f1_score(ground_truth, y_pred, average='weighted', zero_division=0))
            }
            
            # Try to calculate AUC if possible
            try:
                if hasattr(predictions, 'shape') and len(predictions.shape) > 1:
                    # Multi-class probabilities
                    metrics['auc_score'] = float(roc_auc_score(ground_truth, predictions, multi_class='ovr', average='weighted'))
                else:
                    # Binary classification
                    if len(np.unique(ground_truth)) == 2:
                        metrics['auc_score'] = float(roc_auc_score(ground_truth, y_pred))
            except:
                pass
            
            return metrics
            
        except ImportError:
            self.logger.error("sklearn not available for evaluation")
            return {'accuracy': 0.0}
        except Exception as e:
            self.logger.error(f"Evaluation failed: {e}")
            return {'accuracy': 0.0}


class RegressionScenario(BaseScenario):
    """Regression ensemble benchmark scenario."""
    
    async def generate_dataset(self) -> DatasetInfo:
        """Generate regression dataset."""
        try:
            from sklearn.datasets import make_regression
            from sklearn.model_selection import train_test_split
            
            dataset_config = self.config.dataset_config
            
            # Generate synthetic regression data
            X, y = make_regression(
                n_samples=dataset_config.get('n_samples', 1000),
                n_features=dataset_config.get('n_features', 20),
                n_informative=dataset_config.get('n_informative', 15),
                noise=dataset_config.get('noise', 0.1),
                random_state=self.config.random_seed
            )
            
            # Split data
            X_train, X_test, y_train, y_test = train_test_split(
                X, y,
                test_size=dataset_config.get('test_size', 0.2),
                random_state=self.config.random_seed
            )
            
            # Determine dataset size
            n_samples = len(X)
            if n_samples < 1000:
                dataset_size = DatasetSize.SMALL
            elif n_samples < 10000:
                dataset_size = DatasetSize.MEDIUM
            elif n_samples < 100000:
                dataset_size = DatasetSize.LARGE
            else:
                dataset_size = DatasetSize.XLARGE
            
            return DatasetInfo(
                X_train=X_train,
                X_test=X_test,
                y_train=y_train,
                y_test=y_test,
                feature_names=[f'feature_{i}' for i in range(X.shape[1])],
                target_names=['target'],
                dataset_size=dataset_size,
                n_features=X.shape[1],
                n_classes=None
            )
            
        except ImportError:
            self.logger.error("sklearn not available for dataset generation")
            raise
        except Exception as e:
            self.logger.error(f"Dataset generation failed: {e}")
            raise
    
    async def evaluate_predictions(self, predictions: Any, ground_truth: Any) -> Dict[str, float]:
        """Evaluate regression predictions."""
        try:
            from sklearn.metrics import mean_squared_error, mean_absolute_error, r2_score
            
            # Flatten predictions if needed
            if hasattr(predictions, 'flatten'):
                y_pred = predictions.flatten()
            else:
                y_pred = predictions
            
            # Calculate metrics
            metrics = {
                'mse': float(mean_squared_error(ground_truth, y_pred)),
                'mae': float(mean_absolute_error(ground_truth, y_pred)),
                'r2_score': float(r2_score(ground_truth, y_pred)),
                'rmse': float(np.sqrt(mean_squared_error(ground_truth, y_pred)))
            }
            
            # For regression, we can use R² as a proxy for accuracy
            metrics['accuracy'] = max(0.0, metrics['r2_score'])
            
            return metrics
            
        except ImportError:
            self.logger.error("sklearn not available for evaluation")
            return {'mse': float('inf'), 'accuracy': 0.0}
        except Exception as e:
            self.logger.error(f"Evaluation failed: {e}")
            return {'mse': float('inf'), 'accuracy': 0.0}


class MLScenarios:
    """
    Predefined benchmark scenarios for MLE-STAR testing.
    
    Provides a collection of ready-to-use benchmark scenarios for different
    ML tasks and dataset configurations.
    """
    
    @staticmethod
    def classification_benchmark_small() -> BenchmarkScenario:
        """Small multi-class classification ensemble benchmark."""
        return BenchmarkScenario(
            name="classification_ensemble_small",
            description="Small-scale multi-class classification with 5 diverse models",
            task_type=TaskType.CLASSIFICATION,
            models=[
                {"type": "random_forest", "n_estimators": 50, "task": "classification"},
                {"type": "gradient_boost", "n_estimators": 50, "learning_rate": 0.1, "task": "classification"},
                {"type": "neural_network", "layers": [50, 25], "max_iter": 100, "task": "classification"},
                {"type": "svm", "kernel": "rbf", "C": 1.0, "task": "classification"},
                {"type": "logistic_regression", "C": 1.0, "max_iter": 100, "task": "classification"}
            ],
            voting_strategy="weighted",
            metrics=["accuracy", "precision", "recall", "f1_score", "consensus_time"],
            dataset_config={
                "n_samples": 1000,
                "n_features": 20,
                "n_informative": 15,
                "n_classes": 3,
                "test_size": 0.2
            },
            performance_targets={
                "accuracy": 0.85,
                "f1_score": 0.80,
                "total_time": 60.0
            },
            timeout_seconds=120.0,
            cross_validation_folds=3
        )
    
    @staticmethod
    def classification_benchmark_large() -> BenchmarkScenario:
        """Large multi-class classification ensemble benchmark."""
        return BenchmarkScenario(
            name="classification_ensemble_large",
            description="Large-scale multi-class classification with 8 models",
            task_type=TaskType.CLASSIFICATION,
            models=[
                {"type": "random_forest", "n_estimators": 100, "task": "classification"},
                {"type": "gradient_boost", "n_estimators": 100, "learning_rate": 0.1, "task": "classification"},
                {"type": "neural_network", "layers": [100, 50, 25], "max_iter": 200, "task": "classification"},
                {"type": "svm", "kernel": "rbf", "C": 1.0, "task": "classification"},
                {"type": "logistic_regression", "C": 1.0, "max_iter": 200, "task": "classification"},
                {"type": "xgboost", "n_estimators": 100, "learning_rate": 0.1, "task": "classification"},
                {"type": "lightgbm", "n_estimators": 100, "learning_rate": 0.1, "task": "classification"},
                {"type": "random_forest", "n_estimators": 200, "max_depth": 10, "task": "classification"}
            ],
            voting_strategy="bayesian",
            metrics=["accuracy", "precision", "recall", "f1_score", "auc_score", "consensus_time"],
            dataset_config={
                "n_samples": 10000,
                "n_features": 50,
                "n_informative": 40,
                "n_classes": 5,
                "test_size": 0.2
            },
            performance_targets={
                "accuracy": 0.90,
                "f1_score": 0.85,
                "total_time": 300.0
            },
            timeout_seconds=600.0,
            max_parallel_models=8
        )
    
    @staticmethod
    def regression_benchmark_small() -> BenchmarkScenario:
        """Small regression ensemble benchmark."""
        return BenchmarkScenario(
            name="regression_ensemble_small",
            description="Small-scale regression with linear and tree-based models",
            task_type=TaskType.REGRESSION,
            models=[
                {"type": "linear_regression", "task": "regression"},
                {"type": "ridge_regression", "alpha": 1.0, "task": "regression"},
                {"type": "lasso_regression", "alpha": 0.1, "task": "regression"},
                {"type": "random_forest", "n_estimators": 50, "task": "regression"},
                {"type": "gradient_boost", "n_estimators": 50, "learning_rate": 0.1, "task": "regression"}
            ],
            voting_strategy="weighted",
            metrics=["mse", "mae", "r2_score", "rmse"],
            dataset_config={
                "n_samples": 1000,
                "n_features": 15,
                "n_informative": 12,
                "noise": 0.1,
                "test_size": 0.2
            },
            performance_targets={
                "r2_score": 0.80,
                "total_time": 60.0
            },
            timeout_seconds=120.0
        )
    
    @staticmethod
    def regression_benchmark_large() -> BenchmarkScenario:
        """Large regression ensemble benchmark."""
        return BenchmarkScenario(
            name="regression_ensemble_large",
            description="Large-scale regression with diverse model types",
            task_type=TaskType.REGRESSION,
            models=[
                {"type": "linear_regression", "task": "regression"},
                {"type": "ridge_regression", "alpha": 1.0, "task": "regression"},
                {"type": "lasso_regression", "alpha": 0.1, "task": "regression"},
                {"type": "elastic_net", "alpha": 0.5, "l1_ratio": 0.5, "task": "regression"},
                {"type": "random_forest", "n_estimators": 100, "task": "regression"},
                {"type": "gradient_boost", "n_estimators": 100, "learning_rate": 0.1, "task": "regression"},
                {"type": "xgboost", "n_estimators": 100, "learning_rate": 0.1, "task": "regression"},
                {"type": "neural_network", "layers": [100, 50], "max_iter": 200, "task": "regression"}
            ],
            voting_strategy="stacking",
            metrics=["mse", "mae", "r2_score", "rmse"],
            dataset_config={
                "n_samples": 5000,
                "n_features": 30,
                "n_informative": 25,
                "noise": 0.05,
                "test_size": 0.2
            },
            performance_targets={
                "r2_score": 0.85,
                "total_time": 300.0
            },
            timeout_seconds=600.0
        )
    
    @staticmethod
    def hyperparameter_tuning_benchmark() -> BenchmarkScenario:
        """Hyperparameter tuning ensemble benchmark."""
        return BenchmarkScenario(
            name="hyperparameter_tuning_ensemble",
            description="Ensemble with hyperparameter variation testing",
            task_type=TaskType.CLASSIFICATION,
            models=[
                # Random Forest variations
                {"type": "random_forest", "n_estimators": 50, "max_depth": 5, "task": "classification"},
                {"type": "random_forest", "n_estimators": 100, "max_depth": 10, "task": "classification"},
                {"type": "random_forest", "n_estimators": 200, "max_depth": None, "task": "classification"},
                
                # SVM variations
                {"type": "svm", "kernel": "linear", "C": 0.1, "task": "classification"},
                {"type": "svm", "kernel": "rbf", "C": 1.0, "task": "classification"},
                {"type": "svm", "kernel": "rbf", "C": 10.0, "task": "classification"},
                
                # Neural Network variations
                {"type": "neural_network", "layers": [50], "alpha": 0.001, "task": "classification"},
                {"type": "neural_network", "layers": [100, 50], "alpha": 0.01, "task": "classification"}
            ],
            voting_strategy="majority",
            metrics=["accuracy", "precision", "recall", "f1_score", "model_diversity"],
            dataset_config={
                "n_samples": 2000,
                "n_features": 25,
                "n_informative": 20,
                "n_classes": 4,
                "test_size": 0.2
            },
            performance_targets={
                "accuracy": 0.88,
                "model_diversity": 0.3,
                "total_time": 180.0
            },
            timeout_seconds=300.0
        )
    
    @staticmethod
    def cross_validation_benchmark() -> BenchmarkScenario:
        """Cross-validation ensemble benchmark."""
        return BenchmarkScenario(
            name="cross_validation_ensemble",
            description="Ensemble evaluation with 5-fold cross-validation",
            task_type=TaskType.CLASSIFICATION,
            models=[
                {"type": "random_forest", "n_estimators": 100, "task": "classification"},
                {"type": "gradient_boost", "n_estimators": 100, "learning_rate": 0.1, "task": "classification"},
                {"type": "svm", "kernel": "rbf", "C": 1.0, "task": "classification"},
                {"type": "logistic_regression", "C": 1.0, "max_iter": 200, "task": "classification"},
                {"type": "neural_network", "layers": [100, 50], "max_iter": 200, "task": "classification"}
            ],
            voting_strategy="weighted",
            metrics=["accuracy", "precision", "recall", "f1_score", "cv_accuracy", "cv_std"],
            dataset_config={
                "n_samples": 1500,
                "n_features": 20,
                "n_informative": 15,
                "n_classes": 3,
                "test_size": 0.2
            },
            performance_targets={
                "accuracy": 0.87,
                "cv_accuracy": 0.85,
                "total_time": 120.0
            },
            cross_validation_folds=5,
            timeout_seconds=300.0
        )
    
    @staticmethod
    def get_all_scenarios() -> List[BenchmarkScenario]:
        """Get all predefined benchmark scenarios."""
        return [
            MLScenarios.classification_benchmark_small(),
            MLScenarios.classification_benchmark_large(),
            MLScenarios.regression_benchmark_small(),
            MLScenarios.regression_benchmark_large(),
            MLScenarios.hyperparameter_tuning_benchmark(),
            MLScenarios.cross_validation_benchmark()
        ]
    
    @staticmethod
    def get_scenario_by_name(name: str) -> Optional[BenchmarkScenario]:
        """Get a specific scenario by name."""
        scenarios = {
            "classification_ensemble_small": MLScenarios.classification_benchmark_small(),
            "classification_ensemble_large": MLScenarios.classification_benchmark_large(),
            "regression_ensemble_small": MLScenarios.regression_benchmark_small(),
            "regression_ensemble_large": MLScenarios.regression_benchmark_large(),
            "hyperparameter_tuning_ensemble": MLScenarios.hyperparameter_tuning_benchmark(),
            "cross_validation_ensemble": MLScenarios.cross_validation_benchmark()
        }
        
        return scenarios.get(name)
    
    @staticmethod
    async def run_scenario_suite(scenario_names: Optional[List[str]] = None) -> Dict[str, Any]:
        """Run a suite of benchmark scenarios."""
        logger = logging.getLogger(__name__)
        
        if scenario_names is None:
            scenarios = MLScenarios.get_all_scenarios()
        else:
            scenarios = [MLScenarios.get_scenario_by_name(name) for name in scenario_names]
            scenarios = [s for s in scenarios if s is not None]
        
        if not scenarios:
            logger.error("No valid scenarios found")
            return {"success": False, "error": "No valid scenarios"}
        
        logger.info(f"Running benchmark suite with {len(scenarios)} scenarios")
        
        suite_results = {
            "suite_name": "mle_star_benchmark_suite",
            "total_scenarios": len(scenarios),
            "start_time": asyncio.get_event_loop().time(),
            "results": {}
        }
        
        try:
            # Run scenarios in parallel (with limited concurrency)
            semaphore = asyncio.Semaphore(3)  # Limit to 3 concurrent scenarios
            
            async def run_scenario_with_semaphore(scenario_config):
                async with semaphore:
                    if scenario_config.task_type == TaskType.CLASSIFICATION:
                        scenario = ClassificationScenario(scenario_config)
                    elif scenario_config.task_type == TaskType.REGRESSION:
                        scenario = RegressionScenario(scenario_config)
                    else:
                        # Default to classification
                        scenario = ClassificationScenario(scenario_config)
                    
                    return await scenario.run_scenario()
            
            # Execute scenarios
            scenario_tasks = [
                run_scenario_with_semaphore(scenario) 
                for scenario in scenarios
            ]
            
            results = await asyncio.gather(*scenario_tasks, return_exceptions=True)
            
            # Process results
            successful_scenarios = 0
            for scenario, result in zip(scenarios, results):
                if isinstance(result, Exception):
                    logger.error(f"Scenario {scenario.name} failed with exception: {result}")
                    suite_results["results"][scenario.name] = {
                        "success": False,
                        "error": str(result)
                    }
                else:
                    suite_results["results"][scenario.name] = result
                    if result.get("success", False):
                        successful_scenarios += 1
            
            suite_results.update({
                "successful_scenarios": successful_scenarios,
                "success_rate": successful_scenarios / len(scenarios),
                "end_time": asyncio.get_event_loop().time(),
                "total_duration": asyncio.get_event_loop().time() - suite_results["start_time"]
            })
            
            logger.info(f"Benchmark suite completed: {successful_scenarios}/{len(scenarios)} scenarios successful")
            return suite_results
            
        except Exception as e:
            logger.error(f"Benchmark suite execution failed: {e}")
            suite_results.update({
                "success": False,
                "error": str(e),
                "end_time": asyncio.get_event_loop().time()
            })
            return suite_results


# Factory function for creating scenarios
def create_scenario(scenario_config: BenchmarkScenario) -> BaseScenario:
    """Create appropriate scenario instance based on task type."""
    if scenario_config.task_type == TaskType.CLASSIFICATION:
        return ClassificationScenario(scenario_config)
    elif scenario_config.task_type == TaskType.REGRESSION:
        return RegressionScenario(scenario_config)
    else:
        # Default to classification
        return ClassificationScenario(scenario_config)