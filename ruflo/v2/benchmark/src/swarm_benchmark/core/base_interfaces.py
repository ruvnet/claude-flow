"""
Base Interfaces and Abstractions for Benchmark System.

This module defines the core interfaces, abstract base classes, and protocols
that all benchmark system components must implement for consistency and extensibility.
"""

from abc import ABC, abstractmethod
from typing import Any, Dict, List, Optional, Protocol, Union, AsyncGenerator
from dataclasses import dataclass
from datetime import datetime
from enum import Enum
import asyncio


class BenchmarkStatus(Enum):
    """Enumeration of benchmark execution statuses."""
    PENDING = "pending"
    RUNNING = "running"
    COMPLETED = "completed"
    FAILED = "failed"
    CANCELLED = "cancelled"


class MetricType(Enum):
    """Types of metrics that can be collected."""
    PERFORMANCE = "performance"
    RESOURCE = "resource"
    TOKEN = "token"
    MEMORY = "memory"
    NEURAL = "neural"
    COLLECTIVE = "collective"


@dataclass
class BenchmarkContext:
    """Context information for benchmark execution."""
    benchmark_id: str
    start_time: datetime
    config: Dict[str, Any]
    environment: Dict[str, str]
    metadata: Dict[str, Any]


@dataclass
class ExecutionResult:
    """Result of a benchmark execution."""
    benchmark_id: str
    status: BenchmarkStatus
    start_time: datetime
    end_time: Optional[datetime]
    duration_ms: Optional[float]
    metrics: Dict[str, Any]
    outputs: Dict[str, Any]
    errors: List[str]
    metadata: Dict[str, Any]


class BenchmarkInterface(Protocol):
    """Protocol defining the interface that all benchmark components must implement."""
    
    async def execute(self, context: BenchmarkContext) -> ExecutionResult:
        """Execute the benchmark with given context."""
        ...
    
    async def validate_config(self, config: Dict[str, Any]) -> bool:
        """Validate configuration for this benchmark."""
        ...
    
    def get_required_resources(self) -> Dict[str, Any]:
        """Get resource requirements for this benchmark."""
        ...


class MetricsCollectorInterface(Protocol):
    """Protocol for metrics collection components."""
    
    async def start_collection(self, context: BenchmarkContext) -> None:
        """Start metrics collection."""
        ...
    
    async def stop_collection(self) -> Dict[str, Any]:
        """Stop collection and return metrics."""
        ...
    
    async def get_metrics(self) -> Dict[str, Any]:
        """Get current metrics snapshot."""
        ...


class ConfigurableComponent(ABC):
    """Base class for all configurable components."""
    
    def __init__(self, config: Optional[Dict[str, Any]] = None):
        self.config = config or {}
        self._validate_config()
    
    @abstractmethod
    def _validate_config(self) -> None:
        """Validate the component configuration."""
        pass
    
    def get_config_value(self, key: str, default: Any = None) -> Any:
        """Get a configuration value with optional default."""
        return self.config.get(key, default)
    
    def update_config(self, updates: Dict[str, Any]) -> None:
        """Update configuration and re-validate."""
        self.config.update(updates)
        self._validate_config()


class AsyncBenchmarkBase(ConfigurableComponent):
    """Base class for asynchronous benchmark implementations."""
    
    def __init__(self, config: Optional[Dict[str, Any]] = None):
        super().__init__(config)
        self.status = BenchmarkStatus.PENDING
        self._execution_lock = asyncio.Lock()
    
    async def execute(self, context: BenchmarkContext) -> ExecutionResult:
        """Execute the benchmark with proper state management."""
        async with self._execution_lock:
            if self.status == BenchmarkStatus.RUNNING:
                raise ValueError("Benchmark is already running")
            
            self.status = BenchmarkStatus.RUNNING
            start_time = datetime.now()
            
            try:
                result = await self._execute_impl(context)
                result.status = BenchmarkStatus.COMPLETED
                self.status = BenchmarkStatus.COMPLETED
                return result
                
            except Exception as e:
                self.status = BenchmarkStatus.FAILED
                return ExecutionResult(
                    benchmark_id=context.benchmark_id,
                    status=BenchmarkStatus.FAILED,
                    start_time=start_time,
                    end_time=datetime.now(),
                    duration_ms=(datetime.now() - start_time).total_seconds() * 1000,
                    metrics={},
                    outputs={},
                    errors=[str(e)],
                    metadata={}
                )
    
    @abstractmethod
    async def _execute_impl(self, context: BenchmarkContext) -> ExecutionResult:
        """Implement the actual benchmark execution logic."""
        pass
    
    @abstractmethod
    async def validate_config(self, config: Dict[str, Any]) -> bool:
        """Validate benchmark-specific configuration."""
        pass
    
    @abstractmethod
    def get_required_resources(self) -> Dict[str, Any]:
        """Get resource requirements for this benchmark."""
        pass


class StreamingBenchmark(AsyncBenchmarkBase):
    """Base class for streaming benchmarks that produce results over time."""
    
    @abstractmethod
    async def execute_streaming(self, context: BenchmarkContext) -> AsyncGenerator[ExecutionResult, None]:
        """Execute benchmark and yield intermediate results."""
        pass


class EnsembleBenchmark(AsyncBenchmarkBase):
    """Base class for ensemble benchmarks that coordinate multiple components."""
    
    def __init__(self, config: Optional[Dict[str, Any]] = None):
        super().__init__(config)
        self.components: List[BenchmarkInterface] = []
    
    def add_component(self, component: BenchmarkInterface) -> None:
        """Add a component to the ensemble."""
        self.components.append(component)
    
    def remove_component(self, component: BenchmarkInterface) -> None:
        """Remove a component from the ensemble."""
        if component in self.components:
            self.components.remove(component)
    
    async def execute_parallel(self, context: BenchmarkContext) -> List[ExecutionResult]:
        """Execute all components in parallel."""
        tasks = [component.execute(context) for component in self.components]
        return await asyncio.gather(*tasks, return_exceptions=True)
    
    async def execute_sequential(self, context: BenchmarkContext) -> List[ExecutionResult]:
        """Execute components sequentially."""
        results = []
        for component in self.components:
            result = await component.execute(context)
            results.append(result)
        return results


class MetricsCollectorBase(ConfigurableComponent):
    """Base class for metrics collectors."""
    
    def __init__(self, config: Optional[Dict[str, Any]] = None):
        super().__init__(config)
        self.is_collecting = False
        self._metrics: Dict[str, Any] = {}
        self._collection_lock = asyncio.Lock()
    
    async def start_collection(self, context: BenchmarkContext) -> None:
        """Start metrics collection with thread safety."""
        async with self._collection_lock:
            if self.is_collecting:
                return
            
            self.is_collecting = True
            self._metrics = {}
            await self._start_collection_impl(context)
    
    async def stop_collection(self) -> Dict[str, Any]:
        """Stop collection and return final metrics."""
        async with self._collection_lock:
            if not self.is_collecting:
                return self._metrics
            
            self.is_collecting = False
            final_metrics = await self._stop_collection_impl()
            self._metrics.update(final_metrics)
            return self._metrics
    
    async def get_metrics(self) -> Dict[str, Any]:
        """Get current metrics snapshot."""
        if self.is_collecting:
            current_metrics = await self._get_current_metrics()
            self._metrics.update(current_metrics)
        return self._metrics.copy()
    
    @abstractmethod
    async def _start_collection_impl(self, context: BenchmarkContext) -> None:
        """Implement metrics collection startup logic."""
        pass
    
    @abstractmethod
    async def _stop_collection_impl(self) -> Dict[str, Any]:
        """Implement metrics collection shutdown logic."""
        pass
    
    @abstractmethod
    async def _get_current_metrics(self) -> Dict[str, Any]:
        """Get current metrics implementation."""
        pass


class OptimizationEngine(ConfigurableComponent):
    """Base class for optimization engines."""
    
    @abstractmethod
    async def optimize(self, target: Any, constraints: Dict[str, Any]) -> Any:
        """Optimize target subject to constraints."""
        pass
    
    @abstractmethod
    async def evaluate_fitness(self, candidate: Any) -> float:
        """Evaluate fitness score for a candidate solution."""
        pass
    
    @abstractmethod
    def generate_candidate(self, base: Any) -> Any:
        """Generate a new candidate solution."""
        pass


class ConsensusProtocol(Protocol):
    """Protocol for consensus mechanisms."""
    
    async def propose(self, value: Any) -> str:
        """Propose a value for consensus."""
        ...
    
    async def vote(self, proposal_id: str, vote: bool) -> None:
        """Vote on a proposal."""
        ...
    
    async def get_result(self, proposal_id: str) -> Optional[Any]:
        """Get consensus result if available."""
        ...


class ResourceManager(ConfigurableComponent):
    """Base class for resource management."""
    
    def __init__(self, config: Optional[Dict[str, Any]] = None):
        super().__init__(config)
        self._allocated_resources: Dict[str, Any] = {}
        self._resource_lock = asyncio.Lock()
    
    async def allocate_resource(self, resource_type: str, amount: int) -> str:
        """Allocate a resource and return resource ID."""
        async with self._resource_lock:
            resource_id = await self._allocate_impl(resource_type, amount)
            self._allocated_resources[resource_id] = {
                "type": resource_type,
                "amount": amount,
                "allocated_at": datetime.now()
            }
            return resource_id
    
    async def deallocate_resource(self, resource_id: str) -> None:
        """Deallocate a resource."""
        async with self._resource_lock:
            if resource_id in self._allocated_resources:
                await self._deallocate_impl(resource_id)
                del self._allocated_resources[resource_id]
    
    async def get_resource_usage(self) -> Dict[str, Any]:
        """Get current resource usage statistics."""
        return {
            "allocated_count": len(self._allocated_resources),
            "resources": self._allocated_resources.copy(),
            "usage_by_type": self._calculate_usage_by_type()
        }
    
    @abstractmethod
    async def _allocate_impl(self, resource_type: str, amount: int) -> str:
        """Implement resource allocation logic."""
        pass
    
    @abstractmethod
    async def _deallocate_impl(self, resource_id: str) -> None:
        """Implement resource deallocation logic."""
        pass
    
    def _calculate_usage_by_type(self) -> Dict[str, int]:
        """Calculate resource usage by type."""
        usage = {}
        for resource_info in self._allocated_resources.values():
            resource_type = resource_info["type"]
            amount = resource_info["amount"]
            usage[resource_type] = usage.get(resource_type, 0) + amount
        return usage


# Type aliases for common patterns
BenchmarkResult = ExecutionResult
ConfigDict = Dict[str, Any]
MetricsDict = Dict[str, Any]
ResourceDict = Dict[str, Any]