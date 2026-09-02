"""
ResourcePool for managing computational resources across parallel executions.

This module provides comprehensive resource management capabilities including
dynamic allocation, load balancing, resource monitoring, and automatic scaling
to optimize performance across concurrent benchmark operations.
"""

import asyncio
import time
import logging
import psutil
from datetime import datetime, timedelta
from typing import List, Dict, Any, Optional, Set, Callable, Union
from dataclasses import dataclass, field
from enum import Enum
import uuid
import weakref

from .models import BenchmarkTask


class ResourceType(Enum):
    """Types of computational resources."""
    CPU = "cpu"
    MEMORY = "memory"
    STORAGE = "storage"
    NETWORK = "network"
    GPU = "gpu"
    GENERIC = "generic"


class ResourceStatus(Enum):
    """Status of individual resources."""
    AVAILABLE = "available"
    ALLOCATED = "allocated"
    BUSY = "busy"
    MAINTENANCE = "maintenance"
    FAILED = "failed"


@dataclass
class ResourceConfig:
    """Configuration for resource pool management."""
    # Pool sizing
    initial_pool_size: int = 10
    max_pool_size: int = 50
    min_pool_size: int = 2
    
    # Scaling behavior
    auto_scaling: bool = True
    scale_up_threshold: float = 0.8  # Scale up when 80% utilized
    scale_down_threshold: float = 0.3  # Scale down when 30% utilized
    scale_up_increment: int = 2
    scale_down_increment: int = 1
    
    # Resource limits per allocation
    max_cpu_per_allocation: float = 2.0  # CPU cores
    max_memory_per_allocation: int = 2048  # MB
    max_storage_per_allocation: int = 1024  # MB
    
    # System limits
    max_total_cpu_usage: float = 80.0  # Percentage
    max_total_memory_usage: float = 80.0  # Percentage
    max_concurrent_allocations: int = 100
    
    # Monitoring and cleanup
    health_check_interval: int = 30  # seconds
    cleanup_interval: int = 300  # 5 minutes
    allocation_timeout: int = 3600  # 1 hour
    
    # Performance optimization
    load_balancing: bool = True
    resource_prediction: bool = True
    priority_queuing: bool = True


@dataclass
class ResourceSpec:
    """Specification for resource requirements."""
    cpu_cores: float = 1.0
    memory_mb: int = 512
    storage_mb: int = 256
    network_bandwidth: Optional[int] = None  # MB/s
    gpu_memory: Optional[int] = None  # MB
    priority: int = 5  # 1-10, higher is more priority
    duration_estimate: Optional[int] = None  # seconds
    resource_type: ResourceType = ResourceType.GENERIC


@dataclass
class Resource:
    """Individual computational resource."""
    resource_id: str
    resource_type: ResourceType
    status: ResourceStatus = ResourceStatus.AVAILABLE
    
    # Resource capabilities
    cpu_cores: float = 1.0
    memory_mb: int = 512
    storage_mb: int = 256
    network_bandwidth: int = 100  # MB/s
    
    # Current allocation
    allocated_cpu: float = 0.0
    allocated_memory: int = 0
    allocated_storage: int = 0
    allocation_count: int = 0
    
    # Tracking
    created_at: datetime = field(default_factory=datetime.now)
    last_used: Optional[datetime] = None
    total_allocations: int = 0
    total_usage_time: float = 0.0
    
    # Health and performance
    health_score: float = 1.0  # 0-1, higher is better
    performance_score: float = 1.0  # 0-1, higher is better
    error_count: int = 0
    
    def can_accommodate(self, spec: ResourceSpec) -> bool:
        """Check if resource can accommodate the specification."""
        return (
            self.status == ResourceStatus.AVAILABLE and
            self.cpu_cores - self.allocated_cpu >= spec.cpu_cores and
            self.memory_mb - self.allocated_memory >= spec.memory_mb and
            self.storage_mb - self.allocated_storage >= spec.storage_mb
        )
    
    def allocate(self, spec: ResourceSpec) -> 'ResourceAllocation':
        """Allocate resources according to specification."""
        if not self.can_accommodate(spec):
            raise ValueError("Resource cannot accommodate specification")
        
        allocation_id = f"alloc_{uuid.uuid4().hex[:8]}"
        
        # Update resource state
        self.allocated_cpu += spec.cpu_cores
        self.allocated_memory += spec.memory_mb
        self.allocated_storage += spec.storage_mb
        self.allocation_count += 1
        self.total_allocations += 1
        self.last_used = datetime.now()
        
        if self.allocated_cpu >= self.cpu_cores or self.allocated_memory >= self.memory_mb:
            self.status = ResourceStatus.BUSY
        else:
            self.status = ResourceStatus.ALLOCATED
        
        allocation = ResourceAllocation(
            allocation_id=allocation_id,
            resource_id=self.resource_id,
            spec=spec,
            allocated_at=datetime.now()
        )
        
        return allocation
    
    def deallocate(self, allocation: 'ResourceAllocation'):
        """Deallocate resources from an allocation."""
        self.allocated_cpu -= allocation.spec.cpu_cores
        self.allocated_memory -= allocation.spec.memory_mb
        self.allocated_storage -= allocation.spec.storage_mb
        self.allocation_count -= 1
        
        # Ensure no negative values
        self.allocated_cpu = max(0, self.allocated_cpu)
        self.allocated_memory = max(0, self.allocated_memory)
        self.allocated_storage = max(0, self.allocated_storage)
        self.allocation_count = max(0, self.allocation_count)
        
        # Update status
        if self.allocation_count == 0:
            self.status = ResourceStatus.AVAILABLE
        elif self.allocated_cpu < self.cpu_cores and self.allocated_memory < self.memory_mb:
            self.status = ResourceStatus.ALLOCATED
        
        # Update usage statistics
        if allocation.allocated_at:
            usage_time = (datetime.now() - allocation.allocated_at).total_seconds()
            self.total_usage_time += usage_time
    
    @property
    def utilization(self) -> Dict[str, float]:
        """Get current resource utilization."""
        return {
            "cpu": self.allocated_cpu / self.cpu_cores if self.cpu_cores > 0 else 0,
            "memory": self.allocated_memory / self.memory_mb if self.memory_mb > 0 else 0,
            "storage": self.allocated_storage / self.storage_mb if self.storage_mb > 0 else 0
        }
    
    @property
    def efficiency_score(self) -> float:
        """Calculate resource efficiency score."""
        if self.total_allocations == 0:
            return 1.0
        
        uptime = (datetime.now() - self.created_at).total_seconds()
        utilization_ratio = self.total_usage_time / uptime if uptime > 0 else 0
        error_ratio = self.error_count / self.total_allocations
        
        return max(0, min(1.0, utilization_ratio * 0.7 + (1 - error_ratio) * 0.3))


@dataclass
class ResourceAllocation:
    """Represents an active resource allocation."""
    allocation_id: str
    resource_id: str
    spec: ResourceSpec
    allocated_at: datetime
    released_at: Optional[datetime] = None
    
    # Task tracking
    task_id: Optional[str] = None
    owner: Optional[str] = None
    
    # Usage tracking
    cpu_usage_history: List[float] = field(default_factory=list)
    memory_usage_history: List[int] = field(default_factory=list)
    
    @property
    def duration(self) -> float:
        """Get allocation duration in seconds."""
        end_time = self.released_at or datetime.now()
        return (end_time - self.allocated_at).total_seconds()
    
    @property
    def is_expired(self) -> bool:
        """Check if allocation has expired."""
        if self.spec.duration_estimate:
            return self.duration > self.spec.duration_estimate * 1.5  # 50% buffer
        return False


class LoadBalancer:
    """Load balancer for optimal resource allocation."""
    
    def __init__(self, config: ResourceConfig):
        self.config = config
        
    def select_best_resource(self, 
                            resources: List[Resource],
                            spec: ResourceSpec) -> Optional[Resource]:
        """Select the best resource for given specification."""
        # Filter available resources that can accommodate the spec
        candidates = [r for r in resources if r.can_accommodate(spec)]
        
        if not candidates:
            return None
        
        if not self.config.load_balancing:
            return candidates[0]  # First available
        
        # Score resources based on multiple criteria
        scored_candidates = []
        for resource in candidates:
            score = self._calculate_resource_score(resource, spec)
            scored_candidates.append((resource, score))
        
        # Sort by score (higher is better)
        scored_candidates.sort(key=lambda x: x[1], reverse=True)
        
        return scored_candidates[0][0]
    
    def _calculate_resource_score(self, resource: Resource, spec: ResourceSpec) -> float:
        """Calculate a score for resource allocation."""
        # Base score from resource health and performance
        base_score = (resource.health_score + resource.performance_score) / 2
        
        # Utilization factor (prefer less utilized resources)
        utilization = resource.utilization
        avg_utilization = sum(utilization.values()) / len(utilization)
        utilization_factor = 1.0 - avg_utilization
        
        # Efficiency factor
        efficiency_factor = resource.efficiency_score
        
        # Size matching factor (prefer resources that closely match requirements)
        cpu_ratio = spec.cpu_cores / resource.cpu_cores
        memory_ratio = spec.memory_mb / resource.memory_mb
        size_matching = 1.0 - abs(0.5 - (cpu_ratio + memory_ratio) / 2)
        
        # Priority factor
        priority_factor = min(spec.priority / 10.0, 1.0)
        
        # Combine factors
        score = (
            base_score * 0.3 +
            utilization_factor * 0.25 +
            efficiency_factor * 0.2 +
            size_matching * 0.15 +
            priority_factor * 0.1
        )
        
        return score


class ResourceMonitor:
    """Monitor resource health and performance."""
    
    def __init__(self, config: ResourceConfig):
        self.config = config
        self.logger = logging.getLogger(self.__class__.__name__)
        
    async def monitor_resources(self, pool: 'ResourcePool'):
        """Monitor resources continuously."""
        while pool.is_active:
            try:
                await self._health_check(pool)
                await self._performance_check(pool)
                await self._cleanup_expired(pool)
                
                await asyncio.sleep(self.config.health_check_interval)
                
            except Exception as e:
                self.logger.error(f"Resource monitoring error: {e}")
                await asyncio.sleep(self.config.health_check_interval)
    
    async def _health_check(self, pool: 'ResourcePool'):
        """Perform health checks on all resources."""
        unhealthy_resources = []
        
        for resource in pool.resources.values():
            health_score = await self._check_resource_health(resource)
            resource.health_score = health_score
            
            if health_score < 0.5:  # Health threshold
                unhealthy_resources.append(resource)
        
        # Handle unhealthy resources
        for resource in unhealthy_resources:
            await pool._handle_unhealthy_resource(resource)
    
    async def _check_resource_health(self, resource: Resource) -> float:
        """Check individual resource health."""
        try:
            # Check system resources
            cpu_percent = psutil.cpu_percent(interval=0.1)
            memory = psutil.virtual_memory()
            
            # Calculate health based on system metrics
            cpu_health = 1.0 - min(cpu_percent / 100.0, 1.0)
            memory_health = 1.0 - min(memory.percent / 100.0, 1.0)
            
            # Factor in error rate
            error_rate = resource.error_count / max(resource.total_allocations, 1)
            error_health = max(0, 1.0 - error_rate)
            
            # Combine health metrics
            health_score = (cpu_health * 0.4 + memory_health * 0.4 + error_health * 0.2)
            
            return max(0, min(1.0, health_score))
            
        except Exception as e:
            self.logger.warning(f"Health check failed for resource {resource.resource_id}: {e}")
            return 0.5  # Default moderate health
    
    async def _performance_check(self, pool: 'ResourcePool'):
        """Check resource performance metrics."""
        for resource in pool.resources.values():
            # Update performance score based on recent usage
            performance_score = resource.efficiency_score
            resource.performance_score = performance_score
    
    async def _cleanup_expired(self, pool: 'ResourcePool'):
        """Clean up expired allocations."""
        current_time = datetime.now()
        expired_allocations = []
        
        for allocation in pool.active_allocations.values():
            # Check for timeout
            if (current_time - allocation.allocated_at).total_seconds() > self.config.allocation_timeout:
                expired_allocations.append(allocation)
                continue
                
            # Check for estimated duration expiry
            if allocation.is_expired:
                expired_allocations.append(allocation)
        
        # Release expired allocations
        for allocation in expired_allocations:
            self.logger.warning(f"Releasing expired allocation: {allocation.allocation_id}")
            await pool.release_resource(allocation.allocation_id)


class ResourcePool:
    """
    Manage computational resources for parallel execution.
    
    Provides:
    - Dynamic resource allocation and deallocation
    - Load balancing across available resources
    - Automatic scaling based on demand
    - Resource health monitoring
    - Performance optimization
    """
    
    def __init__(self, config: ResourceConfig):
        self.config = config
        self.logger = logging.getLogger(self.__class__.__name__)
        
        # Resource management
        self.resources: Dict[str, Resource] = {}
        self.active_allocations: Dict[str, ResourceAllocation] = {}
        self.allocation_queue: asyncio.Queue = asyncio.Queue()
        
        # Components
        self.load_balancer = LoadBalancer(config)
        self.monitor = ResourceMonitor(config)
        
        # State tracking
        self.is_active = False
        self.scaling_lock = asyncio.Lock()
        
        # Performance metrics
        self.metrics = {
            "total_allocations": 0,
            "successful_allocations": 0,
            "failed_allocations": 0,
            "average_allocation_time": 0.0,
            "current_utilization": 0.0,
            "peak_utilization": 0.0
        }
        
    async def __aenter__(self):
        """Async context manager entry."""
        await self.initialize()
        return self
        
    async def __aexit__(self, exc_type, exc_val, exc_tb):
        """Async context manager exit."""
        await self.shutdown()
    
    async def initialize(self):
        """Initialize the resource pool."""
        self.is_active = True
        
        # Create initial resources
        for i in range(self.config.initial_pool_size):
            await self._create_resource()
        
        # Start monitoring
        asyncio.create_task(self.monitor.monitor_resources(self))
        asyncio.create_task(self._auto_scaler())
        
        self.logger.info(f"Resource pool initialized with {len(self.resources)} resources")
    
    async def shutdown(self):
        """Shutdown the resource pool."""
        self.is_active = False
        
        # Release all active allocations
        for allocation_id in list(self.active_allocations.keys()):
            await self.release_resource(allocation_id)
        
        self.logger.info("Resource pool shutdown complete")
    
    async def allocate_resource(self, 
                               spec: ResourceSpec,
                               task_id: Optional[str] = None,
                               owner: Optional[str] = None) -> ResourceAllocation:
        """
        Allocate a resource according to specification.
        
        Args:
            spec: Resource requirements specification
            task_id: Optional task identifier
            owner: Optional owner identifier
            
        Returns:
            ResourceAllocation object
            
        Raises:
            RuntimeError: If no suitable resource is available
        """
        allocation_start = time.time()
        
        try:
            # Check system limits
            if len(self.active_allocations) >= self.config.max_concurrent_allocations:
                raise RuntimeError("Maximum concurrent allocations reached")
            
            # Find best available resource
            resource = self.load_balancer.select_best_resource(
                list(self.resources.values()), 
                spec
            )
            
            if not resource:
                # Try to scale up if auto-scaling is enabled
                if self.config.auto_scaling:
                    await self._try_scale_up()
                    # Try again after scaling
                    resource = self.load_balancer.select_best_resource(
                        list(self.resources.values()), 
                        spec
                    )
                
                if not resource:
                    self.metrics["failed_allocations"] += 1
                    raise RuntimeError("No suitable resource available")
            
            # Allocate the resource
            allocation = resource.allocate(spec)
            allocation.task_id = task_id
            allocation.owner = owner
            
            # Track allocation
            self.active_allocations[allocation.allocation_id] = allocation
            
            # Update metrics
            allocation_time = time.time() - allocation_start
            self.metrics["total_allocations"] += 1
            self.metrics["successful_allocations"] += 1
            self._update_average_allocation_time(allocation_time)
            self._update_utilization_metrics()
            
            self.logger.debug(f"Allocated resource {resource.resource_id} for spec {spec}")
            
            return allocation
            
        except Exception as e:
            self.metrics["failed_allocations"] += 1
            self.logger.error(f"Resource allocation failed: {e}")
            raise
    
    async def release_resource(self, allocation_id: str) -> bool:
        """
        Release a resource allocation.
        
        Args:
            allocation_id: The allocation identifier
            
        Returns:
            True if successfully released
        """
        if allocation_id not in self.active_allocations:
            self.logger.warning(f"Allocation not found: {allocation_id}")
            return False
        
        allocation = self.active_allocations[allocation_id]
        
        # Find the resource and deallocate
        if allocation.resource_id in self.resources:
            resource = self.resources[allocation.resource_id]
            resource.deallocate(allocation)
            
            # Mark allocation as released
            allocation.released_at = datetime.now()
            
            # Remove from active allocations
            del self.active_allocations[allocation_id]
            
            # Update metrics
            self._update_utilization_metrics()
            
            self.logger.debug(f"Released allocation {allocation_id} from resource {allocation.resource_id}")
            
            # Check if we should scale down
            if self.config.auto_scaling:
                await self._try_scale_down()
            
            return True
        else:
            self.logger.error(f"Resource not found for allocation: {allocation.resource_id}")
            return False
    
    async def get_resource_allocation(self, allocation_id: str) -> Optional[ResourceAllocation]:
        """Get details of a resource allocation."""
        return self.active_allocations.get(allocation_id)
    
    async def get_available_resources(self, spec: Optional[ResourceSpec] = None) -> List[Resource]:
        """Get list of available resources, optionally filtered by spec."""
        if spec:
            return [r for r in self.resources.values() if r.can_accommodate(spec)]
        else:
            return [r for r in self.resources.values() if r.status == ResourceStatus.AVAILABLE]
    
    async def get_pool_status(self) -> Dict[str, Any]:
        """Get comprehensive pool status."""
        total_resources = len(self.resources)
        available_resources = len([r for r in self.resources.values() 
                                  if r.status == ResourceStatus.AVAILABLE])
        allocated_resources = len([r for r in self.resources.values() 
                                  if r.status in [ResourceStatus.ALLOCATED, ResourceStatus.BUSY]])
        
        # Calculate resource utilization
        total_cpu = sum(r.cpu_cores for r in self.resources.values())
        allocated_cpu = sum(r.allocated_cpu for r in self.resources.values())
        cpu_utilization = allocated_cpu / total_cpu if total_cpu > 0 else 0
        
        total_memory = sum(r.memory_mb for r in self.resources.values())
        allocated_memory = sum(r.allocated_memory for r in self.resources.values())
        memory_utilization = allocated_memory / total_memory if total_memory > 0 else 0
        
        return {
            "total_resources": total_resources,
            "available_resources": available_resources,
            "allocated_resources": allocated_resources,
            "active_allocations": len(self.active_allocations),
            "cpu_utilization": cpu_utilization,
            "memory_utilization": memory_utilization,
            "average_utilization": (cpu_utilization + memory_utilization) / 2,
            "metrics": self.metrics.copy(),
            "health_score": self._calculate_pool_health()
        }
    
    async def _create_resource(self, resource_type: ResourceType = ResourceType.GENERIC) -> Resource:
        """Create a new resource."""
        resource_id = f"resource_{resource_type.value}_{uuid.uuid4().hex[:8]}"
        
        # Determine resource capabilities based on system
        try:
            cpu_count = psutil.cpu_count(logical=False) or 2
            memory_info = psutil.virtual_memory()
            available_memory = memory_info.available // (1024 * 1024)  # MB
            
            # Limit per resource to avoid over-allocation
            cpu_cores = min(2.0, cpu_count / max(len(self.resources), 1))
            memory_mb = min(2048, available_memory // max(len(self.resources) + 1, 1))
        except:
            # Fallback values
            cpu_cores = 1.0
            memory_mb = 512
        
        resource = Resource(
            resource_id=resource_id,
            resource_type=resource_type,
            cpu_cores=cpu_cores,
            memory_mb=memory_mb,
            storage_mb=1024
        )
        
        self.resources[resource_id] = resource
        self.logger.debug(f"Created resource: {resource_id}")
        
        return resource
    
    async def _auto_scaler(self):
        """Automatic scaling based on utilization."""
        while self.is_active:
            try:
                if self.config.auto_scaling:
                    await self._check_scaling()
                
                await asyncio.sleep(30)  # Check every 30 seconds
                
            except Exception as e:
                self.logger.error(f"Auto-scaler error: {e}")
                await asyncio.sleep(30)
    
    async def _check_scaling(self):
        """Check if scaling is needed."""
        status = await self.get_pool_status()
        avg_utilization = status["average_utilization"]
        
        async with self.scaling_lock:
            if avg_utilization > self.config.scale_up_threshold:
                await self._try_scale_up()
            elif avg_utilization < self.config.scale_down_threshold:
                await self._try_scale_down()
    
    async def _try_scale_up(self):
        """Attempt to scale up the resource pool."""
        if len(self.resources) >= self.config.max_pool_size:
            return
        
        scale_count = min(
            self.config.scale_up_increment,
            self.config.max_pool_size - len(self.resources)
        )
        
        for _ in range(scale_count):
            await self._create_resource()
        
        self.logger.info(f"Scaled up by {scale_count} resources, total: {len(self.resources)}")
    
    async def _try_scale_down(self):
        """Attempt to scale down the resource pool."""
        if len(self.resources) <= self.config.min_pool_size:
            return
        
        # Find underutilized resources that can be removed
        candidates = [
            r for r in self.resources.values()
            if r.status == ResourceStatus.AVAILABLE and
            r.allocation_count == 0
        ]
        
        remove_count = min(
            self.config.scale_down_increment,
            len(candidates),
            len(self.resources) - self.config.min_pool_size
        )
        
        for resource in candidates[:remove_count]:
            del self.resources[resource.resource_id]
        
        if remove_count > 0:
            self.logger.info(f"Scaled down by {remove_count} resources, total: {len(self.resources)}")
    
    async def _handle_unhealthy_resource(self, resource: Resource):
        """Handle an unhealthy resource."""
        if resource.allocation_count == 0:
            # Remove resource if no active allocations
            if resource.resource_id in self.resources:
                del self.resources[resource.resource_id]
                self.logger.warning(f"Removed unhealthy resource: {resource.resource_id}")
        else:
            # Mark for maintenance but keep active allocations
            resource.status = ResourceStatus.MAINTENANCE
            self.logger.warning(f"Marked resource for maintenance: {resource.resource_id}")
    
    def _update_average_allocation_time(self, allocation_time: float):
        """Update running average of allocation time."""
        current_avg = self.metrics["average_allocation_time"]
        total_allocations = self.metrics["total_allocations"]
        
        if total_allocations == 1:
            self.metrics["average_allocation_time"] = allocation_time
        else:
            # Running average calculation
            self.metrics["average_allocation_time"] = (
                (current_avg * (total_allocations - 1) + allocation_time) / total_allocations
            )
    
    def _update_utilization_metrics(self):
        """Update utilization metrics."""
        if not self.resources:
            return
        
        utilizations = [sum(r.utilization.values()) / len(r.utilization) for r in self.resources.values()]
        current_utilization = sum(utilizations) / len(utilizations)
        
        self.metrics["current_utilization"] = current_utilization
        self.metrics["peak_utilization"] = max(
            self.metrics["peak_utilization"], 
            current_utilization
        )
    
    def _calculate_pool_health(self) -> float:
        """Calculate overall pool health score."""
        if not self.resources:
            return 0.0
        
        health_scores = [r.health_score for r in self.resources.values()]
        return sum(health_scores) / len(health_scores)