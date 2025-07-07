# post-task

Hook executed after task completion.

## Usage
```bash
npx claude-flow hook post-task [options]
```

## Options
- `--task-id <id>` - Task identifier
- `--analyze-performance` - Analyze task performance
- `--update-memory` - Update swarm memory

## Examples
```bash
# Basic post-task
npx claude-flow hook post-task --task-id task-123

# With performance analysis
npx claude-flow hook post-task --task-id task-123 --analyze-performance

# Update memory
npx claude-flow hook post-task --task-id task-123 --update-memory
```
