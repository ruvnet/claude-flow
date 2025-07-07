# Development Workflows

## Overview
Pre-configured development workflows for common scenarios.

## Available Workflows

### 1. Feature Development
Complete workflow from design to deployment:
- Requirements analysis
- Architecture design
- Implementation
- Testing
- Documentation
- PR creation

### 2. Bug Fixing
Systematic bug resolution:
- Reproduction
- Root cause analysis
- Fix implementation
- Test creation
- Verification

### 3. Refactoring
Safe refactoring workflow:
- Code analysis
- Refactor planning
- Implementation
- Test verification
- Performance check

### 4. API Development
API-first development:
- Schema design
- Implementation
- Testing
- Documentation
- Client generation

## Usage
```bash
claude-flow workflow dev [type] [options]
```

## Examples
```bash
# Start feature workflow
claude-flow workflow dev feature --name "user-auth"

# Bug fix workflow
claude-flow workflow dev bugfix --issue "#123"

# Refactoring workflow
claude-flow workflow dev refactor --target "src/legacy"
```

## MCP Integration
- `mcp__claude-mcp__workflow_create`
- `mcp__claude-mcp__workflow_execute`
- `mcp__claude-mcp__task_orchestrate`
