# hook pre-search

Optimize search operations with caching and intelligent filtering.

## Usage

```bash
npx claude-flow hook pre-search [options]
```

## Options

- `--query, -q <text>` - Search query to optimize
- `--cache-results` - Cache search results (default: true)
- `--suggest-filters` - Suggest search filters
- `--check-memory` - Check memory for answers
- `--expand-query` - Expand search terms

## Examples

### Basic pre-search hook

```bash
npx claude-flow hook pre-search --query "authentication implementation"
```

### With caching

```bash
npx claude-flow hook pre-search -q "React hooks usage" --cache-results
```

### Memory check first

```bash
npx claude-flow hook pre-search -q "previous bug fixes" --check-memory
```

### Query expansion

```bash
npx claude-flow hook pre-search -q "auth" --expand-query --suggest-filters
```

## Features

### Result Caching

- Stores search results
- Enables instant retrieval
- Reduces redundant searches
- Updates intelligently

### Filter Suggestions

- File type filters
- Directory scoping
- Time-based filtering
- Pattern matching

### Memory Checking

- Searches stored knowledge
- Finds previous results
- Avoids repetition
- Speeds up retrieval

### Query Expansion

- Adds synonyms
- Includes related terms
- Handles abbreviations
- Improves coverage

## Integration

This hook is automatically called by Claude Code when:

- Using Grep tool
- Using Glob tool
- Searching codebase
- Finding patterns

Manual usage in agents:

```bash
# Before searching
npx claude-flow hook pre-search --query "your search" --cache-results --check-memory
```

## Output

Returns JSON with:

```json
{
  "query": "authentication implementation",
  "cached": true,
  "cacheHit": false,
  "memoryResults": 3,
  "expandedQuery": "(auth|authentication|login|oauth) (impl|implementation|code)",
  "suggestedFilters": ["*.js", "*.ts", "src/**"],
  "estimatedFiles": 45
}
```

## See Also

- `Grep` - Content search tool
- `Glob` - File pattern tool
- `memory search` - Memory queries
- `cache manage` - Cache operations
