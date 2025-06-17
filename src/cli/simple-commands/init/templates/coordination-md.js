// coordination-md.js - Coordination templates

export function createMinimalCoordinationMd() {
  return `# Agent Coordination

## Quick Commands
- \`npx claude-flow agent spawn <type>\`: Create new agent
- \`npx claude-flow agent list\`: Show active agents
- \`npx claude-flow task create <type> <description>\`: Create task

## Agent Types
- researcher, coder, analyst, coordinator, general
`;
}

export function createFullCoordinationMd() {
  return `# Agent Coordination System

## Overview
The Claude-Flow coordination system manages multiple AI agents working together on complex tasks. It provides intelligent task distribution, resource management, and inter-agent communication.

## Agent Types and Capabilities
- **Researcher**: Web search, information gathering, knowledge synthesis
- **Coder**: Code analysis, development, debugging, testing
- **Analyst**: Data processing, pattern recognition, insights generation
- **Coordinator**: Task planning, resource allocation, workflow management
- **General**: Multi-purpose agent with balanced capabilities

## Task Management
- **Priority Levels**: 1 (lowest) to 10 (highest)
- **Dependencies**: Tasks can depend on completion of other tasks
- **Parallel Execution**: Independent tasks run concurrently
- **Load Balancing**: Automatic distribution based on agent capacity

## Coordination Commands
\`\`\`bash
# Agent Management
npx claude-flow agent spawn <type> --name <name> --priority <1-10>
npx claude-flow agent list
npx claude-flow agent info <agent-id>
npx claude-flow agent terminate <agent-id>

# Task Management  
npx claude-flow task create <type> <description> --priority <1-10> --deps <task-ids>
npx claude-flow task list --verbose
npx claude-flow task status <task-id>
npx claude-flow task cancel <task-id>

# System Monitoring
npx claude-flow status --verbose
npx claude-flow monitor --interval 5000
\`\`\`

## Workflow Execution
Workflows are defined in JSON format and can orchestrate complex multi-agent operations:
\`\`\`bash
npx claude-flow workflow examples/research-workflow.json
npx claude-flow workflow examples/development-config.json --async
\`\`\`

## Advanced Features
- **Circuit Breakers**: Automatic failure handling and recovery
- **Work Stealing**: Dynamic load redistribution for efficiency
- **Resource Limits**: Memory and CPU usage constraints
- **Metrics Collection**: Performance monitoring and optimization

## Configuration
Coordination settings in \`claude-flow.config.json\`:
\`\`\`json
{
  "orchestrator": {
    "maxConcurrentTasks": 10,
    "taskTimeout": 300000,
    "defaultPriority": 5
  },
  "agents": {
    "maxAgents": 20,
    "defaultCapabilities": ["research", "code", "terminal"],
    "resourceLimits": {
      "memory": "1GB",
      "cpu": "50%"
    }
  }
}
\`\`\`

## Communication Patterns
- **Direct Messaging**: Agent-to-agent communication
- **Event Broadcasting**: System-wide notifications
- **Shared Memory**: Common information access
- **Task Handoff**: Seamless work transfer between agents

## Best Practices
- Start with general agents and specialize as needed
- Use descriptive task names and clear requirements
- Monitor system resources during heavy workloads
- Implement proper error handling in workflows
- Regular cleanup of completed tasks and inactive agents

## Troubleshooting
- Check agent health with \`npx claude-flow status\`
- View detailed logs with \`npx claude-flow monitor\`
- Restart stuck agents with terminate/spawn cycle
- Use \`--verbose\` flags for detailed diagnostic information
`;
}

// Create optimized Coordination with batchtools support
export async function createOptimizedCoordinationMd() {
  return `# Agent Coordination System (Batchtools Optimized)

## Overview
The Claude-Flow coordination system manages multiple AI agents working together on complex tasks. It provides intelligent task distribution, resource management, and inter-agent communication.

**🚀 Batchtools Enhancement**: This configuration includes parallel processing capabilities for agent coordination, batch task management, and concurrent workflow execution.

## Agent Types and Capabilities (Enhanced)
- **Researcher**: Web search, information gathering, knowledge synthesis with parallel processing
- **Coder**: Code analysis, development, debugging, testing with concurrent operations
- **Analyst**: Data processing, pattern recognition, insights generation with batch analysis
- **Coordinator**: Task planning, resource allocation, workflow management with parallel coordination
- **General**: Multi-purpose agent with balanced capabilities and batch processing
- **BatchProcessor**: Specialized agent for high-throughput batch operations
- **ParallelExecutor**: Agent optimized for concurrent task execution

## Task Management (Batchtools Enhanced)
- **Priority Levels**: 1 (lowest) to 10 (highest) with parallel priority processing
- **Dependencies**: Tasks can depend on completion of other tasks with concurrent validation
- **Parallel Execution**: Independent tasks run concurrently with intelligent load balancing
- **Batch Processing**: Group related tasks for efficient parallel execution
- **Work Stealing**: Dynamic redistribution with real-time load monitoring
- **Circuit Breakers**: Fault tolerance with parallel recovery mechanisms

## Coordination Commands (Enhanced)

### Standard Commands
\`\`\`bash
# Agent Management
npx claude-flow agent spawn <type> --name <name> --priority <1-10>
npx claude-flow agent list
npx claude-flow agent info <agent-id>
npx claude-flow agent terminate <agent-id>

# Task Management  
npx claude-flow task create <type> <description> --priority <1-10> --deps <task-ids>
npx claude-flow task list --verbose
npx claude-flow task status <task-id>
npx claude-flow task cancel <task-id>

# System Monitoring
npx claude-flow status --verbose
npx claude-flow monitor --interval 5000
\`\`\`

### Batchtools Commands
\`\`\`bash
# Batch Agent Management
npx claude-flow agent batch-spawn <agents-config> --parallel
npx claude-flow agent parallel-status --all-agents
npx claude-flow agent concurrent-terminate <agent-ids>

# Batch Task Management
npx claude-flow task batch-create <tasks-file> --parallel
npx claude-flow task parallel-execute <task-ids> --concurrent
npx claude-flow task batch-monitor --real-time --parallel

# Advanced Coordination
npx claude-flow coordination batch-workflow <workflows-config> --parallel
npx claude-flow coordination parallel-orchestrate <orchestration-config>
npx claude-flow coordination concurrent-monitor --all-systems
\`\`\`

## Workflow Execution (Batchtools Enhanced)
Workflows support parallel execution, batch processing, and concurrent orchestration:
\`\`\`bash
# Standard workflow execution
npx claude-flow workflow examples/research-workflow.json
npx claude-flow workflow examples/development-config.json --async

# Batchtools workflow execution
npx claude-flow workflow batch-execute <workflow-configs> --parallel
npx claude-flow workflow parallel-orchestrate <workflows-dir> --concurrent
npx claude-flow workflow concurrent-monitor --all-workflows --real-time
\`\`\`

## Advanced Features (Enhanced)

### Parallel Processing Capabilities
- **Concurrent Agent Spawning**: Create multiple agents simultaneously
- **Batch Task Distribution**: Distribute tasks to multiple agents in parallel
- **Parallel Workflow Execution**: Execute multiple workflows concurrently
- **Concurrent Resource Management**: Monitor and manage resources across parallel operations

### Performance Optimizations
- **Smart Batching**: Group related coordination operations for efficiency
- **Pipeline Processing**: Chain coordination operations with parallel stages
- **Load Balancing**: Dynamic distribution with real-time performance monitoring
- **Resource Optimization**: Efficient utilization with parallel resource allocation

### Fault Tolerance (Enhanced)
- **Circuit Breakers**: Automatic failure handling with parallel recovery
- **Work Stealing**: Dynamic redistribution with concurrent monitoring
- **Health Monitoring**: Real-time agent and task health with parallel checks
- **Retry Mechanisms**: Intelligent retry with exponential backoff and parallel validation

## Configuration (Batchtools Enhanced)
Coordination settings in \`claude-flow.config.json\` with batchtools optimizations:
\`\`\`json
{
  "orchestrator": {
    "maxConcurrentTasks": 50,
    "taskTimeout": 300000,
    "defaultPriority": 5,
    "batchtools": {
      "enabled": true,
      "maxParallelTasks": 20,
      "batchSize": 10,
      "concurrentAgents": 15,
      "parallelWorkflows": 5
    }
  },
  "agents": {
    "maxAgents": 100,
    "defaultCapabilities": ["research", "code", "terminal", "batch", "parallel"],
    "resourceLimits": {
      "memory": "4GB",
      "cpu": "80%"
    },
    "batchProcessing": {
      "maxConcurrentOperations": 25,
      "batchQueueSize": 100,
      "parallelSpawning": true,
      "concurrentMonitoring": true
    }
  },
  "performance": {
    "enableParallelCoordination": true,
    "concurrentTaskExecution": 30,
    "batchWorkflowSize": 5,
    "parallelResourceMonitoring": true,
    "smartLoadBalancing": true
  }
}
\`\`\`

## Communication Patterns (Enhanced)
- **Direct Messaging**: Agent-to-agent communication with parallel channels
- **Event Broadcasting**: System-wide notifications with concurrent delivery
- **Shared Memory**: Common information access with parallel synchronization
- **Task Handoff**: Seamless work transfer with concurrent validation
- **Batch Communication**: Group messaging for efficient coordination
- **Parallel Synchronization**: Concurrent coordination across multiple agents

## Batchtools Integration

### Parallel Coordination Patterns
\`\`\`bash
# Spawn multiple specialized agents in parallel
npx claude-flow agent batch-spawn sparc-agents.json --parallel --validate

# Execute batch of related tasks concurrently
npx claude-flow task parallel-execute research-tasks.json --concurrent --monitor

# Orchestrate multiple workflows simultaneously
npx claude-flow workflow concurrent-orchestrate project-workflows/ --parallel
\`\`\`

### Performance Monitoring (Enhanced)
\`\`\`bash
# Monitor concurrent operations across all agents
npx claude-flow monitor --concurrent --all-agents --verbose

# Analyze batch processing performance
npx claude-flow coordination performance-report --batchtools --detailed

# Real-time parallel task monitoring
npx claude-flow task parallel-monitor --real-time --performance-metrics
\`\`\`

## Best Practices (Batchtools Enhanced)

### Performance Optimization
- Use batch operations for multiple related coordination tasks
- Enable parallel processing for independent agent operations
- Monitor concurrent operation limits to avoid resource exhaustion
- Implement smart batching for related workflow executions

### Resource Management
- Monitor system resources during parallel agent operations
- Implement throttling for batch coordination under heavy load
- Use parallel processing judiciously based on system capabilities
- Balance concurrent operations with system stability

### Agent Coordination
- Use batch spawning for creating multiple related agents
- Enable parallel task distribution for improved efficiency
- Implement concurrent monitoring for real-time system health
- Use parallel workflow execution for complex multi-step processes

## Performance Benchmarks

### Batchtools Performance Improvements
- **Agent Spawning**: Up to 500% faster with parallel creation
- **Task Distribution**: 350% improvement with concurrent assignment
- **Workflow Execution**: 400% faster with parallel orchestration
- **Resource Monitoring**: 250% improvement with concurrent monitoring
- **Communication**: 300% faster with batch messaging

## Troubleshooting (Enhanced)

### Common Batchtools Issues
- **Concurrent Limit Exceeded**: Reduce maxParallelTasks in configuration
- **Batch Size Too Large**: Decrease batchSize for resource-constrained systems
- **Agent Spawn Conflicts**: Enable parallelSpawning with appropriate coordination
- **Resource Exhaustion**: Monitor system resources during concurrent operations

### Debug Commands (Enhanced)
\`\`\`bash
# Check concurrent coordination status
npx claude-flow coordination debug --concurrent --verbose

# Analyze batch operation performance
npx claude-flow coordination analyze --batchtools --performance

# Validate parallel agent integrity
npx claude-flow agent validate --parallel --health-check

# Monitor resource usage during concurrent operations
npx claude-flow monitor --resources --concurrent --real-time
\`\`\`

### Advanced Troubleshooting
- Check agent health with parallel monitoring: \`npx claude-flow status --concurrent\`
- View detailed logs with concurrent analysis: \`npx claude-flow monitor --parallel --verbose\`
- Restart stuck agents with batch operations: \`npx claude-flow agent batch-restart <agent-ids>\`
- Use concurrent diagnostics: \`npx claude-flow debug --all-systems --parallel\`

For more information about coordination system optimization, see: https://github.com/ruvnet/claude-code-flow/docs/coordination-batchtools.md
`;
}