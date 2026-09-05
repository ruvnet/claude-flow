# agent-metrics

View agent performance metrics.

## Usage
```bash
npx @claude-flow/cli@latest agent metrics [options]
```

## Options
- `--agent-id <id>` - Specific agent
- `--period <time>` - Time period
- `--format <type>` - Output format

## Examples
```bash
# All agents metrics
npx @claude-flow/cli@latest agent metrics

# Specific agent
npx @claude-flow/cli@latest agent metrics --agent-id agent-001

# Last hour
npx @claude-flow/cli@latest agent metrics --period 1h
```
