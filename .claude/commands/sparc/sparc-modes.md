# SPARC Development Modes

## Overview
This document describes all 17 specialized SPARC development modes available in Claude-Flow. Each mode is optimized for specific tasks and includes batch tool integration for maximum efficiency.

## Core Orchestration Modes

### orchestrator
**Multi-agent task orchestration and coordination**
- **Coordination Mode**: Centralized
- **Max Parallel Tasks**: 10
- **Batch Optimized**: Yes
- **Tools**: TodoWrite, TodoRead, Task, Memory, Bash
- **Usage**: `/sparc orchestrator <complex task description>`
- **Best For**: Coordinating multiple agents, complex project management

### swarm-coordinator
**Swarm coordination and management**
- **Coordination Mode**: Hierarchical
- **Swarm Size**: Scalable
- **Load Balancing**: Automatic
- **Tools**: TodoWrite, TodoRead, Task, Memory, Bash
- **Usage**: `/sparc swarm-coordinator <swarm management task>`
- **Best For**: Managing large teams of agents, dynamic resource allocation

### workflow-manager
**Workflow automation and process management**
- **Workflow Engine**: Event-driven
- **Process Optimization**: Continuous
- **Automation Level**: High
- **Tools**: TodoWrite, TodoRead, Task, Bash, Memory
- **Usage**: `/sparc workflow-manager <workflow description>`
- **Best For**: Process automation, workflow optimization

### batch-executor
**Parallel task execution specialist**
- **Execution Mode**: Parallel
- **Resource Management**: Dynamic
- **Throughput Optimized**: Yes
- **Tools**: Task, Bash, Read, Write, TodoWrite, Memory
- **Usage**: `/sparc batch-executor <batch task description>`
- **Best For**: High-throughput parallel processing, batch operations

## Development Modes

### coder
**Autonomous code generation and implementation**
- **File Operations**: Parallel
- **Code Style**: ES2022
- **Batch Optimized**: Yes
- **Tools**: Read, Write, Edit, Bash, Glob, Grep, TodoWrite
- **Usage**: `/sparc coder <coding task description>`
- **Best For**: Code generation, implementation, refactoring

### architect
**System design and architecture planning**
- **Design Patterns**: Enterprise
- **Scalability Focus**: Yes
- **Memory Integration**: Automatic
- **Tools**: Read, Write, Glob, Memory, TodoWrite, Task
- **Usage**: `/sparc architect <system design task>`
- **Best For**: System architecture, design patterns, scalability planning

### reviewer
**Code review and quality optimization**
- **Review Depth**: Comprehensive
- **Quality Gates**: Security, Performance, Maintainability
- **Batch Analysis**: Yes
- **Tools**: Read, Edit, Grep, Bash, TodoWrite, Memory
- **Usage**: `/sparc reviewer <code review task>`
- **Best For**: Code review, quality assurance, optimization

### tdd
**Test-driven development methodology**
- **Testing Mode**: Comprehensive
- **Coverage Target**: 90%
- **Batch Test Execution**: Yes
- **Tools**: Read, Write, Edit, Bash, TodoWrite, Task
- **Usage**: `/sparc tdd <feature description>`
- **Best For**: Test-driven development, comprehensive testing

### debugger
**Debug and fix issues systematically**
- **Debugging Approach**: Systematic
- **Issue Tracking**: Memory-based
- **Pattern Recognition**: Yes
- **Tools**: Read, Edit, Bash, Grep, TodoWrite, Memory
- **Usage**: `/sparc debugger <issue description>`
- **Best For**: Bug fixing, issue resolution, systematic debugging

## Analysis and Research Modes

### researcher
**Deep research and comprehensive analysis**
- **Search Mode**: Parallel
- **Memory Integration**: Automatic
- **Web Research**: Optimized
- **Tools**: WebSearch, WebFetch, Read, Write, Memory, TodoWrite, Task
- **Usage**: `/sparc researcher <research topic>`
- **Best For**: Information gathering, research, competitive analysis

### analyzer
**Code and data analysis specialist**
- **Analysis Depth**: Comprehensive
- **Data Processing**: Parallel
- **Pattern Recognition**: Advanced
- **Tools**: Read, Grep, Bash, Write, Memory, TodoWrite, Task
- **Usage**: `/sparc analyzer <analysis task>`
- **Best For**: Data analysis, pattern recognition, code analysis

### optimizer
**Performance optimization specialist**
- **Optimization Focus**: Performance, Memory, Scalability
- **Benchmarking**: Automatic
- **Systematic Approach**: Yes
- **Tools**: Read, Edit, Bash, Grep, TodoWrite, Memory
- **Usage**: `/sparc optimizer <optimization task>`
- **Best For**: Performance optimization, bottleneck identification

### tester
**Comprehensive testing and validation**
- **Test Types**: Unit, Integration, E2E, Performance
- **Parallel Execution**: Yes
- **Coverage Analysis**: Comprehensive
- **Tools**: Read, Write, Edit, Bash, TodoWrite, Task
- **Usage**: `/sparc tester <testing task>`
- **Best For**: Testing strategies, validation, quality assurance

## Creative and Support Modes

### designer
**UI/UX design and user experience**
- **Design Systems**: Atomic
- **User Centered**: Yes
- **Memory Coordination**: Yes
- **Tools**: Read, Write, Edit, Memory, TodoWrite
- **Usage**: `/sparc designer <design task>`
- **Best For**: UI/UX design, user experience, design systems

### innovator
**Creative problem solving and innovation**
- **Creativity Mode**: Divergent-Convergent
- **Inspiration Sources**: Web Research
- **Cross-session Ideas**: Memory-based
- **Tools**: Read, Write, WebSearch, Memory, TodoWrite, Task
- **Usage**: `/sparc innovator <innovation challenge>`
- **Best For**: Creative problem solving, innovation, brainstorming

### documenter
**Documentation generation and maintenance**
- **Doc Formats**: Markdown, JSDoc, API-docs
- **Auto Generation**: Yes
- **Batch File Processing**: Yes
- **Tools**: Read, Write, Glob, Memory, TodoWrite
- **Usage**: `/sparc documenter <documentation task>`
- **Best For**: Documentation, technical writing, knowledge management

### memory-manager
**Memory and knowledge management**
- **Memory Strategy**: Hierarchical
- **Knowledge Graph**: Yes
- **Cross-session Persistence**: Yes
- **Tools**: Memory, Read, Write, TodoWrite, TodoRead
- **Usage**: `/sparc memory-manager <knowledge task>`
- **Best For**: Knowledge management, memory organization, data persistence

## Advanced Usage Patterns

### Batch Operations
All SPARC modes support batch operations for maximum efficiency:

```javascript
// Example: Parallel development with multiple agents
TodoWrite([
  {
    id: "architecture_design",
    content: "Design system architecture",
    status: "pending",
    priority: "high",
    mode: "architect",
    batchOptimized: true
  },
  {
    id: "frontend_development",
    content: "Develop user interface",
    status: "pending",
    priority: "medium",
    mode: "coder",
    parallelExecution: true,
    dependsOn: ["architecture_design"]
  },
  {
    id: "testing_suite",
    content: "Create comprehensive tests",
    status: "pending",
    priority: "high",
    mode: "tester",
    parallelExecution: true,
    dependsOn: ["frontend_development"]
  }
]);
```

### Memory Coordination
Use Memory tools for cross-mode coordination:

```javascript
// Store architecture in memory for other modes to use
Memory.store("system_architecture", {
  components: ["frontend", "backend", "database"],
  patterns: ["MVC", "Observer", "Factory"],
  scalability: "horizontal"
});

// Other modes can access this shared knowledge
const architecture = Memory.get("system_architecture");
```

### Workflow Integration
Integrate modes into complex workflows:

```bash
# Research-driven development workflow
./claude-flow sparc researcher "Best practices for microservices"
./claude-flow sparc architect "Design microservices architecture"  
./claude-flow sparc coder "Implement service layer"
./claude-flow sparc tester "Create integration tests"
./claude-flow sparc reviewer "Review implementation"
```

## Best Practices

### Mode Selection
- Use **orchestrator** for complex multi-agent tasks
- Use **coder** for implementation and development
- Use **researcher** for information gathering
- Use **tdd** for test-driven development
- Use **analyzer** for data analysis and insights
- Use **optimizer** for performance improvements

### Batch Processing
- Enable batch operations with `batchOptimized: true`
- Use parallel execution for independent tasks
- Coordinate through Memory for shared state
- Monitor resource usage during batch operations

### Memory Management
- Store intermediate results in Memory
- Use descriptive keys for shared data
- Implement proper cleanup for temporary data
- Leverage cross-session persistence

### Error Handling
- Implement proper error handling in all modes
- Use circuit breaker patterns for resilience
- Store error patterns in Memory for learning
- Provide graceful degradation strategies

## Integration Examples

### Full Development Cycle
```javascript
// 1. Research and planning
Task("Research Agent", "Research technology options", {
  mode: "researcher",
  memoryKey: "research_findings"
});

// 2. Architecture design
Task("System Architect", "Design scalable architecture", {
  mode: "architect", 
  memoryDependency: "research_findings",
  memoryKey: "system_architecture"
});

// 3. Parallel development
Task("Frontend Team", "Develop user interface", {
  mode: "coder",
  parallelFileOps: true,
  memoryDependency: "system_architecture"
});

// 4. Quality assurance
Task("QA Team", "Comprehensive testing", {
  mode: "tester",
  testTypes: ["unit", "integration", "e2e"],
  parallelExecution: true
});

// 5. Optimization
Task("Performance Team", "Optimize performance", {
  mode: "optimizer",
  benchmarkingEnabled: true,
  memoryKey: "performance_metrics"
});
```

### Research and Analysis Pipeline
```javascript
// Multi-modal research approach
const researchTasks = [
  {mode: "researcher", task: "Market research", priority: "high"},
  {mode: "analyzer", task: "Competitive analysis", priority: "medium"},
  {mode: "innovator", task: "Innovation opportunities", priority: "low"}
];

// Execute in parallel with Memory coordination
researchTasks.forEach(task => {
  Task(`${task.mode} Agent`, task.task, {
    mode: task.mode,
    priority: task.priority,
    memoryIntegration: true,
    parallelExecution: true
  });
});
```

## Performance Optimization

### Resource Management
- Monitor CPU and memory usage during batch operations
- Implement dynamic resource allocation
- Use load balancing for distributed processing
- Set appropriate timeouts for long-running tasks

### Monitoring
- Enable real-time monitoring for complex workflows
- Track performance metrics for optimization
- Use alerting for critical failures
- Implement health checks for all modes

### Scalability
- Design for horizontal scaling
- Use async/await patterns for non-blocking operations
- Implement proper caching strategies
- Optimize database queries and file operations

## Troubleshooting

### Common Issues
1. **Memory Coordination**: Ensure Memory keys are unique and descriptive
2. **Batch Operations**: Check resource limits and concurrency settings
3. **Mode Selection**: Choose appropriate mode for task complexity
4. **Error Handling**: Implement proper error recovery mechanisms

### Debugging
- Use verbose logging for detailed execution traces
- Monitor Memory usage and cleanup
- Check Task coordination and dependencies
- Validate input parameters and constraints

### Performance Issues
- Profile resource usage during batch operations
- Optimize file I/O operations
- Implement proper caching strategies
- Use appropriate data structures for large datasets

## Conclusion

SPARC modes provide a comprehensive framework for specialized AI task execution. By leveraging batch operations, Memory coordination, and proper mode selection, you can achieve maximum efficiency and scalability in your AI-driven development workflows.

For more detailed information about specific modes, refer to the individual mode documentation files in this directory.