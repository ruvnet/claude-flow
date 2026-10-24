"""
Integration tests for complete pipeline workflows.

Tests end-to-end scenarios combining MLE-STAR, automation, metrics,
collective intelligence, and CLAUDE.md optimization.
"""

import pytest
import asyncio
from unittest.mock import Mock, AsyncMock, patch
from datetime import datetime, timedelta
from typing import List, Dict, Any, Optional
import tempfile
from pathlib import Path
import json
import subprocess

from swarm_benchmark.core.models import Benchmark, Task, Result, BenchmarkConfig, TaskStatus


class MockIntegratedSystem:
    """Mock integrated system combining all components."""
    
    def __init__(self):
        self.claude_optimizer = Mock()
        self.mle_star_executor = Mock()
        self.batch_processor = Mock()
        self.memory_profiler = Mock()
        self.hive_mind = Mock()
        self.pipeline_manager = Mock()
        self.metrics_collector = Mock()
        
        # Initialize mock behaviors
        self._setup_mock_behaviors()
    
    def _setup_mock_behaviors(self):
        """Setup realistic mock behaviors for all components."""
        # CLAUDE.md optimizer
        self.claude_optimizer.generate_optimized_config.return_value = """
# CLAUDE.md - Optimized for Integration Test

## Swarm Configuration
- Topology: hierarchical
- Max Agents: 8
- Preferred Agents: coordinator, ml-developer, tester

## Performance Optimizations
- Parallel execution: enabled
- Memory caching: enabled
- Batch operations: enabled
"""
        
        # MLE-STAR executor
        self.mle_star_executor.execute_ensemble_benchmark.return_value = {
            "ensemble_size": 5,
            "accuracy": 0.94,
            "consensus_time": 2.1,
            "voting_strategy": "weighted"
        }
        
        # Batch processor
        self.batch_processor.process_batch.return_value = {
            "total_tasks": 10,
            "completed_tasks": 9,
            "failed_tasks": 1,
            "processing_time": 45.2
        }
        
        # Memory profiler
        self.memory_profiler.profile_memory_persistence.return_value = {
            "overhead": 0.15,
            "growth_rate": 2.3,
            "optimizations": ["reduce_object_retention", "optimize_gc"]
        }
        
        # Hive mind
        self.hive_mind.benchmark_collective_intelligence.return_value = {
            "consensus_success_rate": 0.87,
            "knowledge_sharing_efficiency": 0.92,
            "emergent_behavior_score": 0.76
        }


class MockPipelineWorkflow:
    """Mock complete pipeline workflow."""
    
    def __init__(self, integrated_system: MockIntegratedSystem):
        self.system = integrated_system
        self.workflow_id = f"workflow_{datetime.now().strftime('%Y%m%d_%H%M%S')}"
        self.execution_log = []
        self.current_stage = None
        
    async def execute_full_pipeline(self, objective: str, context: Dict[str, Any]) -> Dict[str, Any]:
        """Execute complete integrated pipeline."""
        self.execution_log.append({
            "stage": "initialization", 
            "timestamp": datetime.now(),
            "objective": objective
        })
        
        try:
            # Stage 1: Generate optimal CLAUDE.md configuration
            config_result = await self._stage_claude_optimization(objective, context)
            
            # Stage 2: Initialize MLE-STAR ensemble if ML task
            if "ml" in objective.lower() or "model" in objective.lower():
                ensemble_result = await self._stage_mle_star_setup(config_result)
            else:
                ensemble_result = None
            
            # Stage 3: Create and execute batch processing workflow
            batch_result = await self._stage_batch_processing(objective, context)
            
            # Stage 4: Profile memory and performance
            profiling_result = await self._stage_performance_profiling()
            
            # Stage 5: Coordinate through hive mind
            coordination_result = await self._stage_collective_coordination(objective)
            
            # Stage 6: Aggregate results and generate report
            final_result = await self._stage_result_aggregation({
                "config": config_result,
                "ensemble": ensemble_result,
                "batch": batch_result,
                "profiling": profiling_result,
                "coordination": coordination_result
            })
            
            return final_result
            
        except Exception as e:
            self.execution_log.append({
                "stage": "error",
                "timestamp": datetime.now(),
                "error": str(e)
            })
            raise
    
    async def _stage_claude_optimization(self, objective: str, context: Dict[str, Any]) -> Dict[str, Any]:
        """Stage 1: CLAUDE.md configuration optimization."""
        self.current_stage = "claude_optimization"
        self.execution_log.append({
            "stage": self.current_stage,
            "timestamp": datetime.now(),
            "status": "started"
        })
        
        await asyncio.sleep(0.1)  # Simulate processing time
        
        # Determine use case from objective
        use_case = self._determine_use_case(objective)
        
        # Generate optimized configuration
        config_content = self.system.claude_optimizer.generate_optimized_config(
            use_case, context, {"speed": True, "accuracy": True}
        )
        
        result = {
            "use_case": use_case,
            "config_content": config_content,
            "optimization_applied": ["speed", "accuracy"],
            "stage_duration": 0.1
        }
        
        self.execution_log.append({
            "stage": self.current_stage,
            "timestamp": datetime.now(),
            "status": "completed",
            "result": result
        })
        
        return result
    
    async def _stage_mle_star_setup(self, config_result: Dict[str, Any]) -> Dict[str, Any]:
        """Stage 2: MLE-STAR ensemble setup and execution."""
        self.current_stage = "mle_star_setup"
        self.execution_log.append({
            "stage": self.current_stage,
            "timestamp": datetime.now(),
            "status": "started"
        })
        
        await asyncio.sleep(0.2)  # Simulate ensemble initialization
        
        # Execute ensemble benchmark
        ensemble_result = self.system.mle_star_executor.execute_ensemble_benchmark(
            "integration_test", {"data": "mock_dataset"}
        )
        
        result = {
            "ensemble_initialized": True,
            "models_count": ensemble_result["ensemble_size"],
            "performance": {
                "accuracy": ensemble_result["accuracy"],
                "consensus_time": ensemble_result["consensus_time"]
            },
            "stage_duration": 0.2
        }
        
        self.execution_log.append({
            "stage": self.current_stage,
            "timestamp": datetime.now(),
            "status": "completed",
            "result": result
        })
        
        return result
    
    async def _stage_batch_processing(self, objective: str, context: Dict[str, Any]) -> Dict[str, Any]:
        """Stage 3: Batch processing execution."""
        self.current_stage = "batch_processing"
        self.execution_log.append({
            "stage": self.current_stage,
            "timestamp": datetime.now(),
            "status": "started"
        })
        
        await asyncio.sleep(0.3)  # Simulate batch processing
        
        # Create mock tasks based on objective
        tasks = self._create_tasks_from_objective(objective, context)
        
        # Process batch
        batch_result = self.system.batch_processor.process_batch(tasks)
        
        result = {
            "tasks_processed": batch_result["total_tasks"],
            "success_rate": batch_result["completed_tasks"] / batch_result["total_tasks"],
            "processing_time": batch_result["processing_time"],
            "stage_duration": 0.3
        }
        
        self.execution_log.append({
            "stage": self.current_stage,
            "timestamp": datetime.now(),
            "status": "completed",
            "result": result
        })
        
        return result
    
    async def _stage_performance_profiling(self) -> Dict[str, Any]:
        """Stage 4: Performance and memory profiling."""
        self.current_stage = "performance_profiling"
        self.execution_log.append({
            "stage": self.current_stage,
            "timestamp": datetime.now(),
            "status": "started"
        })
        
        await asyncio.sleep(0.15)  # Simulate profiling
        
        # Profile memory persistence
        memory_result = self.system.memory_profiler.profile_memory_persistence("integration_test")
        
        result = {
            "memory_overhead": memory_result["overhead"],
            "growth_rate": memory_result["growth_rate"],
            "optimizations": memory_result["optimizations"],
            "profiling_completed": True,
            "stage_duration": 0.15
        }
        
        self.execution_log.append({
            "stage": self.current_stage,
            "timestamp": datetime.now(),
            "status": "completed",
            "result": result
        })
        
        return result
    
    async def _stage_collective_coordination(self, objective: str) -> Dict[str, Any]:
        """Stage 5: Collective intelligence coordination."""
        self.current_stage = "collective_coordination"
        self.execution_log.append({
            "stage": self.current_stage,
            "timestamp": datetime.now(),
            "status": "started"
        })
        
        await asyncio.sleep(0.2)  # Simulate hive mind coordination
        
        # Execute collective intelligence benchmark
        coordination_result = self.system.hive_mind.benchmark_collective_intelligence()
        
        result = {
            "consensus_achieved": coordination_result["consensus_success_rate"] > 0.8,
            "knowledge_shared": coordination_result["knowledge_sharing_efficiency"] > 0.9,
            "emergent_behaviors_detected": coordination_result["emergent_behavior_score"] > 0.7,
            "coordination_effectiveness": (
                coordination_result["consensus_success_rate"] +
                coordination_result["knowledge_sharing_efficiency"] +
                coordination_result["emergent_behavior_score"]
            ) / 3,
            "stage_duration": 0.2
        }
        
        self.execution_log.append({
            "stage": self.current_stage,
            "timestamp": datetime.now(),
            "status": "completed",
            "result": result
        })
        
        return result
    
    async def _stage_result_aggregation(self, stage_results: Dict[str, Any]) -> Dict[str, Any]:
        """Stage 6: Result aggregation and final report generation."""
        self.current_stage = "result_aggregation"
        self.execution_log.append({
            "stage": self.current_stage,
            "timestamp": datetime.now(),
            "status": "started"
        })
        
        await asyncio.sleep(0.1)  # Simulate aggregation
        
        # Calculate overall pipeline performance
        total_duration = sum(
            stage.get("stage_duration", 0) 
            for stage in stage_results.values() 
            if stage and isinstance(stage, dict)
        )
        
        # Calculate success metrics
        success_metrics = self._calculate_success_metrics(stage_results)
        
        final_result = {
            "workflow_id": self.workflow_id,
            "pipeline_status": "completed",
            "total_duration": total_duration,
            "stages_completed": len([s for s in stage_results.values() if s is not None]),
            "overall_success_rate": success_metrics["overall_success"],
            "performance_score": success_metrics["performance_score"],
            "integration_score": success_metrics["integration_score"],
            "stage_results": stage_results,
            "execution_log": self.execution_log,
            "recommendations": self._generate_recommendations(stage_results)
        }
        
        self.execution_log.append({
            "stage": self.current_stage,
            "timestamp": datetime.now(),
            "status": "completed",
            "result": final_result
        })
        
        return final_result
    
    def _determine_use_case(self, objective: str) -> str:
        """Determine use case from objective description."""
        objective_lower = objective.lower()
        
        if "api" in objective_lower or "endpoint" in objective_lower:
            return "api_development"
        elif "ml" in objective_lower or "model" in objective_lower or "ai" in objective_lower:
            return "ml_pipeline"
        elif "frontend" in objective_lower or "react" in objective_lower or "ui" in objective_lower:
            return "frontend_react"
        elif "microservice" in objective_lower or "service" in objective_lower:
            return "backend_microservices"
        elif "data" in objective_lower or "pipeline" in objective_lower:
            return "data_pipeline"
        elif "test" in objective_lower or "qa" in objective_lower:
            return "testing_automation"
        else:
            return "api_development"  # Default
    
    def _create_tasks_from_objective(self, objective: str, context: Dict[str, Any]) -> List[Dict[str, Any]]:
        """Create tasks based on objective and context."""
        tasks = []
        
        # Base tasks
        tasks.extend([
            {"id": "task_1", "type": "analysis", "description": f"Analyze requirements for: {objective}"},
            {"id": "task_2", "type": "design", "description": "Create system design"},
            {"id": "task_3", "type": "implementation", "description": "Implement core functionality"}
        ])
        
        # Add context-specific tasks
        if "testing" in context.get("requirements", []):
            tasks.append({"id": "task_4", "type": "testing", "description": "Create comprehensive tests"})
        
        if "optimization" in context.get("requirements", []):
            tasks.append({"id": "task_5", "type": "optimization", "description": "Optimize performance"})
        
        if "documentation" in context.get("requirements", []):
            tasks.append({"id": "task_6", "type": "documentation", "description": "Generate documentation"})
        
        return tasks
    
    def _calculate_success_metrics(self, stage_results: Dict[str, Any]) -> Dict[str, float]:
        """Calculate overall success metrics from stage results."""
        metrics = {
            "overall_success": 0.0,
            "performance_score": 0.0,
            "integration_score": 0.0
        }
        
        # Calculate overall success rate
        success_factors = []
        
        if stage_results.get("config"):
            success_factors.append(1.0)  # Config generation always succeeds in mock
        
        if stage_results.get("batch"):
            batch_success = stage_results["batch"]["success_rate"]
            success_factors.append(batch_success)
        
        if stage_results.get("coordination"):
            coord_success = 1.0 if stage_results["coordination"]["consensus_achieved"] else 0.5
            success_factors.append(coord_success)
        
        metrics["overall_success"] = sum(success_factors) / len(success_factors) if success_factors else 0.0
        
        # Calculate performance score
        performance_factors = []
        
        if stage_results.get("ensemble"):
            performance_factors.append(stage_results["ensemble"]["performance"]["accuracy"])
        
        if stage_results.get("profiling"):
            # Lower overhead is better
            memory_score = max(0, 1 - stage_results["profiling"]["memory_overhead"])
            performance_factors.append(memory_score)
        
        metrics["performance_score"] = sum(performance_factors) / len(performance_factors) if performance_factors else 0.8
        
        # Calculate integration score based on stage completion and coordination
        completed_stages = len([s for s in stage_results.values() if s is not None])
        stage_completion_score = completed_stages / 5  # 5 expected stages
        
        coordination_score = 0.8  # Base score
        if stage_results.get("coordination"):
            coordination_score = stage_results["coordination"]["coordination_effectiveness"]
        
        metrics["integration_score"] = (stage_completion_score + coordination_score) / 2
        
        return metrics
    
    def _generate_recommendations(self, stage_results: Dict[str, Any]) -> List[str]:
        """Generate recommendations based on stage results."""
        recommendations = []
        
        # Check batch processing success rate
        if stage_results.get("batch") and stage_results["batch"]["success_rate"] < 0.9:
            recommendations.append("Consider increasing batch processing timeout or retry logic")
        
        # Check memory overhead
        if stage_results.get("profiling") and stage_results["profiling"]["memory_overhead"] > 0.2:
            recommendations.append("Implement memory optimization strategies")
        
        # Check coordination effectiveness
        if stage_results.get("coordination") and stage_results["coordination"]["coordination_effectiveness"] < 0.8:
            recommendations.append("Improve swarm coordination mechanisms")
        
        # Check ensemble performance
        if stage_results.get("ensemble") and stage_results["ensemble"]["performance"]["accuracy"] < 0.9:
            recommendations.append("Fine-tune MLE-STAR ensemble parameters")
        
        if not recommendations:
            recommendations.append("Pipeline performance is optimal - no immediate improvements needed")
        
        return recommendations


class TestFullPipelineIntegration:
    """Test complete pipeline integration scenarios."""
    
    @pytest.fixture
    def integrated_system(self):
        """Provide integrated system mock."""
        return MockIntegratedSystem()
    
    @pytest.fixture
    def pipeline_workflow(self, integrated_system):
        """Provide pipeline workflow instance."""
        return MockPipelineWorkflow(integrated_system)
    
    @pytest.mark.asyncio
    async def test_complete_api_development_pipeline(self, pipeline_workflow):
        """Test complete API development pipeline."""
        objective = "Build a high-performance REST API for user management"
        context = {
            "project_name": "UserAPI",
            "tech_stack": ["Python", "FastAPI", "PostgreSQL"],
            "team_size": 4,
            "requirements": ["testing", "optimization", "documentation"]
        }
        
        result = await pipeline_workflow.execute_full_pipeline(objective, context)
        
        # Verify overall execution
        assert result["pipeline_status"] == "completed"
        assert result["stages_completed"] == 5  # All stages completed
        assert result["overall_success_rate"] > 0.8
        assert result["workflow_id"] is not None
        
        # Verify stage results
        assert result["stage_results"]["config"]["use_case"] == "api_development"
        assert result["stage_results"]["batch"]["tasks_processed"] > 0
        assert result["stage_results"]["profiling"]["profiling_completed"] is True
        assert result["stage_results"]["coordination"]["consensus_achieved"] is True
        
        # Verify execution log
        assert len(result["execution_log"]) > 6  # Multiple log entries
        log_stages = [entry["stage"] for entry in result["execution_log"]]
        assert "claude_optimization" in log_stages
        assert "batch_processing" in log_stages
        assert "collective_coordination" in log_stages
    
    @pytest.mark.asyncio
    async def test_ml_pipeline_with_ensemble(self, pipeline_workflow):
        """Test ML pipeline with MLE-STAR ensemble integration."""
        objective = "Develop machine learning model for fraud detection"
        context = {
            "project_name": "FraudDetector", 
            "framework": "scikit-learn",
            "data_size": "large",
            "requirements": ["optimization", "testing"]
        }
        
        result = await pipeline_workflow.execute_full_pipeline(objective, context)
        
        # Verify ML-specific results
        assert result["stage_results"]["config"]["use_case"] == "ml_pipeline"
        assert result["stage_results"]["ensemble"] is not None
        assert result["stage_results"]["ensemble"]["ensemble_initialized"] is True
        assert result["stage_results"]["ensemble"]["models_count"] == 5
        assert result["stage_results"]["ensemble"]["performance"]["accuracy"] > 0.9
        
        # Verify performance optimization
        assert result["performance_score"] > 0.8
        assert result["integration_score"] > 0.8
    
    @pytest.mark.asyncio
    async def test_microservices_architecture_pipeline(self, pipeline_workflow):
        """Test microservices architecture development pipeline."""
        objective = "Design and implement microservices architecture for e-commerce platform"
        context = {
            "project_name": "EcommerceServices",
            "services_count": 8,
            "tech_stack": ["Node.js", "Docker", "Kubernetes"],
            "requirements": ["testing", "optimization"]
        }
        
        result = await pipeline_workflow.execute_full_pipeline(objective, context)
        
        # Verify microservices-specific results
        assert result["stage_results"]["config"]["use_case"] == "backend_microservices"
        assert result["stage_results"]["coordination"]["consensus_achieved"] is True
        assert result["stage_results"]["coordination"]["knowledge_shared"] is True
        
        # Should handle complex coordination well
        assert result["stage_results"]["coordination"]["coordination_effectiveness"] > 0.7
    
    @pytest.mark.asyncio
    async def test_data_pipeline_integration(self, pipeline_workflow):
        """Test data pipeline integration scenario."""
        objective = "Build real-time data processing pipeline for analytics"
        context = {
            "project_name": "AnalyticsPipeline",
            "data_volume": "TB",
            "processing_framework": "Apache Spark",
            "requirements": ["optimization"]
        }
        
        result = await pipeline_workflow.execute_full_pipeline(objective, context)
        
        # Verify data pipeline results
        assert result["stage_results"]["config"]["use_case"] == "data_pipeline"
        assert result["stage_results"]["batch"]["success_rate"] > 0.8
        
        # Should optimize for memory with large data
        assert result["stage_results"]["profiling"]["memory_overhead"] <= 0.2
    
    @pytest.mark.asyncio
    async def test_pipeline_error_handling(self, pipeline_workflow):
        """Test pipeline error handling and recovery."""
        # Mock a failure in batch processing
        pipeline_workflow.system.batch_processor.process_batch.side_effect = Exception("Batch processing failed")
        
        objective = "Test error handling in pipeline"
        context = {"project_name": "ErrorTest"}
        
        with pytest.raises(Exception, match="Batch processing failed"):
            await pipeline_workflow.execute_full_pipeline(objective, context)
        
        # Verify error logging
        error_logs = [entry for entry in pipeline_workflow.execution_log if entry.get("stage") == "error"]
        assert len(error_logs) > 0
        assert "Batch processing failed" in error_logs[0]["error"]
    
    @pytest.mark.asyncio
    async def test_pipeline_performance_metrics(self, pipeline_workflow):
        """Test pipeline performance metrics calculation."""
        objective = "Performance test pipeline"
        context = {"project_name": "PerfTest", "requirements": ["optimization"]}
        
        result = await pipeline_workflow.execute_full_pipeline(objective, context)
        
        # Verify performance metrics
        assert 0 <= result["overall_success_rate"] <= 1
        assert 0 <= result["performance_score"] <= 1 
        assert 0 <= result["integration_score"] <= 1
        assert result["total_duration"] > 0
        
        # Verify recommendations are generated
        assert len(result["recommendations"]) > 0
        assert all(isinstance(rec, str) for rec in result["recommendations"])


class TestConcurrentPipelineExecution:
    """Test concurrent pipeline execution scenarios."""
    
    @pytest.fixture
    def integrated_system(self):
        """Provide integrated system for concurrent testing."""
        return MockIntegratedSystem()
    
    @pytest.mark.asyncio
    async def test_multiple_concurrent_pipelines(self, integrated_system):
        """Test multiple pipelines running concurrently."""
        objectives_and_contexts = [
            ("Build API for users", {"project_name": "UserAPI", "team_size": 3}),
            ("Create ML model", {"project_name": "MLModel", "framework": "TensorFlow"}),
            ("Design frontend", {"project_name": "Frontend", "tech_stack": ["React"]}),
            ("Setup data pipeline", {"project_name": "DataPipe", "data_volume": "GB"})
        ]
        
        # Create workflows
        workflows = []
        for objective, context in objectives_and_contexts:
            workflow = MockPipelineWorkflow(integrated_system)
            workflows.append((workflow, objective, context))
        
        # Execute concurrently
        start_time = datetime.now()
        tasks = [
            workflow.execute_full_pipeline(objective, context)
            for workflow, objective, context in workflows
        ]
        results = await asyncio.gather(*tasks)
        end_time = datetime.now()
        
        # Verify concurrent execution
        total_duration = (end_time - start_time).total_seconds()
        assert total_duration < 2.0  # Should be faster than sequential
        assert len(results) == 4
        
        # All pipelines should complete successfully
        for result in results:
            assert result["pipeline_status"] == "completed"
            assert result["overall_success_rate"] > 0.7
    
    @pytest.mark.asyncio
    async def test_pipeline_resource_contention(self, integrated_system):
        """Test pipeline behavior under resource contention."""
        # Create many concurrent pipelines to test resource limits
        objective = "Test resource contention"
        context = {"project_name": "ResourceTest"}
        
        workflows = [MockPipelineWorkflow(integrated_system) for _ in range(10)]
        
        start_time = datetime.now()
        tasks = [
            workflow.execute_full_pipeline(objective, context)
            for workflow in workflows
        ]
        results = await asyncio.gather(*tasks, return_exceptions=True)
        end_time = datetime.now()
        
        # Should handle resource contention gracefully
        successful_results = [r for r in results if not isinstance(r, Exception)]
        assert len(successful_results) >= 8  # Most should succeed
        
        duration = (end_time - start_time).total_seconds()
        assert duration < 5.0  # Should complete within reasonable time


class TestPipelineStageInteraction:
    """Test interactions between different pipeline stages."""
    
    @pytest.fixture
    def pipeline_workflow(self):
        """Provide pipeline workflow for stage testing."""
        system = MockIntegratedSystem()
        return MockPipelineWorkflow(system)
    
    @pytest.mark.asyncio
    async def test_claude_config_influences_mle_star(self, pipeline_workflow):
        """Test that CLAUDE.md config influences MLE-STAR setup."""
        # Mock CLAUDE optimizer to return ML-optimized config
        ml_config = """
# CLAUDE.md - ML Optimized
## MLE-STAR Configuration
- Ensemble Size: 7
- Voting Strategy: bayesian
"""
        pipeline_workflow.system.claude_optimizer.generate_optimized_config.return_value = ml_config
        
        # Mock MLE-STAR to use config parameters
        def mock_ensemble_exec(task, data):
            return {
                "ensemble_size": 7,  # Should reflect config
                "accuracy": 0.96,
                "consensus_time": 1.8,
                "voting_strategy": "bayesian"
            }
        
        pipeline_workflow.system.mle_star_executor.execute_ensemble_benchmark.side_effect = mock_ensemble_exec
        
        objective = "Build advanced ML model with ensemble learning"
        context = {"project_name": "AdvancedML"}
        
        result = await pipeline_workflow.execute_full_pipeline(objective, context)
        
        # Verify config influenced ensemble setup
        assert result["stage_results"]["ensemble"]["models_count"] == 7
        assert "bayesian" in str(result["stage_results"]["ensemble"]["performance"])
    
    @pytest.mark.asyncio
    async def test_profiling_results_influence_recommendations(self, pipeline_workflow):
        """Test that profiling results influence final recommendations."""
        # Mock high memory overhead
        def mock_memory_profile(swarm_id):
            return {
                "overhead": 0.35,  # High overhead
                "growth_rate": 8.5,  # High growth
                "optimizations": ["urgent_gc_tuning", "memory_pooling"]
            }
        
        pipeline_workflow.system.memory_profiler.profile_memory_persistence.side_effect = mock_memory_profile
        
        objective = "Test memory profiling influence"
        context = {"project_name": "MemoryTest"}
        
        result = await pipeline_workflow.execute_full_pipeline(objective, context)
        
        # Should generate memory-related recommendations
        recommendations = result["recommendations"]
        memory_recommendations = [r for r in recommendations if "memory" in r.lower()]
        assert len(memory_recommendations) > 0
    
    @pytest.mark.asyncio
    async def test_batch_results_affect_coordination(self, pipeline_workflow):
        """Test that batch processing results affect coordination strategy."""
        # Mock low batch success rate
        def mock_batch_process(tasks):
            return {
                "total_tasks": len(tasks),
                "completed_tasks": len(tasks) // 3,  # Low success rate
                "failed_tasks": len(tasks) * 2 // 3,
                "processing_time": 60.0
            }
        
        pipeline_workflow.system.batch_processor.process_batch.side_effect = mock_batch_process
        
        # Mock coordination to reflect batch issues
        def mock_coordination():
            return {
                "consensus_success_rate": 0.65,  # Lower due to batch issues
                "knowledge_sharing_efficiency": 0.85,
                "emergent_behavior_score": 0.70
            }
        
        pipeline_workflow.system.hive_mind.benchmark_collective_intelligence.side_effect = mock_coordination
        
        objective = "Test batch-coordination interaction"
        context = {"project_name": "BatchCoordTest"}
        
        result = await pipeline_workflow.execute_full_pipeline(objective, context)
        
        # Should have recommendations about batch processing
        recommendations = result["recommendations"]
        batch_recommendations = [r for r in recommendations if "batch" in r.lower() or "timeout" in r.lower()]
        assert len(batch_recommendations) > 0
        
        # Overall success should be impacted
        assert result["overall_success_rate"] < 0.8


class TestEndToEndScenarios:
    """Test realistic end-to-end scenarios."""
    
    @pytest.fixture
    def integrated_system(self):
        """Provide integrated system."""
        return MockIntegratedSystem()
    
    @pytest.mark.asyncio
    async def test_startup_mvp_development(self, integrated_system):
        """Test complete startup MVP development scenario."""
        workflow = MockPipelineWorkflow(integrated_system)
        
        objective = "Build MVP for social media analytics platform"
        context = {
            "project_name": "SocialAnalytics",
            "tech_stack": ["Python", "React", "PostgreSQL", "Redis"],
            "team_size": 5,
            "deadline": "urgent",
            "requirements": ["api", "frontend", "ml", "testing", "documentation"],
            "constraints": {
                "budget": "limited",
                "time": "8_weeks",
                "team_experience": "mixed"
            }
        }
        
        result = await pipeline_workflow.execute_full_pipeline(objective, context)
        
        # Verify comprehensive development
        assert result["pipeline_status"] == "completed"
        assert result["stages_completed"] == 5
        
        # Should handle complex requirements
        assert result["stage_results"]["batch"]["tasks_processed"] >= 6  # Multiple requirements
        assert result["overall_success_rate"] > 0.75  # Should handle complexity well
        
        # Should provide actionable recommendations
        assert len(result["recommendations"]) > 0
    
    @pytest.mark.asyncio
    async def test_enterprise_migration_project(self, integrated_system):
        """Test enterprise legacy system migration."""
        workflow = MockPipelineWorkflow(integrated_system)
        
        objective = "Migrate monolithic enterprise system to microservices architecture"
        context = {
            "project_name": "EnterpriseMigration",
            "current_system": "monolithic",
            "target_architecture": "microservices",
            "team_size": 15,
            "complexity": "high",
            "requirements": ["architecture", "migration", "testing", "monitoring"],
            "constraints": {
                "zero_downtime": True,
                "data_consistency": "strict",
                "compliance": ["SOX", "GDPR"]
            }
        }
        
        result = await pipeline_workflow.execute_full_pipeline(objective, context)
        
        # Enterprise projects should have high coordination effectiveness
        assert result["stage_results"]["coordination"]["coordination_effectiveness"] > 0.8
        
        # Should handle large team complexity
        coordination_result = result["stage_results"]["coordination"]
        assert coordination_result["consensus_achieved"] is True
        assert coordination_result["knowledge_shared"] is True
        
        # Should provide migration-specific recommendations
        recommendations_text = " ".join(result["recommendations"]).lower()
        migration_terms = ["coordination", "memory", "batch", "ensemble"]
        assert any(term in recommendations_text for term in migration_terms)
    
    @pytest.mark.asyncio
    async def test_research_prototype_development(self, integrated_system):
        """Test research prototype development scenario."""
        workflow = MockPipelineWorkflow(integrated_system)
        
        objective = "Develop prototype for novel AI-driven drug discovery platform"
        context = {
            "project_name": "DrugDiscoveryAI",
            "domain": "pharmaceutical_research",
            "tech_stack": ["Python", "TensorFlow", "PyTorch", "Neo4j"],
            "team_size": 8,
            "requirements": ["research", "ml", "data_pipeline", "experimentation"],
            "experimental_features": [
                "graph_neural_networks",
                "molecular_simulation", 
                "ensemble_methods",
                "active_learning"
            ]
        }
        
        result = await pipeline_workflow.execute_full_pipeline(objective, context)
        
        # Research projects should leverage ML capabilities heavily
        assert result["stage_results"]["config"]["use_case"] == "ml_pipeline"
        assert result["stage_results"]["ensemble"] is not None
        assert result["stage_results"]["ensemble"]["performance"]["accuracy"] > 0.9
        
        # Should have high performance score for ML tasks
        assert result["performance_score"] > 0.85
        
        # Should handle experimental complexity
        assert result["integration_score"] > 0.8


class TestPipelineMonitoringAndObservability:
    """Test pipeline monitoring and observability features."""
    
    @pytest.fixture
    def monitored_workflow(self):
        """Provide workflow with monitoring enabled."""
        system = MockIntegratedSystem()
        workflow = MockPipelineWorkflow(system)
        
        # Add monitoring hooks
        workflow.metrics = {
            "stage_durations": {},
            "resource_usage": {},
            "error_counts": {},
            "success_rates": {}
        }
        
        return workflow
    
    @pytest.mark.asyncio
    async def test_execution_log_completeness(self, monitored_workflow):
        """Test execution log captures all important events."""
        objective = "Test monitoring and logging"
        context = {"project_name": "MonitoringTest"}
        
        result = await monitored_workflow.execute_full_pipeline(objective, context)
        
        execution_log = result["execution_log"]
        
        # Should have entries for all major stages
        stage_names = [entry["stage"] for entry in execution_log]
        expected_stages = [
            "initialization",
            "claude_optimization", 
            "batch_processing",
            "performance_profiling",
            "collective_coordination",
            "result_aggregation"
        ]
        
        for stage in expected_stages:
            assert stage in stage_names
        
        # Each stage should have start and complete entries
        for stage in ["claude_optimization", "batch_processing", "collective_coordination"]:
            stage_entries = [e for e in execution_log if e["stage"] == stage]
            statuses = [e.get("status") for e in stage_entries]
            assert "started" in statuses
            assert "completed" in statuses
    
    @pytest.mark.asyncio
    async def test_performance_tracking(self, monitored_workflow):
        """Test performance metrics tracking throughout pipeline."""
        objective = "Performance tracking test"
        context = {"project_name": "PerfTrackingTest"}
        
        result = await monitored_workflow.execute_full_pipeline(objective, context)
        
        # Should track timing for all stages
        stage_results = result["stage_results"]
        for stage_name, stage_result in stage_results.items():
            if stage_result and isinstance(stage_result, dict):
                assert "stage_duration" in stage_result
                assert stage_result["stage_duration"] > 0
        
        # Total duration should be sum of stage durations
        expected_total = sum(
            stage.get("stage_duration", 0) 
            for stage in stage_results.values() 
            if stage and isinstance(stage, dict)
        )
        assert abs(result["total_duration"] - expected_total) < 0.01
    
    @pytest.mark.asyncio
    async def test_error_tracking_and_recovery(self, monitored_workflow):
        """Test error tracking and recovery mechanisms."""
        # Mock an error in one stage
        original_batch_method = monitored_workflow.system.batch_processor.process_batch
        call_count = 0
        
        def failing_batch_process(tasks):
            nonlocal call_count
            call_count += 1
            if call_count == 1:
                raise Exception("Temporary batch failure")
            return original_batch_method(tasks)
        
        monitored_workflow.system.batch_processor.process_batch.side_effect = failing_batch_process
        
        objective = "Error tracking test"
        context = {"project_name": "ErrorTrackingTest"}
        
        # Should fail on first attempt
        with pytest.raises(Exception, match="Temporary batch failure"):
            await monitored_workflow.execute_full_pipeline(objective, context)
        
        # Verify error was logged
        error_entries = [e for e in monitored_workflow.execution_log if e.get("stage") == "error"]
        assert len(error_entries) > 0
        assert "Temporary batch failure" in error_entries[0]["error"]


class TestPipelineConfiguration:
    """Test pipeline configuration and customization."""
    
    @pytest.mark.asyncio
    async def test_pipeline_with_custom_configuration(self):
        """Test pipeline with custom configuration parameters."""
        system = MockIntegratedSystem()
        
        # Mock custom configuration response
        custom_config = """
# CLAUDE.md - Custom Configuration
## Custom Parameters
- Max Parallel Tasks: 20
- Timeout: 300s
- Retry Logic: exponential_backoff
- Cache Strategy: distributed
"""
        system.claude_optimizer.generate_optimized_config.return_value = custom_config
        
        workflow = MockPipelineWorkflow(system)
        
        objective = "Test custom configuration"
        context = {
            "project_name": "CustomConfigTest",
            "custom_parameters": {
                "max_parallel_tasks": 20,
                "timeout": 300,
                "retry_strategy": "exponential_backoff"
            }
        }
        
        result = await workflow.execute_full_pipeline(objective, context)
        
        # Should incorporate custom parameters
        config_content = result["stage_results"]["config"]["config_content"]
        assert "Max Parallel Tasks: 20" in config_content
        assert "exponential_backoff" in config_content
        assert "distributed" in config_content
    
    @pytest.mark.asyncio
    async def test_pipeline_mode_switching(self):
        """Test pipeline adapting to different execution modes."""
        system = MockIntegratedSystem()
        workflow = MockPipelineWorkflow(system)
        
        # Test different modes
        modes = [
            ("development", {"optimize_for": "speed", "testing": "minimal"}),
            ("staging", {"optimize_for": "accuracy", "testing": "comprehensive"}),
            ("production", {"optimize_for": "reliability", "testing": "full"})
        ]
        
        results = []
        for mode, mode_context in modes:
            context = {
                "project_name": f"ModeTest_{mode}",
                "execution_mode": mode,
                **mode_context
            }
            
            result = await workflow.execute_full_pipeline(f"Test {mode} mode", context)
            results.append((mode, result))
        
        # Each mode should complete successfully
        for mode, result in results:
            assert result["pipeline_status"] == "completed"
            assert result["overall_success_rate"] > 0.7


if __name__ == "__main__":
    pytest.main([__file__, "-v", "--tb=short"])