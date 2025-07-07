# Swarm Initialization

## Overview
Initialize and configure agent swarms with various topologies and strategies.

## Usage
```bash
claude-flow swarm init [topology] [options]
```

## Topologies
- 🔗 **Mesh**: Fully connected agents
- 📊 **Hierarchical**: Tree structure
- 🔄 **Ring**: Circular communication
- ⭐ **Star**: Central coordinator

## Options
- `--max-agents`: Maximum agents (default: 8)
- `--strategy`: Coordination strategy
- `--auto-scale`: Enable auto-scaling
- `--monitor`: Real-time monitoring

## MCP Integration
- `mcp__claude-mcp__swarm_init`
- `mcp__claude-mcp__topology_optimize`
