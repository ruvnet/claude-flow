"""
Unit tests for advanced metrics systems.

Tests the token optimization tracker, memory profiler, neural benchmarks,
and performance analysis components.
"""

import pytest
import asyncio
from unittest.mock import Mock, AsyncMock, patch, MagicMock
from datetime import datetime, timedelta
from typing import List, Dict, Any, Optional
import tempfile
from pathlib import Path
import json

import numpy as np

from swarm_benchmark.core.models import PerformanceMetrics, ResourceUsage


class MockTokenMetrics:
    """Mock token metrics for testing."""
    
    def __init__(self):
        self.input_tokens = 0
        self.output_tokens = 0
        self.tool_tokens = 0
        self.cache_hit_rate = 0.0
        self.compression_ratio = 1.0
        self.improvement = 0.0
        self.total_tokens = 0
        
    def calculate_total(self):
        """Calculate total tokens."""
        self.total_tokens = self.input_tokens + self.output_tokens + self.tool_tokens
        return self.total_tokens


class MockExecutionLog:
    """Mock execution log for testing."""
    
    def __init__(self):
        self.entries = []
        self.tool_calls = []
        self.cache_hits = []
        self.start_time = datetime.now()
        self.end_time = None
        
    def add_entry(self, entry_type: str, content: str, tokens: int = 0):
        """Add an entry to the log."""
        self.entries.append({
            "type": entry_type,
            "content": content,
            "tokens": tokens,
            "timestamp": datetime.now()
        })
    
    def add_tool_call(self, tool_name: str, tokens: int):
        """Add a tool call to the log."""
        self.tool_calls.append({
            "tool": tool_name,
            "tokens": tokens,
            "timestamp": datetime.now()
        })
    
    def add_cache_hit(self, key: str, saved_tokens: int):
        """Add a cache hit to the log."""
        self.cache_hits.append({
            "key": key,
            "saved_tokens": saved_tokens,
            "timestamp": datetime.now()
        })
    
    def finalize(self):
        """Finalize the execution log."""
        self.end_time = datetime.now()


class MockOptimizationPlan:
    """Mock optimization plan for testing."""
    
    def __init__(self):
        self.optimizations = []
        self.estimated_savings = 0
        self.confidence = 0.0
        
    def add_optimization(self, optimization: Dict[str, Any]):
        """Add an optimization to the plan."""
        self.optimizations.append(optimization)
        self.estimated_savings += optimization.get("savings", 0)
        
    def calculate_confidence(self):
        """Calculate confidence in the optimization plan."""
        if not self.optimizations:
            self.confidence = 0.0
        else:
            avg_confidence = sum(opt.get("confidence", 0.5) for opt in self.optimizations) / len(self.optimizations)
            self.confidence = min(avg_confidence, 0.95)


class MockTokenOptimizationTracker:
    """Mock token optimization tracker for testing."""
    
    def __init__(self):
        self.baseline_usage = {}
        self.optimization_history = []
        self.strategies = {
            "caching": Mock(),
            "batching": Mock(),
            "compression": Mock(),
            "pruning": Mock()
        }
        
    def measure_token_usage(self, task: str, execution_log: MockExecutionLog) -> MockTokenMetrics:
        """Measure token usage for a task execution."""
        metrics = MockTokenMetrics()
        
        # Count tokens from execution log
        metrics.input_tokens = sum(
            entry["tokens"] for entry in execution_log.entries 
            if entry["type"] == "input"
        )
        metrics.output_tokens = sum(
            entry["tokens"] for entry in execution_log.entries 
            if entry["type"] == "output"
        )
        metrics.tool_tokens = sum(
            call["tokens"] for call in execution_log.tool_calls
        )
        
        # Calculate cache hit rate
        total_requests = len(execution_log.entries) + len(execution_log.tool_calls)
        cache_hits = len(execution_log.cache_hits)
        metrics.cache_hit_rate = cache_hits / total_requests if total_requests > 0 else 0.0
        
        # Simulate compression ratio
        metrics.compression_ratio = 0.85  # 15% compression
        
        # Calculate improvement over baseline
        metrics.calculate_total()
        if task in self.baseline_usage:
            baseline_total = self.baseline_usage[task].total_tokens
            metrics.improvement = (baseline_total - metrics.total_tokens) / baseline_total
        
        return metrics
    
    def optimize_token_usage(self, task: str, current_usage: MockTokenMetrics) -> MockOptimizationPlan:
        """Generate optimization plan to reduce token usage."""
        plan = MockOptimizationPlan()
        
        # Add caching optimization if cache hit rate is low
        if current_usage.cache_hit_rate < 0.3:
            plan.add_optimization({
                "type": "caching",
                "description": "Implement intelligent caching for repeated operations",
                "savings": int(current_usage.total_tokens * 0.2),
                "confidence": 0.8
            })
        
        # Add batching optimization if many small operations
        if len(self.optimization_history) > 0:
            plan.add_optimization({
                "type": "batching",
                "description": "Batch multiple operations into single calls",
                "savings": int(current_usage.total_tokens * 0.15),
                "confidence": 0.7
            })
        
        # Add compression optimization
        if current_usage.compression_ratio > 0.9:
            plan.add_optimization({
                "type": "compression",
                "description": "Apply content compression techniques",
                "savings": int(current_usage.total_tokens * 0.1),
                "confidence": 0.6
            })
        
        plan.calculate_confidence()
        return plan
    
    def set_baseline(self, task: str, metrics: MockTokenMetrics):
        """Set baseline usage for a task."""
        self.baseline_usage[task] = metrics


class MockMemorySnapshot:
    """Mock memory snapshot for testing."""
    
    def __init__(self, timestamp: datetime = None):
        self.timestamp = timestamp or datetime.now()
        self.heap_used = np.random.randint(100, 500)  # MB
        self.heap_total = np.random.randint(500, 1000)  # MB
        self.external_memory = np.random.randint(10, 50)  # MB
        self.gc_count = np.random.randint(0, 10)
        self.process_memory = np.random.randint(200, 800)  # MB


class MockMemoryProfile:
    """Mock memory profile for testing."""
    
    def __init__(self, swarm_id: str):
        self.swarm_id = swarm_id
        self.overhead = 0.0
        self.growth_rate = 0.0
        self.gc_impact = 0.0
        self.optimizations = []
        self.snapshots = []
        
    def add_snapshot(self, snapshot: MockMemorySnapshot):
        """Add a memory snapshot to the profile."""
        self.snapshots.append(snapshot)
        
    def calculate_metrics(self):
        """Calculate memory metrics from snapshots."""
        if len(self.snapshots) < 2:
            return
            
        # Calculate growth rate
        first_memory = self.snapshots[0].process_memory
        last_memory = self.snapshots[-1].process_memory
        time_diff = (self.snapshots[-1].timestamp - self.snapshots[0].timestamp).total_seconds()
        
        if time_diff > 0:
            self.growth_rate = (last_memory - first_memory) / time_diff
        
        # Calculate overhead
        total_memory = sum(s.process_memory for s in self.snapshots)
        baseline_memory = min(s.process_memory for s in self.snapshots)
        self.overhead = (total_memory / len(self.snapshots) - baseline_memory) / baseline_memory
        
        # Calculate GC impact
        gc_counts = [s.gc_count for s in self.snapshots]
        if gc_counts:
            self.gc_impact = sum(gc_counts) / len(gc_counts)


class MockMemoryPersistenceProfiler:
    """Mock memory persistence profiler for testing."""
    
    def __init__(self):
        self.memory_snapshots = []
        self.persistence_overhead = {}
        self.optimization_suggestions = []
        
    async def profile_memory_persistence(self, swarm_id: str) -> MockMemoryProfile:
        """Profile memory persistence for a swarm."""
        profile = MockMemoryProfile(swarm_id)
        
        # Take initial snapshot
        initial_snapshot = await self._take_memory_snapshot()
        profile.add_snapshot(initial_snapshot)
        
        # Execute memory operations
        await self._execute_memory_operations(swarm_id)
        
        # Take periodic snapshots
        for i in range(10):
            await asyncio.sleep(0.1)  # Simulate time passing
            snapshot = await self._take_memory_snapshot()
            profile.add_snapshot(snapshot)
        
        # Calculate metrics
        profile.calculate_metrics()
        
        # Generate optimizations
        profile.optimizations = self._generate_optimizations(profile)
        
        return profile
    
    async def _take_memory_snapshot(self) -> MockMemorySnapshot:
        """Take a memory snapshot."""
        await asyncio.sleep(0.01)  # Simulate collection time
        snapshot = MockMemorySnapshot()
        self.memory_snapshots.append(snapshot)
        return snapshot
    
    async def _execute_memory_operations(self, swarm_id: str):
        """Execute memory operations to test persistence."""
        operations = [
            "store_agent_state",
            "persist_task_results", 
            "cache_model_data",
            "serialize_workflow_state"
        ]
        
        for operation in operations:
            await asyncio.sleep(0.05)  # Simulate operation time
            # Simulate memory usage for operation
            overhead = np.random.uniform(5, 20)  # MB
            self.persistence_overhead[operation] = overhead
    
    def _generate_optimizations(self, profile: MockMemoryProfile) -> List[Dict[str, Any]]:
        """Generate memory optimization suggestions."""
        optimizations = []
        
        # Check for high growth rate
        if profile.growth_rate > 10:  # MB/sec
            optimizations.append({
                "type": "memory_leak",
                "description": "High memory growth rate detected",
                "recommendation": "Implement better garbage collection",
                "priority": "high"
            })
        
        # Check for high overhead
        if profile.overhead > 0.3:  # 30% overhead
            optimizations.append({
                "type": "overhead",
                "description": "High memory overhead detected",
                "recommendation": "Optimize data structures and caching",
                "priority": "medium"
            })
        
        # Check for frequent GC
        if profile.gc_impact > 5:
            optimizations.append({
                "type": "gc_frequency",
                "description": "Frequent garbage collection detected",
                "recommendation": "Reduce object allocation rate",
                "priority": "low"
            })
        
        return optimizations


class MockNeuralBenchmarkResult:
    """Mock neural benchmark result for testing."""
    
    def __init__(self):
        self.pattern_results = {}
        self.parallel_performance = None
        self.memory_efficiency = None
        self.overall_score = 0.0
        
    def add_pattern_result(self, pattern: str, result: Dict[str, Any]):
        """Add pattern-specific result."""
        self.pattern_results[pattern] = result
        
    def calculate_overall_score(self):
        """Calculate overall benchmark score."""
        if not self.pattern_results:
            self.overall_score = 0.0
            return
            
        # Weighted average of pattern scores
        pattern_scores = []
        for pattern, result in self.pattern_results.items():
            score = result.get("performance_score", 0.5)
            pattern_scores.append(score)
        
        base_score = sum(pattern_scores) / len(pattern_scores)
        
        # Factor in parallel performance
        if self.parallel_performance:
            parallel_bonus = self.parallel_performance.get("efficiency", 1.0)
            base_score *= parallel_bonus
        
        # Factor in memory efficiency
        if self.memory_efficiency:
            memory_bonus = self.memory_efficiency.get("efficiency", 1.0)
            base_score *= memory_bonus
        
        self.overall_score = min(base_score, 1.0)


class MockNeuralProcessingBenchmark:
    """Mock neural processing benchmark for testing."""
    
    def __init__(self):
        self.pattern_types = [
            "convergent",
            "divergent", 
            "lateral",
            "systems",
            "critical",
            "abstract"
        ]
        self.performance_targets = {
            "pattern_recognition_ms": 100,
            "inference_time_ms": 50,
            "training_iteration_ms": 500,
            "memory_usage_mb": 512
        }
        
    async def benchmark_neural_processing(self) -> MockNeuralBenchmarkResult:
        """Run comprehensive neural processing benchmarks."""
        results = MockNeuralBenchmarkResult()
        
        # Test each pattern type
        for pattern in self.pattern_types:
            pattern_result = await self._benchmark_pattern(pattern)
            results.add_pattern_result(pattern, pattern_result)
        
        # Test parallel processing
        parallel_result = await self._benchmark_parallel_processing()
        results.parallel_performance = parallel_result
        
        # Test memory efficiency
        memory_result = await self._benchmark_memory_efficiency()
        results.memory_efficiency = memory_result
        
        # Calculate overall score
        results.calculate_overall_score()
        
        return results
    
    async def _benchmark_pattern(self, pattern: str) -> Dict[str, Any]:
        """Benchmark a specific cognitive pattern."""
        await asyncio.sleep(0.1)  # Simulate processing time
        
        # Generate mock metrics
        recognition_time = np.random.uniform(50, 150)  # ms
        inference_time = np.random.uniform(20, 80)     # ms
        memory_usage = np.random.uniform(200, 600)     # MB
        accuracy = np.random.uniform(0.8, 0.95)
        
        # Calculate performance score based on targets
        recognition_score = max(0, 1 - (recognition_time - self.performance_targets["pattern_recognition_ms"]) / 100)
        inference_score = max(0, 1 - (inference_time - self.performance_targets["inference_time_ms"]) / 50)
        memory_score = max(0, 1 - (memory_usage - self.performance_targets["memory_usage_mb"]) / 512)
        
        performance_score = (recognition_score + inference_score + memory_score + accuracy) / 4
        
        return {
            "pattern": pattern,
            "recognition_time_ms": recognition_time,
            "inference_time_ms": inference_time,
            "memory_usage_mb": memory_usage,
            "accuracy": accuracy,
            "performance_score": performance_score
        }
    
    async def _benchmark_parallel_processing(self) -> Dict[str, Any]:
        """Benchmark parallel processing capabilities."""
        await asyncio.sleep(0.2)  # Simulate parallel test
        
        # Test with different numbers of parallel tasks
        parallel_results = {}
        for num_tasks in [1, 2, 4, 8]:
            start_time = datetime.now()
            
            # Simulate parallel tasks
            tasks = [asyncio.sleep(0.01) for _ in range(num_tasks)]
            await asyncio.gather(*tasks)
            
            end_time = datetime.now()
            duration = (end_time - start_time).total_seconds() * 1000  # ms
            
            parallel_results[f"{num_tasks}_tasks"] = {
                "duration_ms": duration,
                "throughput": num_tasks / (duration / 1000) if duration > 0 else 0
            }
        
        # Calculate parallel efficiency
        sequential_time = parallel_results["1_tasks"]["duration_ms"]
        parallel_time = parallel_results["8_tasks"]["duration_ms"]
        efficiency = (sequential_time * 8) / parallel_time if parallel_time > 0 else 0
        efficiency = min(efficiency / 8, 1.0)  # Normalize to [0,1]
        
        return {
            "results": parallel_results,
            "efficiency": efficiency,
            "max_throughput": max(r["throughput"] for r in parallel_results.values())
        }
    
    async def _benchmark_memory_efficiency(self) -> Dict[str, Any]:
        """Benchmark memory efficiency."""
        await asyncio.sleep(0.1)  # Simulate memory test
        
        # Test memory usage under different loads
        memory_results = {}
        for load in ["light", "medium", "heavy"]:
            # Simulate different memory loads
            base_memory = {"light": 100, "medium": 300, "heavy": 800}[load]
            actual_memory = base_memory + np.random.uniform(-20, 50)
            
            memory_results[load] = {
                "memory_usage_mb": actual_memory,
                "efficiency": base_memory / actual_memory if actual_memory > 0 else 0
            }
        
        # Calculate overall memory efficiency
        avg_efficiency = sum(r["efficiency"] for r in memory_results.values()) / len(memory_results)
        
        return {
            "results": memory_results,
            "efficiency": avg_efficiency,
            "peak_memory_mb": max(r["memory_usage_mb"] for r in memory_results.values())
        }


class TestTokenOptimizationTracker:
    """Test the token optimization tracker."""
    
    @pytest.fixture
    def token_tracker(self):
        """Provide token optimization tracker instance."""
        return MockTokenOptimizationTracker()
    
    @pytest.fixture
    def sample_execution_log(self):
        """Provide sample execution log."""
        log = MockExecutionLog()
        log.add_entry("input", "Create a function to calculate factorial", 15)
        log.add_entry("output", "Here's the factorial function...", 45)
        log.add_tool_call("Edit", 8)
        log.add_tool_call("Read", 5)
        log.add_cache_hit("file_cache_key", 12)
        log.finalize()
        return log
    
    def test_token_tracker_initialization(self, token_tracker):
        """Test token tracker initializes correctly."""
        assert token_tracker.baseline_usage == {}
        assert token_tracker.optimization_history == []
        assert len(token_tracker.strategies) == 4
        assert "caching" in token_tracker.strategies
        assert "batching" in token_tracker.strategies
    
    def test_measure_token_usage(self, token_tracker, sample_execution_log):
        """Test token usage measurement."""
        metrics = token_tracker.measure_token_usage("test_task", sample_execution_log)
        
        assert metrics.input_tokens == 15
        assert metrics.output_tokens == 45
        assert metrics.tool_tokens == 13  # 8 + 5
        assert metrics.total_tokens == 73
        assert metrics.cache_hit_rate > 0  # Should have some cache hits
    
    def test_optimize_token_usage_low_cache_rate(self, token_tracker):
        """Test optimization plan for low cache hit rate."""
        metrics = MockTokenMetrics()
        metrics.total_tokens = 1000
        metrics.cache_hit_rate = 0.1  # Low cache rate
        
        plan = token_tracker.optimize_token_usage("test_task", metrics)
        
        assert len(plan.optimizations) > 0
        caching_opt = next((opt for opt in plan.optimizations if opt["type"] == "caching"), None)
        assert caching_opt is not None
        assert caching_opt["savings"] == 200  # 20% of 1000
        assert plan.estimated_savings >= 200
    
    def test_optimize_token_usage_multiple_strategies(self, token_tracker):
        """Test optimization plan with multiple strategies."""
        # Set up history to trigger batching optimization
        token_tracker.optimization_history = [{"task": "previous"}]
        
        metrics = MockTokenMetrics()
        metrics.total_tokens = 1000
        metrics.cache_hit_rate = 0.2
        metrics.compression_ratio = 0.95
        
        plan = token_tracker.optimize_token_usage("test_task", metrics)
        
        # Should have multiple optimizations
        assert len(plan.optimizations) >= 3  # caching, batching, compression
        assert plan.estimated_savings > 0
        assert 0 <= plan.confidence <= 1
    
    def test_baseline_comparison(self, token_tracker, sample_execution_log):
        """Test comparison with baseline usage."""
        # Set baseline
        baseline_metrics = MockTokenMetrics()
        baseline_metrics.total_tokens = 100
        token_tracker.set_baseline("test_task", baseline_metrics)
        
        # Measure current usage
        current_metrics = token_tracker.measure_token_usage("test_task", sample_execution_log)
        
        # Should calculate improvement
        expected_improvement = (100 - current_metrics.total_tokens) / 100
        assert abs(current_metrics.improvement - expected_improvement) < 0.01


class TestMemoryPersistenceProfiler:
    """Test the memory persistence profiler."""
    
    @pytest.fixture
    def memory_profiler(self):
        """Provide memory profiler instance."""
        return MockMemoryPersistenceProfiler()
    
    @pytest.mark.asyncio
    async def test_memory_profiler_initialization(self, memory_profiler):
        """Test memory profiler initializes correctly."""
        assert memory_profiler.memory_snapshots == []
        assert memory_profiler.persistence_overhead == {}
        assert memory_profiler.optimization_suggestions == []
    
    @pytest.mark.asyncio
    async def test_profile_memory_persistence(self, memory_profiler):
        """Test complete memory persistence profiling."""
        profile = await memory_profiler.profile_memory_persistence("test_swarm")
        
        assert profile.swarm_id == "test_swarm"
        assert len(profile.snapshots) == 11  # Initial + 10 periodic
        assert profile.overhead >= 0
        assert isinstance(profile.growth_rate, float)
        assert len(profile.optimizations) >= 0
    
    @pytest.mark.asyncio
    async def test_memory_snapshot_collection(self, memory_profiler):
        """Test memory snapshot collection."""
        snapshot = await memory_profiler._take_memory_snapshot()
        
        assert isinstance(snapshot, MockMemorySnapshot)
        assert snapshot.heap_used > 0
        assert snapshot.heap_total > snapshot.heap_used
        assert snapshot.timestamp is not None
        assert len(memory_profiler.memory_snapshots) == 1
    
    @pytest.mark.asyncio
    async def test_memory_operations_execution(self, memory_profiler):
        """Test memory operations execution."""
        await memory_profiler._execute_memory_operations("test_swarm")
        
        # Should have overhead measurements for different operations
        assert len(memory_profiler.persistence_overhead) == 4
        assert "store_agent_state" in memory_profiler.persistence_overhead
        assert "persist_task_results" in memory_profiler.persistence_overhead
        
        for operation, overhead in memory_profiler.persistence_overhead.items():
            assert 5 <= overhead <= 20  # Should be within expected range
    
    def test_memory_profile_metrics_calculation(self):
        """Test memory profile metrics calculation."""
        profile = MockMemoryProfile("test")
        
        # Add snapshots with increasing memory usage
        for i in range(5):
            snapshot = MockMemorySnapshot(datetime.now() + timedelta(seconds=i))
            snapshot.process_memory = 100 + i * 20  # Growing memory
            snapshot.gc_count = i
            profile.add_snapshot(snapshot)
        
        profile.calculate_metrics()
        
        assert profile.growth_rate > 0  # Should detect growth
        assert profile.overhead >= 0
        assert profile.gc_impact >= 0
    
    def test_optimization_suggestions_generation(self, memory_profiler):
        """Test generation of optimization suggestions."""
        profile = MockMemoryProfile("test")
        profile.growth_rate = 15  # High growth rate
        profile.overhead = 0.4   # High overhead
        profile.gc_impact = 8    # High GC frequency
        
        optimizations = memory_profiler._generate_optimizations(profile)
        
        assert len(optimizations) == 3  # Should have all three types
        
        # Check for memory leak optimization
        leak_opt = next((opt for opt in optimizations if opt["type"] == "memory_leak"), None)
        assert leak_opt is not None
        assert leak_opt["priority"] == "high"
        
        # Check for overhead optimization
        overhead_opt = next((opt for opt in optimizations if opt["type"] == "overhead"), None)
        assert overhead_opt is not None
        assert overhead_opt["priority"] == "medium"
        
        # Check for GC optimization
        gc_opt = next((opt for opt in optimizations if opt["type"] == "gc_frequency"), None)
        assert gc_opt is not None
        assert gc_opt["priority"] == "low"


class TestNeuralProcessingBenchmark:
    """Test the neural processing benchmark."""
    
    @pytest.fixture
    def neural_benchmark(self):
        """Provide neural benchmark instance."""
        return MockNeuralProcessingBenchmark()
    
    def test_neural_benchmark_initialization(self, neural_benchmark):
        """Test neural benchmark initializes correctly."""
        assert len(neural_benchmark.pattern_types) == 6
        assert "convergent" in neural_benchmark.pattern_types
        assert "abstract" in neural_benchmark.pattern_types
        assert neural_benchmark.performance_targets["pattern_recognition_ms"] == 100
        assert neural_benchmark.performance_targets["memory_usage_mb"] == 512
    
    @pytest.mark.asyncio
    async def test_complete_neural_benchmark(self, neural_benchmark):
        """Test complete neural processing benchmark."""
        results = await neural_benchmark.benchmark_neural_processing()
        
        assert isinstance(results, MockNeuralBenchmarkResult)
        assert len(results.pattern_results) == 6  # All patterns tested
        assert results.parallel_performance is not None
        assert results.memory_efficiency is not None
        assert 0 <= results.overall_score <= 1
    
    @pytest.mark.asyncio
    async def test_individual_pattern_benchmark(self, neural_benchmark):
        """Test individual pattern benchmarking."""
        pattern_result = await neural_benchmark._benchmark_pattern("convergent")
        
        assert pattern_result["pattern"] == "convergent"
        assert "recognition_time_ms" in pattern_result
        assert "inference_time_ms" in pattern_result
        assert "memory_usage_mb" in pattern_result
        assert "accuracy" in pattern_result
        assert "performance_score" in pattern_result
        
        # Verify ranges
        assert 50 <= pattern_result["recognition_time_ms"] <= 150
        assert 20 <= pattern_result["inference_time_ms"] <= 80
        assert 0.8 <= pattern_result["accuracy"] <= 0.95
        assert 0 <= pattern_result["performance_score"] <= 1
    
    @pytest.mark.asyncio
    async def test_parallel_processing_benchmark(self, neural_benchmark):
        """Test parallel processing benchmark."""
        parallel_result = await neural_benchmark._benchmark_parallel_processing()
        
        assert "results" in parallel_result
        assert "efficiency" in parallel_result
        assert "max_throughput" in parallel_result
        
        # Check all task counts were tested
        results = parallel_result["results"]
        assert "1_tasks" in results
        assert "8_tasks" in results
        
        # Verify efficiency calculation
        assert 0 <= parallel_result["efficiency"] <= 1
        assert parallel_result["max_throughput"] > 0
    
    @pytest.mark.asyncio
    async def test_memory_efficiency_benchmark(self, neural_benchmark):
        """Test memory efficiency benchmark."""
        memory_result = await neural_benchmark._benchmark_memory_efficiency()
        
        assert "results" in memory_result
        assert "efficiency" in memory_result
        assert "peak_memory_mb" in memory_result
        
        # Check all load types were tested
        results = memory_result["results"]
        assert "light" in results
        assert "medium" in results
        assert "heavy" in results
        
        # Verify efficiency values
        assert 0 <= memory_result["efficiency"] <= 1
        assert memory_result["peak_memory_mb"] > 0
    
    @pytest.mark.parametrize("pattern", ["convergent", "divergent", "lateral"])
    @pytest.mark.asyncio
    async def test_different_cognitive_patterns(self, neural_benchmark, pattern):
        """Test different cognitive patterns."""
        result = await neural_benchmark._benchmark_pattern(pattern)
        
        assert result["pattern"] == pattern
        assert result["performance_score"] >= 0
        # Each pattern should have consistent structure
        required_fields = ["recognition_time_ms", "inference_time_ms", "memory_usage_mb", "accuracy"]
        for field in required_fields:
            assert field in result


class TestPerformanceMetricsIntegration:
    """Test integration with core performance metrics."""
    
    def test_performance_metrics_compatibility(self):
        """Test compatibility with core PerformanceMetrics."""
        # Create mock metrics that would integrate with the core system
        token_metrics = MockTokenMetrics()
        token_metrics.input_tokens = 100
        token_metrics.output_tokens = 200
        token_metrics.total_tokens = 300
        
        # Simulate conversion to PerformanceMetrics
        perf_metrics = PerformanceMetrics(
            execution_time=5.0,
            throughput=token_metrics.total_tokens / 5.0,  # tokens per second
            success_rate=1.0
        )
        
        assert perf_metrics.execution_time == 5.0
        assert perf_metrics.throughput == 60.0  # 300 tokens / 5 seconds
        assert perf_metrics.success_rate == 1.0
    
    def test_resource_usage_compatibility(self):
        """Test compatibility with core ResourceUsage."""
        memory_snapshot = MockMemorySnapshot()
        
        # Simulate conversion to ResourceUsage
        resource_usage = ResourceUsage(
            memory_mb=memory_snapshot.process_memory,
            peak_memory_mb=memory_snapshot.process_memory * 1.2,
            cpu_percent=50.0
        )
        
        assert resource_usage.memory_mb == memory_snapshot.process_memory
        assert resource_usage.peak_memory_mb > resource_usage.memory_mb
        assert resource_usage.cpu_percent == 50.0


class TestErrorHandlingAndEdgeCases:
    """Test error handling and edge cases."""
    
    @pytest.mark.asyncio
    async def test_empty_execution_log(self):
        """Test handling of empty execution log."""
        tracker = MockTokenOptimizationTracker()
        empty_log = MockExecutionLog()
        empty_log.finalize()
        
        metrics = tracker.measure_token_usage("empty_task", empty_log)
        
        assert metrics.input_tokens == 0
        assert metrics.output_tokens == 0
        assert metrics.tool_tokens == 0
        assert metrics.cache_hit_rate == 0.0
        assert metrics.total_tokens == 0
    
    @pytest.mark.asyncio
    async def test_memory_profiler_error_handling(self):
        """Test memory profiler handles errors gracefully."""
        profiler = MockMemoryPersistenceProfiler()
        
        # Mock an error during snapshot collection
        original_take_snapshot = profiler._take_memory_snapshot
        
        async def failing_snapshot():
            raise Exception("Memory collection failed")
        
        with patch.object(profiler, '_take_memory_snapshot', side_effect=failing_snapshot):
            with pytest.raises(Exception, match="Memory collection failed"):
                await profiler.profile_memory_persistence("error_test")
    
    def test_optimization_plan_empty_optimizations(self):
        """Test optimization plan with no optimizations."""
        plan = MockOptimizationPlan()
        plan.calculate_confidence()
        
        assert len(plan.optimizations) == 0
        assert plan.estimated_savings == 0
        assert plan.confidence == 0.0
    
    def test_neural_benchmark_result_empty_patterns(self):
        """Test neural benchmark result with no patterns."""
        result = MockNeuralBenchmarkResult()
        result.calculate_overall_score()
        
        assert result.overall_score == 0.0
        assert len(result.pattern_results) == 0


class TestPerformanceAndStress:
    """Test performance characteristics and stress scenarios."""
    
    @pytest.mark.asyncio
    @pytest.mark.performance
    async def test_large_execution_log_processing(self):
        """Test processing large execution logs efficiently."""
        tracker = MockTokenOptimizationTracker()
        
        # Create large execution log
        large_log = MockExecutionLog()
        for i in range(1000):
            large_log.add_entry("input", f"Entry {i}", 10)
            large_log.add_entry("output", f"Response {i}", 25)
            large_log.add_tool_call(f"Tool_{i%5}", 5)
            if i % 10 == 0:
                large_log.add_cache_hit(f"cache_{i}", 8)
        large_log.finalize()
        
        start_time = datetime.now()
        metrics = tracker.measure_token_usage("large_task", large_log)
        end_time = datetime.now()
        
        duration = (end_time - start_time).total_seconds()
        assert duration < 1.0  # Should process quickly
        assert metrics.total_tokens == 40000  # 1000 * (10 + 25 + 5)
        assert metrics.cache_hit_rate > 0
    
    @pytest.mark.asyncio
    @pytest.mark.performance
    async def test_concurrent_memory_profiling(self):
        """Test concurrent memory profiling."""
        profiler = MockMemoryPersistenceProfiler()
        
        # Run multiple profiling sessions concurrently
        tasks = []
        for i in range(5):
            task = profiler.profile_memory_persistence(f"swarm_{i}")
            tasks.append(task)
        
        start_time = datetime.now()
        results = await asyncio.gather(*tasks)
        end_time = datetime.now()
        
        duration = (end_time - start_time).total_seconds()
        assert duration < 5.0  # Should complete efficiently
        assert len(results) == 5
        
        for i, profile in enumerate(results):
            assert profile.swarm_id == f"swarm_{i}"
            assert len(profile.snapshots) == 11
    
    @pytest.mark.asyncio
    @pytest.mark.stress
    async def test_neural_benchmark_stress(self):
        """Test neural benchmark under stress."""
        benchmark = MockNeuralProcessingBenchmark()
        
        # Run many benchmarks concurrently
        tasks = []
        for i in range(10):
            task = benchmark.benchmark_neural_processing()
            tasks.append(task)
        
        start_time = datetime.now()
        results = await asyncio.gather(*tasks)
        end_time = datetime.now()
        
        duration = (end_time - start_time).total_seconds()
        assert duration < 10.0  # Should handle stress well
        assert len(results) == 10
        
        for result in results:
            assert len(result.pattern_results) == 6
            assert result.overall_score >= 0


if __name__ == "__main__":
    pytest.main([__file__, "-v", "--tb=short"])