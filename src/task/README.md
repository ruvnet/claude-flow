# Task Management System

Comprehensive task management with orchestration features for Claude-Flow. Integrates seamlessly with TodoWrite/TodoRead for coordination and Memory for state persistence.

## Features

### Core Task Management
- **Dependencies**: Complex dependency relationships (finish-to-start, start-to-start, etc.)
- **Priority System**: 0-100 priority scoring with intelligent scheduling
- **Resource Management**: CPU, memory, disk, network resource allocation
- **Scheduling**: Start times, deadlines, recurring tasks, timezone support
- **Retry Policies**: Configurable retry with exponential backoff
- **Checkpoints**: Automatic checkpoint creation for rollback capability
- **Progress Tracking**: Real-time progress monitoring with metrics

### Orchestration Features
- **TodoWrite Integration**: Automatic task breakdown using TodoWrite patterns
- **Memory Coordination**: Cross-agent state sharing via Memory tools
- **Batch Operations**: Parallel file operations and tool coordination
- **Agent Launching**: Task tool pattern for parallel agent execution
- **Swarm Coordination**: Multiple coordination patterns (centralized, distributed, hierarchical, mesh, hybrid)

### Workflow Management
- **Parallel Processing**: Configurable parallelism strategies
- **Error Handling**: Fail-fast, continue-on-error, retry-failed patterns
- **Dependency Visualization**: ASCII, DOT, JSON graph formats
- **Workflow Variables**: Dynamic variable injection
- **Execution Monitoring**: Real-time progress tracking

## Architecture

```
Task Management System
├── TaskEngine (Core)
│   ├── Task Creation & Management
│   ├── Dependency Resolution
│   ├── Resource Allocation
│   ├── Execution Orchestration
│   └── Progress Tracking
├── TaskCoordinator (Orchestration)
│   ├── TodoWrite/TodoRead Integration
│   ├── Memory Coordination
│   ├── Batch Operations
│   ├── Agent Launching
│   └── Swarm Patterns
└── Commands (CLI)
    ├── task create
    ├── task list
    ├── task status
    ├── task cancel
    └── task workflow
```

## Usage

### Basic Task Creation

```typescript
import { TaskEngine, TaskCoordinator } from './task';

const engine = new TaskEngine(10); // max 10 concurrent tasks
const coordinator = new TaskCoordinator(engine, memoryManager);

// Create a task with dependencies
const task = await engine.createTask({
  type: 'development',
  description: 'Implement user authentication',
  priority: 80,
  dependencies: [
    { taskId: 'design-task-123', type: 'finish-to-start' }
  ],
  resourceRequirements: [
    { resourceId: 'cpu', type: 'cpu', amount: 2, unit: 'cores' },
    { resourceId: 'memory', type: 'memory', amount: 1024, unit: 'MB' }
  ],
  schedule: {
    deadline: new Date('2024-02-15T18:00:00Z')
  },
  tags: ['auth', 'security', 'backend']
});
```

### TodoWrite Integration

```typescript
// Create comprehensive task breakdown
const todos = await coordinator.createTaskTodos(
  "Build e-commerce platform",
  {
    strategy: 'development',
    batchOptimized: true,
    parallelExecution: true,
    memoryCoordination: true
  },
  context
);

// Todos automatically include:
// - System architecture design (high priority)
// - Frontend development (parallel execution)
// - Backend development (parallel execution)
// - Testing and integration (depends on frontend/backend)
```

### Parallel Agent Launching

```typescript
// Launch coordinated agents using Task tool pattern
const agentIds = await coordinator.launchParallelAgents([
  {
    agentType: 'researcher',
    objective: 'Research microservices patterns',
    mode: 'researcher',
    memoryKey: 'microservices_research',
    batchOptimized: true
  },
  {
    agentType: 'architect',
    objective: 'Design system architecture',
    mode: 'architect',
    memoryKey: 'system_architecture',
    batchOptimized: true
  },
  {
    agentType: 'coder',
    objective: 'Implement core services',
    mode: 'coder',
    memoryKey: 'core_implementation',
    batchOptimized: true
  }
], context);
```

### Memory Coordination

```typescript
// Store findings for cross-agent coordination
await coordinator.storeInMemory(
  'research_findings',
  {
    bestPractices: ['microservices', 'event-driven'],
    technologies: ['nodejs', 'redis', 'postgresql'],
    patterns: ['saga', 'cqrs', 'event-sourcing']
  },
  {
    namespace: 'project_coordination',
    tags: ['research', 'architecture']
  }
);

// Other agents can retrieve and use this data
const findings = await coordinator.retrieveFromMemory(
  'research_findings',
  'project_coordination'
);
```

### Batch Operations

```typescript
// Coordinate multiple operations for efficiency
const results = await coordinator.coordinateBatchOperations([
  {
    type: 'read',
    targets: ['src/**/*.ts'],
    configuration: { pattern: 'class.*{' }
  },
  {
    type: 'search',
    targets: ['docs/**/*.md'],
    configuration: { term: 'API documentation' }
  },
  {
    type: 'analyze',
    targets: ['package.json', 'tsconfig.json'],
    configuration: { focus: 'dependencies' }
  }
], context);
```

## CLI Commands

### Task Create
```bash
# Create comprehensive task with all options
claude-flow task create development "Implement authentication" \
  --priority 80 \
  --dependencies "task-123,task-456" \
  --dep-type finish-to-start \
  --assign backend-team \
  --tags "auth,security,backend" \
  --deadline "2024-02-15T18:00:00Z" \
  --cpu 2 \
  --memory 1024 \
  --max-retries 5 \
  --rollback previous-checkpoint
```

### Task List
```bash
# List with advanced filtering and visualization
claude-flow task list \
  --status running,pending \
  --priority 70-100 \
  --tags auth,security \
  --sort deadline \
  --sort-dir asc \
  --format table \
  --show-dependencies \
  --show-progress \
  --limit 20
```

### Task Status
```bash
# Detailed status with all metrics
claude-flow task status task-789 \
  --show-logs \
  --show-checkpoints \
  --show-metrics \
  --show-dependencies \
  --show-resources \
  --watch
```

### Task Cancel
```bash
# Safe cancellation with rollback
claude-flow task cancel task-789 \
  --reason "Requirements changed" \
  --cascade \
  --dry-run
```

### Workflow Management
```bash
# Create workflow
claude-flow task workflow create "E-commerce Platform" \
  --description "Complete development workflow" \
  --max-concurrent 8 \
  --strategy priority-based \
  --error-handling continue-on-error

# Execute workflow with monitoring
claude-flow task workflow execute workflow-123 \
  --variables '{"environment":"staging"}' \
  --monitor

# Visualize dependency graph
claude-flow task workflow visualize workflow-123 \
  --format dot \
  --output workflow-graph.dot
```

## Coordination Patterns

### Centralized
Single coordinator manages all agents:
```typescript
await coordinator.coordinateSwarm(
  "Development project",
  { coordinationMode: 'centralized' },
  agents
);
```

### Distributed
Multiple coordinators for different aspects:
```typescript
await coordinator.coordinateSwarm(
  "Complex system development",
  { coordinationMode: 'distributed' },
  agents
);
```

### Hierarchical
Tree structure with team leads:
```typescript
await coordinator.coordinateSwarm(
  "Enterprise development",
  { coordinationMode: 'hierarchical' },
  agents
);
```

### Mesh
Peer-to-peer coordination:
```typescript
await coordinator.coordinateSwarm(
  "Adaptive development",
  { coordinationMode: 'mesh' },
  agents
);
```

### Hybrid
Mixed patterns based on requirements:
```typescript
await coordinator.coordinateSwarm(
  "Complex adaptive project",
  { coordinationMode: 'hybrid' },
  agents
);
```

## Integration with Claude Code Batch Tools

The task management system is designed to work seamlessly with Claude Code's batch tools:

### TodoWrite/TodoRead
- Automatic task breakdown using TodoWrite patterns
- Real-time progress tracking via TodoRead
- Cross-session persistence and coordination

### Memory Tools
- Persistent state storage across agents
- Knowledge sharing between coordinated tasks
- Cross-session information retrieval

### Task Tool
- Parallel agent launching and coordination
- Resource-aware task distribution
- Swarm orchestration patterns

### Batch Operations
- Coordinated file operations (Read, Write, Edit)
- Parallel search operations (Glob, Grep)
- Efficient tool utilization

## Best Practices

### Task Design
1. **Break down complex objectives** into smaller, manageable tasks
2. **Use dependencies** to ensure proper execution order
3. **Set realistic priorities** based on business impact
4. **Define resource requirements** to prevent conflicts
5. **Include checkpoints** for rollback capability

### Coordination
1. **Use TodoWrite** for comprehensive task planning
2. **Store shared data** in Memory for cross-agent access
3. **Leverage batch operations** for efficiency
4. **Choose coordination patterns** based on complexity
5. **Monitor progress** with real-time status updates

### Performance
1. **Enable parallel execution** where possible
2. **Optimize resource allocation** to prevent bottlenecks
3. **Use batch operations** to minimize tool calls
4. **Implement proper retry policies** for resilience
5. **Monitor metrics** for optimization opportunities

## Error Handling

### Retry Policies
```typescript
retryPolicy: {
  maxAttempts: 3,
  backoffMs: 1000,
  backoffMultiplier: 2
}
```

### Rollback Strategies
- `previous-checkpoint`: Roll back to last checkpoint
- `initial-state`: Roll back to task start
- `custom`: Use custom rollback handler

### Error Propagation
- Configurable error handling per workflow
- Dependent task cancellation options
- Resource cleanup on failure

## Monitoring and Metrics

### Task Metrics
- CPU and memory usage
- Disk and network I/O
- Custom performance metrics
- Progress tracking

### Workflow Metrics
- Overall completion percentage
- Resource utilization
- Bottleneck identification
- Performance optimization

### Real-time Monitoring
- Live progress updates
- Resource allocation status
- Dependency satisfaction
- Error tracking

## Examples

See the [examples directory](./examples/) for comprehensive usage examples including:
- Basic task management
- Complex workflow orchestration
- Cross-agent coordination
- Batch operation optimization
- Swarm coordination patterns

## API Reference

Detailed API documentation is available in the [API docs](./docs/api.md).

## Contributing

See [CONTRIBUTING.md](../../CONTRIBUTING.md) for guidelines on contributing to the task management system.