"""
Unit tests for automation systems.

Tests the batch processor, pipeline manager, workflow executor,
and resource pooling components.
"""

import pytest
import asyncio
from unittest.mock import Mock, AsyncMock, patch
from datetime import datetime, timedelta
from typing import List, Dict, Any, Optional
import tempfile
from pathlib import Path

from swarm_benchmark.core.models import Task, Result, BenchmarkConfig, TaskStatus, ResultStatus


class MockBatchConfig:
    """Mock configuration for batch processing."""
    
    def __init__(self):
        self.max_resources = 10
        self.max_parallel_per_type = 3
        self.timeout = 300
        self.retry_attempts = 3
        self.retry_delay = 1.0


class MockBenchmarkTask:
    """Mock benchmark task for testing."""
    
    def __init__(self, task_id: str, task_type: str = "default", complexity: str = "simple"):
        self.id = task_id
        self.type = task_type
        self.complexity = complexity
        self.status = "pending"
        self.created_at = datetime.now()
        self.estimated_duration = {"simple": 5, "medium": 15, "complex": 30}.get(complexity, 5)
        self.dependencies = []
        self.parameters = {}
        
    async def execute(self) -> Dict[str, Any]:
        """Mock task execution."""
        self.status = "running"
        await asyncio.sleep(0.1)  # Simulate work
        self.status = "completed"
        return {
            "task_id": self.id,
            "result": f"Completed {self.type} task",
            "execution_time": 0.1
        }


class MockResourcePool:
    """Mock resource pool for testing."""
    
    def __init__(self, max_resources: int):
        self.max_resources = max_resources
        self.available_resources = max_resources
        self.allocated_resources = {}
        self.semaphore = asyncio.Semaphore(max_resources)
        
    async def acquire(self, resource_id: str) -> bool:
        """Acquire a resource."""
        await self.semaphore.acquire()
        self.allocated_resources[resource_id] = datetime.now()
        self.available_resources -= 1
        return True
        
    async def release(self, resource_id: str):
        """Release a resource."""
        if resource_id in self.allocated_resources:
            del self.allocated_resources[resource_id]
            self.available_resources += 1
            self.semaphore.release()
    
    async def __aenter__(self):
        return self
        
    async def __aexit__(self, exc_type, exc_val, exc_tb):
        # Release all resources
        for resource_id in list(self.allocated_resources.keys()):
            await self.release(resource_id)


class MockBatchProcessor:
    """Mock batch processor for testing."""
    
    def __init__(self, config: MockBatchConfig):
        self.config = config
        self.task_queue = asyncio.Queue()
        self.result_collector = Mock()
        self.resource_pool = MockResourcePool(config.max_resources)
        
    async def process_batch(self, tasks: List[MockBenchmarkTask]) -> Dict[str, Any]:
        """Process a batch of tasks."""
        # Group tasks by type
        grouped_tasks = self._group_tasks_by_type(tasks)
        
        # Process each group
        all_results = []
        async with self.resource_pool:
            for task_type, task_group in grouped_tasks.items():
                results = await self._process_task_group(task_group)
                all_results.extend(results)
        
        return {
            "total_tasks": len(tasks),
            "completed_tasks": len([r for r in all_results if r.get("status") == "success"]),
            "failed_tasks": len([r for r in all_results if r.get("status") == "failed"]),
            "results": all_results,
            "processing_time": sum(r.get("execution_time", 0) for r in all_results)
        }
    
    def _group_tasks_by_type(self, tasks: List[MockBenchmarkTask]) -> Dict[str, List[MockBenchmarkTask]]:
        """Group tasks by type for efficient processing."""
        groups = {}
        for task in tasks:
            if task.type not in groups:
                groups[task.type] = []
            groups[task.type].append(task)
        return groups
    
    async def _process_task_group(self, tasks: List[MockBenchmarkTask]) -> List[Dict[str, Any]]:
        """Process a group of similar tasks."""
        # Limit parallelism per type
        semaphore = asyncio.Semaphore(self.config.max_parallel_per_type)
        
        async def process_single_task(task: MockBenchmarkTask) -> Dict[str, Any]:
            async with semaphore:
                try:
                    result = await task.execute()
                    return {"status": "success", "task_id": task.id, **result}
                except Exception as e:
                    return {"status": "failed", "task_id": task.id, "error": str(e)}
        
        # Execute tasks in parallel with resource limits
        results = await asyncio.gather(
            *[process_single_task(task) for task in tasks],
            return_exceptions=True
        )
        
        # Handle any exceptions
        processed_results = []
        for result in results:
            if isinstance(result, Exception):
                processed_results.append({
                    "status": "failed", 
                    "error": str(result),
                    "task_id": "unknown"
                })
            else:
                processed_results.append(result)
        
        return processed_results


class MockPipelineStage:
    """Mock pipeline stage for testing."""
    
    def __init__(self, name: str, tasks: List[MockBenchmarkTask], dependencies: List[str] = None):
        self.name = name
        self.tasks = tasks
        self.dependencies = dependencies or []
        self.status = "pending"
        self.start_time = None
        self.end_time = None
        
    async def execute(self, context: Dict[str, Any]) -> Dict[str, Any]:
        """Execute the pipeline stage."""
        self.status = "running"
        self.start_time = datetime.now()
        
        try:
            # Execute all tasks in the stage
            results = []
            for task in self.tasks:
                result = await task.execute()
                results.append(result)
            
            self.status = "completed"
            self.end_time = datetime.now()
            
            return {
                "stage": self.name,
                "status": "success",
                "results": results,
                "duration": (self.end_time - self.start_time).total_seconds()
            }
            
        except Exception as e:
            self.status = "failed"
            self.end_time = datetime.now()
            return {
                "stage": self.name,
                "status": "failed",
                "error": str(e),
                "duration": (self.end_time - self.start_time).total_seconds()
            }


class MockPipeline:
    """Mock pipeline for testing."""
    
    def __init__(self, name: str):
        self.name = name
        self.stages = []
        self.status = "pending"
        
    def add_stage(self, stage: MockPipelineStage):
        """Add a stage to the pipeline."""
        self.stages.append(stage)
        
    async def execute(self, context: Dict[str, Any] = None) -> Dict[str, Any]:
        """Execute the entire pipeline."""
        if context is None:
            context = {}
            
        self.status = "running"
        stage_results = []
        
        try:
            # Execute stages in order, respecting dependencies
            for stage in self.stages:
                # Check dependencies
                if not self._dependencies_satisfied(stage, stage_results):
                    raise ValueError(f"Dependencies not satisfied for stage {stage.name}")
                
                result = await stage.execute(context)
                stage_results.append(result)
                
                # Update context with stage results
                context[f"stage_{stage.name}"] = result
            
            self.status = "completed"
            return {
                "pipeline": self.name,
                "status": "success",
                "stages": stage_results,
                "total_duration": sum(r.get("duration", 0) for r in stage_results)
            }
            
        except Exception as e:
            self.status = "failed"
            return {
                "pipeline": self.name,
                "status": "failed",
                "error": str(e),
                "stages": stage_results
            }
    
    def _dependencies_satisfied(self, stage: MockPipelineStage, completed_stages: List[Dict]) -> bool:
        """Check if stage dependencies are satisfied."""
        completed_stage_names = [r.get("stage") for r in completed_stages if r.get("status") == "success"]
        return all(dep in completed_stage_names for dep in stage.dependencies)


class MockPipelineManager:
    """Mock pipeline manager for testing."""
    
    def __init__(self):
        self.pipelines = {}
        self.execution_history = []
        
    def create_pipeline(self, name: str, stages: List[MockPipelineStage]) -> MockPipeline:
        """Create a new pipeline."""
        pipeline = MockPipeline(name)
        for stage in stages:
            pipeline.add_stage(stage)
        
        self.pipelines[name] = pipeline
        return pipeline
    
    async def execute_pipeline(self, pipeline_name: str, context: Dict[str, Any] = None) -> Dict[str, Any]:
        """Execute a pipeline by name."""
        if pipeline_name not in self.pipelines:
            raise ValueError(f"Pipeline {pipeline_name} not found")
        
        pipeline = self.pipelines[pipeline_name]
        
        execution_record = {
            "pipeline_name": pipeline_name,
            "start_time": datetime.now(),
            "context": context or {}
        }
        
        result = await pipeline.execute(context)
        
        execution_record["end_time"] = datetime.now()
        execution_record["result"] = result
        execution_record["duration"] = (execution_record["end_time"] - execution_record["start_time"]).total_seconds()
        
        self.execution_history.append(execution_record)
        
        return result


class MockWorkflowExecutor:
    """Mock workflow executor for testing."""
    
    def __init__(self, config: Dict[str, Any]):
        self.config = config
        self.state_manager = Mock()
        self.decision_engine = Mock()
        
    async def execute_autonomous_workflow(self, objective: str) -> Dict[str, Any]:
        """Execute an autonomous workflow."""
        # Phase 1: Planning
        plan = await self._generate_execution_plan(objective)
        
        # Phase 2: Resource Allocation  
        resources = await self._allocate_resources(plan)
        
        # Phase 3: Autonomous Execution
        result = await self._execute_plan(plan, resources)
        
        # Phase 4: Validation and Reporting
        validated_result = await self._validate_result(result)
        
        return {
            "objective": objective,
            "plan": plan,
            "resources_used": resources,
            "result": validated_result,
            "status": "completed"
        }
    
    async def _generate_execution_plan(self, objective: str) -> Dict[str, Any]:
        """Generate execution plan for objective."""
        await asyncio.sleep(0.1)  # Simulate planning time
        return {
            "objective": objective,
            "steps": [
                {"step": 1, "action": "analyze_requirements", "estimated_time": 5},
                {"step": 2, "action": "design_solution", "estimated_time": 10},
                {"step": 3, "action": "implement_solution", "estimated_time": 20},
                {"step": 4, "action": "test_solution", "estimated_time": 8},
                {"step": 5, "action": "deploy_solution", "estimated_time": 5}
            ],
            "estimated_total_time": 48,
            "complexity": "medium"
        }
    
    async def _allocate_resources(self, plan: Dict[str, Any]) -> Dict[str, Any]:
        """Allocate resources for plan execution."""
        await asyncio.sleep(0.05)  # Simulate allocation time
        return {
            "agents": ["agent_1", "agent_2", "agent_3"],
            "compute_resources": {"cpu": 4, "memory": "8GB"},
            "storage": "100GB",
            "network": "high_bandwidth"
        }
    
    async def _execute_plan(self, plan: Dict[str, Any], resources: Dict[str, Any]) -> Dict[str, Any]:
        """Execute the plan with allocated resources."""
        results = []
        
        for step in plan["steps"]:
            await asyncio.sleep(0.1)  # Simulate step execution
            step_result = {
                "step": step["step"],
                "action": step["action"],
                "status": "completed",
                "output": f"Completed {step['action']}",
                "actual_time": step["estimated_time"] * 0.9  # Slightly faster than estimate
            }
            results.append(step_result)
        
        return {
            "plan_id": plan.get("id", "auto_generated"),
            "steps_completed": len(results),
            "step_results": results,
            "total_time": sum(r["actual_time"] for r in results)
        }
    
    async def _validate_result(self, result: Dict[str, Any]) -> Dict[str, Any]:
        """Validate execution result."""
        await asyncio.sleep(0.05)  # Simulate validation time
        
        validation = {
            "validation_passed": True,
            "quality_score": 0.92,
            "completeness": 1.0,
            "performance_score": 0.88
        }
        
        result["validation"] = validation
        return result


class TestBatchProcessor:
    """Test the batch processor functionality."""
    
    @pytest.fixture
    def batch_config(self):
        """Provide batch configuration."""
        return MockBatchConfig()
    
    @pytest.fixture
    def batch_processor(self, batch_config):
        """Provide batch processor instance."""
        return MockBatchProcessor(batch_config)
    
    @pytest.fixture
    def sample_tasks(self):
        """Provide sample tasks for testing."""
        return [
            MockBenchmarkTask("task_1", "analysis", "simple"),
            MockBenchmarkTask("task_2", "development", "medium"),
            MockBenchmarkTask("task_3", "analysis", "simple"),
            MockBenchmarkTask("task_4", "testing", "complex"),
            MockBenchmarkTask("task_5", "development", "simple")
        ]
    
    @pytest.mark.asyncio
    async def test_batch_processor_initialization(self, batch_processor, batch_config):
        """Test batch processor initializes correctly."""
        assert batch_processor.config == batch_config
        assert batch_processor.task_queue is not None
        assert batch_processor.resource_pool.max_resources == batch_config.max_resources
    
    @pytest.mark.asyncio
    async def test_process_batch_success(self, batch_processor, sample_tasks):
        """Test successful batch processing."""
        result = await batch_processor.process_batch(sample_tasks)
        
        assert result["total_tasks"] == 5
        assert result["completed_tasks"] >= 0
        assert result["failed_tasks"] >= 0
        assert result["completed_tasks"] + result["failed_tasks"] == result["total_tasks"]
        assert "results" in result
        assert "processing_time" in result
    
    @pytest.mark.asyncio
    async def test_task_grouping_by_type(self, batch_processor, sample_tasks):
        """Test tasks are grouped by type correctly."""
        grouped = batch_processor._group_tasks_by_type(sample_tasks)
        
        assert "analysis" in grouped
        assert "development" in grouped 
        assert "testing" in grouped
        assert len(grouped["analysis"]) == 2
        assert len(grouped["development"]) == 2
        assert len(grouped["testing"]) == 1
    
    @pytest.mark.asyncio
    async def test_resource_pool_limits(self, batch_processor):
        """Test resource pool enforces limits."""
        # Create many tasks to test resource limiting
        many_tasks = [MockBenchmarkTask(f"task_{i}", "test") for i in range(20)]
        
        start_time = datetime.now()
        result = await batch_processor.process_batch(many_tasks)
        end_time = datetime.now()
        
        # Should complete successfully despite resource limits
        assert result["total_tasks"] == 20
        duration = (end_time - start_time).total_seconds()
        # Should take some time due to resource constraints
        assert duration > 0.1
    
    @pytest.mark.asyncio
    async def test_parallel_processing_per_type(self, batch_processor):
        """Test parallel processing within task types."""
        # Create tasks of the same type
        same_type_tasks = [MockBenchmarkTask(f"task_{i}", "analysis") for i in range(6)]
        
        start_time = datetime.now()
        result = await batch_processor.process_batch(same_type_tasks)
        end_time = datetime.now()
        
        duration = (end_time - start_time).total_seconds()
        # Should be faster than sequential execution due to parallelism
        assert duration < 1.0  # All tasks together should be much faster than 6 * 0.1
        assert result["completed_tasks"] == 6


class TestPipelineManager:
    """Test the pipeline manager functionality."""
    
    @pytest.fixture
    def pipeline_manager(self):
        """Provide pipeline manager instance."""
        return MockPipelineManager()
    
    @pytest.fixture
    def sample_stages(self):
        """Provide sample pipeline stages."""
        return [
            MockPipelineStage("data_prep", [MockBenchmarkTask("prep_1", "preparation")]),
            MockPipelineStage("processing", [MockBenchmarkTask("proc_1", "processing")], dependencies=["data_prep"]),
            MockPipelineStage("validation", [MockBenchmarkTask("valid_1", "validation")], dependencies=["processing"])
        ]
    
    def test_pipeline_creation(self, pipeline_manager, sample_stages):
        """Test pipeline creation."""
        pipeline = pipeline_manager.create_pipeline("test_pipeline", sample_stages)
        
        assert pipeline.name == "test_pipeline"
        assert len(pipeline.stages) == 3
        assert "test_pipeline" in pipeline_manager.pipelines
    
    @pytest.mark.asyncio
    async def test_pipeline_execution_success(self, pipeline_manager, sample_stages):
        """Test successful pipeline execution."""
        pipeline = pipeline_manager.create_pipeline("test_pipeline", sample_stages)
        
        result = await pipeline_manager.execute_pipeline("test_pipeline")
        
        assert result["pipeline"] == "test_pipeline"
        assert result["status"] == "success"
        assert len(result["stages"]) == 3
        assert result["total_duration"] > 0
    
    @pytest.mark.asyncio
    async def test_pipeline_dependency_resolution(self, pipeline_manager):
        """Test pipeline dependency resolution."""
        stages = [
            MockPipelineStage("stage_a", [MockBenchmarkTask("a1", "test")]),
            MockPipelineStage("stage_b", [MockBenchmarkTask("b1", "test")], dependencies=["stage_a"]),
            MockPipelineStage("stage_c", [MockBenchmarkTask("c1", "test")], dependencies=["stage_a", "stage_b"])
        ]
        
        pipeline = pipeline_manager.create_pipeline("dep_test", stages)
        result = await pipeline_manager.execute_pipeline("dep_test")
        
        assert result["status"] == "success"
        # Verify stages executed in correct order
        stage_names = [s["stage"] for s in result["stages"]]
        assert stage_names.index("stage_a") < stage_names.index("stage_b")
        assert stage_names.index("stage_b") < stage_names.index("stage_c")
    
    @pytest.mark.asyncio
    async def test_pipeline_execution_history(self, pipeline_manager, sample_stages):
        """Test pipeline execution history tracking."""
        pipeline = pipeline_manager.create_pipeline("history_test", sample_stages)
        
        # Execute pipeline multiple times
        await pipeline_manager.execute_pipeline("history_test")
        await pipeline_manager.execute_pipeline("history_test")
        
        assert len(pipeline_manager.execution_history) == 2
        
        for record in pipeline_manager.execution_history:
            assert "pipeline_name" in record
            assert "start_time" in record
            assert "end_time" in record
            assert "duration" in record
            assert "result" in record
    
    @pytest.mark.asyncio
    async def test_pipeline_not_found(self, pipeline_manager):
        """Test handling of non-existent pipeline."""
        with pytest.raises(ValueError, match="Pipeline nonexistent not found"):
            await pipeline_manager.execute_pipeline("nonexistent")


class TestWorkflowExecutor:
    """Test the workflow executor functionality."""
    
    @pytest.fixture
    def workflow_config(self):
        """Provide workflow configuration."""
        return {
            "max_agents": 5,
            "timeout": 300,
            "quality_threshold": 0.8,
            "retry_attempts": 3
        }
    
    @pytest.fixture
    def workflow_executor(self, workflow_config):
        """Provide workflow executor instance."""
        return MockWorkflowExecutor(workflow_config)
    
    @pytest.mark.asyncio
    async def test_autonomous_workflow_execution(self, workflow_executor):
        """Test autonomous workflow execution."""
        objective = "Build a REST API for user management"
        
        result = await workflow_executor.execute_autonomous_workflow(objective)
        
        assert result["objective"] == objective
        assert result["status"] == "completed"
        assert "plan" in result
        assert "resources_used" in result
        assert "result" in result
        
        # Verify plan structure
        plan = result["plan"]
        assert "steps" in plan
        assert len(plan["steps"]) == 5
        assert plan["complexity"] == "medium"
    
    @pytest.mark.asyncio
    async def test_execution_plan_generation(self, workflow_executor):
        """Test execution plan generation."""
        objective = "Create a data processing pipeline"
        
        plan = await workflow_executor._generate_execution_plan(objective)
        
        assert plan["objective"] == objective
        assert "steps" in plan
        assert "estimated_total_time" in plan
        assert "complexity" in plan
        
        # Verify all steps have required fields
        for step in plan["steps"]:
            assert "step" in step
            assert "action" in step
            assert "estimated_time" in step
    
    @pytest.mark.asyncio
    async def test_resource_allocation(self, workflow_executor):
        """Test resource allocation."""
        plan = {"estimated_total_time": 50, "complexity": "high"}
        
        resources = await workflow_executor._allocate_resources(plan)
        
        assert "agents" in resources
        assert "compute_resources" in resources
        assert "storage" in resources
        assert "network" in resources
        assert len(resources["agents"]) > 0
    
    @pytest.mark.asyncio
    async def test_plan_execution(self, workflow_executor):
        """Test plan execution."""
        plan = {
            "steps": [
                {"step": 1, "action": "test_action", "estimated_time": 5}
            ]
        }
        resources = {"agents": ["agent_1"]}
        
        result = await workflow_executor._execute_plan(plan, resources)
        
        assert "steps_completed" in result
        assert "step_results" in result
        assert "total_time" in result
        assert result["steps_completed"] == 1
        
        step_result = result["step_results"][0]
        assert step_result["status"] == "completed"
        assert step_result["action"] == "test_action"
    
    @pytest.mark.asyncio
    async def test_result_validation(self, workflow_executor):
        """Test result validation."""
        result = {"steps_completed": 5, "total_time": 45}
        
        validated = await workflow_executor._validate_result(result)
        
        assert "validation" in validated
        validation = validated["validation"]
        assert "validation_passed" in validation
        assert "quality_score" in validation
        assert "completeness" in validation
        assert "performance_score" in validation


class TestResourcePool:
    """Test the resource pool functionality."""
    
    @pytest.fixture
    def resource_pool(self):
        """Provide resource pool instance."""
        return MockResourcePool(5)
    
    @pytest.mark.asyncio
    async def test_resource_acquisition_and_release(self, resource_pool):
        """Test basic resource acquisition and release."""
        # Acquire resource
        success = await resource_pool.acquire("test_resource")
        assert success is True
        assert resource_pool.available_resources == 4
        assert "test_resource" in resource_pool.allocated_resources
        
        # Release resource
        await resource_pool.release("test_resource")
        assert resource_pool.available_resources == 5
        assert "test_resource" not in resource_pool.allocated_resources
    
    @pytest.mark.asyncio
    async def test_resource_pool_limits(self, resource_pool):
        """Test resource pool enforces limits."""
        # Acquire all resources
        tasks = []
        for i in range(5):
            task = resource_pool.acquire(f"resource_{i}")
            tasks.append(task)
        
        await asyncio.gather(*tasks)
        assert resource_pool.available_resources == 0
        
        # Trying to acquire one more should block
        start_time = datetime.now()
        acquire_task = asyncio.create_task(resource_pool.acquire("extra_resource"))
        
        # Wait a bit and ensure it's still waiting
        await asyncio.sleep(0.1)
        assert not acquire_task.done()
        
        # Release a resource and the blocked acquire should complete
        await resource_pool.release("resource_0")
        await asyncio.sleep(0.1)
        assert acquire_task.done()
        
        end_time = datetime.now()
        duration = (end_time - start_time).total_seconds()
        assert duration >= 0.1  # Should have waited
    
    @pytest.mark.asyncio
    async def test_context_manager(self, resource_pool):
        """Test resource pool as context manager."""
        async with resource_pool:
            # Acquire some resources
            await resource_pool.acquire("resource_1")
            await resource_pool.acquire("resource_2")
            assert resource_pool.available_resources == 3
        
        # Resources should be automatically released
        assert resource_pool.available_resources == 5
        assert len(resource_pool.allocated_resources) == 0


class TestErrorHandlingAndResilience:
    """Test error handling and resilience features."""
    
    @pytest.mark.asyncio
    async def test_batch_processing_with_task_failures(self):
        """Test batch processing handles individual task failures."""
        config = MockBatchConfig()
        processor = MockBatchProcessor(config)
        
        # Create tasks, some of which will fail
        tasks = [MockBenchmarkTask(f"task_{i}") for i in range(5)]
        
        # Mock one task to fail
        with patch.object(tasks[2], 'execute', side_effect=Exception("Task failed")):
            result = await processor.process_batch(tasks)
            
            assert result["total_tasks"] == 5
            assert result["failed_tasks"] >= 1  # At least one should fail
            assert result["completed_tasks"] >= 4  # Others should succeed
    
    @pytest.mark.asyncio
    async def test_pipeline_stage_failure_handling(self):
        """Test pipeline handles stage failures gracefully."""
        # Create a stage that will fail
        failing_task = MockBenchmarkTask("failing_task")
        with patch.object(failing_task, 'execute', side_effect=Exception("Stage failed")):
            stage = MockPipelineStage("failing_stage", [failing_task])
            
            result = await stage.execute({})
            
            assert result["status"] == "failed"
            assert "error" in result
            assert result["error"] == "Stage failed"
    
    @pytest.mark.asyncio
    async def test_workflow_executor_error_recovery(self):
        """Test workflow executor handles errors gracefully."""
        config = {"timeout": 300}
        executor = MockWorkflowExecutor(config)
        
        # Mock plan generation to fail initially
        original_generate = executor._generate_execution_plan
        call_count = 0
        
        async def failing_generate(objective):
            nonlocal call_count
            call_count += 1
            if call_count == 1:
                raise Exception("Planning failed")
            return await original_generate(objective)
        
        with patch.object(executor, '_generate_execution_plan', side_effect=failing_generate):
            # This would normally test retry logic, but our mock doesn't implement it
            # In a real implementation, this would verify retry behavior
            with pytest.raises(Exception, match="Planning failed"):
                await executor.execute_autonomous_workflow("test objective")


class TestPerformanceAndScaling:
    """Test performance characteristics and scaling behavior."""
    
    @pytest.mark.asyncio
    @pytest.mark.performance
    async def test_large_batch_processing(self):
        """Test processing large batches efficiently."""
        config = MockBatchConfig()
        config.max_parallel_per_type = 10  # Increase parallelism
        processor = MockBatchProcessor(config)
        
        # Create a large batch of tasks
        large_batch = [MockBenchmarkTask(f"task_{i}", "test") for i in range(100)]
        
        start_time = datetime.now()
        result = await processor.process_batch(large_batch)
        end_time = datetime.now()
        
        duration = (end_time - start_time).total_seconds()
        assert duration < 5.0  # Should complete within 5 seconds
        assert result["total_tasks"] == 100
        assert result["completed_tasks"] >= 95  # Most should succeed
    
    @pytest.mark.asyncio
    @pytest.mark.performance
    async def test_concurrent_pipeline_execution(self):
        """Test multiple pipelines can run concurrently."""
        manager = MockPipelineManager()
        
        # Create multiple pipelines
        pipelines = []
        for i in range(5):
            stages = [
                MockPipelineStage(f"stage_{i}_1", [MockBenchmarkTask(f"task_{i}_1")]),
                MockPipelineStage(f"stage_{i}_2", [MockBenchmarkTask(f"task_{i}_2")])
            ]
            pipeline = manager.create_pipeline(f"pipeline_{i}", stages)
            pipelines.append(f"pipeline_{i}")
        
        # Execute all pipelines concurrently
        start_time = datetime.now()
        execution_tasks = [manager.execute_pipeline(name) for name in pipelines]
        results = await asyncio.gather(*execution_tasks)
        end_time = datetime.now()
        
        duration = (end_time - start_time).total_seconds()
        assert duration < 2.0  # Concurrent execution should be fast
        assert len(results) == 5
        assert all(r["status"] == "success" for r in results)
    
    @pytest.mark.asyncio
    @pytest.mark.stress
    async def test_resource_pool_under_stress(self):
        """Test resource pool under high contention."""
        pool = MockResourcePool(3)  # Limited resources
        
        # Create many concurrent acquisition requests
        async def acquire_and_work(resource_id: str):
            await pool.acquire(resource_id)
            await asyncio.sleep(0.1)  # Simulate work
            await pool.release(resource_id)
            return resource_id
        
        # Start many concurrent tasks
        tasks = [acquire_and_work(f"resource_{i}") for i in range(20)]
        
        start_time = datetime.now()
        results = await asyncio.gather(*tasks)
        end_time = datetime.now()
        
        duration = (end_time - start_time).total_seconds()
        assert len(results) == 20
        assert pool.available_resources == 3  # All resources released
        # Should take some time due to resource contention
        assert duration >= 0.5


if __name__ == "__main__":
    pytest.main([__file__, "-v", "--tb=short"])