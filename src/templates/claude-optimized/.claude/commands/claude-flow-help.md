---
name: claude-flow-help
description: Show Claude-Flow commands and usage with batchtools optimization
---

# Claude-Flow Commands (Batchtools Optimized)

## Core Commands with Batch Operations

### System Management (Batch Operations)
- `npx claude-flow start` - Start orchestration system
- `npx claude-flow status` - Check system status
- `npx claude-flow monitor` - Real-time monitoring
- `npx claude-flow stop` - Stop orchestration

**Batch Operations:**
```bash
# Check multiple system components in parallel
npx claude-flow batch status --components "agents,tasks,memory,connections"

# Start multiple services concurrently
npx claude-flow batch start --services "monitor,scheduler,coordinator"
```

### Agent Management (Parallel Operations)
- `npx claude-flow agent spawn <type>` - Create new agent
- `npx claude-flow agent list` - List active agents
- `npx claude-flow agent info <id>` - Agent details
- `npx claude-flow agent terminate <id>` - Stop agent

**Batch Operations:**
```bash
# Spawn multiple agents in parallel
npx claude-flow agent batch-spawn "code:3,test:2,review:1"

# Get info for multiple agents concurrently
npx claude-flow agent batch-info "agent1,agent2,agent3"

# Terminate multiple agents
npx claude-flow agent batch-terminate --pattern "test-*"
```

### Task Management (Concurrent Processing)
- `npx claude-flow task create <type> "description"` - Create task
- `npx claude-flow task list` - List all tasks
- `npx claude-flow task status <id>` - Task status
- `npx claude-flow task cancel <id>` - Cancel task

**Batch Operations:**
```bash
# Create multiple tasks from file
npx claude-flow task batch-create tasks.json

# Check status of multiple tasks concurrently
npx claude-flow task batch-status --ids "task1,task2,task3"

# Process task queue in parallel
npx claude-flow task process-queue --parallel 5
```

### Memory Operations (Bulk Processing)
- `npx claude-flow memory store "key" "value"` - Store data
- `npx claude-flow memory query "search"` - Search memory
- `npx claude-flow memory stats` - Memory statistics
- `npx claude-flow memory export <file>` - Export memory

**Batch Operations:**
```bash
# Bulk store from JSON file
npx claude-flow memory batch-store data.json

# Parallel query across namespaces
npx claude-flow memory batch-query "search term" --namespaces "all"

# Export multiple namespaces concurrently
npx claude-flow memory batch-export --namespaces "project,agents,tasks"
```

### SPARC Development (Parallel Workflows)
- `npx claude-flow sparc modes` - List SPARC modes
- `npx claude-flow sparc run <mode> "task"` - Run mode
- `npx claude-flow sparc tdd "feature"` - TDD workflow
- `npx claude-flow sparc info <mode>` - Mode details

**Batch Operations:**
```bash
# Run multiple SPARC modes in parallel
npx claude-flow sparc batch-run --modes "spec:task1,architect:task2,code:task3"

# Execute parallel TDD for multiple features
npx claude-flow sparc batch-tdd features.json

# Analyze multiple components concurrently
npx claude-flow sparc batch-analyze --components "auth,api,database"
```

### Swarm Coordination (Enhanced Parallelization)
- `npx claude-flow swarm "task" --strategy <type>` - Start swarm
- `npx claude-flow swarm "task" --background` - Long-running swarm
- `npx claude-flow swarm "task" --monitor` - With monitoring

**Batch Operations:**
```bash
# Launch multiple swarms for different components
npx claude-flow swarm batch --config swarms.json

# Coordinate parallel swarm strategies
npx claude-flow swarm multi-strategy "project" --strategies "dev:frontend,test:backend,docs:api"
```

## Advanced Batch Examples

### Parallel Development Workflow:
```bash
# Initialize complete project setup in parallel
npx claude-flow batch init --actions "memory:setup,agents:spawn,tasks:queue"

# Run comprehensive analysis
npx claude-flow batch analyze --targets "code:quality,security:audit,performance:profile"
```

### Concurrent Testing Suite:
```bash
# Execute parallel test suites
npx claude-flow sparc batch-test --suites "unit,integration,e2e" --parallel

# Generate reports concurrently
npx claude-flow batch report --types "coverage,performance,security"
```

### Bulk Operations:
```bash
# Process multiple files in parallel
npx claude-flow batch process --files "*.ts" --action "lint,format,analyze"

# Parallel code generation
npx claude-flow batch generate --templates "api:users,api:products,api:orders"
```

## Performance Tips
- Use `--parallel` flag for concurrent operations
- Batch similar operations to reduce overhead
- Leverage `--async` for non-blocking execution
- Use `--stream` for real-time progress updates
- Enable `--cache` for repeated operations

## Monitoring Batch Operations
```bash
# Real-time batch monitoring
npx claude-flow monitor --batch

# Batch operation statistics
npx claude-flow stats --batch-ops

# Performance profiling
npx claude-flow profile --batch-execution
```