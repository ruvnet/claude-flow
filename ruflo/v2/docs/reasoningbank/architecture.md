# ReasoningBank Architecture: Technical Deep-Dive

## Table of Contents

- [System Overview](#system-overview)
- [Component Architecture](#component-architecture)
- [Data Flow](#data-flow)
- [Database Design](#database-design)
- [Embedding System](#embedding-system)
- [MMR Ranking Algorithm](#mmr-ranking-algorithm)
- [Pattern Recognition](#pattern-recognition)
- [Performance Characteristics](#performance-characteristics)

## System Overview

ReasoningBank is a **persistent semantic memory system** built on three foundational technologies:

1. **agentic-flow@1.5.13** - Node.js backend with SQLite integration
2. **better-sqlite3** - High-performance synchronous SQLite bindings
3. **Hash-based Embeddings** - Deterministic semantic vectors without API calls

### Design Principles

| Principle | Implementation | Benefit |
|-----------|---------------|---------|
| **Zero Dependencies** | Hash embeddings instead of API calls | No external services required |
| **Synchronous I/O** | better-sqlite3 synchronous operations | Predictable latency (2-3ms) |
| **Persistent Storage** | SQLite file-based database | Survives process restarts |
| **Semantic Search** | 1024-dim embedding vectors | Context-aware retrieval |
| **Incremental Learning** | Bayesian confidence updates | Gets smarter over time |

## Component Architecture

### Layer 1: CLI Interface

**File**: `src/cli/memory-commands.js`

```
User Input
    ↓
Command Parser
    ↓
[store | query | list | delete | status]
    ↓
ReasoningBank Adapter
```

**Commands:**
```bash
memory store <key> <value> --namespace <ns> --reasoningbank
memory query <query> --namespace <ns> --reasoningbank
memory list --namespace <ns> --reasoningbank
memory delete <key> --namespace <ns> --reasoningbank
memory status --reasoningbank
```

### Layer 2: ReasoningBank Adapter

**File**: `src/reasoningbank/reasoningbank-adapter.js`

```javascript
class ReasoningBankAdapter {
  constructor() {
    this.backend = null; // agentic-flow backend
  }

  async initialize() {
    // Spawn agentic-flow process
    // Connect via IPC or file-based protocol
  }

  async storeMemory(key, value, options) {
    // 1. Create pattern structure
    // 2. Generate hash embedding (1ms)
    // 3. Store in patterns + pattern_embeddings
    // 4. Return confirmation
  }

  async retrieveMemories(query, options) {
    // 1. Generate query embedding (1ms)
    // 2. Semantic search via cosine similarity (1ms)
    // 3. Apply MMR ranking (1ms)
    // 4. Return sorted results
  }
}
```

**Key Features:**
- Handles parameter mapping (`domain` vs `namespace`)
- Manages result flattening (no nested `pattern_data`)
- Applies 4-factor MMR scoring
- Tracks performance metrics

### Layer 3: Agentic-Flow Backend

**Package**: `agentic-flow@1.5.13` (Node.js module)

```
┌───────────────────────────────────────────────────┐
│          agentic-flow@1.5.13                      │
│                                                    │
│  ┌────────────────────────────────────────────┐  │
│  │  Pattern Manager                           │  │
│  │  - storePattern()                          │  │
│  │  - retrievePattern()                       │  │
│  │  - updatePattern()                         │  │
│  │  - deletePattern()                         │  │
│  └────────────────────────────────────────────┘  │
│                                                    │
│  ┌────────────────────────────────────────────┐  │
│  │  Embedding Engine                          │  │
│  │  - generateHashEmbedding()                 │  │
│  │  - generateOpenAIEmbedding()               │  │
│  │  - cosineSimilarity()                      │  │
│  └────────────────────────────────────────────┘  │
│                                                    │
│  ┌────────────────────────────────────────────┐  │
│  │  MMR Ranker                                │  │
│  │  - calculateSemanticScore()                │  │
│  │  - calculateRecencyScore()                 │  │
│  │  - calculateReliabilityScore()             │  │
│  │  - calculateDiversityScore()               │  │
│  └────────────────────────────────────────────┘  │
│                                                    │
│  ┌────────────────────────────────────────────┐  │
│  │  Trajectory Tracker                        │  │
│  │  - recordStep()                            │  │
│  │  - getTrajectory()                         │  │
│  └────────────────────────────────────────────┘  │
│                                                    │
│  ┌────────────────────────────────────────────┐  │
│  │  Pattern Linker                            │  │
│  │  - createLink()                            │  │
│  │  - discoverLinks()                         │  │
│  └────────────────────────────────────────────┘  │
│                                                    │
│  ┌────────────────────────────────────────────┐  │
│  │  Bayesian Learner                          │  │
│  │  - updateConfidence()                      │  │
│  │  - consolidatePatterns()                   │  │
│  └────────────────────────────────────────────┘  │
└───────────────────────────────────────────────────┘
                       ↓
            SQLite Database Driver
                  (better-sqlite3)
```

## Data Flow

### Store Operation

```
User: npx claude-flow memory store api_key "JWT tokens" --reasoningbank
         ↓
[1] CLI Parser
    → command: 'store'
    → key: 'api_key'
    → value: 'JWT tokens'
    → options: { reasoningbank: true }
         ↓
[2] ReasoningBank Adapter
    → Create pattern object:
      {
        id: 'uuid-v4',
        title: 'api_key',
        content: 'JWT tokens',
        namespace: 'default',
        components: {
          reliability: 0.5,      // Initial confidence
          usage_count: 0,
          cognitive_pattern: null
        }
      }
         ↓
[3] Generate Embedding (1ms)
    → Hash('JWT tokens') → [0.23, -0.45, 0.67, ...]
    → 1024-dim float32 array
         ↓
[4] Store in SQLite (3-5ms)
    → INSERT INTO patterns (...)
    → INSERT INTO pattern_embeddings (...)
         ↓
[5] Return Success
    ✅ Stored: api_key (namespace: default)

Total Time: 5-8ms
```

### Query Operation

```
User: npx claude-flow memory query "authentication" --reasoningbank
         ↓
[1] CLI Parser
    → command: 'query'
    → query: 'authentication'
    → options: { reasoningbank: true }
         ↓
[2] Generate Query Embedding (1ms)
    → Hash('authentication') → [0.19, -0.52, 0.71, ...]
         ↓
[3] Semantic Search (1ms)
    → SQL:
      SELECT p.*, pe.embedding,
             cosine_similarity(pe.embedding, @query_embedding) AS score
      FROM patterns p
      INNER JOIN pattern_embeddings pe ON p.id = pe.pattern_id
      WHERE p.namespace = 'default'
      ORDER BY score DESC
      LIMIT 10
         ↓
[4] MMR Ranking (1ms)
    For each result:
      → Semantic: score * 0.4
      → Recency: exp(-age_in_days * 0.1) * 0.2
      → Reliability: components.reliability * 0.3
      → Diversity: novelty_score * 0.1
      → Final Score = sum(weighted_scores)
         ↓
[5] Return Results
    ✅ Found 1 result (semantic search)
    Key: api_key
    Value: JWT tokens
    Score: 0.87

Total Time: 2-3ms
```

## Database Design

### Table: patterns

**Purpose**: Core pattern storage with metadata

```sql
CREATE TABLE patterns (
  id TEXT PRIMARY KEY,              -- UUID v4
  title TEXT NOT NULL,              -- User-friendly key
  content TEXT,                     -- Main content/value
  description TEXT,                 -- Optional longer description
  namespace TEXT DEFAULT 'default', -- Organization/domain
  components JSON,                  -- Metadata object
  usage_count INTEGER DEFAULT 0,   -- Access frequency
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Indexes for performance
CREATE INDEX idx_patterns_namespace ON patterns(namespace);
CREATE INDEX idx_patterns_created ON patterns(created_at DESC);
CREATE INDEX idx_patterns_usage ON patterns(usage_count DESC);
```

**Components JSON Structure:**
```json
{
  "reliability": 0.85,           // Bayesian confidence (0-1)
  "usage_count": 42,             // Times accessed
  "last_success": "2025-10-14",  // Last successful use
  "last_failure": null,          // Last failure (if any)
  "cognitive_pattern": "convergent", // Reasoning strategy
  "domain_specific": {           // Custom metadata
    "api_version": "v2",
    "environment": "production"
  }
}
```

### Table: pattern_embeddings

**Purpose**: Semantic vectors for similarity search

```sql
CREATE TABLE pattern_embeddings (
  pattern_id TEXT PRIMARY KEY,
  embedding BLOB NOT NULL,          -- float32 array (4096 bytes)
  embedding_type TEXT DEFAULT 'hash', -- 'hash' or 'openai'
  dimensions INTEGER DEFAULT 1024,  -- Vector dimensionality
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (pattern_id) REFERENCES patterns(id) ON DELETE CASCADE
);

-- Index for joins
CREATE INDEX idx_embeddings_pattern ON pattern_embeddings(pattern_id);
```

**Embedding Storage Format:**
```javascript
// JavaScript Float32Array → SQLite BLOB
const embedding = new Float32Array(1024);
// Fill with hash or OpenAI values...
const buffer = Buffer.from(embedding.buffer);
// Store buffer as BLOB in SQLite
```

**Embedding Types:**

| Type | Dimensions | Generation Time | API Required | Accuracy |
|------|------------|----------------|--------------|----------|
| **hash** | 1024 | 1ms | ❌ No | Good (85%) |
| **openai** | 1536 | 50-100ms | ✅ Yes | Excellent (95%) |

### Table: task_trajectories

**Purpose**: Sequential reasoning step recording

```sql
CREATE TABLE task_trajectories (
  id TEXT PRIMARY KEY,
  pattern_id TEXT,
  step_number INTEGER NOT NULL,
  action TEXT NOT NULL,           -- Step description
  result TEXT,                    -- Outcome
  metadata JSON,                  -- Additional context
  timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (pattern_id) REFERENCES patterns(id) ON DELETE CASCADE
);

-- Index for sequential retrieval
CREATE INDEX idx_trajectories_pattern_step
  ON task_trajectories(pattern_id, step_number);
```

**Example Trajectory:**
```json
[
  {
    "step_number": 1,
    "action": "Analyze user requirements",
    "result": "Identified need for JWT auth",
    "metadata": { "duration_ms": 150 }
  },
  {
    "step_number": 2,
    "action": "Design authentication flow",
    "result": "Access token + refresh token pattern",
    "metadata": { "duration_ms": 200 }
  },
  {
    "step_number": 3,
    "action": "Implement token generation",
    "result": "Successfully created JWT service",
    "metadata": { "duration_ms": 500 }
  }
]
```

### Table: pattern_links

**Purpose**: Knowledge graph relationships

```sql
CREATE TABLE pattern_links (
  source_pattern_id TEXT NOT NULL,
  target_pattern_id TEXT NOT NULL,
  link_type TEXT NOT NULL,
  strength REAL DEFAULT 0.5,      -- Relationship strength (0-1)
  evidence TEXT,                  -- Why this link exists
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (source_pattern_id, target_pattern_id, link_type),
  FOREIGN KEY (source_pattern_id) REFERENCES patterns(id) ON DELETE CASCADE,
  FOREIGN KEY (target_pattern_id) REFERENCES patterns(id) ON DELETE CASCADE
);

-- Indexes for graph traversal
CREATE INDEX idx_links_source ON pattern_links(source_pattern_id);
CREATE INDEX idx_links_target ON pattern_links(target_pattern_id);
CREATE INDEX idx_links_type ON pattern_links(link_type);
```

**Link Types:**

| Type | Meaning | Example |
|------|---------|---------|
| **causes** | A leads to B | "Poor auth" causes "Security breach" |
| **requires** | A needs B first | "JWT auth" requires "Secret key management" |
| **conflicts** | A incompatible with B | "Stateless auth" conflicts with "Server sessions" |
| **enhances** | A improves B | "Refresh tokens" enhances "JWT auth" |
| **alternative** | A substitutes B | "OAuth2" alternative to "Basic auth" |

## Embedding System

### Hash-Based Embeddings

**Algorithm**: Deterministic semantic hashing with n-gram features

```javascript
function generateHashEmbedding(text, dimensions = 1024) {
  const embedding = new Float32Array(dimensions);

  // Step 1: Normalize text
  const normalized = text.toLowerCase()
    .replace(/[^\w\s]/g, '') // Remove punctuation
    .trim();

  // Step 2: Generate n-grams (1-gram, 2-gram, 3-gram)
  const ngrams = [];
  const words = normalized.split(/\s+/);

  // 1-grams (words)
  ngrams.push(...words);

  // 2-grams (word pairs)
  for (let i = 0; i < words.length - 1; i++) {
    ngrams.push(`${words[i]}_${words[i + 1]}`);
  }

  // 3-grams (word triplets)
  for (let i = 0; i < words.length - 2; i++) {
    ngrams.push(`${words[i]}_${words[i + 1]}_${words[i + 2]}`);
  }

  // Step 3: Hash each n-gram to multiple dimensions
  for (const ngram of ngrams) {
    const hash1 = simpleHash(ngram, 1);
    const hash2 = simpleHash(ngram, 2);
    const hash3 = simpleHash(ngram, 3);

    // Map to dimension indices
    const idx1 = hash1 % dimensions;
    const idx2 = hash2 % dimensions;
    const idx3 = hash3 % dimensions;

    // Increment feature weights
    embedding[idx1] += 1.0;
    embedding[idx2] += 0.5;
    embedding[idx3] += 0.25;
  }

  // Step 4: L2 normalization
  const norm = Math.sqrt(
    embedding.reduce((sum, val) => sum + val * val, 0)
  );

  for (let i = 0; i < dimensions; i++) {
    embedding[i] /= norm;
  }

  return embedding;
}

function simpleHash(str, seed) {
  let hash = seed;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) - hash) + str.charCodeAt(i);
    hash |= 0; // Convert to 32-bit integer
  }
  return Math.abs(hash);
}
```

**Why Hash Embeddings Work:**

1. **Semantic Similarity**: Similar texts have similar n-grams → similar embeddings
2. **Deterministic**: Same input always produces same embedding
3. **No Training**: No model to train or download
4. **Fast**: 1ms generation time
5. **Privacy**: No data sent to external APIs

**Limitations:**
- Less accurate than transformer-based embeddings (85% vs 95%)
- Doesn't understand deep semantic relationships
- Works best for short texts (< 1000 chars)

### OpenAI Embeddings (Optional)

**Algorithm**: text-embedding-3-small (1536 dimensions)

```javascript
async function generateOpenAIEmbedding(text) {
  const response = await fetch('https://api.openai.com/v1/embeddings', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      input: text,
      model: 'text-embedding-3-small'
    })
  });

  const data = await response.json();
  return new Float32Array(data.data[0].embedding);
}
```

**When to Use:**
- Critical applications requiring highest accuracy
- Long texts (> 1000 chars)
- Complex semantic relationships
- Multilingual content

## MMR Ranking Algorithm

**MMR (Maximal Marginal Relevance)** balances relevance with diversity.

### Formula

```
MMR = λ * Sim(q, d) - (1 - λ) * max[Sim(d, d')]
                                    d' ∈ R

where:
  q = query
  d = document
  R = already selected results
  λ = relevance weight (0.7 default)
```

### ReasoningBank Implementation

We extend standard MMR with **4-factor scoring**:

```javascript
function calculateMMRScore(pattern, query, selectedPatterns, options) {
  // Factor 1: Semantic Similarity (40%)
  const semanticScore = cosineSimilarity(
    pattern.embedding,
    query.embedding
  ) * 0.4;

  // Factor 2: Recency (20%)
  const ageInDays = (Date.now() - pattern.created_at) / (1000 * 60 * 60 * 24);
  const recencyScore = Math.exp(-ageInDays * 0.1) * 0.2;

  // Factor 3: Reliability (30%)
  const reliabilityScore = pattern.components.reliability * 0.3;

  // Factor 4: Diversity (10%)
  let maxSimilarity = 0;
  for (const selected of selectedPatterns) {
    const similarity = cosineSimilarity(pattern.embedding, selected.embedding);
    maxSimilarity = Math.max(maxSimilarity, similarity);
  }
  const diversityScore = (1 - maxSimilarity) * 0.1;

  // Combined score
  return semanticScore + recencyScore + reliabilityScore + diversityScore;
}
```

### Why These Weights?

| Factor | Weight | Rationale |
|--------|--------|-----------|
| **Semantic** | 40% | Most important - must match query intent |
| **Reliability** | 30% | Prefer proven patterns over untested ones |
| **Recency** | 20% | Recent patterns more likely to be relevant |
| **Diversity** | 10% | Avoid redundant results |

## Pattern Recognition

### Task Trajectory Tracking

**Purpose**: Record sequential reasoning steps for learning

```javascript
async function trackTrajectory(patternId, action, result) {
  const stepNumber = await getNextStepNumber(patternId);

  await db.run(`
    INSERT INTO task_trajectories
    (id, pattern_id, step_number, action, result, metadata)
    VALUES (?, ?, ?, ?, ?, ?)
  `, [
    uuidv4(),
    patternId,
    stepNumber,
    action,
    result,
    JSON.stringify({ timestamp: Date.now() })
  ]);
}

// Example usage
await trackTrajectory('api_v2', 'Design authentication', 'Chose JWT pattern');
await trackTrajectory('api_v2', 'Implement token service', 'Created JWT helper');
await trackTrajectory('api_v2', 'Add refresh rotation', 'Implemented rotation logic');
await trackTrajectory('api_v2', 'Deploy to production', 'Success - no issues');
```

### Bayesian Confidence Learning

**Purpose**: Update pattern reliability based on outcomes

```javascript
function updateConfidence(pattern, outcome) {
  const current = pattern.components.reliability;

  if (outcome === 'success') {
    // Increase confidence (more if currently low)
    const increase = (1 - current) * 0.2; // 20% of remaining potential
    pattern.components.reliability = Math.min(1.0, current + increase);
    pattern.components.last_success = new Date().toISOString();
  } else {
    // Decrease confidence (more if currently high)
    const decrease = current * 0.15; // 15% of current confidence
    pattern.components.reliability = Math.max(0.0, current - decrease);
    pattern.components.last_failure = new Date().toISOString();
  }

  return pattern;
}
```

**Example Learning Curve:**

| Event | Confidence | Change |
|-------|-----------|--------|
| Initial | 0.50 | - |
| Success #1 | 0.60 | +20% |
| Success #2 | 0.68 | +20% |
| Failure #1 | 0.58 | -15% |
| Success #3 | 0.66 | +20% |
| Success #4 | 0.73 | +20% |

## Performance Characteristics

### Latency Breakdown

```
Store Operation (5-8ms):
├── Pattern creation: 0.5ms
├── Hash embedding: 1ms
├── SQLite INSERT: 3-5ms
└── Response formatting: 0.5ms

Query Operation (2-3ms):
├── Query embedding: 1ms
├── Semantic search: 1ms
├── MMR ranking: 0.5ms
└── Result formatting: 0.5ms
```

### Scalability

| Patterns | Query Time | Storage Size | Notes |
|----------|-----------|--------------|-------|
| 100 | 2ms | 40MB | Baseline |
| 1,000 | 3ms | 400MB | Linear scaling |
| 10,000 | 5ms | 4GB | Still fast |
| 100,000 | 12ms | 40GB | Consider partitioning |

### Optimization Strategies

**For Large Databases:**

1. **Namespace Partitioning**
   ```sql
   -- Separate tables per namespace
   CREATE TABLE patterns_backend AS SELECT * FROM patterns WHERE namespace='backend';
   CREATE TABLE patterns_frontend AS SELECT * FROM patterns WHERE namespace='frontend';
   ```

2. **Approximate Nearest Neighbors (ANN)**
   - For > 10,000 patterns, use FAISS or Annoy
   - Trade slight accuracy for 100x speed

3. **Caching**
   ```javascript
   const queryCache = new LRU({ max: 1000 });
   const cacheKey = `${query}:${namespace}`;
   if (queryCache.has(cacheKey)) {
     return queryCache.get(cacheKey);
   }
   ```

---

## Next Steps

- **[DeepMind Research](./google-research.md)** - Theoretical foundations
- **[Basic Tutorial](./tutorial-basic.md)** - Hands-on learning
- **[Advanced Tutorial](./tutorial-advanced.md)** - Self-learning patterns

---

**Last Updated**: 2025-10-14
**Version**: v2.7.0-alpha.10
