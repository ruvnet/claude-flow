# memory-search

Search through stored memory.

## Usage
```bash
npx @claude-flow/cli@latest memory search [options]
```

## Options
- `--query <text>` - Search query
- `--pattern <regex>` - Pattern matching
- `--limit <n>` - Result limit

## Examples
```bash
# Search memory
npx @claude-flow/cli@latest memory search --query "authentication"

# Pattern search
npx @claude-flow/cli@latest memory search --pattern "api-.*"

# Limited results
npx @claude-flow/cli@latest memory search --query "config" --limit 10
```
