# Memory Usage Guide

## Overview
Comprehensive guide to using Claude Flow's memory system for persistence and context.

## Basic Usage
```bash
claude-flow memory [action] [key] [value]
```

## Actions
- **store**: Save data to memory
- **retrieve**: Get data from memory
- **list**: List all keys
- **delete**: Remove data
- **search**: Search memory

## Examples
```bash
# Store data
claude-flow memory store "project-context" "Building an AI assistant"

# Retrieve data
claude-flow memory retrieve "project-context"

# Search memory
claude-flow memory search "project"

# List all keys
claude-flow memory list
```

## Namespacing
```bash
# Use namespaces for organization
claude-flow memory store "team/frontend/config" "{...}"
claude-flow memory list --namespace "team/frontend"
```

## MCP Integration
- `mcp__claude-mcp__memory_usage`
- `mcp__claude-mcp__memory_search`
- `mcp__claude-mcp__memory_namespace`
