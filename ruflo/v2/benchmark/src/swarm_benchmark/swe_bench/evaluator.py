"""SWE-bench task evaluation and scoring system."""

import re
import json
import ast
import subprocess
import tempfile
from pathlib import Path
from typing import Dict, Any, List, Optional, Union, Tuple
from dataclasses import dataclass, field
from enum import Enum

from .datasets import SWEBenchTask, SWEBenchCategory, DifficultyLevel


class EvaluationMethod(Enum):
    """Different evaluation methods for SWE-bench tasks."""
    AUTOMATED_TESTING = "automated_testing"
    OUTPUT_COMPARISON = "output_comparison"
    CODE_ANALYSIS = "code_analysis"
    PERFORMANCE_METRICS = "performance_metrics"
    SEMANTIC_ANALYSIS = "semantic_analysis"
    MANUAL_REVIEW = "manual_review"


@dataclass
class EvaluationCriteria:
    """Criteria for evaluating a SWE-bench task."""
    functionality_weight: float = 0.4
    code_quality_weight: float = 0.2
    performance_weight: float = 0.2
    completeness_weight: float = 0.1
    best_practices_weight: float = 0.1
    
    def validate_weights(self) -> bool:
        """Validate that weights sum to 1.0."""
        total = (self.functionality_weight + self.code_quality_weight + 
                self.performance_weight + self.completeness_weight + 
                self.best_practices_weight)
        return abs(total - 1.0) < 0.001


@dataclass
class EvaluationResult:
    """Result of evaluating a SWE-bench task."""
    task_id: str
    passed: bool
    score: float  # 0.0 to 1.0
    max_score: float = 1.0
    method: EvaluationMethod = EvaluationMethod.AUTOMATED_TESTING
    details: Dict[str, Any] = field(default_factory=dict)
    feedback: List[str] = field(default_factory=list)
    test_results: List[Dict[str, Any]] = field(default_factory=list)
    performance_metrics: Dict[str, float] = field(default_factory=dict)
    errors: List[str] = field(default_factory=list)
    warnings: List[str] = field(default_factory=list)
    execution_time: float = 0.0
    
    @property
    def percentage_score(self) -> float:
        """Get score as percentage."""
        return (self.score / self.max_score) * 100 if self.max_score > 0 else 0.0
    
    @property
    def grade(self) -> str:
        """Get letter grade based on score."""
        percentage = self.percentage_score
        if percentage >= 90:
            return "A"
        elif percentage >= 80:
            return "B"
        elif percentage >= 70:
            return "C"
        elif percentage >= 60:
            return "D"
        else:
            return "F"


class SWEBenchEvaluator:
    """Evaluator for SWE-bench tasks with multiple evaluation methods."""
    
    def __init__(self, criteria: Optional[EvaluationCriteria] = None):
        """Initialize the evaluator.
        
        Args:
            criteria: Optional custom evaluation criteria
        """
        self.criteria = criteria or EvaluationCriteria()
        if not self.criteria.validate_weights():
            raise ValueError("Evaluation criteria weights must sum to 1.0")
        
        # Category-specific evaluation methods
        self.category_methods = {
            SWEBenchCategory.CODE_GENERATION: [
                EvaluationMethod.AUTOMATED_TESTING,
                EvaluationMethod.CODE_ANALYSIS,
                EvaluationMethod.OUTPUT_COMPARISON
            ],
            SWEBenchCategory.BUG_FIX: [
                EvaluationMethod.AUTOMATED_TESTING,
                EvaluationMethod.PERFORMANCE_METRICS,
                EvaluationMethod.CODE_ANALYSIS
            ],
            SWEBenchCategory.REFACTORING: [
                EvaluationMethod.CODE_ANALYSIS,
                EvaluationMethod.PERFORMANCE_METRICS,
                EvaluationMethod.SEMANTIC_ANALYSIS
            ],
            SWEBenchCategory.TESTING: [
                EvaluationMethod.AUTOMATED_TESTING,
                EvaluationMethod.CODE_ANALYSIS,
                EvaluationMethod.OUTPUT_COMPARISON
            ],
            SWEBenchCategory.DOCUMENTATION: [
                EvaluationMethod.SEMANTIC_ANALYSIS,
                EvaluationMethod.MANUAL_REVIEW,
                EvaluationMethod.OUTPUT_COMPARISON
            ],
            SWEBenchCategory.CODE_REVIEW: [
                EvaluationMethod.SEMANTIC_ANALYSIS,
                EvaluationMethod.CODE_ANALYSIS,
                EvaluationMethod.MANUAL_REVIEW
            ],
            SWEBenchCategory.PERFORMANCE: [
                EvaluationMethod.PERFORMANCE_METRICS,
                EvaluationMethod.AUTOMATED_TESTING,
                EvaluationMethod.CODE_ANALYSIS
            ]
        }
    
    def evaluate(
        self,
        task: SWEBenchTask,
        output: str,
        error: str = "",
        return_code: int = 0,
        execution_time: float = 0.0
    ) -> EvaluationResult:
        """Evaluate a SWE-bench task execution.
        
        Args:
            task: The SWE-bench task that was executed
            output: The output from task execution
            error: Any error messages from execution
            return_code: Process return code
            execution_time: Time taken for execution
            
        Returns:
            Detailed evaluation result
        """
        result = EvaluationResult(
            task_id=task.id,
            passed=False,
            score=0.0,
            execution_time=execution_time
        )
        
        # Get evaluation methods for this task category
        methods = self.category_methods.get(task.category, [EvaluationMethod.OUTPUT_COMPARISON])
        
        # Collect scores from different evaluation methods
        method_scores = {}
        method_details = {}
        
        for method in methods:
            try:
                score, details = self._evaluate_with_method(
                    task, output, error, return_code, method
                )
                method_scores[method.value] = score
                method_details[method.value] = details
            except Exception as e:
                result.errors.append(f"Evaluation method {method.value} failed: {str(e)}")
                method_scores[method.value] = 0.0
                method_details[method.value] = {"error": str(e)}
        
        # Calculate weighted final score
        result.score = self._calculate_weighted_score(method_scores, task.category)
        result.passed = result.score >= 0.6  # 60% threshold for passing
        result.details = method_details
        
        # Add comprehensive feedback
        result.feedback = self._generate_feedback(task, method_scores, method_details)
        
        # Handle execution errors
        if return_code != 0 or error:
            result.errors.append(f"Execution failed with return code {return_code}")
            if error:
                result.errors.append(f"Error output: {error}")
            result.score *= 0.5  # Penalize for execution errors
        
        return result
    
    def _evaluate_with_method(
        self,
        task: SWEBenchTask,
        output: str,
        error: str,
        return_code: int,
        method: EvaluationMethod
    ) -> Tuple[float, Dict[str, Any]]:
        """Evaluate using a specific method.
        
        Returns:
            Tuple of (score, details)
        """
        if method == EvaluationMethod.AUTOMATED_TESTING:
            return self._evaluate_automated_testing(task, output)
        elif method == EvaluationMethod.OUTPUT_COMPARISON:
            return self._evaluate_output_comparison(task, output)
        elif method == EvaluationMethod.CODE_ANALYSIS:
            return self._evaluate_code_analysis(task, output)
        elif method == EvaluationMethod.PERFORMANCE_METRICS:
            return self._evaluate_performance_metrics(task, output)
        elif method == EvaluationMethod.SEMANTIC_ANALYSIS:
            return self._evaluate_semantic_analysis(task, output)
        elif method == EvaluationMethod.MANUAL_REVIEW:
            return self._evaluate_manual_review(task, output)
        else:
            return 0.0, {"error": f"Unknown evaluation method: {method}"}
    
    def _evaluate_automated_testing(self, task: SWEBenchTask, output: str) -> Tuple[float, Dict[str, Any]]:
        """Evaluate using automated test execution."""
        details = {"method": "automated_testing", "test_results": []}
        
        if not task.test_cases:
            return 0.0, {"error": "No test cases defined"}
        
        total_tests = len(task.test_cases)
        passed_tests = 0
        
        for i, test_case in enumerate(task.test_cases):
            test_name = test_case.get("name", f"test_{i}")
            expected = test_case.get("expected", "")
            test_input = test_case.get("input", "")
            
            # Simulate test execution based on output analysis
            test_passed = self._check_test_case(output, test_input, expected)
            
            test_result = {
                "name": test_name,
                "passed": test_passed,
                "input": test_input,
                "expected": expected,
                "details": "Test simulation based on output analysis"
            }
            
            details["test_results"].append(test_result)
            
            if test_passed:
                passed_tests += 1
        
        score = passed_tests / total_tests if total_tests > 0 else 0.0
        details["passed_tests"] = passed_tests
        details["total_tests"] = total_tests
        details["pass_rate"] = score
        
        return score, details
    
    def _evaluate_output_comparison(self, task: SWEBenchTask, output: str) -> Tuple[float, Dict[str, Any]]:
        """Evaluate by comparing output to expected results."""
        details = {"method": "output_comparison"}
        
        expected_output = task.expected_output
        if not expected_output:
            # Use test cases for comparison
            if task.test_cases:
                expected_patterns = [tc.get("expected", "") for tc in task.test_cases]
                expected_output = " ".join(expected_patterns)
            else:
                return 0.0, {"error": "No expected output or test cases defined"}
        
        # Calculate similarity score
        similarity = self._calculate_text_similarity(output, expected_output)
        
        # Check for key indicators in output
        indicators_score = self._check_output_indicators(task, output)
        
        # Combine scores
        final_score = (similarity * 0.7) + (indicators_score * 0.3)
        
        details.update({
            "expected_output": expected_output[:200] + "..." if len(expected_output) > 200 else expected_output,
            "actual_output": output[:200] + "..." if len(output) > 200 else output,
            "similarity_score": similarity,
            "indicators_score": indicators_score,
            "final_score": final_score
        })
        
        return final_score, details
    
    def _evaluate_code_analysis(self, task: SWEBenchTask, output: str) -> Tuple[float, Dict[str, Any]]:
        """Evaluate code quality and structure."""
        details = {"method": "code_analysis"}
        score = 0.0
        
        # Extract code from output
        code_blocks = self._extract_code_blocks(output)
        
        if not code_blocks:
            return 0.0, {"error": "No code blocks found in output"}
        
        total_score = 0.0
        analysis_count = 0
        
        for code in code_blocks:
            code_score, code_details = self._analyze_code_quality(code, task)
            total_score += code_score
            analysis_count += 1
            details[f"code_block_{analysis_count}"] = code_details
        
        if analysis_count > 0:
            score = total_score / analysis_count
        
        details["total_code_blocks"] = analysis_count
        details["average_quality_score"] = score
        
        return score, details
    
    def _evaluate_performance_metrics(self, task: SWEBenchTask, output: str) -> Tuple[float, Dict[str, Any]]:
        """Evaluate performance characteristics."""
        details = {"method": "performance_metrics"}
        
        # Look for performance indicators in output
        performance_indicators = {
            "execution_time": r"(?:time|duration|elapsed):\s*(\d+(?:\.\d+)?)\s*(?:ms|s|seconds?|milliseconds?)",
            "memory_usage": r"memory:\s*(\d+(?:\.\d+)?)\s*(?:mb|gb|bytes?)",
            "throughput": r"(?:throughput|qps|rps):\s*(\d+(?:\.\d+)?)",
            "response_time": r"response\s*time:\s*(\d+(?:\.\d+)?)\s*(?:ms|s)",
            "cpu_usage": r"cpu:\s*(\d+(?:\.\d+)?)\s*%"
        }
        
        found_metrics = {}
        for metric, pattern in performance_indicators.items():
            matches = re.findall(pattern, output, re.IGNORECASE)
            if matches:
                found_metrics[metric] = float(matches[0])
        
        # Score based on found metrics and task requirements
        score = self._score_performance_metrics(found_metrics, task)
        
        details.update({
            "found_metrics": found_metrics,
            "performance_score": score,
            "task_category": task.category.value
        })
        
        return score, details
    
    def _evaluate_semantic_analysis(self, task: SWEBenchTask, output: str) -> Tuple[float, Dict[str, Any]]:
        """Evaluate semantic correctness and understanding."""
        details = {"method": "semantic_analysis"}
        
        # Analyze semantic correctness based on task description
        task_keywords = self._extract_keywords(task.description)
        output_keywords = self._extract_keywords(output)
        
        # Calculate keyword coverage
        keyword_coverage = len(set(task_keywords) & set(output_keywords)) / len(task_keywords) if task_keywords else 0
        
        # Analyze structure and completeness
        structure_score = self._analyze_response_structure(output, task)
        
        # Check for proper explanations and reasoning
        explanation_score = self._analyze_explanations(output)
        
        # Combine scores
        semantic_score = (keyword_coverage * 0.4) + (structure_score * 0.4) + (explanation_score * 0.2)
        
        details.update({
            "task_keywords": task_keywords,
            "output_keywords": output_keywords,
            "keyword_coverage": keyword_coverage,
            "structure_score": structure_score,
            "explanation_score": explanation_score,
            "semantic_score": semantic_score
        })
        
        return semantic_score, details
    
    def _evaluate_manual_review(self, task: SWEBenchTask, output: str) -> Tuple[float, Dict[str, Any]]:
        """Simulate manual review evaluation."""
        details = {"method": "manual_review"}
        
        # This would typically require human input
        # For automation, we use heuristics
        
        score_factors = {
            "completeness": self._check_completeness(output, task),
            "clarity": self._check_clarity(output),
            "accuracy": self._check_accuracy(output, task),
            "best_practices": self._check_best_practices(output, task)
        }
        
        # Weight the factors
        weights = {"completeness": 0.3, "clarity": 0.2, "accuracy": 0.3, "best_practices": 0.2}
        score = sum(score_factors[factor] * weights[factor] for factor in score_factors)
        
        details.update({
            "score_factors": score_factors,
            "weights": weights,
            "manual_review_score": score,
            "note": "Automated heuristics used in place of human review"
        })
        
        return score, details
    
    def _calculate_weighted_score(self, method_scores: Dict[str, float], category: SWEBenchCategory) -> float:
        """Calculate weighted final score based on category and evaluation methods."""
        if not method_scores:
            return 0.0
        
        # Category-specific weights for different evaluation methods
        category_weights = {
            SWEBenchCategory.CODE_GENERATION: {
                "automated_testing": 0.5,
                "code_analysis": 0.3,
                "output_comparison": 0.2
            },
            SWEBenchCategory.BUG_FIX: {
                "automated_testing": 0.4,
                "performance_metrics": 0.4,
                "code_analysis": 0.2
            },
            SWEBenchCategory.REFACTORING: {
                "code_analysis": 0.5,
                "performance_metrics": 0.3,
                "semantic_analysis": 0.2
            },
            SWEBenchCategory.TESTING: {
                "automated_testing": 0.6,
                "code_analysis": 0.3,
                "output_comparison": 0.1
            },
            SWEBenchCategory.DOCUMENTATION: {
                "semantic_analysis": 0.5,
                "manual_review": 0.3,
                "output_comparison": 0.2
            },
            SWEBenchCategory.CODE_REVIEW: {
                "semantic_analysis": 0.4,
                "code_analysis": 0.4,
                "manual_review": 0.2
            },
            SWEBenchCategory.PERFORMANCE: {
                "performance_metrics": 0.6,
                "automated_testing": 0.3,
                "code_analysis": 0.1
            }
        }
        
        weights = category_weights.get(category, {})
        
        # If no specific weights, use equal weighting
        if not weights:
            return sum(method_scores.values()) / len(method_scores)
        
        # Calculate weighted score
        total_weight = 0
        weighted_sum = 0
        
        for method, score in method_scores.items():
            weight = weights.get(method, 0.1)  # Default small weight for unexpected methods
            weighted_sum += score * weight
            total_weight += weight
        
        return weighted_sum / total_weight if total_weight > 0 else 0.0
    
    def _generate_feedback(
        self,
        task: SWEBenchTask,
        method_scores: Dict[str, float],
        method_details: Dict[str, Dict[str, Any]]
    ) -> List[str]:
        """Generate comprehensive feedback for the evaluation."""
        feedback = []
        
        # Overall performance feedback
        avg_score = sum(method_scores.values()) / len(method_scores) if method_scores else 0
        if avg_score >= 0.8:
            feedback.append("Excellent overall performance across evaluation criteria.")
        elif avg_score >= 0.6:
            feedback.append("Good performance with room for improvement in some areas.")
        else:
            feedback.append("Performance below expectations. Significant improvement needed.")
        
        # Method-specific feedback
        for method, score in method_scores.items():
            if score < 0.5:
                feedback.append(f"Poor performance in {method.replace('_', ' ')}: {score:.2f}")
            elif score >= 0.8:
                feedback.append(f"Strong performance in {method.replace('_', ' ')}: {score:.2f}")
        
        # Category-specific recommendations
        category_recommendations = {
            SWEBenchCategory.CODE_GENERATION: "Focus on writing clean, tested code with proper error handling.",
            SWEBenchCategory.BUG_FIX: "Ensure fixes address root causes and don't introduce new issues.",
            SWEBenchCategory.REFACTORING: "Maintain functionality while improving code structure and maintainability.",
            SWEBenchCategory.TESTING: "Create comprehensive test suites with good coverage and edge cases.",
            SWEBenchCategory.DOCUMENTATION: "Write clear, comprehensive documentation with examples.",
            SWEBenchCategory.CODE_REVIEW: "Provide constructive feedback with specific suggestions.",
            SWEBenchCategory.PERFORMANCE: "Focus on measurable performance improvements with benchmarks."
        }
        
        if task.category in category_recommendations:
            feedback.append(f"Category guidance: {category_recommendations[task.category]}")
        
        return feedback
    
    # Helper methods for evaluation
    def _check_test_case(self, output: str, test_input: str, expected: str) -> bool:
        """Check if a test case passes based on output analysis."""
        # This is a simplified simulation - in reality, would execute actual tests
        output_lower = output.lower()
        expected_lower = expected.lower()
        
        # Look for expected keywords or patterns
        if expected_lower in output_lower:
            return True
        
        # Look for success indicators
        success_indicators = ["success", "pass", "correct", "✓", "✅", "true"]
        if any(indicator in output_lower for indicator in success_indicators):
            return True
        
        return False
    
    def _calculate_text_similarity(self, text1: str, text2: str) -> float:
        """Calculate similarity between two texts."""
        if not text1 or not text2:
            return 0.0
        
        # Simple word-based similarity
        words1 = set(text1.lower().split())
        words2 = set(text2.lower().split())
        
        if not words1 or not words2:
            return 0.0
        
        intersection = words1 & words2
        union = words1 | words2
        
        return len(intersection) / len(union)
    
    def _check_output_indicators(self, task: SWEBenchTask, output: str) -> float:
        """Check for category-specific indicators in output."""
        output_lower = output.lower()
        
        category_indicators = {
            SWEBenchCategory.CODE_GENERATION: ["function", "class", "api", "endpoint", "implementation"],
            SWEBenchCategory.BUG_FIX: ["fix", "bug", "issue", "resolve", "patch"],
            SWEBenchCategory.REFACTORING: ["refactor", "improve", "restructure", "optimize", "clean"],
            SWEBenchCategory.TESTING: ["test", "assert", "expect", "coverage", "mock"],
            SWEBenchCategory.DOCUMENTATION: ["documentation", "readme", "guide", "example", "api"],
            SWEBenchCategory.CODE_REVIEW: ["review", "feedback", "suggestion", "improvement", "issue"],
            SWEBenchCategory.PERFORMANCE: ["performance", "optimize", "faster", "memory", "cpu"]
        }
        
        indicators = category_indicators.get(task.category, [])
        found_indicators = sum(1 for indicator in indicators if indicator in output_lower)
        
        return found_indicators / len(indicators) if indicators else 0.0
    
    def _extract_code_blocks(self, output: str) -> List[str]:
        """Extract code blocks from output."""
        # Look for various code block patterns
        patterns = [
            r"```[\w]*\n(.*?)\n```",  # Markdown code blocks
            r"`([^`]+)`",  # Inline code
            r"<code>(.*?)</code>",  # HTML code tags
        ]
        
        code_blocks = []
        for pattern in patterns:
            matches = re.findall(pattern, output, re.DOTALL | re.IGNORECASE)
            code_blocks.extend(matches)
        
        return [block.strip() for block in code_blocks if block.strip()]
    
    def _analyze_code_quality(self, code: str, task: SWEBenchTask) -> Tuple[float, Dict[str, Any]]:
        """Analyze the quality of a code block."""
        details = {}
        scores = {}
        
        # Basic syntax check
        try:
            # Try to parse as Python (basic check)
            ast.parse(code)
            scores["syntax"] = 1.0
            details["syntax_valid"] = True
        except:
            scores["syntax"] = 0.0
            details["syntax_valid"] = False
        
        # Code structure analysis
        scores["structure"] = self._analyze_code_structure(code)
        scores["naming"] = self._analyze_naming_conventions(code)
        scores["comments"] = self._analyze_comments(code)
        scores["complexity"] = self._analyze_complexity(code)
        
        # Calculate overall score
        overall_score = sum(scores.values()) / len(scores)
        
        details.update({
            "individual_scores": scores,
            "overall_score": overall_score,
            "code_length": len(code),
            "lines_of_code": len(code.split('\n'))
        })
        
        return overall_score, details
    
    def _analyze_code_structure(self, code: str) -> float:
        """Analyze code structure quality."""
        score = 0.5  # Base score
        
        # Check for functions
        if re.search(r'def \w+\(', code):
            score += 0.2
        
        # Check for classes
        if re.search(r'class \w+', code):
            score += 0.1
        
        # Check for proper indentation
        lines = code.split('\n')
        if any(line.startswith('    ') or line.startswith('\t') for line in lines):
            score += 0.1
        
        # Check for imports
        if re.search(r'^(?:import|from)\s+\w+', code, re.MULTILINE):
            score += 0.1
        
        return min(score, 1.0)
    
    def _analyze_naming_conventions(self, code: str) -> float:
        """Analyze naming convention adherence."""
        score = 0.5  # Base score
        
        # Check for snake_case functions
        if re.search(r'def [a-z_][a-z0-9_]*\(', code):
            score += 0.25
        
        # Check for PascalCase classes
        if re.search(r'class [A-Z][A-Za-z0-9]*', code):
            score += 0.25
        
        return min(score, 1.0)
    
    def _analyze_comments(self, code: str) -> float:
        """Analyze comment quality."""
        lines = code.split('\n')
        comment_lines = [line for line in lines if line.strip().startswith('#')]
        
        if not lines:
            return 0.0
        
        comment_ratio = len(comment_lines) / len(lines)
        
        # Optimal comment ratio is around 10-20%
        if 0.1 <= comment_ratio <= 0.2:
            return 1.0
        elif comment_ratio > 0:
            return 0.7
        else:
            return 0.3
    
    def _analyze_complexity(self, code: str) -> float:
        """Analyze code complexity (simplified)."""
        # Count cyclomatic complexity indicators
        complexity_indicators = ['if', 'else', 'elif', 'for', 'while', 'try', 'except', 'and', 'or']
        complexity_count = sum(len(re.findall(rf'\b{indicator}\b', code)) for indicator in complexity_indicators)
        
        # Score based on complexity (lower is better for maintainability)
        if complexity_count <= 5:
            return 1.0
        elif complexity_count <= 10:
            return 0.8
        elif complexity_count <= 15:
            return 0.6
        else:
            return 0.4
    
    def _score_performance_metrics(self, metrics: Dict[str, float], task: SWEBenchTask) -> float:
        """Score performance metrics based on task requirements."""
        if not metrics:
            return 0.3  # Base score for no metrics
        
        score = 0.5  # Base score for having metrics
        
        # Category-specific performance expectations
        if task.category == SWEBenchCategory.PERFORMANCE:
            # Higher expectations for performance tasks
            if "execution_time" in metrics and metrics["execution_time"] < 1000:  # < 1 second
                score += 0.3
            if "memory_usage" in metrics and metrics["memory_usage"] < 100:  # < 100MB
                score += 0.2
        else:
            # Basic performance expectations
            if "execution_time" in metrics:
                score += 0.2
            if "memory_usage" in metrics:
                score += 0.1
        
        return min(score, 1.0)
    
    def _extract_keywords(self, text: str) -> List[str]:
        """Extract important keywords from text."""
        # Remove common words and extract meaningful terms
        common_words = {'the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for', 'of', 'with', 'by'}
        words = re.findall(r'\b[a-zA-Z]{3,}\b', text.lower())
        return [word for word in words if word not in common_words]
    
    def _analyze_response_structure(self, output: str, task: SWEBenchTask) -> float:
        """Analyze the structure and organization of the response."""
        score = 0.5  # Base score
        
        # Check for proper sections/organization
        if re.search(r'^#+\s+', output, re.MULTILINE):  # Headers
            score += 0.2
        
        # Check for lists or structured content
        if re.search(r'^\s*[-*+]\s+', output, re.MULTILINE):  # Bullet points
            score += 0.1
        
        # Check for code blocks
        if '```' in output or '<code>' in output:
            score += 0.2
        
        return min(score, 1.0)
    
    def _analyze_explanations(self, output: str) -> float:
        """Analyze the quality of explanations in the output."""
        # Look for explanation indicators
        explanation_words = ['because', 'since', 'therefore', 'thus', 'hence', 'reason', 'explain']
        word_count = sum(output.lower().count(word) for word in explanation_words)
        
        if word_count >= 3:
            return 1.0
        elif word_count >= 1:
            return 0.7
        else:
            return 0.4
    
    def _check_completeness(self, output: str, task: SWEBenchTask) -> float:
        """Check if the output addresses all aspects of the task."""
        # Extract key requirements from task description
        task_words = self._extract_keywords(task.description)
        output_words = self._extract_keywords(output)
        
        if not task_words:
            return 0.5
        
        coverage = len(set(task_words) & set(output_words)) / len(task_words)
        return coverage
    
    def _check_clarity(self, output: str) -> float:
        """Check the clarity and readability of the output."""
        # Simple readability metrics
        words = len(output.split())
        sentences = len(re.split(r'[.!?]+', output))
        
        if sentences == 0:
            return 0.0
        
        avg_words_per_sentence = words / sentences
        
        # Optimal range is 10-20 words per sentence
        if 10 <= avg_words_per_sentence <= 20:
            return 1.0
        elif 5 <= avg_words_per_sentence <= 30:
            return 0.8
        else:
            return 0.6
    
    def _check_accuracy(self, output: str, task: SWEBenchTask) -> float:
        """Check the accuracy of the output against task requirements."""
        # This is a simplified check - would need more sophisticated analysis
        return self._check_completeness(output, task)
    
    def _check_best_practices(self, output: str, task: SWEBenchTask) -> float:
        """Check adherence to best practices based on task category."""
        best_practice_indicators = {
            SWEBenchCategory.CODE_GENERATION: ['error handling', 'validation', 'testing', 'documentation'],
            SWEBenchCategory.BUG_FIX: ['root cause', 'testing', 'regression', 'validation'],
            SWEBenchCategory.REFACTORING: ['maintainability', 'readability', 'patterns', 'solid'],
            SWEBenchCategory.TESTING: ['coverage', 'edge cases', 'mocking', 'isolation'],
            SWEBenchCategory.DOCUMENTATION: ['examples', 'api', 'usage', 'complete'],
            SWEBenchCategory.CODE_REVIEW: ['constructive', 'specific', 'actionable', 'positive'],
            SWEBenchCategory.PERFORMANCE: ['benchmarks', 'profiling', 'optimization', 'metrics']
        }
        
        indicators = best_practice_indicators.get(task.category, [])
        if not indicators:
            return 0.5
        
        output_lower = output.lower()
        found_count = sum(1 for indicator in indicators if indicator in output_lower)
        
        return found_count / len(indicators)
    
    def batch_evaluate(self, evaluations: List[Tuple[SWEBenchTask, str, str, int, float]]) -> List[EvaluationResult]:
        """Evaluate multiple tasks in batch.
        
        Args:
            evaluations: List of (task, output, error, return_code, execution_time) tuples
            
        Returns:
            List of evaluation results
        """
        results = []
        
        for task, output, error, return_code, execution_time in evaluations:
            try:
                result = self.evaluate(task, output, error, return_code, execution_time)
                results.append(result)
            except Exception as e:
                # Create error result
                error_result = EvaluationResult(
                    task_id=task.id,
                    passed=False,
                    score=0.0,
                    errors=[f"Evaluation failed: {str(e)}"]
                )
                results.append(error_result)
        
        return results
    
    def get_evaluation_summary(self, results: List[EvaluationResult]) -> Dict[str, Any]:
        """Generate summary statistics for a batch of evaluations.
        
        Args:
            results: List of evaluation results
            
        Returns:
            Summary statistics
        """
        if not results:
            return {"error": "No results to summarize"}
        
        total_tasks = len(results)
        passed_tasks = sum(1 for r in results if r.passed)
        scores = [r.score for r in results]
        
        summary = {
            "total_tasks": total_tasks,
            "passed_tasks": passed_tasks,
            "failed_tasks": total_tasks - passed_tasks,
            "pass_rate": passed_tasks / total_tasks,
            "average_score": sum(scores) / len(scores),
            "median_score": sorted(scores)[len(scores) // 2],
            "min_score": min(scores),
            "max_score": max(scores),
            "score_distribution": {
                "A (90-100%)": sum(1 for s in scores if s >= 0.9),
                "B (80-89%)": sum(1 for s in scores if 0.8 <= s < 0.9),
                "C (70-79%)": sum(1 for s in scores if 0.7 <= s < 0.8),
                "D (60-69%)": sum(1 for s in scores if 0.6 <= s < 0.7),
                "F (<60%)": sum(1 for s in scores if s < 0.6)
            }
        }
        
        return summary