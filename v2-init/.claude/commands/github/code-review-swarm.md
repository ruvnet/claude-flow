# Code Review Swarm

## Overview
Deploy a swarm of specialized agents for comprehensive code reviews.

## Usage
```bash
claude-flow github review-swarm [pr-url] [options]
```

## Swarm Agents
- 🏗️ Architecture Reviewer
- 🔒 Security Reviewer
- ⚡ Performance Reviewer
- 🧪 Test Coverage Reviewer
- 📝 Documentation Reviewer
- 🎨 Style Guide Reviewer

## Features
- Parallel review execution
- Comprehensive feedback
- Priority-based findings
- Automated suggestions
- Review summary generation

## MCP Integration
- Spawns multiple specialized agents
- Coordinates through `mcp__claude-mcp__swarm_init`
- Uses `mcp__claude-mcp__github_code_review`
