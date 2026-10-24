#!/usr/bin/env python3
"""
MLE-STAR Ablation Analysis Framework
Refinement Agent Component Impact Analysis
"""

import numpy as np
import pandas as pd
from sklearn.base import BaseEstimator, TransformerMixin
from sklearn.model_selection import cross_val_score, KFold
from sklearn.metrics import accuracy_score, mean_squared_error, r2_score
import json
import time
from typing import Dict, List, Any, Tuple, Optional
import logging
from dataclasses import dataclass, asdict
from datetime import datetime

# Configure logging
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(name)s - %(levelname)s - %(message)s')
logger = logging.getLogger('ablation_framework')


@dataclass
class ComponentResult:
    """Results from testing a single component configuration"""
    component_name: str
    configuration: Dict[str, Any]
    performance_metrics: Dict[str, float]
    impact_score: float
    computational_time: float
    timestamp: str


class AblationAnalyzer:
    """
    Systematic ablation analysis for ML pipeline components
    Identifies which components have the highest impact on performance
    """
    
    def __init__(self, baseline_pipeline: Dict[str, Any], 
                 evaluation_metric: str = 'accuracy',
                 cv_folds: int = 5,
                 random_state: int = 42):
        """
        Initialize ablation analyzer
        
        Args:
            baseline_pipeline: Dictionary containing pipeline components
            evaluation_metric: Metric to optimize ('accuracy', 'mse', 'r2')
            cv_folds: Number of cross-validation folds
            random_state: Random seed for reproducibility
        """
        self.baseline_pipeline = baseline_pipeline
        self.evaluation_metric = evaluation_metric
        self.cv_folds = cv_folds
        self.random_state = random_state
        self.results = []
        self.baseline_performance = None
        
    def evaluate_pipeline(self, pipeline: Dict[str, Any], 
                         X: np.ndarray, y: np.ndarray) -> Tuple[Dict[str, float], float]:
        """
        Evaluate a pipeline configuration
        
        Returns:
            Tuple of (metrics_dict, computation_time)
        """
        start_time = time.time()
        
        # Create cross-validation splitter
        cv = KFold(n_splits=self.cv_folds, shuffle=True, random_state=self.random_state)
        
        # Get the model from pipeline
        model = pipeline.get('model')
        preprocessor = pipeline.get('preprocessor')
        feature_engineer = pipeline.get('feature_engineer')
        
        # Apply preprocessing if available
        X_processed = X.copy()
        if preprocessor:
            X_processed = preprocessor.fit_transform(X_processed)
            
        # Apply feature engineering if available
        if feature_engineer:
            X_processed = feature_engineer.fit_transform(X_processed)
        
        # Evaluate model
        if self.evaluation_metric == 'accuracy':
            scores = cross_val_score(model, X_processed, y, cv=cv, scoring='accuracy')
            metric_value = scores.mean()
            metric_std = scores.std()
        elif self.evaluation_metric == 'mse':
            scores = cross_val_score(model, X_processed, y, cv=cv, 
                                   scoring='neg_mean_squared_error')
            metric_value = -scores.mean()  # Convert back to positive
            metric_std = scores.std()
        elif self.evaluation_metric == 'r2':
            scores = cross_val_score(model, X_processed, y, cv=cv, scoring='r2')
            metric_value = scores.mean()
            metric_std = scores.std()
        
        computation_time = time.time() - start_time
        
        metrics = {
            f'{self.evaluation_metric}_mean': metric_value,
            f'{self.evaluation_metric}_std': metric_std,
            'cv_scores': scores.tolist()
        }
        
        return metrics, computation_time
    
    def ablate_component(self, component_name: str, 
                        ablation_configs: List[Dict[str, Any]],
                        X: np.ndarray, y: np.ndarray) -> List[ComponentResult]:
        """
        Test different configurations for a single component
        
        Args:
            component_name: Name of component to ablate
            ablation_configs: List of configurations to test
            X: Feature matrix
            y: Target vector
            
        Returns:
            List of ComponentResult objects
        """
        component_results = []
        
        logger.info(f"Starting ablation analysis for component: {component_name}")
        
        for config in ablation_configs:
            # Create modified pipeline
            modified_pipeline = self.baseline_pipeline.copy()
            
            # Apply configuration
            if config is None:
                # Remove component entirely
                modified_pipeline[component_name] = None
                config_desc = "removed"
            else:
                # Update component configuration
                modified_pipeline[component_name] = config
                config_desc = str(config)
            
            # Evaluate modified pipeline
            try:
                metrics, comp_time = self.evaluate_pipeline(modified_pipeline, X, y)
                
                # Calculate impact score
                if self.baseline_performance is None:
                    impact_score = 0.0
                else:
                    baseline_value = self.baseline_performance[f'{self.evaluation_metric}_mean']
                    current_value = metrics[f'{self.evaluation_metric}_mean']
                    
                    # Calculate relative impact
                    if self.evaluation_metric in ['accuracy', 'r2']:
                        # Higher is better
                        impact_score = (current_value - baseline_value) / baseline_value
                    else:
                        # Lower is better (MSE)
                        impact_score = (baseline_value - current_value) / baseline_value
                
                result = ComponentResult(
                    component_name=component_name,
                    configuration={'config': config_desc},
                    performance_metrics=metrics,
                    impact_score=impact_score,
                    computational_time=comp_time,
                    timestamp=datetime.now().isoformat()
                )
                
                component_results.append(result)
                self.results.append(result)
                
                logger.info(f"  Config: {config_desc} | Impact: {impact_score:.4f} | "
                          f"Performance: {metrics[f'{self.evaluation_metric}_mean']:.4f}")
                
            except Exception as e:
                logger.error(f"Error evaluating config {config_desc}: {str(e)}")
                
        return component_results
    
    def run_full_ablation(self, components_to_test: Dict[str, List[Dict[str, Any]]],
                         X: np.ndarray, y: np.ndarray) -> Dict[str, Any]:
        """
        Run ablation analysis on all specified components
        
        Args:
            components_to_test: Dict mapping component names to configurations
            X: Feature matrix
            y: Target vector
            
        Returns:
            Analysis results dictionary
        """
        logger.info("Starting full ablation analysis")
        
        # First, establish baseline performance
        logger.info("Establishing baseline performance...")
        self.baseline_performance, baseline_time = self.evaluate_pipeline(
            self.baseline_pipeline, X, y
        )
        logger.info(f"Baseline {self.evaluation_metric}: "
                   f"{self.baseline_performance[f'{self.evaluation_metric}_mean']:.4f}")
        
        # Test each component
        component_impacts = {}
        for component_name, configs in components_to_test.items():
            results = self.ablate_component(component_name, configs, X, y)
            
            # Calculate average impact for this component
            if results:
                avg_impact = np.mean([r.impact_score for r in results])
                max_impact = max([r.impact_score for r in results])
                component_impacts[component_name] = {
                    'average_impact': avg_impact,
                    'max_impact': max_impact,
                    'num_configs_tested': len(results)
                }
        
        # Rank components by impact
        ranked_components = sorted(
            component_impacts.items(),
            key=lambda x: abs(x[1]['max_impact']),
            reverse=True
        )
        
        # Prepare analysis summary
        analysis_summary = {
            'baseline_performance': self.baseline_performance,
            'components_tested': list(components_to_test.keys()),
            'total_configurations': len(self.results),
            'component_impacts': component_impacts,
            'component_rankings': [
                {
                    'rank': i + 1,
                    'component': comp[0],
                    'max_impact': comp[1]['max_impact'],
                    'average_impact': comp[1]['average_impact']
                }
                for i, comp in enumerate(ranked_components)
            ],
            'highest_impact_component': ranked_components[0][0] if ranked_components else None,
            'improvement_opportunities': self._identify_improvements(),
            'timestamp': datetime.now().isoformat()
        }
        
        return analysis_summary
    
    def _identify_improvements(self) -> List[Dict[str, Any]]:
        """Identify specific improvement opportunities from results"""
        improvements = []
        
        # Find configurations that improved performance
        for result in self.results:
            if result.impact_score > 0.01:  # At least 1% improvement
                improvements.append({
                    'component': result.component_name,
                    'configuration': result.configuration,
                    'impact': result.impact_score,
                    'performance': result.performance_metrics[f'{self.evaluation_metric}_mean']
                })
        
        # Sort by impact
        improvements.sort(key=lambda x: x['impact'], reverse=True)
        
        return improvements[:10]  # Top 10 improvements
    
    def export_results(self, filepath: str):
        """Export ablation analysis results to JSON file"""
        export_data = {
            'baseline_performance': self.baseline_performance,
            'results': [asdict(r) for r in self.results],
            'summary': {
                'total_tests': len(self.results),
                'evaluation_metric': self.evaluation_metric,
                'cv_folds': self.cv_folds,
                'timestamp': datetime.now().isoformat()
            }
        }
        
        with open(filepath, 'w') as f:
            json.dump(export_data, f, indent=2)
        
        logger.info(f"Results exported to {filepath}")


class FeatureEngineer(BaseEstimator, TransformerMixin):
    """Custom feature engineering transformer for ablation testing"""
    
    def __init__(self, polynomial_features: bool = False,
                 interaction_features: bool = False,
                 log_transform: bool = False):
        self.polynomial_features = polynomial_features
        self.interaction_features = interaction_features
        self.log_transform = log_transform
        
    def fit(self, X, y=None):
        return self
        
    def transform(self, X):
        X_transformed = X.copy()
        
        if self.polynomial_features:
            # Add polynomial features (squared terms)
            poly_features = X_transformed ** 2
            X_transformed = np.hstack([X_transformed, poly_features])
            
        if self.interaction_features and X.shape[1] > 1:
            # Add interaction features (pairwise products)
            interactions = []
            for i in range(X.shape[1]):
                for j in range(i + 1, X.shape[1]):
                    interactions.append(X[:, i] * X[:, j])
            if interactions:
                X_transformed = np.hstack([X_transformed, np.array(interactions).T])
                
        if self.log_transform:
            # Add log-transformed features (for positive values)
            positive_mask = X > 0
            log_features = np.zeros_like(X)
            log_features[positive_mask] = np.log(X[positive_mask])
            X_transformed = np.hstack([X_transformed, log_features])
            
        return X_transformed


if __name__ == "__main__":
    # Example usage
    logger.info("MLE-STAR Ablation Framework initialized")
    logger.info("Ready for component impact analysis")