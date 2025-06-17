# Claude Code Configuration

## Build Commands
- `npm run build`: Build the project
- `npm run test`: Run the full test suite
- `npm run lint`: Run ESLint and format checks
- `npm run typecheck`: Run TypeScript type checking
- `./claude-flow --help`: Show all available commands

## Batch Tools and Orchestration
This project is configured for advanced Claude Code batch operations and swarm orchestration:

### Batch Tool Usage Guidelines
- **Always use TodoWrite** at the start of complex operations for task coordination
- **Use Task tool** to launch parallel agents for independent work streams
- **Store results in Memory** for cross-agent coordination and knowledge sharing
- **Batch file operations** when reading/writing multiple files for efficiency
- **Use parallel execution** whenever possible with batch tool coordination

### Todo Tools for Advanced Orchestration
TodoWrite and TodoRead are the foundation of all swarm operations:

```javascript
// Example: Comprehensive task breakdown for development
TodoWrite([
  {
    id: "architecture_design",
    content: "Design system architecture and component interfaces",
    status: "pending",
    priority: "high",
    dependencies: [],
    estimatedTime: "60min",
    assignedAgent: "architect",
    batchOptimized: true
  },
  {
    id: "frontend_development", 
    content: "Develop React components and user interface",
    status: "pending",
    priority: "medium",
    dependencies: ["architecture_design"],
    estimatedTime: "120min",
    assignedAgent: "frontend_team",
    parallelExecution: true
  },
  {
    id: "backend_services",
    content: "Implement backend APIs and business logic",
    status: "pending",
    priority: "medium", 
    dependencies: ["architecture_design"],
    estimatedTime: "150min",
    assignedAgent: "backend_team",
    parallelExecution: true
  },
  {
    id: "integration_testing",
    content: "Integration testing and system validation",
    status: "pending",
    priority: "high",
    dependencies: ["frontend_development", "backend_services"],
    estimatedTime: "90min",
    assignedAgent: "testing_team",
    batchOptimized: true
  }
]);

// Launch coordinated parallel agents with batch optimization
Task("System Architect", "Design scalable system architecture using Memory for component coordination", {
  mode: "architect",
  batchOptimized: true,
  memoryIntegration: true
});
Task("Frontend Development Team", "Build React components based on architecture stored in Memory", {
  mode: "coder", 
  parallelFileOps: true,
  dependsOn: "architecture_design"
});
Task("Backend Development Team", "Implement APIs according to architecture specifications in Memory", {
  mode: "coder",
  parallelFileOps: true, 
  dependsOn: "architecture_design"
});
```

## SPARC Development Modes
This project includes 17 specialized SPARC modes optimized for batch operations:

### Core Orchestration Modes
- **orchestrator**: Multi-agent task orchestration with TodoWrite/TodoRead/Task/Memory
  - Coordination Mode: Centralized
  - Max Parallel Tasks: 10
  - Batch Optimized: Yes
  
- **swarm-coordinator**: Specialized swarm management with batch coordination
  - Coordination Mode: Hierarchical
  - Swarm Size: Scalable
  - Load Balancing: Automatic
  
- **workflow-manager**: Process automation with TodoWrite planning and Task execution
  - Workflow Engine: Event-driven
  - Process Optimization: Continuous
  - Automation Level: High
  
- **batch-executor**: Parallel task execution specialist using batch operations
  - Execution Mode: Parallel
  - Resource Management: Dynamic
  - Throughput Optimized: Yes

### Development Modes
- **coder**: Autonomous code generation with batch file operations
  - File Operations: Parallel
  - Code Style: ES2022
  - Batch Optimized: Yes
  
- **architect**: System design with Memory-based coordination
  - Design Patterns: Enterprise
  - Scalability Focus: Yes
  - Memory Integration: Automatic
  
- **reviewer**: Code review using batch file analysis
  - Review Depth: Comprehensive
  - Quality Gates: Security, Performance, Maintainability
  - Batch Analysis: Yes
  
- **tdd**: Test-driven development with TodoWrite planning
  - Testing Mode: Comprehensive
  - Coverage Target: 90%
  - Batch Test Execution: Yes

### Analysis and Research Modes  
- **researcher**: Deep research with parallel WebSearch/WebFetch and Memory coordination
  - Search Mode: Parallel
  - Memory Integration: Automatic
  - Web Research: Optimized
  
- **analyzer**: Code and data analysis with batch processing
  - Analysis Depth: Comprehensive
  - Data Processing: Parallel
  - Pattern Recognition: Advanced
  
- **optimizer**: Performance optimization with systematic analysis
  - Optimization Focus: Performance, Memory, Scalability
  - Benchmarking: Automatic
  - Systematic Approach: Yes

### Creative and Support Modes
- **designer**: UI/UX design with Memory coordination
  - Design Systems: Atomic
  - User Centered: Yes
  - Memory Coordination: Yes
  
- **innovator**: Creative problem solving with WebSearch and Memory
  - Creativity Mode: Divergent-Convergent
  - Inspiration Sources: Web Research
  - Cross-session Ideas: Memory-based
  
- **documenter**: Documentation with batch file operations
  - Doc Formats: Markdown, JSDoc, API-docs
  - Auto Generation: Yes
  - Batch File Processing: Yes
  
- **debugger**: Systematic debugging with TodoWrite and Memory
  - Debugging Approach: Systematic
  - Issue Tracking: Memory-based
  - Pattern Recognition: Yes
  
- **tester**: Comprehensive testing with parallel execution
  - Test Types: Unit, Integration, E2E, Performance
  - Parallel Execution: Yes
  - Coverage Analysis: Comprehensive
  
- **memory-manager**: Knowledge management with Memory tools
  - Memory Strategy: Hierarchical
  - Knowledge Graph: Yes
  - Cross-session Persistence: Yes

## Advanced Swarm Commands
Multi-agent coordination with comprehensive batch tools integration:

```bash
# Research swarm with parallel execution and memory coordination
claude-flow swarm "Research microservices architecture" \
  --strategy research --mode distributed --parallel --max-agents 6 --monitor \
  --batch-optimized --memory-shared --coordination hierarchical

# Development swarm with hierarchical coordination
claude-flow swarm "Build e-commerce platform" \
  --strategy development --mode hierarchical --parallel --max-agents 10 --monitor \
  --file-ops-parallel --code-review-automated --testing-continuous

# Analysis swarm with mesh coordination for complex data processing
claude-flow swarm "Analyze user behavior patterns" \
  --strategy analysis --mode mesh --parallel --max-agents 8 --output sqlite \
  --data-processing-parallel --pattern-recognition --insights-memory

# Testing swarm with comprehensive parallel validation
claude-flow swarm "Comprehensive security testing" \
  --strategy testing --mode distributed --parallel --max-agents 12 --monitor \
  --test-types all --coverage-target 95 --parallel-execution --batch-reports

# Optimization swarm with hybrid adaptive coordination
claude-flow swarm "Optimize system performance" \
  --strategy optimization --mode hybrid --parallel --monitor --timeout 180 \
  --benchmarking-automated --resource-profiling --batch-analysis

# Maintenance swarm with centralized safety controls
claude-flow swarm "System maintenance and updates" \
  --strategy maintenance --mode centralized --monitor --output json \
  --safety-checks --rollback-capable --batch-validation
```

### Automatic Batch Tool Integration
Every swarm command automatically uses:
- **TodoWrite**: Creates comprehensive task breakdowns with dependencies and batch optimization
- **Task**: Launches specialized parallel agents with resource management
- **Memory**: Enables cross-agent knowledge sharing and persistent coordination
- **Batch File Ops**: Concurrent Read/Write/Edit operations for maximum efficiency
- **Parallel Search**: Simultaneous Glob/Grep operations for discovery and analysis
- **Resource Management**: Dynamic allocation and load balancing across agents

## Code Style Preferences
- Use ES modules (import/export) syntax
- Destructure imports when possible
- Use TypeScript for all new code
- Follow existing naming conventions
- Add JSDoc comments for public APIs
- Use async/await instead of Promise chains
- Prefer const/let over var

## Workflow Guidelines
- Always run typecheck after making code changes
- Run tests before committing changes
- Use meaningful commit messages
- Create feature branches for new functionality
- Ensure all tests pass before merging

## Advanced Batch Tool Patterns

### Research and Analysis Pattern
```javascript
// 1. Research coordination with batch optimization
TodoWrite([
  {
    id: "domain_research", 
    content: "Research domain patterns", 
    status: "pending", 
    priority: "high",
    batchOptimized: true,
    parallelWebSearch: true
  },
  {
    id: "competitive_analysis", 
    content: "Analyze competitors", 
    status: "pending", 
    priority: "medium",
    batchWebFetch: true,
    memoryStorage: "competitive_intel"
  },
  {
    id: "synthesis", 
    content: "Synthesize findings", 
    status: "pending", 
    priority: "high",
    dependsOn: ["domain_research", "competitive_analysis"],
    memoryIntegration: "comprehensive"
  }
]);

// 2. Parallel research agents with specialized coordination
Task("Domain Expert", "Research best practices using parallel WebSearch and store in Memory", {
  mode: "researcher",
  searchMode: "parallel",
  memoryKey: "domain_expertise",
  batchOptimized: true
});
Task("Competitive Analyst", "Analyze competitor solutions using batch WebFetch", {
  mode: "analyzer", 
  fetchMode: "batch",
  analysisDepth: "comprehensive",
  memoryKey: "competitive_analysis"
});
Task("Technology Evaluator", "Evaluate technology options using research coordination", {
  mode: "researcher",
  evaluationCriteria: "comprehensive",
  memoryIntegration: true
});

// 3. Knowledge synthesis with cross-agent coordination
Task("Research Synthesizer", "Combine all Memory findings into comprehensive recommendations", {
  mode: "analyzer",
  synthesisMode: "cross-agent",
  memoryAccess: "all_research_keys",
  outputFormat: "structured_recommendations"
});
```

### Development Coordination Pattern
```javascript
// 1. Development planning with resource optimization
TodoWrite([
  {
    id: "architecture", 
    content: "System architecture design", 
    status: "pending", 
    priority: "high",
    designPatterns: "enterprise",
    memoryKey: "system_architecture"
  },
  {
    id: "frontend", 
    content: "Frontend development", 
    status: "pending", 
    priority: "medium",
    parallelFileOps: true,
    dependsOn: ["architecture"],
    frameworkOptimized: true
  },
  {
    id: "backend", 
    content: "Backend development", 
    status: "pending", 
    priority: "medium",
    parallelFileOps: true,
    dependsOn: ["architecture"],
    apiFirst: true
  },
  {
    id: "integration", 
    content: "System integration", 
    status: "pending", 
    priority: "high",
    dependsOn: ["frontend", "backend"],
    testingIntegrated: true
  }
]);

// 2. Coordinated development with specialized agents
Task("System Architect", "Design architecture and store specs in Memory", {
  mode: "architect",
  designApproach: "scalable",
  memoryKey: "architecture_specs",
  documentationLevel: "comprehensive"
});
Task("Frontend Team", "Develop UI components using Memory architecture specs", {
  mode: "coder",
  codeStyle: "ES2022",
  parallelFileOps: true,
  memoryDependency: "architecture_specs",
  testingIntegrated: true
});
Task("Backend Team", "Implement APIs according to Memory specifications", {
  mode: "coder",
  apiFirst: true,
  parallelFileOps: true,
  memoryDependency: "architecture_specs",
  performanceOptimized: true
});
Task("DevOps Team", "Setup deployment using coordinated specifications", {
  mode: "devops",
  automationLevel: "high",
  memoryAccess: "all_specs",
  cicdIntegrated: true
});
```

### Analysis and Optimization Pattern
```javascript
// 1. Analysis planning with systematic approach
TodoWrite([
  {
    id: "data_collection", 
    content: "Collect performance data", 
    status: "pending", 
    priority: "high",
    dataTypes: ["performance", "memory", "network"],
    batchCollection: true
  },
  {
    id: "pattern_analysis", 
    content: "Analyze patterns", 
    status: "pending", 
    priority: "medium",
    analysisDepth: "comprehensive",
    parallelProcessing: true,
    dependsOn: ["data_collection"]
  },
  {
    id: "optimization", 
    content: "Implement optimizations", 
    status: "pending", 
    priority: "high",
    optimizationFocus: ["performance", "scalability"],
    dependsOn: ["pattern_analysis"],
    benchmarkingIntegrated: true
  }
]);

// 2. Parallel analysis with specialized coordination
Task("Data Collector", "Gather performance metrics using batch Read operations", {
  mode: "analyzer",
  dataCollection: "comprehensive",
  batchFileOps: true,
  memoryKey: "performance_data"
});
Task("Pattern Analyst", "Analyze patterns using parallel Grep and statistical analysis", {
  mode: "analyzer",
  analysisType: "pattern_recognition",
  parallelProcessing: true,
  memoryDependency: "performance_data",
  insightGeneration: true
});
Task("Optimization Specialist", "Implement improvements using batch Edit operations", {
  mode: "optimizer",
  optimizationStrategy: "systematic",
  batchFileOps: true,
  memoryAccess: "all_analysis_data",
  benchmarkingEnabled: true
});
```

## Orchestration Patterns

### Hierarchical Coordination
```javascript
// Master orchestrator manages specialized teams
Task("Master Orchestrator", "Coordinate all development phases", {
  mode: "orchestrator",
  coordinationMode: "hierarchical",
  teamManagement: true,
  resourceAllocation: "dynamic"
});

// Specialized team leaders
Task("Development Team Leader", "Coordinate coding activities", {
  mode: "swarm-coordinator",
  teamFocus: "development",
  reportTo: "Master Orchestrator"
});
Task("Testing Team Leader", "Coordinate testing activities", {
  mode: "swarm-coordinator", 
  teamFocus: "testing",
  reportTo: "Master Orchestrator"
});
```

### Mesh Coordination
```javascript
// All agents coordinate directly with each other
const meshAgents = [
  "Researcher", "Analyzer", "Coder", "Tester", "Reviewer"
];

meshAgents.forEach(agent => {
  Task(agent, `Perform ${agent.toLowerCase()} tasks with peer coordination`, {
    mode: agent.toLowerCase(),
    coordinationMode: "mesh",
    peerCommunication: true,
    sharedMemory: "mesh_coordination"
  });
});
```

### Pipeline Coordination
```javascript
// Sequential processing with handoffs
TodoWrite([
  {id: "research", content: "Research phase", priority: "high", pipelineStage: 1},
  {id: "design", content: "Design phase", dependsOn: ["research"], pipelineStage: 2},
  {id: "implement", content: "Implementation phase", dependsOn: ["design"], pipelineStage: 3},
  {id: "test", content: "Testing phase", dependsOn: ["implement"], pipelineStage: 4},
  {id: "deploy", content: "Deployment phase", dependsOn: ["test"], pipelineStage: 5}
]);
```

## Important Notes
- **Use TodoWrite extensively** for all complex task coordination with batch optimization
- **Leverage Task tool** for parallel agent execution with resource management
- **Store all important information in Memory** for cross-agent coordination and persistence
- **Use batch file operations** whenever reading/writing multiple files for efficiency
- **Enable parallel execution** with appropriate flags for maximum throughput
- **Monitor resource usage** during swarm operations for optimal performance
- **Implement proper error handling** and recovery mechanisms in batch operations
- **Use memory keys strategically** for efficient cross-agent data sharing
- **Configure agent specialization** based on task requirements and resource constraints
- **Enable continuous monitoring** for long-running swarm operations

This configuration ensures optimal use of Claude Code's batch tools for swarm orchestration, parallel task execution, and comprehensive project coordination.
