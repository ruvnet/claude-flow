# memory-usage

Manage persistent memory storage.

## Usage
```bash
npx claude-flow memory usage [options]
```

## Options
- `--action <type>` - Action (store, retrieve, list, clear)
- `--key <key>` - Memory key
- `--value <data>` - Data to store (JSON)

## Examples
```bash
# Store memory
npx claude-flow memory usage --action store --key "project-config" --value '{"api": "v2"}'

# Retrieve memory
npx claude-flow memory usage --action retrieve --key "project-config"

# List all keys
npx claude-flow memory usage --action list
```
