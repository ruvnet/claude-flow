# hook post-command

Execute post-command processing including output analysis and state updates.

## Usage

```bash
npx claude-flow hook post-command [options]
```

## Options

- `--command, -c <cmd>` - Command that was executed
- `--exit-code, -e <code>` - Command exit code
- `--analyze-output` - Analyze command output (default: true)
- `--update-cache` - Update command cache
- `--track-metrics` - Track performance metrics

## Examples

### Basic post-command hook

```bash
npx claude-flow hook post-command --command "npm test" --exit-code 0
```

### With output analysis

```bash
npx claude-flow hook post-command -c "git status" -e 0 --analyze-output
```

### Cache update

```bash
npx claude-flow hook post-command -c "npm list" -e 0 --update-cache
```

### Performance tracking

```bash
npx claude-flow hook post-command -c "build.sh" -e 0 --track-metrics
```

## Features

### Output Analysis

- Parses command output
- Extracts key information
- Identifies errors/warnings
- Summarizes results

### Cache Management

- Stores command results
- Enables fast re-execution
- Tracks output changes
- Reduces redundant runs

### Metric Tracking

- Records execution time
- Monitors resource usage
- Tracks success rates
- Identifies bottlenecks

### State Updates

- Updates project state
- Refreshes file indexes
- Syncs dependencies
- Maintains consistency

## Integration

This hook is automatically called by Claude Code when:

- After Bash tool execution
- Following shell commands
- Post build/test operations
- After system changes

Manual usage in agents:

```bash
# After running commands
npx claude-flow hook post-command --command "npm build" --exit-code 0 --analyze-output
```

## Output

Returns JSON with:

```json
{
  "command": "npm test",
  "exitCode": 0,
  "duration": 45230,
  "outputSummary": "All 42 tests passed",
  "cached": true,
  "metrics": {
    "cpuUsage": "45%",
    "memoryPeak": "256MB"
  },
  "stateChanges": ["test-results.json updated"],
  "warnings": []
}
```

## See Also

- `hook pre-command` - Pre-command validation
- `Bash` - Command execution tool
- `cache manage` - Cache operations
- `metrics collect` - Performance data
