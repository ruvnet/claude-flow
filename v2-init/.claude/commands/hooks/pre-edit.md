# pre-edit

Hook executed before file edits.

## Usage
```bash
npx claude-flow hook pre-edit [options]
```

## Options
- `--file <path>` - File to be edited
- `--validate-syntax` - Validate syntax before edit
- `--backup` - Create backup

## Examples
```bash
# Pre-edit hook
npx claude-flow hook pre-edit --file src/api.js

# With validation
npx claude-flow hook pre-edit --file src/api.js --validate-syntax

# Create backup
npx claude-flow hook pre-edit --file src/api.js --backup
```
