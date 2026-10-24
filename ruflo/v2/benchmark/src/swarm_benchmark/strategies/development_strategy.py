"""Development strategy for software development and coding tasks."""

import asyncio
from typing import Dict, Any
from datetime import datetime
from swarm_benchmark.core.models import Task, Result, ResultStatus, ResourceUsage, PerformanceMetrics
from .base_strategy import BaseStrategy


class DevelopmentStrategy(BaseStrategy):
    """Strategy for software development and coding tasks."""
    
    def __init__(self):
        """Initialize the development strategy."""
        super().__init__()
        self.claude_flow_client = None
        self._code_quality = 0.0
        self._test_coverage = 0.0
        self._lines_of_code = 0
    
    @property
    def name(self) -> str:
        """Strategy name."""
        return "development"
    
    @property
    def description(self) -> str:
        """Strategy description."""
        return "Software development and coding"
    
    async def execute(self, task: Task) -> Result:
        """Execute a development task.
        
        Args:
            task: Development task to execute
            
        Returns:
            Development result
        """
        start_time = datetime.now()
        
        try:
            # Execute development through claude-flow swarm
            if self.claude_flow_client:
                swarm_result = await self.claude_flow_client.execute_swarm(
                    objective=task.objective,
                    strategy="development",
                    mode=task.mode.value if hasattr(task.mode, 'value') else task.mode,
                    **task.parameters
                )
                
                # Process swarm result
                if swarm_result.get("status") == "success":
                    execution_time = (datetime.now() - start_time).total_seconds()
                    metrics = swarm_result.get("metrics", {})
                    
                    result = Result(
                        task_id=task.id,
                        agent_id="development-agent",
                        status=ResultStatus.SUCCESS,
                        output={
                            "code_implementation": swarm_result.get("output", ""),
                            "files_created": metrics.get("files_created", []),
                            "lines_of_code": metrics.get("lines_of_code", 0),
                            "test_coverage": metrics.get("test_coverage", 0.0),
                            "code_quality": metrics.get("code_quality", 0.0)
                        },
                        performance_metrics=PerformanceMetrics(
                            execution_time=execution_time,
                            success_rate=1.0
                        ),
                        resource_usage=ResourceUsage(),
                        execution_details=metrics,
                        started_at=start_time,
                        completed_at=datetime.now()
                    )
                else:
                    execution_time = (datetime.now() - start_time).total_seconds()
                    result = Result(
                        task_id=task.id,
                        agent_id="development-agent", 
                        status=ResultStatus.FAILURE,
                        output={},
                        performance_metrics=PerformanceMetrics(
                            execution_time=execution_time,
                            success_rate=0.0,
                            error_rate=1.0
                        ),
                        errors=[swarm_result.get("error", "Unknown development error")],
                        started_at=start_time,
                        completed_at=datetime.now()
                    )
            else:
                # Simulate development execution for testing
                await asyncio.sleep(0.2)  # Simulate longer work
                execution_time = (datetime.now() - start_time).total_seconds()
                
                result = Result(
                    task_id=task.id,
                    agent_id="development-agent",
                    status=ResultStatus.SUCCESS,
                    output={
                        "code_implementation": f"Code implementation completed for: {task.objective}",
                        "files_created": ["main.py", "utils.py", "tests.py"],
                        "lines_of_code": 250,
                        "test_coverage": 0.95,
                        "code_quality": 0.9
                    },
                    performance_metrics=PerformanceMetrics(
                        execution_time=execution_time,
                        success_rate=1.0
                    ),
                    resource_usage=ResourceUsage(cpu_percent=25.0, memory_mb=256),
                    started_at=start_time,
                    completed_at=datetime.now()
                )
            
            # Update strategy metrics
            output = result.output
            self._lines_of_code += output.get("lines_of_code", 0)
            if output.get("test_coverage"):
                self._test_coverage = (self._test_coverage + output["test_coverage"]) / 2
            if output.get("code_quality"):
                self._code_quality = (self._code_quality + output["code_quality"]) / 2
            
            # Record execution
            self._record_execution(task, result)
            
            return result
            
        except Exception as e:
            execution_time = (datetime.now() - start_time).total_seconds()
            return Result(
                task_id=task.id,
                agent_id="development-agent",
                status=ResultStatus.ERROR,
                output={},
                performance_metrics=PerformanceMetrics(
                    execution_time=execution_time,
                    success_rate=0.0,
                    error_rate=1.0
                ),
                errors=[f"Development execution failed: {str(e)}"],
                started_at=start_time,
                completed_at=datetime.now()
            )
    
    def get_metrics(self) -> Dict[str, Any]:
        """Get development strategy metrics.
        
        Returns:
            Dictionary of metrics
        """
        return {
            "strategy_type": "development",
            "code_quality": self._code_quality,
            "test_coverage": self._test_coverage,
            "lines_of_code": self._lines_of_code,
            "execution_history": self.execution_history.copy(),
            "total_executions": self.execution_count,
            "average_loc_per_task": (
                self._lines_of_code / max(self.execution_count, 1)
            )
        }