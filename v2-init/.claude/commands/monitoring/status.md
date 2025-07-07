# System Status Monitoring

## Overview
Real-time monitoring of Claude Flow system health and performance.

## Usage
```bash
claude-flow status [component] [options]
```

## Components
- **system**: Overall system health
- **agents**: Agent status
- **memory**: Memory usage
- **tasks**: Task queue
- **performance**: Performance metrics

## Display Options
- `--json`: JSON output
- `--verbose`: Detailed info
- `--watch`: Real-time updates
- `--interval`: Update interval

## Examples
```bash
# System overview
claude-flow status

# Agent monitoring
claude-flow status agents --watch

# Performance metrics
claude-flow status performance --verbose
```

## MCP Integration
- `mcp__claude-mcp__swarm_status`
- `mcp__claude-mcp__health_check`
- `mcp__claude-mcp__performance_report`
