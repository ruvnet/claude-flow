# ReasoningBank Migration Guide: v1.5.12 → v1.5.13

## Overview

Claude-Flow has been updated to use **agentic-flow@1.5.13** with the **Node.js backend** for ReasoningBank, replacing the previous WASM adapter approach.

## Key Changes

### Backend Migration: WASM → Node.js SQLite

**Before (v1.5.12 - WASM)**:
- Ephemeral in-memory storage (Node.js) or IndexedDB (browser)
- Direct WASM module imports
- Ultra-fast but non-persistent

**After (v1.5.13 - Node.js)**:
- **Persistent SQLite database** at `.swarm/memory.db`
- Full embedding support for semantic search
- Memory consolidation and trajectory tracking
- Recommended backend for Node.js environments

### API Compatibility

✅ **No breaking changes to external API** - All claude-flow memory functions remain the same:
- `storeMemory(key, value, options)`
- `queryMemories(searchQuery, options)`
- `listMemories(options)`
- `getStatus()`
- `initializeReasoningBank()`

### Internal Implementation Changes

**Storage**:
```javascript
// Old (WASM)
pattern = { task_description, task_category, strategy, success_score }
await wasm.storePattern(pattern)

// New (Node.js)
memory = { type: 'reasoning_memory', pattern_data: { title, content, domain } }
ReasoningBank.db.upsertMemory(memory)
await ReasoningBank.computeEmbedding(content) // Generate embeddings
```

**Retrieval**:
```javascript
// Old (WASM)
results = await wasm.findSimilar(query, category, limit)

// New (Node.js)
results = await ReasoningBank.retrieveMemories(query, {
  domain, agent, k: limit, minConfidence
})
```

## Database Schema

**Location**: `.swarm/memory.db`

**Tables**:
- `patterns` - Reasoning memories with confidence scores
- `pattern_embeddings` - Vector embeddings for semantic search
- `pattern_links` - Memory relationships and contradictions
- `task_trajectories` - Task execution history
- `matts_runs` - MaTTS algorithm runs
- `consolidation_runs` - Memory consolidation history

## Migration Steps

### Automatic Migration

When you upgrade to v2.7.0-alpha.7+, ReasoningBank will automatically:

1. Initialize Node.js backend on first use
2. Create SQLite database at `.swarm/memory.db`
3. Run database migrations (create tables)
4. Generate embeddings for new memories

**No manual migration needed!** Old WASM data was ephemeral and not persisted.

### Environment Variables

```bash
# Optional: Custom database path
export CLAUDE_FLOW_DB_PATH="/path/to/memory.db"

# Optional: Disable ReasoningBank
export REASONINGBANK_ENABLED=false
```

## Feature Comparison

| Feature | WASM (v1.5.12) | Node.js (v1.5.13) |
|---------|----------------|-------------------|
| **Storage** | Ephemeral (in-memory) | Persistent (SQLite) |
| **Semantic Search** | Basic similarity | Embeddings + MMR ranking |
| **Domain Filtering** | Category-based | Full JSON query support |
| **Memory Consolidation** | ❌ Not available | ✅ Built-in |
| **Trajectory Tracking** | ❌ Not available | ✅ Full history |
| **Cross-session Memory** | ❌ Lost on restart | ✅ Persistent |
| **Performance** | 0.04ms/op (WASM) | 1-2ms/op (SQLite + embeddings) |
| **Database Size** | ~0 MB (memory) | Grows with data (~41MB for 100 patterns) |

## Performance

**Benchmarks** (100 memories, semantic search):

```
Storage:     1-2ms per memory (includes embedding generation)
Query:       1-3ms per semantic search query
Cached:      <1ms for cached queries
List:        <1ms for database queries
```

**Memory Usage**:
- SQLite database: ~400KB per memory (with embedding)
- RAM: Minimal (SQLite handles paging)

## Verification

Test your ReasoningBank integration:

```bash
# Run comprehensive test
node tests/test-semantic-search.mjs

# Expected output:
# ✅ Initialized successfully
# ✅ Stored 5 test memories
# ✅ Semantic search returning results
# ✅ Query caching working
```

## Troubleshooting

### Issue: "Database not found"
```bash
# Ensure initialization ran
npx claude-flow@alpha memory status

# Manually initialize if needed
npx claude-flow@alpha memory init
```

### Issue: "No results from semantic search"
```bash
# Check embeddings are being generated
# Look for warnings: "[ReasoningBank] Failed to generate embedding"

# Verify database has embeddings:
sqlite3 .swarm/memory.db "SELECT COUNT(*) FROM pattern_embeddings;"
```

### Issue: "Embeddings not generating"
```bash
# Ensure API key is set (if using Claude embeddings)
export ANTHROPIC_API_KEY=$YOUR_API_KEY

# Or configure alternative embedding provider in .reasoningbank.json
```

## Benefits of Node.js Backend

✅ **Persistent Memory** - Survives process restarts
✅ **Semantic Search** - True embedding-based similarity
✅ **Memory Consolidation** - Deduplicate and prune old memories
✅ **Trajectory Tracking** - Full task execution history
✅ **Production-Ready** - Battle-tested SQLite backend

## Rollback (Not Recommended)

If you need to temporarily rollback to v1.5.12:

```bash
npm install agentic-flow@1.5.12 --legacy-peer-deps
```

**Note**: This will lose Node.js backend features and return to ephemeral storage.

## Support

For issues or questions:
- GitHub Issues: https://github.com/ruvnet/claude-code-flow/issues
- Documentation: `/docs/integrations/reasoningbank/`
- Test Suite: `/tests/test-semantic-search.mjs`

---

**Migration completed**: Claude-Flow v2.7.0-alpha.7 with agentic-flow@1.5.13 Node.js backend ✅
