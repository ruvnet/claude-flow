"""Auto strategy that automatically selects the best approach."""

import re
from typing import Dict, Any
from swarm_benchmark.core.models import Task, Result, ResultStatus
from .base_strategy import BaseStrategy


class AutoStrategy(BaseStrategy):
    """Strategy that automatically determines the best approach."""
    
    def __init__(self):
        """Initialize the auto strategy."""
        super().__init__()
        self._selection_count = {}
        self._strategy_patterns = {
            "research": [
                r"\bresearch\b", r"\binvestigate\b", r"\banalyze\b", r"\bstudy\b",
                r"\bexplore\b", r"\bfind out\b", r"\blearn about\b", r"\bgather\b"
            ],
            "development": [
                r"\bbuild\b", r"\bcreate\b", r"\bdevelop\b", r"\bimplement\b",
                r"\bcode\b", r"\bapi\b", r"\bapplication\b", r"\bsoftware\b"
            ],
            "analysis": [
                r"\banalyze\b", r"\bprocess\b", r"\bdata\b", r"\bmetrics\b",
                r"\btrends\b", r"\bpatterns\b", r"\binsights\b", r"\bstatistics\b"
            ],
            "testing": [
                r"\btest\b", r"\bvalidate\b", r"\bverify\b", r"\bquality\b",
                r"\bbug\b", r"\berror\b", r"\bassurance\b", r"\bcheck\b"
            ],
            "optimization": [
                r"\boptimize\b", r"\bperformance\b", r"\bspeed\b", r"\befficiency\b",
                r"\bimprove\b", r"\bfaster\b", r"\btune\b", r"\bscale\b"
            ],
            "maintenance": [
                r"\bmaintain\b", r"\bupdate\b", r"\bfix\b", r"\brefactor\b",
                r"\bcleanup\b", r"\brepair\b", r"\bupgrade\b", r"\bdocument\b"
            ]
        }
    
    @property
    def name(self) -> str:
        """Strategy name."""
        return "auto"
    
    @property
    def description(self) -> str:
        """Strategy description."""
        return "Automatically determine best approach"
    
    def select_best_strategy(self, task: Task) -> str:
        """Select the best strategy for a given task.
        
        Args:
            task: Task to analyze
            
        Returns:
            Name of the selected strategy
        """
        # Use both objective and description for analysis
        text_to_analyze = f"{task.objective} {task.description}".lower()
        
        # Score each strategy based on pattern matches
        strategy_scores = {}
        for strategy_name, patterns in self._strategy_patterns.items():
            score = 0
            for pattern in patterns:
                matches = len(re.findall(pattern, text_to_analyze))
                score += matches
            strategy_scores[strategy_name] = score
        
        # Return strategy with highest score, default to research if tied
        if not strategy_scores or max(strategy_scores.values()) == 0:
            return "research"  # Default fallback
        
        best_strategy = max(strategy_scores.items(), key=lambda x: x[1])[0]
        
        # Update selection count
        self._selection_count[best_strategy] = self._selection_count.get(best_strategy, 0) + 1
        
        return best_strategy
    
    async def execute(self, task: Task) -> Result:
        """Execute a task by delegating to the best strategy.
        
        Args:
            task: Task to execute
            
        Returns:
            Execution result
        """
        selected_strategy = self.select_best_strategy(task)
        
        # Delegate to the selected strategy
        result = await self._delegate_to_strategy(selected_strategy, task)
        
        # Record the execution
        self._record_execution(task, result)
        
        return result
    
    async def _delegate_to_strategy(self, strategy_name: str, task: Task) -> Result:
        """Delegate execution to a specific strategy.
        
        Args:
            strategy_name: Name of strategy to delegate to
            task: Task to execute
            
        Returns:
            Execution result
        """
        # Import here to avoid circular imports
        from . import create_strategy
        
        # Create the selected strategy (avoiding infinite recursion for auto)
        if strategy_name == "auto":
            strategy_name = "research"  # Fallback
        
        strategy = create_strategy(strategy_name)
        return await strategy.execute(task)
    
    def get_metrics(self) -> Dict[str, Any]:
        """Get auto strategy metrics.
        
        Returns:
            Dictionary of metrics
        """
        return {
            "strategy_type": "auto",
            "selection_count": self._selection_count.copy(),
            "execution_history": self.execution_history.copy(),
            "total_executions": self.execution_count
        }