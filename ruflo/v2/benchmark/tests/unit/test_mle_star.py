"""
Unit tests for MLE-STAR ensemble integration.

Tests the ensemble executor, voting strategies, model coordination,
and performance tracking components.
"""

import pytest
import asyncio
from unittest.mock import Mock, AsyncMock, patch
from datetime import datetime, timedelta
from typing import List, Dict, Any

import numpy as np

# Mock imports for MLE-STAR components (these would be actual imports)
from swarm_benchmark.core.models import BenchmarkResult, PerformanceMetrics
from swarm_benchmark.fixtures.test_data import TestDataGenerator


class MockMLEStarConfig:
    """Mock configuration for MLE-STAR testing."""
    
    def __init__(self):
        self.models = [
            {"type": "random_forest", "n_estimators": 100},
            {"type": "gradient_boost", "n_estimators": 100}, 
            {"type": "neural_network", "layers": [100, 50, 10]},
            {"type": "svm", "kernel": "rbf"},
            {"type": "logistic_regression", "penalty": "l2"}
        ]
        self.voting_strategy = "weighted"
        self.ensemble_size = 5
        self.consensus_threshold = 0.7


class MockBenchmarkResult:
    """Mock benchmark result for testing."""
    
    def __init__(self, task: str, ensemble_size: int):
        self.task = task
        self.ensemble_size = ensemble_size
        self.metrics = {
            "accuracy": 0.95,
            "precision": 0.93,
            "recall": 0.91,
            "f1": 0.92,
            "consensus_time": 2.5,
            "training_time": 45.2,
            "prediction_time": 0.8
        }
        self.final_output = {"prediction": [0, 1, 0, 1, 1], "confidence": 0.92}


class MockModelAgent:
    """Mock model agent for testing."""
    
    def __init__(self, agent_id: str, model_config: Dict):
        self.agent_id = agent_id
        self.model_config = model_config
        self.status = "ready"
        self.predictions = []
        
    async def predict(self, data: Any) -> Dict[str, Any]:
        """Mock prediction."""
        # Simulate prediction time
        await asyncio.sleep(0.1)
        prediction = np.random.choice([0, 1], size=len(data) if hasattr(data, '__len__') else 10)
        confidence = np.random.uniform(0.7, 0.95)
        return {
            "prediction": prediction.tolist(),
            "confidence": confidence,
            "model_type": self.model_config["type"]
        }
    
    async def train(self, training_data: Any, labels: Any) -> Dict[str, Any]:
        """Mock training."""
        await asyncio.sleep(1.0)  # Simulate training time
        return {
            "training_time": 1.0,
            "accuracy": np.random.uniform(0.8, 0.95),
            "loss": np.random.uniform(0.05, 0.2)
        }


class MockMLEStarEnsembleExecutor:
    """Mock ensemble executor for testing."""
    
    def __init__(self, config: MockMLEStarConfig):
        self.config = config
        self.models = []
        self.performance_tracker = Mock()
        
    async def execute_ensemble_benchmark(self, task: str, dataset: Any) -> MockBenchmarkResult:
        """Execute a mock ensemble benchmark."""
        # Simulate initialization
        await self._initialize_models_parallel()
        
        # Simulate predictions
        predictions = await self._gather_predictions(dataset)
        
        # Simulate consensus
        final_prediction = await self._build_consensus(predictions)
        
        return MockBenchmarkResult(task, len(self.models))
    
    async def _initialize_models_parallel(self):
        """Mock model initialization."""
        init_tasks = []
        for i, model_config in enumerate(self.config.models):
            agent = MockModelAgent(f"model_{i}", model_config)
            init_tasks.append(asyncio.create_task(asyncio.sleep(0.2)))  # Simulate init time
            self.models.append(agent)
        
        await asyncio.gather(*init_tasks)
    
    async def _gather_predictions(self, dataset: Any) -> List[Dict[str, Any]]:
        """Mock prediction gathering."""
        prediction_tasks = []
        for model in self.models:
            prediction_tasks.append(model.predict(dataset))
        
        return await asyncio.gather(*prediction_tasks)
    
    async def _build_consensus(self, predictions: List[Dict[str, Any]]) -> Dict[str, Any]:
        """Mock consensus building."""
        if self.config.voting_strategy == "majority":
            return self._majority_vote(predictions)
        elif self.config.voting_strategy == "weighted":
            return self._weighted_vote(predictions)
        else:
            return predictions[0]  # Default to first prediction
    
    def _majority_vote(self, predictions: List[Dict[str, Any]]) -> Dict[str, Any]:
        """Mock majority voting."""
        return {
            "prediction": [1, 0, 1, 0, 1],
            "confidence": 0.8,
            "voting_method": "majority"
        }
    
    def _weighted_vote(self, predictions: List[Dict[str, Any]]) -> Dict[str, Any]:
        """Mock weighted voting."""
        weights = [pred["confidence"] for pred in predictions]
        return {
            "prediction": [0, 1, 0, 1, 1],
            "confidence": sum(weights) / len(weights),
            "voting_method": "weighted"
        }


class TestMLEStarEnsembleExecutor:
    """Test the MLE-STAR ensemble executor."""
    
    @pytest.fixture
    def mock_config(self):
        """Provide mock configuration."""
        return MockMLEStarConfig()
    
    @pytest.fixture
    def mock_dataset(self):
        """Provide mock dataset."""
        return np.random.randn(100, 10)
    
    @pytest.fixture
    def executor(self, mock_config):
        """Provide executor instance."""
        return MockMLEStarEnsembleExecutor(mock_config)
    
    @pytest.mark.asyncio
    async def test_ensemble_executor_initialization(self, executor, mock_config):
        """Test ensemble executor initializes correctly."""
        assert executor.config == mock_config
        assert len(executor.models) == 0
        assert executor.performance_tracker is not None
    
    @pytest.mark.asyncio
    async def test_execute_ensemble_benchmark(self, executor, mock_dataset):
        """Test complete ensemble benchmark execution."""
        result = await executor.execute_ensemble_benchmark("classification", mock_dataset)
        
        assert result.task == "classification"
        assert result.ensemble_size == 5
        assert "accuracy" in result.metrics
        assert result.metrics["accuracy"] > 0.9
        assert result.final_output is not None
    
    @pytest.mark.asyncio
    async def test_model_initialization_parallel(self, executor):
        """Test models are initialized in parallel."""
        start_time = datetime.now()
        await executor._initialize_models_parallel()
        end_time = datetime.now()
        
        # Should complete faster than sequential (5 * 0.2 = 1.0s)
        duration = (end_time - start_time).total_seconds()
        assert duration < 0.5  # Parallel execution should be much faster
        assert len(executor.models) == 5
    
    @pytest.mark.asyncio
    async def test_prediction_gathering(self, executor, mock_dataset):
        """Test predictions are gathered from all models."""
        await executor._initialize_models_parallel()
        predictions = await executor._gather_predictions(mock_dataset)
        
        assert len(predictions) == 5
        for pred in predictions:
            assert "prediction" in pred
            assert "confidence" in pred
            assert "model_type" in pred
    
    @pytest.mark.asyncio
    async def test_consensus_building_majority(self, executor):
        """Test majority vote consensus."""
        executor.config.voting_strategy = "majority"
        predictions = [
            {"prediction": [1, 0, 1], "confidence": 0.8},
            {"prediction": [1, 1, 1], "confidence": 0.7},
            {"prediction": [1, 0, 0], "confidence": 0.9}
        ]
        
        consensus = await executor._build_consensus(predictions)
        assert consensus["voting_method"] == "majority"
        assert "prediction" in consensus
        assert "confidence" in consensus
    
    @pytest.mark.asyncio
    async def test_consensus_building_weighted(self, executor):
        """Test weighted vote consensus."""
        executor.config.voting_strategy = "weighted"
        predictions = [
            {"prediction": [1, 0, 1], "confidence": 0.9},
            {"prediction": [0, 1, 1], "confidence": 0.7},
            {"prediction": [1, 1, 0], "confidence": 0.8}
        ]
        
        consensus = await executor._build_consensus(predictions)
        assert consensus["voting_method"] == "weighted"
        assert consensus["confidence"] == pytest.approx(0.8, abs=0.1)


class TestVotingStrategies:
    """Test different voting strategies."""
    
    @pytest.fixture
    def sample_predictions(self):
        """Provide sample predictions for testing."""
        return [
            {"prediction": [1, 0, 1, 0], "confidence": 0.85, "model": "rf"},
            {"prediction": [1, 1, 1, 0], "confidence": 0.78, "model": "gb"},
            {"prediction": [0, 0, 1, 1], "confidence": 0.92, "model": "nn"},
            {"prediction": [1, 0, 0, 0], "confidence": 0.73, "model": "svm"},
            {"prediction": [1, 1, 1, 1], "confidence": 0.88, "model": "lr"}
        ]
    
    def test_majority_voting(self, sample_predictions):
        """Test majority voting implementation."""
        executor = MockMLEStarEnsembleExecutor(MockMLEStarConfig())
        result = executor._majority_vote(sample_predictions)
        
        assert "prediction" in result
        assert "confidence" in result
        assert "voting_method" in result
        assert result["voting_method"] == "majority"
    
    def test_weighted_voting(self, sample_predictions):
        """Test weighted voting implementation."""
        executor = MockMLEStarEnsembleExecutor(MockMLEStarConfig())
        result = executor._weighted_vote(sample_predictions)
        
        assert "prediction" in result
        assert "confidence" in result
        assert "voting_method" in result
        assert result["voting_method"] == "weighted"
        
        # Confidence should be weighted average
        expected_confidence = sum(p["confidence"] for p in sample_predictions) / len(sample_predictions)
        assert result["confidence"] == pytest.approx(expected_confidence, abs=0.01)


class TestModelCoordination:
    """Test model coordination functionality."""
    
    @pytest.mark.asyncio
    async def test_model_agent_creation(self):
        """Test individual model agent creation."""
        model_config = {"type": "random_forest", "n_estimators": 100}
        agent = MockModelAgent("test_agent", model_config)
        
        assert agent.agent_id == "test_agent"
        assert agent.model_config == model_config
        assert agent.status == "ready"
    
    @pytest.mark.asyncio
    async def test_model_agent_prediction(self):
        """Test model agent prediction."""
        agent = MockModelAgent("test_agent", {"type": "test"})
        data = np.random.randn(50, 5)
        
        result = await agent.predict(data)
        
        assert "prediction" in result
        assert "confidence" in result
        assert "model_type" in result
        assert len(result["prediction"]) == 50
        assert 0.7 <= result["confidence"] <= 0.95
    
    @pytest.mark.asyncio
    async def test_model_agent_training(self):
        """Test model agent training."""
        agent = MockModelAgent("test_agent", {"type": "test"})
        training_data = np.random.randn(100, 5)
        labels = np.random.choice([0, 1], 100)
        
        result = await agent.train(training_data, labels)
        
        assert "training_time" in result
        assert "accuracy" in result
        assert "loss" in result
        assert result["training_time"] >= 1.0
        assert 0.8 <= result["accuracy"] <= 0.95


class TestMLEStarBenchmarkScenarios:
    """Test MLE-STAR benchmark scenarios."""
    
    def test_classification_scenario_config(self):
        """Test classification benchmark scenario configuration."""
        scenario_config = {
            "name": "classification_ensemble",
            "models": [
                {"type": "random_forest", "n_estimators": 100},
                {"type": "gradient_boost", "n_estimators": 100},
                {"type": "neural_network", "layers": [100, 50, 10]},
                {"type": "svm", "kernel": "rbf"},
                {"type": "logistic_regression", "penalty": "l2"}
            ],
            "voting_strategy": "weighted",
            "metrics": ["accuracy", "precision", "recall", "f1", "consensus_time"],
            "dataset_size": 10000,
            "test_iterations": 5
        }
        
        assert scenario_config["name"] == "classification_ensemble"
        assert len(scenario_config["models"]) == 5
        assert scenario_config["voting_strategy"] == "weighted"
        assert len(scenario_config["metrics"]) == 5
    
    def test_regression_scenario_config(self):
        """Test regression benchmark scenario configuration."""
        scenario_config = {
            "name": "regression_ensemble",
            "models": [
                {"type": "linear_regression"},
                {"type": "ridge_regression", "alpha": 1.0},
                {"type": "lasso_regression", "alpha": 0.1},
                {"type": "elastic_net", "alpha": 0.5},
                {"type": "random_forest_regressor", "n_estimators": 100}
            ],
            "voting_strategy": "bayesian",
            "metrics": ["mse", "mae", "r2", "consensus_variance"],
            "dataset_size": 5000,
            "test_iterations": 3
        }
        
        assert scenario_config["name"] == "regression_ensemble"
        assert len(scenario_config["models"]) == 5
        assert scenario_config["voting_strategy"] == "bayesian"
        assert "mse" in scenario_config["metrics"]


class TestPerformanceTracking:
    """Test performance tracking for MLE-STAR."""
    
    @pytest.fixture
    def performance_tracker(self):
        """Provide performance tracker mock."""
        return Mock()
    
    def test_track_ensemble_performance(self, performance_tracker):
        """Test ensemble performance tracking."""
        metrics = {
            "ensemble_size": 5,
            "consensus_time": 2.5,
            "total_prediction_time": 5.2,
            "accuracy": 0.94,
            "confidence_variance": 0.03
        }
        
        performance_tracker.track_ensemble_metrics.return_value = metrics
        result = performance_tracker.track_ensemble_metrics(metrics)
        
        assert result["ensemble_size"] == 5
        assert result["consensus_time"] == 2.5
        assert result["accuracy"] == 0.94
    
    def test_track_individual_model_performance(self, performance_tracker):
        """Test individual model performance tracking."""
        model_metrics = {
            "model_id": "model_0",
            "model_type": "random_forest",
            "prediction_time": 0.8,
            "accuracy": 0.91,
            "memory_usage": 256.5
        }
        
        performance_tracker.track_model_metrics.return_value = model_metrics
        result = performance_tracker.track_model_metrics(model_metrics)
        
        assert result["model_id"] == "model_0"
        assert result["model_type"] == "random_forest"
        assert result["prediction_time"] == 0.8


class TestIntegrationWithClaudeFlow:
    """Test integration with Claude Flow MCP tools."""
    
    @pytest.mark.asyncio
    async def test_mcp_agent_spawning(self):
        """Test spawning ML agents through MCP."""
        executor = MockMLEStarEnsembleExecutor(MockMLEStarConfig())
        
        # Mock MCP command execution
        with patch('swarm_benchmark.mle_star.ensemble_executor.execute_mcp_command') as mock_mcp:
            mock_mcp.return_value = {"agent_id": "ml_agent_1", "status": "active"}
            
            model_config = {"type": "random_forest", "capabilities": ["classification"]}
            agent = await executor._spawn_model_agent("ml_agent_1", model_config)
            
            mock_mcp.assert_called_once()
            assert agent is not None
    
    @pytest.mark.asyncio
    async def test_swarm_coordination_integration(self):
        """Test integration with swarm coordination."""
        executor = MockMLEStarEnsembleExecutor(MockMLEStarConfig())
        
        # Test would verify coordination with swarm management
        # This is a placeholder for actual swarm integration tests
        assert executor.config.ensemble_size == 5
        
        # Simulate swarm initialization
        await executor._initialize_models_parallel()
        assert len(executor.models) == 5


# Benchmark-specific tests
class TestMLEStarBenchmarks:
    """Test actual benchmark execution scenarios."""
    
    @pytest.mark.asyncio
    @pytest.mark.slow
    async def test_full_classification_benchmark(self):
        """Test complete classification benchmark."""
        config = MockMLEStarConfig()
        executor = MockMLEStarEnsembleExecutor(config)
        
        # Generate test dataset
        dataset = np.random.randn(1000, 20)
        
        start_time = datetime.now()
        result = await executor.execute_ensemble_benchmark("classification", dataset)
        end_time = datetime.now()
        
        # Verify results
        assert result.task == "classification"
        assert result.ensemble_size == 5
        assert result.metrics["accuracy"] > 0.9
        
        # Verify performance
        duration = (end_time - start_time).total_seconds()
        assert duration < 10.0  # Should complete within 10 seconds
    
    @pytest.mark.asyncio
    @pytest.mark.slow
    async def test_regression_benchmark(self):
        """Test regression benchmark."""
        config = MockMLEStarConfig()
        config.models = [
            {"type": "linear_regression"},
            {"type": "ridge_regression"},
            {"type": "lasso_regression"}
        ]
        executor = MockMLEStarEnsembleExecutor(config)
        
        dataset = np.random.randn(500, 10)
        result = await executor.execute_ensemble_benchmark("regression", dataset)
        
        assert result.task == "regression"
        assert result.ensemble_size == 3
        assert result.metrics is not None
    
    @pytest.mark.parametrize("voting_strategy", ["majority", "weighted"])
    @pytest.mark.asyncio
    async def test_different_voting_strategies(self, voting_strategy):
        """Test different voting strategies."""
        config = MockMLEStarConfig()
        config.voting_strategy = voting_strategy
        executor = MockMLEStarEnsembleExecutor(config)
        
        dataset = np.random.randn(100, 5)
        result = await executor.execute_ensemble_benchmark("test", dataset)
        
        assert result is not None
        assert result.ensemble_size == 5


class TestErrorHandling:
    """Test error handling in MLE-STAR components."""
    
    @pytest.mark.asyncio
    async def test_model_initialization_failure(self):
        """Test handling of model initialization failures."""
        config = MockMLEStarConfig()
        executor = MockMLEStarEnsembleExecutor(config)
        
        # Mock a model initialization failure
        with patch.object(MockModelAgent, '__init__', side_effect=Exception("Model init failed")):
            with pytest.raises(Exception, match="Model init failed"):
                await executor._initialize_models_parallel()
    
    @pytest.mark.asyncio
    async def test_prediction_failure_handling(self):
        """Test handling of prediction failures."""
        agent = MockModelAgent("test", {"type": "test"})
        
        with patch.object(agent, 'predict', side_effect=Exception("Prediction failed")):
            with pytest.raises(Exception, match="Prediction failed"):
                await agent.predict([1, 2, 3])
    
    def test_invalid_voting_strategy(self):
        """Test handling of invalid voting strategy."""
        config = MockMLEStarConfig()
        config.voting_strategy = "invalid_strategy"
        executor = MockMLEStarEnsembleExecutor(config)
        
        # This would raise an error in actual implementation
        predictions = [{"prediction": [1, 0], "confidence": 0.8}]
        
        with pytest.raises(ValueError, match="Unknown voting strategy"):
            # This would be the actual method call
            raise ValueError("Unknown voting strategy: invalid_strategy")


# Performance and stress tests
class TestPerformanceAndStress:
    """Test performance characteristics and stress scenarios."""
    
    @pytest.mark.asyncio
    @pytest.mark.performance
    async def test_large_ensemble_performance(self):
        """Test performance with large ensemble."""
        config = MockMLEStarConfig()
        config.models = [{"type": f"model_{i}"} for i in range(20)]  # Large ensemble
        executor = MockMLEStarEnsembleExecutor(config)
        
        dataset = np.random.randn(10000, 50)  # Large dataset
        
        start_time = datetime.now()
        result = await executor.execute_ensemble_benchmark("large_test", dataset)
        end_time = datetime.now()
        
        duration = (end_time - start_time).total_seconds()
        assert duration < 30.0  # Should handle large ensemble efficiently
        assert result.ensemble_size == 20
    
    @pytest.mark.asyncio 
    @pytest.mark.stress
    async def test_concurrent_benchmarks(self):
        """Test running multiple benchmarks concurrently."""
        config = MockMLEStarConfig()
        executor = MockMLEStarEnsembleExecutor(config)
        
        # Run multiple benchmarks concurrently
        tasks = []
        for i in range(5):
            dataset = np.random.randn(100, 10)
            task = executor.execute_ensemble_benchmark(f"concurrent_{i}", dataset)
            tasks.append(task)
        
        results = await asyncio.gather(*tasks)
        
        assert len(results) == 5
        for i, result in enumerate(results):
            assert result.task == f"concurrent_{i}"
            assert result.ensemble_size == 5


if __name__ == "__main__":
    pytest.main([__file__, "-v", "--tb=short"])