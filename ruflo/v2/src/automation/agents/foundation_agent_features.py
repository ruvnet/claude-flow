#!/usr/bin/env python3
"""
Feature Engineering Module for Foundation Agent
==============================================
Advanced feature engineering and selection for MLE-STAR foundation phase.
"""

import numpy as np
import pandas as pd
from typing import List, Dict, Tuple, Any, Optional, Union
from sklearn.preprocessing import PolynomialFeatures, FunctionTransformer
from sklearn.feature_selection import (
    SelectKBest, SelectPercentile, RFE, RFECV,
    chi2, f_classif, f_regression, mutual_info_classif, mutual_info_regression
)
from sklearn.decomposition import PCA, TruncatedSVD, FastICA
from sklearn.feature_extraction import FeatureHasher
from sklearn.cluster import KMeans
from scipy import stats
import warnings
warnings.filterwarnings('ignore')


class FeatureEngineer:
    """
    Advanced feature engineering for foundation models
    """
    
    def __init__(self, problem_type: str = "classification"):
        self.problem_type = problem_type
        self.engineered_features = []
        self.feature_importance = {}
        self.transformations = {}
        
    def create_polynomial_features(self, X: pd.DataFrame, degree: int = 2, 
                                 interaction_only: bool = False) -> pd.DataFrame:
        """Create polynomial and interaction features"""
        poly = PolynomialFeatures(degree=degree, interaction_only=interaction_only, 
                                 include_bias=False)
        
        # Select numeric columns only
        numeric_cols = X.select_dtypes(include=[np.number]).columns
        X_numeric = X[numeric_cols]
        
        # Generate polynomial features
        X_poly = poly.fit_transform(X_numeric)
        
        # Get feature names
        feature_names = poly.get_feature_names_out(numeric_cols)
        
        # Create DataFrame
        X_poly_df = pd.DataFrame(X_poly, columns=feature_names, index=X.index)
        
        # Combine with non-numeric features
        non_numeric = X.select_dtypes(exclude=[np.number])
        if not non_numeric.empty:
            X_poly_df = pd.concat([X_poly_df, non_numeric], axis=1)
        
        self.transformations['polynomial'] = {
            'degree': degree,
            'features_created': len(feature_names)
        }
        
        return X_poly_df
    
    def create_statistical_features(self, X: pd.DataFrame) -> pd.DataFrame:
        """Create statistical aggregate features"""
        X_stats = X.copy()
        numeric_cols = X.select_dtypes(include=[np.number]).columns
        
        if len(numeric_cols) > 1:
            # Row-wise statistics
            X_stats['row_mean'] = X[numeric_cols].mean(axis=1)
            X_stats['row_std'] = X[numeric_cols].std(axis=1)
            X_stats['row_max'] = X[numeric_cols].max(axis=1)
            X_stats['row_min'] = X[numeric_cols].min(axis=1)
            X_stats['row_range'] = X_stats['row_max'] - X_stats['row_min']
            X_stats['row_skew'] = X[numeric_cols].apply(lambda x: stats.skew(x), axis=1)
            X_stats['row_kurtosis'] = X[numeric_cols].apply(lambda x: stats.kurtosis(x), axis=1)
            
            # Percentiles
            X_stats['row_q25'] = X[numeric_cols].quantile(0.25, axis=1)
            X_stats['row_q75'] = X[numeric_cols].quantile(0.75, axis=1)
            X_stats['row_iqr'] = X_stats['row_q75'] - X_stats['row_q25']
            
            self.engineered_features.extend([
                'row_mean', 'row_std', 'row_max', 'row_min', 'row_range',
                'row_skew', 'row_kurtosis', 'row_q25', 'row_q75', 'row_iqr'
            ])
        
        return X_stats
    
    def create_ratio_features(self, X: pd.DataFrame, pairs: Optional[List[Tuple[str, str]]] = None) -> pd.DataFrame:
        """Create ratio features between numeric columns"""
        X_ratio = X.copy()
        numeric_cols = X.select_dtypes(include=[np.number]).columns.tolist()
        
        if pairs is None:
            # Create ratios for all numeric column pairs
            pairs = [(col1, col2) for i, col1 in enumerate(numeric_cols) 
                    for col2 in numeric_cols[i+1:]]
        
        for col1, col2 in pairs:
            if col1 in numeric_cols and col2 in numeric_cols:
                # Avoid division by zero
                ratio_name = f"{col1}_ratio_{col2}"
                X_ratio[ratio_name] = X[col1] / (X[col2] + 1e-8)
                self.engineered_features.append(ratio_name)
                
                # Also create difference
                diff_name = f"{col1}_diff_{col2}"
                X_ratio[diff_name] = X[col1] - X[col2]
                self.engineered_features.append(diff_name)
        
        return X_ratio
    
    def create_clustering_features(self, X: pd.DataFrame, n_clusters: int = 5) -> pd.DataFrame:
        """Create cluster-based features"""
        X_cluster = X.copy()
        numeric_cols = X.select_dtypes(include=[np.number]).columns
        
        if len(numeric_cols) > 0:
            # Perform clustering
            kmeans = KMeans(n_clusters=n_clusters, random_state=42)
            X_numeric = X[numeric_cols].fillna(0)
            
            # Cluster assignments
            clusters = kmeans.fit_predict(X_numeric)
            X_cluster['cluster'] = clusters
            
            # Distance to each cluster center
            distances = kmeans.transform(X_numeric)
            for i in range(n_clusters):
                X_cluster[f'dist_to_cluster_{i}'] = distances[:, i]
                self.engineered_features.append(f'dist_to_cluster_{i}')
            
            # Distance to nearest cluster center
            X_cluster['min_cluster_dist'] = distances.min(axis=1)
            self.engineered_features.append('min_cluster_dist')
            
            self.transformations['clustering'] = {
                'n_clusters': n_clusters,
                'features_created': n_clusters + 2
            }
        
        return X_cluster
    
    def create_transformation_features(self, X: pd.DataFrame) -> pd.DataFrame:
        """Create transformed features (log, sqrt, square, etc.)"""
        X_trans = X.copy()
        numeric_cols = X.select_dtypes(include=[np.number]).columns
        
        for col in numeric_cols:
            # Only transform positive values
            if (X[col] > 0).all():
                # Log transformation
                X_trans[f'{col}_log'] = np.log1p(X[col])
                self.engineered_features.append(f'{col}_log')
                
                # Square root
                X_trans[f'{col}_sqrt'] = np.sqrt(X[col])
                self.engineered_features.append(f'{col}_sqrt')
            
            # Square (works for all values)
            X_trans[f'{col}_square'] = X[col] ** 2
            self.engineered_features.append(f'{col}_square')
            
            # Reciprocal (avoid division by zero)
            if not (X[col] == 0).any():
                X_trans[f'{col}_reciprocal'] = 1 / X[col]
                self.engineered_features.append(f'{col}_reciprocal')
        
        return X_trans
    
    def create_binning_features(self, X: pd.DataFrame, n_bins: int = 10) -> pd.DataFrame:
        """Create binned features for numeric columns"""
        X_binned = X.copy()
        numeric_cols = X.select_dtypes(include=[np.number]).columns
        
        for col in numeric_cols:
            # Equal-width binning
            X_binned[f'{col}_bin_eq_width'] = pd.cut(X[col], bins=n_bins, labels=False)
            
            # Equal-frequency binning
            try:
                X_binned[f'{col}_bin_eq_freq'] = pd.qcut(X[col], q=n_bins, labels=False, duplicates='drop')
            except:
                # If qcut fails due to duplicates, use regular cut
                X_binned[f'{col}_bin_eq_freq'] = pd.cut(X[col], bins=n_bins, labels=False)
            
            self.engineered_features.extend([f'{col}_bin_eq_width', f'{col}_bin_eq_freq'])
        
        return X_binned
    
    def select_features_univariate(self, X: pd.DataFrame, y: pd.Series, 
                                 k: Union[int, float] = 0.5) -> Tuple[pd.DataFrame, Dict[str, float]]:
        """Select features using univariate statistical tests"""
        # Choose scoring function based on problem type
        if self.problem_type == "classification":
            if X.select_dtypes(include=[np.number]).shape[1] == X.shape[1]:
                score_func = f_classif
            else:
                score_func = chi2
        else:
            score_func = f_regression
        
        # Handle k parameter (number or percentage)
        if isinstance(k, float) and k < 1:
            selector = SelectPercentile(score_func=score_func, percentile=int(k * 100))
        else:
            selector = SelectKBest(score_func=score_func, k=int(k))
        
        # Fit selector
        X_numeric = X.select_dtypes(include=[np.number])
        X_selected = selector.fit_transform(X_numeric, y)
        
        # Get selected features
        selected_features = X_numeric.columns[selector.get_support()].tolist()
        
        # Get scores
        scores = dict(zip(X_numeric.columns, selector.scores_))
        self.feature_importance.update(scores)
        
        # Create DataFrame with selected features
        X_result = X[selected_features]
        
        # Add non-numeric features back
        non_numeric = X.select_dtypes(exclude=[np.number])
        if not non_numeric.empty:
            X_result = pd.concat([X_result, non_numeric], axis=1)
        
        return X_result, scores
    
    def select_features_mutual_info(self, X: pd.DataFrame, y: pd.Series, 
                                  threshold: float = 0.1) -> Tuple[pd.DataFrame, Dict[str, float]]:
        """Select features using mutual information"""
        # Choose MI function based on problem type
        if self.problem_type == "classification":
            mi_func = mutual_info_classif
        else:
            mi_func = mutual_info_regression
        
        # Calculate mutual information
        X_numeric = X.select_dtypes(include=[np.number])
        mi_scores = mi_func(X_numeric, y)
        
        # Create feature importance dict
        mi_dict = dict(zip(X_numeric.columns, mi_scores))
        self.feature_importance.update(mi_dict)
        
        # Select features above threshold
        selected_features = [col for col, score in mi_dict.items() if score > threshold]
        
        # Create result DataFrame
        X_result = X[selected_features]
        
        # Add non-numeric features back
        non_numeric = X.select_dtypes(exclude=[np.number])
        if not non_numeric.empty:
            X_result = pd.concat([X_result, non_numeric], axis=1)
        
        return X_result, mi_dict
    
    def select_features_rfe(self, X: pd.DataFrame, y: pd.Series, estimator, 
                          n_features: Optional[int] = None) -> Tuple[pd.DataFrame, List[str]]:
        """Select features using Recursive Feature Elimination"""
        X_numeric = X.select_dtypes(include=[np.number])
        
        if n_features is None:
            # Use cross-validation to find optimal number
            selector = RFECV(estimator, cv=3, scoring='accuracy' if self.problem_type == 'classification' else 'neg_mean_squared_error')
        else:
            selector = RFE(estimator, n_features_to_select=n_features)
        
        # Fit RFE
        selector.fit(X_numeric, y)
        
        # Get selected features
        selected_features = X_numeric.columns[selector.support_].tolist()
        
        # Get ranking
        ranking = dict(zip(X_numeric.columns, selector.ranking_))
        
        # Create result DataFrame
        X_result = X[selected_features]
        
        # Add non-numeric features back
        non_numeric = X.select_dtypes(exclude=[np.number])
        if not non_numeric.empty:
            X_result = pd.concat([X_result, non_numeric], axis=1)
        
        return X_result, selected_features
    
    def reduce_dimensions_pca(self, X: pd.DataFrame, n_components: Union[int, float] = 0.95) -> pd.DataFrame:
        """Reduce dimensions using PCA"""
        X_numeric = X.select_dtypes(include=[np.number]).fillna(0)
        
        # Apply PCA
        pca = PCA(n_components=n_components, random_state=42)
        X_pca = pca.fit_transform(X_numeric)
        
        # Create feature names
        n_components_actual = X_pca.shape[1]
        pca_features = [f'pca_{i}' for i in range(n_components_actual)]
        
        # Create DataFrame
        X_pca_df = pd.DataFrame(X_pca, columns=pca_features, index=X.index)
        
        # Store transformation info
        self.transformations['pca'] = {
            'n_components': n_components_actual,
            'explained_variance_ratio': pca.explained_variance_ratio_.tolist(),
            'total_variance_explained': pca.explained_variance_ratio_.sum()
        }
        
        # Combine with non-numeric features
        non_numeric = X.select_dtypes(exclude=[np.number])
        if not non_numeric.empty:
            X_pca_df = pd.concat([X_pca_df, non_numeric], axis=1)
        
        return X_pca_df
    
    def create_all_features(self, X: pd.DataFrame, config: Optional[Dict[str, Any]] = None) -> pd.DataFrame:
        """Create all engineered features based on configuration"""
        if config is None:
            config = {
                'polynomial': {'degree': 2, 'interaction_only': True},
                'statistical': True,
                'ratio': True,
                'clustering': {'n_clusters': 5},
                'transformation': True,
                'binning': {'n_bins': 10}
            }
        
        X_engineered = X.copy()
        
        # Apply each feature engineering method
        if config.get('polynomial'):
            poly_config = config['polynomial'] if isinstance(config['polynomial'], dict) else {}
            X_engineered = self.create_polynomial_features(X_engineered, **poly_config)
        
        if config.get('statistical'):
            X_engineered = self.create_statistical_features(X_engineered)
        
        if config.get('ratio'):
            X_engineered = self.create_ratio_features(X_engineered)
        
        if config.get('clustering'):
            cluster_config = config['clustering'] if isinstance(config['clustering'], dict) else {}
            X_engineered = self.create_clustering_features(X_engineered, **cluster_config)
        
        if config.get('transformation'):
            X_engineered = self.create_transformation_features(X_engineered)
        
        if config.get('binning'):
            bin_config = config['binning'] if isinstance(config['binning'], dict) else {}
            X_engineered = self.create_binning_features(X_engineered, **bin_config)
        
        return X_engineered
    
    def get_feature_report(self) -> Dict[str, Any]:
        """Generate feature engineering report"""
        return {
            'engineered_features': self.engineered_features,
            'total_engineered': len(self.engineered_features),
            'transformations': self.transformations,
            'feature_importance': dict(sorted(
                self.feature_importance.items(), 
                key=lambda x: x[1], 
                reverse=True
            )[:20])  # Top 20 features
        }


def test_feature_engineering():
    """Test feature engineering functionality"""
    from sklearn.datasets import make_classification
    
    # Create sample data
    X, y = make_classification(n_samples=1000, n_features=10, n_informative=5, random_state=42)
    feature_names = [f'feature_{i}' for i in range(X.shape[1])]
    X_df = pd.DataFrame(X, columns=feature_names)
    
    # Initialize feature engineer
    engineer = FeatureEngineer(problem_type="classification")
    
    # Test different feature engineering methods
    print("Testing feature engineering methods...")
    
    # Polynomial features
    X_poly = engineer.create_polynomial_features(X_df, degree=2, interaction_only=True)
    print(f"✓ Polynomial features: {X_df.shape[1]} → {X_poly.shape[1]}")
    
    # Statistical features
    X_stats = engineer.create_statistical_features(X_df)
    print(f"✓ Statistical features: {X_df.shape[1]} → {X_stats.shape[1]}")
    
    # Feature selection
    X_selected, scores = engineer.select_features_univariate(X_poly, y, k=20)
    print(f"✓ Feature selection: {X_poly.shape[1]} → {X_selected.shape[1]}")
    
    # PCA
    X_pca = engineer.reduce_dimensions_pca(X_df, n_components=0.95)
    print(f"✓ PCA: {X_df.shape[1]} → {X_pca.shape[1]}")
    
    # Get report
    report = engineer.get_feature_report()
    print(f"\n✓ Total engineered features: {report['total_engineered']}")
    print(f"✓ Transformations applied: {list(report['transformations'].keys())}")


if __name__ == "__main__":
    test_feature_engineering()