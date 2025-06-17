// init/batch-tools.ts - Batch tools coordination guides
export async function createBatchToolsGuide(): Promise<void> {
  const fs = await import('fs/promises');
  const path = await import('path');
  
  const batchToolsDir = '.claude/commands/swarm';
  
  const batchToolsGuide = `# Batch Tools Coordination Guide

## Overview
This guide explains how to use Claude Code's batch tools effectively for swarm orchestration and parallel task execution.

## Core Batch Tools

### TodoWrite/TodoRead - Task Coordination Engine
The foundation of all swarm operations - manages task distribution, progress tracking, and coordination.

#### TodoWrite Usage
\`\`\`javascript
// Create comprehensive task breakdown
TodoWrite([
  {
    id: "research_phase",
    content: "Research cloud architecture patterns",
    status: "pending",
    priority: "high",
    dependencies: [],
    estimatedTime: "30min",
    assignedAgent: "research_specialist"
  },
  {
    id: "analysis_phase", 
    content: "Analyze performance requirements",
    status: "pending",
    priority: "medium",
    dependencies: ["research_phase"],
    estimatedTime: "45min",
    assignedAgent: "performance_analyst"
  },
  {
    id: "implementation_phase",
    content: "Implement optimized solution",
    status: "pending", 
    priority: "high",
    dependencies: ["research_phase", "analysis_phase"],
    estimatedTime: "90min",
    assignedAgent: "implementation_specialist"
  }
]);
\`\`\`

#### TodoRead Monitoring
\`\`\`javascript
// Regular progress checks
const progress = TodoRead();
console.log("Current progress:", progress);

// Check specific task status
const researchStatus = TodoRead().find(task => task.id === "research_phase");
if (researchStatus.status === "completed") {
  // Trigger dependent tasks
  updateTaskStatus("analysis_phase", "in_progress");
}
\`\`\`

### Task Tool - Parallel Agent Orchestration
Launches multiple specialized agents simultaneously for maximum efficiency.

#### Basic Agent Launching
\`\`\`javascript
// Launch specialized agents for different domains
Task("Architecture Research", 
     "Research microservices architecture patterns and best practices for scalable systems");

Task("Performance Analysis", 
     "Analyze current system performance and identify optimization opportunities");

Task("Security Assessment", 
     "Conduct security analysis and identify potential vulnerabilities");
\`\`\`

#### Coordinated Agent Launching
\`\`\`javascript
// Launch agents with coordination instructions
Task("Frontend Development Team", \`
  Develop React components for user dashboard:
  - Use TodoWrite to track component development progress
  - Store component specifications in Memory under 'frontend_specs'
  - Coordinate with backend team through Memory shared state
  - Use batch Read operations for existing component analysis
\`);

Task("Backend Development Team", \`
  Develop API services for dashboard:
  - Check Memory 'frontend_specs' for component requirements
  - Use TodoWrite to track API endpoint development
  - Store API documentation in Memory under 'api_specs'
  - Coordinate database changes with data team
\`);
\`\`\`

### Memory Tool - Cross-Agent Knowledge Sharing
Enables persistent knowledge sharing and coordination across all agents.

#### Knowledge Storage Patterns
\`\`\`javascript
// Store research findings for other agents
Memory.store("architecture_research", {
  patterns: {
    microservices: {
      benefits: ["scalability", "maintainability", "technology_diversity"],
      challenges: ["complexity", "network_latency", "data_consistency"],
      recommendations: ["use_api_gateway", "implement_circuit_breakers"]
    },
    serverless: {
      benefits: ["cost_efficiency", "auto_scaling", "reduced_ops"],
      challenges: ["cold_starts", "vendor_lock_in", "debugging"],
      recommendations: ["warm_up_functions", "multi_cloud_strategy"]
    }
  },
  performance_requirements: {
    response_time: "< 200ms",
    throughput: "> 1000 rps", 
    availability: "99.9%"
  },
  timestamp: Date.now(),
  source: "research_specialist"
});

// Store analysis results
Memory.store("performance_analysis", {
  current_metrics: {
    avg_response_time: "450ms",
    peak_throughput: "750 rps",
    bottlenecks: ["database_queries", "external_api_calls"]
  },
  optimization_opportunities: [
    {area: "database", impact: "high", effort: "medium"},
    {area: "caching", impact: "high", effort: "low"},
    {area: "cdn", impact: "medium", effort: "low"}
  ],
  recommendations: {
    immediate: ["implement_redis_cache", "optimize_queries"],
    medium_term: ["add_cdn", "database_indexing"],
    long_term: ["microservices_migration", "auto_scaling"]
  }
});
\`\`\`

#### Cross-Agent Coordination
\`\`\`javascript
// Implementation agent retrieves and uses research/analysis
const architectureData = Memory.retrieve("architecture_research");
const performanceData = Memory.retrieve("performance_analysis");

// Use combined knowledge for implementation
const implementationPlan = {
  architecture: architectureData.patterns.microservices,
  performance_targets: architectureData.performance_requirements,
  optimizations: performanceData.recommendations.immediate,
  implementation_order: [
    "setup_redis_cache",
    "optimize_database_queries", 
    "implement_api_gateway",
    "add_circuit_breakers"
  ]
};

Memory.store("implementation_plan", implementationPlan);
\`\`\`

### Batch File Operations - Efficient I/O Management
Maximize efficiency by batching file operations and searches.

#### Parallel File Reading
\`\`\`javascript
// Read multiple configuration files simultaneously
Read("config/database.json");
Read("config/api.json");
Read("config/cache.json");
Read("config/monitoring.json");

// Read source code for analysis
Read("src/services/user-service.ts");
Read("src/services/order-service.ts");
Read("src/services/payment-service.ts");
Read("src/middleware/auth.ts");
Read("src/middleware/validation.ts");
\`\`\`

#### Batch Search Operations
\`\`\`javascript
// Search for different patterns simultaneously
Glob("**/*.ts");           // All TypeScript files
Glob("**/*.test.ts");      // All test files
Glob("**/package.json");   // All package definitions
Glob("**/*.env*");         // All environment files

// Search for code patterns
Grep("TODO|FIXME|HACK", "**/*.ts");     // Code comments
Grep("console\\.log", "**/*.ts");        // Debug statements
Grep("any\\s", "**/*.ts");               // TypeScript any usage
Grep("fetch\\(|axios", "**/*.ts");       // API calls
\`\`\`

#### Coordinated File Modifications
\`\`\`javascript
// Edit multiple files with coordination
Edit("src/config/database.ts", oldConfig, optimizedConfig);
Edit("src/services/cache.ts", oldCacheLogic, newCacheLogic);
Edit("src/middleware/performance.ts", oldMiddleware, optimizedMiddleware);

// Write new files as part of coordinated implementation
Write("src/services/redis-cache.ts", redisCacheImplementation);
Write("src/monitoring/performance-metrics.ts", metricsImplementation);
Write("docs/performance-optimization.md", optimizationDocumentation);
\`\`\`

## Advanced Coordination Patterns

### Research Swarm Pattern
\`\`\`javascript
// 1. Initialize research coordination
TodoWrite([
  {id: "domain_research", content: "Research domain-specific patterns", status: "pending", priority: "high"},
  {id: "competitive_analysis", content: "Analyze competitor solutions", status: "pending", priority: "medium"},
  {id: "technology_evaluation", content: "Evaluate technology options", status: "pending", priority: "high"},
  {id: "synthesis", content: "Synthesize findings into recommendations", status: "pending", priority: "high"}
]);

// 2. Launch parallel research agents
Task("Domain Expert", "Research best practices and patterns for the specific domain");
Task("Competitive Analyst", "Analyze competitor solutions and market approaches");
Task("Technology Evaluator", "Evaluate and compare technology options");

// 3. Agents store findings in Memory with structured keys
// Each agent uses Memory.store() with domain-specific keys

// 4. Synthesis agent combines all findings
Task("Research Synthesizer", \`
  Retrieve all research findings from Memory:
  - domain_research findings
  - competitive_analysis results
  - technology_evaluation data
  
  Synthesize into comprehensive recommendations and store final results
\`);
\`\`\`

### Development Swarm Pattern
\`\`\`javascript
// 1. Create development roadmap
TodoWrite([
  {id: "architecture_design", content: "Design system architecture", status: "pending", priority: "high"},
  {id: "frontend_development", content: "Develop frontend components", status: "pending", priority: "medium"},
  {id: "backend_development", content: "Develop backend services", status: "pending", priority: "medium"},
  {id: "integration_testing", content: "Integration and testing", status: "pending", priority: "high"},
  {id: "deployment_setup", content: "Setup deployment pipeline", status: "pending", priority: "medium"}
]);

// 2. Architecture phase
Task("System Architect", \`
  Design system architecture:
  - Use Memory to retrieve research findings
  - Create component specifications
  - Define API contracts
  - Store architecture decisions in Memory
\`);

// 3. Parallel development (after architecture)
Task("Frontend Team", \`
  Develop frontend components:
  - Retrieve architecture specs from Memory
  - Use batch Read operations for existing code analysis
  - Implement components using batch Write/Edit operations
  - Store component documentation in Memory
\`);

Task("Backend Team", \`
  Develop backend services:
  - Retrieve architecture and API specs from Memory
  - Implement services using batch file operations
  - Store service documentation and test results
\`);

// 4. Integration and testing
Task("Integration Team", \`
  Integration and testing:
  - Retrieve all component specifications from Memory
  - Use batch testing operations
  - Coordinate deployment with DevOps team
\`);
\`\`\`

### Analysis Swarm Pattern
\`\`\`javascript
// 1. Analysis task breakdown
TodoWrite([
  {id: "data_collection", content: "Collect and prepare data", status: "pending", priority: "high"},
  {id: "statistical_analysis", content: "Perform statistical analysis", status: "pending", priority: "medium"},
  {id: "pattern_detection", content: "Detect patterns and anomalies", status: "pending", priority: "medium"},
  {id: "visualization", content: "Create visualizations and reports", status: "pending", priority: "low"},
  {id: "insights_synthesis", content: "Synthesize insights and recommendations", status: "pending", priority: "high"}
]);

// 2. Data collection and preparation
Task("Data Collector", \`
  Collect and prepare data:
  - Use batch Read operations for data files
  - Clean and structure data
  - Store prepared datasets in Memory
\`);

// 3. Parallel analysis agents
Task("Statistical Analyst", "Perform statistical analysis on prepared data");
Task("Pattern Detection Specialist", "Detect patterns, trends, and anomalies");
Task("Visualization Specialist", "Create charts, graphs, and dashboards");

// 4. Insights synthesis
Task("Analysis Synthesizer", \`
  Synthesize analysis results:
  - Retrieve all analysis results from Memory
  - Combine statistical findings with pattern detection
  - Generate comprehensive insights and recommendations
\`);
\`\`\`

## Performance Optimization Guidelines

### Efficient Task Distribution
- Break down complex tasks into independent subtasks
- Use TodoWrite to define clear dependencies
- Launch parallel agents only for truly independent work
- Coordinate through Memory rather than sequential communication

### Memory Usage Optimization
- Use structured keys for easy retrieval
- Store intermediate results for reuse across agents
- Clean up memory after task completion
- Use namespacing for complex operations

### Batch Operation Efficiency
- Group similar file operations together
- Use parallel Read operations for multiple files
- Batch search operations with similar patterns
- Coordinate file modifications to avoid conflicts

### Resource Management
- Monitor system resources during execution
- Adjust agent count based on available resources
- Use appropriate coordination modes for task complexity
- Implement graceful degradation for resource constraints

## Error Handling and Recovery

### Robust Task Planning
\`\`\`javascript
TodoWrite([
  {id: "main_task", content: "Primary objective", status: "pending", priority: "high"},
  {id: "validation_task", content: "Validate results", status: "pending", priority: "high"},
  {id: "error_recovery", content: "Handle errors and recovery", status: "pending", priority: "medium"},
  {id: "rollback_plan", content: "Rollback procedure if needed", status: "pending", priority: "low"}
]);
\`\`\`

### Error State Management
\`\`\`javascript
// Store error states for debugging and recovery
Memory.store("error_state", {
  task_id: "failed_task",
  error_type: "api_timeout",
  error_message: "Connection timeout after 30 seconds",
  recovery_options: ["retry_with_backoff", "use_alternative_api", "manual_intervention"],
  timestamp: Date.now()
});
\`\`\`

### Graceful Degradation
- Implement fallback strategies for critical operations
- Use Memory to store partial results for recovery
- Plan rollback procedures in TodoWrite tasks
- Monitor agent health and implement recovery procedures

This guide provides the foundation for effective batch tool coordination in Claude-Flow swarm operations.
`;
  
  await fs.writeFile(path.join(batchToolsDir, 'batch-tools-guide.md'), batchToolsGuide);
  console.log('  ✅ Created batch-tools-guide.md');
}