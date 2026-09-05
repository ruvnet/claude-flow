---
name: dual-collect
description: Collect results from headless Codex workers
---

# Dual Collect Skill

Collect and aggregate results from headless Codex workers stored in shared memory.

## Usage

```
/dual-collect [--namespace <namespace>] [--format <format>]
```

## Parameters

| Parameter | Default | Description |
|-----------|---------|-------------|
| `--namespace` | results | Memory namespace to search |
| `--format` | summary | Output format: summary, detailed, json |
| `--filter` | none | Filter by key pattern |

## Examples

### Collect All Results
```
/dual-collect
```

### Collect from Specific Namespace
```
/dual-collect --namespace patterns
```

### Detailed Output
```
/dual-collect --format detailed
```

### Filter by Worker
```
/dual-collect --filter "worker-auth-*"
```

## How It Works

1. Queries the memory system for entries in specified namespace
2. Aggregates results from all workers
3. Formats output according to specified format
4. Displays summary of completed/failed workers

## Generated Commands

```bash
# List all results
npx claude-flow@v3alpha memory list --namespace {{namespace}}

# Search for specific patterns
npx claude-flow@v3alpha memory search -q "{{filter}}" -n {{namespace}}

# Get detailed entries
{{#each results}}
npx claude-flow@v3alpha memory get -k "{{this.key}}" -n {{namespace}}
{{/each}}
```

## Output Formats

### Summary (default)
```
Workers Completed: 4/4
├─ worker-auth-core: ✅ Complete (auth.service.ts)
├─ worker-auth-api: ✅ Complete (auth.controller.ts)
├─ worker-tests: ✅ Complete (15 tests passing)
└─ worker-docs: ✅ Complete (API.md updated)
```

### Detailed
```
┌─────────────────────────────────────────────────┐
│ Worker: worker-auth-core                        │
│ Status: Complete                                │
│ Duration: 45s                                   │
│ Files: auth.service.ts, auth.types.ts           │
│ Result: Implemented JWT authentication          │
└─────────────────────────────────────────────────┘
```

### JSON
```json
{
  "workers": [
    {"id": "worker-auth-core", "status": "complete", "result": "..."}
  ],
  "summary": {"total": 4, "completed": 4, "failed": 0}
}
```

## Related Skills

- `/dual-spawn` - Spawn headless workers
- `/dual-coordinate` - Full hybrid workflow
