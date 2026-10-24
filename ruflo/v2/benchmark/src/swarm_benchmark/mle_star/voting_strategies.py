"""
Voting Strategies for MLE-STAR Ensemble

Implements various voting and consensus strategies for combining predictions
from multiple models in an ensemble.
"""

import asyncio
import numpy as np
import logging
from abc import ABC, abstractmethod
from typing import List, Any, Dict, Optional, Union
from dataclasses import dataclass


@dataclass
class VotingResult:
    """Result of a voting process."""
    prediction: Any
    confidence: float
    weights: List[float]
    individual_votes: List[Any]
    consensus_strength: float


class VotingStrategy(ABC):
    """Base class for voting strategies."""
    
    def __init__(self):
        self.logger = logging.getLogger(self.__class__.__name__)
    
    @abstractmethod
    async def vote(self, predictions: List[Any]) -> Any:
        """
        Combine multiple predictions into a single result.
        
        Args:
            predictions: List of predictions from different models
            
        Returns:
            Combined prediction
        """
        pass
    
    async def vote_with_details(self, predictions: List[Any]) -> VotingResult:
        """
        Vote and return detailed results.
        
        Args:
            predictions: List of predictions from different models
            
        Returns:
            VotingResult with detailed information
        """
        final_prediction = await self.vote(predictions)
        
        return VotingResult(
            prediction=final_prediction,
            confidence=await self._calculate_confidence(predictions, final_prediction),
            weights=await self._get_weights(predictions),
            individual_votes=predictions,
            consensus_strength=await self._calculate_consensus_strength(predictions, final_prediction)
        )
    
    async def _calculate_confidence(self, predictions: List[Any], final_prediction: Any) -> float:
        """Calculate confidence in the final prediction."""
        try:
            if not predictions:
                return 0.0
                
            # Count agreements
            agreements = sum(1 for pred in predictions if self._predictions_agree(pred, final_prediction))
            return agreements / len(predictions)
        except Exception as e:
            self.logger.error(f"Confidence calculation failed: {e}")
            return 0.0
    
    async def _get_weights(self, predictions: List[Any]) -> List[float]:
        """Get weights used in voting (default: equal weights)."""
        return [1.0 / len(predictions)] * len(predictions) if predictions else []
    
    async def _calculate_consensus_strength(self, predictions: List[Any], final_prediction: Any) -> float:
        """Calculate how strongly the ensemble agrees."""
        return await self._calculate_confidence(predictions, final_prediction)
    
    def _predictions_agree(self, pred1: Any, pred2: Any, tolerance: float = 1e-6) -> bool:
        """Check if two predictions agree."""
        try:
            if isinstance(pred1, (int, float)) and isinstance(pred2, (int, float)):
                return abs(pred1 - pred2) <= tolerance
            elif hasattr(pred1, 'shape') and hasattr(pred2, 'shape'):
                # For numpy arrays or similar
                if pred1.shape != pred2.shape:
                    return False
                return np.allclose(pred1, pred2, atol=tolerance)
            elif hasattr(pred1, 'argmax') and hasattr(pred2, 'argmax'):
                return pred1.argmax() == pred2.argmax()
            else:
                return str(pred1) == str(pred2)
        except Exception:
            return False


class MajorityVoting(VotingStrategy):
    """
    Simple majority voting strategy.
    
    For classification: returns the most common class prediction
    For regression: returns the median of all predictions
    """
    
    async def vote(self, predictions: List[Any]) -> Any:
        """Apply majority voting to predictions."""
        try:
            if not predictions:
                raise ValueError("No predictions to vote on")
            
            if len(predictions) == 1:
                return predictions[0]
            
            # Check if predictions are numerical
            if all(isinstance(p, (int, float)) for p in predictions):
                return self._majority_vote_regression(predictions)
            
            # Check if predictions are arrays (classification probabilities)
            elif all(hasattr(p, 'argmax') for p in predictions):
                return self._majority_vote_classification(predictions)
            
            # Fallback to most common prediction
            else:
                return self._majority_vote_generic(predictions)
                
        except Exception as e:
            self.logger.error(f"Majority voting failed: {e}")
            return predictions[0] if predictions else None
    
    def _majority_vote_regression(self, predictions: List[Union[int, float]]) -> float:
        """Apply majority voting for regression (returns median)."""
        return float(np.median(predictions))
    
    def _majority_vote_classification(self, predictions: List[Any]) -> Any:
        """Apply majority voting for classification."""
        # Get class predictions
        class_predictions = [p.argmax() if hasattr(p, 'argmax') else p for p in predictions]
        
        # Count occurrences
        from collections import Counter
        vote_counts = Counter(class_predictions)
        
        # Return most common class
        most_common_class = vote_counts.most_common(1)[0][0]
        
        # Return prediction in same format as input
        if hasattr(predictions[0], 'argmax'):
            # Return one-hot encoded or probability format
            result = np.zeros_like(predictions[0])
            result[most_common_class] = 1.0
            return result
        else:
            return most_common_class
    
    def _majority_vote_generic(self, predictions: List[Any]) -> Any:
        """Apply majority voting for generic predictions."""
        from collections import Counter
        
        # Convert predictions to strings for counting
        str_predictions = [str(p) for p in predictions]
        vote_counts = Counter(str_predictions)
        
        # Find most common prediction
        most_common_str = vote_counts.most_common(1)[0][0]
        
        # Return original prediction that matches
        for pred in predictions:
            if str(pred) == most_common_str:
                return pred
        
        return predictions[0]  # Fallback


class WeightedVoting(VotingStrategy):
    """
    Weighted voting strategy that assigns different weights to models.
    
    Weights can be based on model performance, confidence, or manually assigned.
    """
    
    def __init__(self, weights: Optional[List[float]] = None, weight_strategy: str = "equal"):
        super().__init__()
        self.manual_weights = weights
        self.weight_strategy = weight_strategy  # "equal", "performance", "confidence"
        self._model_performances = {}
    
    async def vote(self, predictions: List[Any]) -> Any:
        """Apply weighted voting to predictions."""
        try:
            if not predictions:
                raise ValueError("No predictions to vote on")
            
            if len(predictions) == 1:
                return predictions[0]
            
            # Get weights
            weights = await self._calculate_weights(predictions)
            
            # Apply weighted voting based on prediction type
            if all(isinstance(p, (int, float)) for p in predictions):
                return self._weighted_vote_regression(predictions, weights)
            elif all(hasattr(p, 'shape') for p in predictions):
                return self._weighted_vote_arrays(predictions, weights)
            else:
                return self._weighted_vote_generic(predictions, weights)
                
        except Exception as e:
            self.logger.error(f"Weighted voting failed: {e}")
            return predictions[0] if predictions else None
    
    async def _calculate_weights(self, predictions: List[Any]) -> List[float]:
        """Calculate weights for each prediction."""
        n = len(predictions)
        
        if self.manual_weights:
            weights = self.manual_weights[:n]
            if len(weights) < n:
                weights.extend([1.0] * (n - len(weights)))
        elif self.weight_strategy == "equal":
            weights = [1.0] * n
        elif self.weight_strategy == "confidence":
            weights = await self._calculate_confidence_weights(predictions)
        elif self.weight_strategy == "performance":
            weights = await self._calculate_performance_weights(predictions)
        else:
            weights = [1.0] * n
        
        # Normalize weights
        total_weight = sum(weights)
        if total_weight > 0:
            weights = [w / total_weight for w in weights]
        else:
            weights = [1.0 / n] * n
            
        return weights
    
    async def _calculate_confidence_weights(self, predictions: List[Any]) -> List[float]:
        """Calculate weights based on prediction confidence."""
        weights = []
        
        for pred in predictions:
            if hasattr(pred, 'confidence'):
                weights.append(float(pred.confidence))
            elif hasattr(pred, 'max'):
                weights.append(float(pred.max()))
            else:
                weights.append(1.0)
        
        return weights
    
    async def _calculate_performance_weights(self, predictions: List[Any]) -> List[float]:
        """Calculate weights based on historical model performance."""
        # This would typically use stored performance metrics
        # For now, return equal weights
        return [1.0] * len(predictions)
    
    def _weighted_vote_regression(self, predictions: List[Union[int, float]], weights: List[float]) -> float:
        """Apply weighted voting for regression."""
        weighted_sum = sum(p * w for p, w in zip(predictions, weights))
        return weighted_sum
    
    def _weighted_vote_arrays(self, predictions: List[Any], weights: List[float]) -> Any:
        """Apply weighted voting for array predictions (e.g., probabilities)."""
        try:
            # Convert to numpy arrays
            arrays = [np.asarray(p) for p in predictions]
            
            # Ensure all arrays have same shape
            if not all(arr.shape == arrays[0].shape for arr in arrays):
                raise ValueError("All prediction arrays must have the same shape")
            
            # Calculate weighted average
            weighted_sum = np.zeros_like(arrays[0])
            for arr, weight in zip(arrays, weights):
                weighted_sum += arr * weight
            
            return weighted_sum
            
        except Exception as e:
            self.logger.error(f"Weighted array voting failed: {e}")
            return predictions[0]
    
    def _weighted_vote_generic(self, predictions: List[Any], weights: List[float]) -> Any:
        """Apply weighted voting for generic predictions."""
        # For generic predictions, return the prediction with highest weight
        max_weight_idx = weights.index(max(weights))
        return predictions[max_weight_idx]
    
    async def _get_weights(self, predictions: List[Any]) -> List[float]:
        """Get the weights used in voting."""
        return await self._calculate_weights(predictions)


class StackingEnsemble(VotingStrategy):
    """
    Stacking ensemble strategy that uses a meta-model to combine predictions.
    
    The meta-model is trained on the predictions of base models to make
    the final prediction.
    """
    
    def __init__(self, meta_model_type: str = "linear_regression"):
        super().__init__()
        self.meta_model_type = meta_model_type
        self.meta_model = None
        self._is_trained = False
    
    async def vote(self, predictions: List[Any]) -> Any:
        """Apply stacking ensemble to predictions."""
        try:
            if not predictions:
                raise ValueError("No predictions to vote on")
            
            if len(predictions) == 1:
                return predictions[0]
            
            # If meta-model not trained, fall back to weighted average
            if not self._is_trained:
                self.logger.warning("Meta-model not trained, falling back to weighted average")
                return await self._fallback_vote(predictions)
            
            # Prepare input for meta-model
            meta_input = await self._prepare_meta_input(predictions)
            
            # Get meta-model prediction
            result = await self._predict_with_meta_model(meta_input)
            
            return result
            
        except Exception as e:
            self.logger.error(f"Stacking ensemble failed: {e}")
            return await self._fallback_vote(predictions)
    
    async def train_meta_model(self, training_predictions: List[List[Any]], training_targets: List[Any]):
        """
        Train the meta-model on base model predictions.
        
        Args:
            training_predictions: List of prediction sets from base models
            training_targets: True targets for training
        """
        try:
            # Prepare training data
            X = await self._prepare_training_data(training_predictions)
            y = np.array(training_targets)
            
            # Train meta-model
            self.meta_model = await self._create_meta_model()
            await self._fit_meta_model(X, y)
            
            self._is_trained = True
            self.logger.info("Meta-model training completed")
            
        except Exception as e:
            self.logger.error(f"Meta-model training failed: {e}")
            self._is_trained = False
    
    async def _prepare_meta_input(self, predictions: List[Any]) -> np.ndarray:
        """Prepare predictions as input for meta-model."""
        try:
            # Convert predictions to feature vector
            features = []
            
            for pred in predictions:
                if isinstance(pred, (int, float)):
                    features.append(pred)
                elif hasattr(pred, 'flatten'):
                    features.extend(pred.flatten())
                elif hasattr(pred, '__iter__'):
                    features.extend(list(pred))
                else:
                    features.append(float(pred))
            
            return np.array([features])
            
        except Exception as e:
            self.logger.error(f"Meta-input preparation failed: {e}")
            return np.array([[1.0] * len(predictions)])
    
    async def _prepare_training_data(self, training_predictions: List[List[Any]]) -> np.ndarray:
        """Prepare training data for meta-model."""
        X = []
        
        for pred_set in training_predictions:
            meta_input = await self._prepare_meta_input(pred_set)
            X.append(meta_input[0])
        
        return np.array(X)
    
    async def _create_meta_model(self):
        """Create the meta-model."""
        try:
            if self.meta_model_type == "linear_regression":
                from sklearn.linear_model import LinearRegression
                return LinearRegression()
            elif self.meta_model_type == "ridge":
                from sklearn.linear_model import Ridge
                return Ridge()
            elif self.meta_model_type == "random_forest":
                from sklearn.ensemble import RandomForestRegressor
                return RandomForestRegressor(n_estimators=10, random_state=42)
            else:
                # Default fallback
                from sklearn.linear_model import LinearRegression
                return LinearRegression()
                
        except ImportError:
            self.logger.error("sklearn not available, meta-model creation failed")
            return None
    
    async def _fit_meta_model(self, X: np.ndarray, y: np.ndarray):
        """Fit the meta-model."""
        if self.meta_model is not None:
            self.meta_model.fit(X, y)
    
    async def _predict_with_meta_model(self, meta_input: np.ndarray) -> Any:
        """Make prediction using meta-model."""
        if self.meta_model is not None:
            return self.meta_model.predict(meta_input)[0]
        else:
            return meta_input[0][0]  # Fallback
    
    async def _fallback_vote(self, predictions: List[Any]) -> Any:
        """Fallback voting strategy when stacking fails."""
        # Use weighted voting as fallback
        weighted_voter = WeightedVoting()
        return await weighted_voter.vote(predictions)


class BayesianAveraging(VotingStrategy):
    """
    Bayesian model averaging strategy.
    
    Combines predictions based on posterior probabilities of models,
    taking into account model uncertainty and prior beliefs.
    """
    
    def __init__(self, prior_weights: Optional[List[float]] = None, uncertainty_weight: float = 0.1):
        super().__init__()
        self.prior_weights = prior_weights
        self.uncertainty_weight = uncertainty_weight
        self._model_likelihoods = {}
    
    async def vote(self, predictions: List[Any]) -> Any:
        """Apply Bayesian model averaging to predictions."""
        try:
            if not predictions:
                raise ValueError("No predictions to vote on")
            
            if len(predictions) == 1:
                return predictions[0]
            
            # Calculate posterior weights
            posterior_weights = await self._calculate_posterior_weights(predictions)
            
            # Apply Bayesian averaging
            if all(isinstance(p, (int, float)) for p in predictions):
                return self._bayesian_average_regression(predictions, posterior_weights)
            elif all(hasattr(p, 'shape') for p in predictions):
                return self._bayesian_average_arrays(predictions, posterior_weights)
            else:
                return self._bayesian_average_generic(predictions, posterior_weights)
                
        except Exception as e:
            self.logger.error(f"Bayesian averaging failed: {e}")
            return predictions[0] if predictions else None
    
    async def _calculate_posterior_weights(self, predictions: List[Any]) -> List[float]:
        """Calculate posterior weights for Bayesian averaging."""
        n = len(predictions)
        
        # Start with prior weights
        if self.prior_weights and len(self.prior_weights) >= n:
            prior = self.prior_weights[:n]
        else:
            prior = [1.0] * n
        
        # Calculate likelihoods based on prediction uncertainty
        likelihoods = await self._calculate_likelihoods(predictions)
        
        # Calculate posterior (prior × likelihood)
        posterior = [p * l for p, l in zip(prior, likelihoods)]
        
        # Normalize
        total = sum(posterior)
        if total > 0:
            posterior = [w / total for w in posterior]
        else:
            posterior = [1.0 / n] * n
        
        return posterior
    
    async def _calculate_likelihoods(self, predictions: List[Any]) -> List[float]:
        """Calculate likelihood of each prediction based on uncertainty."""
        likelihoods = []
        
        for pred in predictions:
            # Calculate uncertainty (higher uncertainty = lower likelihood)
            uncertainty = await self._estimate_prediction_uncertainty(pred)
            likelihood = np.exp(-self.uncertainty_weight * uncertainty)
            likelihoods.append(likelihood)
        
        return likelihoods
    
    async def _estimate_prediction_uncertainty(self, prediction: Any) -> float:
        """Estimate uncertainty in a prediction."""
        try:
            if hasattr(prediction, 'std'):
                return float(prediction.std())
            elif hasattr(prediction, 'var'):
                return float(np.sqrt(prediction.var()))
            elif hasattr(prediction, 'entropy'):
                return float(prediction.entropy())
            elif hasattr(prediction, 'shape') and len(prediction.shape) > 0:
                # For probability distributions, use entropy
                p = np.asarray(prediction)
                p = p / p.sum()  # Normalize
                entropy = -np.sum(p * np.log(p + 1e-10))
                return entropy
            else:
                return 0.1  # Default uncertainty
                
        except Exception as e:
            self.logger.error(f"Uncertainty estimation failed: {e}")
            return 0.1
    
    def _bayesian_average_regression(self, predictions: List[Union[int, float]], weights: List[float]) -> float:
        """Apply Bayesian averaging for regression."""
        weighted_sum = sum(p * w for p, w in zip(predictions, weights))
        return weighted_sum
    
    def _bayesian_average_arrays(self, predictions: List[Any], weights: List[float]) -> Any:
        """Apply Bayesian averaging for array predictions."""
        try:
            arrays = [np.asarray(p) for p in predictions]
            
            if not all(arr.shape == arrays[0].shape for arr in arrays):
                raise ValueError("All prediction arrays must have the same shape")
            
            weighted_sum = np.zeros_like(arrays[0])
            for arr, weight in zip(arrays, weights):
                weighted_sum += arr * weight
            
            return weighted_sum
            
        except Exception as e:
            self.logger.error(f"Bayesian array averaging failed: {e}")
            return predictions[0]
    
    def _bayesian_average_generic(self, predictions: List[Any], weights: List[float]) -> Any:
        """Apply Bayesian averaging for generic predictions."""
        # Return prediction with highest posterior weight
        max_weight_idx = weights.index(max(weights))
        return predictions[max_weight_idx]
    
    async def _get_weights(self, predictions: List[Any]) -> List[float]:
        """Get the posterior weights used in Bayesian averaging."""
        return await self._calculate_posterior_weights(predictions)
    
    def update_model_performance(self, model_idx: int, performance: float):
        """Update model performance for better likelihood estimation."""
        self._model_likelihoods[model_idx] = performance