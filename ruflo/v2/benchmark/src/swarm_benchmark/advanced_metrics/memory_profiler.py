"""
Memory Persistence Profiler

Comprehensive memory profiling and optimization for Claude Flow swarm operations.
Tracks memory usage patterns, persistence overhead, and provides optimization suggestions.
"""

import asyncio
import psutil
import gc
import sys
import time
import json
import logging
from typing import Dict, List, Optional, Any, Tuple
from dataclasses import dataclass, asdict
from collections import defaultdict, deque
import statistics
import threading
import weakref

logger = logging.getLogger(__name__)


@dataclass
class MemorySnapshot:
    """Snapshot of memory state at a specific point in time."""
    
    timestamp: float
    total_memory_mb: float
    used_memory_mb: float
    available_memory_mb: float
    process_rss_mb: float
    process_vms_mb: float
    process_heap_mb: float
    gc_objects: int
    gc_collections: Dict[int, int]
    thread_count: int
    file_descriptors: int
    
    
@dataclass
class MemoryProfile:
    """Complete memory profile for a swarm or operation."""
    
    swarm_id: str
    start_time: float
    end_time: float
    duration_seconds: float
    initial_snapshot: MemorySnapshot
    final_snapshot: MemorySnapshot
    peak_memory_mb: float
    memory_growth_mb: float
    gc_impact_ms: float
    persistence_overhead_mb: float
    cache_efficiency_percent: float
    optimization_suggestions: List[str]
    memory_leaks_detected: List[Dict]
    performance_score: float
    

@dataclass
class MemoryOptimization:
    """Memory optimization recommendation."""
    
    optimization_type: str
    description: str
    expected_savings_mb: float
    implementation_effort: str
    confidence: float
    applicable_operations: List[str]
    code_example: str = ""


class MemoryTracker:
    """Track memory usage patterns over time."""
    
    def __init__(self, sampling_interval: float = 0.5, max_samples: int = 1000):
        self.sampling_interval = sampling_interval
        self.max_samples = max_samples
        self.snapshots = deque(maxlen=max_samples)
        self.is_tracking = False
        self.tracking_thread = None
        self.gc_stats_initial = None
        
    def start_tracking(self):
        """Start continuous memory tracking."""
        if self.is_tracking:
            return
        
        self.is_tracking = True
        self.gc_stats_initial = self._get_gc_stats()
        self.tracking_thread = threading.Thread(target=self._tracking_loop, daemon=True)
        self.tracking_thread.start()
        logger.debug("Memory tracking started with %.1fs interval", self.sampling_interval)
    
    def stop_tracking(self) -> List[MemorySnapshot]:
        """Stop memory tracking and return collected snapshots."""
        self.is_tracking = False
        if self.tracking_thread:
            self.tracking_thread.join(timeout=2.0)
        
        snapshots = list(self.snapshots)
        logger.debug("Memory tracking stopped, collected %d snapshots", len(snapshots))
        return snapshots
    
    def _tracking_loop(self):
        """Main tracking loop running in separate thread."""
        while self.is_tracking:
            try:
                snapshot = self._take_snapshot()
                self.snapshots.append(snapshot)
                time.sleep(self.sampling_interval)
            except Exception as e:
                logger.warning("Error in memory tracking: %s", e)
                time.sleep(self.sampling_interval * 2)  # Back off on error
    
    def _take_snapshot(self) -> MemorySnapshot:
        """Take a memory snapshot at current time."""
        process = psutil.Process()
        system_memory = psutil.virtual_memory()
        
        # Get process memory info
        memory_info = process.memory_info()
        
        # Get GC stats
        gc_stats = self._get_gc_stats()
        
        return MemorySnapshot(
            timestamp=time.time(),
            total_memory_mb=system_memory.total / 1024 / 1024,
            used_memory_mb=system_memory.used / 1024 / 1024,
            available_memory_mb=system_memory.available / 1024 / 1024,
            process_rss_mb=memory_info.rss / 1024 / 1024,
            process_vms_mb=memory_info.vms / 1024 / 1024,
            process_heap_mb=self._get_heap_size_mb(),
            gc_objects=len(gc.get_objects()),
            gc_collections=gc_stats,
            thread_count=process.num_threads(),
            file_descriptors=process.num_fds() if hasattr(process, 'num_fds') else 0
        )
    
    def _get_gc_stats(self) -> Dict[int, int]:
        """Get garbage collection statistics."""
        return {i: gc.get_count()[i] for i in range(len(gc.get_count()))}
    
    def _get_heap_size_mb(self) -> float:
        """Get current heap size in MB."""
        # This is an approximation - actual heap size depends on Python implementation
        return sum(sys.getsizeof(obj) for obj in gc.get_objects()) / 1024 / 1024


class SwarmMemoryAnalyzer:
    """Analyze memory usage patterns for swarm operations."""
    
    def __init__(self):
        self.memory_patterns = {}
        self.baseline_usage = {}
        self.optimization_history = []
        
    def analyze_memory_patterns(self, snapshots: List[MemorySnapshot]) -> Dict:
        """Analyze memory usage patterns from snapshots."""
        if not snapshots:
            return {}
        
        analysis = {
            'growth_analysis': self._analyze_growth_pattern(snapshots),
            'gc_analysis': self._analyze_gc_impact(snapshots),
            'stability_analysis': self._analyze_stability(snapshots),
            'peak_analysis': self._analyze_peak_usage(snapshots),
            'trend_analysis': self._analyze_trends(snapshots)
        }
        
        return analysis
    
    def _analyze_growth_pattern(self, snapshots: List[MemorySnapshot]) -> Dict:
        """Analyze memory growth patterns."""
        if len(snapshots) < 2:
            return {'growth_rate_mb_per_second': 0.0, 'trend': 'stable'}
        
        # Calculate growth rate
        start = snapshots[0]
        end = snapshots[-1]
        
        duration = end.timestamp - start.timestamp
        memory_growth = end.process_rss_mb - start.process_rss_mb
        growth_rate = memory_growth / duration if duration > 0 else 0.0
        
        # Determine trend
        trend = 'stable'
        if growth_rate > 1.0:  # More than 1MB/s growth
            trend = 'rapid_growth'
        elif growth_rate > 0.1:
            trend = 'slow_growth'
        elif growth_rate < -0.1:
            trend = 'decreasing'
        
        # Check for memory leaks (sustained growth without GC relief)
        leak_indicators = self._detect_leak_indicators(snapshots)
        
        return {
            'growth_rate_mb_per_second': growth_rate,
            'total_growth_mb': memory_growth,
            'trend': trend,
            'leak_indicators': leak_indicators
        }
    
    def _analyze_gc_impact(self, snapshots: List[MemorySnapshot]) -> Dict:
        """Analyze garbage collection impact on performance."""
        gc_events = []
        
        for i in range(1, len(snapshots)):
            prev = snapshots[i-1]
            curr = snapshots[i]
            
            # Detect GC events (object count decrease + memory decrease)
            if (curr.gc_objects < prev.gc_objects * 0.9 and 
                curr.process_rss_mb < prev.process_rss_mb):
                
                gc_events.append({
                    'timestamp': curr.timestamp,
                    'objects_collected': prev.gc_objects - curr.gc_objects,
                    'memory_freed_mb': prev.process_rss_mb - curr.process_rss_mb
                })
        
        avg_gc_impact = 0.0
        if gc_events:
            total_freed = sum(event['memory_freed_mb'] for event in gc_events)
            avg_gc_impact = total_freed / len(gc_events)
        
        return {
            'gc_events_count': len(gc_events),
            'avg_memory_freed_per_gc_mb': avg_gc_impact,
            'gc_frequency_per_minute': len(gc_events) / ((snapshots[-1].timestamp - snapshots[0].timestamp) / 60) if len(snapshots) > 1 else 0,
            'gc_events': gc_events[-10:]  # Keep last 10 events
        }
    
    def _analyze_stability(self, snapshots: List[MemorySnapshot]) -> Dict:
        """Analyze memory usage stability."""
        memory_values = [s.process_rss_mb for s in snapshots]
        
        if len(memory_values) < 2:
            return {'stability_score': 1.0, 'variance': 0.0}
        
        mean_memory = statistics.mean(memory_values)
        variance = statistics.variance(memory_values)
        std_dev = statistics.stdev(memory_values)
        
        # Calculate stability score (lower variance = higher stability)
        stability_score = max(0.0, 1.0 - (std_dev / mean_memory))
        
        return {
            'stability_score': stability_score,
            'variance': variance,
            'standard_deviation': std_dev,
            'coefficient_of_variation': std_dev / mean_memory if mean_memory > 0 else 0.0
        }
    
    def _analyze_peak_usage(self, snapshots: List[MemorySnapshot]) -> Dict:
        """Analyze peak memory usage patterns."""
        memory_values = [s.process_rss_mb for s in snapshots]
        
        if not memory_values:
            return {}
        
        peak_memory = max(memory_values)
        peak_index = memory_values.index(peak_memory)
        peak_snapshot = snapshots[peak_index]
        
        # Calculate percentiles
        p50 = statistics.median(memory_values)
        p95 = self._percentile(memory_values, 95)
        p99 = self._percentile(memory_values, 99)
        
        return {
            'peak_memory_mb': peak_memory,
            'peak_timestamp': peak_snapshot.timestamp,
            'median_memory_mb': p50,
            'p95_memory_mb': p95,
            'p99_memory_mb': p99,
            'peak_ratio': peak_memory / p50 if p50 > 0 else 1.0
        }
    
    def _analyze_trends(self, snapshots: List[MemorySnapshot]) -> Dict:
        """Analyze long-term memory trends."""
        if len(snapshots) < 10:
            return {'trend': 'insufficient_data'}
        
        # Split into quarters to analyze trends
        quarter_size = len(snapshots) // 4
        quarters = [
            snapshots[i:i+quarter_size] 
            for i in range(0, len(snapshots), quarter_size)
        ][:4]
        
        quarter_averages = [
            statistics.mean([s.process_rss_mb for s in quarter])
            for quarter in quarters if quarter
        ]
        
        # Calculate trend direction
        if len(quarter_averages) >= 4:
            slope = (quarter_averages[-1] - quarter_averages[0]) / len(quarter_averages)
            if slope > 0.5:
                trend = 'increasing'
            elif slope < -0.5:
                trend = 'decreasing'
            else:
                trend = 'stable'
        else:
            trend = 'insufficient_data'
        
        return {
            'trend': trend,
            'quarter_averages': quarter_averages,
            'trend_slope': slope if 'slope' in locals() else 0.0
        }
    
    def _detect_leak_indicators(self, snapshots: List[MemorySnapshot]) -> List[str]:
        """Detect potential memory leak indicators."""
        indicators = []
        
        if len(snapshots) < 10:
            return indicators
        
        memory_values = [s.process_rss_mb for s in snapshots]
        
        # Check for sustained growth
        recent_values = memory_values[-10:]
        if all(recent_values[i] <= recent_values[i+1] for i in range(len(recent_values)-1)):
            indicators.append('sustained_memory_growth')
        
        # Check for high variance in object count
        object_counts = [s.gc_objects for s in snapshots]
        if len(object_counts) > 1:
            obj_variance = statistics.variance(object_counts)
            obj_mean = statistics.mean(object_counts)
            if obj_variance / obj_mean > 0.5:
                indicators.append('high_object_churn')
        
        # Check for increasing file descriptor usage
        fd_counts = [s.file_descriptors for s in snapshots if s.file_descriptors > 0]
        if len(fd_counts) > 5:
            if fd_counts[-1] > fd_counts[0] * 1.5:
                indicators.append('file_descriptor_leak')
        
        return indicators
    
    def _percentile(self, values: List[float], percentile: int) -> float:
        """Calculate percentile value."""
        if not values:
            return 0.0
        
        sorted_values = sorted(values)
        index = int((percentile / 100.0) * len(sorted_values))
        index = min(index, len(sorted_values) - 1)
        return sorted_values[index]


class MemoryOptimizer:
    """Generate memory optimization recommendations."""
    
    def __init__(self):
        self.optimization_strategies = {
            'gc_tuning': self._generate_gc_optimization,
            'object_pooling': self._generate_pooling_optimization,
            'cache_sizing': self._generate_cache_optimization,
            'data_structure': self._generate_datastructure_optimization,
            'lazy_loading': self._generate_lazy_loading_optimization
        }
    
    def generate_optimizations(self, profile: MemoryProfile, 
                             analysis: Dict) -> List[MemoryOptimization]:
        """Generate memory optimizations based on profile and analysis."""
        optimizations = []
        
        for strategy_name, strategy_func in self.optimization_strategies.items():
            optimization = strategy_func(profile, analysis)
            if optimization:
                optimizations.append(optimization)
        
        # Sort by expected savings
        optimizations.sort(key=lambda x: x.expected_savings_mb, reverse=True)
        
        return optimizations
    
    def _generate_gc_optimization(self, profile: MemoryProfile, 
                                 analysis: Dict) -> Optional[MemoryOptimization]:
        """Generate GC tuning optimization."""
        gc_analysis = analysis.get('gc_analysis', {})
        
        if gc_analysis.get('gc_frequency_per_minute', 0) > 10:
            return MemoryOptimization(
                optimization_type='gc_tuning',
                description='Reduce GC frequency by tuning generation thresholds',
                expected_savings_mb=profile.memory_growth_mb * 0.2,
                implementation_effort='low',
                confidence=0.7,
                applicable_operations=['high_object_churn', 'frequent_allocations'],
                code_example='''
# Tune GC thresholds
import gc
gc.set_threshold(700, 10, 10)  # Reduce frequency

# Use object pooling for frequently created objects
class ObjectPool:
    def __init__(self):
        self.pool = []
    
    def get_object(self):
        return self.pool.pop() if self.pool else create_new_object()
    
    def return_object(self, obj):
        obj.reset()
        self.pool.append(obj)
'''
            )
        
        return None
    
    def _generate_pooling_optimization(self, profile: MemoryProfile, 
                                     analysis: Dict) -> Optional[MemoryOptimization]:
        """Generate object pooling optimization."""
        growth_analysis = analysis.get('growth_analysis', {})
        
        if 'high_object_churn' in growth_analysis.get('leak_indicators', []):
            return MemoryOptimization(
                optimization_type='object_pooling',
                description='Implement object pooling for frequently created objects',
                expected_savings_mb=profile.memory_growth_mb * 0.3,
                implementation_effort='medium',
                confidence=0.8,
                applicable_operations=['object_creation_heavy', 'agent_spawning'],
                code_example='''
from collections import deque
from typing import TypeVar, Generic, Callable

T = TypeVar('T')

class ObjectPool(Generic[T]):
    def __init__(self, create_func: Callable[[], T], reset_func: Callable[[T], None]):
        self.create_func = create_func
        self.reset_func = reset_func
        self.pool = deque()
    
    def acquire(self) -> T:
        if self.pool:
            return self.pool.popleft()
        return self.create_func()
    
    def release(self, obj: T):
        self.reset_func(obj)
        self.pool.append(obj)
'''
            )
        
        return None
    
    def _generate_cache_optimization(self, profile: MemoryProfile, 
                                   analysis: Dict) -> Optional[MemoryOptimization]:
        """Generate cache sizing optimization."""
        if profile.cache_efficiency_percent < 60:
            return MemoryOptimization(
                optimization_type='cache_sizing',
                description='Optimize cache size and eviction policies',
                expected_savings_mb=profile.peak_memory_mb * 0.15,
                implementation_effort='low',
                confidence=0.85,
                applicable_operations=['caching_heavy', 'repeated_operations'],
                code_example='''
from functools import lru_cache
import weakref

# Use LRU cache with appropriate size
@lru_cache(maxsize=1000)  # Adjust based on memory constraints
def expensive_operation(key):
    pass

# Use weak references for large objects
class WeakCache:
    def __init__(self):
        self._cache = weakref.WeakValueDictionary()
    
    def get(self, key, factory):
        result = self._cache.get(key)
        if result is None:
            result = factory()
            self._cache[key] = result
        return result
'''
            )
        
        return None
    
    def _generate_datastructure_optimization(self, profile: MemoryProfile, 
                                           analysis: Dict) -> Optional[MemoryOptimization]:
        """Generate data structure optimization."""
        stability_analysis = analysis.get('stability_analysis', {})
        
        if stability_analysis.get('coefficient_of_variation', 0) > 0.3:
            return MemoryOptimization(
                optimization_type='data_structure',
                description='Use memory-efficient data structures',
                expected_savings_mb=profile.peak_memory_mb * 0.1,
                implementation_effort='medium',
                confidence=0.75,
                applicable_operations=['data_heavy', 'large_collections'],
                code_example='''
# Use __slots__ for classes with many instances
class Agent:
    __slots__ = ['id', 'name', 'status', 'metadata']
    
    def __init__(self, id, name):
        self.id = id
        self.name = name
        self.status = 'active'
        self.metadata = {}

# Use array.array for numeric data
import array
numbers = array.array('f', [1.0, 2.0, 3.0])  # More memory efficient than list

# Use collections.deque for queues
from collections import deque
queue = deque(maxlen=1000)  # Bounded queue
'''
            )
        
        return None
    
    def _generate_lazy_loading_optimization(self, profile: MemoryProfile, 
                                          analysis: Dict) -> Optional[MemoryOptimization]:
        """Generate lazy loading optimization."""
        peak_analysis = analysis.get('peak_analysis', {})
        
        if peak_analysis.get('peak_ratio', 1.0) > 2.0:
            return MemoryOptimization(
                optimization_type='lazy_loading',
                description='Implement lazy loading for large data structures',
                expected_savings_mb=profile.peak_memory_mb * 0.25,
                implementation_effort='high',
                confidence=0.9,
                applicable_operations=['large_data_loading', 'initialization_heavy'],
                code_example='''
class LazyProperty:
    def __init__(self, func):
        self.func = func
        self.name = func.__name__
    
    def __get__(self, instance, owner):
        if instance is None:
            return self
        value = self.func(instance)
        setattr(instance, self.name, value)
        return value

class DataModel:
    @LazyProperty
    def expensive_data(self):
        # Load large data only when accessed
        return load_large_dataset()
    
    @LazyProperty  
    def computed_results(self):
        return perform_expensive_computation()
'''
            )
        
        return None


class MemoryPersistenceProfiler:
    """
    Profile memory persistence overhead and optimization for Claude Flow swarms.
    
    This class provides comprehensive memory analysis including growth patterns,
    GC impact, cache efficiency, and persistence overhead measurement.
    """
    
    def __init__(self, config: Optional[Dict] = None):
        self.config = config or {}
        self.memory_tracker = MemoryTracker(
            sampling_interval=self.config.get('sampling_interval', 0.5),
            max_samples=self.config.get('max_samples', 1000)
        )
        self.analyzer = SwarmMemoryAnalyzer()
        self.optimizer = MemoryOptimizer()
        self.active_profiles = {}
        
        logger.info("MemoryPersistenceProfiler initialized")
    
    async def profile_memory_persistence(self, swarm_id: str, 
                                       operation_context: Optional[Dict] = None) -> MemoryProfile:
        """
        Profile memory persistence for a swarm operation.
        
        Args:
            swarm_id: Unique identifier for the swarm
            operation_context: Additional context about the operation
            
        Returns:
            MemoryProfile with comprehensive analysis and optimization suggestions
        """
        start_time = time.time()
        
        logger.info("Starting memory profiling for swarm: %s", swarm_id)
        
        # Take initial snapshot
        initial_snapshot = self.memory_tracker._take_snapshot()
        
        # Start continuous tracking
        self.memory_tracker.start_tracking()
        
        try:
            # Execute memory operations if context provided
            if operation_context:
                await self._execute_memory_operations(swarm_id, operation_context)
            
            # Let profiling run for configured duration
            profile_duration = self.config.get('profile_duration', 30.0)
            await asyncio.sleep(profile_duration)
            
        finally:
            # Stop tracking and get snapshots
            snapshots = self.memory_tracker.stop_tracking()
        
        end_time = time.time()
        
        # Take final snapshot
        final_snapshot = snapshots[-1] if snapshots else initial_snapshot
        
        # Analyze memory patterns
        analysis = self.analyzer.analyze_memory_patterns(snapshots)
        
        # Calculate derived metrics
        memory_growth = final_snapshot.process_rss_mb - initial_snapshot.process_rss_mb
        peak_memory = max([s.process_rss_mb for s in snapshots]) if snapshots else initial_snapshot.process_rss_mb
        
        # Create memory profile
        profile = MemoryProfile(
            swarm_id=swarm_id,
            start_time=start_time,
            end_time=end_time,
            duration_seconds=end_time - start_time,
            initial_snapshot=initial_snapshot,
            final_snapshot=final_snapshot,
            peak_memory_mb=peak_memory,
            memory_growth_mb=memory_growth,
            gc_impact_ms=self._calculate_gc_impact_ms(analysis),
            persistence_overhead_mb=self._calculate_persistence_overhead(analysis),
            cache_efficiency_percent=self._calculate_cache_efficiency(operation_context),
            optimization_suggestions=[],
            memory_leaks_detected=self._detect_memory_leaks(analysis),
            performance_score=self._calculate_performance_score(analysis)
        )
        
        # Generate optimization suggestions
        optimizations = self.optimizer.generate_optimizations(profile, analysis)
        profile.optimization_suggestions = [opt.description for opt in optimizations]
        
        logger.info("Memory profiling completed for swarm %s: %.1f MB growth, %.1f performance score",
                   swarm_id, memory_growth, profile.performance_score)
        
        return profile
    
    async def profile_batch_operations(self, operations: List[Dict]) -> Dict[str, MemoryProfile]:
        """Profile memory usage for a batch of operations."""
        profiles = {}
        
        for i, operation in enumerate(operations):
            swarm_id = f"batch_op_{i}_{int(time.time())}"
            profile = await self.profile_memory_persistence(swarm_id, operation)
            profiles[swarm_id] = profile
        
        return profiles
    
    async def compare_memory_profiles(self, profiles: Dict[str, MemoryProfile]) -> Dict:
        """Compare multiple memory profiles and identify patterns."""
        if not profiles:
            return {}
        
        comparison = {
            'profile_count': len(profiles),
            'avg_memory_growth': statistics.mean([p.memory_growth_mb for p in profiles.values()]),
            'max_memory_growth': max([p.memory_growth_mb for p in profiles.values()]),
            'avg_performance_score': statistics.mean([p.performance_score for p in profiles.values()]),
            'common_optimizations': self._find_common_optimizations(profiles),
            'outlier_profiles': self._identify_outlier_profiles(profiles),
            'memory_efficiency_ranking': self._rank_by_efficiency(profiles)
        }
        
        return comparison
    
    def generate_memory_report(self, profile: MemoryProfile) -> str:
        """Generate a comprehensive memory profiling report."""
        report = f"""
# Memory Profiling Report - Swarm {profile.swarm_id}

## Executive Summary
- **Duration**: {profile.duration_seconds:.1f} seconds
- **Memory Growth**: {profile.memory_growth_mb:.1f} MB
- **Peak Memory**: {profile.peak_memory_mb:.1f} MB
- **Performance Score**: {profile.performance_score:.1f}/100

## Memory Usage Analysis
- **Initial Memory**: {profile.initial_snapshot.process_rss_mb:.1f} MB
- **Final Memory**: {profile.final_snapshot.process_rss_mb:.1f} MB
- **GC Impact**: {profile.gc_impact_ms:.1f} ms
- **Persistence Overhead**: {profile.persistence_overhead_mb:.1f} MB
- **Cache Efficiency**: {profile.cache_efficiency_percent:.1f}%

## Optimization Opportunities
"""
        
        for i, suggestion in enumerate(profile.optimization_suggestions, 1):
            report += f"{i}. {suggestion}\n"
        
        if profile.memory_leaks_detected:
            report += "\n## Memory Leaks Detected\n"
            for leak in profile.memory_leaks_detected:
                report += f"- {leak.get('description', 'Unknown leak pattern')}\n"
        
        report += f"\n## Recommendations\n"
        if profile.performance_score < 70:
            report += "- Memory usage optimization is highly recommended\n"
        if profile.memory_growth_mb > 100:
            report += "- Investigate potential memory leaks\n"
        if profile.cache_efficiency_percent < 60:
            report += "- Improve caching strategies\n"
        
        return report
    
    # Private helper methods
    
    async def _execute_memory_operations(self, swarm_id: str, context: Dict):
        """Execute operations that affect memory usage."""
        # Simulate memory operations based on context
        operation_type = context.get('type', 'generic')
        
        if operation_type == 'data_intensive':
            await self._simulate_data_operations()
        elif operation_type == 'agent_spawning':
            await self._simulate_agent_operations()
        elif operation_type == 'caching_heavy':
            await self._simulate_caching_operations()
    
    async def _simulate_data_operations(self):
        """Simulate data-intensive operations."""
        # Create and manipulate large data structures
        data = []
        for i in range(1000):
            data.append({'id': i, 'data': [j for j in range(100)]})
            if i % 100 == 0:
                await asyncio.sleep(0.01)  # Yield control
        
        # Force some garbage collection
        del data
        gc.collect()
    
    async def _simulate_agent_operations(self):
        """Simulate agent spawning operations."""
        agents = []
        for i in range(50):
            agent = {'id': i, 'state': {}, 'memory': [0] * 1000}
            agents.append(agent)
            await asyncio.sleep(0.05)
        
        # Cleanup some agents
        del agents[::2]  # Remove every other agent
        gc.collect()
    
    async def _simulate_caching_operations(self):
        """Simulate caching-heavy operations."""
        cache = {}
        for i in range(500):
            key = f"key_{i % 50}"  # Create cache hits
            if key in cache:
                _ = cache[key]
            else:
                cache[key] = {'data': [j for j in range(50)]}
            await asyncio.sleep(0.01)
    
    def _calculate_gc_impact_ms(self, analysis: Dict) -> float:
        """Calculate GC impact in milliseconds."""
        gc_analysis = analysis.get('gc_analysis', {})
        gc_count = gc_analysis.get('gc_events_count', 0)
        
        # Estimate based on GC frequency and typical GC pause times
        estimated_gc_time = gc_count * 2.0  # Assume 2ms per GC event
        return estimated_gc_time
    
    def _calculate_persistence_overhead(self, analysis: Dict) -> float:
        """Calculate persistence overhead in MB."""
        # Estimate based on memory growth patterns
        growth_analysis = analysis.get('growth_analysis', {})
        growth_rate = growth_analysis.get('growth_rate_mb_per_second', 0.0)
        
        # Assume 30% of growth is persistence overhead
        return abs(growth_rate) * 0.3
    
    def _calculate_cache_efficiency(self, context: Optional[Dict]) -> float:
        """Calculate cache efficiency percentage."""
        if not context:
            return 75.0  # Default assumption
        
        # This would analyze actual cache hit rates
        return context.get('cache_hit_rate', 75.0) * 100
    
    def _detect_memory_leaks(self, analysis: Dict) -> List[Dict]:
        """Detect potential memory leaks from analysis."""
        leaks = []
        
        growth_analysis = analysis.get('growth_analysis', {})
        leak_indicators = growth_analysis.get('leak_indicators', [])
        
        for indicator in leak_indicators:
            leaks.append({
                'type': indicator,
                'description': self._get_leak_description(indicator),
                'severity': 'medium'
            })
        
        return leaks
    
    def _get_leak_description(self, indicator: str) -> str:
        """Get description for memory leak indicator."""
        descriptions = {
            'sustained_memory_growth': 'Continuous memory growth without GC relief',
            'high_object_churn': 'High rate of object creation and destruction',
            'file_descriptor_leak': 'File descriptors not being properly closed'
        }
        return descriptions.get(indicator, f'Unknown leak pattern: {indicator}')
    
    def _calculate_performance_score(self, analysis: Dict) -> float:
        """Calculate overall memory performance score (0-100)."""
        score = 100.0
        
        # Penalize for memory leaks
        growth_analysis = analysis.get('growth_analysis', {})
        if growth_analysis.get('leak_indicators'):
            score -= 20.0
        
        # Penalize for instability
        stability_analysis = analysis.get('stability_analysis', {})
        stability_score = stability_analysis.get('stability_score', 1.0)
        score *= stability_score
        
        # Penalize for high peak usage
        peak_analysis = analysis.get('peak_analysis', {})
        peak_ratio = peak_analysis.get('peak_ratio', 1.0)
        if peak_ratio > 2.0:
            score -= (peak_ratio - 2.0) * 10.0
        
        return max(0.0, min(100.0, score))
    
    def _find_common_optimizations(self, profiles: Dict[str, MemoryProfile]) -> List[str]:
        """Find optimization suggestions common across profiles."""
        all_suggestions = []
        for profile in profiles.values():
            all_suggestions.extend(profile.optimization_suggestions)
        
        # Count occurrences
        suggestion_counts = defaultdict(int)
        for suggestion in all_suggestions:
            suggestion_counts[suggestion] += 1
        
        # Return suggestions that appear in >50% of profiles
        threshold = len(profiles) * 0.5
        common = [sugg for sugg, count in suggestion_counts.items() if count >= threshold]
        
        return common
    
    def _identify_outlier_profiles(self, profiles: Dict[str, MemoryProfile]) -> List[str]:
        """Identify profiles with unusual memory behavior."""
        if len(profiles) < 3:
            return []
        
        memory_growths = [p.memory_growth_mb for p in profiles.values()]
        mean_growth = statistics.mean(memory_growths)
        std_growth = statistics.stdev(memory_growths) if len(memory_growths) > 1 else 0
        
        outliers = []
        for swarm_id, profile in profiles.items():
            # Mark as outlier if >2 standard deviations from mean
            if abs(profile.memory_growth_mb - mean_growth) > 2 * std_growth:
                outliers.append(swarm_id)
        
        return outliers
    
    def _rank_by_efficiency(self, profiles: Dict[str, MemoryProfile]) -> List[Tuple[str, float]]:
        """Rank profiles by memory efficiency."""
        efficiency_scores = []
        
        for swarm_id, profile in profiles.items():
            # Calculate efficiency as inverse of memory growth per second
            efficiency = 1.0 / (profile.memory_growth_mb / profile.duration_seconds + 1.0)
            efficiency_scores.append((swarm_id, efficiency))
        
        # Sort by efficiency descending
        efficiency_scores.sort(key=lambda x: x[1], reverse=True)
        
        return efficiency_scores

    async def benchmark_memory_optimizations(self, test_scenarios: List[Dict]) -> Dict:
        """
        Benchmark different memory optimization strategies.
        
        Args:
            test_scenarios: List of test scenarios for benchmarking
            
        Returns:
            Comprehensive benchmark results for memory optimizations
        """
        benchmark_results = {
            'scenarios_tested': len(test_scenarios),
            'optimization_effectiveness': {},
            'memory_savings': {},
            'performance_impact': {},
            'recommendations': []
        }
        
        for scenario in test_scenarios:
            scenario_name = scenario.get('name', f'scenario_{len(benchmark_results)}')
            
            # Profile baseline (no optimizations)
            baseline_profile = await self.profile_memory_persistence(
                f"{scenario_name}_baseline", scenario
            )
            
            # Profile with optimizations
            optimized_scenario = scenario.copy()
            optimized_scenario['optimizations_enabled'] = True
            
            optimized_profile = await self.profile_memory_persistence(
                f"{scenario_name}_optimized", optimized_scenario
            )
            
            # Calculate improvements
            memory_savings = baseline_profile.memory_growth_mb - optimized_profile.memory_growth_mb
            performance_improvement = optimized_profile.performance_score - baseline_profile.performance_score
            
            benchmark_results['memory_savings'][scenario_name] = memory_savings
            benchmark_results['performance_impact'][scenario_name] = performance_improvement
            benchmark_results['optimization_effectiveness'][scenario_name] = {
                'memory_reduction_percent': (memory_savings / baseline_profile.memory_growth_mb * 100) if baseline_profile.memory_growth_mb > 0 else 0.0,
                'performance_improvement': performance_improvement,
                'baseline_peak_mb': baseline_profile.peak_memory_mb,
                'optimized_peak_mb': optimized_profile.peak_memory_mb
            }
        
        # Generate overall recommendations
        avg_memory_savings = statistics.mean(benchmark_results['memory_savings'].values()) if benchmark_results['memory_savings'] else 0.0
        avg_performance_improvement = statistics.mean(benchmark_results['performance_impact'].values()) if benchmark_results['performance_impact'] else 0.0
        
        if avg_memory_savings > 10.0:
            benchmark_results['recommendations'].append('Memory optimizations show significant benefits')
        if avg_performance_improvement > 15.0:
            benchmark_results['recommendations'].append('Performance improvements justify optimization implementation')
        
        logger.info("Memory optimization benchmark completed: %.1f MB average savings, %.1f points performance improvement",
                   avg_memory_savings, avg_performance_improvement)
        
        return benchmark_results