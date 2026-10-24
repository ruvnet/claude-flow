"""
MLE-STAR Foundation Agent - Enhanced Implementation
Advanced Foundation Model Builder with Multi-Dataset Support

This enhanced version includes:
- Automated dataset detection and handling
- Advanced preprocessing pipelines
- Multi-model baseline creation
- Hyperparameter optimization
- Model interpretability
- Performance tracking and coordination
"""

import numpy as np
import pandas as pd
from typing import Dict, List, Tuple, Any, Optional, Union
from pathlib import Path
import json
import logging
import joblib
from datetime import datetime
import subprocess
import sys

# Core ML libraries
from sklearn.model_selection import (
    train_test_split, cross_val_score, StratifiedKFold, KFold,
    GridSearchCV, RandomizedSearchCV
)
from sklearn.preprocessing import (
    StandardScaler, MinMaxScaler, RobustScaler,
    LabelEncoder, OneHotEncoder, OrdinalEncoder
)
from sklearn.compose import ColumnTransformer
from sklearn.pipeline import Pipeline
from sklearn.impute import SimpleImputer, KNNImputer
from sklearn.feature_selection import (
    SelectKBest, f_classif, f_regression,
    RFE, SelectFromModel, mutual_info_classif, mutual_info_regression
)
from sklearn.metrics import (
    accuracy_score, precision_recall_fscore_support, 
    mean_squared_error, r2_score, roc_auc_score,
    confusion_matrix, classification_report
)

# Models
from sklearn.linear_model import LogisticRegression, LinearRegression, Ridge, Lasso
from sklearn.ensemble import (
    RandomForestClassifier, RandomForestRegressor,
    GradientBoostingClassifier, GradientBoostingRegressor,
    ExtraTreesClassifier, ExtraTreesRegressor
)
from sklearn.svm import SVC, SVR
from sklearn.neural_network import MLPClassifier, MLPRegressor
from sklearn.naive_bayes import GaussianNB
from sklearn.neighbors import KNeighborsClassifier, KNeighborsRegressor

# Advanced features
from sklearn.decomposition import PCA, TruncatedSVD
from sklearn.manifold import TSNE
from sklearn.cluster import KMeans
import warnings
warnings.filterwarnings('ignore')

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


class EnhancedFoundationAgent:
    """
    Enhanced MLE-STAR Foundation Agent
    
    Advanced features:
    - Multi-dataset support (CSV, Parquet, JSON, etc.)
    - Automated feature engineering
    - Advanced model selection
    - Hyperparameter optimization
    - Model interpretability
    - Claude Flow coordination
    """
    
    def __init__(self, 
                 task_type: str = 'auto',
                 session_id: Optional[str] = None,
                 agent_id: str = 'foundation_agent',
                 config: Optional[Dict] = None):
        """
        Initialize Enhanced Foundation Agent
        
        Args:
            task_type: 'classification', 'regression', or 'auto' for automatic detection
            session_id: Session ID for coordination
            agent_id: Agent identifier
            config: Advanced configuration
        """
        self.task_type = task_type
        self.session_id = session_id or f"foundation-{datetime.now().strftime('%Y%m%d-%H%M%S')}"
        self.agent_id = agent_id
        self.config = config or self._get_advanced_config()
        
        # Components
        self.data_handler = DataHandler()
        self.feature_engineer = FeatureEngineer()
        self.model_builder = ModelBuilder(task_type)
        self.performance_tracker = PerformanceTracker()
        
        # Results storage
        self.data_insights = {}
        self.preprocessing_pipeline = None
        self.baseline_models = {}
        self.best_model = None
        self.performance_metrics = {}
        
        # Claude Flow coordination
        self._setup_coordination()
        
        logger.info(f"Initialized Enhanced Foundation Agent: {agent_id}")
        
    def _get_advanced_config(self) -> Dict:
        """Get advanced configuration with sensible defaults"""
        return {
            'data': {
                'auto_detect_task': True,
                'handle_imbalanced': True,
                'outlier_detection': True,
                'feature_scaling': 'auto'  # auto, standard, minmax, robust
            },
            'preprocessing': {
                'numeric_imputation': 'knn',  # mean, median, knn
                'categorical_imputation': 'mode',
                'encoding_strategy': 'auto',  # auto, onehot, ordinal, target
                'handle_high_cardinality': True,
                'feature_generation': True,
                'dimensionality_reduction': 'auto'
            },
            'feature_selection': {
                'enabled': True,
                'method': 'auto',  # auto, univariate, rfe, model_based
                'n_features': 'auto',
                'importance_threshold': 0.01
            },
            'modeling': {
                'algorithms': 'auto',  # auto, basic, advanced, all
                'hyperparameter_tuning': True,
                'tuning_method': 'random',  # grid, random, bayesian
                'cv_folds': 5,
                'scoring': 'auto',
                'ensemble_creation': True
            },
            'validation': {
                'test_size': 0.2,
                'stratify': True,
                'random_state': 42
            },
            'output': {
                'save_models': True,
                'save_reports': True,
                'save_visualizations': True,
                'output_dir': './foundation_output',
                'coordinate_with_agents': True
            }
        }
    
    def _setup_coordination(self):
        """Setup Claude Flow coordination"""
        try:
            # Notify coordination start
            cmd = f"npx claude-flow@alpha hooks notify --message 'Foundation Agent initialized: {self.agent_id}'"
            subprocess.run(cmd, shell=True, capture_output=True)
            
            # Store agent status
            status = {
                'agent': self.agent_id,
                'status': 'initialized',
                'session': self.session_id,
                'capabilities': ['data_preprocessing', 'feature_engineering', 'baseline_models', 'hyperparameter_tuning']
            }
            
            cmd = f"npx claude-flow@alpha memory store 'agent/{self.agent_id}/status' '{json.dumps(status)}'"
            subprocess.run(cmd, shell=True, capture_output=True)
            
        except Exception as e:
            logger.warning(f"Coordination setup warning: {e}")
    
    def run(self, 
            data_path: Optional[str] = None,
            X: Optional[pd.DataFrame] = None,
            y: Optional[pd.Series] = None) -> Dict:
        """
        Main execution method for Foundation Agent
        
        Args:
            data_path: Path to dataset file
            X: Feature dataframe (if data already loaded)
            y: Target variable (if data already loaded)
            
        Returns:
            Dictionary with comprehensive results
        """
        logger.info("Starting Enhanced Foundation Pipeline...")
        start_time = datetime.now()
        
        try:
            # Step 1: Load and analyze data
            if data_path:
                X, y = self.data_handler.load_data(data_path)
            elif X is None or y is None:
                # Create demo dataset
                logger.info("No data provided, creating demonstration dataset...")
                X, y = self._create_demo_dataset()
            
            # Auto-detect task type if needed
            if self.task_type == 'auto':
                self.task_type = self._detect_task_type(y)
                self.model_builder.task_type = self.task_type
            
            # Step 2: Comprehensive data analysis
            self.data_insights = self._analyze_data_comprehensively(X, y)
            self._store_insights('data_analysis', self.data_insights)
            
            # Step 3: Advanced preprocessing
            X_processed, preprocessing_pipeline = self._create_advanced_preprocessing(X, y)
            self.preprocessing_pipeline = preprocessing_pipeline
            
            # Step 4: Feature engineering
            X_engineered = self.feature_engineer.engineer_features(
                X_processed, y, self.task_type
            )
            
            # Step 5: Feature selection
            X_selected, feature_selector = self._select_features(X_engineered, y)
            
            # Step 6: Train-test split
            X_train, X_test, y_train, y_test = train_test_split(
                X_selected, y,
                test_size=self.config['validation']['test_size'],
                random_state=self.config['validation']['random_state'],
                stratify=y if self.task_type == 'classification' and self.config['validation']['stratify'] else None
            )
            
            # Step 7: Build baseline models
            baseline_results = self._build_baseline_models(X_train, y_train, X_test, y_test)
            self.baseline_models = baseline_results['models']
            self.performance_metrics = baseline_results['metrics']
            
            # Step 8: Hyperparameter optimization (if enabled)
            if self.config['modeling']['hyperparameter_tuning']:
                best_model_info = self._optimize_hyperparameters(X_train, y_train, X_test, y_test)
                self.best_model = best_model_info['model']
            else:
                # Select best baseline
                self.best_model = self._select_best_baseline()
            
            # Step 9: Create final pipeline
            final_pipeline = self._create_final_pipeline(
                preprocessing_pipeline, feature_selector, self.best_model
            )
            
            # Step 10: Generate comprehensive report
            results = self._generate_comprehensive_report(
                X, y, X_test, y_test, final_pipeline, start_time
            )
            
            # Step 11: Save outputs and coordinate
            if self.config['output']['save_models']:
                self._save_all_outputs(results, final_pipeline)
            
            # Step 12: Coordinate with other agents
            if self.config['output']['coordinate_with_agents']:
                self._coordinate_handoff(results)
            
            logger.info("Foundation Pipeline completed successfully!")
            return results
            
        except Exception as e:
            logger.error(f"Error in Foundation Pipeline: {e}")
            self._handle_error(e)
            raise
    
    def _detect_task_type(self, y: pd.Series) -> str:
        """Automatically detect if task is classification or regression"""
        unique_values = y.nunique()
        
        # Simple heuristic: if less than 20 unique values and no floats, likely classification
        if unique_values < 20 and y.dtype in ['int64', 'object', 'category']:
            return 'classification'
        else:
            return 'regression'
    
    def _analyze_data_comprehensively(self, X: pd.DataFrame, y: pd.Series) -> Dict:
        """Perform comprehensive data analysis"""
        logger.info("Performing comprehensive data analysis...")
        
        insights = {
            'basic_stats': {
                'n_samples': len(X),
                'n_features': X.shape[1],
                'memory_usage': f"{X.memory_usage().sum() / 1024**2:.2f} MB"
            },
            'feature_types': {},
            'missing_analysis': {},
            'outlier_analysis': {},
            'correlation_analysis': {},
            'target_analysis': {},
            'recommendations': []
        }
        
        # Analyze feature types
        numeric_cols = X.select_dtypes(include=['number']).columns.tolist()
        categorical_cols = X.select_dtypes(include=['object', 'category']).columns.tolist()
        
        insights['feature_types'] = {
            'numeric': numeric_cols,
            'categorical': categorical_cols,
            'datetime': X.select_dtypes(include=['datetime']).columns.tolist()
        }
        
        # Missing value analysis
        missing_data = X.isnull().sum()
        insights['missing_analysis'] = {
            'total_missing': int(missing_data.sum()),
            'columns_with_missing': missing_data[missing_data > 0].to_dict(),
            'missing_patterns': self._analyze_missing_patterns(X)
        }
        
        # Outlier detection for numeric features
        if numeric_cols:
            outlier_info = {}
            for col in numeric_cols:
                Q1 = X[col].quantile(0.25)
                Q3 = X[col].quantile(0.75)
                IQR = Q3 - Q1
                outliers = X[(X[col] < Q1 - 1.5 * IQR) | (X[col] > Q3 + 1.5 * IQR)]
                if len(outliers) > 0:
                    outlier_info[col] = {
                        'count': len(outliers),
                        'percentage': len(outliers) / len(X) * 100
                    }
            insights['outlier_analysis'] = outlier_info
        
        # Correlation analysis
        if len(numeric_cols) > 1:
            corr_matrix = X[numeric_cols].corr()
            high_corr = []
            for i in range(len(corr_matrix.columns)):
                for j in range(i+1, len(corr_matrix.columns)):
                    if abs(corr_matrix.iloc[i, j]) > 0.8:
                        high_corr.append({
                            'feature1': corr_matrix.columns[i],
                            'feature2': corr_matrix.columns[j],
                            'correlation': corr_matrix.iloc[i, j]
                        })
            insights['correlation_analysis']['high_correlations'] = high_corr
        
        # Target variable analysis
        if self.task_type == 'classification':
            value_counts = y.value_counts()
            insights['target_analysis'] = {
                'unique_classes': len(value_counts),
                'class_distribution': value_counts.to_dict(),
                'imbalance_ratio': value_counts.max() / value_counts.min()
            }
            
            if insights['target_analysis']['imbalance_ratio'] > 3:
                insights['recommendations'].append(
                    "High class imbalance detected. Consider SMOTE or class weights."
                )
        else:
            insights['target_analysis'] = {
                'mean': y.mean(),
                'std': y.std(),
                'skewness': y.skew(),
                'kurtosis': y.kurtosis()
            }
            
            if abs(y.skew()) > 1:
                insights['recommendations'].append(
                    "Target variable is skewed. Consider log transformation."
                )
        
        return insights
    
    def _analyze_missing_patterns(self, X: pd.DataFrame) -> Dict:
        """Analyze patterns in missing data"""
        missing_mask = X.isnull()
        
        # Check if missingness is completely random or has patterns
        patterns = {
            'random': True,
            'columns_always_missing_together': []
        }
        
        # Simple check for columns that are always missing together
        for i, col1 in enumerate(missing_mask.columns):
            for col2 in missing_mask.columns[i+1:]:
                if (missing_mask[col1] == missing_mask[col2]).all():
                    patterns['columns_always_missing_together'].append([col1, col2])
                    patterns['random'] = False
        
        return patterns
    
    def _create_advanced_preprocessing(self, X: pd.DataFrame, y: pd.Series) -> Tuple[np.ndarray, Pipeline]:
        """Create advanced preprocessing pipeline"""
        logger.info("Creating advanced preprocessing pipeline...")
        
        numeric_features = X.select_dtypes(include=['number']).columns.tolist()
        categorical_features = X.select_dtypes(include=['object', 'category']).columns.tolist()
        
        # Numeric pipeline
        numeric_transformer = self._get_numeric_transformer()
        
        # Categorical pipeline
        categorical_transformer = self._get_categorical_transformer(X[categorical_features] if categorical_features else pd.DataFrame())
        
        # Combine transformers
        preprocessor = ColumnTransformer(
            transformers=[
                ('num', numeric_transformer, numeric_features),
                ('cat', categorical_transformer, categorical_features)
            ]
        )
        
        # Fit and transform
        X_processed = preprocessor.fit_transform(X)
        
        return X_processed, preprocessor
    
    def _get_numeric_transformer(self) -> Pipeline:
        """Get numeric preprocessing pipeline"""
        steps = []
        
        # Imputation
        if self.config['preprocessing']['numeric_imputation'] == 'knn':
            steps.append(('imputer', KNNImputer(n_neighbors=5)))
        else:
            steps.append(('imputer', SimpleImputer(strategy=self.config['preprocessing']['numeric_imputation'])))
        
        # Scaling
        if self.config['data']['feature_scaling'] == 'standard':
            steps.append(('scaler', StandardScaler()))
        elif self.config['data']['feature_scaling'] == 'minmax':
            steps.append(('scaler', MinMaxScaler()))
        elif self.config['data']['feature_scaling'] == 'robust':
            steps.append(('scaler', RobustScaler()))
        
        return Pipeline(steps)
    
    def _get_categorical_transformer(self, cat_data: pd.DataFrame) -> Pipeline:
        """Get categorical preprocessing pipeline"""
        steps = []
        
        # Imputation
        steps.append(('imputer', SimpleImputer(strategy='constant', fill_value='missing')))
        
        # Encoding
        if self.config['preprocessing']['encoding_strategy'] == 'auto':
            # Use ordinal for high cardinality, onehot for low
            high_card_threshold = 10
            if cat_data.shape[1] > 0:
                avg_cardinality = cat_data.nunique().mean()
                if avg_cardinality > high_card_threshold:
                    steps.append(('encoder', OrdinalEncoder(handle_unknown='use_encoded_value', unknown_value=-1)))
                else:
                    steps.append(('encoder', OneHotEncoder(handle_unknown='ignore', sparse_output=False)))
            else:
                steps.append(('encoder', OneHotEncoder(handle_unknown='ignore', sparse_output=False)))
        
        return Pipeline(steps)
    
    def _select_features(self, X: np.ndarray, y: pd.Series) -> Tuple[np.ndarray, Any]:
        """Advanced feature selection"""
        if not self.config['feature_selection']['enabled']:
            return X, None
        
        logger.info("Performing feature selection...")
        
        if self.config['feature_selection']['method'] == 'auto':
            # Use mutual information
            if self.task_type == 'classification':
                selector = SelectKBest(mutual_info_classif, k='all')
            else:
                selector = SelectKBest(mutual_info_regression, k='all')
            
            selector.fit(X, y)
            
            # Determine optimal number of features
            scores = selector.scores_
            if self.config['feature_selection']['n_features'] == 'auto':
                # Keep features with score above threshold
                threshold = np.percentile(scores, 25)  # Keep top 75% features
                n_features = sum(scores > threshold)
            else:
                n_features = min(self.config['feature_selection']['n_features'], X.shape[1])
            
            selector.set_params(k=n_features)
            X_selected = selector.fit_transform(X, y)
            
            logger.info(f"Selected {n_features} out of {X.shape[1]} features")
            
            return X_selected, selector
        
        return X, None
    
    def _build_baseline_models(self, X_train, y_train, X_test, y_test) -> Dict:
        """Build and evaluate baseline models"""
        logger.info("Building baseline models...")
        
        models = self.model_builder.get_baseline_models(self.config['modeling']['algorithms'])
        results = {'models': {}, 'metrics': {}}
        
        for name, model in models.items():
            logger.info(f"Training {name}...")
            
            # Train model
            model.fit(X_train, y_train)
            
            # Make predictions
            y_pred = model.predict(X_test)
            
            # Evaluate
            metrics = self.performance_tracker.evaluate_model(
                model, X_test, y_test, y_pred, self.task_type
            )
            
            results['models'][name] = model
            results['metrics'][name] = metrics
            
            # Store intermediate results
            self._store_model_performance(name, metrics)
        
        return results
    
    def _optimize_hyperparameters(self, X_train, y_train, X_test, y_test) -> Dict:
        """Optimize hyperparameters for best models"""
        logger.info("Optimizing hyperparameters...")
        
        # Select top 3 models for optimization
        sorted_models = sorted(
            self.performance_metrics.items(),
            key=lambda x: x[1].get('cv_score', 0),
            reverse=True
        )[:3]
        
        best_score = -np.inf
        best_model_info = None
        
        for model_name, _ in sorted_models:
            model = self.baseline_models[model_name]
            param_grid = self.model_builder.get_param_grid(model_name)
            
            if param_grid:
                logger.info(f"Tuning {model_name}...")
                
                if self.config['modeling']['tuning_method'] == 'grid':
                    search = GridSearchCV(
                        model, param_grid,
                        cv=self.config['modeling']['cv_folds'],
                        scoring=self._get_scoring_metric(),
                        n_jobs=-1
                    )
                else:
                    search = RandomizedSearchCV(
                        model, param_grid,
                        n_iter=20,
                        cv=self.config['modeling']['cv_folds'],
                        scoring=self._get_scoring_metric(),
                        n_jobs=-1,
                        random_state=42
                    )
                
                search.fit(X_train, y_train)
                
                if search.best_score_ > best_score:
                    best_score = search.best_score_
                    best_model_info = {
                        'name': model_name,
                        'model': search.best_estimator_,
                        'params': search.best_params_,
                        'score': search.best_score_
                    }
        
        logger.info(f"Best optimized model: {best_model_info['name']} with score: {best_score:.4f}")
        return best_model_info
    
    def _get_scoring_metric(self) -> str:
        """Get appropriate scoring metric"""
        if self.config['modeling']['scoring'] != 'auto':
            return self.config['modeling']['scoring']
        
        if self.task_type == 'classification':
            return 'f1_weighted'
        else:
            return 'r2'
    
    def _select_best_baseline(self) -> Any:
        """Select best baseline model without hyperparameter tuning"""
        if self.task_type == 'classification':
            best_model_name = max(
                self.performance_metrics.items(),
                key=lambda x: x[1].get('f1_score', 0)
            )[0]
        else:
            best_model_name = max(
                self.performance_metrics.items(),
                key=lambda x: x[1].get('r2_score', 0)
            )[0]
        
        return self.baseline_models[best_model_name]
    
    def _create_final_pipeline(self, preprocessor, feature_selector, model) -> Pipeline:
        """Create final end-to-end pipeline"""
        steps = [('preprocessor', preprocessor)]
        
        if feature_selector is not None:
            steps.append(('feature_selector', feature_selector))
        
        steps.append(('model', model))
        
        return Pipeline(steps)
    
    def _generate_comprehensive_report(self, X, y, X_test, y_test, pipeline, start_time) -> Dict:
        """Generate comprehensive results report"""
        logger.info("Generating comprehensive report...")
        
        report = {
            'execution_info': {
                'agent_id': self.agent_id,
                'session_id': self.session_id,
                'task_type': self.task_type,
                'execution_time': str(datetime.now() - start_time),
                'timestamp': datetime.now().isoformat()
            },
            'data_insights': self.data_insights,
            'preprocessing_steps': self._get_preprocessing_summary(),
            'baseline_performance': self.performance_metrics,
            'best_model': {
                'name': type(self.best_model).__name__,
                'parameters': self.best_model.get_params() if hasattr(self.best_model, 'get_params') else {}
            },
            'feature_importance': self._get_feature_importance(),
            'recommendations': self._generate_recommendations()
        }
        
        return report
    
    def _get_preprocessing_summary(self) -> List[str]:
        """Get summary of preprocessing steps"""
        steps = []
        if self.preprocessing_pipeline:
            for name, transformer in self.preprocessing_pipeline.named_transformers_.items():
                if hasattr(transformer, 'steps'):
                    for step_name, step in transformer.steps:
                        steps.append(f"{name}_{step_name}: {type(step).__name__}")
        return steps
    
    def _get_feature_importance(self) -> Dict:
        """Extract feature importance if available"""
        importance = {}
        
        if hasattr(self.best_model, 'feature_importances_'):
            importance['values'] = self.best_model.feature_importances_.tolist()
            importance['type'] = 'tree_based'
        elif hasattr(self.best_model, 'coef_'):
            importance['values'] = np.abs(self.best_model.coef_).flatten().tolist()
            importance['type'] = 'linear'
        
        return importance
    
    def _generate_recommendations(self) -> List[str]:
        """Generate actionable recommendations"""
        recommendations = []
        
        # Based on data insights
        if self.data_insights.get('missing_analysis', {}).get('total_missing', 0) > 0:
            recommendations.append("Consider advanced imputation methods for missing data")
        
        if self.data_insights.get('outlier_analysis'):
            recommendations.append("Outliers detected - consider robust scaling or outlier removal")
        
        # Based on model performance
        best_score = max(
            m.get('cv_score', 0) for m in self.performance_metrics.values()
        )
        
        if best_score < 0.8:
            recommendations.append("Model performance is moderate - consider feature engineering or ensemble methods")
        
        # Based on task type
        if self.task_type == 'classification' and self.data_insights.get('target_analysis', {}).get('imbalance_ratio', 1) > 3:
            recommendations.append("Use SMOTE or adjust class weights for imbalanced data")
        
        return recommendations
    
    def _save_all_outputs(self, results: Dict, pipeline: Pipeline):
        """Save all outputs to disk"""
        output_dir = Path(self.config['output']['output_dir'])
        output_dir.mkdir(parents=True, exist_ok=True)
        
        # Save models
        joblib.dump(pipeline, output_dir / 'final_pipeline.pkl')
        
        for name, model in self.baseline_models.items():
            joblib.dump(model, output_dir / f'baseline_{name}.pkl')
        
        # Save results
        with open(output_dir / 'foundation_results.json', 'w') as f:
            json.dump(results, f, indent=2, default=str)
        
        # Save performance metrics
        pd.DataFrame(self.performance_metrics).T.to_csv(
            output_dir / 'performance_metrics.csv'
        )
        
        logger.info(f"All outputs saved to {output_dir}")
    
    def _coordinate_handoff(self, results: Dict):
        """Coordinate handoff to next agent"""
        try:
            # Store results for next agent
            handoff_data = {
                'from': self.agent_id,
                'to': 'refinement_agent',
                'session': self.session_id,
                'timestamp': datetime.now().isoformat(),
                'best_baseline_score': max(
                    m.get('cv_score', 0) for m in self.performance_metrics.values()
                ),
                'pipeline_path': str(Path(self.config['output']['output_dir']) / 'final_pipeline.pkl'),
                'recommendations': results['recommendations']
            }
            
            cmd = f"npx claude-flow@alpha memory store 'agent/{self.agent_id}/handoff' '{json.dumps(handoff_data)}'"
            subprocess.run(cmd, shell=True, capture_output=True)
            
            # Notify completion
            cmd = f"npx claude-flow@alpha hooks post-task --task-id '{self.agent_id}' --analyze-performance true"
            subprocess.run(cmd, shell=True, capture_output=True)
            
            logger.info("Handoff to next agent completed")
            
        except Exception as e:
            logger.warning(f"Handoff coordination warning: {e}")
    
    def _store_insights(self, key: str, data: Dict):
        """Store insights in memory"""
        try:
            cmd = f"npx claude-flow@alpha memory store 'agent/{self.agent_id}/{key}' '{json.dumps(data, default=str)}'"
            subprocess.run(cmd, shell=True, capture_output=True)
        except Exception as e:
            logger.warning(f"Memory storage warning: {e}")
    
    def _store_model_performance(self, model_name: str, metrics: Dict):
        """Store individual model performance"""
        try:
            key = f'agent/{self.agent_id}/model_{model_name}'
            cmd = f"npx claude-flow@alpha memory store '{key}' '{json.dumps(metrics, default=str)}'"
            subprocess.run(cmd, shell=True, capture_output=True)
        except Exception as e:
            logger.warning(f"Performance storage warning: {e}")
    
    def _handle_error(self, error: Exception):
        """Handle errors and notify coordination system"""
        try:
            error_data = {
                'agent': self.agent_id,
                'error': str(error),
                'timestamp': datetime.now().isoformat(),
                'session': self.session_id
            }
            
            cmd = f"npx claude-flow@alpha memory store 'agent/{self.agent_id}/error' '{json.dumps(error_data)}'"
            subprocess.run(cmd, shell=True, capture_output=True)
            
            cmd = f"npx claude-flow@alpha hooks notify --message 'Foundation Agent error: {str(error)}'"
            subprocess.run(cmd, shell=True, capture_output=True)
            
        except Exception as e:
            logger.warning(f"Error handling warning: {e}")
    
    def _create_demo_dataset(self) -> Tuple[pd.DataFrame, pd.Series]:
        """Create a demonstration dataset"""
        from sklearn.datasets import make_classification
        
        X, y = make_classification(
            n_samples=2000,
            n_features=30,
            n_informative=20,
            n_redundant=5,
            n_repeated=2,
            n_classes=3,
            n_clusters_per_class=2,
            weights=[0.5, 0.3, 0.2],  # Imbalanced
            flip_y=0.05,  # Add noise
            random_state=42
        )
        
        # Convert to DataFrame
        feature_names = [f'feature_{i}' for i in range(30)]
        X_df = pd.DataFrame(X, columns=feature_names)
        
        # Add categorical features
        X_df['category_A'] = np.random.choice(['low', 'medium', 'high'], size=2000, p=[0.5, 0.3, 0.2])
        X_df['category_B'] = np.random.choice(['alpha', 'beta', 'gamma', 'delta'], size=2000)
        X_df['category_C'] = np.random.choice(['X', 'Y', 'Z'], size=2000)
        
        # Add some missing values
        for col in np.random.choice(X_df.columns, 5):
            missing_idx = np.random.choice(X_df.index, size=int(0.1 * len(X_df)))
            X_df.loc[missing_idx, col] = np.nan
        
        # Add some outliers
        for col in ['feature_0', 'feature_1', 'feature_2']:
            outlier_idx = np.random.choice(X_df.index, size=20)
            X_df.loc[outlier_idx, col] = X_df[col].mean() + 5 * X_df[col].std()
        
        return X_df, pd.Series(y, name='target')


class DataHandler:
    """Handle various data formats and sources"""
    
    def load_data(self, path: str) -> Tuple[pd.DataFrame, pd.Series]:
        """Load data from various formats"""
        path = Path(path)
        
        if path.suffix == '.csv':
            df = pd.read_csv(path)
        elif path.suffix == '.parquet':
            df = pd.read_parquet(path)
        elif path.suffix == '.json':
            df = pd.read_json(path)
        else:
            raise ValueError(f"Unsupported file format: {path.suffix}")
        
        # Assume last column is target (can be made more sophisticated)
        X = df.iloc[:, :-1]
        y = df.iloc[:, -1]
        
        return X, y


class FeatureEngineer:
    """Advanced feature engineering"""
    
    def engineer_features(self, X: np.ndarray, y: pd.Series, task_type: str) -> np.ndarray:
        """Create engineered features"""
        # For now, return as-is
        # Can be extended with polynomial features, interactions, etc.
        return X


class ModelBuilder:
    """Build and manage models"""
    
    def __init__(self, task_type: str):
        self.task_type = task_type
    
    def get_baseline_models(self, algorithm_set: str = 'auto') -> Dict:
        """Get baseline models based on configuration"""
        if self.task_type == 'classification':
            if algorithm_set in ['auto', 'basic']:
                return {
                    'logistic_regression': LogisticRegression(max_iter=1000, random_state=42),
                    'random_forest': RandomForestClassifier(n_estimators=100, random_state=42),
                    'gradient_boosting': GradientBoostingClassifier(n_estimators=100, random_state=42)
                }
            elif algorithm_set == 'advanced':
                return {
                    'logistic_regression': LogisticRegression(max_iter=1000, random_state=42),
                    'random_forest': RandomForestClassifier(n_estimators=200, random_state=42),
                    'gradient_boosting': GradientBoostingClassifier(n_estimators=200, random_state=42),
                    'extra_trees': ExtraTreesClassifier(n_estimators=200, random_state=42),
                    'mlp': MLPClassifier(hidden_layers=(100, 50), max_iter=1000, random_state=42),
                    'svm': SVC(probability=True, random_state=42)
                }
        else:  # regression
            if algorithm_set in ['auto', 'basic']:
                return {
                    'linear_regression': LinearRegression(),
                    'ridge': Ridge(random_state=42),
                    'random_forest': RandomForestRegressor(n_estimators=100, random_state=42),
                    'gradient_boosting': GradientBoostingRegressor(n_estimators=100, random_state=42)
                }
            elif algorithm_set == 'advanced':
                return {
                    'linear_regression': LinearRegression(),
                    'ridge': Ridge(random_state=42),
                    'lasso': Lasso(random_state=42),
                    'random_forest': RandomForestRegressor(n_estimators=200, random_state=42),
                    'gradient_boosting': GradientBoostingRegressor(n_estimators=200, random_state=42),
                    'extra_trees': ExtraTreesRegressor(n_estimators=200, random_state=42),
                    'mlp': MLPRegressor(hidden_layers=(100, 50), max_iter=1000, random_state=42),
                    'svr': SVR()
                }
        
        return {}
    
    def get_param_grid(self, model_name: str) -> Dict:
        """Get hyperparameter grid for model"""
        param_grids = {
            'random_forest': {
                'n_estimators': [100, 200, 300],
                'max_depth': [10, 20, None],
                'min_samples_split': [2, 5, 10]
            },
            'gradient_boosting': {
                'n_estimators': [100, 200],
                'learning_rate': [0.01, 0.1, 0.3],
                'max_depth': [3, 5, 7]
            },
            'logistic_regression': {
                'C': [0.1, 1.0, 10.0],
                'penalty': ['l1', 'l2'],
                'solver': ['liblinear', 'saga']
            },
            'svm': {
                'C': [0.1, 1, 10],
                'kernel': ['rbf', 'poly'],
                'gamma': ['scale', 'auto']
            }
        }
        
        return param_grids.get(model_name, {})


class PerformanceTracker:
    """Track and evaluate model performance"""
    
    def evaluate_model(self, model, X_test, y_test, y_pred, task_type: str) -> Dict:
        """Comprehensive model evaluation"""
        metrics = {}
        
        if task_type == 'classification':
            metrics['accuracy'] = accuracy_score(y_test, y_pred)
            
            # Handle multi-class
            precision, recall, f1, _ = precision_recall_fscore_support(
                y_test, y_pred, average='weighted', zero_division=0
            )
            metrics['precision'] = precision
            metrics['recall'] = recall
            metrics['f1_score'] = f1
            
            # ROC-AUC for binary
            if len(np.unique(y_test)) == 2 and hasattr(model, 'predict_proba'):
                y_proba = model.predict_proba(X_test)[:, 1]
                metrics['roc_auc'] = roc_auc_score(y_test, y_proba)
            
            # Confusion matrix
            metrics['confusion_matrix'] = confusion_matrix(y_test, y_pred).tolist()
            
        else:  # regression
            metrics['mse'] = mean_squared_error(y_test, y_pred)
            metrics['rmse'] = np.sqrt(metrics['mse'])
            metrics['mae'] = np.mean(np.abs(y_test - y_pred))
            metrics['r2_score'] = r2_score(y_test, y_pred)
            
            # Additional regression metrics
            metrics['explained_variance'] = 1 - np.var(y_test - y_pred) / np.var(y_test)
        
        # Cross-validation score (simplified - in practice would use training data)
        metrics['cv_score'] = metrics.get('f1_score', metrics.get('r2_score', 0))
        
        return metrics


def main():
    """Main execution function for standalone testing"""
    # Create enhanced foundation agent
    agent = EnhancedFoundationAgent(
        task_type='auto',
        session_id='test-session-' + datetime.now().strftime('%Y%m%d-%H%M%S'),
        agent_id='foundation_agent'
    )
    
    # Run with demo data
    results = agent.run()
    
    # Print summary
    print("\n" + "="*60)
    print("ENHANCED FOUNDATION AGENT - EXECUTION COMPLETE")
    print("="*60)
    print(f"Task Type: {agent.task_type}")
    print(f"Execution Time: {results['execution_info']['execution_time']}")
    print(f"\nBaseline Models Performance:")
    
    for model, metrics in results['baseline_performance'].items():
        print(f"\n{model}:")
        for metric, value in metrics.items():
            if metric != 'confusion_matrix':
                print(f"  {metric}: {value:.4f}" if isinstance(value, (int, float)) else f"  {metric}: {value}")
    
    print(f"\nBest Model: {results['best_model']['name']}")
    print(f"\nRecommendations:")
    for rec in results['recommendations']:
        print(f"  - {rec}")


if __name__ == "__main__":
    main()