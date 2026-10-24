"""
Advanced Ensemble Techniques with Neural Network Integration
"""

import numpy as np
import torch
import torch.nn as nn
import torch.optim as optim
from sklearn.base import BaseEstimator
from typing import List, Dict, Any, Optional, Tuple
import json


class NeuralGatingNetwork(nn.Module):
    """Neural network for sophisticated gating in mixture of experts"""
    
    def __init__(self, input_dim: int, n_experts: int, hidden_dim: int = 64):
        super().__init__()
        self.network = nn.Sequential(
            nn.Linear(input_dim, hidden_dim),
            nn.ReLU(),
            nn.Dropout(0.2),
            nn.Linear(hidden_dim, hidden_dim),
            nn.ReLU(),
            nn.Dropout(0.2),
            nn.Linear(hidden_dim, n_experts),
            nn.Softmax(dim=1)
        )
    
    def forward(self, x):
        return self.network(x)


class AttentionBasedEnsemble(BaseEstimator):
    """Attention-based ensemble using self-attention mechanism"""
    
    def __init__(self, models: List[BaseEstimator], attention_dim: int = 32):
        self.models = models
        self.attention_dim = attention_dim
        self.attention_network = None
        self.fitted = False
        
    def fit(self, X, y):
        """Fit models and attention mechanism"""
        # Fit all base models
        for model in self.models:
            model.fit(X, y)
        
        # Create attention network
        n_models = len(self.models)
        self.attention_network = self._build_attention_network(X.shape[1], n_models)
        
        # Train attention network
        self._train_attention(X, y)
        self.fitted = True
        
        return self
    
    def _build_attention_network(self, input_dim: int, n_models: int):
        """Build attention network architecture"""
        class AttentionNet(nn.Module):
            def __init__(self, input_dim, n_models, attention_dim):
                super().__init__()
                self.query = nn.Linear(input_dim, attention_dim)
                self.key = nn.Linear(n_models, attention_dim)
                self.value = nn.Linear(n_models, n_models)
                self.scale = np.sqrt(attention_dim)
                
            def forward(self, x, model_outputs):
                # x: [batch, input_dim]
                # model_outputs: [batch, n_models]
                
                Q = self.query(x)  # [batch, attention_dim]
                K = self.key(model_outputs)  # [batch, attention_dim]
                V = self.value(model_outputs)  # [batch, n_models]
                
                # Compute attention scores
                scores = torch.matmul(Q.unsqueeze(1), K.unsqueeze(2)).squeeze() / self.scale
                attention_weights = torch.softmax(scores, dim=-1)
                
                # Apply attention to values
                weighted_outputs = attention_weights * V
                
                return weighted_outputs, attention_weights
        
        return AttentionNet(input_dim, n_models, self.attention_dim)
    
    def _train_attention(self, X, y, epochs=100):
        """Train the attention network"""
        # Get base model predictions
        model_outputs = np.column_stack([
            model.predict(X) for model in self.models
        ])
        
        # Convert to tensors
        X_tensor = torch.FloatTensor(X)
        y_tensor = torch.FloatTensor(y)
        outputs_tensor = torch.FloatTensor(model_outputs)
        
        # Training setup
        optimizer = optim.Adam(self.attention_network.parameters(), lr=0.001)
        criterion = nn.MSELoss()
        
        for epoch in range(epochs):
            optimizer.zero_grad()
            
            # Forward pass
            weighted_outputs, _ = self.attention_network(X_tensor, outputs_tensor)
            ensemble_pred = weighted_outputs.sum(dim=1)
            
            # Compute loss
            loss = criterion(ensemble_pred, y_tensor)
            
            # Backward pass
            loss.backward()
            optimizer.step()
    
    def predict(self, X):
        """Make predictions using attention-weighted ensemble"""
        # Get base model predictions
        model_outputs = np.column_stack([
            model.predict(X) for model in self.models
        ])
        
        # Convert to tensors
        X_tensor = torch.FloatTensor(X)
        outputs_tensor = torch.FloatTensor(model_outputs)
        
        # Get attention-weighted predictions
        with torch.no_grad():
            weighted_outputs, attention_weights = self.attention_network(X_tensor, outputs_tensor)
            ensemble_pred = weighted_outputs.sum(dim=1)
        
        return ensemble_pred.numpy()


class HierarchicalEnsemble(BaseEstimator):
    """Hierarchical ensemble with multiple levels of model combination"""
    
    def __init__(self, base_models: List[BaseEstimator], n_levels: int = 2):
        self.base_models = base_models
        self.n_levels = n_levels
        self.level_ensembles = []
        
    def fit(self, X, y):
        """Fit hierarchical ensemble"""
        current_models = self.base_models
        
        for level in range(self.n_levels):
            if len(current_models) <= 2:
                break
            
            # Create ensembles at this level
            level_ensemble = []
            
            # Group models in pairs
            for i in range(0, len(current_models), 2):
                if i + 1 < len(current_models):
                    # Create mini-ensemble of two models
                    from .ensemble_agent_implementation import DynamicWeightingEnsemble
                    mini_ensemble = DynamicWeightingEnsemble(
                        [current_models[i], current_models[i+1]]
                    )
                    mini_ensemble.fit(X, y)
                    level_ensemble.append(mini_ensemble)
                else:
                    # Odd model out - keep as is
                    level_ensemble.append(current_models[i])
            
            self.level_ensembles.append(level_ensemble)
            current_models = level_ensemble
        
        # Final ensemble
        if len(current_models) > 1:
            from .ensemble_agent_implementation import StackingEnsemble
            self.final_ensemble = StackingEnsemble(current_models)
            self.final_ensemble.fit(X, y)
        else:
            self.final_ensemble = current_models[0]
        
        return self
    
    def predict(self, X):
        """Make predictions through hierarchy"""
        return self.final_ensemble.predict(X)


class AdaptiveEnsembleSelector:
    """Dynamically selects best ensemble strategy based on data characteristics"""
    
    def __init__(self):
        self.strategy_scores = {}
        self.selected_strategy = None
        self.selected_ensemble = None
        
    def analyze_data_characteristics(self, X, y) -> Dict[str, float]:
        """Analyze dataset characteristics"""
        n_samples, n_features = X.shape
        
        # Basic characteristics
        chars = {
            'n_samples': n_samples,
            'n_features': n_features,
            'sample_feature_ratio': n_samples / n_features,
            'feature_variance': np.var(X, axis=0).mean(),
            'target_variance': np.var(y),
            'feature_correlation': self._compute_feature_correlation(X),
            'class_balance': self._compute_class_balance(y) if len(np.unique(y)) < 20 else 1.0
        }
        
        return chars
    
    def _compute_feature_correlation(self, X):
        """Compute average absolute correlation between features"""
        corr_matrix = np.corrcoef(X.T)
        # Get upper triangle without diagonal
        upper_triangle = np.triu(corr_matrix, k=1)
        return np.abs(upper_triangle).mean()
    
    def _compute_class_balance(self, y):
        """Compute class balance ratio"""
        unique, counts = np.unique(y, return_counts=True)
        return counts.min() / counts.max()
    
    def recommend_strategy(self, X, y, models: List[BaseEstimator]) -> str:
        """Recommend best ensemble strategy based on data"""
        chars = self.analyze_data_characteristics(X, y)
        
        scores = {}
        
        # Stacking is good for diverse models and sufficient data
        scores['stacking'] = (
            min(chars['sample_feature_ratio'] / 10, 1.0) * 0.4 +
            (1 - chars['feature_correlation']) * 0.3 +
            (len(models) / 10) * 0.3
        )
        
        # Dynamic weighting is good for similar models
        scores['dynamic_weighting'] = (
            chars['feature_correlation'] * 0.4 +
            (1 - chars['sample_feature_ratio'] / 50) * 0.3 +
            chars.get('class_balance', 0.5) * 0.3
        )
        
        # Mixture of experts is good for heterogeneous data
        scores['mixture_of_experts'] = (
            (1 - chars.get('class_balance', 0.5)) * 0.4 +
            chars['feature_variance'] * 0.3 +
            min(chars['n_features'] / 50, 1.0) * 0.3
        )
        
        # Bayesian averaging is good for uncertainty quantification
        scores['bayesian_averaging'] = (
            min(chars['n_samples'] / 1000, 1.0) * 0.5 +
            chars['target_variance'] * 0.3 +
            (len(models) / 5) * 0.2
        )
        
        # Normalize scores
        max_score = max(scores.values())
        for key in scores:
            scores[key] /= max_score
        
        self.strategy_scores = scores
        self.selected_strategy = max(scores, key=scores.get)
        
        return self.selected_strategy
    
    def create_adaptive_ensemble(self, X, y, models: List[BaseEstimator]) -> BaseEstimator:
        """Create ensemble with automatically selected strategy"""
        strategy = self.recommend_strategy(X, y, models)
        
        from .ensemble_agent_implementation import EnsembleOptimizer
        optimizer = EnsembleOptimizer()
        
        # Optimize model selection
        X_val = X[:int(0.2 * len(X))]
        y_val = y[:int(0.2 * len(y))]
        
        # Fit models on remaining data
        X_train = X[int(0.2 * len(X)):]
        y_train = y[int(0.2 * len(y)):]
        
        for model in models:
            model.fit(X_train, y_train)
        
        # Select best models
        selected_models = optimizer.optimize_ensemble_composition(
            models, X_val, y_val, max_models=5
        )
        
        # Create ensemble with selected strategy
        task_type = 'classification' if len(np.unique(y)) < 20 else 'regression'
        ensemble = optimizer.create_ensemble(
            selected_models, strategy=strategy, task_type=task_type
        )
        
        # Refit on full data
        for model in selected_models:
            model.fit(X, y)
        
        ensemble.fit(X, y)
        
        self.selected_ensemble = ensemble
        
        return ensemble


class EnsembleMonitor:
    """Monitor and track ensemble performance over time"""
    
    def __init__(self):
        self.performance_history = []
        self.model_contributions = {}
        
    def track_performance(self, ensemble, X_test, y_test, timestamp=None):
        """Track ensemble performance metrics"""
        predictions = ensemble.predict(X_test)
        
        # Calculate metrics
        if len(np.unique(y_test)) < 20:  # Classification
            from sklearn.metrics import accuracy_score, f1_score
            metrics = {
                'accuracy': accuracy_score(y_test, predictions),
                'f1_score': f1_score(y_test, predictions, average='weighted')
            }
        else:  # Regression
            from sklearn.metrics import mean_squared_error, r2_score
            metrics = {
                'mse': mean_squared_error(y_test, predictions),
                'r2': r2_score(y_test, predictions)
            }
        
        # Add metadata
        metrics['timestamp'] = timestamp or str(np.datetime64('now'))
        metrics['n_samples'] = len(y_test)
        
        self.performance_history.append(metrics)
        
        return metrics
    
    def analyze_model_contributions(self, ensemble, X_sample):
        """Analyze individual model contributions in ensemble"""
        if hasattr(ensemble, 'weights'):
            # For weighted ensembles
            contributions = {
                f'model_{i}': weight 
                for i, weight in enumerate(ensemble.weights)
            }
        elif hasattr(ensemble, 'posterior_weights'):
            # For Bayesian averaging
            contributions = {
                f'model_{i}': weight 
                for i, weight in enumerate(ensemble.posterior_weights)
            }
        else:
            # Equal contribution assumption
            n_models = len(ensemble.models) if hasattr(ensemble, 'models') else 1
            contributions = {f'model_{i}': 1/n_models for i in range(n_models)}
        
        self.model_contributions = contributions
        return contributions
    
    def generate_report(self) -> Dict[str, Any]:
        """Generate comprehensive ensemble performance report"""
        report = {
            'performance_summary': {
                'n_evaluations': len(self.performance_history),
                'latest_performance': self.performance_history[-1] if self.performance_history else None,
                'performance_trend': self._calculate_trend()
            },
            'model_contributions': self.model_contributions,
            'recommendations': self._generate_recommendations()
        }
        
        return report
    
    def _calculate_trend(self):
        """Calculate performance trend"""
        if len(self.performance_history) < 2:
            return 'insufficient_data'
        
        # Get primary metric
        if 'accuracy' in self.performance_history[0]:
            metric_key = 'accuracy'
        elif 'r2' in self.performance_history[0]:
            metric_key = 'r2'
        else:
            return 'unknown'
        
        values = [h[metric_key] for h in self.performance_history]
        trend = np.polyfit(range(len(values)), values, 1)[0]
        
        if trend > 0.01:
            return 'improving'
        elif trend < -0.01:
            return 'degrading'
        else:
            return 'stable'
    
    def _generate_recommendations(self):
        """Generate recommendations based on performance"""
        recommendations = []
        
        if self.performance_history:
            latest = self.performance_history[-1]
            
            if 'accuracy' in latest and latest['accuracy'] < 0.8:
                recommendations.append("Consider adding more diverse models to the ensemble")
            elif 'r2' in latest and latest['r2'] < 0.7:
                recommendations.append("Consider feature engineering or different model architectures")
        
        if self.model_contributions:
            max_contrib = max(self.model_contributions.values())
            if max_contrib > 0.7:
                recommendations.append("Single model dominates - consider removing weak models")
        
        return recommendations


# Save ensemble configuration for coordination
def save_ensemble_config(ensemble_type: str, config: Dict[str, Any], filepath: str):
    """Save ensemble configuration for other agents"""
    config_data = {
        'ensemble_type': ensemble_type,
        'configuration': config,
        'timestamp': str(np.datetime64('now')),
        'agent': 'ensemble_agent'
    }
    
    with open(filepath, 'w') as f:
        json.dump(config_data, f, indent=2)


if __name__ == "__main__":
    # Example usage of advanced ensembles
    from sklearn.datasets import make_classification
    from sklearn.ensemble import RandomForestClassifier
    from sklearn.svm import SVC
    
    X, y = make_classification(n_samples=1000, n_features=20, n_informative=15,
                              n_redundant=5, random_state=42)
    
    # Base models
    models = [
        RandomForestClassifier(n_estimators=50, random_state=42),
        SVC(probability=True, random_state=42),
        RandomForestClassifier(n_estimators=100, max_depth=5, random_state=43)
    ]
    
    # Test adaptive ensemble selection
    selector = AdaptiveEnsembleSelector()
    ensemble = selector.create_adaptive_ensemble(X, y, models)
    
    print(f"Selected strategy: {selector.selected_strategy}")
    print(f"Strategy scores: {selector.strategy_scores}")
    
    # Monitor performance
    from sklearn.model_selection import train_test_split
    X_train, X_test, y_train, y_test = train_test_split(X, y, test_size=0.2, random_state=42)
    
    monitor = EnsembleMonitor()
    metrics = monitor.track_performance(ensemble, X_test, y_test)
    
    print(f"\nPerformance metrics: {metrics}")
    print(f"Model contributions: {monitor.analyze_model_contributions(ensemble, X_test[:10])}")
    
    # Save configuration
    save_ensemble_config(
        selector.selected_strategy,
        {'n_models': len(models), 'scores': selector.strategy_scores},
        '/tmp/ensemble_config.json'
    )