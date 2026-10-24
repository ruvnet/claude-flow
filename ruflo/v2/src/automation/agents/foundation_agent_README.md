# Foundation Model Builder Agent for MLE-STAR

## Overview

The Foundation Model Builder is a critical component of the MLE-STAR (Machine Learning Engineering - Search, Train, Ablate, Refine) automation workflow. This agent handles the foundation phase, focusing on:

- Data preprocessing and feature engineering
- Initial model building and baseline creation
- Performance benchmarking
- Model persistence and versioning

## Architecture

The Foundation Agent consists of four main modules:

### 1. `foundation_agent_core.py`
Core functionality for model building:
- **FoundationModelBuilder**: Main class handling model training and evaluation
- **ModelResult**: Data structure for storing model performance metrics
- Dataset analysis and problem type detection
- Preprocessing pipeline creation
- Baseline model training with cross-validation
- Ensemble model creation
- Comprehensive reporting

### 2. `foundation_agent_features.py`
Advanced feature engineering capabilities:
- **FeatureEngineer**: Comprehensive feature engineering toolkit
- Polynomial and interaction features
- Statistical aggregate features
- Ratio and difference features
- Clustering-based features
- Mathematical transformations
- Binning and discretization
- Feature selection (univariate, mutual information, RFE)
- Dimensionality reduction (PCA, TruncatedSVD)

### 3. `foundation_agent_integration.py`
Integration with MLE-STAR workflow:
- **FoundationAgentIntegration**: Coordination layer
- Claude-flow hooks integration
- Memory system coordination
- Workflow step processing
- Cross-agent communication
- Result sharing and persistence

### 4. `test_foundation_agent.py`
Comprehensive test suite:
- Unit tests for all major components
- Integration tests for workflow scenarios
- Feature engineering validation
- Model training verification

## Usage

### Standalone Execution

```python
from foundation_agent_core import FoundationModelBuilder

# Initialize builder
builder = FoundationModelBuilder(
    session_id="my_session",
    execution_id="my_execution"
)

# Load and analyze data
import pandas as pd
data = pd.read_csv("my_data.csv")
analysis = builder.analyze_dataset(data, target_column="target")

# Train baseline models
X = data.drop(columns=["target"])
y = data["target"]
results = builder.train_baseline_models(X, y, cv_folds=5)

# Create ensemble
ensemble = builder.create_ensemble_baseline(X, y)

# Save results
report = builder.save_results()
```

### Workflow Integration

```bash
# Run as part of MLE-STAR workflow
python foundation_agent_integration.py \
    --session-id "automation-session-123" \
    --execution-id "workflow-exec-456" \
    --dataset "path/to/data.csv" \
    --target "target_column" \
    --step "full_pipeline"
```

### Feature Engineering

```python
from foundation_agent_features import FeatureEngineer

# Initialize engineer
engineer = FeatureEngineer(problem_type="classification")

# Create features
X_poly = engineer.create_polynomial_features(X, degree=2)
X_stats = engineer.create_statistical_features(X)
X_all = engineer.create_all_features(X, config={
    'polynomial': True,
    'statistical': True,
    'clustering': {'n_clusters': 5}
})

# Select features
X_selected, scores = engineer.select_features_univariate(X_all, y, k=20)
```

## Baseline Models

The agent automatically selects appropriate models based on problem type:

### Classification
- Logistic Regression
- Decision Tree
- Random Forest
- Support Vector Machine
- K-Nearest Neighbors
- Naive Bayes
- Neural Network (MLP)

### Regression
- Linear Regression
- Ridge Regression
- Lasso Regression
- Decision Tree
- Random Forest
- Support Vector Regression
- K-Nearest Neighbors
- Neural Network (MLP)

## Coordination & Memory

The agent uses Claude-flow hooks for coordination:

```bash
# Pre-task coordination
npx claude-flow@alpha hooks pre-task --description "Foundation building"

# Post-edit notifications
npx claude-flow@alpha hooks post-edit --file "model.pkl"

# Memory storage
npx claude-flow@alpha memory store "agent/foundation/results" "{...}"

# Result sharing
npx claude-flow@alpha hooks notify --message "Foundation complete"
```

## Output Structure

```
models/foundation_{session_id}/
├── LogisticRegression_baseline.pkl
├── RandomForest_baseline.pkl
├── ensemble_baseline.pkl
├── preprocessing_pipeline.pkl
└── foundation_report.json
```

### Foundation Report Structure

```json
{
  "session_id": "...",
  "execution_id": "...",
  "timestamp": "2025-01-04T10:00:00Z",
  "problem_type": "classification",
  "preprocessing": {
    "features": ["feature_1", "feature_2", ...],
    "pipeline_steps": "..."
  },
  "baseline_models": [
    {
      "model_name": "RandomForest",
      "mean_cv_score": 0.85,
      "std_cv_score": 0.03,
      "training_time": 2.5
    }
  ],
  "best_model": {
    "name": "RandomForest",
    "score": 0.85,
    "std": 0.03
  },
  "recommendations": [
    "Consider feature engineering",
    "Try ensemble methods"
  ]
}
```

## Performance Optimization

The agent includes several optimizations:

1. **Parallel Processing**: Cross-validation uses all available cores
2. **Memory Efficiency**: Streaming data processing for large datasets
3. **Caching**: Preprocessed data cached between model training
4. **Early Stopping**: Poor performing models stopped early
5. **Sparse Matrix Support**: Efficient handling of sparse features

## Error Handling

The agent includes robust error handling:

- Graceful degradation when models fail
- Automatic recovery from memory errors
- Validation of input data formats
- Clear error messages and logging

## Testing

Run the comprehensive test suite:

```bash
# Run all tests
python test_foundation_agent.py

# Run specific test class
python -m unittest test_foundation_agent.TestFoundationModelBuilder

# Run with coverage
coverage run test_foundation_agent.py
coverage report
```

## Future Enhancements

Planned improvements include:

1. **AutoML Integration**: Automatic hyperparameter tuning
2. **GPU Support**: RAPIDS integration for faster processing
3. **Distributed Training**: Dask/Ray support for large datasets
4. **Advanced Ensembles**: Stacking and blending methods
5. **Explainability**: SHAP/LIME integration
6. **Online Learning**: Incremental model updates

## Dependencies

```python
# Core dependencies
pandas>=1.3.0
numpy>=1.21.0
scikit-learn>=1.0.0
joblib>=1.1.0

# Optional dependencies
dask>=2022.1.0  # For distributed processing
shap>=0.40.0    # For model explainability
matplotlib>=3.4.0  # For visualizations
```

## Contributing

When contributing to the Foundation Agent:

1. Follow the existing code structure
2. Add comprehensive tests for new features
3. Update documentation
4. Ensure all tests pass
5. Follow PEP 8 style guidelines

## License

This module is part of the Claude-Flow project and follows the same licensing terms.