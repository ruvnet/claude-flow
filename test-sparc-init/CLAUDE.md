# Claude Code Configuration - SPARC Development Environment (Batchtools Optimized)

## Project Overview
This project uses the SPARC (Specification, Pseudocode, Architecture, Refinement, Completion) methodology for systematic Test-Driven Development with AI assistance through Claude-Flow orchestration.

**🚀 Batchtools Optimization Enabled**: This configuration includes optimized prompts and parallel processing capabilities for improved performance and efficiency.

## SPARC Development Commands

### Core SPARC Commands
- `npx claude-flow sparc modes`: List all available SPARC development modes
- `npx claude-flow sparc run <mode> "<task>"`: Execute specific SPARC mode for a task
- `npx claude-flow sparc tdd "<feature>"`: Run complete TDD workflow using SPARC methodology
- `npx claude-flow sparc info <mode>`: Get detailed information about a specific mode

### Batchtools Commands (Optimized)
- `npx claude-flow sparc batch <modes> "<task>"`: Execute multiple SPARC modes in parallel
- `npx claude-flow sparc pipeline "<task>"`: Execute full SPARC pipeline with parallel processing
- `npx claude-flow sparc concurrent <mode> "<tasks-file>"`: Process multiple tasks concurrently

### Standard Build Commands
- `npm run build`: Build the project
- `npm run test`: Run the test suite
- `npm run lint`: Run linter and format checks
- `npm run typecheck`: Run TypeScript type checking

## SPARC Methodology Workflow (Batchtools Enhanced)

### 1. Specification Phase (Parallel Analysis)
```bash
# Create detailed specifications with concurrent requirements analysis
npx claude-flow sparc run spec-pseudocode "Define user authentication requirements" --parallel
```
**Batchtools Optimization**: Simultaneously analyze multiple requirement sources, validate constraints in parallel, and generate comprehensive specifications.

### 2. Pseudocode Phase (Concurrent Logic Design)
```bash
# Develop algorithmic logic with parallel pattern analysis
npx claude-flow sparc run spec-pseudocode "Create authentication flow pseudocode" --batch-optimize
```
**Batchtools Optimization**: Process multiple algorithm patterns concurrently, validate logic flows in parallel, and optimize data structures simultaneously.

### 3. Architecture Phase (Parallel Component Design)
```bash
# Design system architecture with concurrent component analysis
npx claude-flow sparc run architect "Design authentication service architecture" --parallel
```
**Batchtools Optimization**: Generate multiple architectural alternatives simultaneously, validate integration points in parallel, and create comprehensive documentation concurrently.

### 4. Refinement Phase (Parallel TDD Implementation)
```bash
# Execute Test-Driven Development with parallel test generation
npx claude-flow sparc tdd "implement user authentication system" --batch-tdd
```
**Batchtools Optimization**: Generate multiple test scenarios simultaneously, implement and validate code in parallel, and optimize performance concurrently.

### 5. Completion Phase (Concurrent Integration)
```bash
# Integration with parallel validation and documentation
npx claude-flow sparc run integration "integrate authentication with user management" --parallel
```
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

- Always run tests before committing with parallel execution (`npm run test --parallel`)
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
