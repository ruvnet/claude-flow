# Agent Spawning

## Overview
Spawn specialized agents for various tasks and capabilities.

## Usage
```bash
claude-flow agent spawn [type] [options]
```

## Agent Types
- 💻 **coder**: Code implementation
- 🔍 **researcher**: Information gathering
- 🏗️ **architect**: System design
- 🧪 **tester**: Testing and QA
- 📊 **analyst**: Data analysis
- 📝 **documenter**: Documentation
- 🔧 **optimizer**: Performance optimization
- 🎯 **coordinator**: Task coordination

## Options
- `--capability`: Specific capabilities
- `--task`: Assign immediate task
- `--swarm`: Join specific swarm

## MCP Integration
- `mcp__claude-mcp__agent_spawn`
- `mcp__claude-mcp__daa_agent_create`
