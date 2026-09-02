"""
SWE-bench prompt builder for claude-flow modes.
Generates appropriate prompts based on the execution mode and context.
"""

from typing import Dict, Any, Optional
from dataclasses import dataclass


@dataclass
class SWEBenchPromptConfig:
    """Configuration for SWE-bench prompt generation."""
    mode: str  # swarm, hive-mind, sparc
    subcommand: Optional[str] = None  # for sparc modes
    max_agents: int = 8
    include_validation: bool = False
    include_tests: bool = False
    output_format: str = "patch"  # patch, json, or structured


class SWEBenchPromptBuilder:
    """Builds optimized prompts for SWE-bench tasks based on claude-flow mode."""
    
    MODE_CONTEXTS = {
        "hive-mind": (
            "You are operating in claude-flow hive-mind mode with a Queen coordinator "
            "and {max_agents} worker agents. The Queen will analyze the problem and "
            "delegate tasks to workers for parallel execution."
        ),
        "swarm": (
            "You are operating in claude-flow swarm mode with {max_agents} agents "
            "working collaboratively. Agents will coordinate to analyze, implement, "
            "and validate the solution."
        ),
        "sparc": (
            "You are operating in claude-flow SPARC {subcommand} mode following the "
            "Specification, Pseudocode, Architecture, Refinement, and Code methodology. "
            "This structured approach ensures high-quality solutions."
        )
    }
    
    def __init__(self, config: SWEBenchPromptConfig):
        """Initialize the prompt builder with configuration."""
        self.config = config
    
    def build_prompt(self, instance: Dict[str, Any]) -> str:
        """Build a comprehensive prompt for the SWE-bench instance."""
        instance_id = instance["instance_id"]
        repo = instance["repo"]
        problem = instance["problem_statement"]
        base_commit = instance.get("base_commit", "HEAD")
        
        # Get mode-specific context
        mode_context = self._get_mode_context()
        
        # Build the prompt
        prompt_parts = [
            # Mode context
            mode_context,
            "",
            # Task definition
            f"TASK: Fix GitHub issue {instance_id}",
            f"REPOSITORY: {repo}",
            f"BASE_COMMIT: {base_commit}",
            "",
            # Problem description
            "PROBLEM DESCRIPTION:",
            self._truncate_problem(problem),
            "",
            # Requirements
            "REQUIREMENTS:",
            "1. Analyze the bug to understand the root cause",
            "2. Identify the specific files and functions that need modification",
            "3. Implement a fix that resolves the issue without breaking existing functionality",
            "4. Ensure the fix is minimal and focused on the problem",
            "",
            # Output format
            "OUTPUT FORMAT:",
            self._get_output_format_instructions(),
            "",
            # Mode-specific instructions
            self._get_mode_specific_instructions(),
            "",
            # Final directive
            "BEGIN ANALYSIS AND IMPLEMENTATION NOW."
        ]
        
        # Join and clean the prompt
        prompt = " ".join(filter(None, prompt_parts))
        prompt = self._clean_prompt(prompt)
        
        return prompt
    
    def _get_mode_context(self) -> str:
        """Get the mode-specific context description."""
        template = self.MODE_CONTEXTS.get(self.config.mode, "")
        return template.format(
            max_agents=self.config.max_agents,
            subcommand=self.config.subcommand or "standard"
        )
    
    def _truncate_problem(self, problem: str, max_length: int = 500) -> str:
        """Truncate problem description to reasonable length."""
        if len(problem) <= max_length:
            return problem
        
        # Try to truncate at a sentence boundary
        truncated = problem[:max_length]
        last_period = truncated.rfind('.')
        if last_period > max_length * 0.8:  # If we have a period in the last 20%
            truncated = truncated[:last_period + 1]
        else:
            truncated = truncated.rstrip() + "..."
        
        return truncated
    
    def _get_output_format_instructions(self) -> str:
        """Get output format instructions based on configuration."""
        if self.config.output_format == "patch":
            return (
                "Output a valid git diff patch that can be applied with 'git apply'. "
                "The patch should be enclosed in ```diff code blocks. "
                "Include file paths, line numbers, and context as per standard git diff format."
            )
        elif self.config.output_format == "json":
            return (
                "Output a JSON object with the following structure: "
                '{"patch": "<git diff content>", "explanation": "<brief explanation>", '
                '"files_modified": ["list", "of", "files"], "confidence": 0.0-1.0}'
            )
        else:
            return (
                "Output the solution in a structured format with clear sections for: "
                "1) Problem Analysis, 2) Solution Approach, 3) Implementation (git diff), "
                "4) Validation Strategy"
            )
    
    def _get_mode_specific_instructions(self) -> str:
        """Get mode-specific execution instructions."""
        if self.config.mode == "hive-mind":
            return (
                "EXECUTION STRATEGY: "
                "- Queen should first analyze the problem and create a task plan "
                "- Delegate file exploration to Worker-1 "
                "- Delegate implementation to Worker-2 "
                "- Delegate validation to Worker-3 "
                "- Synthesize results into final patch"
            )
        elif self.config.mode == "swarm":
            return (
                "EXECUTION STRATEGY: "
                "- Agent-1: Problem analysis and root cause identification "
                "- Agent-2: Code exploration and file identification "
                "- Agent-3: Implementation and patch generation "
                "- Agent-4: Validation and testing "
                "- Coordinate to produce optimal solution"
            )
        elif self.config.mode == "sparc" and self.config.subcommand == "tdd":
            return (
                "EXECUTION STRATEGY (TDD): "
                "- First write a failing test that reproduces the bug "
                "- Implement the minimal fix to make the test pass "
                "- Refactor if necessary while keeping tests green "
                "- Output both test and implementation patches"
            )
        elif self.config.mode == "sparc":
            return (
                "EXECUTION STRATEGY (SPARC): "
                "- Specification: Define exact requirements and constraints "
                "- Pseudocode: Outline the solution approach "
                "- Architecture: Design the code changes needed "
                "- Refinement: Iterate on the solution "
                "- Code: Generate the final patch"
            )
        else:
            return ""
    
    def _clean_prompt(self, prompt: str) -> str:
        """Clean the prompt for shell execution."""
        # Remove problematic characters
        prompt = prompt.replace('"', "'")
        prompt = prompt.replace('\n', ' ')
        prompt = prompt.replace('\r', ' ')
        # Normalize whitespace
        prompt = ' '.join(prompt.split())
        return prompt
    
    def build_validation_prompt(self, instance: Dict[str, Any], patch: str) -> str:
        """Build a prompt for validating a generated patch."""
        instance_id = instance["instance_id"]
        repo = instance["repo"]
        
        prompt = (
            f"VALIDATION TASK for {instance_id} in {repo}: "
            f"Review the following patch and verify it correctly fixes the issue. "
            f"Check for: 1) Correctness, 2) No side effects, 3) Follows best practices. "
            f"Patch to validate: {patch[:200]}... "
            f"Output 'VALID' if correct, or 'INVALID: <reason>' if not."
        )
        
        return self._clean_prompt(prompt)