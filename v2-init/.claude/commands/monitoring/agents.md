# Agent Monitoring

## Overview
Monitor and manage individual agents and swarms in real-time.

## Usage
```bash
claude-flow monitor agents [options]
```

## Features
- 👥 Agent lifecycle tracking
- 📊 Performance metrics
- 🔄 Task distribution
- 💾 Resource usage
- 🚨 Alert management

## Views
- **Dashboard**: Overview of all agents
- **Individual**: Single agent details
- **Swarm**: Swarm-level metrics
- **Timeline**: Historical view

## Commands
```bash
# Monitor all agents
claude-flow monitor agents

# Specific agent
claude-flow monitor agent [id]

# Swarm monitoring
claude-flow monitor swarm [id]

# Export metrics
claude-flow monitor export
```

## MCP Integration
- `mcp__claude-mcp__agent_list`
- `mcp__claude-mcp__agent_metrics`
- `mcp__claude-mcp__swarm_monitor`
