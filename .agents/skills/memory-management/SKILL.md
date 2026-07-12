---
name: memory-management
description: >
  AgentDB memory system with HNSW vector search. Provides 150x-12,500x faster pattern retrieval, persistent storage, and semantic search capabilities for learning and knowledge management.
  Use when: need to store successful patterns, searching for similar solutions, semantic lookup of past work, learning from previous tasks, sharing knowledge between agents, building knowledge base.
  Skip when: no learning needed, ephemeral one-off tasks, external data sources available, read-only exploration.
---

# Memory Management Skill

## Purpose
AgentDB memory system with HNSW vector search. Provides 150x-12,500x faster pattern retrieval, persistent storage, and semantic search capabilities for learning and knowledge management.

## When to Trigger
- need to store successful patterns
- searching for similar solutions
- semantic lookup of past work
- learning from previous tasks
- sharing knowledge between agents
- building knowledge base

## When to Skip
- no learning needed
- ephemeral one-off tasks
- external data sources available
- read-only exploration

## Commands

### Store Pattern
Store a pattern or knowledge item in memory.

> **Fail closed — do not trust the store's success output.** On Ruflo 3.25.6
> the hybrid backend can print/return success while the write is not durably
> persisted: after committing the row, the store path runs a
> `wal_checkpoint(PASSIVE)` pragma whose failure is swallowed as "non-fatal"
> (`memory-bridge.ts`), so a rejected/disallowed checkpoint still reports
> `success: true`. **Always verify with a read-back and treat a missing or
> mismatched value as a failed write** — never report a successful store on
> the strength of the console message alone.

```bash
# 1. Store
npx @claude-flow/cli memory store --key "[key]" --value "[value]" --namespace patterns

# 2. Verify persistence (fail closed): the retrieved value MUST match what
#    was written. If retrieve returns nothing or a different value, the store
#    did NOT persist — report failure, do not claim success.
npx @claude-flow/cli memory retrieve --key "[key]" --namespace patterns
```

**Example (with verification):**
```bash
npx @claude-flow/cli memory store --key "auth-jwt-pattern" --value "JWT validation with refresh tokens" --namespace patterns
# Confirm it actually persisted before relying on it:
npx @claude-flow/cli memory retrieve --key "auth-jwt-pattern" --namespace patterns
# → must echo "JWT validation with refresh tokens". If empty/different, the
#   write failed silently — retry on a supported backend or surface the error.
```

### Semantic Search
Search memory using semantic similarity

```bash
npx @claude-flow/cli memory search --query "[search terms]" --limit 10
```

**Example:**
```bash
npx @claude-flow/cli memory search --query "authentication best practices" --limit 5
```

### Retrieve Entry
Retrieve a specific memory entry by key

```bash
npx @claude-flow/cli memory retrieve --key "[key]" --namespace [namespace]
```

**Example:**
```bash
npx @claude-flow/cli memory retrieve --key "auth-jwt-pattern" --namespace patterns
```

### List Entries
List all entries in a namespace

```bash
npx @claude-flow/cli memory list --namespace [namespace]
```

**Example:**
```bash
npx @claude-flow/cli memory list --namespace patterns --limit 20
```

### Delete Entry
Delete a memory entry

```bash
npx @claude-flow/cli memory delete --key "[key]" --namespace [namespace]
```

### Build HNSW Index
The HNSW vector index is built on demand during search — pass `--build-hnsw`
to (re)build it before the query runs (enables the ANN speedup).

```bash
npx @claude-flow/cli memory search --query "[search terms]" --build-hnsw
```

### Memory Stats
Show memory usage statistics

```bash
npx @claude-flow/cli memory stats
```

### Export Memory
Export memory to JSON

```bash
npx @claude-flow/cli memory export --output memory-backup.json
```


## Scripts

| Script | Path | Description |
|--------|------|-------------|
| `memory-backup` | `.agents/scripts/memory-backup.sh` | Backup memory to external storage |
| `memory-consolidate` | `.agents/scripts/memory-consolidate.sh` | Consolidate and optimize memory |


## References

| Document | Path | Description |
|----------|------|-------------|
| `HNSW Guide` | `docs/hnsw.md` | HNSW vector search configuration |
| `Memory Schema` | `docs/memory-schema.md` | Memory namespace and schema reference |

## Best Practices
1. Check memory for existing patterns before starting
2. Use hierarchical topology for coordination
3. Store successful patterns after completion
4. Document any new learnings
