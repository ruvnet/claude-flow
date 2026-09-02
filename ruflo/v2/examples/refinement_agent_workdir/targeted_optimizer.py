#!/usr/bin/env python3
"""
MLE-STAR Targeted Component Optimizer
Deep optimization for high-impact pipeline components
"""

import numpy as np
import pandas as pd
from sklearn.model_selection import GridSearchCV, RandomizedSearchCV
from sklearn.base import BaseEstimator
from skopt import BayesSearchCV
from skopt.space import Real, Integer, Categorical
import optuna
from typing import Dict, List, Any, Tuple, Optional, Callable
import json
import time
import logging
from datetime import datetime
from dataclasses import dataclass, asdict
import warnings
warnings.filterwarnings('ignore')

# Configure logging
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(name)s - %(levelname)s - %(message)s')
logger = logging.getLogger('targeted_optimizer')


@dataclass
class OptimizationResult:
    """Results from optimization run"""
    component_name: str
    optimization_method: str
    best_params: Dict[str, Any]
    best_score: float
    improvement_from_baseline: float
    optimization_time: float
    n_iterations: int
    search_history: List[Dict[str, Any]]
    timestamp: str


class TargetedOptimizer:
    """
    Deep optimization for high-impact ML pipeline components
    Implements multiple optimization strategies:
    - Grid Search for discrete spaces
    - Bayesian Optimization for continuous spaces
    - Optuna for complex mixed spaces
    """
    
    def __init__(self, baseline_score: float, 
                 evaluation_metric: str = 'accuracy',
                 cv_folds: int = 5,
                 random_state: int = 42):
        """
        Initialize targeted optimizer
        
        Args:
            baseline_score: Baseline performance to improve upon
            evaluation_metric: Metric to optimize
            cv_folds: Number of cross-validation folds
            random_state: Random seed
        """
        self.baseline_score = baseline_score
        self.evaluation_metric = evaluation_metric
        self.cv_folds = cv_folds
        self.random_state = random_state
        self.optimization_history = []
        
    def optimize_hyperparameters_grid(self, 
                                    estimator: BaseEstimator,
                                    param_grid: Dict[str, List[Any]],
                                    X: np.ndarray, 
                                    y: np.ndarray,
                                    component_name: str) -> OptimizationResult:
        """
        Grid search optimization for hyperparameters
        Best for small discrete parameter spaces
        """
        logger.info(f"Starting Grid Search optimization for {component_name}")
        start_time = time.time()
        
        # Configure scoring
        scoring = self._get_sklearn_scoring()
        
        # Create grid search
        grid_search = GridSearchCV(
            estimator=estimator,
            param_grid=param_grid,
            cv=self.cv_folds,
            scoring=scoring,
            n_jobs=-1,
            verbose=1,
            return_train_score=True
        )
        
        # Fit grid search
        grid_search.fit(X, y)
        
        # Calculate improvement
        improvement = self._calculate_improvement(grid_search.best_score_)
        
        # Extract search history
        search_history = []
        for i, params in enumerate(grid_search.cv_results_['params']):
            search_history.append({
                'iteration': i,
                'params': params,
                'mean_score': grid_search.cv_results_['mean_test_score'][i],
                'std_score': grid_search.cv_results_['std_test_score'][i]
            })
        
        result = OptimizationResult(
            component_name=component_name,
            optimization_method='grid_search',
            best_params=grid_search.best_params_,
            best_score=grid_search.best_score_,
            improvement_from_baseline=improvement,
            optimization_time=time.time() - start_time,
            n_iterations=len(grid_search.cv_results_['params']),
            search_history=search_history,
            timestamp=datetime.now().isoformat()
        )
        
        self.optimization_history.append(result)
        logger.info(f"Grid Search complete. Best score: {grid_search.best_score_:.4f} "
                   f"(+{improvement:.2%} improvement)")
        
        return result
    
    def optimize_hyperparameters_bayesian(self,
                                        estimator: BaseEstimator,
                                        search_spaces: Dict[str, Any],
                                        X: np.ndarray,
                                        y: np.ndarray,
                                        component_name: str,
                                        n_iter: int = 50) -> OptimizationResult:
        """
        Bayesian optimization for hyperparameters
        Best for continuous and mixed parameter spaces
        """
        logger.info(f"Starting Bayesian optimization for {component_name}")
        start_time = time.time()
        
        # Configure scoring
        scoring = self._get_sklearn_scoring()
        
        # Create Bayesian search
        bayes_search = BayesSearchCV(
            estimator=estimator,
            search_spaces=search_spaces,
            n_iter=n_iter,
            cv=self.cv_folds,
            scoring=scoring,
            n_jobs=-1,
            random_state=self.random_state,
            verbose=1
        )
        
        # Fit Bayesian search
        bayes_search.fit(X, y)
        
        # Calculate improvement
        improvement = self._calculate_improvement(bayes_search.best_score_)
        
        # Extract search history
        search_history = []
        for i in range(len(bayes_search.cv_results_['params'])):
            search_history.append({
                'iteration': i,
                'params': bayes_search.cv_results_['params'][i],
                'mean_score': bayes_search.cv_results_['mean_test_score'][i],
                'std_score': bayes_search.cv_results_['std_test_score'][i]
            })
        
        result = OptimizationResult(
            component_name=component_name,
            optimization_method='bayesian_optimization',
            best_params=bayes_search.best_params_,
            best_score=bayes_search.best_score_,
            improvement_from_baseline=improvement,
            optimization_time=time.time() - start_time,
            n_iterations=n_iter,
            search_history=search_history,
            timestamp=datetime.now().isoformat()
        )
        
        self.optimization_history.append(result)
        logger.info(f"Bayesian optimization complete. Best score: {bayes_search.best_score_:.4f} "
                   f"(+{improvement:.2%} improvement)")
        
        return result
    
    def optimize_with_optuna(self,
                           objective_func: Callable,
                           component_name: str,
                           n_trials: int = 100,
                           direction: str = 'maximize') -> OptimizationResult:
        """
        Optuna optimization for complex search spaces
        Supports pruning and advanced sampling strategies
        """
        logger.info(f"Starting Optuna optimization for {component_name}")
        start_time = time.time()
        
        # Create Optuna study
        study = optuna.create_study(
            direction=direction,
            sampler=optuna.samplers.TPESampler(seed=self.random_state),
            pruner=optuna.pruners.MedianPruner()
        )
        
        # Optimize
        study.optimize(objective_func, n_trials=n_trials, show_progress_bar=True)
        
        # Get best trial
        best_trial = study.best_trial
        best_score = best_trial.value
        
        # Calculate improvement
        improvement = self._calculate_improvement(best_score)
        
        # Extract search history
        search_history = []
        for trial in study.trials:
            if trial.state == optuna.trial.TrialState.COMPLETE:
                search_history.append({
                    'iteration': trial.number,
                    'params': trial.params,
                    'score': trial.value,
                    'duration': trial.duration.total_seconds() if trial.duration else 0
                })
        
        result = OptimizationResult(
            component_name=component_name,
            optimization_method='optuna',
            best_params=best_trial.params,
            best_score=best_score,
            improvement_from_baseline=improvement,
            optimization_time=time.time() - start_time,
            n_iterations=len(study.trials),
            search_history=search_history,
            timestamp=datetime.now().isoformat()
        )
        
        self.optimization_history.append(result)
        logger.info(f"Optuna optimization complete. Best score: {best_score:.4f} "
                   f"(+{improvement:.2%} improvement)")
        
        return result
    
    def optimize_feature_engineering(self,
                                   X: np.ndarray,
                                   y: np.ndarray,
                                   base_model: BaseEstimator) -> OptimizationResult:
        """
        Optimize feature engineering strategies
        Tests various feature transformations and selections
        """
        logger.info("Optimizing feature engineering strategies")
        
        def objective(trial):
            # Feature engineering parameters
            use_polynomial = trial.suggest_categorical('use_polynomial', [True, False])
            poly_degree = trial.suggest_int('poly_degree', 2, 3) if use_polynomial else 2
            use_interactions = trial.suggest_categorical('use_interactions', [True, False])
            use_log_transform = trial.suggest_categorical('use_log_transform', [True, False])
            feature_selection_k = trial.suggest_int('feature_selection_k', 
                                                  int(X.shape[1] * 0.5), 
                                                  X.shape[1])
            
            # Apply transformations
            X_transformed = X.copy()
            
            if use_polynomial:
                from sklearn.preprocessing import PolynomialFeatures
                poly = PolynomialFeatures(degree=poly_degree, include_bias=False)
                X_transformed = poly.fit_transform(X_transformed)
            
            if use_interactions and X.shape[1] > 1:
                # Add interaction features
                n_features = X_transformed.shape[1]
                interactions = []
                for i in range(min(n_features, 10)):  # Limit interactions
                    for j in range(i + 1, min(n_features, 10)):
                        interactions.append(X_transformed[:, i] * X_transformed[:, j])
                if interactions:
                    X_transformed = np.hstack([X_transformed, np.array(interactions).T])
            
            if use_log_transform:
                # Add log features for positive values
                positive_mask = X_transformed > 0
                log_features = np.zeros_like(X_transformed)
                log_features[positive_mask] = np.log1p(X_transformed[positive_mask])
                X_transformed = np.hstack([X_transformed, log_features])
            
            # Feature selection
            from sklearn.feature_selection import SelectKBest, f_classif, f_regression
            selector = SelectKBest(
                score_func=f_classif if self.evaluation_metric == 'accuracy' else f_regression,
                k=min(feature_selection_k, X_transformed.shape[1])
            )
            X_selected = selector.fit_transform(X_transformed, y)
            
            # Evaluate with cross-validation
            from sklearn.model_selection import cross_val_score
            scores = cross_val_score(
                base_model, X_selected, y, 
                cv=self.cv_folds, 
                scoring=self._get_sklearn_scoring()
            )
            
            return scores.mean()
        
        # Run optimization
        return self.optimize_with_optuna(
            objective_func=objective,
            component_name='feature_engineering',
            n_trials=50
        )
    
    def iterative_refinement(self,
                           components: Dict[str, Dict[str, Any]],
                           X: np.ndarray,
                           y: np.ndarray,
                           max_iterations: int = 5) -> Dict[str, Any]:
        """
        Iteratively refine multiple components
        Each iteration uses the best configuration from previous iteration
        """
        logger.info(f"Starting iterative refinement for {max_iterations} iterations")
        
        refinement_history = []
        current_best_score = self.baseline_score
        
        for iteration in range(max_iterations):
            logger.info(f"\n--- Iteration {iteration + 1}/{max_iterations} ---")
            iteration_results = {}
            
            for component_name, component_config in components.items():
                method = component_config.get('method', 'grid')
                
                if method == 'grid':
                    result = self.optimize_hyperparameters_grid(
                        estimator=component_config['estimator'],
                        param_grid=component_config['param_grid'],
                        X=X, y=y,
                        component_name=f"{component_name}_iter{iteration}"
                    )
                elif method == 'bayesian':
                    result = self.optimize_hyperparameters_bayesian(
                        estimator=component_config['estimator'],
                        search_spaces=component_config['search_spaces'],
                        X=X, y=y,
                        component_name=f"{component_name}_iter{iteration}",
                        n_iter=component_config.get('n_iter', 50)
                    )
                
                iteration_results[component_name] = result
                
                # Update estimator with best params for next iteration
                if result.best_score > current_best_score:
                    component_config['estimator'].set_params(**result.best_params)
                    current_best_score = result.best_score
            
            refinement_history.append({
                'iteration': iteration + 1,
                'results': iteration_results,
                'best_score': current_best_score,
                'improvement': self._calculate_improvement(current_best_score)
            })
            
            # Early stopping if no improvement
            if iteration > 0:
                prev_score = refinement_history[-2]['best_score']
                if current_best_score - prev_score < 0.001:
                    logger.info("Early stopping: No significant improvement")
                    break
        
        # Compile final results
        final_results = {
            'total_iterations': len(refinement_history),
            'final_best_score': current_best_score,
            'total_improvement': self._calculate_improvement(current_best_score),
            'refinement_history': refinement_history,
            'best_configurations': self._extract_best_configs(),
            'timestamp': datetime.now().isoformat()
        }
        
        return final_results
    
    def _get_sklearn_scoring(self) -> str:
        """Convert metric name to sklearn scoring parameter"""
        scoring_map = {
            'accuracy': 'accuracy',
            'mse': 'neg_mean_squared_error',
            'r2': 'r2',
            'f1': 'f1_weighted',
            'roc_auc': 'roc_auc'
        }
        return scoring_map.get(self.evaluation_metric, 'accuracy')
    
    def _calculate_improvement(self, score: float) -> float:
        """Calculate relative improvement from baseline"""
        if self.evaluation_metric in ['accuracy', 'r2', 'f1', 'roc_auc']:
            # Higher is better
            return (score - self.baseline_score) / self.baseline_score
        else:
            # Lower is better (MSE, MAE)
            return (self.baseline_score - score) / self.baseline_score
    
    def _extract_best_configs(self) -> Dict[str, Any]:
        """Extract best configuration for each component"""
        best_configs = {}
        
        for result in self.optimization_history:
            component_base = result.component_name.split('_iter')[0]
            if component_base not in best_configs or \
               result.best_score > best_configs[component_base]['score']:
                best_configs[component_base] = {
                    'params': result.best_params,
                    'score': result.best_score,
                    'method': result.optimization_method
                }
        
        return best_configs
    
    def export_results(self, filepath: str):
        """Export optimization results to JSON"""
        export_data = {
            'baseline_score': self.baseline_score,
            'evaluation_metric': self.evaluation_metric,
            'optimization_history': [asdict(r) for r in self.optimization_history],
            'best_configurations': self._extract_best_configs(),
            'summary': {
                'total_optimizations': len(self.optimization_history),
                'best_achieved_score': max(r.best_score for r in self.optimization_history),
                'total_improvement': self._calculate_improvement(
                    max(r.best_score for r in self.optimization_history)
                ),
                'timestamp': datetime.now().isoformat()
            }
        }
        
        with open(filepath, 'w') as f:
            json.dump(export_data, f, indent=2)
        
        logger.info(f"Optimization results exported to {filepath}")


class AdaptiveOptimizer:
    """
    Adaptive optimization strategy that switches between methods
    based on search space characteristics
    """
    
    def __init__(self, targeted_optimizer: TargetedOptimizer):
        self.optimizer = targeted_optimizer
        
    def optimize_adaptive(self,
                         component_name: str,
                         search_space: Dict[str, Any],
                         estimator: BaseEstimator,
                         X: np.ndarray,
                         y: np.ndarray) -> OptimizationResult:
        """
        Automatically choose optimization method based on search space
        """
        # Analyze search space
        n_params = len(search_space)
        n_discrete = sum(1 for v in search_space.values() 
                        if isinstance(v, list))
        n_continuous = n_params - n_discrete
        
        # Calculate total search space size
        total_combinations = 1
        for param, values in search_space.items():
            if isinstance(values, list):
                total_combinations *= len(values)
            else:
                total_combinations *= 100  # Approximate for continuous
        
        # Choose method
        if total_combinations < 100 and n_continuous == 0:
            # Small discrete space - use grid search
            logger.info(f"Using Grid Search for {component_name} "
                       f"(small discrete space: {total_combinations} combinations)")
            return self.optimizer.optimize_hyperparameters_grid(
                estimator, search_space, X, y, component_name
            )
        elif n_continuous > 0 or total_combinations > 1000:
            # Large or mixed space - use Bayesian optimization
            logger.info(f"Using Bayesian optimization for {component_name} "
                       f"(large/mixed space: {n_continuous} continuous params)")
            
            # Convert to skopt format
            from skopt.space import Real, Integer, Categorical
            skopt_space = {}
            for param, values in search_space.items():
                if isinstance(values, list):
                    skopt_space[param] = Categorical(values)
                elif isinstance(values, tuple) and len(values) == 2:
                    if all(isinstance(v, int) for v in values):
                        skopt_space[param] = Integer(values[0], values[1])
                    else:
                        skopt_space[param] = Real(values[0], values[1])
            
            return self.optimizer.optimize_hyperparameters_bayesian(
                estimator, skopt_space, X, y, component_name, n_iter=50
            )
        else:
            # Medium discrete space - use randomized search
            logger.info(f"Using Randomized Search for {component_name} "
                       f"(medium space: {total_combinations} combinations)")
            from sklearn.model_selection import RandomizedSearchCV
            
            random_search = RandomizedSearchCV(
                estimator=estimator,
                param_distributions=search_space,
                n_iter=min(50, total_combinations // 2),
                cv=self.optimizer.cv_folds,
                scoring=self.optimizer._get_sklearn_scoring(),
                n_jobs=-1,
                random_state=self.optimizer.random_state
            )
            
            start_time = time.time()
            random_search.fit(X, y)
            
            # Format as OptimizationResult
            result = OptimizationResult(
                component_name=component_name,
                optimization_method='random_search',
                best_params=random_search.best_params_,
                best_score=random_search.best_score_,
                improvement_from_baseline=self.optimizer._calculate_improvement(
                    random_search.best_score_
                ),
                optimization_time=time.time() - start_time,
                n_iterations=random_search.n_iter_,
                search_history=[],
                timestamp=datetime.now().isoformat()
            )
            
            self.optimizer.optimization_history.append(result)
            return result


if __name__ == "__main__":
    logger.info("MLE-STAR Targeted Optimizer initialized")
    logger.info("Ready for deep component optimization")