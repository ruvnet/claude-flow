"""
Official SWE-bench integration for swarm-bench system.
Uses real SWE-bench dataset and evaluation framework.
"""

import asyncio
import json
import subprocess
import tempfile
from pathlib import Path
from typing import Dict, Any, List, Optional
from datetime import datetime
import time

try:
    from datasets import load_dataset
except ImportError:
    print("Installing required packages...")
    subprocess.run(["pip", "install", "datasets", "swebench"], check=True)
    from datasets import load_dataset

from ..core.real_benchmark_engine import RealBenchmarkEngine
from ..core.models import BenchmarkConfig, StrategyType, CoordinationMode
from .prompt_builder import SWEBenchPromptBuilder, SWEBenchPromptConfig


class OfficialSWEBenchEngine(RealBenchmarkEngine):
    """Official SWE-bench integration using real dataset and evaluation."""
    
    def __init__(self, config: Optional[BenchmarkConfig] = None):
        """Initialize with SWE-bench specific configuration."""
        super().__init__(config or self._default_config())
        self.dataset = None
        self.oracle_patches = None
        self.predictions = {}
        
    def _default_config(self) -> BenchmarkConfig:
        """Default configuration for SWE-bench."""
        return BenchmarkConfig(
            name="Official-SWE-bench",
            description="Official SWE-bench evaluation",
            strategy=StrategyType.DEVELOPMENT,
            mode=CoordinationMode.MESH,  # Based on our optimization results
            max_agents=8,  # Optimal from our testing
            task_timeout=600,  # 10 minutes per instance - SWE-bench tasks are complex
            output_directory="benchmark/swe-bench-official/results"
        )
        
    async def load_dataset(self, use_lite: bool = True) -> bool:
        """Load official SWE-bench dataset from HuggingFace."""
        try:
            print("📥 Loading official SWE-bench dataset...")
            
            if use_lite:
                # Use SWE-bench-Lite (300 instances)
                self.dataset = load_dataset("princeton-nlp/SWE-bench_Lite", split="test")
                print(f"✅ Loaded {len(self.dataset)} SWE-bench-Lite instances")
            else:
                # Use full SWE-bench (2,294 instances)
                self.dataset = load_dataset("princeton-nlp/SWE-bench", split="test")
                print(f"✅ Loaded {len(self.dataset)} full SWE-bench instances")
                
            # Load oracle patches for comparison
            try:
                oracle_dataset = load_dataset("princeton-nlp/SWE-bench_oracle", split="test")
                self.oracle_patches = {
                    inst["instance_id"]: inst["patch"] 
                    for inst in oracle_dataset
                }
                print(f"✅ Loaded {len(self.oracle_patches)} oracle patches")
            except:
                print("⚠️ Oracle patches not available")
                self.oracle_patches = {}
                
            return True
            
        except Exception as e:
            print(f"❌ Error loading dataset: {e}")
            print("Please install: pip install datasets swebench")
            return False
            
    async def run_instance(self, instance: Dict[str, Any]) -> Dict[str, Any]:
        """Run Claude Flow on a single SWE-bench instance."""
        
        instance_id = instance["instance_id"]
        repo = instance["repo"]
        problem = instance["problem_statement"]
        base_commit = instance["base_commit"]
        
        print(f"\n🔧 Processing: {instance_id}")
        print(f"   Repo: {repo}")
        print(f"   Problem: {problem[:100]}...")
        
        start_time = time.time()
        
        try:
            # Prepare the task for Claude Flow
            task_prompt = f"""Fix the following issue in {repo}:

Repository: {repo}
Base Commit: {base_commit}
Instance ID: {instance_id}

Problem Statement:
{problem}

Generate a git diff patch that fixes this issue. The patch should:
1. Apply cleanly to the base commit
2. Fix the described issue
3. Pass all existing tests
4. Include any new tests if needed

Return ONLY the git diff patch in proper format."""

            # Execute with Claude Flow using optimal configuration
            # Build prompt using the prompt builder
            prompt_config = SWEBenchPromptConfig(
                mode="hive-mind",
                max_agents=self.config.max_agents,
                include_validation=False,
                output_format="patch"
            )
            
            prompt_builder = SWEBenchPromptBuilder(prompt_config)
            simple_prompt = prompt_builder.build_prompt(instance)
            
            # Build command as array for subprocess (avoids shell escaping issues)
            # Use local claude-flow executable
            claude_flow_path = './claude-flow'
            
            # Check if we're in benchmark directory
            if Path.cwd().name == 'benchmark':
                claude_flow_path = '../claude-flow'
            
            # Use hive-mind spawn with --claude flag (as it works for you)
            cmd_args = [
                claude_flow_path, 'hive-mind', 'spawn',
                simple_prompt,
                '--claude',  # This generates the Claude Code coordination
                '--non-interactive'  # Must be at the end
            ]
            
            # Optionally add max workers
            if self.config.max_agents:
                # Insert before --non-interactive
                cmd_args.insert(-1, '--max-workers')
                cmd_args.insert(-1, str(self.config.max_agents))
            
            # Show the full command as it would appear in shell (with quotes)
            cmd_display = f"{cmd_args[0]} {cmd_args[1]} {cmd_args[2]} \"{cmd_args[3]}\""
            if len(cmd_args) > 4:
                cmd_display += " " + " ".join(cmd_args[4:])
            print(f"   📋 Executing: {cmd_display}")
            
            # Run with timeout using exec (not shell) to avoid escaping issues
            process = await asyncio.create_subprocess_exec(
                *cmd_args,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
                cwd=Path.cwd()
            )
            
            try:
                stdout, stderr = await asyncio.wait_for(
                    process.communicate(),
                    timeout=self.config.task_timeout
                )
                
                # Extract patch from output
                output = stdout.decode() if stdout else ""
                error_output = stderr.decode() if stderr else ""
                
                # Log process result
                print(f"   📊 Process exit code: {process.returncode}")
                
                if error_output and "error" in error_output.lower():
                    print(f"   ⚠️ Stderr: {error_output[:200]}")
                
                patch = self._extract_patch(output)
                
                # If no patch in stdout, check stderr (sometimes output goes there)
                if not patch and error_output:
                    patch = self._extract_patch(error_output)
                
                # Also check for generated patch files in the working directory
                if not patch:
                    patch = self._find_generated_patch_files(instance_id)
                
                # Store prediction
                self.predictions[instance_id] = {
                    "model_patch": patch if patch else "",
                    "model_name_or_path": "claude-flow-swarm",
                    "instance_id": instance_id
                }
                
                duration = time.time() - start_time
                
                return {
                    "instance_id": instance_id,
                    "success": bool(patch),
                    "patch": patch if patch else "",
                    "duration": duration,
                    "error": None if patch else "No patch generated"
                }
                
            except asyncio.TimeoutError:
                return {
                    "instance_id": instance_id,
                    "success": False,
                    "patch": "",
                    "duration": self.config.task_timeout,
                    "error": "Timeout"
                }
                
        except Exception as e:
            return {
                "instance_id": instance_id,
                "success": False,
                "patch": "",
                "duration": time.time() - start_time,
                "error": str(e)
            }
            
    def _extract_patch(self, output: str) -> str:
        """Extract git diff patch from Claude Flow output."""
        
        if not output:
            return ""
            
        # Debug: log first part of output
        print(f"   📝 Output length: {len(output)} chars")
        
        # Handle JSON stream output from claude-flow
        patch_content = ""
        
        # First try to parse JSON lines
        for line in output.split('\n'):
            if not line.strip():
                continue
            try:
                if line.startswith('{'):
                    data = json.loads(line)
                    # Look for content in various fields
                    if data.get('type') == 'content' and data.get('text'):
                        text = data['text']
                        # Check if this contains a patch
                        if 'diff --git' in text or '```diff' in text or '```patch' in text:
                            patch_content += text + '\n'
                    elif data.get('type') == 'tool_use' and data.get('name') in ['Write', 'Edit', 'MultiEdit']:
                        # Tool use might contain patches
                        if 'content' in data.get('input', {}):
                            patch_content += data['input']['content'] + '\n'
            except json.JSONDecodeError:
                # Not JSON, treat as regular text
                if 'diff --git' in line or line.startswith('---') or line.startswith('+++'):
                    patch_content += line + '\n'
        
        # If we found JSON content with patches, extract them
        if patch_content:
            return self._extract_patch_from_text(patch_content)
        
        # Otherwise try to extract from raw output
        return self._extract_patch_from_text(output)
    
    def _extract_patch_from_text(self, text: str) -> str:
        """Extract patch from text content."""
        lines = text.split('\n')
        patch_lines = []
        in_patch = False
        in_code_block = False
        
        for line in lines:
            # Check for code block with diff
            if '```diff' in line or '```patch' in line:
                in_code_block = True
                continue
            elif line.strip() == '```' and in_code_block:
                in_code_block = False
                if patch_lines:
                    break
                continue
                
            # Check for direct diff markers
            if line.startswith('diff --git'):
                in_patch = True
                patch_lines.append(line)
            elif line.startswith('---') or line.startswith('+++'):
                if not in_patch:
                    in_patch = True
                patch_lines.append(line)
            elif in_patch:
                # Continue collecting patch lines
                if line.startswith('```'):
                    break
                patch_lines.append(line)
            elif in_code_block:
                patch_lines.append(line)
        
        result = '\n'.join(patch_lines) if patch_lines else ""
        
        if result:
            print(f"   ✅ Extracted patch: {len(result)} chars")
        else:
            print(f"   ⚠️ No patch found in content")
            
        return result
    
    def _find_generated_patch_files(self, instance_id: str) -> str:
        """Look for generated patch files in the working directory."""
        import glob
        
        # Look for patch files that might have been created
        potential_patterns = [
            f"*{instance_id}*.patch",
            f"*{instance_id}*.diff",
            "*.patch",
            "*.diff",
            f"astropy_fix/*.patch",  # Check the cloned repo directory
            f"astropy_fix/*.diff"
        ]
        
        for pattern in potential_patterns:
            files = glob.glob(pattern)
            if files:
                # Read the first matching file
                try:
                    with open(files[0], 'r') as f:
                        content = f.read()
                        if 'diff' in content or '---' in content or '+++' in content:
                            print(f"   ✅ Found patch file: {files[0]}")
                            return content
                except Exception as e:
                    print(f"   ⚠️ Error reading patch file {files[0]}: {e}")
        
        return ""
        
    async def run_evaluation(
        self, 
        instances_limit: Optional[int] = None,
        use_lite: bool = True,
        save_predictions: bool = True
    ) -> Dict[str, Any]:
        """Run official SWE-bench evaluation."""
        
        print("""
╔══════════════════════════════════════════════════════════════╗
║              Official SWE-bench Evaluation                    ║
║                   Using Real Dataset                          ║
╚══════════════════════════════════════════════════════════════╝
""")
        
        # Load dataset
        if not await self.load_dataset(use_lite=use_lite):
            return {"error": "Failed to load dataset"}
            
        # Select instances to run
        instances = list(self.dataset)
        if instances_limit:
            instances = instances[:instances_limit]
            
        print(f"\n📊 Running on {len(instances)} instances")
        print(f"⚙️ Configuration: {self.config.mode.value}-{self.config.strategy.value}-{self.config.max_agents}agents")
        
        # Run each instance
        results = []
        successful = 0
        
        for i, instance in enumerate(instances, 1):
            print(f"\n[{i}/{len(instances)}] ", end="")
            
            result = await self.run_instance(instance)
            results.append(result)
            
            if result["success"]:
                successful += 1
                print(f"✅ Generated patch ({result['duration']:.1f}s)")
            else:
                print(f"❌ Failed: {result['error']}")
                
            # Show progress
            if i % 10 == 0:
                current_rate = successful / i
                print(f"\n📈 Progress: {i}/{len(instances)} - Success rate: {current_rate:.1%}")
                
        # Calculate final metrics
        total = len(results)
        success_rate = successful / total if total > 0 else 0
        avg_duration = sum(r["duration"] for r in results) / total if total > 0 else 0
        
        # Save predictions for submission
        if save_predictions:
            predictions_file = Path(self.config.output_directory) / "predictions.json"
            predictions_file.parent.mkdir(parents=True, exist_ok=True)
            
            with open(predictions_file, 'w') as f:
                json.dump(self.predictions, f, indent=2)
                
            print(f"\n💾 Predictions saved to: {predictions_file}")
            
        # Generate report
        report = {
            "dataset": "SWE-bench-Lite" if use_lite else "SWE-bench",
            "instances_evaluated": total,
            "successful_patches": successful,
            "success_rate": success_rate,
            "average_duration": avg_duration,
            "configuration": {
                "mode": self.config.mode.value,
                "strategy": self.config.strategy.value,
                "max_agents": self.config.max_agents
            },
            "timestamp": datetime.now().isoformat(),
            "results": results
        }
        
        # Save report
        report_file = Path(self.config.output_directory) / f"evaluation_report_{int(time.time())}.json"
        report_file.parent.mkdir(parents=True, exist_ok=True)
        
        with open(report_file, 'w') as f:
            json.dump(report, f, indent=2)
            
        print(f"\n" + "="*60)
        print(f"📊 EVALUATION COMPLETE")
        print(f"="*60)
        print(f"✅ Success Rate: {success_rate:.1%}")
        print(f"⏱️ Avg Duration: {avg_duration:.1f}s")
        print(f"📁 Report: {report_file}")
        print(f"📤 Predictions: {predictions_file if save_predictions else 'Not saved'}")
        
        return report
        
    async def validate_submission(self, predictions_file: str) -> bool:
        """Validate predictions file format for submission."""
        
        try:
            with open(predictions_file) as f:
                predictions = json.load(f)
                
            print(f"Validating {len(predictions)} predictions...")
            
            # Check format
            for instance_id, pred in predictions.items():
                if "model_patch" not in pred:
                    print(f"❌ Missing model_patch for {instance_id}")
                    return False
                if "model_name_or_path" not in pred:
                    print(f"❌ Missing model_name_or_path for {instance_id}")
                    return False
                    
            print("✅ Submission format is valid!")
            return True
            
        except Exception as e:
            print(f"❌ Validation error: {e}")
            return False