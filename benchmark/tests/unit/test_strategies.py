"""Test cases for strategy framework."""

import pytest
from unittest.mock import AsyncMock, MagicMock

from swarm_benchmark.core.models import Task, Result, ResultStatus, ResourceUsage, StrategyType, CoordinationMode
from swarm_benchmark.strategies.base_strategy import BaseStrategy
from swarm_benchmark.strategies.auto_strategy import AutoStrategy
from swarm_benchmark.strategies.research_strategy import ResearchStrategy
from swarm_benchmark.strategies.development_strategy import DevelopmentStrategy


class TestBaseStrategy:
    """Test cases for BaseStrategy."""
    
    def test_base_strategy_is_abstract(self):
        """Test that BaseStrategy cannot be instantiated directly."""
        with pytest.raises(TypeError):
            BaseStrategy()


class TestAutoStrategy:
    """Test cases for AutoStrategy."""
    
    def test_auto_strategy_creation(self):
        """Test auto strategy instantiation."""
        strategy = AutoStrategy()
        assert strategy.name == "auto"
        assert strategy.description == "Automatically determine best approach"
    
    def test_auto_strategy_selection(self):
        """Test strategy selection logic."""
        strategy = AutoStrategy()
        
        # Test research task detection
        research_task = Task(
            objective="Research cloud architecture patterns"
        )
        selected = strategy.select_best_strategy(research_task)
        assert selected == "research"
        
        # Test development task detection
        dev_task = Task(
            objective="Build a REST API for user management"
        )
        selected = strategy.select_best_strategy(dev_task)
        assert selected == "development"
        
        # Test analysis task detection
        analysis_task = Task(
            objective="Analyze data trends in user behavior"
        )
        selected = strategy.select_best_strategy(analysis_task)
        assert selected == "analysis"
    
    @pytest.mark.asyncio
    async def test_auto_strategy_execution(self):
        """Test auto strategy execution."""
        strategy = AutoStrategy()
        task = Task(objective="Test objective")
        
        # Mock the delegate execution
        strategy._delegate_to_strategy = AsyncMock(return_value=Result(
            task_id=task.id,
            agent_id="auto-agent",
            status=ResultStatus.SUCCESS,
            output={"result": "success"}
        ))
        
        result = await strategy.execute(task)
        assert result.status == ResultStatus.SUCCESS
        assert result.task_id == task.id
        assert result.agent_id == "auto-agent"
    
    def test_auto_strategy_metrics(self):
        """Test auto strategy metrics collection."""
        strategy = AutoStrategy()
        metrics = strategy.get_metrics()
        
        assert "strategy_type" in metrics
        assert "selection_count" in metrics
        assert "execution_history" in metrics
        assert metrics["strategy_type"] == "auto"


class TestResearchStrategy:
    """Test cases for ResearchStrategy."""
    
    def test_research_strategy_creation(self):
        """Test research strategy instantiation."""
        strategy = ResearchStrategy()
        assert strategy.name == "research"
        assert strategy.description == "Research and information gathering"
    
    @pytest.mark.asyncio
    async def test_research_strategy_execution(self):
        """Test research strategy execution."""
        strategy = ResearchStrategy()
        task = Task(objective="Research microservices architecture")
        
        # Mock the claude-flow client
        strategy.claude_flow_client = AsyncMock()
        strategy.claude_flow_client.execute_swarm.return_value = {
            "status": "success",
            "output": "Research findings...",
            "metrics": {"duration": 120}
        }
        
        result = await strategy.execute(task)
        assert result.status == ResultStatus.SUCCESS
        assert result.task_id == task.id
        assert "research" in str(result.output).lower()
    
    def test_research_strategy_metrics(self):
        """Test research strategy metrics."""
        strategy = ResearchStrategy()
        metrics = strategy.get_metrics()
        
        assert "strategy_type" in metrics
        assert "research_depth" in metrics
        assert "sources_consulted" in metrics
        assert metrics["strategy_type"] == "research"


class TestDevelopmentStrategy:
    """Test cases for DevelopmentStrategy."""
    
    def test_development_strategy_creation(self):
        """Test development strategy instantiation."""
        strategy = DevelopmentStrategy()
        assert strategy.name == "development"
        assert strategy.description == "Software development and coding"
    
    @pytest.mark.asyncio
    async def test_development_strategy_execution(self):
        """Test development strategy execution."""
        strategy = DevelopmentStrategy()
        task = Task(objective="Build user authentication API")
        
        # Mock the claude-flow client
        strategy.claude_flow_client = AsyncMock()
        strategy.claude_flow_client.execute_swarm.return_value = {
            "status": "success",
            "output": "Code implementation completed",
            "metrics": {"lines_of_code": 500, "test_coverage": 0.95}
        }
        
        result = await strategy.execute(task)
        assert result.status == ResultStatus.SUCCESS
        assert result.task_id == task.id
        assert "implementation" in str(result.output).lower() or "code" in str(result.output).lower()
    
    def test_development_strategy_metrics(self):
        """Test development strategy metrics."""
        strategy = DevelopmentStrategy()
        metrics = strategy.get_metrics()
        
        assert "strategy_type" in metrics
        assert "code_quality" in metrics
        assert "test_coverage" in metrics
        assert metrics["strategy_type"] == "development"


class TestStrategyFactory:
    """Test cases for strategy factory."""
    
    def test_strategy_creation_by_name(self):
        """Test creating strategies by name."""
        from swarm_benchmark.strategies import create_strategy
        
        auto_strategy = create_strategy("auto")
        assert isinstance(auto_strategy, AutoStrategy)
        
        research_strategy = create_strategy("research") 
        assert isinstance(research_strategy, ResearchStrategy)
        
        dev_strategy = create_strategy("development")
        assert isinstance(dev_strategy, DevelopmentStrategy)
    
    def test_invalid_strategy_name(self):
        """Test handling of invalid strategy names."""
        from swarm_benchmark.strategies import create_strategy
        
        with pytest.raises(ValueError):
            create_strategy("invalid_strategy")
    
    def test_available_strategies(self):
        """Test getting list of available strategies."""
        from swarm_benchmark.strategies import get_available_strategies
        
        strategies = get_available_strategies()
        expected_strategies = ["auto", "research", "development", "analysis", "testing", "optimization", "maintenance"]
        
        for strategy in expected_strategies:
            assert strategy in strategies