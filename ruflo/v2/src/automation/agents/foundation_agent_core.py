#!/usr/bin/env python3
"""
Foundation Model Builder for MLE-STAR Automation
==============================================
This module implements the Foundation phase of the MLE-STAR methodology,
focusing on data preprocessing, initial modeling, and baseline creation.
"""

import numpy as np
import pandas as pd
import json
import os
from datetime import datetime
from pathlib import Path
from typing import Dict, List, Tuple, Any, Optional
from dataclasses import dataclass, asdict
import joblib

# ML Libraries
from sklearn.model_selection import train_test_split, cross_val_score, KFold
from sklearn.preprocessing import StandardScaler, LabelEncoder, OneHotEncoder
from sklearn.impute import SimpleImputer
from sklearn.feature_selection import SelectKBest, chi2, f_classif, mutual_info_classif
from sklearn.compose import ColumnTransformer
from sklearn.pipeline import Pipeline

# Baseline Models
from sklearn.linear_model import LogisticRegression, LinearRegression, Ridge, Lasso
from sklearn.tree import DecisionTreeClassifier, DecisionTreeRegressor
from sklearn.ensemble import RandomForestClassifier, RandomForestRegressor
from sklearn.svm import SVC, SVR
from sklearn.neighbors import KNeighborsClassifier, KNeighborsRegressor
from sklearn.naive_bayes import GaussianNB
from sklearn.neural_network import MLPClassifier, MLPRegressor

# Metrics
from sklearn.metrics import (
    accuracy_score, precision_score, recall_score, f1_score,
    mean_squared_error, r2_score, mean_absolute_error,
    classification_report, confusion_matrix
)

import warnings
warnings.filterwarnings('ignore')


@dataclass
class ModelResult:
    """Container for model training results"""
    model_name: str
    model_type: str
    cv_scores: List[float]
    mean_cv_score: float
    std_cv_score: float
    training_time: float
    parameters: Dict[str, Any]
    feature_importance: Optional[Dict[str, float]] = None


class FoundationModelBuilder:
    """
    Foundation Model Builder for MLE-STAR Automation
    
    Handles:
    - Data preprocessing and feature engineering
    - Baseline model creation and evaluation
    - Performance benchmarking
    - Model persistence and versioning
    """
    
    def __init__(self, session_id: str, execution_id: str):
        self.session_id = session_id
        self.execution_id = execution_id
        self.models_dir = Path(f"models/foundation_{session_id}")
        self.models_dir.mkdir(parents=True, exist_ok=True)
        
        self.preprocessing_pipeline = None
        self.feature_names = None
        self.target_name = None
        self.problem_type = None  # 'classification' or 'regression'
        self.baseline_results = []
        
    def analyze_dataset(self, data: pd.DataFrame, target_column: str) -> Dict[str, Any]:
        """Analyze dataset characteristics"""
        analysis = {
            "shape": data.shape,
            "columns": list(data.columns),
            "dtypes": data.dtypes.to_dict(),
            "missing_values": data.isnull().sum().to_dict(),
            "target_distribution": None,
            "problem_type": None,
            "recommendations": []
        }
        
        # Analyze target variable
        if target_column in data.columns:
            target_data = data[target_column]
            unique_values = target_data.nunique()
            
            if unique_values <= 20:  # Likely classification
                self.problem_type = "classification"
                analysis["problem_type"] = "classification"
                analysis["target_distribution"] = target_data.value_counts().to_dict()
            else:  # Likely regression
                self.problem_type = "regression"
                analysis["problem_type"] = "regression"
                analysis["target_distribution"] = {
                    "mean": float(target_data.mean()),
                    "std": float(target_data.std()),
                    "min": float(target_data.min()),
                    "max": float(target_data.max())
                }
        
        # Generate recommendations
        if data.isnull().any().any():
            analysis["recommendations"].append("Handle missing values")
        
        numeric_cols = data.select_dtypes(include=[np.number]).columns
        if len(numeric_cols) > 0:
            analysis["recommendations"].append("Scale numeric features")
            
        categorical_cols = data.select_dtypes(include=['object']).columns
        if len(categorical_cols) > 0:
            analysis["recommendations"].append("Encode categorical features")
        
        return analysis
    
    def create_preprocessing_pipeline(self, X: pd.DataFrame) -> Pipeline:
        """Create preprocessing pipeline based on data types"""
        numeric_features = X.select_dtypes(include=[np.number]).columns.tolist()
        categorical_features = X.select_dtypes(include=['object']).columns.tolist()
        
        # Numeric preprocessing
        numeric_transformer = Pipeline(steps=[
            ('imputer', SimpleImputer(strategy='median')),
            ('scaler', StandardScaler())
        ])
        
        # Categorical preprocessing
        categorical_transformer = Pipeline(steps=[
            ('imputer', SimpleImputer(strategy='constant', fill_value='missing')),
            ('onehot', OneHotEncoder(handle_unknown='ignore'))
        ])
        
        # Combine preprocessing steps
        preprocessor = ColumnTransformer(
            transformers=[
                ('num', numeric_transformer, numeric_features),
                ('cat', categorical_transformer, categorical_features)
            ])
        
        self.preprocessing_pipeline = preprocessor
        self.feature_names = numeric_features + categorical_features
        
        return preprocessor
    
    def get_baseline_models(self) -> Dict[str, Any]:
        """Get baseline models based on problem type"""
        if self.problem_type == "classification":
            return {
                "LogisticRegression": LogisticRegression(random_state=42, max_iter=1000),
                "DecisionTree": DecisionTreeClassifier(random_state=42),
                "RandomForest": RandomForestClassifier(n_estimators=100, random_state=42),
                "SVM": SVC(random_state=42, probability=True),
                "KNN": KNeighborsClassifier(),
                "NaiveBayes": GaussianNB(),
                "NeuralNetwork": MLPClassifier(hidden_layers=(100,), random_state=42, max_iter=1000)
            }
        else:  # regression
            return {
                "LinearRegression": LinearRegression(),
                "Ridge": Ridge(random_state=42),
                "Lasso": Lasso(random_state=42),
                "DecisionTree": DecisionTreeRegressor(random_state=42),
                "RandomForest": RandomForestRegressor(n_estimators=100, random_state=42),
                "SVR": SVR(),
                "KNN": KNeighborsRegressor(),
                "NeuralNetwork": MLPRegressor(hidden_layers=(100,), random_state=42, max_iter=1000)
            }
    
    def train_baseline_models(self, X: pd.DataFrame, y: pd.Series, cv_folds: int = 5) -> List[ModelResult]:
        """Train all baseline models with cross-validation"""
        import time
        
        # Create preprocessing pipeline if not exists
        if self.preprocessing_pipeline is None:
            self.create_preprocessing_pipeline(X)
        
        # Get baseline models
        models = self.get_baseline_models()
        results = []
        
        # Define scoring metric
        scoring = 'accuracy' if self.problem_type == 'classification' else 'neg_mean_squared_error'
        
        # Cross-validation setup
        kfold = KFold(n_splits=cv_folds, shuffle=True, random_state=42)
        
        for model_name, model in models.items():
            print(f"\nTraining {model_name}...")
            start_time = time.time()
            
            # Create full pipeline
            pipeline = Pipeline(steps=[
                ('preprocessor', self.preprocessing_pipeline),
                ('model', model)
            ])
            
            try:
                # Cross-validation
                cv_scores = cross_val_score(pipeline, X, y, cv=kfold, scoring=scoring)
                
                # Convert negative MSE to positive for regression
                if self.problem_type == 'regression' and scoring == 'neg_mean_squared_error':
                    cv_scores = -cv_scores
                
                # Fit on full dataset for feature importance
                pipeline.fit(X, y)
                
                # Extract feature importance if available
                feature_importance = None
                if hasattr(model, 'feature_importances_'):
                    feature_importance = dict(zip(self.feature_names, model.feature_importances_))
                
                # Create result
                result = ModelResult(
                    model_name=model_name,
                    model_type=self.problem_type,
                    cv_scores=cv_scores.tolist(),
                    mean_cv_score=float(cv_scores.mean()),
                    std_cv_score=float(cv_scores.std()),
                    training_time=time.time() - start_time,
                    parameters=model.get_params(),
                    feature_importance=feature_importance
                )
                
                results.append(result)
                
                # Save model
                model_path = self.models_dir / f"{model_name}_baseline.pkl"
                joblib.dump(pipeline, model_path)
                
                print(f"✓ {model_name}: {scoring}={result.mean_cv_score:.4f} (±{result.std_cv_score:.4f})")
                
            except Exception as e:
                print(f"✗ Error training {model_name}: {str(e)}")
        
        self.baseline_results = results
        return results
    
    def create_ensemble_baseline(self, X: pd.DataFrame, y: pd.Series) -> Dict[str, Any]:
        """Create a simple ensemble baseline using voting"""
        from sklearn.ensemble import VotingClassifier, VotingRegressor
        
        # Load best performing models
        best_models = sorted(self.baseline_results, key=lambda x: x.mean_cv_score, reverse=True)[:3]
        
        estimators = []
        for result in best_models:
            model_path = self.models_dir / f"{result.model_name}_baseline.pkl"
            if model_path.exists():
                model = joblib.load(model_path)
                estimators.append((result.model_name, model))
        
        if self.problem_type == "classification":
            ensemble = VotingClassifier(estimators=estimators, voting='soft')
        else:
            ensemble = VotingRegressor(estimators=estimators)
        
        # Train ensemble
        import time
        start_time = time.time()
        ensemble.fit(X, y)
        training_time = time.time() - start_time
        
        # Cross-validation
        scoring = 'accuracy' if self.problem_type == 'classification' else 'neg_mean_squared_error'
        cv_scores = cross_val_score(ensemble, X, y, cv=5, scoring=scoring)
        
        if self.problem_type == 'regression' and scoring == 'neg_mean_squared_error':
            cv_scores = -cv_scores
        
        # Save ensemble
        ensemble_path = self.models_dir / "ensemble_baseline.pkl"
        joblib.dump(ensemble, ensemble_path)
        
        return {
            "model_name": "EnsembleBaseline",
            "base_models": [m[0] for m in estimators],
            "cv_score": float(cv_scores.mean()),
            "cv_std": float(cv_scores.std()),
            "training_time": training_time
        }
    
    def generate_report(self) -> Dict[str, Any]:
        """Generate comprehensive foundation phase report"""
        report = {
            "session_id": self.session_id,
            "execution_id": self.execution_id,
            "timestamp": datetime.now().isoformat(),
            "problem_type": self.problem_type,
            "preprocessing": {
                "features": self.feature_names,
                "pipeline_steps": str(self.preprocessing_pipeline) if self.preprocessing_pipeline else None
            },
            "baseline_models": [asdict(r) for r in self.baseline_results],
            "best_model": None,
            "recommendations": []
        }
        
        if self.baseline_results:
            # Find best model
            best_model = max(self.baseline_results, key=lambda x: x.mean_cv_score)
            report["best_model"] = {
                "name": best_model.model_name,
                "score": best_model.mean_cv_score,
                "std": best_model.std_cv_score
            }
            
            # Generate recommendations
            if self.problem_type == "classification":
                if best_model.mean_cv_score < 0.8:
                    report["recommendations"].append("Consider feature engineering")
                    report["recommendations"].append("Try ensemble methods")
            else:  # regression
                if best_model.mean_cv_score > 0.1:  # MSE
                    report["recommendations"].append("Investigate outliers")
                    report["recommendations"].append("Consider non-linear transformations")
        
        return report
    
    def save_results(self):
        """Save all results and metadata"""
        # Save report
        report = self.generate_report()
        report_path = self.models_dir / "foundation_report.json"
        with open(report_path, 'w') as f:
            json.dump(report, f, indent=2)
        
        # Save preprocessing pipeline
        if self.preprocessing_pipeline:
            pipeline_path = self.models_dir / "preprocessing_pipeline.pkl"
            joblib.dump(self.preprocessing_pipeline, pipeline_path)
        
        print(f"\n✅ Foundation phase complete! Results saved to {self.models_dir}")
        return report


def main():
    """Main execution function for standalone testing"""
    # Example usage
    from sklearn.datasets import load_iris, load_boston
    
    # Initialize builder
    builder = FoundationModelBuilder(
        session_id="test_session",
        execution_id="test_execution"
    )
    
    # Load sample data (classification)
    iris = load_iris()
    X = pd.DataFrame(iris.data, columns=iris.feature_names)
    y = pd.Series(iris.target)
    
    # Analyze dataset
    print("Analyzing dataset...")
    analysis = builder.analyze_dataset(X, 'target')
    print(f"Problem type: {analysis['problem_type']}")
    
    # Train baseline models
    print("\nTraining baseline models...")
    results = builder.train_baseline_models(X, y)
    
    # Create ensemble
    print("\nCreating ensemble baseline...")
    ensemble_result = builder.create_ensemble_baseline(X, y)
    print(f"Ensemble CV score: {ensemble_result['cv_score']:.4f}")
    
    # Save results
    builder.save_results()


if __name__ == "__main__":
    main()