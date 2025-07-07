# Examples Swarm Strategy

## Common Swarm Patterns

### Research Swarm
```bash
./claude-flow swarm "research AI trends" \
  --strategy research \
  --mode distributed \
  --max-agents 6 \
  --parallel
```

### Development Swarm
```bash
./claude-flow swarm "build REST API" \
  --strategy development \
  --mode hierarchical \
  --monitor \
  --output sqlite
```

### Analysis Swarm
```bash
./claude-flow swarm "analyze codebase" \
  --strategy analysis \
  --mode mesh \
  --parallel \
  --timeout 300
```
