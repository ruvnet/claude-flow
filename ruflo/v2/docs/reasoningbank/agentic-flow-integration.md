# Agentic-Flow Integration: How It All Works

## Overview

This document explains how **agentic-flow@1.5.13** underpins ReasoningBank's capabilities, providing the Node.js backend, SQLite integration, and advanced AI features.

## Table of Contents

1. [What is Agentic-Flow?](#what-is-agentic-flow)
2. [Architecture Overview](#architecture-overview)
3. [Core Components](#core-components)
4. [Integration with Claude-Flow](#integration-with-claude-flow)
5. [Advanced Features](#advanced-features)
6. [Extension Points](#extension-points)

---

## What is Agentic-Flow?

**agentic-flow** is a Node.js framework for building **agentic AI systems** with:

- 🧠 **Persistent Memory** - SQLite-based storage
- 🔍 **Semantic Search** - Hash and OpenAI embeddings
- 📊 **Pattern Recognition** - Task trajectories and causal linking
- ⚡ **High Performance** - 2-3ms query latency
- 🎯 **Self-Learning** - Bayesian confidence updates

### Key Stats

| Metric | Value |
|--------|-------|
| **Package Version** | v1.5.13 |
| **Language** | TypeScript/JavaScript |
| **Runtime** | Node.js 18+ |
| **Database** | SQLite (better-sqlite3) |
| **Embedding Dims** | 1024 (hash) / 1536 (OpenAI) |
| **Query Latency** | 2-3ms |

---

## Architecture Overview

### System Layers

```
┌─────────────────────────────────────────────────────┐
│              Claude-Flow CLI                        │
│  (User commands: memory store, query, list)         │
└────────────────────┬────────────────────────────────┘
                     │ IPC / File Protocol
                     ↓
┌─────────────────────────────────────────────────────┐
│         ReasoningBank Adapter                       │
│  (src/reasoningbank/reasoningbank-adapter.js)       │
│  - Parameter mapping                                │
│  - Result formatting                                │
│  - Error handling                                   │
└────────────────────┬────────────────────────────────┘
                     │ Function Calls
                     ↓
┌─────────────────────────────────────────────────────┐
│           agentic-flow@1.5.13                       │
│  (Node.js backend process)                          │
│                                                      │
│  ┌──────────────────────────────────────────────┐  │
│  │  Core Modules                                │  │
│  │  ├── PatternManager                          │  │
│  │  ├── EmbeddingEngine                         │  │
│  │  ├── SemanticSearcher                        │  │
│  │  ├── MMRRanker                               │  │
│  │  ├── TrajectoryTracker                       │  │
│  │  ├── PatternLinker                           │  │
│  │  └── BayesianLearner                         │  │
│  └──────────────────────────────────────────────┘  │
│                                                      │
│  ┌──────────────────────────────────────────────┐  │
│  │  Database Layer (better-sqlite3)             │  │
│  │  └── Synchronous SQLite operations           │  │
│  └──────────────────────────────────────────────┘  │
└────────────────────┬────────────────────────────────┘
                     │ SQL Queries
                     ↓
┌─────────────────────────────────────────────────────┐
│           SQLite Database                           │
│           .swarm/memory.db                          │
│                                                      │
│  Tables:                                            │
│  ├── patterns                                       │
│  ├── pattern_embeddings                             │
│  ├── task_trajectories                              │
│  └── pattern_links                                  │
└─────────────────────────────────────────────────────┘
```

### Data Flow

```
Store Operation:
  User → CLI → Adapter → agentic-flow → SQLite

Query Operation:
  User → CLI → Adapter → agentic-flow → SQLite
       ← ← ← ← ← ← Results ← ← ← ← ← ←
```

---

## Core Components

### 1. PatternManager

**Purpose**: CRUD operations for patterns

**File**: `agentic-flow/src/core/pattern-manager.ts`

```typescript
class PatternManager {
  constructor(private db: Database) {}

  async createPattern(pattern: Pattern): Promise<string> {
    const id = uuidv4();

    this.db.prepare(`
      INSERT INTO patterns (id, title, content, namespace, components)
      VALUES (?, ?, ?, ?, ?)
    `).run(
      id,
      pattern.title,
      pattern.content,
      pattern.namespace || 'default',
      JSON.stringify(pattern.components || {
        reliability: 0.5,
        usage_count: 0
      })
    );

    return id;
  }

  async retrievePattern(id: string): Promise<Pattern | null> {
    const row = this.db.prepare(`
      SELECT * FROM patterns WHERE id = ?
    `).get(id);

    return row ? this.hydratePattern(row) : null;
  }

  async updatePattern(id: string, updates: Partial<Pattern>): Promise<void> {
    // Update logic with component merging
  }

  async deletePattern(id: string): Promise<void> {
    this.db.prepare('DELETE FROM patterns WHERE id = ?').run(id);
  }

  private hydratePattern(row: any): Pattern {
    return {
      id: row.id,
      title: row.title,
      content: row.content,
      namespace: row.namespace,
      components: JSON.parse(row.components),
      created_at: row.created_at,
      updated_at: row.updated_at
    };
  }
}
```

### 2. EmbeddingEngine

**Purpose**: Generate semantic embeddings (hash or OpenAI)

**File**: `agentic-flow/src/core/embedding-engine.ts`

```typescript
class EmbeddingEngine {
  async generateEmbedding(
    text: string,
    type: 'hash' | 'openai' = 'hash'
  ): Promise<Float32Array> {
    if (type === 'hash') {
      return this.generateHashEmbedding(text);
    } else {
      return this.generateOpenAIEmbedding(text);
    }
  }

  private generateHashEmbedding(text: string): Float32Array {
    const dimensions = 1024;
    const embedding = new Float32Array(dimensions);

    // Normalize text
    const normalized = text.toLowerCase()
      .replace(/[^\w\s]/g, '')
      .trim();

    const words = normalized.split(/\s+/);

    // Generate n-grams
    const ngrams = [
      ...words, // 1-grams
      ...this.generateBigrams(words), // 2-grams
      ...this.generateTrigrams(words) // 3-grams
    ];

    // Hash each n-gram to multiple dimensions
    for (const ngram of ngrams) {
      const hashes = [
        this.simpleHash(ngram, 1),
        this.simpleHash(ngram, 2),
        this.simpleHash(ngram, 3)
      ];

      for (let i = 0; i < hashes.length; i++) {
        const idx = hashes[i] % dimensions;
        embedding[idx] += 1.0 / (i + 1); // Decay weight
      }
    }

    // L2 normalization
    return this.normalize(embedding);
  }

  private async generateOpenAIEmbedding(text: string): Promise<Float32Array> {
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

  private simpleHash(str: string, seed: number): number {
    let hash = seed;
    for (let i = 0; i < str.length; i++) {
      hash = ((hash << 5) - hash) + str.charCodeAt(i);
      hash |= 0;
    }
    return Math.abs(hash);
  }

  private normalize(vec: Float32Array): Float32Array {
    const norm = Math.sqrt(
      Array.from(vec).reduce((sum, val) => sum + val * val, 0)
    );

    for (let i = 0; i < vec.length; i++) {
      vec[i] /= norm;
    }

    return vec;
  }
}
```

### 3. SemanticSearcher

**Purpose**: Find similar patterns using cosine similarity

**File**: `agentic-flow/src/core/semantic-searcher.ts`

```typescript
class SemanticSearcher {
  constructor(
    private db: Database,
    private embeddingEngine: EmbeddingEngine
  ) {}

  async search(
    query: string,
    options: SearchOptions = {}
  ): Promise<SearchResult[]> {
    // Generate query embedding
    const queryEmbedding = await this.embeddingEngine.generateEmbedding(query);

    // Build SQL query
    let sql = `
      SELECT
        p.*,
        pe.embedding
      FROM patterns p
      INNER JOIN pattern_embeddings pe ON p.id = pe.pattern_id
    `;

    const params: any[] = [];

    if (options.namespace) {
      sql += ' WHERE p.namespace = ?';
      params.push(options.namespace);
    }

    // Execute query
    const rows = this.db.prepare(sql).all(...params);

    // Calculate cosine similarity for each result
    const results: SearchResult[] = rows.map(row => {
      const patternEmbedding = new Float32Array(row.embedding);
      const similarity = this.cosineSimilarity(queryEmbedding, patternEmbedding);

      return {
        pattern: this.hydratePattern(row),
        score: similarity
      };
    });

    // Sort by similarity
    results.sort((a, b) => b.score - a.score);

    // Apply limit
    const limit = options.limit || 10;
    return results.slice(0, limit);
  }

  private cosineSimilarity(a: Float32Array, b: Float32Array): number {
    if (a.length !== b.length) {
      throw new Error('Vectors must have same dimensions');
    }

    let dotProduct = 0;
    let normA = 0;
    let normB = 0;

    for (let i = 0; i < a.length; i++) {
      dotProduct += a[i] * b[i];
      normA += a[i] * a[i];
      normB += b[i] * b[i];
    }

    return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
  }
}
```

### 4. MMRRanker

**Purpose**: Re-rank results with Maximal Marginal Relevance

**File**: `agentic-flow/src/core/mmr-ranker.ts`

```typescript
class MMRRanker {
  rank(
    results: SearchResult[],
    options: RankOptions = {}
  ): SearchResult[] {
    const selected: SearchResult[] = [];

    while (selected.length < results.length) {
      let bestScore = -Infinity;
      let bestResult: SearchResult | null = null;

      for (const result of results) {
        if (selected.includes(result)) continue;

        const score = this.calculateMMRScore(result, selected);

        if (score > bestScore) {
          bestScore = score;
          bestResult = result;
        }
      }

      if (bestResult) {
        selected.push(bestResult);
      } else {
        break;
      }
    }

    return selected;
  }

  private calculateMMRScore(
    result: SearchResult,
    selected: SearchResult[]
  ): number {
    // Semantic similarity (40%)
    const semanticScore = result.score * 0.4;

    // Reliability (30%)
    const reliability = result.pattern.components.reliability || 0.5;
    const reliabilityScore = reliability * 0.3;

    // Recency (20%)
    const ageInDays = (Date.now() - new Date(result.pattern.created_at).getTime())
      / (1000 * 60 * 60 * 24);
    const recencyScore = Math.exp(-ageInDays * 0.1) * 0.2;

    // Diversity (10%)
    let maxSimilarity = 0;
    for (const selectedResult of selected) {
      const similarity = this.cosineSimilarity(
        result.pattern.embedding,
        selectedResult.pattern.embedding
      );
      maxSimilarity = Math.max(maxSimilarity, similarity);
    }
    const diversityScore = (1 - maxSimilarity) * 0.1;

    return semanticScore + reliabilityScore + recencyScore + diversityScore;
  }
}
```

### 5. BayesianLearner

**Purpose**: Update pattern confidence based on outcomes

**File**: `agentic-flow/src/core/bayesian-learner.ts`

```typescript
class BayesianLearner {
  updateConfidence(
    pattern: Pattern,
    outcome: 'success' | 'failure'
  ): Pattern {
    const current = pattern.components.reliability || 0.5;

    if (outcome === 'success') {
      // Increase confidence (more if currently low)
      const learningRate = 0.2;
      const increase = (1 - current) * learningRate;
      pattern.components.reliability = Math.min(1.0, current + increase);
      pattern.components.last_success = new Date().toISOString();
    } else {
      // Decrease confidence (more if currently high)
      const learningRate = 0.15;
      const decrease = current * learningRate;
      pattern.components.reliability = Math.max(0.0, current - decrease);
      pattern.components.last_failure = new Date().toISOString();
    }

    return pattern;
  }

  consolidatePatterns(patterns: Pattern[]): Pattern[] {
    // Group similar patterns
    const clusters = this.clusterBySimilarity(patterns);

    // Merge each cluster
    return clusters.map(cluster => this.mergePatternsInCluster(cluster));
  }

  private mergePatternsInCluster(cluster: Pattern[]): Pattern {
    // Combine content
    const mergedContent = cluster.map(p => p.content).join(' | ');

    // Average confidence
    const avgConfidence = cluster.reduce(
      (sum, p) => sum + (p.components.reliability || 0.5),
      0
    ) / cluster.length;

    // Sum usage counts
    const totalUsage = cluster.reduce(
      (sum, p) => sum + (p.components.usage_count || 0),
      0
    );

    return {
      ...cluster[0],
      content: mergedContent,
      components: {
        ...cluster[0].components,
        reliability: avgConfidence,
        usage_count: totalUsage,
        merged_from: cluster.map(p => p.id)
      }
    };
  }
}
```

---

## Integration with Claude-Flow

### Communication Protocol

Claude-Flow communicates with agentic-flow using:

1. **Process Spawning**: `child_process.spawn('node', ['agentic-flow'])`
2. **IPC Messages**: JSON-RPC over stdin/stdout
3. **File-Based**: Write requests to `.swarm/requests/`, read from `.swarm/responses/`

### Example Message Flow

```javascript
// Claude-Flow sends:
{
  "jsonrpc": "2.0",
  "method": "storePattern",
  "params": {
    "title": "jwt_auth",
    "content": "Use JWT with HMAC SHA256",
    "namespace": "backend"
  },
  "id": 1
}

// agentic-flow responds:
{
  "jsonrpc": "2.0",
  "result": {
    "id": "550e8400-e29b-41d4-a716-446655440000",
    "confidence": 0.5,
    "storageTime": 5
  },
  "id": 1
}
```

### ReasoningBank Adapter Bridge

**File**: `src/reasoningbank/reasoningbank-adapter.js`

```javascript
class ReasoningBankAdapter {
  async initialize() {
    // Spawn agentic-flow process
    this.process = spawn('node', [
      path.join(__dirname, '../../node_modules/agentic-flow/dist/index.js')
    ]);

    this.messageId = 0;
    this.pendingRequests = new Map();

    // Handle responses
    this.process.stdout.on('data', data => {
      const response = JSON.parse(data.toString());
      const handler = this.pendingRequests.get(response.id);

      if (handler) {
        handler.resolve(response.result);
        this.pendingRequests.delete(response.id);
      }
    });
  }

  async sendRequest(method, params) {
    const id = ++this.messageId;

    return new Promise((resolve, reject) => {
      this.pendingRequests.set(id, { resolve, reject });

      this.process.stdin.write(JSON.stringify({
        jsonrpc: '2.0',
        method,
        params,
        id
      }) + '\n');
    });
  }

  async storeMemory(key, value, options = {}) {
    // Map CLI options to agentic-flow params
    const params = {
      title: key,
      content: value,
      namespace: options.namespace || options.domain || 'default'
    };

    const result = await this.sendRequest('storePattern', params);

    return {
      id: result.id,
      key,
      value,
      namespace: params.namespace,
      confidence: result.confidence || 0.5
    };
  }

  async retrieveMemories(query, options = {}) {
    const namespace = options.namespace || options.domain || 'default';

    const results = await this.sendRequest('searchPatterns', {
      query,
      namespace,
      limit: options.limit || 10
    });

    // Flatten result structure
    return results.map(result => ({
      id: result.id,
      key: result.title,
      value: result.content || result.description || '',
      namespace: namespace,
      confidence: result.components?.reliability || 0.8,
      score: result.score || 0,
      usage_count: result.usage_count || 0,
      created_at: result.created_at
    }));
  }
}
```

---

## Advanced Features

### 1. Cognitive Patterns

**File**: `agentic-flow/src/cognitive/patterns.ts`

```typescript
enum CognitivePattern {
  Convergent = 'convergent',   // Focus on best solution
  Divergent = 'divergent',      // Explore possibilities
  Lateral = 'lateral',          // Creative approaches
  Systems = 'systems',          // Holistic thinking
  Critical = 'critical',        // Challenge assumptions
  Adaptive = 'adaptive'         // Learn and evolve
}

class CognitivePatternManager {
  applyPattern(task: string, pattern: CognitivePattern): Strategy {
    switch (pattern) {
      case CognitivePattern.Convergent:
        return this.convergentThinking(task);
      case CognitivePattern.Divergent:
        return this.divergentThinking(task);
      // ... other cases
    }
  }

  private convergentThinking(task: string): Strategy {
    // Find single best solution
    return {
      approach: 'focused',
      steps: [
        'Define goal precisely',
        'Evaluate options systematically',
        'Select optimal solution',
        'Validate choice'
      ]
    };
  }

  private divergentThinking(task: string): Strategy {
    // Explore multiple solutions
    return {
      approach: 'exploratory',
      steps: [
        'Brainstorm without judgment',
        'Generate many alternatives',
        'Defer evaluation',
        'Combine ideas creatively'
      ]
    };
  }
}
```

### 2. Pattern Linking

**File**: `agentic-flow/src/core/pattern-linker.ts`

```typescript
enum LinkType {
  Causes = 'causes',
  Requires = 'requires',
  Conflicts = 'conflicts',
  Enhances = 'enhances',
  Alternative = 'alternative'
}

class PatternLinker {
  async createLink(
    sourceId: string,
    targetId: string,
    type: LinkType,
    strength: number = 0.5
  ): Promise<void> {
    this.db.prepare(`
      INSERT INTO pattern_links (source_pattern_id, target_pattern_id, link_type, strength)
      VALUES (?, ?, ?, ?)
    `).run(sourceId, targetId, type, strength);
  }

  async discoverLinks(patterns: Pattern[]): Promise<Link[]> {
    const discovered: Link[] = [];

    // Discover links based on:
    // 1. Co-occurrence in queries
    // 2. Semantic similarity
    // 3. Temporal patterns

    for (let i = 0; i < patterns.length; i++) {
      for (let j = i + 1; j < patterns.length; j++) {
        const link = await this.analyzeRelationship(patterns[i], patterns[j]);

        if (link) {
          discovered.push(link);
        }
      }
    }

    return discovered;
  }

  private async analyzeRelationship(
    patternA: Pattern,
    patternB: Pattern
  ): Promise<Link | null> {
    // Analyze semantic similarity
    const similarity = this.cosineSimilarity(
      patternA.embedding,
      patternB.embedding
    );

    if (similarity > 0.7) {
      // Check for causal relationships based on content
      if (this.detectsCauses(patternA.content, patternB.content)) {
        return {
          source: patternA.id,
          target: patternB.id,
          type: LinkType.Causes,
          strength: similarity
        };
      }
    }

    return null;
  }
}
```

---

## Extension Points

### Custom Embedding Functions

```typescript
// agentic-flow-config.ts
import { EmbeddingEngine } from 'agentic-flow';

class CustomEmbedding extends EmbeddingEngine {
  async generateEmbedding(text: string): Promise<Float32Array> {
    // Your custom embedding logic
    // e.g., use local ONNX model, Sentence Transformers, etc.
  }
}

export default {
  embeddingEngine: new CustomEmbedding()
};
```

### Custom Confidence Scoring

```typescript
import { BayesianLearner } from 'agentic-flow';

class CustomLearner extends BayesianLearner {
  updateConfidence(pattern: Pattern, outcome: 'success' | 'failure'): Pattern {
    // Your custom learning algorithm
    // e.g., use different learning rates, decay functions, etc.
  }
}
```

---

## Summary

**agentic-flow** provides the foundation for ReasoningBank through:

1. **PatternManager** - CRUD operations
2. **EmbeddingEngine** - Semantic vectors
3. **SemanticSearcher** - Similarity search
4. **MMRRanker** - Intelligent ranking
5. **BayesianLearner** - Confidence updates
6. **PatternLinker** - Relationship discovery
7. **TrajectoryTracker** - Sequential learning

All coordinated through the **ReasoningBank Adapter** for seamless CLI integration.

---

## Next Steps

- **[Architecture](./architecture.md)** - Database schema and data flow
- **[DeepMind Research](./google-research.md)** - Research foundations
- **[Basic Tutorial](./tutorial-basic.md)** - Hands-on practice

---

**Last Updated**: 2025-10-14
**Version**: v2.7.0-alpha.10
