"""SWE-bench dataset loader and management."""

import json
import random
from dataclasses import dataclass, asdict
from pathlib import Path
from typing import List, Dict, Any, Optional, Set
from enum import Enum


class SWEBenchCategory(Enum):
    """SWE-bench task categories."""
    CODE_GENERATION = "code_generation"
    BUG_FIX = "bug_fix"
    REFACTORING = "refactoring"
    TESTING = "testing"
    DOCUMENTATION = "documentation"
    CODE_REVIEW = "code_review"
    PERFORMANCE = "performance"


class DifficultyLevel(Enum):
    """Task difficulty levels."""
    EASY = "easy"
    MEDIUM = "medium"
    HARD = "hard"


@dataclass
class SWEBenchTask:
    """Represents a SWE-bench task."""
    id: str
    category: SWEBenchCategory
    description: str
    input_code: Optional[str] = None
    expected_output: Optional[str] = None
    test_cases: List[Dict[str, Any]] = None
    difficulty: DifficultyLevel = DifficultyLevel.MEDIUM
    metadata: Dict[str, Any] = None
    
    def __post_init__(self):
        """Initialize default values."""
        if self.test_cases is None:
            self.test_cases = []
        if self.metadata is None:
            self.metadata = {}


class SWEBenchDataset:
    """Dataset loader and manager for SWE-bench tasks."""
    
    def __init__(self, dataset_path: Optional[Path] = None):
        """Initialize dataset manager.
        
        Args:
            dataset_path: Optional custom path to dataset files
        """
        self.dataset_path = dataset_path or Path(__file__).parent / "data"
        self.dataset_path.mkdir(parents=True, exist_ok=True)
        self._tasks_cache: Dict[str, List[SWEBenchTask]] = {}
        self._initialize_default_tasks()
    
    def _initialize_default_tasks(self) -> None:
        """Initialize default SWE-bench tasks if no dataset exists."""
        dataset_file = self.dataset_path / "swe_bench_tasks.json"
        
        if not dataset_file.exists():
            self._create_default_dataset(dataset_file)
        
        # Load and cache tasks
        with open(dataset_file, 'r') as f:
            data = json.load(f)
            
        for category_name, tasks_data in data.items():
            if category_name in [cat.value for cat in SWEBenchCategory]:
                category = SWEBenchCategory(category_name)
                self._tasks_cache[category.value] = [
                    SWEBenchTask(
                        id=task["id"],
                        category=category,
                        description=task["description"],
                        input_code=task.get("input_code"),
                        expected_output=task.get("expected_output"),
                        test_cases=task.get("test_cases", []),
                        difficulty=DifficultyLevel(task.get("difficulty", "medium")),
                        metadata=task.get("metadata", {})
                    )
                    for task in tasks_data
                ]
    
    def _create_default_dataset(self, dataset_file: Path) -> None:
        """Create default SWE-bench dataset."""
        default_tasks = {
            "code_generation": [
                {
                    "id": "codegen_001",
                    "description": "Create a REST API endpoint for user authentication",
                    "input_code": None,
                    "expected_output": "Functional authentication endpoint with proper error handling",
                    "test_cases": [
                        {"name": "test_valid_login", "input": "valid_credentials", "expected": "success_response"},
                        {"name": "test_invalid_login", "input": "invalid_credentials", "expected": "error_response"}
                    ],
                    "difficulty": "medium",
                    "metadata": {"framework": "express", "language": "javascript"}
                },
                {
                    "id": "codegen_002", 
                    "description": "Implement a binary search algorithm with proper edge cases",
                    "input_code": None,
                    "expected_output": "Efficient binary search with O(log n) complexity",
                    "test_cases": [
                        {"name": "test_found", "input": "[1,2,3,4,5], 3", "expected": "2"},
                        {"name": "test_not_found", "input": "[1,2,3,4,5], 6", "expected": "-1"},
                        {"name": "test_empty", "input": "[], 1", "expected": "-1"}
                    ],
                    "difficulty": "easy",
                    "metadata": {"algorithm_type": "search", "complexity": "logarithmic"}
                },
                {
                    "id": "codegen_003",
                    "description": "Create a distributed cache system with Redis integration",
                    "input_code": None,
                    "expected_output": "Scalable cache system with TTL and eviction policies",
                    "test_cases": [
                        {"name": "test_set_get", "input": "key:value", "expected": "value"},
                        {"name": "test_ttl_expiry", "input": "key:value, ttl:1s", "expected": "null_after_expiry"},
                        {"name": "test_eviction", "input": "multiple_keys", "expected": "lru_behavior"}
                    ],
                    "difficulty": "hard",
                    "metadata": {"system_type": "distributed", "technology": "redis"}
                }
            ],
            "bug_fix": [
                {
                    "id": "bugfix_001",
                    "description": "Fix memory leak in event listener cleanup",
                    "input_code": "class EventManager {\n  listeners = [];\n  addListener(fn) {\n    this.listeners.push(fn);\n  }\n}",
                    "expected_output": "Memory leak fixed with proper cleanup mechanism",
                    "test_cases": [
                        {"name": "test_cleanup", "input": "add_remove_listeners", "expected": "no_memory_growth"},
                        {"name": "test_multiple_cleanup", "input": "bulk_operations", "expected": "stable_memory"}
                    ],
                    "difficulty": "medium",
                    "metadata": {"bug_type": "memory_leak", "language": "javascript"}
                },
                {
                    "id": "bugfix_002",
                    "description": "Resolve race condition in concurrent database writes",
                    "input_code": "async function saveUser(userData) {\n  const user = await User.create(userData);\n  await updateStats(user.id);\n  return user;\n}",
                    "expected_output": "Thread-safe database operations with proper locking",
                    "test_cases": [
                        {"name": "test_concurrent_writes", "input": "parallel_saves", "expected": "data_consistency"},
                        {"name": "test_rollback", "input": "failed_operation", "expected": "clean_rollback"}
                    ],
                    "difficulty": "hard",
                    "metadata": {"bug_type": "race_condition", "domain": "database"}
                }
            ],
            "refactoring": [
                {
                    "id": "refactor_001",
                    "description": "Refactor monolithic service into microservices architecture",
                    "input_code": "class MonolithicService {\n  handleAuth() {}\n  handlePayment() {}\n  handleInventory() {}\n  handleNotification() {}\n}",
                    "expected_output": "Well-separated microservices with clear boundaries",
                    "test_cases": [
                        {"name": "test_service_separation", "input": "service_calls", "expected": "independent_services"},
                        {"name": "test_communication", "input": "inter_service_calls", "expected": "proper_messaging"}
                    ],
                    "difficulty": "hard",
                    "metadata": {"pattern": "microservices", "scope": "architecture"}
                },
                {
                    "id": "refactor_002",
                    "description": "Extract reusable components from duplicated code",
                    "input_code": "function processUser(user) {\n  // 50 lines of validation\n}\nfunction processAdmin(admin) {\n  // Same 50 lines of validation\n}",
                    "expected_output": "DRY code with extracted validation utilities",
                    "test_cases": [
                        {"name": "test_shared_logic", "input": "validation_calls", "expected": "reused_components"},
                        {"name": "test_maintainability", "input": "code_changes", "expected": "single_point_update"}
                    ],
                    "difficulty": "medium",
                    "metadata": {"principle": "DRY", "scope": "component"}
                }
            ],
            "testing": [
                {
                    "id": "testing_001",
                    "description": "Write comprehensive unit tests for payment processing module",
                    "input_code": "class PaymentProcessor {\n  processPayment(amount, cardData) {\n    // Payment logic\n  }\n}",
                    "expected_output": "Complete test suite with >90% coverage",
                    "test_cases": [
                        {"name": "test_coverage", "input": "test_execution", "expected": ">90%_coverage"},
                        {"name": "test_edge_cases", "input": "boundary_values", "expected": "proper_handling"},
                        {"name": "test_mocking", "input": "external_deps", "expected": "isolated_tests"}
                    ],
                    "difficulty": "medium",
                    "metadata": {"test_type": "unit", "coverage_target": "90"}
                },
                {
                    "id": "testing_002",
                    "description": "Create integration tests for API workflow",
                    "input_code": "API endpoints: /auth, /profile, /data",
                    "expected_output": "End-to-end integration test suite",
                    "test_cases": [
                        {"name": "test_user_flow", "input": "login_to_data_access", "expected": "complete_workflow"},
                        {"name": "test_error_handling", "input": "invalid_requests", "expected": "graceful_errors"},
                        {"name": "test_performance", "input": "load_testing", "expected": "acceptable_response_times"}
                    ],
                    "difficulty": "hard",
                    "metadata": {"test_type": "integration", "scope": "api"}
                }
            ],
            "documentation": [
                {
                    "id": "docs_001",
                    "description": "Create comprehensive API documentation with OpenAPI spec",
                    "input_code": "REST API with 15 endpoints",
                    "expected_output": "Complete OpenAPI 3.0 specification with examples",
                    "test_cases": [
                        {"name": "test_completeness", "input": "all_endpoints", "expected": "documented_endpoints"},
                        {"name": "test_examples", "input": "request_examples", "expected": "working_examples"},
                        {"name": "test_validation", "input": "spec_validation", "expected": "valid_openapi"}
                    ],
                    "difficulty": "medium",
                    "metadata": {"doc_type": "api", "standard": "openapi"}
                },
                {
                    "id": "docs_002",
                    "description": "Write technical architecture documentation for distributed system",
                    "input_code": "Microservices architecture with 8 services",
                    "expected_output": "Comprehensive architecture documentation with diagrams",
                    "test_cases": [
                        {"name": "test_completeness", "input": "architecture_coverage", "expected": "all_components_documented"},
                        {"name": "test_diagrams", "input": "visual_aids", "expected": "clear_diagrams"},
                        {"name": "test_onboarding", "input": "new_developer", "expected": "self_service_understanding"}
                    ],
                    "difficulty": "hard",
                    "metadata": {"doc_type": "architecture", "audience": "technical"}
                }
            ],
            "code_review": [
                {
                    "id": "review_001",
                    "description": "Review pull request for security vulnerabilities",
                    "input_code": "PR with authentication changes and database queries",
                    "expected_output": "Security review report with recommendations",
                    "test_cases": [
                        {"name": "test_sql_injection", "input": "db_queries", "expected": "vulnerability_detected"},
                        {"name": "test_auth_bypass", "input": "auth_logic", "expected": "security_gaps_identified"},
                        {"name": "test_recommendations", "input": "review_output", "expected": "actionable_suggestions"}
                    ],
                    "difficulty": "hard",
                    "metadata": {"review_type": "security", "scope": "authentication"}
                },
                {
                    "id": "review_002",
                    "description": "Conduct code quality review for performance optimizations",
                    "input_code": "Performance-critical module with database operations",
                    "expected_output": "Quality review with performance recommendations",
                    "test_cases": [
                        {"name": "test_performance_issues", "input": "code_analysis", "expected": "bottlenecks_identified"},
                        {"name": "test_best_practices", "input": "code_patterns", "expected": "violations_flagged"},
                        {"name": "test_maintainability", "input": "code_structure", "expected": "improvement_suggestions"}
                    ],
                    "difficulty": "medium",
                    "metadata": {"review_type": "quality", "focus": "performance"}
                }
            ],
            "performance": [
                {
                    "id": "perf_001",
                    "description": "Optimize database query performance for large datasets",
                    "input_code": "SELECT * FROM users WHERE status = 'active' AND created_at > '2023-01-01'",
                    "expected_output": "Optimized queries with proper indexing strategy",
                    "test_cases": [
                        {"name": "test_query_speed", "input": "1M_records", "expected": "<100ms_response"},
                        {"name": "test_index_usage", "input": "explain_plan", "expected": "index_scan"},
                        {"name": "test_scalability", "input": "growing_dataset", "expected": "consistent_performance"}
                    ],
                    "difficulty": "hard",
                    "metadata": {"optimization_type": "database", "target_metric": "query_time"}
                },
                {
                    "id": "perf_002",
                    "description": "Optimize frontend bundle size and loading performance",
                    "input_code": "React app with large bundle and slow initial load",
                    "expected_output": "Optimized bundle with code splitting and lazy loading",
                    "test_cases": [
                        {"name": "test_bundle_size", "input": "build_output", "expected": "<500KB_initial"},
                        {"name": "test_load_time", "input": "page_performance", "expected": "<2s_first_paint"},
                        {"name": "test_code_splitting", "input": "route_analysis", "expected": "lazy_loaded_routes"}
                    ],
                    "difficulty": "medium",
                    "metadata": {"optimization_type": "frontend", "target_metric": "load_time"}
                }
            ]
        }
        
        with open(dataset_file, 'w') as f:
            json.dump(default_tasks, f, indent=2)
    
    def load_tasks(
        self, 
        categories: Optional[List[str]] = None, 
        difficulty: Optional[str] = None,
        limit: Optional[int] = None,
        shuffle: bool = False
    ) -> List[SWEBenchTask]:
        """Load tasks based on filters.
        
        Args:
            categories: List of category names to include
            difficulty: Difficulty level to filter by
            limit: Maximum number of tasks to return
            shuffle: Whether to shuffle the task order
            
        Returns:
            List of filtered SWE-bench tasks
        """
        tasks = []
        
        # Filter by categories
        if categories:
            valid_categories = [cat for cat in categories if cat in self._tasks_cache]
        else:
            valid_categories = list(self._tasks_cache.keys())
        
        for category_name in valid_categories:
            category_tasks = self._tasks_cache[category_name]
            
            # Filter by difficulty
            if difficulty:
                try:
                    diff_level = DifficultyLevel(difficulty.lower())
                    category_tasks = [t for t in category_tasks if t.difficulty == diff_level]
                except ValueError:
                    continue  # Skip invalid difficulty
            
            tasks.extend(category_tasks)
        
        # Shuffle if requested
        if shuffle:
            random.shuffle(tasks)
        
        # Apply limit
        if limit and limit > 0:
            tasks = tasks[:limit]
        
        return tasks
    
    def get_task_by_id(self, task_id: str) -> Optional[SWEBenchTask]:
        """Get a specific task by ID.
        
        Args:
            task_id: The task ID to search for
            
        Returns:
            The task if found, None otherwise
        """
        for tasks_list in self._tasks_cache.values():
            for task in tasks_list:
                if task.id == task_id:
                    return task
        return None
    
    def get_categories(self) -> List[str]:
        """Get all available task categories.
        
        Returns:
            List of category names
        """
        return list(self._tasks_cache.keys())
    
    def get_category_stats(self) -> Dict[str, Dict[str, int]]:
        """Get statistics for each category.
        
        Returns:
            Dictionary with category stats including task counts by difficulty
        """
        stats = {}
        
        for category_name, tasks in self._tasks_cache.items():
            difficulty_counts = {}
            for task in tasks:
                diff_name = task.difficulty.value
                difficulty_counts[diff_name] = difficulty_counts.get(diff_name, 0) + 1
            
            stats[category_name] = {
                "total": len(tasks),
                "by_difficulty": difficulty_counts
            }
        
        return stats
    
    def add_custom_task(self, task: SWEBenchTask) -> None:
        """Add a custom task to the dataset.
        
        Args:
            task: The task to add
        """
        category_name = task.category.value
        if category_name not in self._tasks_cache:
            self._tasks_cache[category_name] = []
        
        self._tasks_cache[category_name].append(task)
    
    def save_dataset(self, output_path: Optional[Path] = None) -> None:
        """Save the current dataset to a JSON file.
        
        Args:
            output_path: Optional custom output path
        """
        output_file = output_path or (self.dataset_path / "swe_bench_tasks_updated.json")
        output_file.parent.mkdir(parents=True, exist_ok=True)
        
        # Convert tasks to serializable format
        serializable_data = {}
        for category_name, tasks in self._tasks_cache.items():
            serializable_data[category_name] = [
                {
                    "id": task.id,
                    "description": task.description,
                    "input_code": task.input_code,
                    "expected_output": task.expected_output,
                    "test_cases": task.test_cases,
                    "difficulty": task.difficulty.value,
                    "metadata": task.metadata
                }
                for task in tasks
            ]
        
        with open(output_file, 'w') as f:
            json.dump(serializable_data, f, indent=2)
    
    def create_subset(
        self, 
        categories: List[str], 
        tasks_per_category: int = 5,
        difficulty_distribution: Optional[Dict[str, float]] = None
    ) -> List[SWEBenchTask]:
        """Create a balanced subset of tasks for benchmarking.
        
        Args:
            categories: Categories to include
            tasks_per_category: Number of tasks per category
            difficulty_distribution: Optional distribution of difficulty levels
            
        Returns:
            Balanced list of tasks
        """
        if difficulty_distribution is None:
            difficulty_distribution = {"easy": 0.3, "medium": 0.5, "hard": 0.2}
        
        subset = []
        
        for category in categories:
            if category not in self._tasks_cache:
                continue
            
            category_tasks = self._tasks_cache[category]
            category_subset = []
            
            # Calculate how many of each difficulty level
            for difficulty, ratio in difficulty_distribution.items():
                try:
                    diff_level = DifficultyLevel(difficulty)
                    target_count = int(tasks_per_category * ratio)
                    
                    # Get tasks of this difficulty
                    diff_tasks = [t for t in category_tasks if t.difficulty == diff_level]
                    
                    # Sample the requested number
                    if len(diff_tasks) >= target_count:
                        sampled = random.sample(diff_tasks, target_count)
                    else:
                        sampled = diff_tasks
                    
                    category_subset.extend(sampled)
                except ValueError:
                    continue
            
            # Fill remaining slots with any available tasks
            remaining_slots = tasks_per_category - len(category_subset)
            if remaining_slots > 0:
                used_ids = {t.id for t in category_subset}
                available_tasks = [t for t in category_tasks if t.id not in used_ids]
                
                if available_tasks:
                    additional = random.sample(
                        available_tasks, 
                        min(remaining_slots, len(available_tasks))
                    )
                    category_subset.extend(additional)
            
            subset.extend(category_subset)
        
        return subset
    
    def validate_dataset(self) -> Dict[str, List[str]]:
        """Validate the dataset for completeness and consistency.
        
        Returns:
            Dictionary of validation issues by category
        """
        issues = {}
        
        for category_name, tasks in self._tasks_cache.items():
            category_issues = []
            
            for task in tasks:
                # Check required fields
                if not task.id:
                    category_issues.append(f"Task missing ID")
                if not task.description:
                    category_issues.append(f"Task {task.id} missing description")
                
                # Check test cases
                if not task.test_cases:
                    category_issues.append(f"Task {task.id} has no test cases")
                else:
                    for i, test_case in enumerate(task.test_cases):
                        if not test_case.get("name"):
                            category_issues.append(f"Task {task.id} test case {i} missing name")
                        if "expected" not in test_case:
                            category_issues.append(f"Task {task.id} test case {i} missing expected result")
                
                # Check metadata consistency
                if not task.metadata:
                    category_issues.append(f"Task {task.id} has no metadata")
            
            if category_issues:
                issues[category_name] = category_issues
        
        return issues