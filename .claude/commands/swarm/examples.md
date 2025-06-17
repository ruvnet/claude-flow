# Claude-Flow Swarm Examples

## Quick Start Commands

### Research Tasks
```bash
claude-flow swarm "Research modern web frameworks" --strategy research --mode distributed
claude-flow swarm "Analyze market trends in AI" --strategy research --parallel --max-agents 6
```

### Development Tasks
```bash
claude-flow swarm "Build a microservice API" --strategy development --mode hierarchical
claude-flow swarm "Create React dashboard" --strategy development --parallel --max-agents 8
```

### Analysis Tasks
```bash
claude-flow swarm "Analyze user behavior data" --strategy analysis --mode mesh
claude-flow swarm "Performance analysis of application" --strategy analysis --monitor
```

### Testing Tasks
```bash
claude-flow swarm "Comprehensive testing suite" --strategy testing --parallel
claude-flow swarm "Security testing analysis" --strategy testing --mode distributed
```

### Optimization Tasks
```bash
claude-flow swarm "Optimize database queries" --strategy optimization --mode hybrid
claude-flow swarm "Frontend performance optimization" --strategy optimization --monitor
```

### Maintenance Tasks
```bash
claude-flow swarm "Update dependencies safely" --strategy maintenance --mode centralized
claude-flow swarm "System health check" --strategy maintenance --monitor
```

## Advanced Usage

### Custom Output and Monitoring
```bash
# Save results in different formats
claude-flow swarm "Research task" --output sqlite --output-dir ./results

# Enable real-time monitoring
claude-flow swarm "Long task" --monitor --timeout 120

# Dry run to see configuration
claude-flow swarm "Any task" --dry-run
```

### Coordination Modes

- **centralized**: Single coordinator (best for simple tasks)
- **distributed**: Multiple coordinators (best for complex, parallelizable tasks)
- **hierarchical**: Tree structure (best for organized, structured work)
- **mesh**: Peer-to-peer (best for dynamic, adaptive tasks)
- **hybrid**: Mixed patterns (best for complex workflows)

See .claude/commands/swarm/ for detailed documentation on each strategy.
