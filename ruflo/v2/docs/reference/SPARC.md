# SPARC Methodology Documentation

## Overview

SPARC (Specification → Pseudocode → Architecture → Refinement → Code) is a systematic development methodology that provides structured, mode-based development environments for different software development tasks. This comprehensive approach ensures consistent, high-quality results across all phases of development.

### Core Philosophy

SPARC transforms development from ad-hoc coding to systematic engineering by:

1. **Specification First**: Define what needs to be built before building it
2. **Pseudocode Planning**: Think through the logic before implementation  
3. **Architecture Design**: Plan the system structure and relationships
4. **Refinement Process**: Iteratively improve design and implementation
5. **Code Implementation**: Execute with clear direction and validated approach

### Key Benefits

- **Systematic Approach**: Reduces errors through structured methodology
- **Mode Specialization**: Each development task has an optimized execution environment
- **Memory Integration**: Persistent context across development sessions
- **Parallel Execution**: Multiple modes can work concurrently using BatchTool
- **Quality Assurance**: Built-in best practices and validation steps

## SPARC Modes Reference

### Core Development Modes

#### 1. **orchestrator** - Multi-Agent Task Orchestration
- **Purpose**: Coordinates complex development tasks across multiple agents
- **Best For**: Large projects requiring multiple specialists
- **Tools**: TodoWrite, TodoRead, Task, Memory, Bash
- **Usage Pattern**: Central coordination with distributed execution
- **Best Practices**:
  - Use batch operations for multiple file operations
  - Store intermediate results in Memory for team coordination
  - Enable parallel execution for independent tasks
  - Monitor resource usage during intensive operations
  - Leverage centralized coordination for team management

#### 2. **coder** - Autonomous Code Generation
- **Purpose**: Implementation and code generation with best practices
- **Best For**: Feature development, bug fixes, code refactoring
- **Tools**: Read, Write, Edit, MultiEdit, Bash, TodoWrite
- **Usage Pattern**: Direct implementation with testing validation
- **Best Practices**:
  - Follow existing code patterns and conventions
  - Write comprehensive tests for new code
  - Use batch file operations for efficiency
  - Implement proper error handling
  - Add meaningful comments and documentation

#### 3. **architect** - System Design and Architecture
- **Purpose**: High-level system design and architectural planning
- **Best For**: System architecture, technology decisions, design patterns
- **Tools**: Write, Memory, TodoWrite, Read
- **Usage Pattern**: Analysis → Design → Documentation → Validation
- **Best Practices**:
  - Design for scalability and maintainability
  - Document architectural decisions
  - Create clear component boundaries
  - Plan for future extensibility
  - Consider performance implications

#### 4. **tdd** - Test-Driven Development
- **Purpose**: London School TDD methodology implementation
- **Best For**: Feature development with comprehensive test coverage
- **Tools**: Write, Edit, Bash, TodoWrite, Read
- **Usage Pattern**: Red → Green → Refactor cycle
- **Best Practices**:
  - Write tests before implementation
  - Follow red-green-refactor cycle
  - Aim for comprehensive test coverage
  - Test edge cases and error conditions
  - Keep tests simple and focused

### Analysis and Research Modes

#### 5. **researcher** - Deep Research and Analysis
- **Purpose**: Comprehensive research and information gathering
- **Best For**: Technology evaluation, market research, requirements gathering
- **Tools**: WebSearch, WebFetch, Read, Memory, TodoWrite
- **Usage Pattern**: Search → Analysis → Documentation → Synthesis
- **Best Practices**:
  - Verify information from multiple sources
  - Store findings in Memory for later reference
  - Create structured research reports
  - Cross-reference and validate data
  - Document sources and methodology

#### 6. **analyst** - Code and Data Analysis
- **Purpose**: Deep analysis of codebases, performance, and patterns
- **Best For**: Code reviews, performance analysis, technical debt assessment
- **Tools**: Read, Grep, Glob, Memory, TodoWrite
- **Usage Pattern**: Discovery → Analysis → Insights → Recommendations
- **Best Practices**:
  - Use efficient search patterns
  - Analyze code metrics
  - Identify patterns and anomalies
  - Store analysis results
  - Create actionable insights

### Quality Assurance Modes

#### 7. **reviewer** - Code Review and Quality Optimization
- **Purpose**: Comprehensive code review and quality improvement
- **Best For**: Pull request reviews, code quality audits
- **Tools**: Read, Edit, TodoWrite, Memory
- **Usage Pattern**: Review → Analysis → Feedback → Validation
- **Best Practices**:
  - Check for security vulnerabilities
  - Verify code follows conventions
  - Suggest performance improvements
  - Ensure proper error handling
  - Validate test coverage

#### 8. **tester** - Comprehensive Testing and Validation
- **Purpose**: Test creation, execution, and validation
- **Best For**: Test suite development, QA validation, regression testing
- **Tools**: Write, Bash, Read, TodoWrite
- **Usage Pattern**: Planning → Implementation → Execution → Reporting
- **Best Practices**:
  - Test all code paths
  - Include edge cases
  - Verify error handling
  - Test performance characteristics
  - Automate test execution

#### 9. **security-review** - Security Analysis and Hardening
- **Purpose**: Security vulnerability analysis and remediation
- **Best For**: Security audits, penetration testing, compliance validation
- **Tools**: Read, Grep, Bash, Write, TodoWrite
- **Usage Pattern**: Assessment → Analysis → Remediation → Validation
- **Best Practices**:
  - Follow OWASP guidelines
  - Check for common vulnerabilities
  - Validate input sanitization
  - Review authentication mechanisms
  - Test authorization controls

### Development Support Modes

#### 10. **debugger** - Systematic Debugging
- **Purpose**: Debug and fix issues with systematic approach
- **Best For**: Bug investigation, error resolution, performance issues
- **Tools**: Read, Edit, Bash, TodoWrite
- **Usage Pattern**: Reproduction → Analysis → Resolution → Validation
- **Best Practices**:
  - Reproduce issues consistently
  - Use systematic debugging approach
  - Add diagnostic logging
  - Fix root causes not symptoms
  - Write tests to prevent regression

#### 11. **optimizer** - Performance Optimization
- **Purpose**: Performance analysis and optimization
- **Best For**: Performance bottlenecks, resource optimization, scalability
- **Tools**: Read, Edit, Bash, Memory, TodoWrite
- **Usage Pattern**: Profiling → Analysis → Optimization → Validation
- **Best Practices**:
  - Profile before optimizing
  - Focus on bottlenecks
  - Measure improvements
  - Balance readability and performance
  - Document optimization rationale

#### 12. **documenter** - Documentation Generation
- **Purpose**: Technical documentation creation and maintenance
- **Best For**: API docs, user guides, technical specifications
- **Tools**: Write, Read, TodoWrite
- **Usage Pattern**: Analysis → Structure → Content → Review
- **Best Practices**:
  - Keep documentation current
  - Include examples
  - Document APIs thoroughly
  - Use clear language
  - Organize logically

### Specialized Modes

#### 13. **devops** - DevOps and Infrastructure
- **Purpose**: Infrastructure, CI/CD, deployment automation
- **Best For**: Pipeline setup, containerization, infrastructure as code
- **Tools**: Write, Bash, Read, TodoWrite
- **Usage Pattern**: Planning → Configuration → Automation → Monitoring
- **Best Practices**:
  - Automate repetitive tasks
  - Use infrastructure as code
  - Implement proper monitoring
  - Ensure security best practices
  - Document deployment procedures

#### 14. **integration** - System Integration
- **Purpose**: API integration, service communication, data flow
- **Best For**: Third-party integrations, microservices communication
- **Tools**: Read, Write, Bash, WebFetch, TodoWrite
- **Usage Pattern**: Analysis → Design → Implementation → Testing
- **Best Practices**:
  - Handle integration failures gracefully
  - Implement proper retry mechanisms
  - Monitor integration health
  - Document API contracts
  - Test integration scenarios

#### 15. **mcp** - MCP Tool Development
- **Purpose**: Model Context Protocol tool development and integration
- **Best For**: Claude integration, tool development, protocol implementation
- **Tools**: Write, Read, Bash, TodoWrite
- **Usage Pattern**: Specification → Implementation → Testing → Integration
- **Best Practices**:
  - Follow MCP specification
  - Implement proper error handling
  - Test tool interactions
  - Document tool capabilities
  - Validate protocol compliance

#### 16. **ask** - Requirements Analysis
- **Purpose**: Requirement gathering and clarification
- **Best For**: Project scoping, stakeholder communication, requirement validation
- **Tools**: WebSearch, Memory, TodoWrite, Read
- **Usage Pattern**: Discovery → Analysis → Clarification → Documentation
- **Best Practices**:
  - Ask clarifying questions
  - Document assumptions
  - Validate understanding
  - Identify edge cases
  - Prioritize requirements

#### 17. **tutorial** - Educational Content Creation
- **Purpose**: Tutorial and learning content development
- **Best For**: Documentation, training materials, educational resources
- **Tools**: Write, Read, TodoWrite, WebSearch
- **Usage Pattern**: Planning → Content → Examples → Review
- **Best Practices**:
  - Structure content logically
  - Include practical examples
  - Test all code examples
  - Consider different skill levels
  - Provide clear next steps

## Command Syntax and Options

### Basic Commands

```bash
# List all available SPARC modes
npx claude-flow@alpha sparc modes [--verbose]

# Get detailed information about a specific mode
npx claude-flow@alpha sparc info <mode-slug>

# Execute a task in a specific SPARC mode
npx claude-flow@alpha sparc run <mode> "<task-description>"

# Run Test-Driven Development workflow
npx claude-flow@alpha sparc tdd "<feature-description>"
```

### Command Options

#### Global Flags
- `--help, -h` - Show help information
- `--verbose, -v` - Enable detailed output
- `--dry-run, -d` - Show configuration without executing
- `--non-interactive, -n` - Run without user prompts
- `--namespace <name>` - Use custom memory namespace

#### Permission Control
- `--enable-permissions` - Enable permission prompts (default: auto-skip)
- `--dangerously-skip-permissions` - Skip all permission prompts (automatically applied)

#### Configuration
- `--config <path>` - Use custom MCP configuration file
- `--interactive, -i` - Enable interactive mode (for TDD workflow)

### Advanced Usage Examples

#### Single Mode Execution
```bash
# Code implementation with custom namespace
npx claude-flow@alpha sparc run code "implement user authentication" --namespace auth_system

# Architecture planning with verbose output
npx claude-flow@alpha sparc run architect "design microservices architecture" --verbose

# Test-driven development for payment system
npx claude-flow@alpha sparc run tdd "payment processing with validation" --namespace payments

# Security review of existing codebase
npx claude-flow@alpha sparc run security-review "audit authentication system" --verbose

# Performance optimization with non-interactive mode
npx claude-flow@alpha sparc run optimizer "optimize database queries" --non-interactive
```

#### TDD Workflow
```bash
# Interactive TDD workflow (step-by-step)
npx claude-flow@alpha sparc tdd "user registration system" --interactive

# Automated TDD workflow
npx claude-flow@alpha sparc tdd "shopping cart functionality" --namespace ecommerce

# TDD with custom configuration
npx claude-flow@alpha sparc tdd "payment gateway integration" --config ./custom-mcp.json
```

## Pipeline and Batch Execution

### BatchTool Integration

SPARC modes can be orchestrated using BatchTool for parallel and sequential execution:

#### Parallel Execution
```bash
# Run multiple modes concurrently
batchtool run --parallel \
  "npx claude-flow@alpha sparc run architect 'system design' --non-interactive" \
  "npx claude-flow@alpha sparc run security-review 'security requirements' --non-interactive" \
  "npx claude-flow@alpha sparc run researcher 'technology evaluation' --non-interactive"
```

#### Sequential Pipeline
```bash
# Sequential execution with result chaining
batchtool pipeline \
  --stage1 "npx claude-flow@alpha sparc run ask 'gather requirements' --non-interactive" \
  --stage2 "npx claude-flow@alpha sparc run architect 'design system' --non-interactive" \
  --stage3 "npx claude-flow@alpha sparc run code 'implement features' --non-interactive" \
  --stage4 "npx claude-flow@alpha sparc run tdd 'create test suite' --non-interactive"
```

#### Boomerang Pattern
```bash
# Iterative development with feedback loops
batchtool orchestrate --boomerang \
  --research "npx claude-flow@alpha sparc run researcher 'best practices' --non-interactive" \
  --design "npx claude-flow@alpha sparc run architect 'system design' --non-interactive" \
  --implement "npx claude-flow@alpha sparc run code 'feature implementation' --non-interactive" \
  --test "npx claude-flow@alpha sparc run tdd 'validation suite' --non-interactive" \
  --refine "npx claude-flow@alpha sparc run optimizer 'performance tuning' --non-interactive"
```

### Full Development Pipeline

#### Complete Feature Development
```bash
# End-to-end feature development pipeline
npx claude-flow@alpha sparc pipeline "user authentication system" \
  --phases "ask,architect,security-review,code,tdd,optimizer,documenter" \
  --namespace "auth_feature" \
  --parallel-compatible "ask,security-review,documenter"
```

#### Microservices Development
```bash
# Parallel microservices development
batchtool run --max-parallel 3 \
  "npx claude-flow@alpha sparc run code 'user service' --namespace users --non-interactive" \
  "npx claude-flow@alpha sparc run code 'order service' --namespace orders --non-interactive" \
  "npx claude-flow@alpha sparc run code 'payment service' --namespace payments --non-interactive" \
  "npx claude-flow@alpha sparc run integration 'service communication' --namespace integration --non-interactive"
```

## TDD Workflow Integration

### London School TDD Methodology

The SPARC TDD mode implements London School TDD with the following phases:

#### 1. Test Planning & Analysis (10 mins)
- Analyze requirements and existing architecture
- Define test boundaries and acceptance criteria
- Plan test structure (unit, integration, e2e)
- Identify test doubles needed (mocks, stubs, spies)

#### 2. Red Phase - Write Failing Tests (20 mins)
- Create comprehensive test structure
- Write tests following London School TDD principles
- Focus on behavior/contract tests with test doubles
- Ensure all tests fail with meaningful messages

#### 3. Green Phase - Minimal Implementation (20 mins)
- Implement only enough code to pass tests
- Make one test pass at a time
- Maintain modularity and proper error handling
- Track coverage as you progress

#### 4. Refactor Phase - Optimize & Clean (15 mins)
- Refactor while keeping tests green
- Extract common patterns and improve clarity
- Optimize algorithms and reduce duplication
- Improve test maintainability

#### 5. Documentation & Validation (10 mins)
- Generate coverage reports
- Document test scenarios and execution guide
- Set up CI/CD test configuration
- Validate against acceptance criteria

### TDD Command Examples

```bash
# Start interactive TDD workflow
npx claude-flow@alpha sparc tdd "shopping cart with discounts" --interactive

# Automated TDD with custom namespace
npx claude-flow@alpha sparc tdd "payment validation system" --namespace payments

# TDD with integration testing focus
npx claude-flow@alpha sparc run tdd "API endpoint with database" --namespace api_tests
```

## Memory Namespace Usage

### Namespace Strategy

Memory namespaces organize context and enable coordination between modes:

#### Namespace Patterns
- `feature_<name>` - Feature development context
- `bug_<id>` - Bug fix tracking
- `arch_<system>` - Architecture planning
- `test_<suite>` - Test development
- `integration_<service>` - Integration work

#### Memory Operations
```bash
# Store progress and context
npx claude-flow@alpha memory store <namespace>_progress "Current implementation status"
npx claude-flow@alpha memory store <namespace>_decisions "Key architectural decisions"
npx claude-flow@alpha memory store <namespace>_blockers "Current impediments"

# Query previous work and context
npx claude-flow@alpha memory query <namespace>
npx claude-flow@alpha memory query <namespace>_architecture
npx claude-flow@alpha memory query <namespace>_requirements

# List all namespaces
npx claude-flow@alpha memory list
```

### Cross-Mode Coordination

#### Shared Context Example
```bash
# Architect stores system design
npx claude-flow@alpha sparc run architect "design user system" --namespace user_feature

# Coder implements based on architect's design
npx claude-flow@alpha sparc run code "implement user CRUD" --namespace user_feature

# Tester validates implementation
npx claude-flow@alpha sparc run tdd "test user operations" --namespace user_feature

# All modes share the user_feature namespace for context
```

## Practical Examples

### Web Application Development

#### Full-Stack Development Pipeline
```bash
# 1. Requirements and research
npx claude-flow@alpha sparc run ask "e-commerce requirements" --namespace ecommerce

# 2. System architecture
npx claude-flow@alpha sparc run architect "microservices design" --namespace ecommerce

# 3. Parallel service development
batchtool run --parallel \
  "npx claude-flow@alpha sparc run code 'user service API' --namespace ecommerce_users --non-interactive" \
  "npx claude-flow@alpha sparc run code 'product catalog API' --namespace ecommerce_products --non-interactive" \
  "npx claude-flow@alpha sparc run code 'order processing API' --namespace ecommerce_orders --non-interactive"

# 4. Integration and testing
npx claude-flow@alpha sparc run integration "service communication" --namespace ecommerce
npx claude-flow@alpha sparc run tdd "end-to-end testing" --namespace ecommerce

# 5. Security and optimization
batchtool run --parallel \
  "npx claude-flow@alpha sparc run security-review 'security audit' --namespace ecommerce --non-interactive" \
  "npx claude-flow@alpha sparc run optimizer 'performance tuning' --namespace ecommerce --non-interactive"
```

### API Development

#### RESTful API with TDD
```bash
# Test-driven API development
npx claude-flow@alpha sparc tdd "RESTful user management API" --namespace user_api

# Add authentication layer
npx claude-flow@alpha sparc run security-review "API authentication" --namespace user_api

# Performance optimization
npx claude-flow@alpha sparc run optimizer "API response times" --namespace user_api

# Documentation generation
npx claude-flow@alpha sparc run documenter "API documentation" --namespace user_api
```

### Bug Fix Workflow

#### Systematic Bug Resolution
```bash
# 1. Research and reproduction
npx claude-flow@alpha sparc run debugger "investigate login failures" --namespace bug_1234

# 2. Root cause analysis
npx claude-flow@alpha sparc run analyst "analyze authentication flow" --namespace bug_1234

# 3. Fix implementation with tests
npx claude-flow@alpha sparc run tdd "fix and test authentication" --namespace bug_1234

# 4. Security validation
npx claude-flow@alpha sparc run security-review "validate auth fix" --namespace bug_1234
```

### DevOps and Infrastructure

#### CI/CD Pipeline Setup
```bash
# Infrastructure planning
npx claude-flow@alpha sparc run architect "CI/CD architecture" --namespace devops

# Pipeline implementation
npx claude-flow@alpha sparc run devops "GitHub Actions workflow" --namespace devops

# Monitoring and alerts
npx claude-flow@alpha sparc run devops "application monitoring" --namespace devops

# Documentation
npx claude-flow@alpha sparc run documenter "deployment guide" --namespace devops
```

### Research and Analysis

#### Technology Evaluation
```bash
# Research phase
npx claude-flow@alpha sparc run researcher "JavaScript framework comparison" --namespace tech_eval

# Architecture implications
npx claude-flow@alpha sparc run architect "framework integration design" --namespace tech_eval

# Prototype development
npx claude-flow@alpha sparc run code "proof of concept" --namespace tech_eval

# Analysis and recommendation
npx claude-flow@alpha sparc run analyst "framework recommendation" --namespace tech_eval
```

## Best Practices and Tips

### Development Workflow

#### 1. Start with Specification
- Always begin with `ask` mode to clarify requirements
- Document assumptions and constraints
- Validate understanding before implementation

#### 2. Use Memory Effectively
- Create meaningful namespace hierarchies
- Store key decisions and context
- Query previous work before starting new tasks

#### 3. Leverage Parallel Execution
- Identify independent tasks for parallel execution
- Use BatchTool for concurrent mode execution
- Coordinate results through shared namespaces

#### 4. Follow TDD Principles
- Write tests before implementation when applicable
- Maintain high test coverage
- Use TDD mode for feature development

#### 5. Optimize Performance
- Profile before optimizing
- Use optimizer mode for performance improvements
- Balance readability with performance

### Quality Assurance

#### 1. Security First
- Always run security-review for sensitive features
- Follow OWASP guidelines
- Validate input and sanitize output

#### 2. Code Quality
- Use reviewer mode for code quality checks
- Follow established coding conventions
- Maintain documentation alongside code

#### 3. Testing Strategy
- Use comprehensive testing approach (unit, integration, e2e)
- Test edge cases and error conditions
- Automate test execution in CI/CD

### Collaboration and Documentation

#### 1. Cross-Mode Coordination
- Share context through memory namespaces
- Use consistent naming conventions
- Document inter-mode dependencies

#### 2. Documentation Maintenance
- Keep documentation current with code changes
- Use documenter mode for comprehensive docs
- Include examples and usage patterns

#### 3. Progress Tracking
- Store progress updates in memory
- Use meaningful commit messages
- Track blockers and resolutions

### Common Patterns

#### 1. Boomerang Development
Research → Design → Implement → Test → Optimize → Loop back

#### 2. Parallel Feature Development
Multiple features developed concurrently with coordination

#### 3. Pipeline Development
Sequential phases with hand-off between specialized modes

#### 4. Iterative Refinement
Continuous improvement through multiple optimization cycles

### Performance Optimization

#### 1. Batch Operations
- Use batch file operations when possible
- Minimize context switching between modes
- Leverage parallel execution for independent tasks

#### 2. Memory Management
- Use focused memory namespaces
- Clean up obsolete context
- Share common context efficiently

#### 3. Resource Utilization
- Monitor resource usage during intensive operations
- Use non-interactive mode for automation
- Balance parallelism with resource constraints

### Troubleshooting

#### Common Issues and Solutions

1. **Mode Not Found**
   - Ensure `.roomodes` file exists in project directory
   - Run `npx claude-flow@alpha init --sparc` to set up SPARC environment

2. **Permission Issues**
   - Use `--enable-permissions` for manual control
   - Default behavior uses `--dangerously-skip-permissions` for efficiency

3. **Memory Namespace Conflicts**
   - Use unique namespace names
   - Query existing namespaces with `npx claude-flow@alpha memory list`

4. **BatchTool Integration**
   - Ensure BatchTool is installed and configured
   - Use `--non-interactive` flag for parallel execution

5. **Performance Issues**
   - Use `--verbose` flag for debugging
   - Monitor resource usage
   - Consider reducing parallelism

### Advanced Configuration

#### Custom Mode Development
Create custom SPARC modes by extending the `.roomodes` configuration:

```json
{
  "customModes": [
    {
      "name": "Custom Mode",
      "slug": "custom",
      "roleDefinition": "Custom role description",
      "customInstructions": "Specific instructions",
      "groups": ["read", "edit", "command"],
      "source": "custom"
    }
  ]
}
```

#### Integration with IDEs
- Configure IDE to recognize SPARC commands
- Set up keyboard shortcuts for common operations
- Integrate with IDE task runners

#### CI/CD Integration
- Use SPARC modes in automated pipelines
- Configure parallel execution for build processes
- Integrate memory persistence for context sharing

---

## Summary

SPARC provides a comprehensive, mode-based development methodology that transforms ad-hoc coding into systematic engineering. By leveraging specialized modes, memory persistence, and parallel execution capabilities, SPARC enables efficient, high-quality software development at scale.

Key advantages:
- **Systematic Approach**: Structured methodology reduces errors
- **Mode Specialization**: Optimized environments for specific tasks
- **Parallel Execution**: Concurrent development with BatchTool integration
- **Memory Persistence**: Context sharing across development sessions
- **Quality Assurance**: Built-in best practices and validation

Start with `npx claude-flow@alpha sparc modes` to explore available modes, and use `npx claude-flow@alpha sparc run <mode> "<task>"` to begin systematic development with SPARC.