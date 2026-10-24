# Official SWE-bench Integration for Claude Flow

This is the OFFICIAL SWE-bench integration for creating verified submissions to the [SWE-bench leaderboard](https://www.swebench.com/).

## Overview

SWE-bench is a benchmark for evaluating large language models on real-world software engineering tasks from GitHub issues.

- **Dataset**: 2,294 GitHub issues from 12 Python repositories
- **Task**: Generate a patch that resolves the issue
- **Evaluation**: Run repository test suite to verify the fix

## Components

1. **SWE-bench-Lite**: Subset of 300 instances for faster evaluation
2. **Test Harness**: Official evaluation framework
3. **Claude Flow Agent**: Our implementation for solving SWE-bench tasks

## Installation

```bash
# Install official SWE-bench
pip install datasets swebench

# Download SWE-bench-Lite dataset
python download_swebench.py

# Setup evaluation environment
python setup_evaluation.py
```

## Running Evaluations

```bash
# Run on SWE-bench-Lite (300 instances)
python run_swebench.py --dataset lite --model claude-flow

# Run on specific instance
python run_swebench.py --instance "django__django-11099"

# Generate submission file
python generate_submission.py --output predictions.json
```

## Submission Format

The submission must be a `predictions.json` file with format:
```json
{
  "instance_id": {
    "model_patch": "diff --git a/file.py b/file.py\n...",
    "model_name_or_path": "claude-flow"
  }
}
```

## Evaluation Metrics

- **Resolved**: % of instances where tests pass with the patch
- **Applied**: % of instances where patch applies cleanly
- **Generated**: % of instances where valid patch is generated

## Directory Structure

```
swe-bench-official/
├── download_swebench.py      # Download official dataset
├── setup_evaluation.py        # Setup test environment
├── run_swebench.py           # Main runner
├── claude_flow_agent.py      # Claude Flow SWE-bench agent
├── generate_submission.py    # Create submission file
├── data/                     # Downloaded datasets
├── predictions/              # Generated predictions
└── logs/                     # Execution logs
```