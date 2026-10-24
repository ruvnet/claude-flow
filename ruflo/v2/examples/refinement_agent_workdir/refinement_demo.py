#!/usr/bin/env python3
"""
MLE-STAR Refinement Agent Demonstration
Shows how to use ablation analysis and targeted optimization
"""

import numpy as np
import pandas as pd
from sklearn.datasets import make_classification, load_iris
from sklearn.model_selection import train_test_split
from sklearn.preprocessing import StandardScaler, MinMaxScaler, RobustScaler
from sklearn.ensemble import RandomForestClassifier, GradientBoostingClassifier
from sklearn.linear_model import LogisticRegression
from sklearn.svm import SVC
import json
import subprocess
import os
from datetime import datetime

# Import our custom components
from ablation_framework import AblationAnalyzer, FeatureEngineer
from targeted_optimizer import TargetedOptimizer, AdaptiveOptimizer

# Configure logging
import logging
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')
logger = logging.getLogger('refinement_demo')


def store_to_memory(key: str, value: dict):
    """Store results to Claude Flow memory"""
    try:
        value_str = json.dumps(value)
        cmd = f'npx claude-flow@alpha memory store "agent/refinement_agent/{key}" \'{value_str}\''
        subprocess.run(cmd, shell=True, capture_output=True)
        logger.info(f"Stored {key} to memory")
    except Exception as e:
        logger.error(f"Failed to store to memory: {e}")


def run_refinement_workflow():
    """
    Complete refinement workflow demonstrating:
    1. Ablation analysis to identify high-impact components
    2. Targeted optimization of those components
    3. Iterative refinement process
    """
    
    logger.info("=== MLE-STAR Refinement Agent Demo ===")
    logger.info("Starting refinement workflow...")
    
    # Step 1: Create synthetic dataset for demonstration
    logger.info("\n--- Step 1: Dataset Preparation ---")
    X, y = make_classification(
        n_samples=1000,
        n_features=20,
        n_informative=15,
        n_redundant=5,
        n_classes=3,
        random_state=42
    )
    
    X_train, X_test, y_train, y_test = train_test_split(
        X, y, test_size=0.2, random_state=42, stratify=y
    )
    
    logger.info(f"Dataset shape: {X_train.shape}")
    logger.info(f"Classes: {np.unique(y_train)}")
    
    # Step 2: Define baseline pipeline
    logger.info("\n--- Step 2: Baseline Pipeline Setup ---")
    baseline_pipeline = {
        'preprocessor': StandardScaler(),
        'feature_engineer': FeatureEngineer(
            polynomial_features=False,
            interaction_features=False,
            log_transform=False
        ),
        'model': RandomForestClassifier(n_estimators=100, random_state=42)
    }
    
    # Step 3: Run ablation analysis
    logger.info("\n--- Step 3: Ablation Analysis ---")
    ablation_analyzer = AblationAnalyzer(
        baseline_pipeline=baseline_pipeline,
        evaluation_metric='accuracy',
        cv_folds=5
    )
    
    # Define component variations to test
    components_to_test = {
        'preprocessor': [
            None,  # No preprocessing
            StandardScaler(),
            MinMaxScaler(),
            RobustScaler()
        ],
        'feature_engineer': [
            None,  # No feature engineering
            FeatureEngineer(polynomial_features=True),
            FeatureEngineer(interaction_features=True),
            FeatureEngineer(log_transform=True),
            FeatureEngineer(polynomial_features=True, interaction_features=True)
        ],
        'model': [
            LogisticRegression(random_state=42),
            RandomForestClassifier(n_estimators=50, random_state=42),
            RandomForestClassifier(n_estimators=200, random_state=42),
            GradientBoostingClassifier(n_estimators=100, random_state=42),
            SVC(kernel='rbf', random_state=42)
        ]
    }
    
    # Run ablation analysis
    ablation_results = ablation_analyzer.run_full_ablation(
        components_to_test=components_to_test,
        X=X_train,
        y=y_train
    )
    
    # Save ablation results
    ablation_analyzer.export_results('ablation_results.json')
    store_to_memory('ablation_results', ablation_results)
    
    logger.info("\n--- Ablation Analysis Results ---")
    logger.info(f"Baseline performance: {ablation_results['baseline_performance']['accuracy_mean']:.4f}")
    logger.info("\nComponent Rankings by Impact:")
    for ranking in ablation_results['component_rankings']:
        logger.info(f"  {ranking['rank']}. {ranking['component']}: "
                   f"max_impact={ranking['max_impact']:.4f}, "
                   f"avg_impact={ranking['average_impact']:.4f}")
    
    # Step 4: Targeted optimization on highest impact component
    logger.info("\n--- Step 4: Targeted Optimization ---")
    highest_impact_component = ablation_results['highest_impact_component']
    logger.info(f"Focusing optimization on: {highest_impact_component}")
    
    # Initialize targeted optimizer
    targeted_optimizer = TargetedOptimizer(
        baseline_score=ablation_results['baseline_performance']['accuracy_mean'],
        evaluation_metric='accuracy',
        cv_folds=5
    )
    
    # Define optimization configurations based on highest impact component
    if highest_impact_component == 'model':
        # Optimize model hyperparameters
        logger.info("Optimizing model hyperparameters...")
        
        # Random Forest optimization
        rf_params = {
            'n_estimators': [100, 200, 300],
            'max_depth': [10, 20, 30, None],
            'min_samples_split': [2, 5, 10],
            'min_samples_leaf': [1, 2, 4],
            'max_features': ['sqrt', 'log2', None]
        }
        
        rf_result = targeted_optimizer.optimize_hyperparameters_grid(
            estimator=RandomForestClassifier(random_state=42),
            param_grid=rf_params,
            X=X_train,
            y=y_train,
            component_name='random_forest_model'
        )
        
        # Gradient Boosting optimization with Bayesian search
        from skopt.space import Real, Integer
        gb_search_spaces = {
            'n_estimators': Integer(50, 300),
            'learning_rate': Real(0.01, 0.3, prior='log-uniform'),
            'max_depth': Integer(3, 10),
            'min_samples_split': Integer(2, 20),
            'subsample': Real(0.6, 1.0)
        }
        
        gb_result = targeted_optimizer.optimize_hyperparameters_bayesian(
            estimator=GradientBoostingClassifier(random_state=42),
            search_spaces=gb_search_spaces,
            X=X_train,
            y=y_train,
            component_name='gradient_boosting_model',
            n_iter=30
        )
        
    elif highest_impact_component == 'feature_engineer':
        # Optimize feature engineering
        logger.info("Optimizing feature engineering strategies...")
        
        fe_result = targeted_optimizer.optimize_feature_engineering(
            X=X_train,
            y=y_train,
            base_model=RandomForestClassifier(n_estimators=100, random_state=42)
        )
        
    # Step 5: Iterative refinement
    logger.info("\n--- Step 5: Iterative Refinement ---")
    
    # Set up components for iterative refinement
    refinement_components = {
        'random_forest': {
            'estimator': RandomForestClassifier(random_state=42),
            'method': 'grid',
            'param_grid': {
                'n_estimators': [150, 200, 250],
                'max_depth': [15, 20, 25],
                'min_samples_split': [2, 3, 4]
            }
        },
        'gradient_boosting': {
            'estimator': GradientBoostingClassifier(random_state=42),
            'method': 'bayesian',
            'search_spaces': {
                'n_estimators': Integer(100, 200),
                'learning_rate': Real(0.05, 0.2),
                'max_depth': Integer(4, 8)
            },
            'n_iter': 20
        }
    }
    
    iterative_results = targeted_optimizer.iterative_refinement(
        components=refinement_components,
        X=X_train,
        y=y_train,
        max_iterations=3
    )
    
    # Save optimization results
    targeted_optimizer.export_results('optimization_results.json')
    store_to_memory('optimization_results', iterative_results)
    
    logger.info("\n--- Optimization Results Summary ---")
    logger.info(f"Baseline score: {targeted_optimizer.baseline_score:.4f}")
    logger.info(f"Final best score: {iterative_results['final_best_score']:.4f}")
    logger.info(f"Total improvement: {iterative_results['total_improvement']:.2%}")
    
    # Step 6: Create final optimized pipeline
    logger.info("\n--- Step 6: Final Optimized Pipeline ---")
    
    best_configs = targeted_optimizer._extract_best_configs()
    logger.info("\nBest configurations found:")
    for component, config in best_configs.items():
        logger.info(f"  {component}: score={config['score']:.4f}, method={config['method']}")
        logger.info(f"    params: {config['params']}")
    
    # Store final results
    final_summary = {
        'workflow': 'MLE-STAR_refinement',
        'session_id': 'automation-session-1754319839721-scewi2uw3',
        'agent': 'refinement_agent',
        'baseline_score': targeted_optimizer.baseline_score,
        'final_score': iterative_results['final_best_score'],
        'improvement': iterative_results['total_improvement'],
        'highest_impact_component': highest_impact_component,
        'optimization_time': sum(r.optimization_time for r in targeted_optimizer.optimization_history),
        'timestamp': datetime.now().isoformat()
    }
    
    store_to_memory('workflow_summary', final_summary)
    
    logger.info("\n=== Refinement Workflow Complete ===")
    logger.info(f"Total improvement achieved: {iterative_results['total_improvement']:.2%}")
    
    return final_summary


def demonstrate_adaptive_optimization():
    """
    Demonstrate adaptive optimization that automatically
    chooses the best optimization method
    """
    logger.info("\n=== Adaptive Optimization Demo ===")
    
    # Create dataset
    X, y = load_iris(return_X_y=True)
    X_train, X_test, y_train, y_test = train_test_split(
        X, y, test_size=0.2, random_state=42
    )
    
    # Initialize optimizers
    targeted_opt = TargetedOptimizer(
        baseline_score=0.9,  # Hypothetical baseline
        evaluation_metric='accuracy'
    )
    adaptive_opt = AdaptiveOptimizer(targeted_opt)
    
    # Define different search spaces
    search_spaces = {
        'small_discrete': {
            'n_estimators': [50, 100, 150],
            'max_depth': [5, 10, 15]
        },
        'large_mixed': {
            'n_estimators': (50, 300),
            'learning_rate': (0.01, 0.3),
            'max_depth': [3, 5, 7, 10, 15, 20],
            'min_samples_split': (2, 20)
        },
        'continuous_only': {
            'C': (0.01, 100.0),
            'gamma': (0.0001, 1.0)
        }
    }
    
    # Test adaptive optimization on different search spaces
    for space_name, space in search_spaces.items():
        logger.info(f"\nOptimizing with {space_name} search space...")
        
        if space_name == 'continuous_only':
            estimator = SVC(kernel='rbf', random_state=42)
        else:
            estimator = RandomForestClassifier(random_state=42)
        
        result = adaptive_opt.optimize_adaptive(
            component_name=f'adaptive_{space_name}',
            search_space=space,
            estimator=estimator,
            X=X_train,
            y=y_train
        )
        
        logger.info(f"  Method used: {result.optimization_method}")
        logger.info(f"  Best score: {result.best_score:.4f}")
        logger.info(f"  Improvement: {result.improvement_from_baseline:.2%}")


if __name__ == "__main__":
    # Run main refinement workflow
    summary = run_refinement_workflow()
    
    # Demonstrate adaptive optimization
    demonstrate_adaptive_optimization()
    
    # Final coordination hook
    try:
        subprocess.run(
            'npx claude-flow@alpha hooks post-task --task-id "refinement_agent" '
            '--analyze-performance true',
            shell=True
        )
    except:
        pass
    
    logger.info("\nRefinement agent work complete!")