# session-end

Hook executed at session end.

## Usage
```bash
npx claude-flow hook session-end [options]
```

## Options
- `--export-metrics` - Export session metrics
- `--generate-summary` - Generate session summary
- `--persist-state` - Save session state

## Examples
```bash
# End session
npx claude-flow hook session-end

# Export metrics
npx claude-flow hook session-end --export-metrics

# Full closure
npx claude-flow hook session-end --export-metrics --generate-summary --persist-state
```
