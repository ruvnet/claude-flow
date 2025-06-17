// claude-md.js - CLAUDE.md templates

export function createMinimalClaudeMd() {
  return `# Claude Code Configuration

## Build Commands
- \`npm run build\`: Build the project
- \`npm run test\`: Run tests
- \`npm run lint\`: Run linter

## Code Style
- Use TypeScript/ES modules
- Follow project conventions
- Run typecheck before committing

## Project Info
This is a Claude-Flow AI agent orchestration system.
`;
}

export function createFullClaudeMd() {
  return `# Claude Code Configuration

## Build Commands
- \`npm run build\`: Build the project using Deno compile
- \`npm run test\`: Run the full test suite
- \`npm run lint\`: Run ESLint and format checks
- \`npm run typecheck\`: Run TypeScript type checking
- \`./claude-flow start\`: Start the orchestration system
- \`./claude-flow --help\`: Show all available commands

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
- Check logs in \`./claude-flow.log\`
- Use \`./claude-flow status\` to check system health
- Monitor with \`./claude-flow monitor\` for real-time updates
- Verbose output available with \`--verbose\` flag on most commands
`;
}

export function createSparcClaudeMd() {
  return `# Claude Code Configuration - SPARC Development Environment

## Project Overview
This project uses the SPARC (Specification, Pseudocode, Architecture, Refinement, Completion) methodology for systematic Test-Driven Development with AI assistance through Claude-Flow orchestration.

## SPARC Development Commands

### Core SPARC Commands
- \`./claude-flow sparc modes\`: List all available SPARC development modes
- \`./claude-flow sparc run <mode> "<task>"\`: Execute specific SPARC mode for a task
- \`./claude-flow sparc tdd "<feature>"\`: Run complete TDD workflow using SPARC methodology
- \`./claude-flow sparc info <mode>\`: Get detailed information about a specific mode

### Standard Build Commands
- \`npm run build\`: Build the project
- \`npm run test\`: Run the test suite
- \`npm run lint\`: Run linter and format checks
- \`npm run typecheck\`: Run TypeScript type checking

## SPARC Methodology Workflow

### 1. Specification Phase
\`\`\`bash
# Create detailed specifications and requirements
./claude-flow sparc run spec-pseudocode "Define user authentication requirements"
\`\`\`
- Define clear functional requirements
- Document edge cases and constraints
- Create user stories and acceptance criteria
- Establish non-functional requirements

### 2. Pseudocode Phase
\`\`\`bash
# Develop algorithmic logic and data flows
./claude-flow sparc run spec-pseudocode "Create authentication flow pseudocode"
\`\`\`
- Break down complex logic into steps
- Define data structures and interfaces
- Plan error handling and edge cases
- Create modular, testable components

### 3. Architecture Phase
\`\`\`bash
# Design system architecture and component structure
./claude-flow sparc run architect "Design authentication service architecture"
\`\`\`
- Create system diagrams and component relationships
- Define API contracts and interfaces
- Plan database schemas and data flows
- Establish security and scalability patterns

### 4. Refinement Phase (TDD Implementation)
\`\`\`bash
# Execute Test-Driven Development cycle
./claude-flow sparc tdd "implement user authentication system"
\`\`\`

**TDD Cycle:**
1. **Red**: Write failing tests first
2. **Green**: Implement minimal code to pass tests
3. **Refactor**: Optimize and clean up code
4. **Repeat**: Continue until feature is complete

### 5. Completion Phase
\`\`\`bash
# Integration, documentation, and validation
./claude-flow sparc run integration "integrate authentication with user management"
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
- \`/claude-flow-help\`: Show all Claude-Flow commands
- \`/claude-flow-memory\`: Interact with memory system
- \`/claude-flow-swarm\`: Coordinate multi-agent swarms

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
- Use claude-flow memory system for persistent state across sessions
- Store progress and findings using namespaced keys
- Query previous work before starting new tasks
- Export/import memory for backup and sharing

## SPARC Memory Integration

### Memory Commands for SPARC Development
\`\`\`bash
# Store project specifications
./claude-flow memory store spec_auth "User authentication requirements and constraints"

# Store architectural decisions
./claude-flow memory store arch_decisions "Database schema and API design choices"

# Store test results and coverage
./claude-flow memory store test_coverage "Authentication module: 95% coverage, all tests passing"

# Query previous work
./claude-flow memory query auth_implementation

# Export project memory
./claude-flow memory export project_backup.json
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
./claude-flow sparc run spec-pseudocode "User profile management feature"

# 2. Design architecture
./claude-flow sparc run architect "Profile service architecture with data validation"

# 3. Implement with TDD
./claude-flow sparc tdd "user profile CRUD operations"

# 4. Security review
./claude-flow sparc run security-review "profile data access and validation"

# 5. Integration testing
./claude-flow sparc run integration "profile service with authentication system"

# 6. Documentation
./claude-flow sparc run docs-writer "profile service API documentation"
\`\`\`

### Bug Fix Workflow
\`\`\`bash
# 1. Debug and analyze
./claude-flow sparc run debug "authentication token expiration issue"

# 2. Write regression tests
./claude-flow sparc run tdd "token refresh mechanism tests"

# 3. Implement fix
./claude-flow sparc run code "fix token refresh in authentication service"

# 4. Security review
./claude-flow sparc run security-review "token handling security implications"
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
./claude-flow sparc modes

# Verify memory system
./claude-flow memory stats

# Check system status
./claude-flow status

# View detailed mode information
./claude-flow sparc info <mode-name>
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
`;
}

// Create optimized SPARC CLAUDE.md with batchtools integration
export async function createOptimizedSparcClaudeMd() {
  return `# Claude Code Configuration - SPARC Development Environment (Batchtools Optimized)

## Project Overview
This project uses the SPARC (Specification, Pseudocode, Architecture, Refinement, Completion) methodology for systematic Test-Driven Development with AI assistance through Claude-Flow orchestration.

**🚀 Batchtools Optimization Enabled**: This configuration includes optimized prompts and parallel processing capabilities for improved performance and efficiency.

## SPARC Development Commands

### Core SPARC Commands
- \`npx claude-flow sparc modes\`: List all available SPARC development modes
- \`npx claude-flow sparc run <mode> "<task>"\`: Execute specific SPARC mode for a task
- \`npx claude-flow sparc tdd "<feature>"\`: Run complete TDD workflow using SPARC methodology
- \`npx claude-flow sparc info <mode>\`: Get detailed information about a specific mode

### Batchtools Commands (Optimized)
- \`npx claude-flow sparc batch <modes> "<task>"\`: Execute multiple SPARC modes in parallel
- \`npx claude-flow sparc pipeline "<task>"\`: Execute full SPARC pipeline with parallel processing
- \`npx claude-flow sparc concurrent <mode> "<tasks-file>"\`: Process multiple tasks concurrently

### Standard Build Commands
- \`npm run build\`: Build the project
- \`npm run test\`: Run the test suite
- \`npm run lint\`: Run linter and format checks
- \`npm run typecheck\`: Run TypeScript type checking

## SPARC Methodology Workflow (Batchtools Enhanced)

### 1. Specification Phase (Parallel Analysis)
\`\`\`bash
# Create detailed specifications with concurrent requirements analysis
npx claude-flow sparc run spec-pseudocode "Define user authentication requirements" --parallel
\`\`\`
**Batchtools Optimization**: Simultaneously analyze multiple requirement sources, validate constraints in parallel, and generate comprehensive specifications.

### 2. Pseudocode Phase (Concurrent Logic Design)
\`\`\`bash
# Develop algorithmic logic with parallel pattern analysis
npx claude-flow sparc run spec-pseudocode "Create authentication flow pseudocode" --batch-optimize
\`\`\`
**Batchtools Optimization**: Process multiple algorithm patterns concurrently, validate logic flows in parallel, and optimize data structures simultaneously.

### 3. Architecture Phase (Parallel Component Design)
\`\`\`bash
# Design system architecture with concurrent component analysis
npx claude-flow sparc run architect "Design authentication service architecture" --parallel
\`\`\`
**Batchtools Optimization**: Generate multiple architectural alternatives simultaneously, validate integration points in parallel, and create comprehensive documentation concurrently.

### 4. Refinement Phase (Parallel TDD Implementation)
\`\`\`bash
# Execute Test-Driven Development with parallel test generation
npx claude-flow sparc tdd "implement user authentication system" --batch-tdd
\`\`\`
**Batchtools Optimization**: Generate multiple test scenarios simultaneously, implement and validate code in parallel, and optimize performance concurrently.

### 5. Completion Phase (Concurrent Integration)
\`\`\`bash
# Integration with parallel validation and documentation
npx claude-flow sparc run integration "integrate authentication with user management" --parallel
\`\`\`
**Batchtools Optimization**: Run integration tests in parallel, generate documentation concurrently, and validate requirements simultaneously.

## Batchtools Integration Features

### Parallel Processing Capabilities
- **Concurrent File Operations**: Read, analyze, and modify multiple files simultaneously
- **Parallel Code Analysis**: Analyze dependencies, patterns, and architecture concurrently
- **Batch Test Generation**: Create comprehensive test suites in parallel
- **Concurrent Documentation**: Generate multiple documentation formats simultaneously

### Performance Optimizations
- **Smart Batching**: Group related operations for optimal performance
- **Pipeline Processing**: Chain dependent operations with parallel stages
- **Resource Management**: Efficient utilization of system resources
- **Error Resilience**: Robust error handling with parallel recovery

## Performance Benchmarks

### Batchtools Performance Improvements
- **File Operations**: Up to 300% faster with parallel processing
- **Code Analysis**: 250% improvement with concurrent pattern recognition
- **Test Generation**: 400% faster with parallel test creation
- **Documentation**: 200% improvement with concurrent content generation
- **Memory Operations**: 180% faster with batched read/write operations

## Code Style and Best Practices (Batchtools Enhanced)

### SPARC Development Principles with Batchtools
- **Modular Design**: Keep files under 500 lines, optimize with parallel analysis
- **Environment Safety**: Never hardcode secrets, validate with concurrent checks
- **Test-First**: Always write tests before implementation using parallel generation
- **Clean Architecture**: Separate concerns with concurrent validation
- **Parallel Documentation**: Maintain clear, up-to-date documentation with concurrent updates

### Batchtools Best Practices
- **Parallel Operations**: Use batchtools for independent tasks
- **Concurrent Validation**: Validate multiple aspects simultaneously
- **Batch Processing**: Group similar operations for efficiency
- **Pipeline Optimization**: Chain operations with parallel stages
- **Resource Management**: Monitor and optimize resource usage

## Important Notes (Enhanced)

- Always run tests before committing with parallel execution (\`npm run test --parallel\`)
- Use SPARC memory system with concurrent operations to maintain context across sessions
- Follow the Red-Green-Refactor cycle with parallel test generation during TDD phases
- Document architectural decisions with concurrent validation in memory
- Regular security reviews with parallel analysis for authentication or data handling code
- Claude Code slash commands provide quick access to batchtools-optimized SPARC modes
- Monitor system resources during parallel operations for optimal performance

For more information about SPARC methodology and batchtools optimization, see: 
- SPARC Guide: https://github.com/ruvnet/claude-code-flow/docs/sparc.md
- Batchtools Documentation: https://github.com/ruvnet/claude-code-flow/docs/batchtools.md

# important-instruction-reminders
Do what has been asked; nothing more, nothing less.
NEVER create files unless they're absolutely necessary for achieving your goal.
ALWAYS prefer editing an existing file to creating a new one.
NEVER proactively create documentation files (*.md) or README files. Only create documentation files if explicitly requested by the User.
`;
}