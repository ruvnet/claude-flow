# swarm-monitor

Real-time swarm monitoring.

## Usage
```bash
npx @claude-flow/cli@latest swarm monitor [options]
```

## Options
- `--interval <ms>` - Update interval
- `--metrics` - Show detailed metrics
- `--export` - Export monitoring data

## Examples
```bash
# Start monitoring
npx @claude-flow/cli@latest swarm monitor

# Custom interval
npx @claude-flow/cli@latest swarm monitor --interval 5000

# With metrics
npx @claude-flow/cli@latest swarm monitor --metrics
```
