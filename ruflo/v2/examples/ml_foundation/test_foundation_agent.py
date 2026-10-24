"""
Test script for Enhanced Foundation Agent
Demonstrates MLE-STAR Foundation phase capabilities
"""

import sys
import pandas as pd
import numpy as np
from pathlib import Path
from datetime import datetime

# Add parent directory to path
sys.path.append(str(Path(__file__).parent))

from foundation_agent_enhanced import EnhancedFoundationAgent


def create_test_dataset():
    """Create a more complex test dataset"""
    np.random.seed(42)
    
    # Generate synthetic data with various characteristics
    n_samples = 1000
    
    # Numeric features with different distributions
    data = {
        'age': np.random.normal(45, 15, n_samples).clip(18, 80),
        'income': np.random.lognormal(10.5, 0.8, n_samples),
        'credit_score': np.random.normal(700, 100, n_samples).clip(300, 850),
        'months_employed': np.random.exponential(24, n_samples).clip(0, 240),
        'debt_ratio': np.random.beta(2, 5, n_samples),
        'num_accounts': np.random.poisson(3, n_samples),
        
        # Categorical features
        'education': np.random.choice(['High School', 'Bachelor', 'Master', 'PhD'], n_samples, p=[0.4, 0.35, 0.2, 0.05]),
        'employment_type': np.random.choice(['Full-time', 'Part-time', 'Self-employed', 'Unemployed'], n_samples, p=[0.6, 0.15, 0.2, 0.05]),
        'marital_status': np.random.choice(['Single', 'Married', 'Divorced'], n_samples, p=[0.3, 0.5, 0.2]),
        'home_ownership': np.random.choice(['Own', 'Rent', 'Other'], n_samples, p=[0.6, 0.35, 0.05])
    }
    
    df = pd.DataFrame(data)
    
    # Add some missing values
    missing_cols = ['income', 'debt_ratio', 'employment_type']
    for col in missing_cols:
        missing_idx = np.random.choice(df.index, size=int(0.05 * len(df)), replace=False)
        df.loc[missing_idx, col] = np.nan
    
    # Create target variable with some logic
    # Higher risk for: low credit score, high debt ratio, unemployed
    risk_score = (
        (df['credit_score'] < 600).astype(int) * 2 +
        (df['debt_ratio'] > 0.5).astype(int) * 1.5 +
        (df['employment_type'] == 'Unemployed').astype(int) * 2 +
        (df['income'] < 30000).astype(int) * 1 +
        np.random.normal(0, 0.5, n_samples)
    )
    
    # Convert to binary classification
    df['loan_approved'] = (risk_score < 2).astype(int)
    
    return df


def test_classification():
    """Test classification task"""
    print("\n" + "="*60)
    print("TESTING CLASSIFICATION TASK")
    print("="*60)
    
    # Create dataset
    df = create_test_dataset()
    X = df.drop('loan_approved', axis=1)
    y = df['loan_approved']
    
    print(f"Dataset shape: {X.shape}")
    print(f"Target distribution: {y.value_counts().to_dict()}")
    
    # Initialize agent
    agent = EnhancedFoundationAgent(
        task_type='classification',
        session_id=f'test-classification-{datetime.now().strftime("%Y%m%d-%H%M%S")}',
        config={
            'data': {
                'auto_detect_task': False,
                'handle_imbalanced': True,
                'outlier_detection': True,
                'feature_scaling': 'standard'
            },
            'modeling': {
                'algorithms': 'advanced',
                'hyperparameter_tuning': True,
                'tuning_method': 'random',
                'cv_folds': 3  # Reduced for faster testing
            },
            'output': {
                'save_models': True,
                'output_dir': './test_foundation_output',
                'coordinate_with_agents': False  # Disable for testing
            }
        }
    )
    
    # Run pipeline
    results = agent.run(X=X, y=y)
    
    return results


def test_regression():
    """Test regression task"""
    print("\n" + "="*60)
    print("TESTING REGRESSION TASK")
    print("="*60)
    
    # Create regression dataset
    from sklearn.datasets import make_regression
    
    X, y = make_regression(
        n_samples=1000,
        n_features=20,
        n_informative=15,
        noise=10,
        random_state=42
    )
    
    X_df = pd.DataFrame(X, columns=[f'feature_{i}' for i in range(20)])
    y_series = pd.Series(y, name='target')
    
    print(f"Dataset shape: {X_df.shape}")
    print(f"Target stats: mean={y.mean():.2f}, std={y.std():.2f}")
    
    # Initialize agent
    agent = EnhancedFoundationAgent(
        task_type='regression',
        session_id=f'test-regression-{datetime.now().strftime("%Y%m%d-%H%M%S")}',
        config={
            'modeling': {
                'algorithms': 'basic',
                'hyperparameter_tuning': False  # Faster testing
            },
            'output': {
                'save_models': False,
                'coordinate_with_agents': False
            }
        }
    )
    
    # Run pipeline
    results = agent.run(X=X_df, y=y_series)
    
    return results


def test_auto_detect():
    """Test automatic task type detection"""
    print("\n" + "="*60)
    print("TESTING AUTO TASK DETECTION")
    print("="*60)
    
    # Create a dataset without specifying task type
    df = create_test_dataset()
    X = df.drop('loan_approved', axis=1)
    y = df['loan_approved']
    
    # Initialize agent with auto detection
    agent = EnhancedFoundationAgent(
        task_type='auto',
        session_id=f'test-auto-{datetime.now().strftime("%Y%m%d-%H%M%S")}'
    )
    
    # Run pipeline
    results = agent.run(X=X, y=y)
    
    print(f"Auto-detected task type: {agent.task_type}")
    
    return results


def main():
    """Run all tests"""
    print("\n" + "="*80)
    print("ENHANCED FOUNDATION AGENT - TEST SUITE")
    print("="*80)
    
    # Test 1: Classification
    try:
        class_results = test_classification()
        print("\n✅ Classification test completed successfully!")
    except Exception as e:
        print(f"\n❌ Classification test failed: {e}")
    
    # Test 2: Regression
    try:
        reg_results = test_regression()
        print("\n✅ Regression test completed successfully!")
    except Exception as e:
        print(f"\n❌ Regression test failed: {e}")
    
    # Test 3: Auto detection
    try:
        auto_results = test_auto_detect()
        print("\n✅ Auto-detection test completed successfully!")
    except Exception as e:
        print(f"\n❌ Auto-detection test failed: {e}")
    
    print("\n" + "="*80)
    print("TEST SUITE COMPLETED")
    print("="*80)


if __name__ == "__main__":
    main()