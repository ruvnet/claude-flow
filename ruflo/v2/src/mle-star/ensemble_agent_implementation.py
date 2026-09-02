"""
MLE-STAR Ensemble Agent Implementation
Sophisticated model ensemble strategies for optimal performance
"""

import numpy as np
from typing import Dict, List, Any, Tuple, Optional
from sklearn.base import BaseEstimator, RegressorMixin, ClassifierMixin
from sklearn.model_selection import cross_val_predict
from sklearn.linear_model import LogisticRegression, Ridge
from sklearn.ensemble import RandomForestRegressor, RandomForestClassifier
import warnings
warnings.filterwarnings('ignore')


class DynamicWeightingEnsemble(BaseEstimator):
    """Dynamic weighting ensemble with adaptive weight calculation"""
    
    def __init__(self, models: List[BaseEstimator], task_type: str = 'classification'):
        self.models = models
        self.task_type = task_type
        self.weights = None
        self.performance_history = []
        
    def fit(self, X, y):
        """Fit all models and compute dynamic weights"""
        # Fit all base models
        for model in self.models:
            model.fit(X, y)
        
        # Compute weights based on cross-validation performance
        self.weights = self._compute_dynamic_weights(X, y)
        
        return self
    
    def _compute_dynamic_weights(self, X, y):
        """Compute weights based on model performance"""
        performances = []
        
        for model in self.models:
            # Use cross-validation to estimate performance
            if self.task_type == 'classification':
                from sklearn.metrics import accuracy_score
                preds = cross_val_predict(model, X, y, cv=3, method='predict')
                score = accuracy_score(y, preds)
            else:
                from sklearn.metrics import mean_squared_error
                preds = cross_val_predict(model, X, y, cv=3)
                score = -mean_squared_error(y, preds)  # Negative for maximization
            
            performances.append(score)
        
        # Convert to weights (softmax for smooth weights)
        performances = np.array(performances)
        exp_scores = np.exp(performances - np.max(performances))
        weights = exp_scores / exp_scores.sum()
        
        return weights
    
    def predict(self, X):
        """Make weighted predictions"""
        if self.task_type == 'classification':
            # For classification, use weighted voting
            predictions = np.zeros((X.shape[0], len(np.unique(self.models[0].classes_))))
            
            for model, weight in zip(self.models, self.weights):
                model_preds = model.predict_proba(X)
                predictions += weight * model_preds
            
            return np.argmax(predictions, axis=1)
        else:
            # For regression, use weighted average
            predictions = np.zeros(X.shape[0])
            
            for model, weight in zip(self.models, self.weights):
                predictions += weight * model.predict(X)
            
            return predictions


class StackingEnsemble(BaseEstimator):
    """Advanced stacking ensemble with meta-learner"""
    
    def __init__(self, base_models: List[BaseEstimator], meta_model: BaseEstimator = None,
                 task_type: str = 'classification', use_proba: bool = True):
        self.base_models = base_models
        self.meta_model = meta_model
        self.task_type = task_type
        self.use_proba = use_proba
        
        # Default meta-model if not provided
        if self.meta_model is None:
            if task_type == 'classification':
                self.meta_model = LogisticRegression()
            else:
                self.meta_model = Ridge()
    
    def fit(self, X, y):
        """Fit base models and meta-model"""
        # Generate base model predictions using cross-validation
        meta_features = self._generate_meta_features(X, y, training=True)
        
        # Fit meta-model on meta-features
        self.meta_model.fit(meta_features, y)
        
        # Refit base models on full training data
        for model in self.base_models:
            model.fit(X, y)
        
        return self
    
    def _generate_meta_features(self, X, y=None, training=False):
        """Generate meta-features from base model predictions"""
        n_samples = X.shape[0]
        
        if training and y is not None:
            # Use cross-validation during training to avoid overfitting
            if self.task_type == 'classification' and self.use_proba:
                n_classes = len(np.unique(y))
                meta_features = np.zeros((n_samples, len(self.base_models) * n_classes))
            else:
                meta_features = np.zeros((n_samples, len(self.base_models)))
            
            for i, model in enumerate(self.base_models):
                if self.task_type == 'classification' and self.use_proba:
                    # Use probability predictions for classification
                    preds = cross_val_predict(model, X, y, cv=3, method='predict_proba')
                    meta_features[:, i*n_classes:(i+1)*n_classes] = preds
                else:
                    # Use direct predictions
                    preds = cross_val_predict(model, X, y, cv=3)
                    meta_features[:, i] = preds
        else:
            # Use fitted models for test predictions
            if self.task_type == 'classification' and self.use_proba:
                # Stack probability predictions
                meta_features = []
                for model in self.base_models:
                    proba = model.predict_proba(X)
                    meta_features.append(proba)
                meta_features = np.hstack(meta_features)
            else:
                # Stack direct predictions
                meta_features = np.column_stack([
                    model.predict(X) for model in self.base_models
                ])
        
        return meta_features
    
    def predict(self, X):
        """Make predictions using meta-model"""
        meta_features = self._generate_meta_features(X)
        return self.meta_model.predict(meta_features)
    
    def predict_proba(self, X):
        """Probability predictions for classification"""
        if self.task_type != 'classification':
            raise ValueError("predict_proba only available for classification")
        
        meta_features = self._generate_meta_features(X)
        return self.meta_model.predict_proba(meta_features)


class MixtureOfExpertsEnsemble(BaseEstimator):
    """Mixture of Experts ensemble with gating network"""
    
    def __init__(self, expert_models: List[BaseEstimator], gate_features: Optional[List[int]] = None):
        self.expert_models = expert_models
        self.gate_features = gate_features
        self.gate_model = None
        self.n_experts = len(expert_models)
        
    def fit(self, X, y):
        """Fit experts and gating network"""
        # Fit all expert models
        for expert in self.expert_models:
            expert.fit(X, y)
        
        # Create gating network training data
        gate_X = X if self.gate_features is None else X[:, self.gate_features]
        
        # Train gating network to predict best expert for each sample
        expert_performances = self._evaluate_expert_performance(X, y)
        best_experts = np.argmax(expert_performances, axis=1)
        
        # Simple gating network (could be more sophisticated)
        from sklearn.ensemble import RandomForestClassifier
        self.gate_model = RandomForestClassifier(n_estimators=50)
        self.gate_model.fit(gate_X, best_experts)
        
        return self
    
    def _evaluate_expert_performance(self, X, y):
        """Evaluate each expert's performance on each sample"""
        n_samples = X.shape[0]
        performances = np.zeros((n_samples, self.n_experts))
        
        # Use leave-one-out style evaluation
        for i in range(n_samples):
            mask = np.ones(n_samples, dtype=bool)
            mask[i] = False
            
            for j, expert in enumerate(self.expert_models):
                # Train on all except current sample
                expert_temp = expert.__class__(**expert.get_params())
                expert_temp.fit(X[mask], y[mask])
                
                # Evaluate on current sample
                pred = expert_temp.predict(X[i:i+1])
                performances[i, j] = -np.abs(pred[0] - y[i])  # Negative error
        
        return performances
    
    def predict(self, X):
        """Make predictions using gated mixture of experts"""
        gate_X = X if self.gate_features is None else X[:, self.gate_features]
        
        # Get gating probabilities
        gate_probs = self.gate_model.predict_proba(gate_X)
        
        # Get predictions from all experts
        expert_preds = np.column_stack([
            expert.predict(X) for expert in self.expert_models
        ])
        
        # Weighted combination based on gating
        predictions = np.sum(expert_preds * gate_probs, axis=1)
        
        return predictions


class BayesianModelAveraging(BaseEstimator):
    """Bayesian Model Averaging ensemble"""
    
    def __init__(self, models: List[BaseEstimator], prior_weights: Optional[np.ndarray] = None):
        self.models = models
        self.prior_weights = prior_weights or np.ones(len(models)) / len(models)
        self.posterior_weights = None
        
    def fit(self, X, y):
        """Fit models and compute posterior weights"""
        # Fit all models
        for model in self.models:
            model.fit(X, y)
        
        # Compute posterior weights using BIC
        self.posterior_weights = self._compute_posterior_weights(X, y)
        
        return self
    
    def _compute_posterior_weights(self, X, y):
        """Compute posterior weights using Bayesian Information Criterion"""
        n_samples = X.shape[0]
        bic_scores = []
        
        for model in self.models:
            # Compute residual sum of squares
            predictions = model.predict(X)
            rss = np.sum((y - predictions) ** 2)
            
            # Estimate number of parameters (simplified)
            n_params = self._estimate_n_params(model)
            
            # Compute BIC
            bic = n_samples * np.log(rss / n_samples) + n_params * np.log(n_samples)
            bic_scores.append(bic)
        
        # Convert BIC to weights
        bic_scores = np.array(bic_scores)
        # Lower BIC is better, so negate for exp
        exp_scores = np.exp(-0.5 * (bic_scores - np.min(bic_scores)))
        
        # Combine with prior
        posterior = exp_scores * self.prior_weights
        posterior /= posterior.sum()
        
        return posterior
    
    def _estimate_n_params(self, model):
        """Estimate number of parameters in model"""
        # Simplified estimation - in practice would be model-specific
        if hasattr(model, 'coef_'):
            return np.prod(model.coef_.shape)
        elif hasattr(model, 'tree_'):
            return model.tree_.node_count
        else:
            return 10  # Default estimate
    
    def predict(self, X):
        """Make Bayesian averaged predictions"""
        predictions = np.zeros(X.shape[0])
        
        for model, weight in zip(self.models, self.posterior_weights):
            predictions += weight * model.predict(X)
        
        return predictions


class EnsembleOptimizer:
    """Main ensemble optimization class"""
    
    def __init__(self):
        self.ensemble_strategies = {
            'dynamic_weighting': DynamicWeightingEnsemble,
            'stacking': StackingEnsemble,
            'mixture_of_experts': MixtureOfExpertsEnsemble,
            'bayesian_averaging': BayesianModelAveraging
        }
    
    def create_ensemble(self, models: List[BaseEstimator], strategy: str = 'stacking',
                       task_type: str = 'classification', **kwargs) -> BaseEstimator:
        """Create an ensemble with specified strategy"""
        if strategy not in self.ensemble_strategies:
            raise ValueError(f"Unknown strategy: {strategy}")
        
        ensemble_class = self.ensemble_strategies[strategy]
        
        if strategy == 'dynamic_weighting':
            return ensemble_class(models, task_type=task_type)
        elif strategy == 'stacking':
            return ensemble_class(models, task_type=task_type, **kwargs)
        elif strategy == 'mixture_of_experts':
            return ensemble_class(models, **kwargs)
        elif strategy == 'bayesian_averaging':
            return ensemble_class(models, **kwargs)
    
    def optimize_ensemble_composition(self, candidate_models: List[BaseEstimator],
                                    X_val, y_val, max_models: int = 5) -> List[BaseEstimator]:
        """Optimize which models to include in ensemble"""
        from sklearn.metrics import accuracy_score, mean_squared_error
        
        # Evaluate individual model performances
        performances = []
        for model in candidate_models:
            val_pred = model.predict(X_val)
            
            if hasattr(model, 'predict_proba'):  # Classification
                score = accuracy_score(y_val, val_pred)
            else:  # Regression
                score = -mean_squared_error(y_val, val_pred)
            
            performances.append(score)
        
        # Sort models by performance
        sorted_indices = np.argsort(performances)[::-1]
        
        # Greedy selection of diverse models
        selected_models = [candidate_models[sorted_indices[0]]]
        selected_indices = [sorted_indices[0]]
        
        for idx in sorted_indices[1:]:
            if len(selected_models) >= max_models:
                break
            
            # Check if model adds diversity
            model = candidate_models[idx]
            
            # Simple diversity check - predictions should be different
            model_pred = model.predict(X_val)
            
            is_diverse = True
            for selected_idx in selected_indices:
                selected_pred = candidate_models[selected_idx].predict(X_val)
                correlation = np.corrcoef(model_pred, selected_pred)[0, 1]
                
                if abs(correlation) > 0.95:  # Too similar
                    is_diverse = False
                    break
            
            if is_diverse:
                selected_models.append(model)
                selected_indices.append(idx)
        
        return selected_models


# Example usage and testing
if __name__ == "__main__":
    # Create sample data
    from sklearn.datasets import make_classification
    from sklearn.model_selection import train_test_split
    from sklearn.tree import DecisionTreeClassifier
    from sklearn.svm import SVC
    from sklearn.neural_network import MLPClassifier
    
    X, y = make_classification(n_samples=1000, n_features=20, n_informative=15,
                              n_redundant=5, random_state=42)
    X_train, X_test, y_train, y_test = train_test_split(X, y, test_size=0.2, random_state=42)
    
    # Create base models
    base_models = [
        DecisionTreeClassifier(max_depth=5, random_state=42),
        RandomForestClassifier(n_estimators=50, random_state=42),
        SVC(probability=True, random_state=42),
        MLPClassifier(hidden_layer_sizes=(50,), random_state=42, max_iter=1000)
    ]
    
    # Fit base models
    for model in base_models:
        model.fit(X_train, y_train)
    
    # Test different ensemble strategies
    optimizer = EnsembleOptimizer()
    
    strategies = ['dynamic_weighting', 'stacking', 'mixture_of_experts', 'bayesian_averaging']
    
    print("Ensemble Performance Comparison:")
    print("-" * 50)
    
    for strategy in strategies:
        if strategy == 'mixture_of_experts':
            ensemble = optimizer.create_ensemble(base_models[:3], strategy=strategy)
        else:
            ensemble = optimizer.create_ensemble(base_models, strategy=strategy)
        
        ensemble.fit(X_train, y_train)
        predictions = ensemble.predict(X_test)
        accuracy = accuracy_score(y_test, predictions)
        
        print(f"{strategy}: {accuracy:.4f}")
    
    print("\nIndividual Model Performance:")
    print("-" * 50)
    
    for i, model in enumerate(base_models):
        predictions = model.predict(X_test)
        accuracy = accuracy_score(y_test, predictions)
        print(f"Model {i+1}: {accuracy:.4f}")