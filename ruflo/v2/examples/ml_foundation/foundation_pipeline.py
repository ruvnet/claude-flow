"""
MLE-STAR Foundation Pipeline
Foundation Agent Implementation for Initial Model Building

This module implements the Foundation phase of MLE-STAR methodology:
- Data preprocessing and exploration
- Baseline model creation
- Modular pipeline architecture
- Performance benchmark establishment
"""

import numpy as np
import pandas as pd
from typing import Dict, List, Tuple, Any, Optional, Union
from sklearn.model_selection import train_test_split, cross_val_score
from sklearn.preprocessing import StandardScaler, LabelEncoder, OneHotEncoder
from sklearn.compose import ColumnTransformer
from sklearn.pipeline import Pipeline
from sklearn.impute import SimpleImputer
from sklearn.feature_selection import SelectKBest, f_classif, f_regression
from sklearn.metrics import (
    accuracy_score, precision_recall_fscore_support, 
    mean_squared_error, r2_score, roc_auc_score
)
import joblib
import json
import logging
from datetime import datetime
from pathlib import Path

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


class FoundationPipeline:
    """
    MLE-STAR Foundation Pipeline for initial model building
    
    This class orchestrates:
    1. Data analysis and preprocessing
    2. Feature engineering
    3. Baseline model creation
    4. Performance benchmarking
    5. Pipeline modularization
    """
    
    def __init__(self, task_type: str = 'classification', config: Optional[Dict] = None):
        """
        Initialize Foundation Pipeline
        
        Args:
            task_type: Either 'classification' or 'regression'
            config: Configuration dictionary with preprocessing and model parameters
        """
        self.task_type = task_type
        self.config = config or self._get_default_config()
        self.preprocessor = None
        self.feature_selector = None
        self.models = {}
        self.performance_metrics = {}
        self.data_insights = {}
        self.pipeline_components = {}
        
        logger.info(f"Initialized Foundation Pipeline for {task_type} task")
        
    def _get_default_config(self) -> Dict:
        """Get default configuration based on task type"""
        base_config = {
            'preprocessing': {
                'numeric_strategy': 'mean',
                'categorical_strategy': 'most_frequent',
                'scaling': 'standard',
                'handle_missing': True,
                'feature_selection': True,
                'n_features': 'auto'
            },
            'validation': {
                'test_size': 0.2,
                'cv_folds': 5,
                'random_state': 42
            },
            'output': {
                'save_pipeline': True,
                'save_insights': True,
                'output_dir': './foundation_output'
            }
        }
        
        if self.task_type == 'classification':
            base_config['models'] = {
                'logistic_regression': {'max_iter': 1000},
                'random_forest': {'n_estimators': 100, 'max_depth': 10},
                'gradient_boosting': {'n_estimators': 100, 'learning_rate': 0.1},
                'svm': {'kernel': 'rbf', 'probability': True}
            }
        else:
            base_config['models'] = {
                'linear_regression': {},
                'random_forest': {'n_estimators': 100, 'max_depth': 10},
                'gradient_boosting': {'n_estimators': 100, 'learning_rate': 0.1},
                'svr': {'kernel': 'rbf'}
            }
            
        return base_config
    
    def analyze_data(self, X: pd.DataFrame, y: pd.Series) -> Dict:
        """
        Comprehensive data analysis
        
        Args:
            X: Feature dataframe
            y: Target variable
            
        Returns:
            Dictionary with data insights
        """
        logger.info("Starting comprehensive data analysis...")
        
        insights = {
            'basic_info': {
                'n_samples': len(X),
                'n_features': X.shape[1],
                'feature_types': {},
                'target_info': {}
            },
            'missing_values': {},
            'feature_statistics': {},
            'correlations': {},
            'recommendations': []
        }
        
        # Analyze feature types
        numeric_features = X.select_dtypes(include=['int64', 'float64']).columns.tolist()
        categorical_features = X.select_dtypes(include=['object', 'category']).columns.tolist()
        
        insights['basic_info']['feature_types'] = {
            'numeric': numeric_features,
            'categorical': categorical_features
        }
        
        # Analyze missing values
        missing_counts = X.isnull().sum()
        insights['missing_values'] = {
            col: {
                'count': int(missing_counts[col]),
                'percentage': float(missing_counts[col] / len(X) * 100)
            }
            for col in X.columns if missing_counts[col] > 0
        }
        
        # Feature statistics
        if numeric_features:
            numeric_stats = X[numeric_features].describe().to_dict()
            insights['feature_statistics']['numeric'] = numeric_stats
            
            # Correlation analysis
            if len(numeric_features) > 1:
                corr_matrix = X[numeric_features].corr()
                high_corr_pairs = []
                for i in range(len(corr_matrix.columns)):
                    for j in range(i+1, len(corr_matrix.columns)):
                        if abs(corr_matrix.iloc[i, j]) > 0.8:
                            high_corr_pairs.append({
                                'feature1': corr_matrix.columns[i],
                                'feature2': corr_matrix.columns[j],
                                'correlation': float(corr_matrix.iloc[i, j])
                            })
                insights['correlations']['high_correlation_pairs'] = high_corr_pairs
        
        # Target variable analysis
        if self.task_type == 'classification':
            target_counts = y.value_counts().to_dict()
            insights['basic_info']['target_info'] = {
                'unique_classes': len(target_counts),
                'class_distribution': {str(k): int(v) for k, v in target_counts.items()},
                'imbalance_ratio': float(max(target_counts.values()) / min(target_counts.values()))
            }
            
            if insights['basic_info']['target_info']['imbalance_ratio'] > 3:
                insights['recommendations'].append(
                    "Consider using class balancing techniques (SMOTE, class weights)"
                )
        else:
            insights['basic_info']['target_info'] = {
                'mean': float(y.mean()),
                'std': float(y.std()),
                'min': float(y.min()),
                'max': float(y.max())
            }
        
        # Generate recommendations
        if insights['missing_values']:
            insights['recommendations'].append(
                "Handle missing values with appropriate imputation strategies"
            )
        
        if insights.get('correlations', {}).get('high_correlation_pairs'):
            insights['recommendations'].append(
                "Consider removing highly correlated features to reduce multicollinearity"
            )
            
        self.data_insights = insights
        logger.info("Data analysis completed")
        
        return insights
    
    def create_preprocessor(self, X: pd.DataFrame) -> ColumnTransformer:
        """
        Create preprocessing pipeline
        
        Args:
            X: Feature dataframe for fitting
            
        Returns:
            Fitted ColumnTransformer
        """
        logger.info("Creating preprocessing pipeline...")
        
        numeric_features = X.select_dtypes(include=['int64', 'float64']).columns.tolist()
        categorical_features = X.select_dtypes(include=['object', 'category']).columns.tolist()
        
        # Numeric pipeline
        numeric_pipeline = Pipeline([
            ('imputer', SimpleImputer(strategy=self.config['preprocessing']['numeric_strategy'])),
            ('scaler', StandardScaler())
        ])
        
        # Categorical pipeline
        categorical_pipeline = Pipeline([
            ('imputer', SimpleImputer(strategy=self.config['preprocessing']['categorical_strategy'])),
            ('onehot', OneHotEncoder(drop='first', sparse_output=False, handle_unknown='ignore'))
        ])
        
        # Combine pipelines
        preprocessor = ColumnTransformer([
            ('numeric', numeric_pipeline, numeric_features),
            ('categorical', categorical_pipeline, categorical_features)
        ])
        
        self.preprocessor = preprocessor
        self.pipeline_components['preprocessor'] = preprocessor
        
        logger.info(f"Preprocessor created with {len(numeric_features)} numeric and "
                   f"{len(categorical_features)} categorical features")
        
        return preprocessor
    
    def create_baseline_models(self) -> Dict:
        """
        Create baseline models based on task type
        
        Returns:
            Dictionary of instantiated models
        """
        logger.info("Creating baseline models...")
        
        if self.task_type == 'classification':
            from sklearn.linear_model import LogisticRegression
            from sklearn.ensemble import RandomForestClassifier, GradientBoostingClassifier
            from sklearn.svm import SVC
            
            models = {
                'logistic_regression': LogisticRegression(**self.config['models']['logistic_regression']),
                'random_forest': RandomForestClassifier(**self.config['models']['random_forest']),
                'gradient_boosting': GradientBoostingClassifier(**self.config['models']['gradient_boosting']),
                'svm': SVC(**self.config['models']['svm'])
            }
        else:
            from sklearn.linear_model import LinearRegression
            from sklearn.ensemble import RandomForestRegressor, GradientBoostingRegressor
            from sklearn.svm import SVR
            
            models = {
                'linear_regression': LinearRegression(**self.config['models']['linear_regression']),
                'random_forest': RandomForestRegressor(**self.config['models']['random_forest']),
                'gradient_boosting': GradientBoostingRegressor(**self.config['models']['gradient_boosting']),
                'svr': SVR(**self.config['models']['svr'])
            }
        
        self.models = models
        logger.info(f"Created {len(models)} baseline models")
        
        return models
    
    def build_foundation(self, X: pd.DataFrame, y: pd.Series) -> Dict:
        """
        Main method to build the foundation pipeline
        
        Args:
            X: Feature dataframe
            y: Target variable
            
        Returns:
            Dictionary with results and performance metrics
        """
        logger.info("Starting Foundation Pipeline build...")
        start_time = datetime.now()
        
        # Step 1: Analyze data
        data_insights = self.analyze_data(X, y)
        
        # Step 2: Create preprocessor
        preprocessor = self.create_preprocessor(X)
        
        # Step 3: Split data
        X_train, X_test, y_train, y_test = train_test_split(
            X, y, 
            test_size=self.config['validation']['test_size'],
            random_state=self.config['validation']['random_state'],
            stratify=y if self.task_type == 'classification' else None
        )
        
        # Step 4: Fit preprocessor and transform data
        X_train_processed = preprocessor.fit_transform(X_train)
        X_test_processed = preprocessor.transform(X_test)
        
        # Step 5: Feature selection (if enabled)
        if self.config['preprocessing']['feature_selection']:
            selector = SelectKBest(
                f_classif if self.task_type == 'classification' else f_regression,
                k='all'
            )
            selector.fit(X_train_processed, y_train)
            
            # Determine optimal number of features
            scores = selector.scores_
            if self.config['preprocessing']['n_features'] == 'auto':
                # Keep features with scores above mean
                threshold = np.mean(scores)
                n_features = sum(scores > threshold)
            else:
                n_features = min(self.config['preprocessing']['n_features'], X_train_processed.shape[1])
            
            selector.set_params(k=n_features)
            X_train_processed = selector.fit_transform(X_train_processed, y_train)
            X_test_processed = selector.transform(X_test_processed)
            
            self.feature_selector = selector
            self.pipeline_components['feature_selector'] = selector
            
            logger.info(f"Selected {n_features} features out of {len(scores)}")
        
        # Step 6: Create and evaluate baseline models
        baseline_models = self.create_baseline_models()
        performance_results = {}
        
        for model_name, model in baseline_models.items():
            logger.info(f"Training {model_name}...")
            
            # Train model
            model.fit(X_train_processed, y_train)
            
            # Make predictions
            y_pred = model.predict(X_test_processed)
            
            # Calculate metrics
            if self.task_type == 'classification':
                accuracy = accuracy_score(y_test, y_pred)
                precision, recall, f1, _ = precision_recall_fscore_support(
                    y_test, y_pred, average='weighted'
                )
                
                metrics = {
                    'accuracy': float(accuracy),
                    'precision': float(precision),
                    'recall': float(recall),
                    'f1_score': float(f1)
                }
                
                # Add ROC-AUC for binary classification
                if len(np.unique(y)) == 2 and hasattr(model, 'predict_proba'):
                    y_proba = model.predict_proba(X_test_processed)[:, 1]
                    metrics['roc_auc'] = float(roc_auc_score(y_test, y_proba))
                    
            else:
                mse = mean_squared_error(y_test, y_pred)
                r2 = r2_score(y_test, y_pred)
                
                metrics = {
                    'mse': float(mse),
                    'rmse': float(np.sqrt(mse)),
                    'r2_score': float(r2)
                }
            
            # Cross-validation score
            cv_scores = cross_val_score(
                model, X_train_processed, y_train,
                cv=self.config['validation']['cv_folds']
            )
            metrics['cv_mean'] = float(cv_scores.mean())
            metrics['cv_std'] = float(cv_scores.std())
            
            performance_results[model_name] = metrics
            
            # Store in pipeline components
            self.pipeline_components[f'model_{model_name}'] = model
            
            logger.info(f"{model_name} - Performance: {metrics}")
        
        self.performance_metrics = performance_results
        
        # Step 7: Identify best baseline model
        if self.task_type == 'classification':
            best_model = max(performance_results.items(), 
                           key=lambda x: x[1]['f1_score'])[0]
        else:
            best_model = max(performance_results.items(), 
                           key=lambda x: x[1]['r2_score'])[0]
        
        # Step 8: Create final pipeline
        final_pipeline = Pipeline([
            ('preprocessor', preprocessor),
            ('model', baseline_models[best_model])
        ])
        
        if self.feature_selector:
            final_pipeline.steps.insert(1, ('feature_selector', self.feature_selector))
        
        self.pipeline_components['final_pipeline'] = final_pipeline
        
        # Step 9: Compile results
        results = {
            'data_insights': data_insights,
            'performance_metrics': performance_results,
            'best_baseline_model': best_model,
            'pipeline_components': list(self.pipeline_components.keys()),
            'execution_time': str(datetime.now() - start_time),
            'configuration': self.config
        }
        
        # Step 10: Save outputs
        if self.config['output']['save_pipeline']:
            self._save_outputs(results)
        
        logger.info(f"Foundation Pipeline completed. Best baseline: {best_model}")
        
        return results
    
    def _save_outputs(self, results: Dict):
        """Save pipeline components and results"""
        output_dir = Path(self.config['output']['output_dir'])
        output_dir.mkdir(parents=True, exist_ok=True)
        
        # Save pipeline components
        for component_name, component in self.pipeline_components.items():
            joblib.dump(component, output_dir / f'{component_name}.pkl')
        
        # Save results and insights
        with open(output_dir / 'foundation_results.json', 'w') as f:
            json.dump(results, f, indent=2)
        
        logger.info(f"Outputs saved to {output_dir}")
    
    def load_pipeline(self, path: str):
        """Load saved pipeline components"""
        path = Path(path)
        
        # Load final pipeline
        if (path / 'final_pipeline.pkl').exists():
            self.pipeline_components['final_pipeline'] = joblib.load(path / 'final_pipeline.pkl')
        
        # Load results
        if (path / 'foundation_results.json').exists():
            with open(path / 'foundation_results.json', 'r') as f:
                results = json.load(f)
                self.performance_metrics = results.get('performance_metrics', {})
                self.data_insights = results.get('data_insights', {})
        
        logger.info(f"Pipeline loaded from {path}")


def create_sample_dataset():
    """Create a sample dataset for demonstration"""
    from sklearn.datasets import make_classification
    
    X, y = make_classification(
        n_samples=1000,
        n_features=20,
        n_informative=15,
        n_redundant=5,
        n_classes=3,
        random_state=42
    )
    
    # Convert to DataFrame
    feature_names = [f'feature_{i}' for i in range(20)]
    X_df = pd.DataFrame(X, columns=feature_names)
    
    # Add some categorical features
    X_df['category_A'] = np.random.choice(['low', 'medium', 'high'], size=1000)
    X_df['category_B'] = np.random.choice(['alpha', 'beta', 'gamma', 'delta'], size=1000)
    
    # Add some missing values
    X_df.loc[np.random.choice(X_df.index, 50), 'feature_0'] = np.nan
    X_df.loc[np.random.choice(X_df.index, 30), 'category_A'] = np.nan
    
    return X_df, pd.Series(y, name='target')


if __name__ == "__main__":
    # Example usage
    logger.info("Running Foundation Pipeline example...")
    
    # Create sample data
    X, y = create_sample_dataset()
    
    # Initialize and run pipeline
    foundation = FoundationPipeline(task_type='classification')
    results = foundation.build_foundation(X, y)
    
    # Print results
    print("\n=== Foundation Pipeline Results ===")
    print(f"Best baseline model: {results['best_baseline_model']}")
    print("\nPerformance metrics:")
    for model, metrics in results['performance_metrics'].items():
        print(f"\n{model}:")
        for metric, value in metrics.items():
            print(f"  {metric}: {value:.4f}")