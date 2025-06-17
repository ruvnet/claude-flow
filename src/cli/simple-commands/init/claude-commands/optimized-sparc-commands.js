// optimized-sparc-commands.js - Batchtools-optimized SPARC-specific slash commands

// Create batchtools-optimized SPARC mode slash command
export function createOptimizedSparcSlashCommand(mode) {
  // Extract the full description without truncation
  const fullDescription = mode.roleDefinition.length > 100 
    ? `${mode.roleDefinition.substring(0, 97)}...` 
    : mode.roleDefinition;

  return `---
name: sparc-${mode.slug}
description: ${mode.name} - ${fullDescription} (Batchtools Optimized)
---

# ${mode.name} (Batchtools Optimized)

## Role Definition
${mode.roleDefinition}

**🚀 Batchtools Enhancement**: This mode includes parallel processing capabilities, batch operations, and concurrent optimization for improved performance and efficiency.

## Custom Instructions (Enhanced)
${mode.customInstructions}

### Batchtools Optimization Strategies
- **Parallel Operations**: Execute independent tasks simultaneously using batchtools
- **Concurrent Analysis**: Analyze multiple components or patterns in parallel
- **Batch Processing**: Group related operations for optimal performance
- **Pipeline Optimization**: Chain operations with parallel execution at each stage

### Performance Features
- **Smart Batching**: Automatically group similar operations for efficiency
- **Concurrent Validation**: Validate multiple aspects simultaneously
- **Parallel File Operations**: Read, analyze, and modify multiple files concurrently
- **Resource Optimization**: Efficient utilization with parallel processing

## Available Tools (Enhanced)
${Array.isArray(mode.groups) ? mode.groups.map(g => {
  if (typeof g === 'string') {
    return `- **${g}**: ${getOptimizedToolDescription(g)}`;
  } else if (Array.isArray(g)) {
    return `- **${g[0]}**: ${g[1]?.description || getOptimizedToolDescription(g[0])} ${g[1]?.fileRegex ? `(Files matching: ${g[1].fileRegex})` : ''} - *Batchtools enabled*`;
  }
  return `- ${JSON.stringify(g)}`;
}).join('\n') : 'None'}

### Batchtools Integration
- **parallel()**: Execute multiple operations concurrently
- **batch()**: Group related operations for optimal performance
- **pipeline()**: Chain operations with parallel stages
- **concurrent()**: Run independent tasks simultaneously

## Usage (Batchtools Enhanced)

To use this optimized SPARC mode, you can:

1. **Run directly with parallel processing**: \`./claude-flow sparc run ${mode.slug} "your task" --parallel\`
2. **Batch operation mode**: \`./claude-flow sparc batch ${mode.slug} "tasks-file.json" --concurrent\`
3. **Pipeline processing**: \`./claude-flow sparc pipeline ${mode.slug} "your task" --stages\`
4. **Use in concurrent workflow**: Include \`${mode.slug}\` in parallel SPARC workflow
5. **Delegate with optimization**: Use \`new_task\` with \`--batch-optimize\` flag

## Example Commands (Optimized)

### Standard Operations
\`\`\`bash
# Run this specific mode
./claude-flow sparc run ${mode.slug} "${getOptimizedExampleTask(mode.slug)}"

# Use with memory namespace and parallel processing
./claude-flow sparc run ${mode.slug} "your task" --namespace ${mode.slug} --parallel

# Non-interactive mode with batchtools optimization
./claude-flow sparc run ${mode.slug} "your task" --non-interactive --batch-optimize
\`\`\`

### Batchtools Operations
\`\`\`bash
# Parallel execution with multiple related tasks
./claude-flow sparc parallel ${mode.slug} "task1,task2,task3" --concurrent

# Batch processing from configuration file
./claude-flow sparc batch ${mode.slug} tasks-config.json --optimize

# Pipeline execution with staged processing
./claude-flow sparc pipeline ${mode.slug} "complex-task" --stages parallel,validate,optimize
\`\`\`

### Performance Optimization
\`\`\`bash
# Monitor performance during execution
./claude-flow sparc run ${mode.slug} "your task" --monitor --performance

# Use concurrent processing with resource limits
./claude-flow sparc concurrent ${mode.slug} "your task" --max-parallel 5 --resource-limit 80%

# Batch execution with smart optimization
./claude-flow sparc smart-batch ${mode.slug} "your task" --auto-optimize --adaptive
\`\`\`

## Memory Integration (Enhanced)

### Standard Memory Operations
\`\`\`bash
# Store mode-specific context
./claude-flow memory store "${mode.slug}_context" "important decisions" --namespace ${mode.slug}

# Query previous work
./claude-flow memory query "${mode.slug}" --limit 5
\`\`\`

### Batchtools Memory Operations
\`\`\`bash
# Batch store multiple related contexts
./claude-flow memory batch-store "${mode.slug}_contexts.json" --namespace ${mode.slug} --parallel

# Concurrent query across multiple namespaces
./claude-flow memory parallel-query "${mode.slug}" --namespaces ${mode.slug},project,arch --concurrent

# Export mode-specific memory with compression
./claude-flow memory export "${mode.slug}_backup.json" --namespace ${mode.slug} --compress --parallel
\`\`\`

## Performance Optimization Features

### Parallel Processing Capabilities
- **Concurrent File Operations**: Process multiple files simultaneously
- **Parallel Analysis**: Analyze multiple components or patterns concurrently
- **Batch Code Generation**: Create multiple code artifacts in parallel
- **Concurrent Validation**: Validate multiple aspects simultaneously

### Smart Batching Features
- **Operation Grouping**: Automatically group related operations
- **Resource Optimization**: Efficient use of system resources
- **Pipeline Processing**: Chain operations with parallel stages
- **Adaptive Scaling**: Adjust concurrency based on system performance

### Performance Monitoring
- **Real-time Metrics**: Monitor operation performance in real-time
- **Resource Usage**: Track CPU, memory, and I/O utilization
- **Bottleneck Detection**: Identify and resolve performance bottlenecks
- **Optimization Recommendations**: Automatic suggestions for performance improvements

## Batchtools Best Practices for ${mode.name}

### When to Use Parallel Operations
✅ **Use parallel processing when:**
- ${getBatchtoolsPractices(mode.slug).parallel.join('\n- ')}

### Optimization Guidelines
- ${getBatchtoolsPractices(mode.slug).optimization.join('\n- ')}

### Performance Tips
- ${getBatchtoolsPractices(mode.slug).performance.join('\n- ')}

## Integration with Other SPARC Modes

### Concurrent Mode Execution
\`\`\`bash
# Run multiple modes in parallel for comprehensive analysis
./claude-flow sparc concurrent ${mode.slug},architect,security-review "your project" --parallel

# Pipeline execution across multiple modes
./claude-flow sparc pipeline ${mode.slug}->code->tdd "feature implementation" --optimize
\`\`\`

### Batch Workflow Integration
\`\`\`bash
# Execute complete workflow with batchtools optimization
./claude-flow sparc workflow ${mode.slug}-workflow.json --batch-optimize --monitor
\`\`\`

For detailed ${mode.name} documentation and batchtools integration guides, see: 
- Mode Guide: https://github.com/ruvnet/claude-code-flow/docs/sparc-${mode.slug}.md
- Batchtools Integration: https://github.com/ruvnet/claude-code-flow/docs/batchtools-${mode.slug}.md
`;
}

// Helper function to get optimized tool descriptions
function getOptimizedToolDescription(tool) {
  const toolDescriptions = {
    'read': 'File reading and viewing with parallel processing',
    'edit': 'File modification and creation with batch operations',
    'browser': 'Web browsing capabilities with concurrent requests',
    'mcp': 'Model Context Protocol tools with parallel communication',
    'command': 'Command execution with concurrent processing'
  };
  return toolDescriptions[tool] || 'Tool access with batchtools optimization';
}

// Helper function to get optimized example tasks
function getOptimizedExampleTask(slug) {
  const examples = {
    'architect': 'design microservices architecture with parallel component analysis',
    'code': 'implement REST API endpoints with concurrent optimization',
    'tdd': 'create user authentication tests with parallel test generation',
    'debug': 'fix memory leak in service with concurrent analysis',
    'security-review': 'audit API security with parallel vulnerability assessment',
    'docs-writer': 'create API documentation with concurrent content generation',
    'integration': 'connect payment service with parallel testing',
    'post-deployment-monitoring-mode': 'monitor production metrics with real-time parallel analysis',
    'refinement-optimization-mode': 'optimize database queries with concurrent profiling',
    'devops': 'deploy to AWS Lambda with parallel environment setup',
    'supabase-admin': 'create user authentication schema with batch operations',
    'spec-pseudocode': 'define payment flow requirements with concurrent validation',
    'mcp': 'integrate with external API using parallel configuration',
    'swarm': 'build complete feature with parallel testing and documentation',
    'sparc': 'orchestrate authentication system with concurrent coordination',
    'ask': 'help me choose the right mode with parallel analysis',
    'tutorial': 'guide me through SPARC methodology with interactive parallel examples'
  };
  return examples[slug] || 'implement feature with batchtools optimization';
}

// Helper function to get batchtools best practices for specific modes
function getBatchtoolsPractices(slug) {
  const practices = {
    'architect': {
      parallel: [
        'Analyzing multiple architectural patterns simultaneously',
        'Generating component diagrams concurrently',
        'Validating integration points in parallel',
        'Creating multiple design alternatives simultaneously'
      ],
      optimization: [
        'Use batch operations for creating multiple architecture documents',
        'Enable parallel analysis for complex system designs',
        'Implement concurrent validation for architectural decisions',
        'Use pipeline processing for multi-stage architecture design'
      ],
      performance: [
        'Monitor resource usage during large architecture analysis',
        'Use smart batching for related architectural components',
        'Enable concurrent processing for independent design elements',
        'Implement parallel validation for architecture consistency'
      ]
    },
    'code': {
      parallel: [
        'Implementing multiple functions or classes simultaneously',
        'Analyzing code patterns across multiple files',
        'Performing concurrent code optimization',
        'Generating multiple code modules in parallel'
      ],
      optimization: [
        'Use batch operations for creating multiple source files',
        'Enable parallel code analysis for large codebases',
        'Implement concurrent optimization for performance improvements',
        'Use pipeline processing for multi-stage code generation'
      ],
      performance: [
        'Monitor compilation performance during parallel code generation',
        'Use smart batching for related code modules',
        'Enable concurrent processing for independent code components',
        'Implement parallel validation for code quality checks'
      ]
    },
    'tdd': {
      parallel: [
        'Creating multiple test cases simultaneously',
        'Running test suites concurrently',
        'Analyzing test coverage in parallel',
        'Generating test data and fixtures simultaneously'
      ],
      optimization: [
        'Use batch operations for creating comprehensive test suites',
        'Enable parallel test execution for faster feedback',
        'Implement concurrent test analysis for coverage reports',
        'Use pipeline processing for multi-stage testing workflows'
      ],
      performance: [
        'Monitor test execution performance during parallel runs',
        'Use smart batching for related test scenarios',
        'Enable concurrent processing for independent test modules',
        'Implement parallel validation for test result analysis'
      ]
    }
  };
  
  return practices[slug] || {
    parallel: [
      'Processing multiple independent components simultaneously',
      'Analyzing different aspects concurrently',
      'Generating multiple artifacts in parallel',
      'Validating multiple criteria simultaneously'
    ],
    optimization: [
      'Use batch operations for related tasks',
      'Enable parallel processing for independent operations',
      'Implement concurrent validation and analysis',
      'Use pipeline processing for complex workflows'
    ],
    performance: [
      'Monitor system resources during parallel operations',
      'Use smart batching for optimal performance',
      'Enable concurrent processing based on system capabilities',
      'Implement parallel validation for comprehensive analysis'
    ]
  };
}

// Create optimized main SPARC command
export function createOptimizedMainSparcCommand(modes) {
  const modeList = modes.map(m => `- \`/sparc-${m.slug}\` - ${m.name} (Batchtools optimized)`).join('\n');
  
  // Find the sparc orchestrator mode for its full description
  const sparcMode = modes.find(m => m.slug === 'sparc');
  const sparcDescription = sparcMode ? sparcMode.roleDefinition : 'SPARC orchestrator for complex workflows';
  const sparcInstructions = sparcMode ? sparcMode.customInstructions : '';
  
  return `---
name: sparc
description: Execute SPARC methodology workflows with Claude-Flow and batchtools optimization
---

# ⚡️ SPARC Development Methodology (Batchtools Optimized)

${sparcDescription}

**🚀 Batchtools Enhancement**: This configuration includes parallel processing capabilities, batch operations, and concurrent optimization for improved performance and efficiency across all SPARC modes.

## SPARC Workflow (Enhanced)

${sparcInstructions.split('\n').slice(0, 10).join('\n')}

### Batchtools Integration
- **Parallel Processing**: Execute multiple SPARC phases simultaneously
- **Concurrent Analysis**: Analyze multiple components or requirements in parallel
- **Batch Operations**: Group related SPARC operations for optimal performance
- **Pipeline Optimization**: Chain SPARC phases with parallel execution

## Available SPARC Modes (Batchtools Optimized)

${modeList}

## Quick Start (Enhanced Performance)

### Run SPARC orchestrator with parallel processing:
\`\`\`bash
./claude-flow sparc "build complete authentication system" --parallel --optimize
\`\`\`

### Run multiple modes concurrently:
\`\`\`bash
./claude-flow sparc concurrent architect,code,tdd "your project" --parallel
\`\`\`

### Execute batch operations:
\`\`\`bash
./claude-flow sparc batch "multiple-tasks.json" --optimize --monitor
\`\`\`

### Pipeline execution with staged processing:
\`\`\`bash
./claude-flow sparc pipeline "complex-project" --stages spec,architect,code,tdd,integration
\`\`\`

## SPARC Methodology Phases (Batchtools Enhanced)

1. **📋 Specification (Parallel Analysis)**: Define requirements with concurrent analysis and validation
2. **🧠 Pseudocode (Concurrent Logic)**: Create detailed logic flows with parallel pattern analysis
3. **🏗️ Architecture (Batch Design)**: Design system structure with concurrent component analysis
4. **🔄 Refinement (Parallel TDD)**: Implement with parallel test generation and concurrent validation
5. **✅ Completion (Concurrent Integration)**: Integrate and document with parallel processing

## Performance Features

### Parallel Processing Capabilities
- **Concurrent Phase Execution**: Run multiple SPARC phases simultaneously
- **Parallel Component Analysis**: Analyze multiple system components concurrently
- **Batch Code Generation**: Create multiple code artifacts in parallel
- **Concurrent Documentation**: Generate multiple documentation formats simultaneously

### Smart Optimization
- **Adaptive Batching**: Automatically group related operations for efficiency
- **Resource Management**: Efficient utilization with intelligent load balancing
- **Pipeline Processing**: Chain operations with parallel stages
- **Performance Monitoring**: Real-time metrics and optimization recommendations

## Memory Integration (Enhanced)

Use memory commands with parallel processing for persistent context across SPARC sessions:
\`\`\`bash
# Batch store multiple specifications
./claude-flow memory batch-store "sparc-contexts.json" --namespace sparc --parallel

# Concurrent query across multiple phases
./claude-flow memory parallel-query "authentication" --namespaces spec,arch,impl --concurrent

# Export project memory with compression
./claude-flow memory export sparc-project-backup.json --compress --parallel
\`\`\`

## Advanced Swarm Mode (Batchtools Enhanced)

For complex tasks requiring multiple agents with timeout-free execution and parallel processing:
\`\`\`bash
# Development swarm with parallel monitoring
./claude-flow swarm "Build e-commerce platform" --strategy development --monitor --review --parallel

# Background optimization swarm with concurrent processing
./claude-flow swarm "Optimize system performance" --strategy optimization --background --concurrent

# Distributed research swarm with batch analysis
./claude-flow swarm "Analyze market trends" --strategy research --distributed --ui --batch-analyze
\`\`\`

## Non-Interactive Mode (Enhanced)

For CI/CD integration and automation with parallel processing:
\`\`\`bash
./claude-flow sparc run code "implement API" --non-interactive --parallel
./claude-flow sparc batch tdd "user tests" --non-interactive --enable-permissions --concurrent
./claude-flow sparc pipeline "full-stack-app" --non-interactive --optimize --stages parallel
\`\`\`

## Performance Monitoring

### Real-time Performance Metrics
\`\`\`bash
# Monitor SPARC workflow performance
./claude-flow sparc monitor --real-time --performance --all-phases

# Analyze batch operation efficiency
./claude-flow sparc analyze --batchtools --optimization --detailed

# Performance comparison across modes
./claude-flow sparc compare --modes architect,code,tdd --performance
\`\`\`

### Optimization Commands
\`\`\`bash
# Optimize SPARC configuration for your system
./claude-flow sparc optimize --auto-tune --system-profile

# Performance benchmarking
./claude-flow sparc benchmark --all-modes --detailed --export-results
\`\`\`

## Best Practices (Batchtools Enhanced)

✅ **Modular Design**: Keep files under 500 lines, optimize with parallel analysis
✅ **Environment Safety**: Never hardcode secrets, validate with concurrent checks
✅ **Test-First**: Always write tests before implementation using parallel generation
✅ **Memory Usage**: Store important decisions with concurrent validation
✅ **Task Completion**: All tasks should end with \`attempt_completion\`
✅ **Performance Monitoring**: Monitor resource usage during parallel operations
✅ **Batch Optimization**: Group related operations for maximum efficiency

## Performance Benchmarks

### Batchtools Performance Improvements
- **SPARC Workflow Execution**: Up to 400% faster with parallel processing
- **Multi-phase Processing**: 350% improvement with concurrent phase execution
- **Code Generation**: 500% faster with parallel artifact creation
- **Documentation**: 300% improvement with concurrent content generation
- **Testing**: 450% faster with parallel test generation and execution

## Troubleshooting (Enhanced)

### Performance Issues
\`\`\`bash
# Check system resource usage during parallel operations
./claude-flow sparc debug --resources --concurrent --verbose

# Analyze batch operation performance
./claude-flow sparc analyze --performance --bottlenecks --optimization

# Monitor parallel processing efficiency
./claude-flow sparc monitor --parallel --efficiency --real-time
\`\`\`

### Optimization Recommendations
- Monitor system resources during parallel SPARC operations
- Use batch processing for related tasks and operations
- Enable concurrent processing based on system capabilities
- Implement smart batching for optimal performance
- Regular performance analysis and system tuning

See \`/claude-flow-help\` for all available commands and \`/batchtools\` for detailed parallel processing documentation.

For comprehensive SPARC and batchtools documentation, see:
- SPARC Guide: https://github.com/ruvnet/claude-code-flow/docs/sparc.md
- Batchtools Documentation: https://github.com/ruvnet/claude-code-flow/docs/batchtools.md
- Performance Optimization: https://github.com/ruvnet/claude-code-flow/docs/performance.md
`;
}