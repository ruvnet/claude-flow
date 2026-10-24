// sparc-modes.js - SPARC mode file templates

export function createSparcModesOverview() {
  return `# SPARC Modes Overview

SPARC (Specification, Planning, Architecture, Review, Code) is a comprehensive development methodology with 17 specialized modes.

## Available Modes

### Core Orchestration Modes
- **orchestrator**: Multi-agent task orchestration
- **swarm-coordinator**: Specialized swarm management
- **workflow-manager**: Process automation
- **batch-executor**: Parallel task execution

### Development Modes  
- **coder**: Autonomous code generation
- **architect**: System design
- **reviewer**: Code review
- **tdd**: Test-driven development

### Analysis and Research Modes
- **researcher**: Deep research capabilities
- **analyzer**: Code and data analysis
- **optimizer**: Performance optimization

### Creative and Support Modes
- **designer**: UI/UX design
- **innovator**: Creative problem solving
- **documenter**: Documentation generation
- **debugger**: Systematic debugging
- **tester**: Comprehensive testing
- **memory-manager**: Knowledge management

## Usage
\`\`\`bash
# Run a specific mode
./claude-flow@alpha sparc run <mode> "task description"

# List all modes
./claude-flow@alpha sparc modes

# Get help for a mode
./claude-flow@alpha sparc help <mode>
\`\`\`
`;
}

export function createSwarmStrategyTemplates() {
  return {
    'analysis.md': createAnalysisStrategy(),
    'development.md': createDevelopmentStrategy(),
    'examples.md': createExamplesStrategy(),
    'maintenance.md': createMaintenanceStrategy(),
    'optimization.md': createOptimizationStrategy(),
    'research.md': createResearchStrategy(),
    'testing.md': createTestingStrategy(),
  };
}

function createAnalysisStrategy() {
  return `# Analysis Swarm Strategy

## Purpose
Comprehensive analysis through distributed agent coordination.

## Activation

### Option 1: Using MCP Tools (Preferred in Claude Code)
\`\`\`javascript
mcp__claude-flow@alpha__swarm_init {
  topology: "mesh",
  strategy: "analysis",
  maxAgents: 6
}

mcp__claude-flow@alpha__task_orchestrate {
  task: "analyze system performance",
  strategy: "distributed"
}
\`\`\`

### Option 2: Using NPX CLI (Fallback when MCP not available)
\`\`\`bash
# Use when running from terminal or MCP tools unavailable
npx claude-flow@alpha swarm "analyze system performance" --strategy analysis

# For alpha features
npx claude-flow@alpha swarm "analyze system performance" --strategy analysis
\`\`\`

### Option 3: Local Installation
\`\`\`bash
# If claude-flow@alpha is installed locally
./claude-flow@alpha swarm "analyze system performance" --strategy analysis
\`\`\`

## Agent Roles
- Data Collector: Gathers metrics and logs
- Pattern Analyzer: Identifies trends and anomalies
- Report Generator: Creates comprehensive reports
- Insight Synthesizer: Combines findings

## Coordination Modes
- Mesh: For exploratory analysis
- Pipeline: For sequential processing
- Hierarchical: For complex systems
`;
}

function createDevelopmentStrategy() {
  return `# Development Swarm Strategy

## Purpose
Coordinated development through specialized agent teams.

## Activation

### Option 1: Using MCP Tools (Preferred in Claude Code)
\`\`\`javascript
mcp__claude-flow@alpha__swarm_init {
  topology: "hierarchical",
  strategy: "development",
  maxAgents: 8
}

mcp__claude-flow@alpha__task_orchestrate {
  task: "build feature X",
  strategy: "parallel"
}
\`\`\`

### Option 2: Using NPX CLI (Fallback when MCP not available)
\`\`\`bash
# Use when running from terminal or MCP tools unavailable
npx claude-flow@alpha swarm "build feature X" --strategy development

# For alpha features
npx claude-flow@alpha swarm "build feature X" --strategy development
\`\`\`

### Option 3: Local Installation
\`\`\`bash
# If claude-flow@alpha is installed locally
./claude-flow@alpha swarm "build feature X" --strategy development
\`\`\`

## Agent Roles
- Architect: Designs system structure
- Frontend Developer: Implements UI
- Backend Developer: Creates APIs
- Database Specialist: Manages data layer
- Integration Expert: Connects components

## Best Practices
- Use hierarchical mode for large projects
- Enable parallel execution
- Implement continuous testing
`;
}

function createExamplesStrategy() {
  return `# Examples Swarm Strategy

## Common Swarm Patterns

### Research Swarm
\`\`\`bash
./claude-flow@alpha swarm "research AI trends" \\
  --strategy research \\
  --mode distributed \\
  --max-agents 6 \\
  --parallel
\`\`\`

### Development Swarm
\`\`\`bash
./claude-flow@alpha swarm "build REST API" \\
  --strategy development \\
  --mode hierarchical \\
  --monitor \\
  --output sqlite
\`\`\`

### Analysis Swarm
\`\`\`bash
./claude-flow@alpha swarm "analyze codebase" \\
  --strategy analysis \\
  --mode mesh \\
  --parallel \\
  --timeout 300
\`\`\`
`;
}

function createMaintenanceStrategy() {
  return `# Maintenance Swarm Strategy

## Purpose
System maintenance and updates through coordinated agents.

## Activation

### Option 1: Using MCP Tools (Preferred in Claude Code)
\`\`\`javascript
mcp__claude-flow@alpha__swarm_init {
  topology: "hierarchical",
  strategy: "maintenance",
  maxAgents: 5
}

mcp__claude-flow@alpha__task_orchestrate {
  task: "update dependencies",
  strategy: "sequential",
  priority: "high"
}
\`\`\`

### Option 2: Using NPX CLI (Fallback when MCP not available)
\`\`\`bash
# Use when running from terminal or MCP tools unavailable
npx claude-flow@alpha swarm "update dependencies" --strategy maintenance

# For alpha features
npx claude-flow@alpha swarm "update dependencies" --strategy maintenance
\`\`\`

### Option 3: Local Installation
\`\`\`bash
# If claude-flow@alpha is installed locally
./claude-flow@alpha swarm "update dependencies" --strategy maintenance
\`\`\`

## Agent Roles
- Dependency Analyzer: Checks for updates
- Security Scanner: Identifies vulnerabilities
- Test Runner: Validates changes
- Documentation Updater: Maintains docs

## Safety Features
- Automatic backups
- Rollback capability
- Incremental updates
`;
}

function createOptimizationStrategy() {
  return `# Optimization Swarm Strategy

## Purpose
Performance optimization through specialized analysis.

## Activation

### Option 1: Using MCP Tools (Preferred in Claude Code)
\`\`\`javascript
mcp__claude-flow@alpha__swarm_init {
  topology: "mesh",
  strategy: "optimization",
  maxAgents: 6
}

mcp__claude-flow@alpha__task_orchestrate {
  task: "optimize performance",
  strategy: "parallel"
}
\`\`\`

### Option 2: Using NPX CLI (Fallback when MCP not available)
\`\`\`bash
# Use when running from terminal or MCP tools unavailable
npx claude-flow@alpha swarm "optimize performance" --strategy optimization

# For alpha features
npx claude-flow@alpha swarm "optimize performance" --strategy optimization
\`\`\`

### Option 3: Local Installation
\`\`\`bash
# If claude-flow@alpha is installed locally
./claude-flow@alpha swarm "optimize performance" --strategy optimization
\`\`\`

## Agent Roles
- Performance Profiler: Identifies bottlenecks
- Memory Analyzer: Detects leaks
- Code Optimizer: Implements improvements
- Benchmark Runner: Measures impact

## Optimization Areas
- Execution speed
- Memory usage
- Network efficiency
- Bundle size
`;
}

function createResearchStrategy() {
  return `# Research Swarm Strategy

## Purpose
Deep research through parallel information gathering.

## Activation

### Option 1: Using MCP Tools (Preferred in Claude Code)
\`\`\`javascript
mcp__claude-flow@alpha__swarm_init {
  topology: "distributed",
  strategy: "research",
  maxAgents: 6
}

mcp__claude-flow@alpha__task_orchestrate {
  task: "research topic X",
  strategy: "parallel"
}
\`\`\`

### Option 2: Using NPX CLI (Fallback when MCP not available)
\`\`\`bash
# Use when running from terminal or MCP tools unavailable
npx claude-flow@alpha swarm "research topic X" --strategy research

# For alpha features
npx claude-flow@alpha swarm "research topic X" --strategy research
\`\`\`

### Option 3: Local Installation
\`\`\`bash
# If claude-flow@alpha is installed locally
./claude-flow@alpha swarm "research topic X" --strategy research
\`\`\`

## Agent Roles
- Web Researcher: Searches online sources
- Academic Researcher: Analyzes papers
- Data Analyst: Processes findings
- Report Writer: Synthesizes results

## Research Methods
- Parallel web searches
- Cross-reference validation
- Source credibility assessment
`;
}

function createTestingStrategy() {
  return `# Testing Swarm Strategy

## Purpose
Comprehensive testing through distributed execution.

## Activation

### Option 1: Using MCP Tools (Preferred in Claude Code)
\`\`\`javascript
mcp__claude-flow@alpha__swarm_init {
  topology: "distributed",
  strategy: "testing",
  maxAgents: 5
}

mcp__claude-flow@alpha__task_orchestrate {
  task: "test application",
  strategy: "parallel"
}
\`\`\`

### Option 2: Using NPX CLI (Fallback when MCP not available)
\`\`\`bash
# Use when running from terminal or MCP tools unavailable
npx claude-flow@alpha swarm "test application" --strategy testing

# For alpha features
npx claude-flow@alpha swarm "test application" --strategy testing
\`\`\`

### Option 3: Local Installation
\`\`\`bash
# If claude-flow@alpha is installed locally
./claude-flow@alpha swarm "test application" --strategy testing
\`\`\`

## Agent Roles
- Unit Tester: Tests individual components
- Integration Tester: Validates interactions
- E2E Tester: Tests user flows
- Performance Tester: Measures metrics
- Security Tester: Finds vulnerabilities

## Test Coverage
- Code coverage analysis
- Edge case identification
- Regression prevention
`;
}

export function createSparcModeTemplates() {
  return {
    'analyzer.md': createAnalyzerMode(),
    'architect.md': createArchitectMode(),
    'batch-executor.md': createBatchExecutorMode(),
    'coder.md': createCoderMode(),
    'debugger.md': createDebuggerMode(),
    'designer.md': createDesignerMode(),
    'documenter.md': createDocumenterMode(),
    'innovator.md': createInnovatorMode(),
    'memory-manager.md': createMemoryManagerMode(),
    'optimizer.md': createOptimizerMode(),
    'orchestrator.md': createOrchestratorMode(),
    'researcher.md': createResearcherMode(),
    'reviewer.md': createReviewerMode(),
    'swarm-coordinator.md': createSwarmCoordinatorMode(),
    'tdd.md': createTddMode(),
    'tester.md': createTesterMode(),
    'workflow-manager.md': createWorkflowManagerMode(),
  };
}

function createAnalyzerMode() {
  return `# SPARC Analyzer Mode

## Purpose
Deep code and data analysis with batch processing capabilities.

## Activation

### Option 1: Using MCP Tools (Preferred in Claude Code)
\`\`\`javascript
mcp__claude-flow@alpha__sparc_mode {
  mode: "analyzer",
  task_description: "analyze codebase performance",
  options: {
    parallel: true,
    detailed: true
  }
}
\`\`\`

### Option 2: Using NPX CLI (Fallback when MCP not available)
\`\`\`bash
# Use when running from terminal or MCP tools unavailable
npx claude-flow@alpha sparc run analyzer "analyze codebase performance"

# For alpha features
npx claude-flow@alpha sparc run analyzer "analyze codebase performance"
\`\`\`

### Option 3: Local Installation
\`\`\`bash
# If claude-flow@alpha is installed locally
./claude-flow@alpha sparc run analyzer "analyze codebase performance"
\`\`\`

## Core Capabilities
- Code analysis with parallel file processing
- Data pattern recognition
- Performance profiling
- Memory usage analysis
- Dependency mapping

## Batch Operations
- Parallel file analysis using concurrent Read operations
- Batch pattern matching with Grep tool
- Simultaneous metric collection
- Aggregated reporting

## Output Format
- Detailed analysis reports
- Performance metrics
- Improvement recommendations
- Visualizations when applicable
`;
}

function createArchitectMode() {
  return `# SPARC Architect Mode

## Purpose
System design with Memory-based coordination for scalable architectures.

## Activation

### Option 1: Using MCP Tools (Preferred in Claude Code)
\`\`\`javascript
mcp__claude-flow@alpha__sparc_mode {
  mode: "architect",
  task_description: "design microservices architecture",
  options: {
    detailed: true,
    memory_enabled: true
  }
}
\`\`\`

### Option 2: Using NPX CLI (Fallback when MCP not available)
\`\`\`bash
# Use when running from terminal or MCP tools unavailable
npx claude-flow@alpha sparc run architect "design microservices architecture"

# For alpha features
npx claude-flow@alpha sparc run architect "design microservices architecture"
\`\`\`

### Option 3: Local Installation
\`\`\`bash
# If claude-flow@alpha is installed locally
./claude-flow@alpha sparc run architect "design microservices architecture"
\`\`\`

## Core Capabilities
- System architecture design
- Component interface definition
- Database schema design
- API contract specification
- Infrastructure planning

## Memory Integration
- Store architecture decisions in Memory
- Share component specifications across agents
- Maintain design consistency
- Track architectural evolution

## Design Patterns
- Microservices
- Event-driven architecture
- Domain-driven design
- Hexagonal architecture
- CQRS and Event Sourcing
`;
}

function createBatchExecutorMode() {
  return `# SPARC Batch Executor Mode

## Purpose
Parallel task execution specialist using batch operations.

## Activation

### Option 1: Using MCP Tools (Preferred in Claude Code)
\`\`\`javascript
mcp__claude-flow@alpha__sparc_mode {
  mode: "batch-executor",
  task_description: "process multiple files",
  options: {
    parallel: true,
    batch_size: 10
  }
}
\`\`\`

### Option 2: Using NPX CLI (Fallback when MCP not available)
\`\`\`bash
# Use when running from terminal or MCP tools unavailable
npx claude-flow@alpha sparc run batch-executor "process multiple files"

# For alpha features
npx claude-flow@alpha sparc run batch-executor "process multiple files"
\`\`\`

### Option 3: Local Installation
\`\`\`bash
# If claude-flow@alpha is installed locally
./claude-flow@alpha sparc run batch-executor "process multiple files"
\`\`\`

## Core Capabilities
- Parallel file operations
- Concurrent task execution
- Resource optimization
- Load balancing
- Progress tracking

## Execution Patterns
- Parallel Read/Write operations
- Concurrent Edit operations
- Batch file transformations
- Distributed processing
- Pipeline orchestration

## Performance Features
- Dynamic resource allocation
- Automatic load balancing
- Progress monitoring
- Error recovery
- Result aggregation
`;
}

function createCoderMode() {
  return `# SPARC Coder Mode

## Purpose
Autonomous code generation with batch file operations.

## Activation

### Option 1: Using MCP Tools (Preferred in Claude Code)
\`\`\`javascript
mcp__claude-flow@alpha__sparc_mode {
  mode: "coder",
  task_description: "implement user authentication",
  options: {
    test_driven: true,
    parallel_edits: true
  }
}
\`\`\`

### Option 2: Using NPX CLI (Fallback when MCP not available)
\`\`\`bash
# Use when running from terminal or MCP tools unavailable
npx claude-flow@alpha sparc run coder "implement user authentication"

# For alpha features
npx claude-flow@alpha sparc run coder "implement user authentication"
\`\`\`

### Option 3: Local Installation
\`\`\`bash
# If claude-flow@alpha is installed locally
./claude-flow@alpha sparc run coder "implement user authentication"
\`\`\`

## Core Capabilities
- Feature implementation
- Code refactoring
- Bug fixes
- API development
- Algorithm implementation

## Batch Operations
- Parallel file creation
- Concurrent code modifications
- Batch import updates
- Test file generation
- Documentation updates

## Code Quality
- ES2022 standards
- Type safety with TypeScript
- Comprehensive error handling
- Performance optimization
- Security best practices
`;
}

function createDebuggerMode() {
  return `# SPARC Debugger Mode

## Purpose
Systematic debugging with TodoWrite and Memory integration.

## Activation

### Option 1: Using MCP Tools (Preferred in Claude Code)
\`\`\`javascript
mcp__claude-flow@alpha__sparc_mode {
  mode: "debugger",
  task_description: "fix authentication issues",
  options: {
    verbose: true,
    trace: true
  }
}
\`\`\`

### Option 2: Using NPX CLI (Fallback when MCP not available)
\`\`\`bash
# Use when running from terminal or MCP tools unavailable
npx claude-flow@alpha sparc run debugger "fix authentication issues"

# For alpha features
npx claude-flow@alpha sparc run debugger "fix authentication issues"
\`\`\`

### Option 3: Local Installation
\`\`\`bash
# If claude-flow@alpha is installed locally
./claude-flow@alpha sparc run debugger "fix authentication issues"
\`\`\`

## Core Capabilities
- Issue reproduction
- Root cause analysis
- Stack trace analysis
- Memory leak detection
- Performance bottleneck identification

## Debugging Workflow
1. Create debugging plan with TodoWrite
2. Systematic issue investigation
3. Store findings in Memory
4. Track fix progress
5. Verify resolution

## Tools Integration
- Error log analysis
- Breakpoint simulation
- Variable inspection
- Call stack tracing
- Memory profiling
`;
}

function createDesignerMode() {
  return `# SPARC Designer Mode

## Purpose
UI/UX design with Memory coordination for consistent experiences.

## Activation

### Option 1: Using MCP Tools (Preferred in Claude Code)
\`\`\`javascript
mcp__claude-flow@alpha__sparc_mode {
  mode: "designer",
  task_description: "create dashboard UI",
  options: {
    design_system: true,
    responsive: true
  }
}
\`\`\`

### Option 2: Using NPX CLI (Fallback when MCP not available)
\`\`\`bash
# Use when running from terminal or MCP tools unavailable
npx claude-flow@alpha sparc run designer "create dashboard UI"

# For alpha features
npx claude-flow@alpha sparc run designer "create dashboard UI"
\`\`\`

### Option 3: Local Installation
\`\`\`bash
# If claude-flow@alpha is installed locally
./claude-flow@alpha sparc run designer "create dashboard UI"
\`\`\`

## Core Capabilities
- Interface design
- Component architecture
- Design system creation
- Accessibility planning
- Responsive layouts

## Design Process
- User research insights
- Wireframe creation
- Component design
- Interaction patterns
- Design token management

## Memory Coordination
- Store design decisions
- Share component specs
- Maintain consistency
- Track design evolution
`;
}

function createDocumenterMode() {
  return `# SPARC Documenter Mode

## Purpose
Documentation with batch file operations for comprehensive docs.

## Activation

### Option 1: Using MCP Tools (Preferred in Claude Code)
\`\`\`javascript
mcp__claude-flow@alpha__sparc_mode {
  mode: "documenter",
  task_description: "create API documentation",
  options: {
    format: "markdown",
    include_examples: true
  }
}
\`\`\`

### Option 2: Using NPX CLI (Fallback when MCP not available)
\`\`\`bash
# Use when running from terminal or MCP tools unavailable
npx claude-flow@alpha sparc run documenter "create API documentation"

# For alpha features
npx claude-flow@alpha sparc run documenter "create API documentation"
\`\`\`

### Option 3: Local Installation
\`\`\`bash
# If claude-flow@alpha is installed locally
./claude-flow@alpha sparc run documenter "create API documentation"
\`\`\`

## Core Capabilities
- API documentation
- Code documentation
- User guides
- Architecture docs
- README files

## Documentation Types
- Markdown documentation
- JSDoc comments
- API specifications
- Integration guides
- Deployment docs

## Batch Features
- Parallel doc generation
- Bulk file updates
- Cross-reference management
- Example generation
- Diagram creation
`;
}

function createInnovatorMode() {
  return `# SPARC Innovator Mode

## Purpose
Creative problem solving with WebSearch and Memory integration.

## Activation

### Option 1: Using MCP Tools (Preferred in Claude Code)
\`\`\`javascript
mcp__claude-flow@alpha__sparc_mode {
  mode: "innovator",
  task_description: "innovative solutions for scaling",
  options: {
    research_depth: "comprehensive",
    creativity_level: "high"
  }
}
\`\`\`

### Option 2: Using NPX CLI (Fallback when MCP not available)
\`\`\`bash
# Use when running from terminal or MCP tools unavailable
npx claude-flow@alpha sparc run innovator "innovative solutions for scaling"

# For alpha features
npx claude-flow@alpha sparc run innovator "innovative solutions for scaling"
\`\`\`

### Option 3: Local Installation
\`\`\`bash
# If claude-flow@alpha is installed locally
./claude-flow@alpha sparc run innovator "innovative solutions for scaling"
\`\`\`

## Core Capabilities
- Creative ideation
- Solution brainstorming
- Technology exploration
- Pattern innovation
- Proof of concept

## Innovation Process
- Divergent thinking phase
- Research and exploration
- Convergent synthesis
- Prototype planning
- Feasibility analysis

## Knowledge Sources
- WebSearch for trends
- Memory for context
- Cross-domain insights
- Pattern recognition
- Analogical reasoning
`;
}

function createMemoryManagerMode() {
  return `# SPARC Memory Manager Mode

## Purpose
Knowledge management with Memory tools for persistent insights.

## Activation

### Option 1: Using MCP Tools (Preferred in Claude Code)
\`\`\`javascript
mcp__claude-flow@alpha__sparc_mode {
  mode: "memory-manager",
  task_description: "organize project knowledge",
  options: {
    namespace: "project",
    auto_organize: true
  }
}
\`\`\`

### Option 2: Using NPX CLI (Fallback when MCP not available)
\`\`\`bash
# Use when running from terminal or MCP tools unavailable
npx claude-flow@alpha sparc run memory-manager "organize project knowledge"

# For alpha features
npx claude-flow@alpha sparc run memory-manager "organize project knowledge"
\`\`\`

### Option 3: Local Installation
\`\`\`bash
# If claude-flow@alpha is installed locally
./claude-flow@alpha sparc run memory-manager "organize project knowledge"
\`\`\`

## Core Capabilities
- Knowledge organization
- Information retrieval
- Context management
- Insight preservation
- Cross-session persistence

## Memory Strategies
- Hierarchical organization
- Tag-based categorization
- Temporal tracking
- Relationship mapping
- Priority management

## Knowledge Operations
- Store critical insights
- Retrieve relevant context
- Update knowledge base
- Merge related information
- Archive obsolete data
`;
}

function createOptimizerMode() {
  return `# SPARC Optimizer Mode

## Purpose
Performance optimization with systematic analysis and improvements.

## Activation

### Option 1: Using MCP Tools (Preferred in Claude Code)
\`\`\`javascript
mcp__claude-flow@alpha__sparc_mode {
  mode: "optimizer",
  task_description: "optimize application performance",
  options: {
    profile: true,
    benchmark: true
  }
}
\`\`\`

### Option 2: Using NPX CLI (Fallback when MCP not available)
\`\`\`bash
# Use when running from terminal or MCP tools unavailable
npx claude-flow@alpha sparc run optimizer "optimize application performance"

# For alpha features
npx claude-flow@alpha sparc run optimizer "optimize application performance"
\`\`\`

### Option 3: Local Installation
\`\`\`bash
# If claude-flow@alpha is installed locally
./claude-flow@alpha sparc run optimizer "optimize application performance"
\`\`\`

## Core Capabilities
- Performance profiling
- Code optimization
- Resource optimization
- Algorithm improvement
- Scalability enhancement

## Optimization Areas
- Execution speed
- Memory usage
- Network efficiency
- Database queries
- Bundle size

## Systematic Approach
1. Baseline measurement
2. Bottleneck identification
3. Optimization implementation
4. Impact verification
5. Continuous monitoring
`;
}

function createOrchestratorMode() {
  return `# SPARC Orchestrator Mode

## Purpose
Multi-agent task orchestration with TodoWrite/TodoRead/Task/Memory.

## Activation

### Option 1: Using MCP Tools (Preferred in Claude Code)
\`\`\`javascript
mcp__claude-flow@alpha__sparc_mode {
  mode: "orchestrator",
  task_description: "coordinate feature development",
  options: {
    parallel: true,
    monitor: true
  }
}
\`\`\`

### Option 2: Using NPX CLI (Fallback when MCP not available)
\`\`\`bash
# Use when running from terminal or MCP tools unavailable
npx claude-flow@alpha sparc run orchestrator "coordinate feature development"

# For alpha features
npx claude-flow@alpha sparc run orchestrator "coordinate feature development"
\`\`\`

### Option 3: Local Installation
\`\`\`bash
# If claude-flow@alpha is installed locally
./claude-flow@alpha sparc run orchestrator "coordinate feature development"
\`\`\`

## Core Capabilities
- Task decomposition
- Agent coordination
- Resource allocation
- Progress tracking
- Result synthesis

## Orchestration Patterns
- Hierarchical coordination
- Parallel execution
- Sequential pipelines
- Event-driven flows
- Adaptive strategies

## Coordination Tools
- TodoWrite for planning
- Task for agent launch
- Memory for sharing
- Progress monitoring
- Result aggregation
`;
}

function createResearcherMode() {
  return `# SPARC Researcher Mode

## Purpose
Deep research with parallel WebSearch/WebFetch and Memory coordination.

## Activation

### Option 1: Using MCP Tools (Preferred in Claude Code)
\`\`\`javascript
mcp__claude-flow@alpha__sparc_mode {
  mode: "researcher",
  task_description: "research AI trends 2024",
  options: {
    depth: "comprehensive",
    sources: ["academic", "industry", "news"]
  }
}
\`\`\`

### Option 2: Using NPX CLI (Fallback when MCP not available)
\`\`\`bash
# Use when running from terminal or MCP tools unavailable
npx claude-flow@alpha sparc run researcher "research AI trends 2024"

# For alpha features
npx claude-flow@alpha sparc run researcher "research AI trends 2024"
\`\`\`

### Option 3: Local Installation
\`\`\`bash
# If claude-flow@alpha is installed locally
./claude-flow@alpha sparc run researcher "research AI trends 2024"
\`\`\`

## Core Capabilities
- Information gathering
- Source evaluation
- Trend analysis
- Competitive research
- Technology assessment

## Research Methods
- Parallel web searches
- Academic paper analysis
- Industry report synthesis
- Expert opinion gathering
- Data compilation

## Memory Integration
- Store research findings
- Build knowledge graphs
- Track information sources
- Cross-reference insights
- Maintain research history
`;
}

function createReviewerMode() {
  return `# SPARC Reviewer Mode

## Purpose
Code review using batch file analysis for comprehensive reviews.

## Activation

### Option 1: Using MCP Tools (Preferred in Claude Code)
\`\`\`javascript
mcp__claude-flow@alpha__sparc_mode {
  mode: "reviewer",
  task_description: "review pull request #123",
  options: {
    security_check: true,
    performance_check: true
  }
}
\`\`\`

### Option 2: Using NPX CLI (Fallback when MCP not available)
\`\`\`bash
# Use when running from terminal or MCP tools unavailable
npx claude-flow@alpha sparc run reviewer "review pull request #123"

# For alpha features
npx claude-flow@alpha sparc run reviewer "review pull request #123"
\`\`\`

### Option 3: Local Installation
\`\`\`bash
# If claude-flow@alpha is installed locally
./claude-flow@alpha sparc run reviewer "review pull request #123"
\`\`\`

## Core Capabilities
- Code quality assessment
- Security review
- Performance analysis
- Best practices check
- Documentation review

## Review Criteria
- Code correctness
- Design patterns
- Error handling
- Test coverage
- Maintainability

## Batch Analysis
- Parallel file review
- Pattern detection
- Dependency checking
- Consistency validation
- Automated reporting
`;
}

function createSwarmCoordinatorMode() {
  return `# SPARC Swarm Coordinator Mode

## Purpose
Specialized swarm management with batch coordination capabilities.

## Activation

### Option 1: Using MCP Tools (Preferred in Claude Code)
\`\`\`javascript
mcp__claude-flow@alpha__sparc_mode {
  mode: "swarm-coordinator",
  task_description: "manage development swarm",
  options: {
    topology: "hierarchical",
    max_agents: 10
  }
}
\`\`\`

### Option 2: Using NPX CLI (Fallback when MCP not available)
\`\`\`bash
# Use when running from terminal or MCP tools unavailable
npx claude-flow@alpha sparc run swarm-coordinator "manage development swarm"

# For alpha features
npx claude-flow@alpha sparc run swarm-coordinator "manage development swarm"
\`\`\`

### Option 3: Local Installation
\`\`\`bash
# If claude-flow@alpha is installed locally
./claude-flow@alpha sparc run swarm-coordinator "manage development swarm"
\`\`\`

## Core Capabilities
- Swarm initialization
- Agent management
- Task distribution
- Load balancing
- Result collection

## Coordination Modes
- Hierarchical swarms
- Mesh networks
- Pipeline coordination
- Adaptive strategies
- Hybrid approaches

## Management Features
- Dynamic scaling
- Resource optimization
- Failure recovery
- Performance monitoring
- Quality assurance
`;
}

function createTddMode() {
  return `# SPARC TDD Mode

## Purpose
Test-driven development with TodoWrite planning and comprehensive testing.

## Activation

### Option 1: Using MCP Tools (Preferred in Claude Code)
\`\`\`javascript
mcp__claude-flow@alpha__sparc_mode {
  mode: "tdd",
  task_description: "shopping cart feature",
  options: {
    coverage_target: 90,
    test_framework: "jest"
  }
}
\`\`\`

### Option 2: Using NPX CLI (Fallback when MCP not available)
\`\`\`bash
# Use when running from terminal or MCP tools unavailable
npx claude-flow@alpha sparc run tdd "shopping cart feature"

# For alpha features
npx claude-flow@alpha sparc run tdd "shopping cart feature"
\`\`\`

### Option 3: Local Installation
\`\`\`bash
# If claude-flow@alpha is installed locally
./claude-flow@alpha sparc run tdd "shopping cart feature"
\`\`\`

## Core Capabilities
- Test-first development
- Red-green-refactor cycle
- Test suite design
- Coverage optimization
- Continuous testing

## TDD Workflow
1. Write failing tests
2. Implement minimum code
3. Make tests pass
4. Refactor code
5. Repeat cycle

## Testing Strategies
- Unit testing
- Integration testing
- End-to-end testing
- Performance testing
- Security testing
`;
}

function createTesterMode() {
  return `# SPARC Tester Mode

## Purpose
Comprehensive testing with parallel execution capabilities.

## Activation

### Option 1: Using MCP Tools (Preferred in Claude Code)
\`\`\`javascript
mcp__claude-flow@alpha__sparc_mode {
  mode: "tester",
  task_description: "full regression suite",
  options: {
    parallel: true,
    coverage: true
  }
}
\`\`\`

### Option 2: Using NPX CLI (Fallback when MCP not available)
\`\`\`bash
# Use when running from terminal or MCP tools unavailable
npx claude-flow@alpha sparc run tester "full regression suite"

# For alpha features
npx claude-flow@alpha sparc run tester "full regression suite"
\`\`\`

### Option 3: Local Installation
\`\`\`bash
# If claude-flow@alpha is installed locally
./claude-flow@alpha sparc run tester "full regression suite"
\`\`\`

## Core Capabilities
- Test planning
- Test execution
- Bug detection
- Coverage analysis
- Report generation

## Test Types
- Unit tests
- Integration tests
- E2E tests
- Performance tests
- Security tests

## Parallel Features
- Concurrent test runs
- Distributed testing
- Load testing
- Cross-browser testing
- Multi-environment validation
`;
}

function createWorkflowManagerMode() {
  return `# SPARC Workflow Manager Mode

## Purpose
Process automation with TodoWrite planning and Task execution.

## Activation

### Option 1: Using MCP Tools (Preferred in Claude Code)
\`\`\`javascript
mcp__claude-flow@alpha__sparc_mode {
  mode: "workflow-manager",
  task_description: "automate deployment",
  options: {
    pipeline: "ci-cd",
    rollback_enabled: true
  }
}
\`\`\`

### Option 2: Using NPX CLI (Fallback when MCP not available)
\`\`\`bash
# Use when running from terminal or MCP tools unavailable
npx claude-flow@alpha sparc run workflow-manager "automate deployment"

# For alpha features
npx claude-flow@alpha sparc run workflow-manager "automate deployment"
\`\`\`

### Option 3: Local Installation
\`\`\`bash
# If claude-flow@alpha is installed locally
./claude-flow@alpha sparc run workflow-manager "automate deployment"
\`\`\`

## Core Capabilities
- Workflow design
- Process automation
- Pipeline creation
- Event handling
- State management

## Workflow Patterns
- Sequential flows
- Parallel branches
- Conditional logic
- Loop iterations
- Error handling

## Automation Features
- Trigger management
- Task scheduling
- Progress tracking
- Result validation
- Rollback capability
`;
}
