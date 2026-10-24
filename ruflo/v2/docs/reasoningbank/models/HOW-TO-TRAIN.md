# How to Train Your Own ReasoningBank Models

This guide shows you how to create custom pre-trained ReasoningBank models with thousands of optimized patterns.

## Table of Contents

1. [Quick Start](#quick-start)
2. [Training Architecture](#training-architecture)
3. [Step-by-Step Training](#step-by-step-training)
4. [Benchmarking & Validation](#benchmarking--validation)
5. [Advanced Techniques](#advanced-techniques)
6. [Troubleshooting](#troubleshooting)

---

## Quick Start

### Prerequisites

```bash
# Install dependencies
npm install better-sqlite3

# Ensure claude-flow is available
npx claude-flow@alpha --version
```

### Create a Simple Model (100 patterns)

```bash
# Create model directory
mkdir -p my-custom-model

# Create training script
cat > my-custom-model/train.js << 'EOF'
const Database = require('better-sqlite3');
const crypto = require('crypto');

const db = new Database('./my-custom-model/memory.db');

// Create schema
db.exec(`
  CREATE TABLE IF NOT EXISTS patterns (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    description TEXT NOT NULL,
    context TEXT,
    success_rate REAL DEFAULT 0.5,
    confidence REAL DEFAULT 0.5,
    domain TEXT,
    tags TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS pattern_embeddings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    pattern_id INTEGER NOT NULL,
    embedding TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (pattern_id) REFERENCES patterns(id)
  );
`);

// Generate 100 patterns
const insert = db.prepare(`
  INSERT INTO patterns (description, context, success_rate, confidence, domain, tags)
  VALUES (?, ?, ?, ?, ?, ?)
`);

const insertEmb = db.prepare(`
  INSERT INTO pattern_embeddings (pattern_id, embedding)
  VALUES (?, ?)
`);

for (let i = 0; i < 100; i++) {
  const pattern = {
    description: `Pattern ${i}: Example coding best practice`,
    context: `Context for pattern ${i}`,
    success_rate: 0.7 + Math.random() * 0.25,
    confidence: 0.6 + Math.random() * 0.35,
    domain: 'coding',
    tags: JSON.stringify(['example', 'demo'])
  };

  const result = insert.run(
    pattern.description,
    pattern.context,
    pattern.success_rate,
    pattern.confidence,
    pattern.domain,
    pattern.tags
  );

  // Generate hash embedding (1024 dimensions)
  const hash = crypto.createHash('sha512').update(pattern.description).digest();
  const embedding = Array.from(hash).map(b => (b / 255) * 2 - 1);

  insertEmb.run(result.lastInsertRowid, JSON.stringify(embedding));
}

console.log('✅ Created 100 patterns!');
db.close();
EOF

# Run training
node my-custom-model/train.js

# Validate
node _scripts/validation-suite.cjs my-custom-model my-custom-model
```

---

## Training Architecture

### Training Components

```
┌─────────────────────────────────────────────────────────┐
│              Training Pipeline                          │
├─────────────────────────────────────────────────────────┤
│                                                         │
│  1. Pattern Generation                                  │
│     ├─ Domain-specific patterns                         │
│     ├─ Realistic scenarios                              │
│     └─ Success/failure examples                         │
│                                                         │
│  2. Embedding Creation                                  │
│     ├─ Hash-based (no API)                             │
│     ├─ 1024-dimension vectors                           │
│     └─ Deterministic generation                         │
│                                                         │
│  3. Relationship Mapping                                │
│     ├─ Pattern links (causes, enhances, etc.)          │
│     ├─ Knowledge graph creation                         │
│     └─ Cross-domain connections                         │
│                                                         │
│  4. Quality Assurance                                   │
│     ├─ Schema validation                                │
│     ├─ Performance benchmarks                           │
│     └─ Production readiness checks                      │
│                                                         │
└─────────────────────────────────────────────────────────┘
```

### Required Tables

Every `memory.db` must include these tables for full claude-flow compatibility:

**ReasoningBank Core:**
- `patterns` - Core pattern storage
- `pattern_embeddings` - Semantic search vectors
- `task_trajectories` - Multi-step reasoning
- `pattern_links` - Pattern relationships

**Claude-Flow Memory:**
- `memories` - General memory storage
- `memory_embeddings` - Memory vectors

**Claude-Flow Session:**
- `sessions` - Session tracking
- `session_metrics` - Performance metrics

**Claude-Flow Neural:**
- `neural_patterns` - Neural network patterns
- `training_data` - Training examples

Use `schema-validator.js fix` to auto-create missing tables.

---

## Step-by-Step Training

### Step 1: Define Your Domain

```javascript
// Example: API Development patterns
const domain = {
  name: 'api-development',
  categories: [
    'authentication',
    'rate-limiting',
    'error-handling',
    'caching',
    'documentation'
  ],
  patternsPerCategory: 200,
  totalPatterns: 1000
};
```

### Step 2: Generate Realistic Patterns

```javascript
const patterns = [
  {
    description: 'Implement JWT authentication with refresh tokens',
    context: 'User needs secure API authentication with long-lived sessions',
    solution: 'Use access token (15min) + refresh token (7 days) pattern',
    success_rate: 0.92,
    confidence: 0.88,
    domain: 'authentication',
    tags: ['jwt', 'security', 'tokens'],
    code_example: `
      // Generate access token
      const accessToken = jwt.sign(
        { userId: user.id },
        SECRET,
        { expiresIn: '15m' }
      );

      // Generate refresh token
      const refreshToken = jwt.sign(
        { userId: user.id, type: 'refresh' },
        REFRESH_SECRET,
        { expiresIn: '7d' }
      );
    `
  },
  // ... more patterns
];
```

### Step 3: Create Embeddings

```javascript
const crypto = require('crypto');

function generateEmbedding(text, dimensions = 1024) {
  // Hash-based embedding (deterministic, no API needed)
  const hash = crypto.createHash('sha512').update(text).digest();

  // Expand to required dimensions
  const embedding = [];
  for (let i = 0; i < dimensions; i++) {
    const byte = hash[i % hash.length];
    embedding.push((byte / 255) * 2 - 1); // Normalize to [-1, 1]
  }

  return embedding;
}

// Create embedding for pattern
const embedding = generateEmbedding(
  pattern.description + ' ' + pattern.context
);
```

### Step 4: Create Pattern Links

```javascript
const linkTypes = {
  'causes': 'Pattern A causes need for Pattern B',
  'requires': 'Pattern A requires Pattern B as prerequisite',
  'enhances': 'Pattern A enhances Pattern B',
  'conflicts': 'Pattern A conflicts with Pattern B',
  'alternative': 'Pattern A is alternative to Pattern B'
};

// Example: Authentication requires rate limiting
db.prepare(`
  INSERT INTO pattern_links (source_id, target_id, link_type, strength)
  VALUES (?, ?, ?, ?)
`).run(authPatternId, rateLimitPatternId, 'requires', 0.85);
```

### Step 5: Optimize Database

```javascript
// Apply production optimizations
db.exec('PRAGMA journal_mode=WAL');
db.exec('PRAGMA synchronous=NORMAL');
db.exec('PRAGMA cache_size=10000');
db.exec('PRAGMA temp_store=MEMORY');

// Create indexes
db.exec(`
  CREATE INDEX IF NOT EXISTS idx_patterns_confidence
    ON patterns(confidence DESC);
  CREATE INDEX IF NOT EXISTS idx_patterns_domain
    ON patterns(domain);
  CREATE INDEX IF NOT EXISTS idx_embeddings_pattern
    ON pattern_embeddings(pattern_id);
`);

// Optimize
db.exec('ANALYZE');
db.exec('VACUUM');
```

---

## Benchmarking & Validation

### Run Automated Validation

```bash
# Validate schema
node _scripts/schema-validator.cjs my-model/memory.db validate

# Fix missing tables
node _scripts/schema-validator.cjs my-model/memory.db fix

# Generate report
node _scripts/schema-validator.cjs my-model/memory.db report > my-model/schema-report.md

# Run comprehensive validation
node _scripts/validation-suite.cjs my-model my-model-name
```

### Manual Benchmarks

```javascript
const Database = require('better-sqlite3');
const db = new Database('./my-model/memory.db');

// Benchmark 1: Query performance
console.time('Query 100 patterns');
for (let i = 0; i < 100; i++) {
  db.prepare('SELECT * FROM patterns WHERE confidence > 0.7 LIMIT 10').all();
}
console.timeEnd('Query 100 patterns');
// Target: < 500ms for 100 queries

// Benchmark 2: Embedding search
console.time('Semantic search');
const queryEmb = generateEmbedding('API authentication best practices');
const results = db.prepare(`
  SELECT p.*,
    (SELECT embedding FROM pattern_embeddings WHERE pattern_id = p.id) as emb
  FROM patterns p
  LIMIT 100
`).all();

// Calculate cosine similarity
const similarities = results.map(r => ({
  pattern: r,
  similarity: cosineSimilarity(queryEmb, JSON.parse(r.emb))
})).sort((a, b) => b.similarity - a.similarity);
console.timeEnd('Semantic search');
// Target: < 50ms for 100 patterns

// Benchmark 3: Database size
const stats = require('fs').statSync('./my-model/memory.db');
console.log(`Database size: ${(stats.size / 1024 / 1024).toFixed(2)} MB`);
// Target: < 10 KB per pattern
```

### Quality Criteria Checklist

- [ ] **Pattern Count**: Minimum 1,000 patterns
- [ ] **Embedding Coverage**: 100% of patterns
- [ ] **Average Confidence**: > 0.70
- [ ] **Average Success Rate**: > 0.75
- [ ] **Pattern Links**: > 2 links per pattern
- [ ] **Query Latency**: < 5ms per query
- [ ] **Database Size**: < 10 KB per pattern
- [ ] **Schema Complete**: All 10 tables present
- [ ] **Indexes Created**: All performance indexes
- [ ] **Domain Coverage**: At least 3 domains

---

## Advanced Techniques

### Parallel Training with Agents

```javascript
// Use Claude Code agents for parallel pattern generation
const { spawn } = require('child_process');

const agents = [
  { name: 'agent-1', domain: 'authentication', count: 500 },
  { name: 'agent-2', domain: 'caching', count: 500 },
  { name: 'agent-3', domain: 'rate-limiting', count: 500 }
];

// Spawn agents in parallel
const promises = agents.map(agent => {
  return new Promise((resolve, reject) => {
    const proc = spawn('node', [
      'train-domain.js',
      agent.domain,
      agent.count
    ]);

    proc.on('close', code => {
      if (code === 0) resolve();
      else reject(new Error(`Agent ${agent.name} failed`));
    });
  });
});

await Promise.all(promises);
console.log('✅ All agents completed training');
```

### Memory Coordination

```bash
# Store training progress in shared memory
npx claude-flow@alpha memory store \
  "training/progress/agent-1" \
  '{"patterns": 250, "status": "in_progress"}' \
  --namespace training --reasoningbank

# Query agent status
npx claude-flow@alpha memory query \
  "training/progress" \
  --namespace training --reasoningbank
```

### Incremental Training

```javascript
// Add new patterns to existing model
const db = new Database('./my-model/memory.db');

// Get current max ID
const { maxId } = db.prepare('SELECT MAX(id) as maxId FROM patterns').get();

// Add new patterns starting from maxId + 1
for (const pattern of newPatterns) {
  const result = insert.run(/* pattern data */);
  // Create embedding
  insertEmb.run(result.lastInsertRowid, /* embedding */);
}

// Update links for new patterns
createLinks(maxId + 1, db.prepare('SELECT MAX(id) FROM patterns').get().maxId);

console.log(`Added ${newPatterns.length} patterns`);
```

---

## Troubleshooting

### Issue: Slow Query Performance

**Problem**: Queries taking > 10ms

**Solution**:
```sql
-- Create missing indexes
CREATE INDEX idx_patterns_domain ON patterns(domain);
CREATE INDEX idx_patterns_confidence ON patterns(confidence DESC);

-- Optimize database
ANALYZE;
VACUUM;

-- Enable WAL mode
PRAGMA journal_mode=WAL;
```

### Issue: Large Database Size

**Problem**: Database > 100 MB for 10,000 patterns

**Solution**:
```javascript
// Compress embeddings
function compressEmbedding(embedding) {
  // Use Float32Array instead of Float64Array
  return new Float32Array(embedding);
}

// Reduce embedding dimensions
const embedding = generateEmbedding(text, 512); // Instead of 1024

// Remove unnecessary metadata
db.exec('UPDATE patterns SET tags = NULL WHERE tags = "[]"');
```

### Issue: Missing Tables

**Problem**: Schema validation fails

**Solution**:
```bash
# Automatically fix schema
node _scripts/schema-validator.cjs my-model/memory.db fix

# Verify fix
node _scripts/schema-validator.cjs my-model/memory.db validate
```

### Issue: Low Confidence Scores

**Problem**: Average confidence < 0.70

**Solution**:
```javascript
// Use realistic success rates from production data
const successRates = {
  'proven': 0.85 - 0.95,    // Well-tested patterns
  'standard': 0.70 - 0.85,  // Common practices
  'experimental': 0.50 - 0.70  // New approaches
};

// Confidence = success_rate * community_consensus
const confidence = successRate * 0.9; // 90% consensus
```

---

## Example: Complete Training Script

See the provided model training scripts:
- `safla/train-safla.js` - Self-learning patterns
- `google-research/train-google.js` - Strategy-level memory
- `code-reasoning/train-code.js` - Programming patterns
- `problem-solving/train-problem.js` - Reasoning patterns
- `domain-expert/train-domain.js` - Multi-domain expertise

Each script provides a complete example of:
1. Schema creation
2. Pattern generation
3. Embedding creation
4. Link establishment
5. Optimization
6. Validation

---

## Next Steps

1. **Define your domain** - What patterns do you want to capture?
2. **Generate realistic data** - Use real scenarios, not synthetic examples
3. **Validate continuously** - Run benchmarks after every 500 patterns
4. **Optimize early** - Create indexes before database gets large
5. **Document thoroughly** - Create README.md with usage examples

**Happy training!** 🚀

For more examples, see `/docs/reasoningbank/models/` directory.
