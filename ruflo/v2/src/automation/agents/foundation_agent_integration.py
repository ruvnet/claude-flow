#!/usr/bin/env python3
"""
Foundation Agent Integration for MLE-STAR Workflow
================================================
Integrates the Foundation Model Builder with the MLE-STAR automation system.
"""

import json
import subprocess
import sys
from pathlib import Path
from typing import Dict, Any, Optional
from datetime import datetime
import pandas as pd
import numpy as np

from foundation_agent_core import FoundationModelBuilder


class FoundationAgentIntegration:
    """
    Integration layer for Foundation Agent in MLE-STAR workflow
    """
    
    def __init__(self):
        self.agent_id = "foundation_agent"
        self.capabilities = ["data_preprocessing", "initial_modeling", "baseline_creation"]
        self.session_id = None
        self.execution_id = None
        self.builder = None
        
    def initialize_session(self, session_id: str, execution_id: str):
        """Initialize session with coordination data"""
        self.session_id = session_id
        self.execution_id = execution_id
        self.builder = FoundationModelBuilder(session_id, execution_id)
        
        # Store initialization in memory
        self._store_memory(
            "agent/foundation_agent/initialized",
            {
                "timestamp": datetime.now().isoformat(),
                "session_id": session_id,
                "execution_id": execution_id,
                "status": "ready"
            }
        )
    
    def _run_hook(self, hook_type: str, **kwargs) -> Optional[Dict]:
        """Run claude-flow hooks for coordination"""
        cmd = ["npx", "claude-flow@alpha", "hooks", hook_type]
        
        # Add parameters
        for key, value in kwargs.items():
            cmd.extend([f"--{key.replace('_', '-')}", str(value)])
        
        try:
            result = subprocess.run(cmd, capture_output=True, text=True)
            if result.returncode == 0:
                return {"status": "success", "output": result.stdout}
            else:
                return {"status": "error", "error": result.stderr}
        except Exception as e:
            return {"status": "error", "error": str(e)}
    
    def _store_memory(self, key: str, value: Any):
        """Store data in memory system"""
        cmd = [
            "npx", "claude-flow@alpha", "memory", "store",
            key, json.dumps(value)
        ]
        subprocess.run(cmd, capture_output=True)
    
    def _query_memory(self, pattern: str) -> Optional[Dict]:
        """Query memory system"""
        cmd = [
            "npx", "claude-flow@alpha", "memory", "query",
            pattern, "--namespace", "default"
        ]
        
        try:
            result = subprocess.run(cmd, capture_output=True, text=True)
            if result.returncode == 0:
                # Parse the output to extract memory entries
                lines = result.stdout.strip().split('\n')
                entries = {}
                current_key = None
                
                for line in lines:
                    if line.startswith('📌'):
                        # Extract key from the line
                        parts = line.split(' ')
                        if len(parts) > 1:
                            current_key = parts[1]
                    elif line.strip().startswith('Value:') and current_key:
                        # Extract JSON value
                        value_str = line.replace('Value:', '').strip()
                        try:
                            entries[current_key] = json.loads(value_str)
                        except:
                            entries[current_key] = value_str
                
                return entries
        except Exception as e:
            print(f"Error querying memory: {e}")
            return None
    
    def check_research_findings(self) -> Optional[Dict]:
        """Check for research findings from search agent"""
        # Query memory for search agent results
        search_results = self._query_memory(f"workflow/{self.execution_id}/web_search_phase")
        
        if search_results:
            self._store_memory(
                "agent/foundation_agent/research_loaded",
                {
                    "timestamp": datetime.now().isoformat(),
                    "findings_count": len(search_results),
                    "status": "loaded"
                }
            )
            return search_results
        
        return None
    
    def load_dataset(self, dataset_path: str) -> pd.DataFrame:
        """Load dataset for processing"""
        # Check if path exists
        path = Path(dataset_path)
        
        if path.exists():
            if path.suffix == '.csv':
                data = pd.read_csv(path)
            elif path.suffix == '.json':
                data = pd.read_json(path)
            elif path.suffix in ['.xlsx', '.xls']:
                data = pd.read_excel(path)
            else:
                raise ValueError(f"Unsupported file format: {path.suffix}")
            
            # Store dataset info
            self._store_memory(
                "agent/foundation_agent/dataset_loaded",
                {
                    "timestamp": datetime.now().isoformat(),
                    "path": str(path),
                    "shape": list(data.shape),
                    "columns": list(data.columns)
                }
            )
            
            return data
        else:
            # Try to load from memory or use sample data
            return self._load_sample_dataset()
    
    def _load_sample_dataset(self) -> pd.DataFrame:
        """Load sample dataset for testing"""
        from sklearn.datasets import make_classification
        
        # Generate sample dataset
        X, y = make_classification(
            n_samples=1000,
            n_features=20,
            n_informative=15,
            n_redundant=5,
            n_classes=3,
            random_state=42
        )
        
        # Create DataFrame
        feature_names = [f"feature_{i}" for i in range(X.shape[1])]
        data = pd.DataFrame(X, columns=feature_names)
        data['target'] = y
        
        return data
    
    def process_workflow_step(self, step_config: Dict[str, Any]) -> Dict[str, Any]:
        """Process a workflow step"""
        step_type = step_config.get("type", "full_pipeline")
        
        # Run pre-task hook
        self._run_hook(
            "pre-task",
            description=f"Foundation building - {step_type}",
            auto_spawn_agents="false"
        )
        
        result = {}
        
        try:
            if step_type == "dataset_analysis":
                result = self._process_dataset_analysis(step_config)
            elif step_type == "preprocessing":
                result = self._process_preprocessing(step_config)
            elif step_type == "baseline_training":
                result = self._process_baseline_training(step_config)
            elif step_type == "full_pipeline":
                result = self._process_full_pipeline(step_config)
            else:
                raise ValueError(f"Unknown step type: {step_type}")
            
            # Store result
            self._store_memory(
                f"agent/foundation_agent/{step_type}_result",
                result
            )
            
            # Run post-task hook
            self._run_hook(
                "post-task",
                task_id=self.agent_id,
                analyze_performance="true"
            )
            
        except Exception as e:
            result = {
                "status": "error",
                "error": str(e),
                "timestamp": datetime.now().isoformat()
            }
        
        return result
    
    def _process_dataset_analysis(self, config: Dict) -> Dict[str, Any]:
        """Process dataset analysis step"""
        # Load dataset
        dataset_path = config.get("dataset_path", "sample")
        target_column = config.get("target_column", "target")
        
        data = self.load_dataset(dataset_path)
        
        # Analyze dataset
        analysis = self.builder.analyze_dataset(data, target_column)
        
        return {
            "status": "completed",
            "analysis": analysis,
            "timestamp": datetime.now().isoformat()
        }
    
    def _process_preprocessing(self, config: Dict) -> Dict[str, Any]:
        """Process preprocessing step"""
        # Load dataset
        data = self.load_dataset(config.get("dataset_path", "sample"))
        target_column = config.get("target_column", "target")
        
        # Separate features and target
        X = data.drop(columns=[target_column])
        y = data[target_column]
        
        # Create preprocessing pipeline
        pipeline = self.builder.create_preprocessing_pipeline(X)
        
        return {
            "status": "completed",
            "pipeline_created": True,
            "feature_count": len(self.builder.feature_names),
            "timestamp": datetime.now().isoformat()
        }
    
    def _process_baseline_training(self, config: Dict) -> Dict[str, Any]:
        """Process baseline model training"""
        # Load dataset
        data = self.load_dataset(config.get("dataset_path", "sample"))
        target_column = config.get("target_column", "target")
        cv_folds = config.get("cv_folds", 5)
        
        # Separate features and target
        X = data.drop(columns=[target_column])
        y = data[target_column]
        
        # Train baseline models
        results = self.builder.train_baseline_models(X, y, cv_folds)
        
        # Create ensemble
        ensemble_result = self.builder.create_ensemble_baseline(X, y)
        
        return {
            "status": "completed",
            "models_trained": len(results),
            "best_model": results[0].model_name if results else None,
            "best_score": results[0].mean_cv_score if results else None,
            "ensemble_score": ensemble_result["cv_score"],
            "timestamp": datetime.now().isoformat()
        }
    
    def _process_full_pipeline(self, config: Dict) -> Dict[str, Any]:
        """Process full foundation pipeline"""
        # Run all steps
        results = {}
        
        # Dataset analysis
        analysis_result = self._process_dataset_analysis(config)
        results["analysis"] = analysis_result
        
        # Preprocessing
        preprocess_result = self._process_preprocessing(config)
        results["preprocessing"] = preprocess_result
        
        # Baseline training
        training_result = self._process_baseline_training(config)
        results["training"] = training_result
        
        # Save all results
        self.builder.save_results()
        report = self.builder.generate_report()
        
        return {
            "status": "completed",
            "steps_completed": len(results),
            "report": report,
            "results": results,
            "timestamp": datetime.now().isoformat()
        }
    
    def share_findings(self):
        """Share findings with other agents"""
        if self.builder and self.builder.baseline_results:
            # Prepare findings
            findings = {
                "agent": self.agent_id,
                "timestamp": datetime.now().isoformat(),
                "best_models": [],
                "preprocessing_steps": str(self.builder.preprocessing_pipeline),
                "recommendations": []
            }
            
            # Add top 3 models
            sorted_models = sorted(
                self.builder.baseline_results,
                key=lambda x: x.mean_cv_score,
                reverse=True
            )[:3]
            
            for model in sorted_models:
                findings["best_models"].append({
                    "name": model.model_name,
                    "score": model.mean_cv_score,
                    "std": model.std_cv_score,
                    "parameters": model.parameters
                })
            
            # Add recommendations
            report = self.builder.generate_report()
            findings["recommendations"] = report.get("recommendations", [])
            
            # Store in shared memory
            self._store_memory(
                f"workflow/{self.execution_id}/foundation_findings",
                findings
            )
            
            # Notify other agents
            self._run_hook(
                "notify",
                message=f"Foundation models complete. Best: {sorted_models[0].model_name} ({sorted_models[0].mean_cv_score:.4f})",
                telemetry="true"
            )
            
            return findings
        
        return None


def main():
    """Main entry point for foundation agent"""
    import argparse
    
    parser = argparse.ArgumentParser(description="Foundation Agent for MLE-STAR")
    parser.add_argument("--session-id", required=True, help="Session ID")
    parser.add_argument("--execution-id", required=True, help="Execution ID")
    parser.add_argument("--dataset", default="sample", help="Dataset path")
    parser.add_argument("--target", default="target", help="Target column name")
    parser.add_argument("--step", default="full_pipeline", help="Step to execute")
    
    args = parser.parse_args()
    
    # Initialize agent
    agent = FoundationAgentIntegration()
    agent.initialize_session(args.session_id, args.execution_id)
    
    # Check for research findings
    print("Checking for research findings...")
    research = agent.check_research_findings()
    if research:
        print(f"✓ Loaded research findings from search agent")
    
    # Process workflow step
    config = {
        "type": args.step,
        "dataset_path": args.dataset,
        "target_column": args.target
    }
    
    print(f"\nProcessing {args.step}...")
    result = agent.process_workflow_step(config)
    
    if result["status"] == "completed":
        print(f"✓ {args.step} completed successfully")
        
        # Share findings
        agent.share_findings()
        print("✓ Findings shared with other agents")
    else:
        print(f"✗ Error: {result.get('error', 'Unknown error')}")
    
    print(f"\nResults: {json.dumps(result, indent=2)}")


if __name__ == "__main__":
    main()