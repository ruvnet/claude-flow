#!/usr/bin/env python3
"""
MLE-STAR Ensemble Demo

Demonstrates the MLE-STAR ensemble integration with proper training
and prediction workflow.
"""

import asyncio
import sys
import os
import numpy as np
import logging

# Add the src directory to Python path
sys.path.insert(0, str(Path(__file__).parent / "src"))

from swarm_benchmark.mle_star import (
    MLEStarEnsembleExecutor, MLEStarConfig,
    MajorityVoting, WeightedVoting, BayesianAveraging
)


async def demo_simple_ensemble():
    """Demonstrate simple ensemble with synthetic data."""
    print("🧠 MLE-STAR Ensemble Integration Demo")
    print("=" * 50)
    
    # Configure logging to reduce noise
    logging.basicConfig(level=logging.WARNING)
    
    # Create simple test data
    print("📊 Generating test data...")
    np.random.seed(42)
    X_train = np.random.randn(100, 5)
    y_train = np.random.randint(0, 3, 100)
    X_test = np.random.randn(20, 5)
    y_test = np.random.randint(0, 3, 20)
    
    # Configure ensemble
    config = MLEStarConfig(
        models=[
            {"type": "random_forest", "n_estimators": 10, "task": "classification"},
            {"type": "logistic_regression", "C": 1.0, "max_iter": 100, "task": "classification"},
        ],
        voting_strategy="majority",
        ensemble_size=2,
        max_parallel=2
    )
    
    print(f"🔧 Configured ensemble with {len(config.models)} models")
    print(f"   - Voting strategy: {config.voting_strategy}")
    
    # Create ensemble
    ensemble = MLEStarEnsembleExecutor(config)
    
    try:
        # Manually train models for this demo
        print("🏋️  Training models...")
        
        await ensemble._initialize_models_parallel()
        print(f"   - Initialized {len(ensemble.models)} models")
        
        # Train each model manually for demo
        for i, model_agent in enumerate(ensemble.models):
            success = await model_agent.train(X_train, y_train)
            print(f"   - Model {i} training: {'SUCCESS' if success else 'FAILED'}")
        
        # Make predictions
        print("🎯 Making predictions...")
        predictions = await ensemble._gather_predictions(X_test)
        print(f"   - Gathered {len(predictions)} predictions")
        
        # Build consensus
        final_prediction, consensus_details = await ensemble._build_consensus(predictions)
        print(f"   - Final prediction shape: {np.array(final_prediction).shape}")
        print(f"   - Consensus strength: {consensus_details.get('consensus_strength', 'N/A')}")
        
        # Test different voting strategies
        print("\n🗳️  Testing voting strategies:")
        
        # Test with simple numeric predictions for demo
        test_preds = [[0.7, 0.2, 0.1], [0.6, 0.3, 0.1], [0.8, 0.1, 0.1]]
        
        majority = MajorityVoting()
        majority_result = await majority.vote(test_preds)
        print(f"   - Majority voting: {majority_result}")
        
        weighted = WeightedVoting(weights=[0.4, 0.4, 0.2])
        weighted_result = await weighted.vote(test_preds)
        print(f"   - Weighted voting: {weighted_result}")
        
        bayesian = BayesianAveraging()
        bayesian_result = await bayesian.vote(test_preds)
        print(f"   - Bayesian averaging: {bayesian_result}")
        
        print("\n✅ Demo completed successfully!")
        
    except Exception as e:
        print(f"❌ Demo failed: {e}")
        import traceback
        traceback.print_exc()
    
    finally:
        # Cleanup
        await ensemble.cleanup()


async def demo_performance_tracking():
    """Demonstrate performance tracking capabilities."""
    print("\n📈 Performance Tracking Demo")
    print("-" * 30)
    
    from swarm_benchmark.mle_star.performance_tracker import PerformanceTracker
    
    tracker = PerformanceTracker()
    
    # Start tracking
    await tracker.start_tracking_session("demo_session")
    
    # Register some models
    tracker.register_model("rf_model", "random_forest")
    tracker.register_model("lr_model", "logistic_regression")
    
    # Simulate some metrics
    tracker.record_training_time("rf_model", 2.5)
    tracker.record_training_time("lr_model", 1.2)
    
    tracker.record_prediction_time("rf_model", 0.1)
    tracker.record_prediction_time("lr_model", 0.05)
    
    tracker.record_model_accuracy("rf_model", accuracy=0.85, precision=0.82)
    tracker.record_model_accuracy("lr_model", accuracy=0.80, precision=0.78)
    
    # Get performance summary
    summary = tracker.get_performance_summary()
    
    print(f"📊 Performance Summary:")
    print(f"   - Models tracked: {len(summary['model_performances'])}")
    for model_id, perf in summary['model_performances'].items():
        print(f"   - {model_id}:")
        print(f"     • Training time: {perf['training_time']:.2f}s")
        print(f"     • Accuracy: {perf['accuracy']}")
        print(f"     • Success rate: {perf['success_rate']:.2f}")
    
    await tracker.end_tracking_session()
    print("✅ Performance tracking demo completed")


if __name__ == "__main__":
    asyncio.run(demo_simple_ensemble())
    asyncio.run(demo_performance_tracking())