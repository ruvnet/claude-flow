#!/usr/bin/env python3
"""
Download official SWE-bench datasets from HuggingFace
"""

import os
import json
from pathlib import Path
from datasets import load_dataset
import argparse


def download_swebench_datasets():
    """Download official SWE-bench datasets."""
    
    print("="*60)
    print("SWE-bench Official Dataset Downloader")
    print("="*60)
    
    # Create data directory
    data_dir = Path("data")
    data_dir.mkdir(exist_ok=True)
    
    # Download SWE-bench-Lite (300 instances for faster evaluation)
    print("\n📥 Downloading SWE-bench-Lite (300 instances)...")
    try:
        dataset_lite = load_dataset("princeton-nlp/SWE-bench_Lite", split="test")
        print(f"✅ Loaded {len(dataset_lite)} SWE-bench-Lite instances")
        
        # Save to disk
        dataset_lite.save_to_disk(data_dir / "swe-bench-lite")
        
        # Save as JSON for easier access
        lite_data = []
        for instance in dataset_lite:
            lite_data.append({
                "instance_id": instance["instance_id"],
                "repo": instance["repo"],
                "base_commit": instance["base_commit"],
                "problem_statement": instance["problem_statement"],
                "hints_text": instance.get("hints_text", ""),
                "test_patch": instance["test_patch"],
                "created_at": instance["created_at"],
            })
        
        with open(data_dir / "swe-bench-lite.json", "w") as f:
            json.dump(lite_data, f, indent=2)
            
        print(f"✅ Saved SWE-bench-Lite to {data_dir}/swe-bench-lite/")
        
    except Exception as e:
        print(f"❌ Error downloading SWE-bench-Lite: {e}")
        print("Please install: pip install datasets")
        return False
    
    # Optionally download full SWE-bench (2,294 instances)
    print("\n📥 Downloading full SWE-bench dataset info...")
    try:
        dataset_full = load_dataset("princeton-nlp/SWE-bench", split="test", streaming=True)
        
        # Just get first few instances for reference
        full_sample = []
        for i, instance in enumerate(dataset_full):
            if i >= 5:  # Just sample for reference
                break
            full_sample.append({
                "instance_id": instance["instance_id"],
                "repo": instance["repo"],
                "problem_statement": instance["problem_statement"][:200] + "..."
            })
        
        with open(data_dir / "swe-bench-full-sample.json", "w") as f:
            json.dump(full_sample, f, indent=2)
            
        print("✅ Downloaded SWE-bench dataset samples")
        
    except Exception as e:
        print(f"⚠️ Could not download full dataset samples: {e}")
    
    # Download oracle patches (ground truth)
    print("\n📥 Downloading oracle patches...")
    try:
        oracle_dataset = load_dataset("princeton-nlp/SWE-bench_oracle", split="test")
        print(f"✅ Loaded {len(oracle_dataset)} oracle patches")
        
        oracle_data = {}
        for instance in oracle_dataset:
            oracle_data[instance["instance_id"]] = {
                "patch": instance["patch"],
                "test_patch": instance.get("test_patch", "")
            }
        
        with open(data_dir / "oracle_patches.json", "w") as f:
            json.dump(oracle_data, f, indent=2)
            
        print(f"✅ Saved oracle patches to {data_dir}/oracle_patches.json")
        
    except Exception as e:
        print(f"⚠️ Could not download oracle patches: {e}")
    
    print("\n" + "="*60)
    print("✅ Dataset download complete!")
    print("="*60)
    print("\nDatasets available:")
    print("  - SWE-bench-Lite: 300 instances (recommended for testing)")
    print("  - Oracle patches: Ground truth solutions")
    print("\nNext steps:")
    print("  1. Run: python setup_evaluation.py")
    print("  2. Run: python run_swebench.py --dataset lite")
    
    return True


def main():
    parser = argparse.ArgumentParser(description="Download SWE-bench datasets")
    parser.add_argument("--full", action="store_true", help="Download full dataset (2,294 instances)")
    args = parser.parse_args()
    
    success = download_swebench_datasets()
    
    if not success:
        print("\n⚠️ Some datasets could not be downloaded.")
        print("Make sure you have installed: pip install datasets")
        exit(1)


if __name__ == "__main__":
    main()