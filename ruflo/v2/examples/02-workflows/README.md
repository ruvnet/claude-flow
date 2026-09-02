# Workflow Examples

This directory contains multi-agent workflow definitions demonstrating various coordination patterns and use cases.

## Directory Structure

```
02-workflows/
├── simple/         # Basic workflows for learning
├── parallel/       # Parallel execution patterns
├── sequential/     # Step-by-step workflows
├── complex/        # Advanced multi-agent systems
├── specialized/    # Domain-specific workflows
├── claude-workflow.json      # Original development workflow
└── research-workflow.json    # Original research pipeline
```

## Workflow Categories

### Simple Workflows (`simple/`)
- **hello-world-workflow.json**: Single-agent starter workflow
  ```bash
  cd examples
  ../claude-flow swarm create "Build hello world app" --output ./output/hello-world
  ```

### Parallel Workflows (`parallel/`)
- **data-processing-workflow.json**: Process multiple data sources simultaneously
  ```bash
  ../claude-flow swarm create "Process CSV, JSON, and XML data in parallel" --agents 4 --output ./output/data-processing
  ```

### Sequential Workflows (`sequential/`)
- **blog-platform-workflow.json**: Step-by-step blog platform development
  ```bash
  ../claude-flow swarm create "Build complete blog platform with authentication" --strategy development --output ./output/blog
  ```

### Complex Workflows (`complex/`)
- **microservices-workflow.json**: Complete microservices architecture with 8 agents
  - System design → Service development → Frontend → DevOps → Testing
  - Smart execution with checkpoints and rollback
  ```bash
  ../claude-flow swarm create "Build microservices e-commerce platform" --agents 8 --output ./output/microservices
  ```

### Specialized Workflows (`specialized/`)
- **machine-learning-workflow.json**: End-to-end ML pipeline
  - Data prep → Feature engineering → Model research → Training → Deployment
  - Experiment tracking and model versioning
  ```bash
  ../claude-flow swarm create "Build machine learning pipeline for customer churn prediction" --strategy analysis --output ./output/ml-pipeline
  ```

## Legacy Workflows

### claude-workflow.json
Original multi-agent development workflow example

### research-workflow.json
Original AI research pipeline example

## Workflow Structure

### Agents Section
```json
"agents": [
  {
    "id": "agent-name",
    "type": "researcher|developer|tester",
    "capabilities": ["research", "code-generation", "testing"],
    "configuration": { ... }
  }
]
```

### Tasks Section
```json
"tasks": [
  {
    "id": "task-id",
    "agentId": "agent-name",
    "type": "research|coding|analysis",
    "dependencies": ["previous-task-id"],
    "parallel": true|false
  }
]
```

## Running Workflows

```bash
# Execute a workflow
npx claude-flow orchestrate ./claude-workflow.json

# With monitoring
npx claude-flow orchestrate ./research-workflow.json --monitor

# In background
npx claude-flow orchestrate ./claude-workflow.json --background
```

## Creating Custom Workflows

1. Define your agents with specific capabilities
2. Create tasks assigned to appropriate agents
3. Set up dependencies between tasks
4. Configure parallel execution where possible
5. Add quality thresholds and validation steps