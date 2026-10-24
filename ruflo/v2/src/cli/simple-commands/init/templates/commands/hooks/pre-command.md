# hook pre-command

Execute pre-command validations and safety checks before running shell commands.

## Usage

```bash
npx claude-flow hook pre-command [options]
```

## Options

- `--command, -c <cmd>` - Command to be executed
- `--validate-safety` - Check command safety (default: true)
- `--check-permissions` - Verify execution permissions
- `--estimate-duration` - Estimate command runtime
- `--dry-run` - Preview without executing

## Examples

### Basic pre-command hook

```bash
npx claude-flow hook pre-command --command "npm install express"
```

### Safety validation

```bash
npx claude-flow hook pre-command -c "rm -rf node_modules" --validate-safety
```

### Permission check

```bash
npx claude-flow hook pre-command -c "sudo apt update" --check-permissions
```

### Dry run preview

```bash
npx claude-flow hook pre-command -c "git push origin main" --dry-run
```

## Features

### Safety Validation

- Detects dangerous commands
- Warns about destructive operations
- Checks for sudo/admin usage
- Validates command syntax

### Permission Checking

- Verifies execution rights
- Checks directory access
- Validates file permissions
- Ensures proper context

### Duration Estimation

- Predicts execution time
- Warns about long operations
- Suggests timeouts
- Tracks historical data

### Dry Run Mode

- Shows command effects
- Lists files affected
- Previews changes
- No actual execution

## Integration

This hook is automatically called by Claude Code when:

- Using Bash tool
- Running shell commands
- Executing npm/pip/cargo commands
- System operations

Manual usage in agents:

```bash
# Before running commands
npx claude-flow hook pre-command --command "your command here" --validate-safety
```

## Output

Returns JSON with:

```json
{
  "continue": true,
  "command": "npm install express",
  "safe": true,
  "estimatedDuration": 15000,
  "warnings": [],
  "permissions": "user",
  "affectedFiles": ["package.json", "package-lock.json"],
  "dryRunOutput": "Would install 50 packages"
}
```

## See Also

- `hook post-command` - Post-command processing
- `Bash` - Command execution tool
- `terminal execute` - Terminal operations
- `security scan` - Security validation
