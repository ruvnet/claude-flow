# Optional: Local Semantic Search with Transformers.js

## Overview

By default, the memory system works perfectly **without any embeddings** using database pattern matching. This optional enhancement adds true semantic search using local AI models.

## Current Default Behavior ✅

**Already works out of the box:**
```bash
npx claude-flow@alpha memory store "api-design" "REST with JWT"
npx claude-flow@alpha memory list
# ✅ Works perfectly - no setup required!
```

**Memory query uses database fallback:**
```bash
npx claude-flow@alpha memory query "api"
# ✅ Works with pattern matching (exact/partial text search)
```

## Optional Enhancement: True Semantic Search

Add AI-powered semantic similarity for better query results.

### Installation Options

**Option 1: Package-level (Recommended for Development)**

```bash
# In agentic-flow repository
npm install @xenova/transformers --save-optional

# Or in claude-flow
npm install @xenova/transformers --save-optional
```

**Option 2: User-level (Recommended for Production)**

```bash
# Users can enable semantic search with:
npm install -g @xenova/transformers

# Or with npx:
npx -p @xenova/transformers -p claude-flow@alpha claude-flow memory query "api"
```

**Option 3: Environment Variable Flag**

```bash
# Enable semantic search
export CLAUDE_FLOW_SEMANTIC_SEARCH=true

# Run memory commands
npx claude-flow@alpha memory query "authentication patterns"
```

---

## Implementation Strategy

### 1. Make @xenova/transformers Optional in package.json

**File: `agentic-flow/package.json` or `claude-flow/package.json`**

```json
{
  "dependencies": {
    "agentdb": "^1.4.3",
    "better-sqlite3": "^11.10.0"
    // ... existing deps
  },
  "optionalDependencies": {
    "@xenova/transformers": "^3.2.0"
  },
  "peerDependencies": {
    "@xenova/transformers": "^3.0.0"
  },
  "peerDependenciesMeta": {
    "@xenova/transformers": {
      "optional": true
    }
  }
}
```

### 2. Update Embeddings Utility with Graceful Fallback

**File: `src/reasoningbank/utils/embeddings.ts`**

```typescript
/**
 * Embedding utilities with optional local model support
 */

let transformersAvailable = false;
let embeddingPipeline: any = null;

/**
 * Check if transformers.js is available
 */
async function checkTransformersAvailable(): Promise<boolean> {
  try {
    const transformers = await import('@xenova/transformers');
    return true;
  } catch (error) {
    return false;
  }
}

/**
 * Initialize embeddings if available
 */
async function initializeEmbeddings(): Promise<boolean> {
  if (embeddingPipeline) return true; // Already initialized

  // Check if feature is enabled
  const semanticSearchEnabled = process.env.CLAUDE_FLOW_SEMANTIC_SEARCH === 'true';
  if (!semanticSearchEnabled) {
    console.log('[Embeddings] Semantic search disabled (set CLAUDE_FLOW_SEMANTIC_SEARCH=true to enable)');
    return false;
  }

  // Check if transformers is available
  transformersAvailable = await checkTransformersAvailable();

  if (!transformersAvailable) {
    console.log('[Embeddings] @xenova/transformers not installed');
    console.log('');
    console.log('📝 To enable semantic search, run:');
    console.log('   npm install -g @xenova/transformers');
    console.log('   export CLAUDE_FLOW_SEMANTIC_SEARCH=true');
    console.log('');
    return false;
  }

  try {
    const { pipeline } = await import('@xenova/transformers');

    console.log('[Embeddings] Loading local model (first time: ~23 MB download)...');
    embeddingPipeline = await pipeline(
      'feature-extraction',
      'Xenova/all-MiniLM-L6-v2'
    );

    console.log('[Embeddings] ✅ Semantic search enabled (Xenova/all-MiniLM-L6-v2)');
    return true;

  } catch (error) {
    console.warn('[Embeddings] Failed to initialize:', error.message);
    return false;
  }
}

/**
 * Compute embedding (returns null if not available)
 */
export async function computeEmbedding(text: string): Promise<Float32Array | null> {
  const initialized = await initializeEmbeddings();

  if (!initialized || !embeddingPipeline) {
    return null; // Feature not available
  }

  try {
    const output = await embeddingPipeline(text, {
      pooling: 'mean',
      normalize: true
    });
    return new Float32Array(output.data);
  } catch (error) {
    console.error('[Embeddings] Generation failed:', error.message);
    return null;
  }
}

/**
 * Check if semantic search is available
 */
export async function isSemanticSearchAvailable(): Promise<boolean> {
  return await initializeEmbeddings();
}

/**
 * Clear embedding cache (no-op if not initialized)
 */
export function clearEmbeddingCache(): void {
  // No-op for now
}
```

### 3. Update Retrieval to Handle Optional Embeddings

**File: `src/reasoningbank/core/retrieve.ts`**

```typescript
import { computeEmbedding, isSemanticSearchAvailable } from '../utils/embeddings.js';
import { cosineSimilarity } from '../utils/mmr.js';
import { fetchMemoryCandidates } from '../db/queries.js';

export async function retrieveMemories(
  query: string,
  options: RetrievalOptions
): Promise<any[]> {
  console.log(`[INFO] Retrieving memories for query: ${query}...`);

  // Fetch candidates from database
  const candidates = fetchMemoryCandidates(options);

  if (candidates.length === 0) {
    console.log('[INFO] No memory candidates found');
    return [];
  }

  console.log(`[INFO] Found ${candidates.length} candidates`);

  // Check if semantic search is available
  const semanticAvailable = await isSemanticSearchAvailable();

  if (!semanticAvailable) {
    console.log('[INFO] Using database pattern matching (semantic search not enabled)');
    return candidates.slice(0, options.k);
  }

  // Try semantic search
  try {
    const queryEmbedding = await computeEmbedding(query);

    if (!queryEmbedding) {
      console.log('[INFO] Semantic search unavailable, using database fallback');
      return candidates.slice(0, options.k);
    }

    console.log('[INFO] Using semantic search with local embeddings');

    // Compute similarities
    const scoredCandidates = candidates
      .map(candidate => {
        if (!candidate.embedding || candidate.embedding.length !== queryEmbedding.length) {
          return { ...candidate, similarity: 0 };
        }
        const similarity = cosineSimilarity(queryEmbedding, candidate.embedding);
        return { ...candidate, similarity };
      })
      .sort((a, b) => b.similarity - a.similarity);

    return scoredCandidates.slice(0, options.k);

  } catch (error) {
    console.error('[ERROR] Semantic search failed:', error.message);
    console.log('[INFO] Falling back to database pattern matching');
    return candidates.slice(0, options.k);
  }
}
```

### 4. Update CLI to Show Status

**File: `src/cli/simple-commands/memory.js`**

```javascript
async function handleQueryCommand(query, options) {
  console.log('\nℹ️  🧠 Using ReasoningBank mode...');

  // Check semantic search availability
  const { isSemanticSearchAvailable } = await import('../../reasoningbank/utils/embeddings.js');
  const semanticEnabled = await isSemanticSearchAvailable();

  if (!semanticEnabled) {
    console.log('💡 Tip: Enable semantic search for better results:');
    console.log('   npm install -g @xenova/transformers');
    console.log('   export CLAUDE_FLOW_SEMANTIC_SEARCH=true');
    console.log('');
  }

  // ... rest of query logic
}
```

---

## User Experience

### Default Experience (No Setup)

```bash
$ npx claude-flow@alpha memory query "api"

ℹ️  🧠 Using ReasoningBank mode...
[ReasoningBank] Initializing...
[ReasoningBank] Enabled: true (initializing...)
[INFO] Retrieving memories for query: api...
[INFO] Found 5 candidates
[INFO] Using database pattern matching (semantic search not enabled)
✅ Found 2 results

📌 api-design
   Value: REST with JWT auth
```

### Enhanced Experience (With Setup)

```bash
$ npm install -g @xenova/transformers
$ export CLAUDE_FLOW_SEMANTIC_SEARCH=true
$ npx claude-flow@alpha memory query "authentication patterns"

ℹ️  🧠 Using ReasoningBank mode...
[ReasoningBank] Initializing...
[Embeddings] Loading local model (first time: ~23 MB download)...
[Embeddings] ✅ Semantic search enabled (Xenova/all-MiniLM-L6-v2)
[INFO] Using semantic search with local embeddings
✅ Found 3 results (semantic similarity):

📌 api-design
   Value: REST with JWT auth
   Match Score: 89.3%  ← Semantic similarity!

📌 oauth-config
   Value: OAuth 2.0 with PKCE
   Match Score: 76.2%  ← Related concept!
```

---

## Documentation Updates

### README.md

```markdown
## Memory System

The memory system works out of the box with database pattern matching.

### Optional: Semantic Search

For AI-powered semantic similarity, install the optional transformer models:

```bash
# Enable semantic search
npm install -g @xenova/transformers
export CLAUDE_FLOW_SEMANTIC_SEARCH=true

# Now queries use semantic similarity
npx claude-flow@alpha memory query "authentication"
```

**Benefits:**
- Find related concepts (e.g., "auth" matches "JWT", "OAuth")
- 50-100ms per query
- Works offline
- Free (no API costs)
- ~23 MB one-time download

**Without semantic search:**
- Database pattern matching (exact/partial text)
- Instant (no model loading)
- Zero dependencies
- Always works
```

---

## Package Configuration

### package.json Changes

```json
{
  "optionalDependencies": {
    "@xenova/transformers": "^3.2.0"
  },
  "scripts": {
    "postinstall": "node scripts/check-optional-deps.js"
  }
}
```

### scripts/check-optional-deps.js

```javascript
// Check if optional dependencies are available
const fs = require('fs');
const path = require('path');

const transformersPath = path.join(__dirname, '../node_modules/@xenova/transformers');

if (fs.existsSync(transformersPath)) {
  console.log('✅ Optional: Semantic search available (@xenova/transformers installed)');
} else {
  console.log('');
  console.log('💡 Optional Enhancement Available:');
  console.log('   Install @xenova/transformers for semantic search');
  console.log('   npm install -g @xenova/transformers');
  console.log('');
}
```

---

## Benefits of Optional Approach

### ✅ Advantages

1. **Zero friction for basic use** - Works immediately with npx
2. **No large downloads required** - Users choose when to download 23 MB model
3. **Graceful degradation** - Falls back to database search automatically
4. **User choice** - Install only if semantic search is needed
5. **Clear communication** - Users know what they're missing and how to get it

### ❌ Avoids Problems

1. No mandatory 23 MB download for users who don't need semantic search
2. No install failures due to native dependencies
3. No confusion about why embeddings aren't working
4. No breaking changes to existing functionality

---

## Testing Strategy

### Test 1: Default (No Semantic Search)
```bash
# Fresh install
npx claude-flow@alpha memory store "test" "value"
npx claude-flow@alpha memory query "test"
# ✅ Should work with database pattern matching
```

### Test 2: Enhanced (With Semantic Search)
```bash
# Install optional dep
npm install -g @xenova/transformers
export CLAUDE_FLOW_SEMANTIC_SEARCH=true

npx claude-flow@alpha memory query "test"
# ✅ Should use semantic similarity
```

### Test 3: Graceful Fallback
```bash
# Enable flag but don't install package
export CLAUDE_FLOW_SEMANTIC_SEARCH=true
unset npm_config_prefix  # Ensure transformers not available

npx claude-flow@alpha memory query "test"
# ✅ Should show helpful message and fall back to database search
```

---

## Summary

This approach gives you:

✅ **Works out of the box** - No setup required for basic memory system
✅ **Optional enhancement** - Users install @xenova/transformers only if they want semantic search
✅ **Graceful fallback** - Always works, even without transformers installed
✅ **Clear messaging** - Users know what's available and how to enable it
✅ **Zero breaking changes** - Existing functionality unchanged

**Recommendation:** Implement this optional approach for maximum user flexibility and zero friction.
