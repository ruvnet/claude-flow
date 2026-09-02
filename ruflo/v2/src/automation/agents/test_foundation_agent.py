#!/usr/bin/env python3
"""
Test Suite for Foundation Agent
==============================
Comprehensive tests for the foundation model builder.
"""

import unittest
import tempfile
import json
import os
from pathlib import Path
import pandas as pd
import numpy as np
from sklearn.datasets import make_classification, make_regression

# Import modules to test
from foundation_agent_core import FoundationModelBuilder, ModelResult
from foundation_agent_features import FeatureEngineer
from foundation_agent_integration import FoundationAgentIntegration


class TestFoundationModelBuilder(unittest.TestCase):
    """Test the core foundation model builder"""
    
    def setUp(self):
        """Set up test fixtures"""
        self.session_id = "test_session"
        self.execution_id = "test_execution"
        self.builder = FoundationModelBuilder(self.session_id, self.execution_id)
        
        # Create test datasets
        self.X_class, self.y_class = make_classification(
            n_samples=200, n_features=10, n_informative=5, 
            n_redundant=2, n_classes=3, random_state=42
        )
        self.X_class_df = pd.DataFrame(self.X_class, columns=[f'feature_{i}' for i in range(10)])
        self.y_class_series = pd.Series(self.y_class)
        
        self.X_reg, self.y_reg = make_regression(
            n_samples=200, n_features=10, n_informative=5,
            noise=10, random_state=42
        )
        self.X_reg_df = pd.DataFrame(self.X_reg, columns=[f'feature_{i}' for i in range(10)])
        self.y_reg_series = pd.Series(self.y_reg)
    
    def test_dataset_analysis_classification(self):
        """Test dataset analysis for classification"""
        data = self.X_class_df.copy()
        data['target'] = self.y_class
        
        analysis = self.builder.analyze_dataset(data, 'target')
        
        self.assertEqual(analysis['problem_type'], 'classification')
        self.assertEqual(analysis['shape'], (200, 11))
        self.assertIn('target_distribution', analysis)
        self.assertIsInstance(analysis['recommendations'], list)
    
    def test_dataset_analysis_regression(self):
        """Test dataset analysis for regression"""
        data = self.X_reg_df.copy()
        data['target'] = self.y_reg
        
        analysis = self.builder.analyze_dataset(data, 'target')
        
        self.assertEqual(analysis['problem_type'], 'regression')
        self.assertIn('mean', analysis['target_distribution'])
        self.assertIn('std', analysis['target_distribution'])
    
    def test_preprocessing_pipeline_creation(self):
        """Test preprocessing pipeline creation"""
        # Add some categorical data
        X_mixed = self.X_class_df.copy()
        X_mixed['category'] = ['A', 'B', 'C'] * 66 + ['A', 'B']
        
        pipeline = self.builder.create_preprocessing_pipeline(X_mixed)
        
        self.assertIsNotNone(pipeline)
        self.assertEqual(len(self.builder.feature_names), 11)  # 10 numeric + 1 categorical
    
    def test_baseline_models_classification(self):
        """Test baseline model training for classification"""
        self.builder.problem_type = 'classification'
        results = self.builder.train_baseline_models(
            self.X_class_df, self.y_class_series, cv_folds=3
        )
        
        self.assertGreater(len(results), 0)
        
        # Check result structure
        for result in results:
            self.assertIsInstance(result, ModelResult)
            self.assertIsInstance(result.mean_cv_score, float)
            self.assertIsInstance(result.cv_scores, list)
            self.assertEqual(len(result.cv_scores), 3)  # cv_folds
            
        # Check that models were saved
        model_files = list(self.builder.models_dir.glob("*.pkl"))
        self.assertGreater(len(model_files), 0)
    
    def test_baseline_models_regression(self):
        """Test baseline model training for regression"""
        self.builder.problem_type = 'regression'
        results = self.builder.train_baseline_models(
            self.X_reg_df, self.y_reg_series, cv_folds=3
        )
        
        self.assertGreater(len(results), 0)
        
        # For regression, scores should be MSE (positive after conversion)
        for result in results:
            self.assertGreater(result.mean_cv_score, 0)
    
    def test_ensemble_creation(self):
        """Test ensemble baseline creation"""
        # First train baseline models
        self.builder.problem_type = 'classification'
        self.builder.train_baseline_models(self.X_class_df, self.y_class_series, cv_folds=3)
        
        # Create ensemble
        ensemble_result = self.builder.create_ensemble_baseline(
            self.X_class_df, self.y_class_series
        )
        
        self.assertIn('model_name', ensemble_result)
        self.assertEqual(ensemble_result['model_name'], 'EnsembleBaseline')
        self.assertIn('base_models', ensemble_result)
        self.assertIn('cv_score', ensemble_result)
    
    def test_report_generation(self):
        """Test report generation"""
        # Train models first
        self.builder.problem_type = 'classification'
        self.builder.train_baseline_models(self.X_class_df, self.y_class_series, cv_folds=3)
        
        report = self.builder.generate_report()
        
        self.assertIn('session_id', report)
        self.assertIn('baseline_models', report)
        self.assertIn('best_model', report)
        self.assertIn('recommendations', report)
        
        # Best model should be identified
        self.assertIsNotNone(report['best_model'])
        self.assertIn('name', report['best_model'])
        self.assertIn('score', report['best_model'])


class TestFeatureEngineer(unittest.TestCase):
    """Test the feature engineering module"""
    
    def setUp(self):
        """Set up test fixtures"""
        self.engineer = FeatureEngineer(problem_type="classification")
        
        # Create test data
        self.X = pd.DataFrame({
            'f1': [1, 2, 3, 4, 5],
            'f2': [2, 4, 6, 8, 10],
            'f3': [1, 1, 2, 2, 3],
            'cat': ['A', 'B', 'A', 'B', 'A']
        })
        self.y = pd.Series([0, 1, 0, 1, 0])
    
    def test_polynomial_features(self):
        """Test polynomial feature creation"""
        X_poly = self.engineer.create_polynomial_features(self.X, degree=2, interaction_only=True)
        
        # Should have more features than original
        self.assertGreater(X_poly.shape[1], self.X.shape[1])
        
        # Should preserve categorical features
        self.assertIn('cat', X_poly.columns)
    
    def test_statistical_features(self):
        """Test statistical feature creation"""
        X_stats = self.engineer.create_statistical_features(self.X)
        
        # Should have added statistical features
        self.assertIn('row_mean', X_stats.columns)
        self.assertIn('row_std', X_stats.columns)
        self.assertIn('row_max', X_stats.columns)
    
    def test_ratio_features(self):
        """Test ratio feature creation"""
        X_ratio = self.engineer.create_ratio_features(self.X)
        
        # Should have ratio features
        ratio_cols = [col for col in X_ratio.columns if 'ratio' in col]
        self.assertGreater(len(ratio_cols), 0)
        
        # Should have difference features
        diff_cols = [col for col in X_ratio.columns if 'diff' in col]
        self.assertGreater(len(diff_cols), 0)
    
    def test_clustering_features(self):
        """Test clustering-based feature creation"""
        X_cluster = self.engineer.create_clustering_features(self.X, n_clusters=2)
        
        # Should have cluster assignment
        self.assertIn('cluster', X_cluster.columns)
        
        # Should have distance features
        dist_cols = [col for col in X_cluster.columns if 'dist_to_cluster' in col]
        self.assertEqual(len(dist_cols), 2)  # n_clusters
    
    def test_feature_selection_univariate(self):
        """Test univariate feature selection"""
        # Create more features first
        X_poly = self.engineer.create_polynomial_features(self.X)
        
        # Select top features
        X_selected, scores = self.engineer.select_features_univariate(X_poly, self.y, k=5)
        
        # Should have reduced features
        self.assertEqual(X_selected.shape[1], 6)  # 5 selected + 1 categorical
        
        # Should have scores
        self.assertIsInstance(scores, dict)
        self.assertGreater(len(scores), 0)
    
    def test_pca_reduction(self):
        """Test PCA dimensionality reduction"""
        X_pca = self.engineer.reduce_dimensions_pca(self.X, n_components=2)
        
        # Should have PCA components
        pca_cols = [col for col in X_pca.columns if col.startswith('pca_')]
        self.assertEqual(len(pca_cols), 2)
        
        # Should preserve categorical features
        self.assertIn('cat', X_pca.columns)
        
        # Should have transformation info
        self.assertIn('pca', self.engineer.transformations)
    
    def test_create_all_features(self):
        """Test creating all features with configuration"""
        config = {
            'polynomial': {'degree': 2, 'interaction_only': True},
            'statistical': True,
            'ratio': False,  # Skip ratio features
            'clustering': {'n_clusters': 2},
            'transformation': False,  # Skip transformations
            'binning': False  # Skip binning
        }
        
        X_all = self.engineer.create_all_features(self.X, config)
        
        # Should have more features than original
        self.assertGreater(X_all.shape[1], self.X.shape[1])
        
        # Should not have ratio features (disabled in config)
        ratio_cols = [col for col in X_all.columns if 'ratio' in col]
        self.assertEqual(len(ratio_cols), 0)


class TestFoundationAgentIntegration(unittest.TestCase):
    """Test the integration module"""
    
    def setUp(self):
        """Set up test fixtures"""
        self.agent = FoundationAgentIntegration()
        self.session_id = "test_session_integration"
        self.execution_id = "test_execution_integration"
        
        # Create test data file
        self.test_data_file = tempfile.NamedTemporaryFile(mode='w', suffix='.csv', delete=False)
        test_data = pd.DataFrame({
            'feature_1': np.random.randn(100),
            'feature_2': np.random.randn(100),
            'feature_3': np.random.choice(['A', 'B', 'C'], 100),
            'target': np.random.choice([0, 1], 100)
        })
        test_data.to_csv(self.test_data_file.name, index=False)
        self.test_data_file.close()
    
    def tearDown(self):
        """Clean up test files"""
        os.unlink(self.test_data_file.name)
    
    def test_initialization(self):
        """Test agent initialization"""
        self.agent.initialize_session(self.session_id, self.execution_id)
        
        self.assertEqual(self.agent.session_id, self.session_id)
        self.assertEqual(self.agent.execution_id, self.execution_id)
        self.assertIsNotNone(self.agent.builder)
    
    def test_load_dataset_csv(self):
        """Test loading CSV dataset"""
        self.agent.initialize_session(self.session_id, self.execution_id)
        
        data = self.agent.load_dataset(self.test_data_file.name)
        
        self.assertIsInstance(data, pd.DataFrame)
        self.assertEqual(data.shape[0], 100)
        self.assertIn('target', data.columns)
    
    def test_load_sample_dataset(self):
        """Test loading sample dataset when file doesn't exist"""
        self.agent.initialize_session(self.session_id, self.execution_id)
        
        data = self.agent.load_dataset("non_existent_file.csv")
        
        self.assertIsInstance(data, pd.DataFrame)
        self.assertIn('target', data.columns)
    
    def test_process_dataset_analysis(self):
        """Test processing dataset analysis step"""
        self.agent.initialize_session(self.session_id, self.execution_id)
        
        config = {
            "type": "dataset_analysis",
            "dataset_path": self.test_data_file.name,
            "target_column": "target"
        }
        
        result = self.agent.process_workflow_step(config)
        
        self.assertEqual(result['status'], 'completed')
        self.assertIn('analysis', result)
    
    def test_process_full_pipeline(self):
        """Test processing full pipeline"""
        self.agent.initialize_session(self.session_id, self.execution_id)
        
        config = {
            "type": "full_pipeline",
            "dataset_path": self.test_data_file.name,
            "target_column": "target"
        }
        
        result = self.agent.process_workflow_step(config)
        
        self.assertEqual(result['status'], 'completed')
        self.assertIn('report', result)
        self.assertIn('results', result)
        self.assertIn('analysis', result['results'])
        self.assertIn('preprocessing', result['results'])
        self.assertIn('training', result['results'])


def run_all_tests():
    """Run all test suites"""
    # Create test suite
    loader = unittest.TestLoader()
    suite = unittest.TestSuite()
    
    # Add test classes
    suite.addTests(loader.loadTestsFromTestCase(TestFoundationModelBuilder))
    suite.addTests(loader.loadTestsFromTestCase(TestFeatureEngineer))
    suite.addTests(loader.loadTestsFromTestCase(TestFoundationAgentIntegration))
    
    # Run tests
    runner = unittest.TextTestRunner(verbosity=2)
    result = runner.run(suite)
    
    return result.wasSuccessful()


if __name__ == "__main__":
    # Run all tests
    success = run_all_tests()
    
    if success:
        print("\n✅ All tests passed successfully!")
    else:
        print("\n❌ Some tests failed. Please check the output above.")
        exit(1)