"""Base model classes for the MLE-STAR framework."""

from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from datetime import datetime
from typing import Any, Dict, List, Optional, Tuple, Union
import uuid
import numpy as np

# Import Claude Flow performance tracking
try:
    from ...benchmark.src.swarm_benchmark.core.models import (
        PerformanceMetrics, QualityMetrics, ResourceUsage
    )
except ImportError:
    # Fallback definitions if not available
    @dataclass
    class PerformanceMetrics:
        execution_time: float = 0.0
        throughput: float = 0.0
        success_rate: float = 0.0
        
    @dataclass 
    class QualityMetrics:
        accuracy_score: float = 0.0
        overall_quality: float = 0.0
        
    @dataclass
    class ResourceUsage:
        memory_mb: float = 0.0
        cpu_percent: float = 0.0


@dataclass
class ModelMetrics:
    """Extended metrics specific to ML models."""
    # Training metrics
    training_loss: float = 0.0
    validation_loss: float = 0.0
    training_accuracy: float = 0.0
    validation_accuracy: float = 0.0
    
    # Performance metrics
    inference_time: float = 0.0
    memory_usage: float = 0.0
    model_size_mb: float = 0.0
    
    # Quality metrics
    precision: float = 0.0
    recall: float = 0.0
    f1_score: float = 0.0
    
    # Resource utilization
    gpu_utilization: float = 0.0
    cpu_utilization: float = 0.0
    
    # Training progress
    epochs_completed: int = 0
    convergence_status: str = "training"
    
    def to_dict(self) -> Dict[str, Any]:
        """Convert metrics to dictionary for serialization."""
        return {
            "training_loss": self.training_loss,
            "validation_loss": self.validation_loss,
            "training_accuracy": self.training_accuracy,
            "validation_accuracy": self.validation_accuracy,
            "inference_time": self.inference_time,
            "memory_usage": self.memory_usage,
            "model_size_mb": self.model_size_mb,
            "precision": self.precision,
            "recall": self.recall,
            "f1_score": self.f1_score,
            "gpu_utilization": self.gpu_utilization,
            "cpu_utilization": self.cpu_utilization,
            "epochs_completed": self.epochs_completed,
            "convergence_status": self.convergence_status
        }


@dataclass
class ModelConfig:
    """Configuration for ML models."""
    model_id: str = field(default_factory=lambda: str(uuid.uuid4()).split('-')[0])
    model_name: str = ""
    model_type: str = ""
    
    # Training configuration
    learning_rate: float = 0.001
    batch_size: int = 32
    epochs: int = 100
    validation_split: float = 0.2
    
    # Architecture parameters
    architecture_params: Dict[str, Any] = field(default_factory=dict)
    
    # Optimization settings
    optimizer: str = "adam"
    loss_function: str = "mse"
    metrics: List[str] = field(default_factory=list)
    
    # Regularization
    dropout_rate: float = 0.0
    l1_reg: float = 0.0
    l2_reg: float = 0.0
    
    # Early stopping
    early_stopping: bool = True
    patience: int = 10
    
    # Checkpointing
    save_checkpoints: bool = True
    checkpoint_frequency: int = 10
    
    # Resource limits
    max_memory_mb: int = 4096
    max_training_time: int = 3600  # seconds
    use_gpu: bool = True
    
    def to_dict(self) -> Dict[str, Any]:
        """Convert config to dictionary."""
        return {
            "model_id": self.model_id,
            "model_name": self.model_name,
            "model_type": self.model_type,
            "learning_rate": self.learning_rate,
            "batch_size": self.batch_size,
            "epochs": self.epochs,
            "validation_split": self.validation_split,
            "architecture_params": self.architecture_params,
            "optimizer": self.optimizer,
            "loss_function": self.loss_function,
            "metrics": self.metrics,
            "dropout_rate": self.dropout_rate,
            "l1_reg": self.l1_reg,
            "l2_reg": self.l2_reg,
            "early_stopping": self.early_stopping,
            "patience": self.patience,
            "save_checkpoints": self.save_checkpoints,
            "checkpoint_frequency": self.checkpoint_frequency,
            "max_memory_mb": self.max_memory_mb,
            "max_training_time": self.max_training_time,
            "use_gpu": self.use_gpu
        }


class MLESTARModel(ABC):
    """Abstract base class for all MLE-STAR models.
    
    This class provides the foundation for all ML models in the MLE-STAR framework,
    with built-in coordination capabilities for Claude Flow integration.
    """
    
    def __init__(self, config: ModelConfig):
        """Initialize the model with configuration."""
        self.config = config
        self.model_id = config.model_id
        self.model_name = config.model_name or f"{config.model_type}_{self.model_id}"
        
        # Training state
        self.is_trained = False
        self.training_history: List[Dict[str, Any]] = []
        self.metrics = ModelMetrics()
        
        # Timestamps
        self.created_at = datetime.now()
        self.trained_at: Optional[datetime] = None
        self.last_updated = self.created_at
        
        # Model artifacts
        self.model_path: Optional[str] = None
        self.checkpoint_paths: List[str] = []
        
        # Coordination state for Claude Flow integration
        self.coordination_state: Dict[str, Any] = {
            "agent_id": None,
            "task_id": None,
            "swarm_id": None,
            "coordination_memory": {}
        }
        
    @abstractmethod
    def build_model(self) -> Any:
        """Build the model architecture.
        
        Returns:
            The constructed model object
        """
        pass
    
    @abstractmethod
    def train(self, X: np.ndarray, y: np.ndarray, **kwargs) -> ModelMetrics:
        """Train the model on provided data.
        
        Args:
            X: Input features
            y: Target values
            **kwargs: Additional training parameters
            
        Returns:
            Training metrics
        """
        pass
    
    @abstractmethod
    def predict(self, X: np.ndarray) -> np.ndarray:
        """Make predictions on new data.
        
        Args:
            X: Input features
            
        Returns:
            Predictions
        """
        pass
    
    @abstractmethod
    def evaluate(self, X: np.ndarray, y: np.ndarray) -> ModelMetrics:
        """Evaluate model performance.
        
        Args:
            X: Input features
            y: True values
            
        Returns:
            Evaluation metrics
        """
        pass
    
    def save_model(self, path: str) -> bool:
        """Save the model to disk.
        
        Args:
            path: Path to save the model
            
        Returns:
            True if successful, False otherwise
        """
        try:
            self.model_path = path
            self.last_updated = datetime.now()
            return True
        except Exception as e:
            print(f"Failed to save model: {e}")
            return False
    
    def load_model(self, path: str) -> bool:
        """Load a model from disk.
        
        Args:
            path: Path to the saved model
            
        Returns:
            True if successful, False otherwise
        """
        try:
            self.model_path = path
            self.is_trained = True
            self.last_updated = datetime.now()
            return True
        except Exception as e:
            print(f"Failed to load model: {e}")
            return False
    
    def update_coordination_state(self, **kwargs) -> None:
        """Update coordination state for Claude Flow integration."""
        self.coordination_state.update(kwargs)
        self.last_updated = datetime.now()
    
    def get_model_info(self) -> Dict[str, Any]:
        """Get comprehensive model information."""
        return {
            "model_id": self.model_id,
            "model_name": self.model_name,
            "model_type": self.config.model_type,
            "is_trained": self.is_trained,
            "created_at": self.created_at.isoformat(),
            "trained_at": self.trained_at.isoformat() if self.trained_at else None,
            "last_updated": self.last_updated.isoformat(),
            "metrics": self.metrics.to_dict(),
            "config": self.config.to_dict(),
            "coordination_state": self.coordination_state,
            "model_path": self.model_path,
            "training_epochs": len(self.training_history)
        }


class SupervisedModel(MLESTARModel):
    """Base class for supervised learning models."""
    
    def __init__(self, config: ModelConfig):
        """Initialize supervised model."""
        super().__init__(config)
        self.config.model_type = "supervised"
        
        # Supervised learning specific attributes
        self.feature_names: List[str] = []
        self.target_names: List[str] = []
        self.class_names: List[str] = []
        
    def fit(self, X: np.ndarray, y: np.ndarray, **kwargs) -> ModelMetrics:
        """Fit the supervised model (alias for train)."""
        return self.train(X, y, **kwargs)
    
    def score(self, X: np.ndarray, y: np.ndarray) -> float:
        """Calculate the model score."""
        metrics = self.evaluate(X, y)
        return metrics.validation_accuracy


class UnsupervisedModel(MLESTARModel):
    """Base class for unsupervised learning models."""
    
    def __init__(self, config: ModelConfig):
        """Initialize unsupervised model."""
        super().__init__(config)
        self.config.model_type = "unsupervised"
        
        # Unsupervised learning specific attributes
        self.n_components: Optional[int] = None
        self.cluster_centers: Optional[np.ndarray] = None
        
    def fit(self, X: np.ndarray, **kwargs) -> ModelMetrics:
        """Fit the unsupervised model."""
        return self.train(X, None, **kwargs)
    
    def transform(self, X: np.ndarray) -> np.ndarray:
        """Transform data using the fitted model."""
        return self.predict(X)
    
    def fit_transform(self, X: np.ndarray, **kwargs) -> np.ndarray:
        """Fit the model and transform the data."""
        self.fit(X, **kwargs)
        return self.transform(X)


class ReinforcementModel(MLESTARModel):
    """Base class for reinforcement learning models."""
    
    def __init__(self, config: ModelConfig):
        """Initialize reinforcement learning model."""
        super().__init__(config)
        self.config.model_type = "reinforcement"
        
        # RL specific attributes
        self.action_space_size: Optional[int] = None
        self.state_space_size: Optional[int] = None
        self.total_episodes: int = 0
        self.total_reward: float = 0.0
        self.exploration_rate: float = 1.0
    
    def train_episode(self, env, **kwargs) -> Dict[str, Any]:
        """Train for a single episode.
        
        Args:
            env: Environment to train in
            **kwargs: Additional parameters
            
        Returns:
            Episode training results
        """
        # This should be implemented by specific RL algorithms
        raise NotImplementedError("Subclasses must implement train_episode")
    
    def select_action(self, state: np.ndarray, **kwargs) -> Any:
        """Select an action given the current state.
        
        Args:
            state: Current state
            **kwargs: Additional parameters
            
        Returns:
            Selected action
        """
        # This should be implemented by specific RL algorithms
        raise NotImplementedError("Subclasses must implement select_action")
    
    def update_policy(self, experience: Dict[str, Any]) -> None:
        """Update the policy based on experience.
        
        Args:
            experience: Experience tuple or batch
        """
        # This should be implemented by specific RL algorithms
        raise NotImplementedError("Subclasses must implement update_policy")