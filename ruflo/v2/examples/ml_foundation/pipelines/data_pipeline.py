"""Data pipeline infrastructure for MLE-STAR framework."""

from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from datetime import datetime
from typing import Any, Dict, List, Optional, Tuple, Union, Callable
import numpy as np
import hashlib
import json


@dataclass
class DataConfig:
    """Configuration for data pipeline."""
    # Data source configuration
    data_source: str = ""
    data_format: str = "csv"
    data_path: str = ""
    
    # Processing configuration
    preprocessing_steps: List[str] = field(default_factory=list)
    feature_engineering: List[str] = field(default_factory=list)
    validation_rules: List[str] = field(default_factory=list)
    
    # Splitting configuration
    train_ratio: float = 0.7
    val_ratio: float = 0.15
    test_ratio: float = 0.15
    stratify: bool = False
    random_state: int = 42
    
    # Caching configuration
    enable_caching: bool = True
    cache_directory: str = "./cache"
    cache_ttl: int = 3600  # seconds
    
    # Streaming configuration
    batch_size: int = 1000
    streaming: bool = False
    buffer_size: int = 10000
    
    # Feature configuration
    target_columns: List[str] = field(default_factory=list)
    feature_columns: List[str] = field(default_factory=list)
    categorical_columns: List[str] = field(default_factory=list)
    numerical_columns: List[str] = field(default_factory=list)
    
    def to_dict(self) -> Dict[str, Any]:
        """Convert config to dictionary."""
        return {
            "data_source": self.data_source,
            "data_format": self.data_format,
            "data_path": self.data_path,
            "preprocessing_steps": self.preprocessing_steps,
            "feature_engineering": self.feature_engineering,
            "validation_rules": self.validation_rules,
            "train_ratio": self.train_ratio,
            "val_ratio": self.val_ratio,
            "test_ratio": self.test_ratio,
            "stratify": self.stratify,
            "random_state": self.random_state,
            "enable_caching": self.enable_caching,
            "cache_directory": self.cache_directory,
            "cache_ttl": self.cache_ttl,
            "batch_size": self.batch_size,
            "streaming": self.streaming,
            "buffer_size": self.buffer_size,
            "target_columns": self.target_columns,
            "feature_columns": self.feature_columns,
            "categorical_columns": self.categorical_columns,
            "numerical_columns": self.numerical_columns
        }


class Transform(ABC):
    """Abstract base class for data transformations."""
    
    def __init__(self, name: str):
        """Initialize transform with name."""
        self.name = name
        self.is_fitted = False
        self.parameters: Dict[str, Any] = {}
    
    @abstractmethod
    def fit(self, X: np.ndarray, y: Optional[np.ndarray] = None) -> 'Transform':
        """Fit the transform to data."""
        pass
    
    @abstractmethod
    def transform(self, X: np.ndarray) -> np.ndarray:
        """Apply the transform to data."""
        pass
    
    def fit_transform(self, X: np.ndarray, y: Optional[np.ndarray] = None) -> np.ndarray:
        """Fit and transform in one step."""
        return self.fit(X, y).transform(X)
    
    def get_params(self) -> Dict[str, Any]:
        """Get transform parameters."""
        return self.parameters
    
    def set_params(self, **params) -> 'Transform':
        """Set transform parameters."""
        self.parameters.update(params)
        return self


class StandardScaler(Transform):
    """Standard scaling transformation."""
    
    def __init__(self):
        """Initialize standard scaler."""
        super().__init__("standard_scaler")
        self.mean_: Optional[np.ndarray] = None
        self.std_: Optional[np.ndarray] = None
    
    def fit(self, X: np.ndarray, y: Optional[np.ndarray] = None) -> 'StandardScaler':
        """Fit scaler to data."""
        self.mean_ = np.mean(X, axis=0)
        self.std_ = np.std(X, axis=0)
        self.std_[self.std_ == 0] = 1  # Avoid division by zero
        self.is_fitted = True
        self.parameters = {"mean": self.mean_.tolist(), "std": self.std_.tolist()}
        return self
    
    def transform(self, X: np.ndarray) -> np.ndarray:
        """Apply scaling transformation."""
        if not self.is_fitted:
            raise ValueError("Scaler must be fitted before transform")
        return (X - self.mean_) / self.std_


class MinMaxScaler(Transform):
    """Min-max scaling transformation."""
    
    def __init__(self, feature_range: Tuple[float, float] = (0, 1)):
        """Initialize min-max scaler."""
        super().__init__("minmax_scaler")
        self.feature_range = feature_range
        self.min_: Optional[np.ndarray] = None
        self.max_: Optional[np.ndarray] = None
        self.scale_: Optional[np.ndarray] = None
    
    def fit(self, X: np.ndarray, y: Optional[np.ndarray] = None) -> 'MinMaxScaler':
        """Fit scaler to data."""
        self.min_ = np.min(X, axis=0)
        self.max_ = np.max(X, axis=0)
        self.scale_ = (self.feature_range[1] - self.feature_range[0]) / (self.max_ - self.min_)
        self.scale_[self.max_ == self.min_] = 0  # Avoid division by zero
        self.is_fitted = True
        self.parameters = {
            "min": self.min_.tolist(),
            "max": self.max_.tolist(),
            "scale": self.scale_.tolist(),
            "feature_range": self.feature_range
        }
        return self
    
    def transform(self, X: np.ndarray) -> np.ndarray:
        """Apply min-max scaling transformation."""
        if not self.is_fitted:
            raise ValueError("Scaler must be fitted before transform")
        X_scaled = (X - self.min_) * self.scale_
        return X_scaled + self.feature_range[0]


class DataValidator:
    """Validates data quality and consistency."""
    
    def __init__(self, config: DataConfig):
        """Initialize data validator."""
        self.config = config
        self.validation_results: Dict[str, Any] = {}
    
    def validate_data(self, X: np.ndarray, y: Optional[np.ndarray] = None) -> Dict[str, Any]:
        """Validate data quality.
        
        Args:
            X: Input features
            y: Target values (optional)
            
        Returns:
            Validation results
        """
        results = {
            "is_valid": True,
            "errors": [],
            "warnings": [],
            "statistics": {}
        }
        
        # Check for NaN values
        nan_count = np.isnan(X).sum()
        if nan_count > 0:
            results["warnings"].append(f"Found {nan_count} NaN values")
        
        # Check for infinite values
        inf_count = np.isinf(X).sum()
        if inf_count > 0:
            results["errors"].append(f"Found {inf_count} infinite values")
            results["is_valid"] = False
        
        # Check data shape
        if len(X.shape) != 2:
            results["errors"].append(f"Expected 2D array, got {len(X.shape)}D")
            results["is_valid"] = False
        
        # Validate target data if provided
        if y is not None:
            if len(y) != len(X):
                results["errors"].append(f"X and y length mismatch: {len(X)} vs {len(y)}")
                results["is_valid"] = False
        
        # Calculate statistics
        results["statistics"] = {
            "n_samples": X.shape[0],
            "n_features": X.shape[1] if len(X.shape) > 1 else 1,
            "mean": np.mean(X, axis=0).tolist() if len(X.shape) > 1 else [np.mean(X)],
            "std": np.std(X, axis=0).tolist() if len(X.shape) > 1 else [np.std(X)],
            "min": np.min(X, axis=0).tolist() if len(X.shape) > 1 else [np.min(X)],
            "max": np.max(X, axis=0).tolist() if len(X.shape) > 1 else [np.max(X)]
        }
        
        self.validation_results = results
        return results
    
    def get_validation_report(self) -> str:
        """Generate a human-readable validation report."""
        if not self.validation_results:
            return "No validation performed yet."
        
        report = ["Data Validation Report", "=" * 25]
        
        if self.validation_results["is_valid"]:
            report.append("✓ Data validation PASSED")
        else:
            report.append("✗ Data validation FAILED")
        
        if self.validation_results["errors"]:
            report.append("\nErrors:")
            for error in self.validation_results["errors"]:
                report.append(f"  - {error}")
        
        if self.validation_results["warnings"]:
            report.append("\nWarnings:")
            for warning in self.validation_results["warnings"]:
                report.append(f"  - {warning}")
        
        stats = self.validation_results["statistics"]
        report.append(f"\nStatistics:")
        report.append(f"  - Samples: {stats['n_samples']}")
        report.append(f"  - Features: {stats['n_features']}")
        
        return "\n".join(report)


class CacheManager:
    """Manages caching of processed data."""
    
    def __init__(self, cache_dir: str = "./cache", ttl: int = 3600):
        """Initialize cache manager."""
        self.cache_dir = cache_dir
        self.ttl = ttl
        self._ensure_cache_dir()
    
    def _ensure_cache_dir(self):
        """Ensure cache directory exists."""
        import os
        os.makedirs(self.cache_dir, exist_ok=True)
    
    def _get_cache_key(self, data_config: Dict[str, Any], transform_params: Dict[str, Any]) -> str:
        """Generate cache key from configuration."""
        cache_input = {**data_config, **transform_params}
        cache_str = json.dumps(cache_input, sort_keys=True)
        return hashlib.md5(cache_str.encode()).hexdigest()
    
    def get_cached_data(self, cache_key: str) -> Optional[Tuple[np.ndarray, Optional[np.ndarray]]]:
        """Retrieve cached data if available and valid."""
        import os
        import pickle
        
        cache_file = os.path.join(self.cache_dir, f"{cache_key}.pkl")
        metadata_file = os.path.join(self.cache_dir, f"{cache_key}.meta")
        
        if not (os.path.exists(cache_file) and os.path.exists(metadata_file)):
            return None
        
        # Check if cache is still valid
        try:
            with open(metadata_file, 'r') as f:
                metadata = json.load(f)
            
            cache_time = datetime.fromisoformat(metadata['timestamp'])
            if (datetime.now() - cache_time).total_seconds() > self.ttl:
                return None
            
            with open(cache_file, 'rb') as f:
                return pickle.load(f)
        
        except Exception:
            return None
    
    def cache_data(self, cache_key: str, X: np.ndarray, y: Optional[np.ndarray] = None):
        """Cache processed data."""
        import os
        import pickle
        
        cache_file = os.path.join(self.cache_dir, f"{cache_key}.pkl")
        metadata_file = os.path.join(self.cache_dir, f"{cache_key}.meta")
        
        try:
            with open(cache_file, 'wb') as f:
                pickle.dump((X, y), f)
            
            metadata = {
                'timestamp': datetime.now().isoformat(),
                'data_shape': X.shape,
                'target_shape': y.shape if y is not None else None
            }
            
            with open(metadata_file, 'w') as f:
                json.dump(metadata, f)
        
        except Exception as e:
            print(f"Failed to cache data: {e}")


class DataPipeline:
    """Main data pipeline for MLE-STAR framework."""
    
    def __init__(self, config: DataConfig):
        """Initialize data pipeline."""
        self.config = config
        self.preprocessing_steps: List[Transform] = []
        self.validator = DataValidator(config)
        self.cache_manager = CacheManager(config.cache_directory, config.cache_ttl) if config.enable_caching else None
        
        # Pipeline state
        self.is_fitted = False
        self.feature_names: List[str] = []
        self.statistics: Dict[str, Any] = {}
        
    def add_transform(self, transform: Transform) -> 'DataPipeline':
        """Add a transformation step to the pipeline."""
        self.preprocessing_steps.append(transform)
        return self
    
    def add_standard_scaler(self) -> 'DataPipeline':
        """Add standard scaler to the pipeline."""
        return self.add_transform(StandardScaler())
    
    def add_minmax_scaler(self, feature_range: Tuple[float, float] = (0, 1)) -> 'DataPipeline':
        """Add min-max scaler to the pipeline."""
        return self.add_transform(MinMaxScaler(feature_range))
    
    def fit(self, X: np.ndarray, y: Optional[np.ndarray] = None) -> 'DataPipeline':
        """Fit the pipeline to training data."""
        # Validate input data
        validation_results = self.validator.validate_data(X, y)
        if not validation_results["is_valid"]:
            raise ValueError(f"Data validation failed: {validation_results['errors']}")
        
        # Fit each transformation step
        X_transformed = X.copy()
        for transform in self.preprocessing_steps:
            transform.fit(X_transformed, y)
            X_transformed = transform.transform(X_transformed)
        
        self.is_fitted = True
        self.statistics = validation_results["statistics"]
        return self
    
    def transform(self, X: np.ndarray) -> np.ndarray:
        """Transform data using fitted pipeline."""
        if not self.is_fitted:
            raise ValueError("Pipeline must be fitted before transform")
        
        X_transformed = X.copy()
        for transform in self.preprocessing_steps:
            X_transformed = transform.transform(X_transformed)
        
        return X_transformed
    
    def fit_transform(self, X: np.ndarray, y: Optional[np.ndarray] = None) -> np.ndarray:
        """Fit pipeline and transform data."""
        return self.fit(X, y).transform(X)
    
    def split_data(self, X: np.ndarray, y: Optional[np.ndarray] = None) -> Dict[str, np.ndarray]:
        """Split data into train/validation/test sets."""
        from sklearn.model_selection import train_test_split
        
        # First split: train + val vs test
        if y is not None:
            X_temp, X_test, y_temp, y_test = train_test_split(
                X, y, 
                test_size=self.config.test_ratio,
                random_state=self.config.random_state,
                stratify=y if self.config.stratify else None
            )
        else:
            X_temp, X_test = train_test_split(
                X, 
                test_size=self.config.test_ratio,
                random_state=self.config.random_state
            )
            y_temp, y_test = None, None
        
        # Second split: train vs val
        val_size = self.config.val_ratio / (self.config.train_ratio + self.config.val_ratio)
        
        if y_temp is not None:
            X_train, X_val, y_train, y_val = train_test_split(
                X_temp, y_temp,
                test_size=val_size,
                random_state=self.config.random_state,
                stratify=y_temp if self.config.stratify else None
            )
        else:
            X_train, X_val = train_test_split(
                X_temp,
                test_size=val_size,
                random_state=self.config.random_state
            )
            y_train, y_val = None, None
        
        result = {
            "X_train": X_train,
            "X_val": X_val,
            "X_test": X_test
        }
        
        if y is not None:
            result.update({
                "y_train": y_train,
                "y_val": y_val,
                "y_test": y_test
            })
        
        return result
    
    def get_pipeline_info(self) -> Dict[str, Any]:
        """Get comprehensive pipeline information."""
        return {
            "is_fitted": self.is_fitted,
            "num_transforms": len(self.preprocessing_steps),
            "transforms": [t.name for t in self.preprocessing_steps],
            "config": self.config.to_dict(),
            "statistics": self.statistics,
            "validation_results": self.validator.validation_results
        }
    
    def save_pipeline(self, path: str) -> bool:
        """Save the fitted pipeline to disk."""
        import pickle
        
        try:
            pipeline_data = {
                "config": self.config,
                "preprocessing_steps": self.preprocessing_steps,
                "is_fitted": self.is_fitted,
                "statistics": self.statistics,
                "feature_names": self.feature_names
            }
            
            with open(path, 'wb') as f:
                pickle.dump(pipeline_data, f)
            
            return True
        except Exception as e:
            print(f"Failed to save pipeline: {e}")
            return False
    
    def load_pipeline(self, path: str) -> bool:
        """Load a fitted pipeline from disk."""
        import pickle
        
        try:
            with open(path, 'rb') as f:
                pipeline_data = pickle.load(f)
            
            self.config = pipeline_data["config"]
            self.preprocessing_steps = pipeline_data["preprocessing_steps"]
            self.is_fitted = pipeline_data["is_fitted"]
            self.statistics = pipeline_data["statistics"]
            self.feature_names = pipeline_data["feature_names"]
            
            return True
        except Exception as e:
            print(f"Failed to load pipeline: {e}")
            return False