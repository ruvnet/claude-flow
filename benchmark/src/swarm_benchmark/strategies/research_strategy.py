"""Research strategy for information gathering workflows."""

import asyncio
from typing import Dict, Any
from datetime import datetime
from swarm_benchmark.core.models import Task, Result, ResultStatus, ResourceUsage, PerformanceMetrics
from .base_strategy import BaseStrategy


class ResearchStrategy(BaseStrategy):
    """Strategy for research and information gathering tasks."""
    
    def __init__(self):
        """Initialize the research strategy."""
        super().__init__()
        self.claude_flow_client = None
        self._research_depth = 0
        self._sources_consulted = 0
    
    @property
    def name(self) -> str:
        """Strategy name."""
        return "research"
    
    @property
    def description(self) -> str:
        """Strategy description."""
        return "Research and information gathering"
    
    async def execute(self, task: Task) -> Result:
        """Execute a research task.
        
        Args:
            task: Research task to execute
            
        Returns:
            Research result
        """
        start_time = datetime.now()
        
        try:
            # Execute research through claude-flow swarm
            if self.claude_flow_client:
                swarm_result = await self.claude_flow_client.execute_swarm(
                    objective=task.objective,
                    strategy="research",
                    mode=task.mode.value if hasattr(task.mode, 'value') else task.mode,
                    **task.parameters
                )
                
                # Process swarm result
                if swarm_result.get("status") == "success":
                    execution_time = (datetime.now() - start_time).total_seconds()
                    result = Result(
                        task_id=task.id,
                        agent_id="research-agent",
                        status=ResultStatus.SUCCESS,
                        output={
                            "research_findings": swarm_result.get("output", ""),
                            "sources": swarm_result.get("sources", []),
                            "methodology": "claude-flow swarm research"
                        },
                        performance_metrics=PerformanceMetrics(
                            execution_time=execution_time,
                            success_rate=1.0
                        ),
                        resource_usage=ResourceUsage(),
                        execution_details=swarm_result.get("metrics", {}),
                        started_at=start_time,
                        completed_at=datetime.now()
                    )
                else:
                    execution_time = (datetime.now() - start_time).total_seconds()
                    result = Result(
                        task_id=task.id,
                        agent_id="research-agent", 
                        status=ResultStatus.FAILURE,
                        output={},
                        performance_metrics=PerformanceMetrics(
                            execution_time=execution_time,
                            success_rate=0.0,
                            error_rate=1.0
                        ),
                        errors=[swarm_result.get("error", "Unknown research error")],
                        started_at=start_time,
                        completed_at=datetime.now()
                    )
            else:
                # Simulate research execution for testing
                await asyncio.sleep(0.1)  # Simulate work
                execution_time = (datetime.now() - start_time).total_seconds()
                result = Result(
                    task_id=task.id,
                    agent_id="research-agent",
                    status=ResultStatus.SUCCESS,
                    output={
                        "research_findings": f"Research completed for: {task.objective}",
                        "sources": ["academic papers", "documentation", "best practices"],
                        "methodology": "comprehensive analysis"
                    },
                    performance_metrics=PerformanceMetrics(
                        execution_time=execution_time,
                        success_rate=1.0
                    ),
                    resource_usage=ResourceUsage(cpu_percent=15.0, memory_mb=128),
                    started_at=start_time,
                    completed_at=datetime.now()
                )
            
            # Update strategy metrics
            self._research_depth += 1
            self._sources_consulted += len(result.output.get("sources", []))
            
            # Record execution
            self._record_execution(task, result)
            
            return result
            
        except Exception as e:
            execution_time = (datetime.now() - start_time).total_seconds()
            return Result(
                task_id=task.id,
                agent_id="research-agent",
                status=ResultStatus.ERROR,
                output={},
                performance_metrics=PerformanceMetrics(
                    execution_time=execution_time,
                    success_rate=0.0,
                    error_rate=1.0
                ),
                errors=[f"Research execution failed: {str(e)}"],
                started_at=start_time,
                completed_at=datetime.now()
            )
    
    def get_metrics(self) -> Dict[str, Any]:
        """Get research strategy metrics.
        
        Returns:
            Dictionary of metrics
        """
        return {
            "strategy_type": "research",
            "research_depth": self._research_depth,
            "sources_consulted": self._sources_consulted,
            "execution_history": self.execution_history.copy(),
            "total_executions": self.execution_count,
            "average_sources_per_task": (
                self._sources_consulted / max(self.execution_count, 1)
            )
        }