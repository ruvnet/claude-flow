// claude-md.js - CLAUDE.md templates

export function createMinimalClaudeMd() {
  return `# Claude Code Configuration

## 🚨 CRITICAL: CONCURRENT EXECUTION FOR ALL ACTIONS

**ABSOLUTE RULE**: ALL operations MUST be concurrent/parallel in a single message:

### 🔴 MANDATORY CONCURRENT PATTERNS:
1. **TodoWrite**: ALWAYS batch ALL todos in ONE call (5-10+ todos minimum)
2. **Task tool**: ALWAYS spawn ALL agents in ONE message with full instructions
3. **File operations**: ALWAYS batch ALL reads/writes/edits in ONE message
4. **Bash commands**: ALWAYS batch ALL terminal operations in ONE message

### ⚡ GOLDEN RULE: "1 MESSAGE = ALL RELATED OPERATIONS"

**✅ CORRECT**: Everything in ONE message
**❌ WRONG**: Multiple messages for related operations (6x slower!)

### 🎯 CONCURRENT EXECUTION CHECKLIST:
- ✅ Are ALL related TodoWrite operations batched together?
- ✅ Are ALL Task spawning operations in ONE message?
- ✅ Are ALL file operations (Read/Write/Edit) batched together?
- ✅ Are ALL bash commands grouped in ONE message?

If ANY answer is "No", you MUST combine operations into a single message!

## Build Commands
- \`npm run build\`: Build the project
- \`npm run test\`: Run tests
- \`npm run lint\`: Run linter

## Code Style
- Use TypeScript/ES modules
- Follow project conventions
- Run typecheck before committing

## 🌐 Flow Nexus Cloud Platform

Flow Nexus extends Claude Flow with cloud-powered features:

### Quick Start
1. **Register**: \`mcp__flow-nexus__user_register\` with email/password
2. **Login**: \`mcp__flow-nexus__user_login\` to access features
3. **Check Balance**: \`mcp__flow-nexus__check_balance\` for credits

### Key Capabilities

**🤖 AI Swarms**
- Deploy multi-agent swarms in cloud sandboxes
- Pre-built templates for common architectures
- Auto-scaling and load balancing

**📦 E2B Sandboxes**
- \`mcp__flow-nexus__sandbox_create\` - Isolated execution environments
- Support for Node.js, Python, React, Next.js
- Real-time code execution with environment variables

**⚡ Workflows**
- \`mcp__flow-nexus__workflow_create\` - Event-driven automation
- Parallel task processing with message queues
- Reusable workflow templates

**🎯 Challenges & Learning**
- \`mcp__flow-nexus__challenges_list\` - Coding challenges
- Earn rUv credits by completing tasks
- Global leaderboard and achievements

**🧠 Neural Networks**
- \`mcp__flow-nexus__neural_train\` - Train custom models
- Distributed training across sandboxes
- Pre-built templates for ML tasks

**💰 Credits & Billing**
- Pay-as-you-go with rUv credits
- Auto-refill configuration available
- Free tier for getting started

### Example: Deploy a Swarm
\`\`\`javascript
// Login and deploy
mcp__flow-nexus__user_login { email: "user@example.com", password: "***" }
mcp__flow-nexus__swarm_init { topology: "mesh", maxAgents: 5 }
mcp__flow-nexus__sandbox_create { template: "node", name: "api-dev" }
\`\`\`

Learn more: https://github.com/ruvnet/claude-flow@alpha#flow-nexus

## Project Info
This is a Claude-Flow AI agent orchestration system.
`;
}

export function createFullClaudeMd() {
  return `# Claude Code Configuration

## 🚨 CRITICAL: CONCURRENT EXECUTION FOR ALL ACTIONS

**ABSOLUTE RULE**: ALL operations MUST be concurrent/parallel in a single message:

### 🔴 MANDATORY CONCURRENT PATTERNS:
1. **TodoWrite**: ALWAYS batch ALL todos in ONE call (5-10+ todos minimum)
2. **Task tool**: ALWAYS spawn ALL agents in ONE message with full instructions
3. **File operations**: ALWAYS batch ALL reads/writes/edits in ONE message
4. **Bash commands**: ALWAYS batch ALL terminal operations in ONE message
5. **Memory operations**: ALWAYS batch ALL memory store/retrieve in ONE message

### ⚡ GOLDEN RULE: "1 MESSAGE = ALL RELATED OPERATIONS"

**Examples of CORRECT concurrent execution:**
\`\`\`javascript
// ✅ CORRECT: Everything in ONE message
[Single Message]:
  - TodoWrite { todos: [10+ todos with all statuses/priorities] }
  - Task("Agent 1 with full instructions and hooks")
  - Task("Agent 2 with full instructions and hooks")
  - Task("Agent 3 with full instructions and hooks")
  - Read("file1.js")
  - Read("file2.js")
  - Write("output1.js", content)
  - Write("output2.js", content)
  - Bash("npm install")
  - Bash("npm test")
  - Bash("npm run build")
\`\`\`

**Examples of WRONG sequential execution:**
\`\`\`javascript
// ❌ WRONG: Multiple messages (NEVER DO THIS)
Message 1: TodoWrite { todos: [single todo] }
Message 2: Task("Agent 1")
Message 3: Task("Agent 2")
Message 4: Read("file1.js")
Message 5: Write("output1.js")
Message 6: Bash("npm install")
// This is 6x slower and breaks coordination!
\`\`\`

### 🎯 CONCURRENT EXECUTION CHECKLIST:

Before sending ANY message, ask yourself:
- ✅ Are ALL related TodoWrite operations batched together?
- ✅ Are ALL Task spawning operations in ONE message?
- ✅ Are ALL file operations (Read/Write/Edit) batched together?
- ✅ Are ALL bash commands grouped in ONE message?
- ✅ Are ALL memory operations concurrent?

If ANY answer is "No", you MUST combine operations into a single message!

## Build Commands
- \`npm run build\`: Build the project using Deno compile
- \`npm run test\`: Run the full test suite
- \`npm run lint\`: Run ESLint and format checks
- \`npm run typecheck\`: Run TypeScript type checking
- \`./claude-flow@alpha start\`: Start the orchestration system
- \`./claude-flow@alpha --help\`: Show all available commands

## Code Style Preferences
- Use ES modules (import/export) syntax, not CommonJS (require)
- Destructure imports when possible (e.g., \`import { foo } from 'bar'\`)
- Use TypeScript for all new code
- Follow existing naming conventions (camelCase for variables, PascalCase for classes)
- Add JSDoc comments for public APIs
- Use async/await instead of Promise chains
- Prefer const/let over var

## Workflow Guidelines
- Always run typecheck after making code changes
- Run tests before committing changes
- Use meaningful commit messages following conventional commits
- Create feature branches for new functionality
- Ensure all tests pass before merging

## Project Architecture
This is a Claude-Flow AI agent orchestration system with the following components:
- **CLI Interface**: Command-line tools for managing the system
- **Orchestrator**: Core engine for coordinating agents and tasks
- **Memory System**: Persistent storage and retrieval of information
- **Terminal Management**: Automated terminal session handling
- **MCP Integration**: Model Context Protocol server for Claude integration
- **Agent Coordination**: Multi-agent task distribution and management

## Important Notes
- Use \`claude --dangerously-skip-permissions\` for unattended operation
- The system supports both daemon and interactive modes
- Memory persistence is handled automatically
- All components are event-driven for scalability

## Debugging
- Check logs in \`./claude-flow@alpha.log\`
- Use \`./claude-flow@alpha status\` to check system health
- Monitor with \`./claude-flow@alpha monitor\` for real-time updates
- Verbose output available with \`--verbose\` flag on most commands

## 🌐 Flow Nexus Cloud Platform

Flow Nexus extends Claude Flow with cloud-powered features:

### Quick Start
1. **Register**: \`mcp__flow-nexus__user_register\` with email/password
2. **Login**: \`mcp__flow-nexus__user_login\` to access features
3. **Check Balance**: \`mcp__flow-nexus__check_balance\` for credits

### Key Capabilities

**🤖 AI Swarms**
- Deploy multi-agent swarms in cloud sandboxes
- Pre-built templates for common architectures
- Auto-scaling and load balancing

**📦 E2B Sandboxes**
- \`mcp__flow-nexus__sandbox_create\` - Isolated execution environments
- Support for Node.js, Python, React, Next.js
- Real-time code execution with environment variables

**⚡ Workflows**
- \`mcp__flow-nexus__workflow_create\` - Event-driven automation
- Parallel task processing with message queues
- Reusable workflow templates

**🎯 Challenges & Learning**
- \`mcp__flow-nexus__challenges_list\` - Coding challenges
- Earn rUv credits by completing tasks
- Global leaderboard and achievements

**🧠 Neural Networks**
- \`mcp__flow-nexus__neural_train\` - Train custom models
- Distributed training across sandboxes
- Pre-built templates for ML tasks

**💰 Credits & Billing**
- Pay-as-you-go with rUv credits
- Auto-refill configuration available
- Free tier for getting started

### Example: Deploy a Swarm
\`\`\`javascript
// Login and deploy
mcp__flow-nexus__user_login { email: "user@example.com", password: "***" }
mcp__flow-nexus__swarm_init { topology: "mesh", maxAgents: 5 }
mcp__flow-nexus__sandbox_create { template: "node", name: "api-dev" }
\`\`\`

Learn more: https://github.com/ruvnet/claude-flow@alpha#flow-nexus
`;
}

export function createSparcClaudeMd() {
  return `# Claude Code Configuration - SPARC Development Environment

## 🚨 CRITICAL: CONCURRENT EXECUTION FOR ALL ACTIONS

**ABSOLUTE RULE**: ALL operations MUST be concurrent/parallel in a single message:

### 🔴 MANDATORY CONCURRENT PATTERNS:
1. **TodoWrite**: ALWAYS batch ALL todos in ONE call (5-10+ todos minimum)
2. **Task tool**: ALWAYS spawn ALL agents in ONE message with full instructions
3. **File operations**: ALWAYS batch ALL reads/writes/edits in ONE message
4. **Bash commands**: ALWAYS batch ALL terminal operations in ONE message
5. **Memory operations**: ALWAYS batch ALL memory store/retrieve in ONE message

### ⚡ GOLDEN RULE: "1 MESSAGE = ALL RELATED OPERATIONS"

**Examples of CORRECT concurrent execution:**
\`\`\`javascript
// ✅ CORRECT: Everything in ONE message
[Single Message]:
  - TodoWrite { todos: [10+ todos with all statuses/priorities] }
  - Task("Agent 1 with full instructions and hooks")
  - Task("Agent 2 with full instructions and hooks")
  - Task("Agent 3 with full instructions and hooks")
  - Read("file1.js")
  - Read("file2.js")
  - Write("output1.js", content)
  - Write("output2.js", content)
  - Bash("npm install")
  - Bash("npm test")
  - Bash("npm run build")
\`\`\`

**Examples of WRONG sequential execution:**
\`\`\`javascript
// ❌ WRONG: Multiple messages (NEVER DO THIS)
Message 1: TodoWrite { todos: [single todo] }
Message 2: Task("Agent 1")
Message 3: Task("Agent 2")
Message 4: Read("file1.js")
Message 5: Write("output1.js")
Message 6: Bash("npm install")
// This is 6x slower and breaks coordination!
\`\`\`

### 🎯 CONCURRENT EXECUTION CHECKLIST:

Before sending ANY message, ask yourself:
- ✅ Are ALL related TodoWrite operations batched together?
- ✅ Are ALL Task spawning operations in ONE message?
- ✅ Are ALL file operations (Read/Write/Edit) batched together?
- ✅ Are ALL bash commands grouped in ONE message?
- ✅ Are ALL memory operations concurrent?

If ANY answer is "No", you MUST combine operations into a single message!

## Project Overview
This project uses the SPARC (Specification, Pseudocode, Architecture, Refinement, Completion) methodology for systematic Test-Driven Development with AI assistance through Claude-Flow orchestration.

## SPARC Development Commands

### Core SPARC Commands
- \`./claude-flow@alpha sparc modes\`: List all available SPARC development modes
- \`./claude-flow@alpha sparc run <mode> "<task>"\`: Execute specific SPARC mode for a task
- \`./claude-flow@alpha sparc tdd "<feature>"\`: Run complete TDD workflow using SPARC methodology
- \`./claude-flow@alpha sparc info <mode>\`: Get detailed information about a specific mode

### Standard Build Commands
- \`npm run build\`: Build the project
- \`npm run test\`: Run the test suite
- \`npm run lint\`: Run linter and format checks
- \`npm run typecheck\`: Run TypeScript type checking

## SPARC Methodology Workflow

### 1. Specification Phase
\`\`\`bash
# Create detailed specifications and requirements
./claude-flow@alpha sparc run spec-pseudocode "Define user authentication requirements"
\`\`\`
- Define clear functional requirements
- Document edge cases and constraints
- Create user stories and acceptance criteria
- Establish non-functional requirements

### 2. Pseudocode Phase
\`\`\`bash
# Develop algorithmic logic and data flows
./claude-flow@alpha sparc run spec-pseudocode "Create authentication flow pseudocode"
\`\`\`
- Break down complex logic into steps
- Define data structures and interfaces
- Plan error handling and edge cases
- Create modular, testable components

### 3. Architecture Phase
\`\`\`bash
# Design system architecture and component structure
./claude-flow@alpha sparc run architect "Design authentication service architecture"
\`\`\`
- Create system diagrams and component relationships
- Define API contracts and interfaces
- Plan database schemas and data flows
- Establish security and scalability patterns

### 4. Refinement Phase (TDD Implementation)
\`\`\`bash
# Execute Test-Driven Development cycle
./claude-flow@alpha sparc tdd "implement user authentication system"
\`\`\`

**TDD Cycle:**
1. **Red**: Write failing tests first
2. **Green**: Implement minimal code to pass tests
3. **Refactor**: Optimize and clean up code
4. **Repeat**: Continue until feature is complete

### 5. Completion Phase
\`\`\`bash
# Integration, documentation, and validation
./claude-flow@alpha sparc run integration "integrate authentication with user management"
\`\`\`
- Integrate all components
- Perform end-to-end testing
- Create comprehensive documentation
- Validate against original requirements

## SPARC Mode Reference

### Development Modes
- **\`architect\`**: System design and architecture planning
- **\`code\`**: Clean, modular code implementation
- **\`tdd\`**: Test-driven development and testing
- **\`spec-pseudocode\`**: Requirements and algorithmic planning
- **\`integration\`**: System integration and coordination

### Quality Assurance Modes
- **\`debug\`**: Troubleshooting and bug resolution
- **\`security-review\`**: Security analysis and vulnerability assessment
- **\`refinement-optimization-mode\`**: Performance optimization and refactoring

### Support Modes
- **\`docs-writer\`**: Documentation creation and maintenance
- **\`devops\`**: Deployment and infrastructure management
- **\`mcp\`**: External service integration
- **\`swarm\`**: Multi-agent coordination for complex tasks

## Claude Code Slash Commands

Claude Code slash commands are available in \`.claude/commands/\`:

### Project Commands
- \`/sparc\`: Execute SPARC methodology workflows
- \`/sparc-<mode>\`: Run specific SPARC mode (e.g., /sparc-architect)
- \`/claude-flow@alpha-help\`: Show all Claude-Flow commands
- \`/claude-flow@alpha-memory\`: Interact with memory system
- \`/claude-flow@alpha-swarm\`: Coordinate multi-agent swarms

### Using Slash Commands
1. Type \`/\` in Claude Code to see available commands
2. Select a command or type its name
3. Commands are context-aware and project-specific
4. Custom commands can be added to \`.claude/commands/\`

## Code Style and Best Practices

### SPARC Development Principles
- **Modular Design**: Keep files under 500 lines, break into logical components
- **Environment Safety**: Never hardcode secrets or environment-specific values
- **Test-First**: Always write tests before implementation (Red-Green-Refactor)
- **Clean Architecture**: Separate concerns, use dependency injection
- **Documentation**: Maintain clear, up-to-date documentation

### Coding Standards
- Use TypeScript for type safety and better tooling
- Follow consistent naming conventions (camelCase for variables, PascalCase for classes)
- Implement proper error handling and logging
- Use async/await for asynchronous operations
- Prefer composition over inheritance

### Memory and State Management
- Use claude-flow@alpha memory system for persistent state across sessions
- Store progress and findings using namespaced keys
- Query previous work before starting new tasks
- Export/import memory for backup and sharing

## SPARC Memory Integration

### Memory Commands for SPARC Development
\`\`\`bash
# Store project specifications
./claude-flow@alpha memory store spec_auth "User authentication requirements and constraints"

# Store architectural decisions
./claude-flow@alpha memory store arch_decisions "Database schema and API design choices"

# Store test results and coverage
./claude-flow@alpha memory store test_coverage "Authentication module: 95% coverage, all tests passing"

# Query previous work
./claude-flow@alpha memory query auth_implementation

# Export project memory
./claude-flow@alpha memory export project_backup.json
\`\`\`

### Memory Namespaces
- **\`spec\`**: Requirements and specifications
- **\`arch\`**: Architecture and design decisions
- **\`impl\`**: Implementation notes and code patterns
- **\`test\`**: Test results and coverage reports
- **\`debug\`**: Bug reports and resolution notes

## Workflow Examples

### Feature Development Workflow
\`\`\`bash
# 1. Start with specification
./claude-flow@alpha sparc run spec-pseudocode "User profile management feature"

# 2. Design architecture
./claude-flow@alpha sparc run architect "Profile service architecture with data validation"

# 3. Implement with TDD
./claude-flow@alpha sparc tdd "user profile CRUD operations"

# 4. Security review
./claude-flow@alpha sparc run security-review "profile data access and validation"

# 5. Integration testing
./claude-flow@alpha sparc run integration "profile service with authentication system"

# 6. Documentation
./claude-flow@alpha sparc run docs-writer "profile service API documentation"
\`\`\`

### Bug Fix Workflow
\`\`\`bash
# 1. Debug and analyze
./claude-flow@alpha sparc run debug "authentication token expiration issue"

# 2. Write regression tests
./claude-flow@alpha sparc run tdd "token refresh mechanism tests"

# 3. Implement fix
./claude-flow@alpha sparc run code "fix token refresh in authentication service"

# 4. Security review
./claude-flow@alpha sparc run security-review "token handling security implications"
\`\`\`

## Configuration Files

### Claude Code Integration
- **\`.claude/commands/\`**: Claude Code slash commands for all SPARC modes
- **\`.claude/logs/\`**: Conversation and session logs

### SPARC Configuration
- **\`.roomodes\`**: SPARC mode definitions and configurations (auto-generated)
- **\`.roo/\`**: SPARC templates and workflows (auto-generated)

### Claude-Flow Configuration
- **\`memory/\`**: Persistent memory and session data
- **\`coordination/\`**: Multi-agent coordination settings
- **\`CLAUDE.md\`**: Project instructions for Claude Code

## Git Workflow Integration

### Commit Strategy with SPARC
- **Specification commits**: After completing requirements analysis
- **Architecture commits**: After design phase completion
- **TDD commits**: After each Red-Green-Refactor cycle
- **Integration commits**: After successful component integration
- **Documentation commits**: After completing documentation updates

### Branch Strategy
- **\`feature/sparc-<feature-name>\`**: Feature development with SPARC methodology
- **\`hotfix/sparc-<issue>\`**: Bug fixes using SPARC debugging workflow
- **\`refactor/sparc-<component>\`**: Refactoring using optimization mode

## Troubleshooting

### Common SPARC Issues
- **Mode not found**: Check \`.roomodes\` file exists and is valid JSON
- **Memory persistence**: Ensure \`memory/\` directory has write permissions
- **Tool access**: Verify required tools are available for the selected mode
- **Namespace conflicts**: Use unique memory namespaces for different features

### Debug Commands
\`\`\`bash
# Check SPARC configuration
./claude-flow@alpha sparc modes

# Verify memory system
./claude-flow@alpha memory stats

# Check system status
./claude-flow@alpha status

# View detailed mode information
./claude-flow@alpha sparc info <mode-name>
\`\`\`

## Project Architecture

This SPARC-enabled project follows a systematic development approach:
- **Clear separation of concerns** through modular design
- **Test-driven development** ensuring reliability and maintainability
- **Iterative refinement** for continuous improvement
- **Comprehensive documentation** for team collaboration
- **AI-assisted development** through specialized SPARC modes

## Important Notes

- Always run tests before committing (\`npm run test\`)
- Use SPARC memory system to maintain context across sessions
- Follow the Red-Green-Refactor cycle during TDD phases
- Document architectural decisions in memory for future reference
- Regular security reviews for any authentication or data handling code
- Claude Code slash commands provide quick access to SPARC modes

For more information about SPARC methodology, see: https://github.com/ruvnet/claude-code-flow/docs/sparc.md

## 🌐 Flow Nexus Cloud Platform

Flow Nexus extends Claude Flow with cloud-powered features:

### Quick Start
1. **Register**: \`mcp__flow-nexus__user_register\` with email/password
2. **Login**: \`mcp__flow-nexus__user_login\` to access features
3. **Check Balance**: \`mcp__flow-nexus__check_balance\` for credits

### Key Capabilities

**🤖 AI Swarms**
- Deploy multi-agent swarms in cloud sandboxes
- Pre-built templates for common architectures
- Auto-scaling and load balancing

**📦 E2B Sandboxes**
- \`mcp__flow-nexus__sandbox_create\` - Isolated execution environments
- Support for Node.js, Python, React, Next.js
- Real-time code execution with environment variables

**⚡ Workflows**
- \`mcp__flow-nexus__workflow_create\` - Event-driven automation
- Parallel task processing with message queues
- Reusable workflow templates

**🎯 Challenges & Learning**
- \`mcp__flow-nexus__challenges_list\` - Coding challenges
- Earn rUv credits by completing tasks
- Global leaderboard and achievements

**🧠 Neural Networks**
- \`mcp__flow-nexus__neural_train\` - Train custom models
- Distributed training across sandboxes
- Pre-built templates for ML tasks

**💰 Credits & Billing**
- Pay-as-you-go with rUv credits
- Auto-refill configuration available
- Free tier for getting started

### Example: Deploy a Swarm
\`\`\`javascript
// Login and deploy
mcp__flow-nexus__user_login { email: "user@example.com", password: "***" }
mcp__flow-nexus__swarm_init { topology: "mesh", maxAgents: 5 }
mcp__flow-nexus__sandbox_create { template: "node", name: "api-dev" }
\`\`\`

Learn more: https://github.com/ruvnet/claude-flow@alpha#flow-nexus
`;
}

// Create optimized SPARC CLAUDE.md with batchtools integration
export function createOptimizedSparcClaudeMd() {
  return `# Claude Code Configuration - SPARC Development Environment with Psycho-Symbolic Reasoning

## 🧠 PSYCHO-SYMBOLIC REASONING INTEGRATION

### Cognitive Pattern Activation
**AUTO-TRIGGERS** for enhanced reasoning (2.5% overhead with v1.0.11+ caching):
- **Security tasks** → Critical + Lateral patterns (500% better edge case detection)
- **Performance issues** → Systems + Lateral patterns (300% more insights)
- **Architecture decisions** → Divergent + Systems patterns (comprehensive design)
- **Unknown domains** → Full pattern analysis (73+ insights per query)

### Reasoning-First Workflow
Before complex tasks, use psycho-symbolic reasoning:
\`\`\`javascript
// Use MCP tools for advanced coordination:
// - mcp__claude-flow@alpha__swarm_init for agent orchestration
// - mcp__claude-flow@alpha__neural_patterns for intelligent analysis
// - mcp__claude-flow@alpha__memory_usage for persistent context
\`\`\`

### Cognitive Role Specialization
Agents now have cognitive patterns:
- **Scout agents** → Divergent thinking (explore solution spaces)
- **Critic agents** → Critical analysis (find flaws and edge cases)
- **Systems agents** → Systems thinking (map interconnections)
- **Innovator agents** → Lateral thinking (creative solutions)
- **Synthesizer agents** → Convergent thinking (integrate insights)

## 🚨 CRITICAL: CONCURRENT EXECUTION & FILE MANAGEMENT

**ABSOLUTE RULES**:
1. ALL operations MUST be concurrent/parallel in a single message
2. **NEVER save working files, text/mds and tests to the root folder**
3. ALWAYS organize files in appropriate subdirectories
4. **USE CLAUDE CODE'S TASK TOOL** for spawning agents concurrently, not just MCP

### ⚡ GOLDEN RULE: "1 MESSAGE = ALL RELATED OPERATIONS"

**MANDATORY PATTERNS:**
- **TodoWrite**: ALWAYS batch ALL todos in ONE call (5-10+ todos minimum)
- **Task tool (Claude Code)**: ALWAYS spawn ALL agents in ONE message with full instructions
- **File operations**: ALWAYS batch ALL reads/writes/edits in ONE message
- **Bash commands**: ALWAYS batch ALL terminal operations in ONE message
- **Memory operations**: ALWAYS batch ALL memory store/retrieve in ONE message

### 🎯 CRITICAL: Claude Code Task Tool for Agent Execution

**Claude Code's Task tool is the PRIMARY way to spawn agents:**
\`\`\`javascript
// ✅ CORRECT: Use Claude Code's Task tool for parallel agent execution
[Single Message]:
  Task("Research agent", "Analyze requirements and patterns...", "researcher")
  Task("Coder agent", "Implement core features...", "coder")
  Task("Tester agent", "Create comprehensive tests...", "tester")
  Task("Reviewer agent", "Review code quality...", "reviewer")
  Task("Architect agent", "Design system architecture...", "system-architect")
\`\`\`

**MCP tools are ONLY for coordination setup:**
- \`mcp__claude-flow@alpha__swarm_init\` - Initialize coordination topology
- \`mcp__claude-flow@alpha__agent_spawn\` - Define agent types for coordination
- \`mcp__claude-flow@alpha__task_orchestrate\` - Orchestrate high-level workflows

### 📁 File Organization Rules

**NEVER save to root folder. Use these directories:**
- \`/src\` - Source code files
- \`/tests\` - Test files
- \`/docs\` - Documentation and markdown files
- \`/config\` - Configuration files
- \`/scripts\` - Utility scripts
- \`/examples\` - Example code

## Project Overview

This project uses SPARC (Specification, Pseudocode, Architecture, Refinement, Completion) methodology with Claude-Flow orchestration for systematic Test-Driven Development.

## SPARC Commands

### Core Commands
- \`npx claude-flow@alpha sparc modes\` - List available modes
- \`npx claude-flow@alpha sparc run <mode> "<task>"\` - Execute specific mode
- \`npx claude-flow@alpha sparc tdd "<feature>"\` - Run complete TDD workflow
- \`npx claude-flow@alpha sparc info <mode>\` - Get mode details

### Batchtools Commands
- \`npx claude-flow@alpha sparc batch <modes> "<task>"\` - Parallel execution
- \`npx claude-flow@alpha sparc pipeline "<task>"\` - Full pipeline processing
- \`npx claude-flow@alpha sparc concurrent <mode> "<tasks-file>"\` - Multi-task processing

### Build Commands
- \`npm run build\` - Build project
- \`npm run test\` - Run tests
- \`npm run lint\` - Linting
- \`npm run typecheck\` - Type checking

## SPARC Workflow Phases

1. **Specification** - Requirements analysis (\`sparc run spec-pseudocode\`)
2. **Pseudocode** - Algorithm design (\`sparc run spec-pseudocode\`)
3. **Architecture** - System design (\`sparc run architect\`)
4. **Refinement** - TDD implementation (\`sparc tdd\`)
5. **Completion** - Integration (\`sparc run integration\`)

## Code Style & Best Practices

- **Modular Design**: Files under 500 lines
- **Environment Safety**: Never hardcode secrets
- **Test-First**: Write tests before implementation
- **Clean Architecture**: Separate concerns
- **Documentation**: Keep updated

## 🚀 Available Agents (54 Total)

### Core Development
\`coder\`, \`reviewer\`, \`tester\`, \`planner\`, \`researcher\`

### Swarm Coordination
\`hierarchical-coordinator\`, \`mesh-coordinator\`, \`adaptive-coordinator\`, \`collective-intelligence-coordinator\`, \`swarm-memory-manager\`

### Consensus & Distributed
\`byzantine-coordinator\`, \`raft-manager\`, \`gossip-coordinator\`, \`consensus-builder\`, \`crdt-synchronizer\`, \`quorum-manager\`, \`security-manager\`

### Performance & Optimization
\`perf-analyzer\`, \`performance-benchmarker\`, \`task-orchestrator\`, \`memory-coordinator\`, \`smart-agent\`

### GitHub & Repository
\`github-modes\`, \`pr-manager\`, \`code-review-swarm\`, \`issue-tracker\`, \`release-manager\`, \`workflow-automation\`, \`project-board-sync\`, \`repo-architect\`, \`multi-repo-swarm\`

### SPARC Methodology
\`sparc-coord\`, \`sparc-coder\`, \`specification\`, \`pseudocode\`, \`architecture\`, \`refinement\`

### Specialized Development
\`backend-dev\`, \`mobile-dev\`, \`ml-developer\`, \`cicd-engineer\`, \`api-docs\`, \`system-architect\`, \`code-analyzer\`, \`base-template-generator\`

### Testing & Validation
\`tdd-london-swarm\`, \`production-validator\`

### Migration & Planning
\`migration-planner\`, \`swarm-init\`

## 🎯 Claude Code vs MCP Tools

### Claude Code Handles ALL EXECUTION:
- **Task tool**: Spawn and run agents concurrently for actual work
- File operations (Read, Write, Edit, MultiEdit, Glob, Grep)
- Code generation and programming
- Bash commands and system operations
- Implementation work
- Project navigation and analysis
- TodoWrite and task management
- Git operations
- Package management
- Testing and debugging

### MCP Tools ONLY COORDINATE:
- Swarm initialization (topology setup)
- Agent type definitions (coordination patterns)
- Task orchestration (high-level planning)
- Memory management
- Neural features
- Performance tracking
- GitHub integration

**KEY**: MCP coordinates the strategy, Claude Code's Task tool executes with real agents.

## 🚀 Quick Setup

\`\`\`bash
# Add MCP servers (Claude Flow required, others optional)
claude mcp add claude-flow@alpha npx claude-flow@alpha mcp start
claude mcp add ruv-swarm npx ruv-swarm mcp start  # Optional: Enhanced coordination
claude mcp add flow-nexus npx flow-nexus@latest mcp start  # Optional: Cloud features
\`\`\`

## MCP Tool Categories

### Coordination
\`swarm_init\`, \`agent_spawn\`, \`task_orchestrate\`

### Monitoring
\`swarm_status\`, \`agent_list\`, \`agent_metrics\`, \`task_status\`, \`task_results\`

### Memory & Neural
\`memory_usage\`, \`neural_status\`, \`neural_train\`, \`neural_patterns\`

### Psycho-Symbolic Reasoning (Sublinear MCP)
\`psycho_symbolic_reason\`, \`knowledge_graph_query\`, \`add_knowledge\`, \`reasoning_cache_status\`
- **Pattern-based reasoning**: Critical, lateral, divergent, systems, convergent thinking
- **Knowledge graph**: Build and query semantic relationships
- **Cache-powered**: 97.5% overhead reduction, sub-millisecond responses
- **Edge case detection**: 500% better at finding vulnerabilities

### GitHub Integration
\`github_swarm\`, \`repo_analyze\`, \`pr_enhance\`, \`issue_triage\`, \`code_review\`

### System
\`benchmark_run\`, \`features_detect\`, \`swarm_monitor\`

### Flow-Nexus MCP Tools (Optional Advanced Features)
Flow-Nexus extends MCP capabilities with 70+ cloud-based orchestration tools:

**Key MCP Tool Categories:**
- **Swarm & Agents**: \`swarm_init\`, \`swarm_scale\`, \`agent_spawn\`, \`task_orchestrate\`
- **Sandboxes**: \`sandbox_create\`, \`sandbox_execute\`, \`sandbox_upload\` (cloud execution)
- **Templates**: \`template_list\`, \`template_deploy\` (pre-built project templates)
- **Neural AI**: \`neural_train\`, \`neural_patterns\`, \`seraphina_chat\` (AI assistant)
- **GitHub**: \`github_repo_analyze\`, \`github_pr_manage\` (repository management)
- **Real-time**: \`execution_stream_subscribe\`, \`realtime_subscribe\` (live monitoring)
- **Storage**: \`storage_upload\`, \`storage_list\` (cloud file management)

**Authentication Required:**
- Register: \`mcp__flow-nexus__user_register\` or \`npx flow-nexus@latest register\`
- Login: \`mcp__flow-nexus__user_login\` or \`npx flow-nexus@latest login\`
- Access 70+ specialized MCP tools for advanced orchestration

## 🚀 Agent Execution Flow with Claude Code

### The Correct Pattern:

1. **Optional**: Use MCP tools to set up coordination topology
2. **REQUIRED**: Use Claude Code's Task tool to spawn agents that do actual work
3. **REQUIRED**: Each agent runs hooks for coordination
4. **REQUIRED**: Batch all operations in single messages

### Example Full-Stack Development:

\`\`\`javascript
// Single message with all agent spawning via Claude Code's Task tool
[Parallel Agent Execution]:
  Task("Backend Developer", "Build REST API with Express. Use hooks for coordination.", "backend-dev")
  Task("Frontend Developer", "Create React UI. Coordinate with backend via memory.", "coder")
  Task("Database Architect", "Design PostgreSQL schema. Store schema in memory.", "code-analyzer")
  Task("Test Engineer", "Write Jest tests. Check memory for API contracts.", "tester")
  Task("DevOps Engineer", "Setup Docker and CI/CD. Document in memory.", "cicd-engineer")
  Task("Security Auditor", "Review authentication. Report findings via hooks.", "reviewer")
  
  // All todos batched together
  TodoWrite { todos: [...8-10 todos...] }
  
  // All file operations together
  Write "backend/server.js"
  Write "frontend/App.jsx"
  Write "database/schema.sql"
\`\`\`

## 📋 Agent Coordination Protocol with Cognitive Reasoning

### Every Agent Spawned via Task Tool MUST:

**1️⃣ BEFORE Work (Enhanced with Reasoning):**
\`\`\`bash
# Restore context and analyze task cognitively
npx claude-flow@alpha hooks pre-task --description "[task]" --reasoning-pattern "[pattern]"
npx claude-flow@alpha hooks session-restore --session-id "swarm-[id]" --load-cognitive-state true

# Use psycho-symbolic reasoning for complex decisions
npx claude-flow@alpha swarm run 'intelligent analysis of [task]'
\`\`\`

**2️⃣ DURING Work:**
\`\`\`bash
npx claude-flow@alpha hooks post-edit --file "[file]" --memory-key "swarm/[agent]/[step]"
npx claude-flow@alpha hooks notify --message "[what was done]"
\`\`\`

**3️⃣ AFTER Work:**
\`\`\`bash
npx claude-flow@alpha hooks post-task --task-id "[task]"
npx claude-flow@alpha hooks session-end --export-metrics true
\`\`\`

## 🎯 Concurrent Execution Examples

### ✅ CORRECT WORKFLOW: MCP Coordinates, Claude Code Executes

\`\`\`javascript
// Step 1: MCP tools set up coordination with cognitive patterns
[Single Message - Enhanced Coordination Setup]:
  mcp__claude-flow@alpha__swarm_init { topology: "mesh", maxAgents: 6 }
  mcp__claude-flow@alpha__agent_spawn { type: "researcher", cognitivePattern: "divergent" }
  mcp__claude-flow@alpha__agent_spawn { type: "coder", cognitivePattern: "systems" }
  mcp__claude-flow@alpha__agent_spawn { type: "tester", cognitivePattern: "critical" }
  
  // Initialize psycho-symbolic reasoning for the swarm
  mcp__claude-flow@alpha__neural_patterns { 
    action: "analyze",
    operation: "What patterns should guide this implementation?",
    metadata: { depth: 10, cache: true }
  }

// Step 2: Claude Code Task tool spawns ACTUAL agents that do the work
[Single Message - Parallel Agent Execution]:
  // Claude Code's Task tool spawns real agents concurrently
  Task("Research agent", "Analyze API requirements and best practices. Check memory for prior decisions.", "researcher")
  Task("Coder agent", "Implement REST endpoints with authentication. Coordinate via hooks.", "coder")
  Task("Database agent", "Design and implement database schema. Store decisions in memory.", "code-analyzer")
  Task("Tester agent", "Create comprehensive test suite with 90% coverage.", "tester")
  Task("Reviewer agent", "Review code quality and security. Document findings.", "reviewer")
  
  // Batch ALL todos in ONE call
  TodoWrite { todos: [
    {id: "1", content: "Research API patterns", status: "in_progress", priority: "high"},
    {id: "2", content: "Design database schema", status: "in_progress", priority: "high"},
    {id: "3", content: "Implement authentication", status: "pending", priority: "high"},
    {id: "4", content: "Build REST endpoints", status: "pending", priority: "high"},
    {id: "5", content: "Write unit tests", status: "pending", priority: "medium"},
    {id: "6", content: "Integration tests", status: "pending", priority: "medium"},
    {id: "7", content: "API documentation", status: "pending", priority: "low"},
    {id: "8", content: "Performance optimization", status: "pending", priority: "low"}
  ]}
  
  // Parallel file operations
  Bash "mkdir -p app/{src,tests,docs,config}"
  Write "app/package.json"
  Write "app/src/server.js"
  Write "app/tests/server.test.js"
  Write "app/docs/API.md"
\`\`\`

### ❌ WRONG (Multiple Messages):
\`\`\`javascript
Message 1: mcp__claude-flow@alpha__swarm_init
Message 2: Task("agent 1")
Message 3: TodoWrite { todos: [single todo] }
Message 4: Write "file.js"
// This breaks parallel coordination!
\`\`\`

## Performance Benefits

- **84.8% SWE-Bench solve rate**
- **32.3% token reduction**
- **2.8-4.4x speed improvement**
- **27+ neural models**

## Hooks Integration

### Pre-Operation
- Auto-assign agents by file type
- Validate commands for safety
- Prepare resources automatically
- Optimize topology by complexity
- Cache searches

### Post-Operation
- Auto-format code
- Train neural patterns
- Update memory
- Analyze performance
- Track token usage

### Session Management
- Generate summaries
- Persist state
- Track metrics
- Restore context
- Export workflows

## Advanced Features (v2.0.0)

- 🚀 Automatic Topology Selection
- ⚡ Parallel Execution (2.8-4.4x speed)
- 🧠 Neural Training
- 📊 Bottleneck Analysis
- 🤖 Smart Auto-Spawning
- 🛡️ Self-Healing Workflows
- 💾 Cross-Session Memory
- 🔗 GitHub Integration

## Integration Tips

1. Start with basic swarm init
2. Scale agents gradually
3. Use memory for context
4. Monitor progress regularly
5. Train patterns from success
6. Enable hooks automation
7. Use GitHub tools first

## Support

- Documentation: https://github.com/ruvnet/claude-flow@alpha
- Issues: https://github.com/ruvnet/claude-flow@alpha/issues
- Flow-Nexus Platform: https://flow-nexus.ruv.io (registration required for cloud features)

---

Remember: **Claude Flow coordinates, Claude Code creates!**

# important-instruction-reminders
Do what has been asked; nothing more, nothing less.
NEVER create files unless they're absolutely necessary for achieving your goal.
ALWAYS prefer editing an existing file to creating a new one.
NEVER proactively create documentation files (*.md) or README files. Only create documentation files if explicitly requested by the User.
Never save working files, text/mds and tests to the root folder.
`;
}

export function createFlowNexusClaudeMd() {
  return `# Claude Code Configuration - Flow Nexus Integration

## 🌐 Flow Nexus Cloud Platform

Flow Nexus extends Claude Flow with cloud-powered features for AI development and deployment.

### Quick Start
1. **Register**: Use \`mcp__flow-nexus__user_register\` with email/password
2. **Login**: Use \`mcp__flow-nexus__user_login\` to access features
3. **Check Balance**: Use \`mcp__flow-nexus__check_balance\` for credits

### 🚀 Key Capabilities

**🤖 AI Swarms**
- Deploy multi-agent swarms in cloud sandboxes
- Pre-built templates for common architectures
- Auto-scaling and load balancing

**📦 E2B Sandboxes**
- \`mcp__flow-nexus__sandbox_create\` - Isolated execution environments
- Support for Node.js, Python, React, Next.js
- Real-time code execution with environment variables

**⚡ Workflows**
- \`mcp__flow-nexus__workflow_create\` - Event-driven automation
- Parallel task processing with message queues
- Reusable workflow templates

**🎯 Challenges & Learning**
- \`mcp__flow-nexus__challenges_list\` - Coding challenges
- Earn rUv credits by completing tasks
- Global leaderboard and achievements

**🧠 Neural Networks**
- \`mcp__flow-nexus__neural_train\` - Train custom models
- Distributed training across sandboxes
- Pre-built templates for ML tasks

**💰 Credits & Billing**
- Pay-as-you-go with rUv credits
- Auto-refill configuration available
- Free tier for getting started

### 🤖 Flow Nexus Agents

Specialized agents for Flow Nexus operations available in \`.claude/agents/flow-nexus/\`:

- **flow-nexus-auth**: Authentication and user management
- **flow-nexus-sandbox**: E2B sandbox deployment and management  
- **flow-nexus-swarm**: AI swarm orchestration and scaling
- **flow-nexus-workflow**: Event-driven workflow automation
- **flow-nexus-neural**: Neural network training and deployment
- **flow-nexus-challenges**: Coding challenges and gamification
- **flow-nexus-app-store**: Application marketplace management
- **flow-nexus-payments**: Credit management and billing
- **flow-nexus-user-tools**: User management and system utilities

### 📁 Flow Nexus Commands

Detailed Flow Nexus command documentation available in \`.claude/commands/flow-nexus/\`:

- \`login-registration.md\` - Authentication workflows
- \`sandbox.md\` - E2B sandbox management
- \`swarm.md\` - AI swarm deployment
- \`workflow.md\` - Automation workflows
- \`neural-network.md\` - ML model training
- \`challenges.md\` - Coding challenges
- \`app-store.md\` - App marketplace
- \`payments.md\` - Credit and billing
- \`user-tools.md\` - User utilities

### 💡 Example: Deploy a Swarm
\`\`\`javascript
// 1. Login to Flow Nexus
mcp__flow-nexus__user_login({ 
  email: "user@example.com", 
  password: "password" 
})

// 2. Initialize swarm
mcp__flow-nexus__swarm_init({ 
  topology: "mesh", 
  maxAgents: 5 
})

// 3. Create sandbox
mcp__flow-nexus__sandbox_create({ 
  template: "node", 
  name: "api-dev" 
})

// 4. Orchestrate task
mcp__flow-nexus__task_orchestrate({
  task: "Build REST API with authentication",
  strategy: "parallel"
})
\`\`\`

### 🔗 Integration with Claude Code

Flow Nexus seamlessly integrates with Claude Code through MCP (Model Context Protocol):

1. **Add MCP Server**: \`claude mcp add flow-nexus npx flow-nexus@latest mcp start\`
2. **Use in Claude Code**: Access all Flow Nexus tools through MCP interface
3. **Agent Coordination**: Use Flow Nexus agents for specialized cloud operations
4. **Command Reference**: Use slash commands for quick Flow Nexus operations

### 📚 Learn More

- Documentation: https://github.com/ruvnet/claude-flow@alpha#flow-nexus
- MCP Integration: Use \`mcp__flow-nexus__*\` tools in Claude Code
- Agent Usage: Type \`/\` in Claude Code to see Flow Nexus commands
- Community: Join discussions and share templates

---

**Ready to build with Flow Nexus? Start with authentication and explore the cloud-powered AI development platform!**
`;
}
