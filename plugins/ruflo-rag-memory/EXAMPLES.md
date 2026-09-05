# Memory Plugin Examples

## Store and Recall Across Sessions

### Example 1: Remember a Code Pattern

```bash
# Session 1
npx ruflo memory store \
  --key "pattern-concurrent-queue" \
  --value "Use a bounded queue with semaphore for concurrent task processing; limits parallelism safely" \
  --namespace patterns

# Session 2 (next day, different project)
npx ruflo recall "concurrent queue safe processing"
# Returns: "Use a bounded queue with semaphore..."
```

### Example 2: Persist Bug Fixes

```bash
# Session 1: Solved a race condition
npx ruflo memory store \
  --key "fix-race-async-cleanup" \
  --value "Race condition in cleanup: use AbortController to signal cleanup before task dispatch" \
  --namespace solutions \
  --tags "async,cleanup,race"

# Session 2: Hit similar bug
npx ruflo recall "race condition async"
# Gets the fix immediately
```

### Example 3: Agent with Memory Bridge

```javascript
// In a Claude Code agent
async function researchAuthPatterns() {
  // Search cross-session memory
  const findings = await memory_search_unified({
    query: "OAuth2 PKCE refresh token security",
    limit: 5
  });
  
  // findings[0] might be from a session 3 weeks ago
  console.log(findings[0].value); // Cross-session knowledge!
}
```

## CLI Workflow

```bash
# Store architectural decision
npx ruflo memory store \
  --key "arch-event-sourcing" \
  --value "Event sourcing for user actions; snapshots every 10 events for performance" \
  --namespace patterns

# List all stored patterns
npx ruflo memory list --namespace patterns

# Search by semantic meaning (HNSW, fast!)
npx ruflo memory search --query "event-driven architecture" --namespace patterns

# Retrieve by key
npx ruflo memory retrieve --key "arch-event-sourcing" --namespace patterns

# Delete old entry
npx ruflo memory delete --key "old-pattern" --namespace patterns
```

## Memory Namespaces

Use the right namespace for your intent:

| Namespace | Use For | Example |
|-----------|---------|---------|
| `patterns` | Reusable code/design patterns | Auth flows, caching strategies |
| `solutions` | Bug fixes and workarounds | Race condition fix, memory leak |
| `feedback` | User corrections and notes | "Test style should use beforeEach" |
| `security` | Vulnerability patterns | "SQL injection risk in ORM queries" |
| `tasks` | Task context and outcomes | "API refactor: migrated 8 endpoints" |

## Integration with Auto-Memory Bridge

Claude Code auto-saves session memories to `~/.claude/projects/*/memory/`. Import them into AgentDB:

```bash
# Current project
npx ruflo recall

# All projects
npx ruflo memory bridge --all-projects
```

Then search across them:

```bash
npx ruflo recall "authentication patterns"
# Returns unified results from ALL projects + sessions
```
