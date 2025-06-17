// init/swarm-commands.ts - Swarm command documentation creation
export async function createSwarmCommands(): Promise<void> {
  const fs = await import('fs/promises');
  const path = await import('path');
  
  const swarmDir = '.claude/commands/swarm';
  
  // Individual strategy documentation
  const swarmCommands = {
    'research.md': createResearchCommand(),
    'development.md': createDevelopmentCommand(),
    'analysis.md': createAnalysisCommand(),
    'testing.md': createTestingCommand(),
    'optimization.md': createOptimizationCommand(),
    'maintenance.md': createMaintenanceCommand(),
    'examples.md': createSwarmExamples(),
    'coordination-modes.md': createCoordinationModes(),
    'best-practices.md': createBestPractices()
  };
  
  // Write swarm command documentation
  for (const [filename, content] of Object.entries(swarmCommands)) {
    await fs.writeFile(path.join(swarmDir, filename), content);
    console.log(`  ✅ Created ${filename}`);
  }
}

function createResearchCommand(): string {
  return `# Research Swarm Command

## Usage
\`\`\`bash
claude-flow swarm "Research objective" --strategy research --mode distributed --parallel
\`\`\`

## Description
Multi-agent research coordination with distributed intelligence gathering using batch tools.

## Strategy Features
- **Parallel Web Search**: Multiple agents search different sources simultaneously
- **Source Credibility Analysis**: Automated fact-checking and source validation
- **Knowledge Synthesis**: AI agents combine findings from multiple sources
- **Report Generation**: Structured output with citations and references

## Batch Tool Integration
- **TodoWrite**: Creates research task breakdown (sources, topics, validation)
- **Task Tool**: Launches parallel research agents for different domains
- **Memory Tool**: Stores findings for cross-agent knowledge sharing
- **WebSearch/WebFetch**: Batch web operations for comprehensive coverage

## Best Practices
- Use distributed mode for complex, multi-domain research
- Enable parallel execution with \`--parallel\` for faster results
- Set appropriate timeout with \`--timeout\` for comprehensive research
- Use \`--monitor\` for real-time progress tracking
- Increase agent count with \`--max-agents\` for broad topics

## Example Workflow
1. **Initialize**: TodoWrite creates research plan with subtopics
2. **Search**: Task launches agents for parallel domain research
3. **Validate**: Cross-reference findings using Memory coordination
4. **Synthesize**: Combine results into comprehensive report
5. **Output**: Generate formatted report with citations

## Output Formats
- \`--output json\`: Structured data with metadata
- \`--output sqlite\`: Queryable database format
- \`--output html\`: Human-readable report with links
`;
}

function createDevelopmentCommand(): string {
  return `# Development Swarm Command

## Usage
\`\`\`bash
claude-flow swarm "Build application" --strategy development --mode hierarchical --parallel
\`\`\`

## Description
Coordinated software development with specialized agents using batch operations.

## Strategy Features
- **Architecture Design**: System planning and component specification
- **Parallel Implementation**: Multiple agents work on different modules
- **Code Integration**: Coordinated merge and integration processes
- **Testing & Validation**: Automated testing across all components

## Batch Tool Integration
- **TodoWrite**: Creates development phases and component breakdown
- **Task Tool**: Launches specialized development agents (frontend, backend, database)
- **Read/Write/Edit**: Batch file operations for coordinated code generation
- **Bash Tool**: Automated build, test, and deployment operations
- **Memory Tool**: Shares architecture decisions and component interfaces

## Best Practices
- Use hierarchical mode for organized, structured development
- Enable parallel execution for independent modules/components
- Set higher agent count (\`--max-agents 8+\`) for large projects
- Monitor progress with \`--monitor\` for real-time updates
- Use \`--output sqlite\` for detailed development metrics

## Example Workflow
1. **Planning**: TodoWrite creates development roadmap
2. **Architecture**: Lead agent designs system architecture
3. **Implementation**: Task launches parallel development agents
4. **Integration**: Memory coordinates interface contracts
5. **Testing**: Batch testing across all components
6. **Deployment**: Automated deployment pipeline

## Coordination Patterns
- **Frontend Team**: React/Vue components, styling, UX
- **Backend Team**: APIs, services, business logic
- **Database Team**: Schema, queries, optimization
- **DevOps Team**: CI/CD, infrastructure, monitoring
`;
}

function createAnalysisCommand(): string {
  return `# Analysis Swarm Command

## Usage
\`\`\`bash
claude-flow swarm "Analyze data" --strategy analysis --parallel --max-agents 10
\`\`\`

## Description
Data analysis and insights generation with coordinated batch processing.

## Strategy Features
- **Data Collection**: Automated data gathering from multiple sources
- **Statistical Analysis**: Parallel statistical computations
- **Pattern Recognition**: AI-powered pattern and anomaly detection
- **Visualization**: Automated chart and dashboard generation

## Batch Tool Integration
- **TodoWrite**: Creates analysis phases (collection, processing, visualization)
- **Task Tool**: Launches specialized analysis agents for different data types
- **Read Tool**: Batch file reading for large datasets
- **Memory Tool**: Stores intermediate results and discovered patterns
- **Bash Tool**: Runs analysis scripts and data processing pipelines

## Best Practices
- Use mesh mode for peer-to-peer data sharing and validation
- Enable parallel execution for large datasets
- Increase agent count for complex, multi-dimensional analysis
- Use \`--monitor\` for long-running analysis tasks
- Choose appropriate output format (\`json\`, \`csv\`, \`sqlite\`)

## Example Workflow
1. **Data Collection**: TodoWrite defines data sources and collection strategy
2. **Preprocessing**: Task launches data cleaning and preparation agents
3. **Analysis**: Parallel statistical and ML analysis across data segments
4. **Pattern Discovery**: Memory coordinates pattern sharing between agents
5. **Visualization**: Generate charts, dashboards, and reports
6. **Insights**: Synthesize findings into actionable recommendations

## Analysis Types
- **Statistical Analysis**: Descriptive and inferential statistics
- **Time Series Analysis**: Trend analysis and forecasting
- **Machine Learning**: Classification, clustering, regression
- **Text Analysis**: NLP, sentiment analysis, topic modeling
- **Performance Analysis**: System metrics and optimization
`;
}

function createTestingCommand(): string {
  return `# Testing Swarm Command

## Usage
\`\`\`bash
claude-flow swarm "Test application" --strategy testing --mode mesh --parallel
\`\`\`

## Description
Comprehensive testing coordination with distributed validation and batch operations.

## Strategy Features
- **Test Planning**: Automated test strategy and case generation
- **Parallel Execution**: Simultaneous test execution across multiple environments
- **Coverage Analysis**: Comprehensive code and feature coverage reporting
- **Performance Testing**: Load, stress, and performance validation

## Batch Tool Integration
- **TodoWrite**: Creates comprehensive test matrix and execution plan
- **Task Tool**: Launches parallel testing agents for different test types
- **Bash Tool**: Executes test suites, builds, and deployment verification
- **Read/Grep**: Batch code analysis for test coverage gaps
- **Memory Tool**: Shares test results and failure patterns

## Best Practices
- Use mesh mode for distributed, peer-to-peer test coordination
- Enable parallel execution for comprehensive test coverage
- Set appropriate timeout for long-running integration tests
- Monitor results with \`--monitor\` for real-time test feedback
- Use \`--output sqlite\` for detailed test analytics

## Example Workflow
1. **Test Planning**: TodoWrite creates test matrix (unit, integration, e2e)
2. **Environment Setup**: Task prepares multiple test environments
3. **Parallel Execution**: Simultaneous test execution across environments
4. **Result Collection**: Memory aggregates test results and metrics
5. **Analysis**: Identify failures, performance issues, coverage gaps
6. **Reporting**: Generate comprehensive test reports and recommendations

## Test Types
- **Unit Tests**: Component-level testing with high coverage
- **Integration Tests**: Service and API integration validation
- **End-to-End Tests**: Full user workflow testing
- **Performance Tests**: Load, stress, and scalability testing
- **Security Tests**: Vulnerability scanning and penetration testing
- **Accessibility Tests**: WCAG compliance and usability testing
`;
}

function createOptimizationCommand(): string {
  return `# Optimization Swarm Command

## Usage
\`\`\`bash
claude-flow swarm "Optimize performance" --strategy optimization --mode hybrid --parallel
\`\`\`

## Description
Performance optimization with coordinated analysis and improvements using batch operations.

## Strategy Features
- **Performance Profiling**: Comprehensive system and application profiling
- **Bottleneck Identification**: Automated detection of performance constraints
- **Optimization Implementation**: Coordinated performance improvements
- **Validation & Testing**: Performance regression testing and validation

## Batch Tool Integration
- **TodoWrite**: Creates optimization roadmap with priorities and dependencies
- **Task Tool**: Launches specialized optimization agents (frontend, backend, database)
- **Bash Tool**: Runs performance tests, profiling, and optimization scripts
- **Read/Edit**: Batch code analysis and optimization implementation
- **Memory Tool**: Shares optimization strategies and performance metrics

## Best Practices
- Use hybrid mode for adaptive optimization strategies
- Enable monitoring with \`--monitor\` for real-time performance metrics
- Use parallel execution for multiple optimization paths
- Set adequate timeout for thorough performance analysis
- Use \`--output sqlite\` for detailed performance tracking

## Example Workflow
1. **Profiling**: TodoWrite defines profiling strategy and target metrics
2. **Analysis**: Task launches performance analysis agents
3. **Optimization**: Parallel implementation of performance improvements
4. **Validation**: Memory coordinates before/after performance comparisons
5. **Regression Testing**: Ensure optimizations don't break functionality
6. **Monitoring**: Set up ongoing performance monitoring

## Optimization Areas
- **Database Optimization**: Query optimization, indexing, caching
- **Frontend Performance**: Bundle optimization, lazy loading, CDN
- **Backend Performance**: Algorithm optimization, caching, scaling
- **Infrastructure**: Server optimization, load balancing, resource allocation
- **Network Performance**: CDN, compression, request optimization
`;
}

function createMaintenanceCommand(): string {
  return `# Maintenance Swarm Command

## Usage
\`\`\`bash
claude-flow swarm "System maintenance" --strategy maintenance --mode centralized --monitor
\`\`\`

## Description
System maintenance and updates with coordinated agents and batch operations.

## Strategy Features
- **System Health Checks**: Comprehensive system monitoring and diagnostics
- **Update Planning**: Coordinated dependency and system updates
- **Implementation**: Safe, coordinated maintenance operations
- **Verification & Rollback**: Automated verification and rollback capabilities

## Batch Tool Integration
- **TodoWrite**: Creates maintenance checklist with dependencies and rollback plans
- **Task Tool**: Launches maintenance agents for different system components
- **Bash Tool**: Executes maintenance scripts, updates, and system operations
- **Read Tool**: Batch configuration and log file analysis
- **Memory Tool**: Tracks maintenance history and system state changes

## Best Practices
- Use centralized mode for controlled, coordinated maintenance
- Enable monitoring with \`--monitor\` for safety and progress tracking
- Set conservative timeouts for safe maintenance operations
- Use \`--output json\` for detailed audit trails
- Plan rollback procedures before starting maintenance

## Example Workflow
1. **Health Assessment**: TodoWrite creates system health checklist
2. **Backup Creation**: Task creates comprehensive system backups
3. **Maintenance Execution**: Coordinated maintenance operations
4. **Verification**: Memory tracks changes and validates system state
5. **Rollback (if needed)**: Automated rollback to previous state
6. **Documentation**: Update maintenance logs and documentation

## Maintenance Types
- **Dependency Updates**: Package updates, security patches
- **System Updates**: OS updates, security configurations
- **Database Maintenance**: Index rebuilding, cleanup, optimization
- **Log Rotation**: Log cleanup and archival
- **Security Audits**: Vulnerability scanning and remediation
- **Performance Tuning**: System optimization and resource cleanup
`;
}

function createSwarmExamples(): string {
  return `# Claude-Flow Swarm Examples with Batch Tools

## Quick Start Commands with Batch Operations

### Research Tasks with Parallel Execution
\`\`\`bash
# Distributed research with parallel agents
claude-flow swarm "Research modern web frameworks" --strategy research --mode distributed --parallel --max-agents 6

# Market analysis with coordinated batch operations
claude-flow swarm "Analyze AI market trends" --strategy research --parallel --monitor --timeout 120
\`\`\`

### Development Tasks with Batch Coordination
\`\`\`bash
# Hierarchical development with batch file operations
claude-flow swarm "Build microservice API" --strategy development --mode hierarchical --parallel --max-agents 8

# React dashboard with coordinated component development
claude-flow swarm "Create React dashboard" --strategy development --parallel --monitor --output sqlite
\`\`\`

### Analysis Tasks with Batch Processing
\`\`\`bash
# Mesh-coordinated data analysis
claude-flow swarm "Analyze user behavior data" --strategy analysis --mode mesh --parallel --max-agents 10

# Performance analysis with monitoring
claude-flow swarm "Performance analysis of application" --strategy analysis --monitor --output csv
\`\`\`

### Testing Tasks with Parallel Validation
\`\`\`bash
# Comprehensive parallel testing
claude-flow swarm "Comprehensive testing suite" --strategy testing --parallel --max-agents 12

# Security testing with distributed coordination
claude-flow swarm "Security testing analysis" --strategy testing --mode distributed --monitor
\`\`\`

### Optimization Tasks with Hybrid Coordination
\`\`\`bash
# Database optimization with hybrid approach
claude-flow swarm "Optimize database queries" --strategy optimization --mode hybrid --parallel

# Frontend optimization with batch processing
claude-flow swarm "Frontend performance optimization" --strategy optimization --monitor --max-agents 6
\`\`\`

### Maintenance Tasks with Centralized Control
\`\`\`bash
# Dependency updates with centralized coordination
claude-flow swarm "Update dependencies safely" --strategy maintenance --mode centralized --monitor

# System health checks with batch operations
claude-flow swarm "System health check" --strategy maintenance --parallel --output json
\`\`\`

See individual strategy files for detailed documentation and best practices.
`;
}

function createCoordinationModes(): string {
  return `# Coordination Modes for Swarm Operations

## Centralized Mode
**Best for**: Simple tasks, controlled operations, safety-critical maintenance

### Characteristics
- Single coordinator manages all agents
- Sequential task assignment and monitoring
- Centralized decision making and error handling
- Clear hierarchy and command structure

### Batch Tool Usage
- TodoWrite creates master task list
- Coordinator assigns tasks to agents sequentially
- Memory stores central state and decisions
- All agents report back to central coordinator

### Use Cases
- System maintenance and updates
- Critical production deployments
- Security-sensitive operations
- Small-scale, well-defined tasks

## Distributed Mode
**Best for**: Complex, parallelizable tasks, research, large-scale analysis

### Characteristics
- Multiple coordinators manage agent groups
- Parallel task execution across coordinators
- Distributed decision making with coordination
- Fault tolerance through redundancy

### Batch Tool Usage
- TodoWrite creates distributed task segments
- Multiple Task launches for parallel agent groups
- Memory enables inter-coordinator communication
- Shared state through distributed memory

### Use Cases
- Large-scale research projects
- Distributed data analysis
- Multi-domain problem solving
- High-throughput operations

## Hierarchical Mode
**Best for**: Structured development, organized workflows, complex projects

### Characteristics
- Tree-like organization with team leads
- Clear reporting structure and delegation
- Specialized teams for different components
- Organized communication channels

### Batch Tool Usage
- TodoWrite creates hierarchical task breakdown
- Task creates team leads, then team members
- Memory maintains hierarchy and team boundaries
- Structured reporting up the hierarchy

### Use Cases
- Software development projects
- Structured analysis workflows
- Large team coordination
- Multi-phase project execution

## Mesh Mode
**Best for**: Dynamic tasks, peer-to-peer collaboration, adaptive workflows

### Characteristics
- Peer-to-peer agent communication
- Self-organizing task distribution
- Dynamic adaptation to changing requirements
- Emergent coordination patterns

### Batch Tool Usage
- TodoWrite creates shared task pool
- Agents claim tasks dynamically from pool
- Memory enables peer discovery and communication
- Adaptive coordination through shared state

### Use Cases
- Dynamic problem solving
- Adaptive testing strategies
- Exploratory research
- Flexible workflow execution

## Hybrid Mode
**Best for**: Complex workflows, adaptive requirements, multi-phase operations

### Characteristics
- Combines multiple coordination patterns
- Adaptive mode switching based on task phase
- Flexible coordination based on requirements
- Optimal efficiency for complex operations

### Batch Tool Usage
- TodoWrite creates phase-based coordination plan
- Task adapts agent launching based on current phase
- Memory tracks coordination mode changes
- Dynamic coordination pattern selection

### Use Cases
- Complex multi-phase projects
- Adaptive optimization workflows
- Large-scale system migrations
- Research and development projects

## Choosing the Right Mode

### Simple Tasks → Centralized
- Single objective, clear requirements
- Safety and control are priorities
- Small team or simple workflow

### Complex Tasks → Distributed/Hierarchical
- Multiple objectives or domains
- Parallel execution beneficial
- Large team or complex workflow

### Dynamic Tasks → Mesh/Hybrid
- Changing requirements
- Adaptive coordination needed
- Emergent or exploratory work

### Multi-Phase Tasks → Hybrid
- Different phases need different coordination
- Changing complexity over time
- Need for adaptive optimization
`;
}

function createBestPractices(): string {
  return `# Swarm Operation Best Practices

## Task Planning and Coordination

### Use TodoWrite Effectively
- Create comprehensive task breakdowns before starting
- Assign priorities based on dependencies and importance
- Include rollback and error handling tasks
- Update task status in real-time for progress tracking

### Optimize Agent Coordination
- Use appropriate coordination mode for task complexity
- Balance agent count with task complexity
- Enable monitoring for long-running operations
- Set realistic timeouts based on task scope

## Batch Tool Optimization

### Parallel Execution
- Identify independent tasks for parallel execution
- Use batch file operations for I/O-intensive tasks
- Coordinate through Memory for shared state
- Avoid sequential dependencies where possible

### Memory Management
- Store intermediate results for agent coordination
- Use descriptive keys for easy retrieval
- Clean up memory after task completion
- Share patterns and insights across agents

### Error Handling
- Plan rollback strategies in advance
- Use TodoWrite to track error recovery tasks
- Store error states in Memory for debugging
- Implement graceful degradation for partial failures

## Performance Optimization

### Resource Management
- Monitor system resources during execution
- Adjust agent count based on available resources
- Use appropriate output formats for efficiency
- Implement resource pooling for repeated operations

### Scaling Strategies
- Start with fewer agents and scale up as needed
- Use distributed mode for large-scale operations
- Implement load balancing across agents
- Monitor performance metrics in real-time

## Monitoring and Debugging

### Real-Time Monitoring
- Use --monitor flag for long-running operations
- Track progress through TodoRead checks
- Monitor resource usage and performance
- Set up alerts for critical failures

### Output Management
- Choose appropriate output formats for use case
- Use structured formats (JSON, SQLite) for analysis
- Generate human-readable reports for stakeholders
- Implement proper logging and audit trails

## Security and Safety

### Safe Operations
- Implement proper validation and verification
- Use centralized mode for safety-critical operations
- Plan and test rollback procedures
- Implement proper authentication and authorization

### Data Protection
- Secure sensitive data in Memory storage
- Implement proper access controls
- Use encryption for sensitive operations
- Follow data retention and cleanup policies

## Common Patterns

### Research and Analysis
1. TodoWrite creates research plan
2. Task launches parallel research agents
3. Memory stores and cross-references findings
4. Batch operations generate comprehensive reports

### Development and Implementation
1. TodoWrite creates development roadmap
2. Hierarchical coordination for organized development
3. Parallel implementation with Memory coordination
4. Integrated testing and validation

### Testing and Validation
1. TodoWrite creates comprehensive test matrix
2. Mesh coordination for distributed testing
3. Parallel test execution across environments
4. Memory aggregates results and identifies patterns

### Optimization and Performance
1. TodoWrite defines optimization strategy
2. Hybrid coordination adapts to optimization phases
3. Parallel profiling and optimization implementation
4. Memory tracks performance improvements

## Troubleshooting

### Common Issues
- Agent coordination failures: Check Memory state and connectivity
- Performance bottlenecks: Reduce agent count or adjust coordination mode
- Task failures: Review TodoWrite breakdown and dependencies
- Resource exhaustion: Monitor system resources and scale appropriately

### Debugging Strategies
- Use dry-run mode to validate configuration
- Enable detailed monitoring and logging
- Check Memory state for coordination issues
- Review task dependencies and sequencing

### Recovery Procedures
- Implement proper error handling in TodoWrite tasks
- Use Memory to store recovery state
- Plan rollback procedures for critical operations
- Test recovery procedures in safe environments
`;
}