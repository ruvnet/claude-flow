#!/usr/bin/env python3
"""
Parallel Benchmark Execution Engine
Optimized for concurrent Hive Mind testing with resource management
"""

import os
import sys
import json
import time
import queue
import threading
from pathlib import Path
from datetime import datetime
from dataclasses import dataclass, asdict
from typing import Dict, List, Any, Optional, Callable
from concurrent.futures import ThreadPoolExecutor, ProcessPoolExecutor, as_completed
from multiprocessing import cpu_count, Manager

# Add parent directory to path
sys.path.append(str(Path(__file__).parent.parent))
from benchmark_runner import HiveMindBenchmarkRunner, BenchmarkConfig, BenchmarkResult

@dataclass
class ExecutionContext:
    """Execution context for parallel benchmark runs"""
    worker_id: int
    process_id: int
    thread_id: int
    start_time: float
    resource_limits: Dict[str, Any]
    isolation_level: str  # thread, process, container

@dataclass
class ResourceConstraint:
    """Resource constraints for benchmark execution"""
    max_memory_mb: int
    max_cpu_percent: float
    max_duration_seconds: int
    max_concurrent_agents: int
    priority: int  # 1-10, higher = more resources

class ResourceManager:
    """Manages system resources for parallel benchmark execution"""
    
    def __init__(self, total_memory_mb: int = None, total_cpu_cores: int = None):
        self.total_memory_mb = total_memory_mb or self._get_system_memory()
        self.total_cpu_cores = total_cpu_cores or cpu_count()
        self.allocated_memory = 0
        self.allocated_cores = 0
        self.active_workers = {}
        self.lock = threading.Lock()
        
        # Reserve 25% of resources for system
        self.available_memory_mb = int(self.total_memory_mb * 0.75)
        self.available_cores = max(1, int(self.total_cpu_cores * 0.75))
        
    def _get_system_memory(self) -> int:
        """Get total system memory in MB"""
        try:
            import psutil
            return int(psutil.virtual_memory().total / 1024 / 1024)
        except ImportError:
            return 4096  # Default 4GB
            
    def can_allocate(self, constraint: ResourceConstraint) -> bool:
        """Check if resources can be allocated"""
        with self.lock:
            memory_needed = constraint.max_memory_mb
            cores_needed = constraint.max_cpu_percent / 100.0
            
            return (self.allocated_memory + memory_needed <= self.available_memory_mb and
                   self.allocated_cores + cores_needed <= self.available_cores)
                   
    def allocate(self, worker_id: int, constraint: ResourceConstraint) -> bool:
        """Allocate resources for a worker"""
        with self.lock:
            if self.can_allocate(constraint):
                self.allocated_memory += constraint.max_memory_mb
                self.allocated_cores += constraint.max_cpu_percent / 100.0
                self.active_workers[worker_id] = {
                    'memory_mb': constraint.max_memory_mb,
                    'cpu_percent': constraint.max_cpu_percent,
                    'start_time': time.time()
                }
                return True
            return False
            
    def deallocate(self, worker_id: int):
        """Deallocate resources for a worker"""
        with self.lock:
            if worker_id in self.active_workers:
                worker = self.active_workers[worker_id]
                self.allocated_memory -= worker['memory_mb']
                self.allocated_cores -= worker['cpu_percent'] / 100.0
                del self.active_workers[worker_id]
                
    def get_resource_usage(self) -> Dict[str, Any]:
        """Get current resource usage statistics"""
        with self.lock:
            return {
                'memory_usage_percent': (self.allocated_memory / self.available_memory_mb) * 100,
                'cpu_usage_percent': (self.allocated_cores / self.available_cores) * 100,
                'active_workers': len(self.active_workers),
                'allocated_memory_mb': self.allocated_memory,
                'allocated_cores': self.allocated_cores,
                'available_memory_mb': self.available_memory_mb,
                'available_cores': self.available_cores
            }

class ParallelBenchmarkExecutor:
    """Advanced parallel execution engine for Hive Mind benchmarks"""
    
    def __init__(self, max_workers: int = None, resource_manager: ResourceManager = None):
        self.max_workers = max_workers or min(cpu_count(), 6)
        self.resource_manager = resource_manager or ResourceManager()
        self.results_queue = queue.Queue()
        self.error_queue = queue.Queue()
        self.progress_callbacks = []
        self.execution_stats = {
            'started': 0,
            'completed': 0,
            'failed': 0,
            'skipped': 0
        }
        
    def add_progress_callback(self, callback: Callable[[Dict[str, Any]], None]):
        """Add progress monitoring callback"""
        self.progress_callbacks.append(callback)
        
    def _notify_progress(self, event: Dict[str, Any]):
        """Notify all progress callbacks"""
        for callback in self.progress_callbacks:
            try:
                callback(event)
            except Exception as e:
                print(f"Progress callback error: {e}")
                
    def _categorize_benchmarks(self, configs: List[BenchmarkConfig]) -> Dict[str, List[BenchmarkConfig]]:
        """Categorize benchmarks by resource requirements"""
        categories = {
            'light': [],    # ≤10 agents, ≤30s
            'medium': [],   # ≤50 agents, ≤60s
            'heavy': [],    # ≤200 agents, ≤120s
            'extreme': []   # >200 agents or >120s
        }
        
        for config in configs:
            if config.agent_count <= 10 and config.duration_seconds <= 30:
                categories['light'].append(config)
            elif config.agent_count <= 50 and config.duration_seconds <= 60:
                categories['medium'].append(config)
            elif config.agent_count <= 200 and config.duration_seconds <= 120:
                categories['heavy'].append(config)
            else:
                categories['extreme'].append(config)
                
        return categories
        
    def _create_resource_constraint(self, config: BenchmarkConfig) -> ResourceConstraint:
        """Create resource constraint based on benchmark configuration"""
        # Base resource calculation
        base_memory = 50  # Base memory per benchmark
        memory_per_agent = 2  # Memory per agent
        max_memory = base_memory + (config.agent_count * memory_per_agent)
        
        # CPU estimation based on complexity
        complexity_multiplier = {
            'simple': 1.0,
            'medium': 1.5,
            'complex': 2.0,
            'enterprise': 3.0
        }.get(config.task_complexity, 1.0)
        
        max_cpu = min(50.0, 10.0 + (config.agent_count * 0.5 * complexity_multiplier))
        
        # Priority based on agent count (smaller = higher priority for parallel execution)
        priority = 10 - min(9, config.agent_count // 20)
        
        return ResourceConstraint(
            max_memory_mb=int(max_memory),
            max_cpu_percent=max_cpu,
            max_duration_seconds=config.duration_seconds * 2,  # 2x safety margin
            max_concurrent_agents=config.agent_count,
            priority=priority
        )
        
    def _execute_single_benchmark(self, config: BenchmarkConfig, worker_id: int, 
                                 context: ExecutionContext) -> Optional[BenchmarkResult]:
        """Execute single benchmark with resource monitoring"""
        constraint = self._create_resource_constraint(config)
        
        # Wait for resource allocation
        allocation_start = time.time()
        while not self.resource_manager.allocate(worker_id, constraint):
            if time.time() - allocation_start > 60:  # 1 minute timeout
                self._notify_progress({
                    'type': 'resource_timeout',
                    'worker_id': worker_id,
                    'config_name': config.name,
                    'constraint': asdict(constraint)
                })
                return None
            time.sleep(1)
            
        try:
            self._notify_progress({
                'type': 'benchmark_start',
                'worker_id': worker_id,
                'config_name': config.name,
                'agent_count': config.agent_count,
                'context': asdict(context)
            })
            
            # Execute benchmark
            runner = HiveMindBenchmarkRunner()
            start_time = time.time()
            result = runner.run_single_benchmark(config)
            execution_time = time.time() - start_time
            
            # Add execution context to result
            if result:
                result.execution_context = asdict(context)
                result.execution_time = execution_time
                result.resource_constraint = asdict(constraint)
                
            self._notify_progress({
                'type': 'benchmark_complete',
                'worker_id': worker_id,
                'config_name': config.name,
                'success': result.success if result else False,
                'execution_time': execution_time
            })
            
            return result
            
        except Exception as e:
            self._notify_progress({
                'type': 'benchmark_error',
                'worker_id': worker_id,
                'config_name': config.name,
                'error': str(e)
            })
            return None
            
        finally:
            self.resource_manager.deallocate(worker_id)
            
    def execute_parallel_batches(self, configs: List[BenchmarkConfig], 
                                batch_strategy: str = 'adaptive') -> List[BenchmarkResult]:
        """Execute benchmarks in optimized parallel batches"""
        all_results = []
        categories = self._categorize_benchmarks(configs)
        
        self._notify_progress({
            'type': 'execution_start',
            'total_configs': len(configs),
            'categories': {k: len(v) for k, v in categories.items()},
            'strategy': batch_strategy
        })
        
        if batch_strategy == 'adaptive':
            # Execute light configs in parallel first
            if categories['light']:
                self._notify_progress({'type': 'batch_start', 'category': 'light', 'count': len(categories['light'])})
                light_results = self._execute_batch_parallel(categories['light'], self.max_workers)
                all_results.extend(light_results)
                
            # Execute medium configs with reduced parallelism
            if categories['medium']:
                self._notify_progress({'type': 'batch_start', 'category': 'medium', 'count': len(categories['medium'])})
                medium_results = self._execute_batch_parallel(categories['medium'], max(2, self.max_workers // 2))
                all_results.extend(medium_results)
                
            # Execute heavy configs sequentially with some parallelism
            if categories['heavy']:
                self._notify_progress({'type': 'batch_start', 'category': 'heavy', 'count': len(categories['heavy'])})
                heavy_results = self._execute_batch_parallel(categories['heavy'], 2)
                all_results.extend(heavy_results)
                
            # Execute extreme configs sequentially
            if categories['extreme']:
                self._notify_progress({'type': 'batch_start', 'category': 'extreme', 'count': len(categories['extreme'])})
                extreme_results = self._execute_batch_sequential(categories['extreme'])
                all_results.extend(extreme_results)
                
        elif batch_strategy == 'parallel_only':
            # Execute all in parallel (may cause resource contention)
            all_results = self._execute_batch_parallel(configs, self.max_workers)
            
        elif batch_strategy == 'sequential_only':
            # Execute all sequentially (safe but slow)
            all_results = self._execute_batch_sequential(configs)
            
        self._notify_progress({
            'type': 'execution_complete',
            'total_results': len(all_results),
            'successful': len([r for r in all_results if r and r.success]),
            'failed': len([r for r in all_results if r and not r.success])
        })
        
        return all_results
        
    def _execute_batch_parallel(self, configs: List[BenchmarkConfig], 
                               max_workers: int) -> List[BenchmarkResult]:
        """Execute batch of configs in parallel"""
        results = []
        
        with ThreadPoolExecutor(max_workers=max_workers) as executor:
            # Submit all tasks
            future_to_config = {}
            for i, config in enumerate(configs):
                context = ExecutionContext(
                    worker_id=i,
                    process_id=os.getpid(),
                    thread_id=threading.get_ident(),
                    start_time=time.time(),
                    resource_limits={'max_workers': max_workers},
                    isolation_level='thread'
                )
                future = executor.submit(self._execute_single_benchmark, config, i, context)
                future_to_config[future] = config
                
            # Collect results as they complete
            for future in as_completed(future_to_config):
                config = future_to_config[future]
                try:
                    result = future.result()
                    if result:
                        results.append(result)
                        self.execution_stats['completed'] += 1
                    else:
                        self.execution_stats['failed'] += 1
                except Exception as e:
                    self._notify_progress({
                        'type': 'future_error',
                        'config_name': config.name,
                        'error': str(e)
                    })
                    self.execution_stats['failed'] += 1
                    
        return results
        
    def _execute_batch_sequential(self, configs: List[BenchmarkConfig]) -> List[BenchmarkResult]:
        """Execute batch of configs sequentially"""
        results = []
        
        for i, config in enumerate(configs):
            context = ExecutionContext(
                worker_id=0,
                process_id=os.getpid(),
                thread_id=threading.get_ident(),
                start_time=time.time(),
                resource_limits={'sequential': True},
                isolation_level='sequential'
            )
            
            result = self._execute_single_benchmark(config, 0, context)
            if result:
                results.append(result)
                self.execution_stats['completed'] += 1
            else:
                self.execution_stats['failed'] += 1
                
        return results
        
    def execute_with_process_isolation(self, configs: List[BenchmarkConfig]) -> List[BenchmarkResult]:
        """Execute benchmarks with process-level isolation"""
        results = []
        max_processes = min(cpu_count() // 2, 4)  # Conservative process count
        
        self._notify_progress({
            'type': 'process_execution_start',
            'max_processes': max_processes,
            'total_configs': len(configs)
        })
        
        with ProcessPoolExecutor(max_workers=max_processes) as executor:
            future_to_config = {
                executor.submit(self._execute_in_process, config, i): config
                for i, config in enumerate(configs)
            }
            
            for future in as_completed(future_to_config):
                config = future_to_config[future]
                try:
                    result = future.result(timeout=300)  # 5 minute timeout per process
                    if result:
                        results.append(result)
                        self.execution_stats['completed'] += 1
                except Exception as e:
                    self._notify_progress({
                        'type': 'process_error',
                        'config_name': config.name,
                        'error': str(e)
                    })
                    self.execution_stats['failed'] += 1
                    
        return results
        
    def _execute_in_process(self, config: BenchmarkConfig, worker_id: int) -> Optional[BenchmarkResult]:
        """Execute benchmark in isolated process"""
        try:
            runner = HiveMindBenchmarkRunner()
            result = runner.run_single_benchmark(config)
            
            if result:
                result.execution_context = {
                    'worker_id': worker_id,
                    'process_id': os.getpid(),
                    'isolation_level': 'process'
                }
                
            return result
        except Exception as e:
            return None
            
    def get_execution_statistics(self) -> Dict[str, Any]:
        """Get detailed execution statistics"""
        resource_usage = self.resource_manager.get_resource_usage()
        
        return {
            'execution_stats': self.execution_stats.copy(),
            'resource_usage': resource_usage,
            'max_workers': self.max_workers,
            'total_system_resources': {
                'total_memory_mb': self.resource_manager.total_memory_mb,
                'total_cpu_cores': self.resource_manager.total_cpu_cores
            }
        }

def main():
    """Demo parallel execution"""
    import argparse
    
    parser = argparse.ArgumentParser(description="Parallel Benchmark Executor")
    parser.add_argument('--configs', type=int, default=10, help='Number of test configs to generate')
    parser.add_argument('--workers', type=int, help='Max parallel workers')
    parser.add_argument('--strategy', choices=['adaptive', 'parallel_only', 'sequential_only'], 
                       default='adaptive', help='Execution strategy')
    parser.add_argument('--isolation', choices=['thread', 'process'], default='thread', 
                       help='Isolation level')
    
    args = parser.parse_args()
    
    # Generate test configurations
    configs = []
    for i in range(args.configs):
        config = BenchmarkConfig(
            name=f"parallel_test_{i}",
            topology="hierarchical",
            coordination="queen",
            memory_type="sqlite",
            agent_count=5 + (i % 20),
            task_complexity="simple",
            duration_seconds=10 + (i % 20)
        )
        configs.append(config)
        
    # Setup executor
    executor = ParallelBenchmarkExecutor(max_workers=args.workers)
    
    # Add progress callback
    def progress_callback(event):
        print(f"[{datetime.now().strftime('%H:%M:%S')}] {event['type']}: {event.get('config_name', '')}", flush=True)
        
    executor.add_progress_callback(progress_callback)
    
    # Execute benchmarks
    start_time = time.time()
    
    if args.isolation == 'process':
        results = executor.execute_with_process_isolation(configs)
    else:
        results = executor.execute_parallel_batches(configs, args.strategy)
        
    execution_time = time.time() - start_time
    
    # Print results
    print(f"\n✅ Execution completed in {execution_time:.2f} seconds")
    print(f"Total results: {len(results)}")
    print(f"Successful: {len([r for r in results if r and r.success])}")
    print(f"Failed: {len([r for r in results if r and not r.success])}")
    
    stats = executor.get_execution_statistics()
    print(f"\nExecution statistics: {stats}")
    
if __name__ == "__main__":
    main()