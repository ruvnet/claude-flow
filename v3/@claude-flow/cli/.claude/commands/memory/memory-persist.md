# memory-persist

Persist memory across sessions.

## Usage
```bash
npx @claude-flow/cli@latest memory persist [options]
```

## Options
- `--export <file>` - Export to file
- `--import <file>` - Import from file
- `--compress` - Compress memory data

## Examples
```bash
# Export memory
npx @claude-flow/cli@latest memory persist --export memory-backup.json

# Import memory
npx @claude-flow/cli@latest memory persist --import memory-backup.json

# Compressed export
npx @claude-flow/cli@latest memory persist --export memory.gz --compress
```
