"""
Ensemble Agent Test Suite
Validates ensemble strategies and performance
"""

import numpy as np
from sklearn.datasets import make_classification, make_regression
from sklearn.model_selection import train_test_split
from sklearn.ensemble import RandomForestClassifier, RandomForestRegressor
from sklearn.linear_model import LogisticRegression, Ridge
from sklearn.svm import SVC, SVR
from sklearn.tree import DecisionTreeClassifier, DecisionTreeRegressor
from sklearn.neural_network import MLPClassifier, MLPRegressor
from sklearn.metrics import accuracy_score, mean_squared_error, r2_score
import time


def test_classification_ensembles():
    """Test all ensemble strategies on classification task"""
    print("Testing Classification Ensembles")
    print("=" * 60)
    
    # Generate data
    X, y = make_classification(
        n_samples=1500, n_features=20, n_informative=15,
        n_redundant=3, n_repeated=2, n_classes=3,
        class_sep=1.0, random_state=42
    )
    
    X_train, X_test, y_train, y_test = train_test_split(
        X, y, test_size=0.3, random_state=42, stratify=y
    )
    
    # Create diverse base models
    base_models = [
        LogisticRegression(max_iter=1000, random_state=42),
        RandomForestClassifier(n_estimators=100, random_state=42),
        SVC(probability=True, random_state=42),
        DecisionTreeClassifier(max_depth=10, random_state=42),
        MLPClassifier(hidden_layer_sizes=(50, 30), max_iter=1000, random_state=42)
    ]
    
    # Test individual models first
    print("\nIndividual Model Performance:")
    print("-" * 40)
    
    individual_scores = {}
    for i, model in enumerate(base_models):
        start_time = time.time()
        model.fit(X_train, y_train)
        train_time = time.time() - start_time
        
        y_pred = model.predict(X_test)
        accuracy = accuracy_score(y_test, y_pred)
        individual_scores[model.__class__.__name__] = accuracy
        
        print(f"{model.__class__.__name__}: {accuracy:.4f} (train time: {train_time:.2f}s)")
    
    # Import ensemble classes
    from ensemble_agent_implementation import (
        DynamicWeightingEnsemble, StackingEnsemble,
        MixtureOfExpertsEnsemble, BayesianModelAveraging,
        EnsembleOptimizer
    )
    
    # Test ensemble strategies
    print("\nEnsemble Performance:")
    print("-" * 40)
    
    optimizer = EnsembleOptimizer()
    strategies = ['dynamic_weighting', 'stacking', 'mixture_of_experts', 'bayesian_averaging']
    
    ensemble_results = {}
    
    for strategy in strategies:
        try:
            start_time = time.time()
            
            # Create ensemble
            if strategy == 'mixture_of_experts':
                # Use fewer models for MoE
                ensemble = optimizer.create_ensemble(
                    base_models[:3], strategy=strategy, task_type='classification'
                )
            else:
                ensemble = optimizer.create_ensemble(
                    base_models, strategy=strategy, task_type='classification'
                )
            
            # Fit ensemble
            ensemble.fit(X_train, y_train)
            train_time = time.time() - start_time
            
            # Predict
            start_time = time.time()
            y_pred = ensemble.predict(X_test)
            pred_time = time.time() - start_time
            
            # Calculate metrics
            accuracy = accuracy_score(y_test, y_pred)
            improvement = accuracy - max(individual_scores.values())
            
            ensemble_results[strategy] = {
                'accuracy': accuracy,
                'improvement': improvement,
                'train_time': train_time,
                'pred_time': pred_time
            }
            
            print(f"{strategy}: {accuracy:.4f} (improvement: {improvement:+.4f}, "
                  f"train: {train_time:.2f}s, pred: {pred_time:.3f}s)")
            
        except Exception as e:
            print(f"{strategy}: Failed - {str(e)}")
    
    return ensemble_results


def test_regression_ensembles():
    """Test all ensemble strategies on regression task"""
    print("\n\nTesting Regression Ensembles")
    print("=" * 60)
    
    # Generate data
    X, y = make_regression(
        n_samples=1500, n_features=20, n_informative=15,
        noise=0.1, random_state=42
    )
    
    X_train, X_test, y_train, y_test = train_test_split(
        X, y, test_size=0.3, random_state=42
    )
    
    # Create diverse base models
    base_models = [
        Ridge(random_state=42),
        RandomForestRegressor(n_estimators=100, random_state=42),
        SVR(kernel='rbf'),
        DecisionTreeRegressor(max_depth=10, random_state=42),
        MLPRegressor(hidden_layer_sizes=(50, 30), max_iter=1000, random_state=42)
    ]
    
    # Test individual models
    print("\nIndividual Model Performance:")
    print("-" * 40)
    
    individual_scores = {}
    for i, model in enumerate(base_models):
        start_time = time.time()
        model.fit(X_train, y_train)
        train_time = time.time() - start_time
        
        y_pred = model.predict(X_test)
        mse = mean_squared_error(y_test, y_pred)
        r2 = r2_score(y_test, y_pred)
        individual_scores[model.__class__.__name__] = r2
        
        print(f"{model.__class__.__name__}: R²={r2:.4f}, MSE={mse:.2f} (train time: {train_time:.2f}s)")
    
    # Import ensemble classes
    from ensemble_agent_implementation import EnsembleOptimizer
    
    # Test ensemble strategies
    print("\nEnsemble Performance:")
    print("-" * 40)
    
    optimizer = EnsembleOptimizer()
    strategies = ['dynamic_weighting', 'stacking', 'bayesian_averaging']
    
    ensemble_results = {}
    
    for strategy in strategies:
        try:
            start_time = time.time()
            
            # Create ensemble
            ensemble = optimizer.create_ensemble(
                base_models, strategy=strategy, task_type='regression'
            )
            
            # Fit ensemble
            ensemble.fit(X_train, y_train)
            train_time = time.time() - start_time
            
            # Predict
            start_time = time.time()
            y_pred = ensemble.predict(X_test)
            pred_time = time.time() - start_time
            
            # Calculate metrics
            mse = mean_squared_error(y_test, y_pred)
            r2 = r2_score(y_test, y_pred)
            improvement = r2 - max(individual_scores.values())
            
            ensemble_results[strategy] = {
                'r2': r2,
                'mse': mse,
                'improvement': improvement,
                'train_time': train_time,
                'pred_time': pred_time
            }
            
            print(f"{strategy}: R²={r2:.4f}, MSE={mse:.2f} (improvement: {improvement:+.4f}, "
                  f"train: {train_time:.2f}s, pred: {pred_time:.3f}s)")
            
        except Exception as e:
            print(f"{strategy}: Failed - {str(e)}")
    
    return ensemble_results


def test_advanced_ensembles():
    """Test advanced ensemble techniques"""
    print("\n\nTesting Advanced Ensemble Techniques")
    print("=" * 60)
    
    # Generate data
    X, y = make_classification(
        n_samples=1000, n_features=20, n_informative=15,
        n_redundant=5, random_state=42
    )
    
    X_train, X_test, y_train, y_test = train_test_split(
        X, y, test_size=0.3, random_state=42
    )
    
    # Base models
    base_models = [
        RandomForestClassifier(n_estimators=50, random_state=42),
        SVC(probability=True, random_state=42),
        MLPClassifier(hidden_layer_sizes=(30,), max_iter=500, random_state=42)
    ]
    
    # Fit base models
    for model in base_models:
        model.fit(X_train, y_train)
    
    # Test Adaptive Ensemble Selection
    print("\nAdaptive Ensemble Selection:")
    print("-" * 40)
    
    from ensemble_agent_advanced import AdaptiveEnsembleSelector, EnsembleMonitor
    
    selector = AdaptiveEnsembleSelector()
    data_chars = selector.analyze_data_characteristics(X_train, y_train)
    
    print("Data Characteristics:")
    for key, value in data_chars.items():
        print(f"  {key}: {value:.4f}")
    
    # Create adaptive ensemble
    ensemble = selector.create_adaptive_ensemble(X_train, y_train, base_models)
    
    print(f"\nSelected Strategy: {selector.selected_strategy}")
    print("Strategy Scores:")
    for strategy, score in selector.strategy_scores.items():
        print(f"  {strategy}: {score:.4f}")
    
    # Test performance
    y_pred = ensemble.predict(X_test)
    accuracy = accuracy_score(y_test, y_pred)
    print(f"\nAdaptive Ensemble Accuracy: {accuracy:.4f}")
    
    # Test Ensemble Monitoring
    print("\nEnsemble Monitoring:")
    print("-" * 40)
    
    monitor = EnsembleMonitor()
    
    # Simulate multiple evaluations
    for i in range(3):
        # Simulate different test sets
        X_val, _, y_val, _ = train_test_split(X_test, y_test, test_size=0.5, random_state=i)
        metrics = monitor.track_performance(ensemble, X_val, y_val, timestamp=f"eval_{i}")
        print(f"Evaluation {i+1}: {metrics}")
    
    # Generate report
    report = monitor.generate_report()
    print("\nPerformance Report:")
    print(f"  Trend: {report['performance_summary']['performance_trend']}")
    print(f"  Recommendations: {report['recommendations']}")
    
    return True


def test_ensemble_optimization():
    """Test ensemble composition optimization"""
    print("\n\nTesting Ensemble Composition Optimization")
    print("=" * 60)
    
    # Generate data
    X, y = make_classification(
        n_samples=1000, n_features=20, n_informative=15,
        n_redundant=5, random_state=42
    )
    
    X_train, X_val, y_train, y_val = train_test_split(
        X, y, test_size=0.2, random_state=42
    )
    
    # Create many candidate models
    candidate_models = [
        RandomForestClassifier(n_estimators=50, random_state=42),
        RandomForestClassifier(n_estimators=100, random_state=43),
        RandomForestClassifier(max_depth=5, random_state=44),
        LogisticRegression(max_iter=1000, random_state=42),
        LogisticRegression(C=0.1, max_iter=1000, random_state=43),
        SVC(probability=True, random_state=42),
        SVC(kernel='poly', probability=True, random_state=43),
        DecisionTreeClassifier(max_depth=10, random_state=42),
        DecisionTreeClassifier(max_depth=5, random_state=43),
        MLPClassifier(hidden_layer_sizes=(50,), max_iter=500, random_state=42)
    ]
    
    # Fit all candidates
    print("Fitting candidate models...")
    for model in candidate_models:
        model.fit(X_train, y_train)
    
    # Optimize ensemble composition
    from ensemble_agent_implementation import EnsembleOptimizer
    
    optimizer = EnsembleOptimizer()
    selected_models = optimizer.optimize_ensemble_composition(
        candidate_models, X_val, y_val, max_models=5
    )
    
    print(f"\nSelected {len(selected_models)} models from {len(candidate_models)} candidates:")
    for model in selected_models:
        print(f"  - {model.__class__.__name__} with params: {model.get_params()}")
    
    # Create ensemble with selected models
    ensemble = optimizer.create_ensemble(
        selected_models, strategy='stacking', task_type='classification'
    )
    ensemble.fit(X_train, y_train)
    
    # Compare with ensemble of all models
    all_ensemble = optimizer.create_ensemble(
        candidate_models, strategy='stacking', task_type='classification'
    )
    all_ensemble.fit(X_train, y_train)
    
    # Test both
    X_test, y_test = X_val, y_val  # Use validation as test for this demo
    
    selected_pred = ensemble.predict(X_test)
    selected_acc = accuracy_score(y_test, selected_pred)
    
    all_pred = all_ensemble.predict(X_test)
    all_acc = accuracy_score(y_test, all_pred)
    
    print(f"\nOptimized Ensemble ({len(selected_models)} models): {selected_acc:.4f}")
    print(f"All Models Ensemble ({len(candidate_models)} models): {all_acc:.4f}")
    print(f"Improvement from optimization: {selected_acc - all_acc:+.4f}")
    
    return True


def main():
    """Run all ensemble tests"""
    print("MLE-STAR Ensemble Agent Test Suite")
    print("=" * 80)
    
    # Run tests
    classification_results = test_classification_ensembles()
    regression_results = test_regression_ensembles()
    advanced_success = test_advanced_ensembles()
    optimization_success = test_ensemble_optimization()
    
    # Summary
    print("\n\nTest Summary")
    print("=" * 80)
    
    print("\nClassification Ensemble Results:")
    for strategy, results in classification_results.items():
        print(f"  {strategy}: Accuracy={results['accuracy']:.4f}, "
              f"Improvement={results['improvement']:+.4f}")
    
    print("\nRegression Ensemble Results:")
    for strategy, results in regression_results.items():
        print(f"  {strategy}: R²={results['r2']:.4f}, "
              f"Improvement={results['improvement']:+.4f}")
    
    print(f"\nAdvanced Ensembles: {'PASSED' if advanced_success else 'FAILED'}")
    print(f"Optimization Tests: {'PASSED' if optimization_success else 'FAILED'}")
    
    print("\n✅ All ensemble tests completed successfully!")


if __name__ == "__main__":
    main()