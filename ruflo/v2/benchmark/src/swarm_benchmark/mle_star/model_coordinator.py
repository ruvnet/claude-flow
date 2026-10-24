"""
Model Coordinator for MLE-STAR Ensemble

Manages model agent spawning, coordination, and lifecycle management
with support for various ML frameworks and distributed execution.
"""

import asyncio
import logging
import uuid
from typing import Dict, List, Any, Optional, Union
from dataclasses import dataclass
from abc import ABC, abstractmethod
from enum import Enum


class ModelType(Enum):
    """Supported model types."""
    RANDOM_FOREST = "random_forest"
    GRADIENT_BOOST = "gradient_boost"
    NEURAL_NETWORK = "neural_network"
    SVM = "svm"
    LOGISTIC_REGRESSION = "logistic_regression"
    LINEAR_REGRESSION = "linear_regression"
    RIDGE_REGRESSION = "ridge_regression"
    LASSO_REGRESSION = "lasso_regression"
    ELASTIC_NET = "elastic_net"
    XGBOOST = "xgboost"
    LIGHTGBM = "lightgbm"
    CATBOOST = "catboost"
    GENERIC = "generic"


class AgentStatus(Enum):
    """Agent status states."""
    INITIALIZING = "initializing"
    READY = "ready"
    TRAINING = "training"
    PREDICTING = "predicting"
    ERROR = "error"
    TERMINATED = "terminated"


@dataclass
class ModelConfig:
    """Configuration for a model agent."""
    model_type: ModelType
    hyperparameters: Dict[str, Any]
    capabilities: List[str]
    gpu_enabled: bool = False
    max_memory_mb: float = 1024.0
    timeout_seconds: float = 300.0
    retry_attempts: int = 3


@dataclass
class PerformanceMetrics:
    """Performance metrics for a model."""
    accuracy: Optional[float] = None
    precision: Optional[float] = None
    recall: Optional[float] = None
    f1_score: Optional[float] = None
    training_time: Optional[float] = None
    prediction_time: Optional[float] = None
    memory_usage_mb: Optional[float] = None
    cpu_utilization: Optional[float] = None


class ModelAgent:
    """
    Individual model agent that handles a specific ML model.
    
    Each agent manages the lifecycle of one model including training,
    prediction, and performance monitoring.
    """
    
    def __init__(self, agent_id: str, config: ModelConfig):
        self.agent_id = agent_id
        self.config = config
        self.status = AgentStatus.INITIALIZING
        self.model = None
        self.performance_metrics = PerformanceMetrics()
        self.logger = logging.getLogger(f"{__name__}.{agent_id}")
        self._lock = asyncio.Lock()
        
    async def initialize(self) -> bool:
        """Initialize the model agent."""
        try:
            async with self._lock:
                self.logger.info(f"Initializing model agent: {self.agent_id}")
                self.status = AgentStatus.INITIALIZING
                
                # Create model based on type
                self.model = await self._create_model()
                
                if self.model is None:
                    raise RuntimeError(f"Failed to create model of type {self.config.model_type}")
                
                self.status = AgentStatus.READY
                self.logger.info(f"Model agent {self.agent_id} initialized successfully")
                return True
                
        except Exception as e:
            self.logger.error(f"Model agent initialization failed: {e}")
            self.status = AgentStatus.ERROR
            return False
    
    async def _create_model(self):
        """Create the ML model based on configuration."""
        try:
            model_type = self.config.model_type
            hyperparams = self.config.hyperparameters
            
            if model_type == ModelType.RANDOM_FOREST:
                return await self._create_random_forest(hyperparams)
            elif model_type == ModelType.GRADIENT_BOOST:
                return await self._create_gradient_boost(hyperparams)
            elif model_type == ModelType.NEURAL_NETWORK:
                return await self._create_neural_network(hyperparams)
            elif model_type == ModelType.SVM:
                return await self._create_svm(hyperparams)
            elif model_type == ModelType.LOGISTIC_REGRESSION:
                return await self._create_logistic_regression(hyperparams)
            elif model_type == ModelType.LINEAR_REGRESSION:
                return await self._create_linear_regression(hyperparams)
            elif model_type == ModelType.RIDGE_REGRESSION:
                return await self._create_ridge_regression(hyperparams)
            elif model_type == ModelType.LASSO_REGRESSION:
                return await self._create_lasso_regression(hyperparams)
            elif model_type == ModelType.ELASTIC_NET:
                return await self._create_elastic_net(hyperparams)
            elif model_type == ModelType.XGBOOST:
                return await self._create_xgboost(hyperparams)
            elif model_type == ModelType.LIGHTGBM:
                return await self._create_lightgbm(hyperparams)
            elif model_type == ModelType.CATBOOST:
                return await self._create_catboost(hyperparams)
            else:
                return await self._create_generic_model(hyperparams)
                
        except Exception as e:
            self.logger.error(f"Model creation failed: {e}")
            return None
    
    async def _create_random_forest(self, hyperparams: Dict) -> Any:
        """Create RandomForest model."""
        try:
            from sklearn.ensemble import RandomForestClassifier, RandomForestRegressor
            
            is_classifier = hyperparams.get('task', 'classification') == 'classification'
            ModelClass = RandomForestClassifier if is_classifier else RandomForestRegressor
            
            params = {
                'n_estimators': hyperparams.get('n_estimators', 100),
                'max_depth': hyperparams.get('max_depth', None),
                'min_samples_split': hyperparams.get('min_samples_split', 2),
                'min_samples_leaf': hyperparams.get('min_samples_leaf', 1),
                'random_state': hyperparams.get('random_state', 42),
                'n_jobs': hyperparams.get('n_jobs', -1)
            }
            
            return ModelClass(**params)
            
        except ImportError:
            self.logger.error("sklearn not available for RandomForest")
            return None
    
    async def _create_gradient_boost(self, hyperparams: Dict) -> Any:
        """Create GradientBoosting model."""
        try:
            from sklearn.ensemble import GradientBoostingClassifier, GradientBoostingRegressor
            
            is_classifier = hyperparams.get('task', 'classification') == 'classification'
            ModelClass = GradientBoostingClassifier if is_classifier else GradientBoostingRegressor
            
            params = {
                'n_estimators': hyperparams.get('n_estimators', 100),
                'learning_rate': hyperparams.get('learning_rate', 0.1),
                'max_depth': hyperparams.get('max_depth', 3),
                'random_state': hyperparams.get('random_state', 42)
            }
            
            return ModelClass(**params)
            
        except ImportError:
            self.logger.error("sklearn not available for GradientBoosting")
            return None
    
    async def _create_neural_network(self, hyperparams: Dict) -> Any:
        """Create Neural Network model."""
        try:
            from sklearn.neural_network import MLPClassifier, MLPRegressor
            
            is_classifier = hyperparams.get('task', 'classification') == 'classification'
            ModelClass = MLPClassifier if is_classifier else MLPRegressor
            
            params = {
                'hidden_layer_sizes': tuple(hyperparams.get('layers', [100, 50])),
                'activation': hyperparams.get('activation', 'relu'),
                'solver': hyperparams.get('solver', 'adam'),
                'alpha': hyperparams.get('alpha', 0.0001),
                'learning_rate': hyperparams.get('learning_rate', 'constant'),
                'max_iter': hyperparams.get('max_iter', 200),
                'random_state': hyperparams.get('random_state', 42)
            }
            
            return ModelClass(**params)
            
        except ImportError:
            self.logger.error("sklearn not available for Neural Network")
            return None
    
    async def _create_svm(self, hyperparams: Dict) -> Any:
        """Create SVM model."""
        try:
            from sklearn.svm import SVC, SVR
            
            is_classifier = hyperparams.get('task', 'classification') == 'classification'
            ModelClass = SVC if is_classifier else SVR
            
            params = {
                'kernel': hyperparams.get('kernel', 'rbf'),
                'C': hyperparams.get('C', 1.0),
                'gamma': hyperparams.get('gamma', 'scale')
            }
            
            if is_classifier:
                params['probability'] = hyperparams.get('probability', True)
            
            return ModelClass(**params)
            
        except ImportError:
            self.logger.error("sklearn not available for SVM")
            return None
    
    async def _create_logistic_regression(self, hyperparams: Dict) -> Any:
        """Create Logistic Regression model."""
        try:
            from sklearn.linear_model import LogisticRegression
            
            params = {
                'penalty': hyperparams.get('penalty', 'l2'),
                'C': hyperparams.get('C', 1.0),
                'solver': hyperparams.get('solver', 'lbfgs'),
                'max_iter': hyperparams.get('max_iter', 100),
                'random_state': hyperparams.get('random_state', 42)
            }
            
            return LogisticRegression(**params)
            
        except ImportError:
            self.logger.error("sklearn not available for Logistic Regression")
            return None
    
    async def _create_linear_regression(self, hyperparams: Dict) -> Any:
        """Create Linear Regression model."""
        try:
            from sklearn.linear_model import LinearRegression
            
            params = {
                'fit_intercept': hyperparams.get('fit_intercept', True),
                'normalize': hyperparams.get('normalize', False),
                'copy_X': hyperparams.get('copy_X', True),
                'n_jobs': hyperparams.get('n_jobs', None)
            }
            
            return LinearRegression(**params)
            
        except ImportError:
            self.logger.error("sklearn not available for Linear Regression")
            return None
    
    async def _create_ridge_regression(self, hyperparams: Dict) -> Any:
        """Create Ridge Regression model."""
        try:
            from sklearn.linear_model import Ridge
            
            params = {
                'alpha': hyperparams.get('alpha', 1.0),
                'fit_intercept': hyperparams.get('fit_intercept', True),
                'normalize': hyperparams.get('normalize', False),
                'copy_X': hyperparams.get('copy_X', True),
                'solver': hyperparams.get('solver', 'auto'),
                'random_state': hyperparams.get('random_state', 42)
            }
            
            return Ridge(**params)
            
        except ImportError:
            self.logger.error("sklearn not available for Ridge Regression")
            return None
    
    async def _create_lasso_regression(self, hyperparams: Dict) -> Any:
        """Create Lasso Regression model."""
        try:
            from sklearn.linear_model import Lasso
            
            params = {
                'alpha': hyperparams.get('alpha', 1.0),
                'fit_intercept': hyperparams.get('fit_intercept', True),
                'normalize': hyperparams.get('normalize', False),
                'copy_X': hyperparams.get('copy_X', True),
                'max_iter': hyperparams.get('max_iter', 1000),
                'random_state': hyperparams.get('random_state', 42)
            }
            
            return Lasso(**params)
            
        except ImportError:
            self.logger.error("sklearn not available for Lasso Regression")
            return None
    
    async def _create_elastic_net(self, hyperparams: Dict) -> Any:
        """Create Elastic Net model."""
        try:
            from sklearn.linear_model import ElasticNet
            
            params = {
                'alpha': hyperparams.get('alpha', 1.0),
                'l1_ratio': hyperparams.get('l1_ratio', 0.5),
                'fit_intercept': hyperparams.get('fit_intercept', True),
                'normalize': hyperparams.get('normalize', False),
                'copy_X': hyperparams.get('copy_X', True),
                'max_iter': hyperparams.get('max_iter', 1000),
                'random_state': hyperparams.get('random_state', 42)
            }
            
            return ElasticNet(**params)
            
        except ImportError:
            self.logger.error("sklearn not available for Elastic Net")
            return None
    
    async def _create_xgboost(self, hyperparams: Dict) -> Any:
        """Create XGBoost model."""
        try:
            import xgboost as xgb
            
            is_classifier = hyperparams.get('task', 'classification') == 'classification'
            ModelClass = xgb.XGBClassifier if is_classifier else xgb.XGBRegressor
            
            params = {
                'n_estimators': hyperparams.get('n_estimators', 100),
                'max_depth': hyperparams.get('max_depth', 6),
                'learning_rate': hyperparams.get('learning_rate', 0.3),
                'subsample': hyperparams.get('subsample', 1.0),
                'colsample_bytree': hyperparams.get('colsample_bytree', 1.0),
                'random_state': hyperparams.get('random_state', 42)
            }
            
            if self.config.gpu_enabled:
                params['tree_method'] = 'gpu_hist'
            
            return ModelClass(**params)
            
        except ImportError:
            self.logger.error("XGBoost not available")
            return None
    
    async def _create_lightgbm(self, hyperparams: Dict) -> Any:
        """Create LightGBM model."""
        try:
            import lightgbm as lgb
            
            is_classifier = hyperparams.get('task', 'classification') == 'classification'
            ModelClass = lgb.LGBMClassifier if is_classifier else lgb.LGBMRegressor
            
            params = {
                'n_estimators': hyperparams.get('n_estimators', 100),
                'max_depth': hyperparams.get('max_depth', -1),
                'learning_rate': hyperparams.get('learning_rate', 0.1),
                'subsample': hyperparams.get('subsample', 1.0),
                'colsample_bytree': hyperparams.get('colsample_bytree', 1.0),
                'random_state': hyperparams.get('random_state', 42),
                'n_jobs': hyperparams.get('n_jobs', -1)
            }
            
            if self.config.gpu_enabled:
                params['device'] = 'gpu'
            
            return ModelClass(**params)
            
        except ImportError:
            self.logger.error("LightGBM not available")
            return None
    
    async def _create_catboost(self, hyperparams: Dict) -> Any:
        """Create CatBoost model."""
        try:
            import catboost as cb
            
            is_classifier = hyperparams.get('task', 'classification') == 'classification'
            ModelClass = cb.CatBoostClassifier if is_classifier else cb.CatBoostRegressor
            
            params = {
                'iterations': hyperparams.get('iterations', 100),
                'depth': hyperparams.get('depth', 6),
                'learning_rate': hyperparams.get('learning_rate', 0.1),
                'random_seed': hyperparams.get('random_seed', 42),
                'verbose': hyperparams.get('verbose', False)
            }
            
            if self.config.gpu_enabled:
                params['task_type'] = 'GPU'
            
            return ModelClass(**params)
            
        except ImportError:
            self.logger.error("CatBoost not available")
            return None
    
    async def _create_generic_model(self, hyperparams: Dict) -> Any:
        """Create a generic model wrapper."""
        return GenericModel(hyperparams)
    
    async def train(self, X_train: Any, y_train: Any) -> bool:
        """Train the model."""
        try:
            async with self._lock:
                if self.status != AgentStatus.READY:
                    self.logger.warning(f"Agent {self.agent_id} not ready for training")
                    return False
                
                self.status = AgentStatus.TRAINING
                self.logger.info(f"Training model: {self.agent_id}")
                
                import time
                start_time = time.time()
                
                # Train the model
                await self._fit_model(X_train, y_train)
                
                training_time = time.time() - start_time
                self.performance_metrics.training_time = training_time
                
                self.status = AgentStatus.READY
                self.logger.info(f"Model {self.agent_id} training completed in {training_time:.2f}s")
                return True
                
        except Exception as e:
            self.logger.error(f"Training failed for {self.agent_id}: {e}")
            self.status = AgentStatus.ERROR
            return False
    
    async def _fit_model(self, X_train: Any, y_train: Any):
        """Fit the model to training data."""
        if hasattr(self.model, 'fit'):
            # Run in thread pool to avoid blocking
            loop = asyncio.get_event_loop()
            await loop.run_in_executor(None, self.model.fit, X_train, y_train)
        else:
            raise NotImplementedError("Model does not support training")
    
    async def predict(self, X_test: Any) -> Any:
        """Make predictions."""
        try:
            async with self._lock:
                if self.status not in [AgentStatus.READY]:
                    self.logger.warning(f"Agent {self.agent_id} not ready for prediction")
                    return None
                
                self.status = AgentStatus.PREDICTING
                
                import time
                start_time = time.time()
                
                # Make predictions
                predictions = await self._model_predict(X_test)
                
                prediction_time = time.time() - start_time
                self.performance_metrics.prediction_time = prediction_time
                
                self.status = AgentStatus.READY
                return predictions
                
        except Exception as e:
            self.logger.error(f"Prediction failed for {self.agent_id}: {e}")
            self.status = AgentStatus.ERROR
            return None
    
    async def _model_predict(self, X_test: Any) -> Any:
        """Make predictions with the model."""
        if hasattr(self.model, 'predict'):
            # Run in thread pool to avoid blocking
            loop = asyncio.get_event_loop()
            return await loop.run_in_executor(None, self.model.predict, X_test)
        else:
            raise NotImplementedError("Model does not support prediction")
    
    async def get_performance_metrics(self) -> Dict[str, float]:
        """Get current performance metrics."""
        return {
            'training_time': self.performance_metrics.training_time or 0.0,
            'prediction_time': self.performance_metrics.prediction_time or 0.0,
            'memory_usage_mb': self.performance_metrics.memory_usage_mb or 0.0,
            'cpu_utilization': self.performance_metrics.cpu_utilization or 0.0,
            'accuracy': self.performance_metrics.accuracy or 0.0,
            'precision': self.performance_metrics.precision or 0.0,
            'recall': self.performance_metrics.recall or 0.0,
            'f1_score': self.performance_metrics.f1_score or 0.0
        }
    
    async def cleanup(self):
        """Clean up resources."""
        try:
            async with self._lock:
                self.logger.info(f"Cleaning up model agent: {self.agent_id}")
                self.status = AgentStatus.TERMINATED
                
                # Clean up model resources
                if hasattr(self.model, 'cleanup'):
                    await self.model.cleanup()
                
                self.model = None
                
        except Exception as e:
            self.logger.error(f"Cleanup failed for {self.agent_id}: {e}")


class GenericModel:
    """Generic model wrapper for unknown model types."""
    
    def __init__(self, hyperparams: Dict):
        self.hyperparams = hyperparams
        self.is_trained = False
        
    def fit(self, X_train: Any, y_train: Any):
        """Dummy training."""
        self.is_trained = True
        
    def predict(self, X_test: Any) -> Any:
        """Dummy prediction."""
        if not self.is_trained:
            raise RuntimeError("Model not trained")
        
        # Return dummy predictions
        if hasattr(X_test, 'shape'):
            n_samples = X_test.shape[0]
            return [0.5] * n_samples  # Dummy predictions
        else:
            return [0.5]


class ModelCoordinator:
    """
    Coordinates multiple model agents for ensemble execution.
    
    Manages agent lifecycle, resource allocation, and parallel execution
    coordination across multiple model agents.
    """
    
    def __init__(self, max_parallel: int = 8):
        self.max_parallel = max_parallel
        self.agents: Dict[str, ModelAgent] = {}
        self.resource_semaphore = asyncio.Semaphore(max_parallel)
        self.logger = logging.getLogger(__name__)
        
    async def spawn_agent(self, 
                         agent_id: str,
                         model_type: str,
                         capabilities: List[str],
                         hyperparameters: Dict[str, Any],
                         gpu_enabled: bool = False) -> ModelAgent:
        """Spawn a new model agent."""
        try:
            # Convert string to ModelType enum
            try:
                model_type_enum = ModelType(model_type.lower())
            except ValueError:
                self.logger.warning(f"Unknown model type: {model_type}, using GENERIC")
                model_type_enum = ModelType.GENERIC
            
            # Create model configuration
            config = ModelConfig(
                model_type=model_type_enum,
                hyperparameters=hyperparameters,
                capabilities=capabilities,
                gpu_enabled=gpu_enabled
            )
            
            # Create and initialize agent
            agent = ModelAgent(agent_id, config)
            
            # Initialize agent
            success = await agent.initialize()
            if not success:
                raise RuntimeError(f"Failed to initialize agent {agent_id}")
            
            # Store agent
            self.agents[agent_id] = agent
            
            self.logger.info(f"Successfully spawned agent: {agent_id}")
            return agent
            
        except Exception as e:
            self.logger.error(f"Failed to spawn agent {agent_id}: {e}")
            raise
    
    async def train_agents_parallel(self, X_train: Any, y_train: Any) -> Dict[str, bool]:
        """Train all agents in parallel."""
        results = {}
        
        try:
            # Create training tasks
            training_tasks = []
            for agent_id, agent in self.agents.items():
                task = self._train_agent_with_semaphore(agent, X_train, y_train)
                training_tasks.append((agent_id, task))
            
            # Execute training in parallel
            task_results = await asyncio.gather(
                *[task for _, task in training_tasks],
                return_exceptions=True
            )
            
            # Collect results
            for (agent_id, _), result in zip(training_tasks, task_results):
                if isinstance(result, Exception):
                    self.logger.error(f"Training failed for {agent_id}: {result}")
                    results[agent_id] = False
                else:
                    results[agent_id] = result
                    
            return results
            
        except Exception as e:
            self.logger.error(f"Parallel training failed: {e}")
            return {agent_id: False for agent_id in self.agents.keys()}
    
    async def _train_agent_with_semaphore(self, agent: ModelAgent, X_train: Any, y_train: Any) -> bool:
        """Train agent with resource semaphore."""
        async with self.resource_semaphore:
            return await agent.train(X_train, y_train)
    
    async def predict_agents_parallel(self, X_test: Any) -> Dict[str, Any]:
        """Get predictions from all agents in parallel."""
        predictions = {}
        
        try:
            # Create prediction tasks
            prediction_tasks = []
            for agent_id, agent in self.agents.items():
                task = self._predict_agent_with_semaphore(agent, X_test)
                prediction_tasks.append((agent_id, task))
            
            # Execute predictions in parallel
            task_results = await asyncio.gather(
                *[task for _, task in prediction_tasks],
                return_exceptions=True
            )
            
            # Collect results
            for (agent_id, _), result in zip(prediction_tasks, task_results):
                if isinstance(result, Exception):
                    self.logger.error(f"Prediction failed for {agent_id}: {result}")
                    predictions[agent_id] = None
                else:
                    predictions[agent_id] = result
                    
            return predictions
            
        except Exception as e:
            self.logger.error(f"Parallel prediction failed: {e}")
            return {agent_id: None for agent_id in self.agents.keys()}
    
    async def _predict_agent_with_semaphore(self, agent: ModelAgent, X_test: Any) -> Any:
        """Predict with agent using resource semaphore."""
        async with self.resource_semaphore:
            return await agent.predict(X_test)
    
    async def get_agent_statuses(self) -> Dict[str, str]:
        """Get status of all agents."""
        return {agent_id: agent.status.value for agent_id, agent in self.agents.items()}
    
    async def get_agent_performances(self) -> Dict[str, Dict[str, float]]:
        """Get performance metrics for all agents."""
        performances = {}
        
        for agent_id, agent in self.agents.items():
            try:
                performances[agent_id] = await agent.get_performance_metrics()
            except Exception as e:
                self.logger.error(f"Failed to get performance for {agent_id}: {e}")
                performances[agent_id] = {}
        
        return performances
    
    async def cleanup(self):
        """Clean up all agents and resources."""
        try:
            cleanup_tasks = []
            for agent in self.agents.values():
                cleanup_tasks.append(agent.cleanup())
            
            if cleanup_tasks:
                await asyncio.gather(*cleanup_tasks, return_exceptions=True)
            
            self.agents.clear()
            self.logger.info("Model coordinator cleanup completed")
            
        except Exception as e:
            self.logger.error(f"Coordinator cleanup failed: {e}")
    
    def get_agent(self, agent_id: str) -> Optional[ModelAgent]:
        """Get a specific agent by ID."""
        return self.agents.get(agent_id)
    
    def list_agents(self) -> List[str]:
        """List all agent IDs."""
        return list(self.agents.keys())
    
    def get_agent_count(self) -> int:
        """Get total number of agents."""
        return len(self.agents)