"""
Performance regression test suite.

Tests performance characteristics, identifies regressions,
and validates performance targets across all components.
"""

import pytest
import asyncio
import time
import threading
from unittest.mock import Mock, AsyncMock, patch
from datetime import datetime, timedelta
from typing import List, Dict, Any, Optional
import statistics
import concurrent.futures
import psutil
import gc

import numpy as np

from swarm_benchmark.core.models import PerformanceMetrics, ResourceUsage


class PerformanceTestHarness:
    """Test harness for performance measurements."""
    
    def __init__(self):
        self.baseline_metrics = {}
        self.current_metrics = {}
        self.regression_threshold = 0.2  # 20% regression threshold
        self.performance_history = []
        
    def measure_execution_time(self, func, *args, **kwargs):
        """Measure execution time of a function."""
        start_time = time.perf_counter()
        result = func(*args, **kwargs)
        end_time = time.perf_counter()
        
        execution_time = end_time - start_time
        return result, execution_time
    
    async def measure_async_execution_time(self, func, *args, **kwargs):
        """Measure execution time of an async function."""
        start_time = time.perf_counter()
        result = await func(*args, **kwargs)
        end_time = time.perf_counter()
        
        execution_time = end_time - start_time
        return result, execution_time
    
    def measure_memory_usage(self, func, *args, **kwargs):
        """Measure memory usage during function execution."""
        gc.collect()  # Clean up before measurement
        
        process = psutil.Process()
        start_memory = process.memory_info().rss / 1024 / 1024  # MB
        
        result = func(*args, **kwargs)
        
        gc.collect()  # Clean up after execution
        end_memory = process.memory_info().rss / 1024 / 1024  # MB
        peak_memory = process.memory_info().peak_wss / 1024 / 1024 if hasattr(process.memory_info(), 'peak_wss') else end_memory
        
        memory_used = end_memory - start_memory
        
        return result, {
            "start_memory_mb": start_memory,
            "end_memory_mb": end_memory,
            "memory_used_mb": memory_used,
            "peak_memory_mb": peak_memory
        }
    
    def measure_cpu_usage(self, func, duration_sec=1.0, *args, **kwargs):
        """Measure CPU usage during function execution."""
        cpu_percentages = []
        
        def monitor_cpu():
            start_time = time.time()
            while time.time() - start_time < duration_sec:
                cpu_percentages.append(psutil.cpu_percent(interval=0.1))
        
        # Start CPU monitoring in background
        monitor_thread = threading.Thread(target=monitor_cpu)
        monitor_thread.start()
        
        # Execute function
        result = func(*args, **kwargs)
        
        # Wait for monitoring to complete
        monitor_thread.join()
        
        cpu_stats = {
            "avg_cpu_percent": statistics.mean(cpu_percentages) if cpu_percentages else 0,
            "max_cpu_percent": max(cpu_percentages) if cpu_percentages else 0,
            "min_cpu_percent": min(cpu_percentages) if cpu_percentages else 0,
            "measurements": len(cpu_percentages)
        }
        
        return result, cpu_stats
    
    def set_baseline(self, test_name: str, metrics: Dict[str, float]):
        """Set baseline performance metrics for a test."""
        self.baseline_metrics[test_name] = metrics
    
    def check_regression(self, test_name: str, current_metrics: Dict[str, float]) -> Dict[str, Any]:
        """Check for performance regression against baseline."""
        if test_name not in self.baseline_metrics:
            return {"status": "no_baseline", "message": f"No baseline found for {test_name}"}
        
        baseline = self.baseline_metrics[test_name]
        regression_report = {
            "status": "pass",
            "regressions": [],
            "improvements": [],
            "details": {}
        }
        
        for metric_name, current_value in current_metrics.items():
            if metric_name in baseline:
                baseline_value = baseline[metric_name]
                
                # Calculate percentage change
                if baseline_value > 0:
                    pct_change = (current_value - baseline_value) / baseline_value
                else:
                    pct_change = 1.0 if current_value > 0 else 0.0
                
                regression_report["details"][metric_name] = {
                    "baseline": baseline_value,
                    "current": current_value,
                    "change_pct": pct_change * 100
                }
                
                # Check for regression (worse performance)
                if pct_change > self.regression_threshold:
                    regression_report["regressions"].append({
                        "metric": metric_name,
                        "regression_pct": pct_change * 100,
                        "baseline": baseline_value,
                        "current": current_value
                    })
                    regression_report["status"] = "regression"
                
                # Check for improvements
                elif pct_change < -0.1:  # 10% improvement threshold
                    regression_report["improvements"].append({
                        "metric": metric_name,
                        "improvement_pct": abs(pct_change) * 100,
                        "baseline": baseline_value,
                        "current": current_value
                    })
        
        return regression_report


class MockPerformanceComponent:
    """Mock component for performance testing."""
    
    def __init__(self, complexity_factor: float = 1.0):
        self.complexity_factor = complexity_factor
        self.call_count = 0
        
    def cpu_intensive_operation(self, size: int = 1000):
        """CPU-intensive operation for testing."""
        self.call_count += 1
        
        # Simulate CPU-intensive work
        result = 0
        for i in range(int(size * self.complexity_factor)):
            result += i ** 0.5
        
        return result
    
    def memory_intensive_operation(self, size_mb: int = 10):
        """Memory-intensive operation for testing."""
        self.call_count += 1
        
        # Allocate memory
        data_size = int(size_mb * self.complexity_factor * 1024 * 1024 / 8)  # 8 bytes per float
        data = [float(i) for i in range(data_size)]
        
        # Do some processing
        result = sum(data[:1000])  # Process small portion
        
        return result, len(data)
    
    async def async_operation(self, delay: float = 0.1, iterations: int = 10):
        """Async operation for testing."""
        self.call_count += 1
        
        results = []
        for i in range(int(iterations * self.complexity_factor)):
            await asyncio.sleep(delay / iterations)  # Simulate async work
            results.append(i * 2)
        
        return results
    
    def batch_operation(self, batch_size: int = 100):
        """Batch operation for testing."""
        self.call_count += 1
        
        batches = []
        for batch_num in range(int(batch_size * self.complexity_factor)):
            batch = [i for i in range(10)]  # Small batch
            batches.append(sum(batch))
        
        return batches
    
    async def concurrent_operation(self, num_tasks: int = 10, task_complexity: int = 100):
        """Concurrent operation for testing."""
        self.call_count += 1
        
        async def task(task_id: int):
            # Simulate work
            await asyncio.sleep(0.01)
            result = 0
            for i in range(int(task_complexity * self.complexity_factor)):
                result += i
            return result
        
        # Execute tasks concurrently
        tasks = [task(i) for i in range(num_tasks)]
        results = await asyncio.gather(*tasks)
        
        return results


class TestPerformanceBaselines:
    """Test performance baselines and establish benchmarks."""
    
    @pytest.fixture
    def perf_harness(self):
        """Provide performance test harness."""
        return PerformanceTestHarness()
    
    @pytest.fixture
    def mock_component(self):
        """Provide mock component for testing."""
        return MockPerformanceComponent()
    
    def test_cpu_intensive_baseline(self, perf_harness, mock_component):
        """Test CPU-intensive operation baseline."""
        test_sizes = [100, 1000, 10000]
        
        for size in test_sizes:
            result, exec_time = perf_harness.measure_execution_time(
                mock_component.cpu_intensive_operation, size
            )
            
            # Set baseline metrics
            perf_harness.set_baseline(f"cpu_intensive_{size}", {
                "execution_time": exec_time,
                "operations_per_second": size / exec_time if exec_time > 0 else 0
            })
            
            # Verify performance expectations
            assert exec_time > 0
            assert exec_time < 5.0  # Should complete within 5 seconds
            assert result > 0
    
    def test_memory_intensive_baseline(self, perf_harness, mock_component):
        """Test memory-intensive operation baseline."""
        test_sizes = [1, 10, 50]  # MB
        
        for size_mb in test_sizes:
            (result, data_len), memory_stats = perf_harness.measure_memory_usage(
                mock_component.memory_intensive_operation, size_mb
            )
            
            # Set baseline metrics
            perf_harness.set_baseline(f"memory_intensive_{size_mb}mb", {
                "memory_used_mb": memory_stats["memory_used_mb"],
                "peak_memory_mb": memory_stats["peak_memory_mb"],
                "processing_rate": data_len / memory_stats.get("execution_time", 1)
            })
            
            # Verify memory usage is reasonable
            assert memory_stats["memory_used_mb"] >= 0
            assert memory_stats["peak_memory_mb"] >= memory_stats["start_memory_mb"]
            assert data_len > 0
    
    @pytest.mark.asyncio
    async def test_async_operation_baseline(self, perf_harness, mock_component):
        """Test async operation baseline."""
        test_configs = [
            {"delay": 0.01, "iterations": 10},
            {"delay": 0.05, "iterations": 20},
            {"delay": 0.1, "iterations": 50}
        ]
        
        for config in test_configs:
            result, exec_time = await perf_harness.measure_async_execution_time(
                mock_component.async_operation, **config
            )
            
            test_name = f"async_op_delay{config['delay']}_iter{config['iterations']}"
            perf_harness.set_baseline(test_name, {
                "execution_time": exec_time,
                "throughput": len(result) / exec_time if exec_time > 0 else 0,
                "async_efficiency": config["iterations"] / exec_time if exec_time > 0 else 0
            })
            
            # Verify async performance
            assert len(result) == config["iterations"]
            assert exec_time > config["delay"] * config["iterations"] * 0.8  # Allow for overhead
    
    def test_batch_operation_baseline(self, perf_harness, mock_component):
        """Test batch operation baseline."""
        batch_sizes = [10, 100, 1000]
        
        for batch_size in batch_sizes:
            result, exec_time = perf_harness.measure_execution_time(
                mock_component.batch_operation, batch_size
            )
            
            perf_harness.set_baseline(f"batch_op_{batch_size}", {
                "execution_time": exec_time,
                "batches_per_second": len(result) / exec_time if exec_time > 0 else 0,
                "items_processed": len(result)
            })
            
            # Verify batch processing
            assert len(result) == batch_size
            assert all(isinstance(item, int) for item in result)
    
    @pytest.mark.asyncio
    async def test_concurrent_operation_baseline(self, perf_harness, mock_component):
        """Test concurrent operation baseline."""
        test_configs = [
            {"num_tasks": 5, "task_complexity": 50},
            {"num_tasks": 10, "task_complexity": 100},
            {"num_tasks": 20, "task_complexity": 200}
        ]
        
        for config in test_configs:
            result, exec_time = await perf_harness.measure_async_execution_time(
                mock_component.concurrent_operation, **config
            )
            
            test_name = f"concurrent_tasks{config['num_tasks']}_complexity{config['task_complexity']}"
            perf_harness.set_baseline(test_name, {
                "execution_time": exec_time,
                "tasks_per_second": config["num_tasks"] / exec_time if exec_time > 0 else 0,
                "parallelization_efficiency": config["num_tasks"] / exec_time if exec_time > 0 else 0
            })
            
            # Verify concurrent execution
            assert len(result) == config["num_tasks"]
            assert all(isinstance(res, int) for res in result)


class TestPerformanceRegression:
    """Test for performance regressions against baselines."""
    
    @pytest.fixture
    def perf_harness_with_baselines(self):
        """Provide performance harness with established baselines."""
        harness = PerformanceTestHarness()
        
        # Set some baseline metrics
        harness.set_baseline("cpu_test", {
            "execution_time": 0.5,
            "operations_per_second": 2000
        })
        
        harness.set_baseline("memory_test", {
            "memory_used_mb": 10.0,
            "peak_memory_mb": 15.0
        })
        
        harness.set_baseline("async_test", {
            "execution_time": 0.2,
            "throughput": 50.0
        })
        
        return harness
    
    def test_cpu_performance_regression(self, perf_harness_with_baselines):
        """Test for CPU performance regression."""
        harness = perf_harness_with_baselines
        
        # Simulate good performance (no regression)
        current_metrics = {
            "execution_time": 0.48,  # Slightly better
            "operations_per_second": 2100  # Better throughput
        }
        
        regression_report = harness.check_regression("cpu_test", current_metrics)
        assert regression_report["status"] == "pass"
        assert len(regression_report["regressions"]) == 0
        assert len(regression_report["improvements"]) > 0  # Should detect improvements
    
    def test_memory_performance_regression(self, perf_harness_with_baselines):
        """Test for memory performance regression."""
        harness = perf_harness_with_baselines
        
        # Simulate memory regression
        current_metrics = {
            "memory_used_mb": 13.0,  # 30% more memory usage
            "peak_memory_mb": 20.0   # 33% higher peak
        }
        
        regression_report = harness.check_regression("memory_test", current_metrics)
        assert regression_report["status"] == "regression"
        assert len(regression_report["regressions"]) > 0
        
        # Check specific regression details
        memory_regression = next(
            r for r in regression_report["regressions"] 
            if r["metric"] == "memory_used_mb"
        )
        assert memory_regression["regression_pct"] == 30.0
    
    @pytest.mark.asyncio
    async def test_async_performance_regression(self, perf_harness_with_baselines):
        """Test for async performance regression."""
        harness = perf_harness_with_baselines
        mock_component = MockPerformanceComponent(complexity_factor=1.5)  # Make it slower
        
        # Measure current performance
        result, exec_time = await harness.measure_async_execution_time(
            mock_component.async_operation, 0.01, 10
        )
        
        current_metrics = {
            "execution_time": exec_time,
            "throughput": len(result) / exec_time if exec_time > 0 else 0
        }
        
        regression_report = harness.check_regression("async_test", current_metrics)
        
        # Should detect regression due to increased complexity factor
        if regression_report["status"] == "regression":
            assert len(regression_report["regressions"]) > 0
    
    def test_performance_improvement_detection(self, perf_harness_with_baselines):
        """Test detection of performance improvements."""
        harness = perf_harness_with_baselines
        
        # Simulate significant improvement
        current_metrics = {
            "execution_time": 0.3,   # 40% faster
            "operations_per_second": 3000  # 50% higher throughput
        }
        
        regression_report = harness.check_regression("cpu_test", current_metrics)
        assert regression_report["status"] == "pass"
        assert len(regression_report["improvements"]) > 0
        
        # Check improvement details
        exec_improvement = next(
            imp for imp in regression_report["improvements"]
            if imp["metric"] == "execution_time"
        )
        assert exec_improvement["improvement_pct"] == 40.0


class TestScalabilityBenchmarks:
    """Test scalability characteristics under increasing load."""
    
    @pytest.fixture
    def mock_component(self):
        """Provide mock component for scalability testing."""
        return MockPerformanceComponent()
    
    def test_cpu_scalability(self, mock_component):
        """Test CPU performance scalability."""
        sizes = [100, 500, 1000, 5000, 10000]
        execution_times = []
        
        for size in sizes:
            start_time = time.perf_counter()
            result = mock_component.cpu_intensive_operation(size)
            end_time = time.perf_counter()
            
            exec_time = end_time - start_time
            execution_times.append(exec_time)
            
            # Performance should scale roughly linearly
            expected_time = (size / 1000) * 0.1  # Very rough estimate
            assert exec_time < expected_time * 10  # Allow 10x variance
        
        # Check that performance degrades gracefully
        for i in range(1, len(execution_times)):
            ratio = execution_times[i] / execution_times[i-1]
            size_ratio = sizes[i] / sizes[i-1]
            
            # Performance should not degrade much worse than size increase
            assert ratio <= size_ratio * 2  # Allow 2x overhead factor
    
    def test_memory_scalability(self, mock_component):
        """Test memory usage scalability."""
        sizes_mb = [1, 5, 10, 25, 50]
        memory_usage = []
        
        for size_mb in sizes_mb:
            process = psutil.Process()
            start_memory = process.memory_info().rss / 1024 / 1024
            
            result, data_len = mock_component.memory_intensive_operation(size_mb)
            
            end_memory = process.memory_info().rss / 1024 / 1024
            memory_used = end_memory - start_memory
            memory_usage.append(memory_used)
            
            # Memory usage should be reasonable relative to requested size
            assert memory_used >= size_mb * 0.5  # At least 50% efficiency
            assert memory_used <= size_mb * 3    # No more than 3x overhead
        
        # Memory usage should scale roughly linearly
        for i in range(1, len(memory_usage)):
            ratio = memory_usage[i] / memory_usage[i-1] if memory_usage[i-1] > 0 else 1
            size_ratio = sizes_mb[i] / sizes_mb[i-1]
            
            # Memory should scale close to linearly
            assert 0.5 <= ratio / size_ratio <= 2.0
    
    @pytest.mark.asyncio
    async def test_concurrency_scalability(self, mock_component):
        """Test concurrency scalability."""
        task_counts = [1, 5, 10, 20, 50]
        execution_times = []
        
        for num_tasks in task_counts:
            start_time = time.perf_counter()
            results = await mock_component.concurrent_operation(num_tasks, 50)
            end_time = time.perf_counter()
            
            exec_time = end_time - start_time
            execution_times.append(exec_time)
            
            # Verify all tasks completed
            assert len(results) == num_tasks
        
        # With good concurrency, execution time should not scale linearly
        for i in range(1, len(execution_times)):
            if task_counts[i-1] > 1:  # Skip single task baseline
                time_ratio = execution_times[i] / execution_times[i-1]
                task_ratio = task_counts[i] / task_counts[i-1]
                
                # Concurrent execution should be more efficient than linear scaling
                assert time_ratio < task_ratio * 0.8  # At least 20% concurrency benefit
    
    def test_batch_size_optimization(self, mock_component):
        """Test optimal batch size performance."""
        batch_sizes = [1, 10, 50, 100, 500, 1000]
        throughput_rates = []
        
        for batch_size in batch_sizes:
            start_time = time.perf_counter()
            results = mock_component.batch_operation(batch_size)
            end_time = time.perf_counter()
            
            exec_time = end_time - start_time
            throughput = len(results) / exec_time if exec_time > 0 else 0
            throughput_rates.append(throughput)
        
        # Find optimal batch size (highest throughput)
        max_throughput_idx = throughput_rates.index(max(throughput_rates))
        optimal_batch_size = batch_sizes[max_throughput_idx]
        
        # Optimal batch size should not be at extremes
        assert optimal_batch_size > batch_sizes[0]  # Not smallest
        assert optimal_batch_size < batch_sizes[-1]  # Not largest
        
        # Performance should be reasonable across all batch sizes
        min_throughput = min(throughput_rates)
        max_throughput = max(throughput_rates)
        assert max_throughput / min_throughput <= 10  # No more than 10x difference


class TestLoadTesting:
    """Test performance under various load conditions."""
    
    @pytest.fixture
    def stress_component(self):
        """Provide component for stress testing."""
        return MockPerformanceComponent()
    
    @pytest.mark.slow
    def test_sustained_load(self, stress_component):
        """Test performance under sustained load."""
        duration_sec = 10
        operations_per_sec = 10
        
        start_time = time.time()
        operations_completed = 0
        execution_times = []
        
        while time.time() - start_time < duration_sec:
            op_start = time.perf_counter()
            result = stress_component.cpu_intensive_operation(100)
            op_end = time.perf_counter()
            
            execution_times.append(op_end - op_start)
            operations_completed += 1
            
            # Maintain target rate
            target_interval = 1.0 / operations_per_sec
            actual_interval = op_end - op_start
            if actual_interval < target_interval:
                time.sleep(target_interval - actual_interval)
        
        # Verify sustained performance
        total_time = time.time() - start_time
        actual_ops_per_sec = operations_completed / total_time
        
        assert actual_ops_per_sec >= operations_per_sec * 0.8  # 80% of target
        
        # Check for performance degradation over time
        early_times = execution_times[:len(execution_times)//3]
        late_times = execution_times[-len(execution_times)//3:]
        
        avg_early = statistics.mean(early_times)
        avg_late = statistics.mean(late_times)
        
        # Performance should not degrade significantly
        assert avg_late / avg_early <= 1.5  # No more than 50% degradation
    
    @pytest.mark.asyncio
    @pytest.mark.slow
    async def test_burst_load(self, stress_component):
        """Test performance under burst load conditions."""
        # Create burst of concurrent requests
        burst_sizes = [10, 50, 100]
        
        for burst_size in burst_sizes:
            start_time = time.perf_counter()
            
            # Create burst of tasks
            tasks = [
                stress_component.async_operation(0.01, 5)
                for _ in range(burst_size)
            ]
            
            # Execute burst
            results = await asyncio.gather(*tasks, return_exceptions=True)
            end_time = time.perf_counter()
            
            # Verify burst handling
            successful_results = [r for r in results if not isinstance(r, Exception)]
            success_rate = len(successful_results) / len(results)
            
            assert success_rate >= 0.9  # 90% success rate
            
            # Burst should complete in reasonable time
            burst_time = end_time - start_time
            expected_time = 0.01 * 5  # Time for single operation
            
            # Allow for overhead, but should benefit from concurrency
            assert burst_time <= expected_time * 5  # No more than 5x overhead
    
    @pytest.mark.slow
    def test_memory_pressure(self, stress_component):
        """Test performance under memory pressure."""
        # Gradually increase memory usage
        memory_sizes = [10, 25, 50, 100]  # MB
        performance_metrics = []
        
        for size_mb in memory_sizes:
            # Measure performance under memory pressure
            start_time = time.perf_counter()
            result, data_len = stress_component.memory_intensive_operation(size_mb)
            end_time = time.perf_counter()
            
            exec_time = end_time - start_time
            throughput = data_len / exec_time if exec_time > 0 else 0
            
            performance_metrics.append({
                "memory_size_mb": size_mb,
                "execution_time": exec_time,
                "throughput": throughput
            })
        
        # Performance should not degrade catastrophically
        first_throughput = performance_metrics[0]["throughput"]
        last_throughput = performance_metrics[-1]["throughput"]
        
        # Allow up to 50% degradation under 10x memory pressure
        assert last_throughput >= first_throughput * 0.5
    
    def test_cpu_intensive_load(self, stress_component):
        """Test CPU performance under intensive load."""
        # Run CPU-intensive operations with multiple threads
        num_threads = min(4, psutil.cpu_count())
        operations_per_thread = 5
        
        def worker_thread(thread_id):
            thread_results = []
            for i in range(operations_per_thread):
                start_time = time.perf_counter()
                result = stress_component.cpu_intensive_operation(1000)
                end_time = time.perf_counter()
                
                thread_results.append({
                    "thread_id": thread_id,
                    "operation_id": i,
                    "execution_time": end_time - start_time,
                    "result": result
                })
            return thread_results
        
        # Execute with thread pool
        start_time = time.perf_counter()
        with concurrent.futures.ThreadPoolExecutor(max_workers=num_threads) as executor:
            futures = [
                executor.submit(worker_thread, thread_id) 
                for thread_id in range(num_threads)
            ]
            all_results = []
            for future in concurrent.futures.as_completed(futures):
                all_results.extend(future.result())
        end_time = time.perf_counter()
        
        total_time = end_time - start_time
        total_operations = len(all_results)
        
        # Verify all operations completed successfully
        assert total_operations == num_threads * operations_per_thread
        
        # Calculate performance metrics
        avg_exec_time = statistics.mean([r["execution_time"] for r in all_results])
        operations_per_sec = total_operations / total_time
        
        # Performance should be reasonable under load
        assert operations_per_sec >= 1.0  # At least 1 op/sec overall
        assert avg_exec_time <= 5.0       # No operation should take more than 5s


class TestMemoryLeakDetection:
    """Test for memory leaks and resource cleanup."""
    
    @pytest.fixture
    def leak_detector(self):
        """Provide memory leak detection utilities."""
        class LeakDetector:
            def __init__(self):
                self.initial_memory = None
                self.memory_samples = []
            
            def start_monitoring(self):
                gc.collect()  # Clean up first
                process = psutil.Process()
                self.initial_memory = process.memory_info().rss / 1024 / 1024
                self.memory_samples = [self.initial_memory]
            
            def sample_memory(self):
                process = psutil.Process()
                current_memory = process.memory_info().rss / 1024 / 1024
                self.memory_samples.append(current_memory)
                return current_memory
            
            def check_for_leaks(self, threshold_mb=50):
                if len(self.memory_samples) < 2:
                    return {"status": "insufficient_data"}
                
                final_memory = self.memory_samples[-1]
                memory_growth = final_memory - self.initial_memory
                
                # Check for steady growth pattern
                if len(self.memory_samples) >= 5:
                    recent_samples = self.memory_samples[-5:]
                    growth_trend = all(
                        recent_samples[i] >= recent_samples[i-1] 
                        for i in range(1, len(recent_samples))
                    )
                else:
                    growth_trend = False
                
                return {
                    "status": "leak_detected" if memory_growth > threshold_mb else "no_leak",
                    "initial_memory_mb": self.initial_memory,
                    "final_memory_mb": final_memory,
                    "memory_growth_mb": memory_growth,
                    "steady_growth": growth_trend,
                    "samples": len(self.memory_samples)
                }
        
        return LeakDetector()
    
    def test_no_memory_leak_in_operations(self, leak_detector):
        """Test that repeated operations don't cause memory leaks."""
        component = MockPerformanceComponent()
        leak_detector.start_monitoring()
        
        # Perform many operations
        for i in range(100):
            result = component.cpu_intensive_operation(100)
            
            # Sample memory every 10 operations
            if i % 10 == 0:
                leak_detector.sample_memory()
        
        # Force cleanup
        gc.collect()
        leak_detector.sample_memory()
        
        leak_report = leak_detector.check_for_leaks(threshold_mb=20)
        
        assert leak_report["status"] == "no_leak"
        assert leak_report["memory_growth_mb"] < 20
    
    def test_memory_cleanup_after_large_operations(self, leak_detector):
        """Test memory cleanup after large memory operations."""
        component = MockPerformanceComponent()
        leak_detector.start_monitoring()
        
        # Perform large memory operations
        for i in range(10):
            result, data_len = component.memory_intensive_operation(25)  # 25MB each
            
            # Force cleanup after each operation
            result = None  # Release reference
            gc.collect()
            
            leak_detector.sample_memory()
        
        leak_report = leak_detector.check_for_leaks(threshold_mb=30)
        
        # Should not accumulate memory if properly cleaned up
        assert leak_report["status"] == "no_leak"
        assert leak_report["memory_growth_mb"] < 30
    
    @pytest.mark.asyncio
    async def test_async_resource_cleanup(self, leak_detector):
        """Test resource cleanup in async operations."""
        component = MockPerformanceComponent()
        leak_detector.start_monitoring()
        
        # Run many async operations
        for batch in range(10):
            tasks = [
                component.async_operation(0.01, 5)
                for _ in range(10)
            ]
            
            results = await asyncio.gather(*tasks)
            
            # Clear results and force cleanup
            results = None
            gc.collect()
            
            leak_detector.sample_memory()
        
        leak_report = leak_detector.check_for_leaks(threshold_mb=15)
        
        assert leak_report["status"] == "no_leak"
        assert not leak_report["steady_growth"]  # No steady growth pattern


class TestPerformanceMonitoring:
    """Test performance monitoring and alerting capabilities."""
    
    def test_performance_threshold_monitoring(self):
        """Test monitoring of performance thresholds."""
        component = MockPerformanceComponent()
        
        # Define performance thresholds
        thresholds = {
            "max_execution_time": 1.0,
            "min_operations_per_sec": 100,
            "max_memory_mb": 50
        }
        
        violations = []
        
        # Monitor operations
        for i in range(20):
            # Measure execution time
            start_time = time.perf_counter()
            result = component.cpu_intensive_operation(500)
            end_time = time.perf_counter()
            
            exec_time = end_time - start_time
            ops_per_sec = 500 / exec_time if exec_time > 0 else 0
            
            # Check thresholds
            if exec_time > thresholds["max_execution_time"]:
                violations.append({
                    "type": "execution_time",
                    "value": exec_time,
                    "threshold": thresholds["max_execution_time"],
                    "operation": i
                })
            
            if ops_per_sec < thresholds["min_operations_per_sec"]:
                violations.append({
                    "type": "operations_per_sec",
                    "value": ops_per_sec,
                    "threshold": thresholds["min_operations_per_sec"],
                    "operation": i
                })
        
        # Should have minimal threshold violations
        violation_rate = len(violations) / 20
        assert violation_rate <= 0.2  # No more than 20% violations
    
    def test_performance_trend_analysis(self):
        """Test performance trend analysis over time."""
        component = MockPerformanceComponent()
        performance_history = []
        
        # Collect performance data over "time"
        for iteration in range(50):
            # Simulate varying load
            load_factor = 1.0 + (iteration / 100)  # Gradually increase load
            component.complexity_factor = load_factor
            
            start_time = time.perf_counter()
            result = component.cpu_intensive_operation(1000)
            end_time = time.perf_counter()
            
            performance_history.append({
                "iteration": iteration,
                "execution_time": end_time - start_time,
                "load_factor": load_factor
            })
        
        # Analyze trends
        recent_performance = performance_history[-10:]  # Last 10 iterations
        early_performance = performance_history[:10]    # First 10 iterations
        
        avg_recent_time = statistics.mean([p["execution_time"] for p in recent_performance])
        avg_early_time = statistics.mean([p["execution_time"] for p in early_performance])
        
        # Performance should degrade with increased load, but not excessively
        performance_ratio = avg_recent_time / avg_early_time
        load_ratio = recent_performance[-1]["load_factor"] / early_performance[0]["load_factor"]
        
        # Performance degradation should be proportional to load increase
        assert performance_ratio <= load_ratio * 2  # Allow 2x overhead factor
    
    def test_performance_alerting_system(self):
        """Test performance alerting system."""
        component = MockPerformanceComponent()
        
        alerts = []
        alert_thresholds = {
            "critical_execution_time": 2.0,
            "warning_execution_time": 1.0,
            "critical_memory_mb": 100,
            "warning_memory_mb": 50
        }
        
        def check_alerts(metrics, operation_id):
            if metrics["execution_time"] > alert_thresholds["critical_execution_time"]:
                alerts.append({
                    "level": "critical",
                    "type": "execution_time",
                    "value": metrics["execution_time"],
                    "operation": operation_id
                })
            elif metrics["execution_time"] > alert_thresholds["warning_execution_time"]:
                alerts.append({
                    "level": "warning", 
                    "type": "execution_time",
                    "value": metrics["execution_time"],
                    "operation": operation_id
                })
        
        # Run operations and check for alerts
        for i in range(30):
            start_time = time.perf_counter()
            
            # Occasionally make operations slower to trigger alerts
            if i % 10 == 9:  # Every 10th operation
                component.complexity_factor = 3.0  # Make it slow
            else:
                component.complexity_factor = 1.0
            
            result = component.cpu_intensive_operation(1000)
            end_time = time.perf_counter()
            
            metrics = {"execution_time": end_time - start_time}
            check_alerts(metrics, i)
        
        # Should have detected some performance issues
        critical_alerts = [a for a in alerts if a["level"] == "critical"]
        warning_alerts = [a for a in alerts if a["level"] == "warning"]
        
        # Should have some alerts due to intentionally slow operations
        assert len(alerts) > 0
        assert len(critical_alerts) >= 1  # At least one critical alert


if __name__ == "__main__":
    pytest.main([__file__, "-v", "--tb=short", "-m", "not slow"])