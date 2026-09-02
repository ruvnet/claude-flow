# How to Use Pre-Trained ReasoningBank Models

This guide shows you how to copy, install, and use pre-trained ReasoningBank models in your projects.

## Table of Contents

1. [Quick Start](#quick-start)
2. [Installation Methods](#installation-methods)
3. [Model Selection Guide](#model-selection-guide)
4. [Usage Examples](#usage-examples)
5. [Integration Patterns](#integration-patterns)
6. [Troubleshooting](#troubleshooting)

---

## Quick Start

### 30-Second Setup

```bash
# 1. Choose a model (e.g., SAFLA for self-learning)
cd /workspaces/claude-code-flow/docs/reasoningbank/models/safla

# 2. Copy to your claude-flow directory
cp memory.db ~/.swarm/memory.db

# 3. Test it!
npx claude-flow@alpha memory query "API optimization" --reasoningbank
```

**That's it!** You now have 2,000+ expert patterns ready to use.

---

## Installation Methods

### Method 1: Replace Existing Database (Recommended)

**Use when**: Starting fresh or want to completely replace your memory

```bash
# Backup existing database (optional)
cp ~/.swarm/memory.db ~/.swarm/memory.db.backup

# Copy model
cp /path/to/model/memory.db ~/.swarm/memory.db

# Verify
npx claude-flow@alpha memory query "test" --reasoningbank
```

### Method 2: Merge Multiple Models

**Use when**: Want to combine patterns from multiple models

```bash
# Install sqlite3
npm install -g sqlite3

# Create merge script
cat > merge-models.sh << 'EOF'
#!/bin/bash

# Base database
BASE=~/.swarm/memory.db

# Models to merge
MODELS=(
  "safla/memory.db"
  "google-research/memory.db"
  "code-reasoning/memory.db"
)

# Backup
cp $BASE $BASE.backup

# Merge each model
for MODEL in "${MODELS[@]}"; do
  echo "Merging $MODEL..."

  sqlite3 $BASE << SQL
    ATTACH DATABASE '$MODEL' AS source;

    -- Copy patterns
    INSERT INTO patterns
    SELECT * FROM source.patterns
    WHERE id NOT IN (SELECT id FROM patterns);

    -- Copy embeddings
    INSERT INTO pattern_embeddings
    SELECT * FROM source.pattern_embeddings
    WHERE pattern_id IN (SELECT id FROM source.patterns);

    -- Copy links
    INSERT INTO pattern_links
    SELECT * FROM source.pattern_links;

    DETACH DATABASE source;
SQL
done

echo "✅ Merged ${#MODELS[@]} models"
EOF

chmod +x merge-models.sh
./merge-models.sh
```

### Method 3: Project-Specific Model

**Use when**: Different projects need different models

```bash
# Create project-specific .swarm directory
mkdir -p ./my-project/.swarm

# Copy model
cp /path/to/model/memory.db ./my-project/.swarm/memory.db

# Set environment variable for this project
export CLAUDE_FLOW_DB_PATH=./my-project/.swarm/memory.db

# Or use --db-path flag
npx claude-flow@alpha memory query "test" \
  --reasoningbank \
  --db-path ./my-project/.swarm/memory.db
```

### Method 4: Docker Volume

**Use when**: Running in containers

```bash
# Create volume
docker volume create reasoningbank-data

# Copy model to volume
docker run --rm -v reasoningbank-data:/data \
  -v $(pwd):/models \
  alpine cp /models/memory.db /data/

# Use in container
docker run -v reasoningbank-data:/root/.swarm \
  your-app:latest \
  npx claude-flow@alpha memory query "test" --reasoningbank
```

---

## Model Selection Guide

### Which Model Should I Use?

| Your Use Case | Recommended Model | Pattern Count |
|---------------|-------------------|---------------|
| **Self-learning systems** | SAFLA | 2,000 |
| **Strategy-level planning** | Google Research | 3,000 |
| **Code generation & review** | Code Reasoning | 2,500 |
| **General problem-solving** | Problem Solving | 2,000 |
| **Multi-domain expertise** | Domain Expert | 1,500 |

### Model Characteristics

#### SAFLA Model
- **Best for**: Systems that learn from experience
- **Patterns**: Feedback loops, confidence adjustment, self-improvement
- **Confidence**: 83.8% average
- **Size**: 10.35 MB
- **Use when**: Building agents that improve over time

#### Google Research Model
- **Best for**: Strategic decision-making
- **Patterns**: Strategy-level memory, success/failure learning, MaTTS
- **Confidence**: 88% average
- **Size**: 8.92 MB
- **Use when**: Following research best practices

#### Code Reasoning Model
- **Best for**: Software development
- **Patterns**: Design patterns, algorithms, refactoring, debugging
- **Confidence**: 91.5% average
- **Size**: 2.66 MB
- **Use when**: Code generation, review, or optimization

#### Problem Solving Model
- **Best for**: General reasoning tasks
- **Patterns**: 5 cognitive types (convergent, divergent, lateral, systems, critical)
- **Confidence**: 83.7% average
- **Size**: 5.85 MB
- **Use when**: Complex problem analysis

#### Domain Expert Model
- **Best for**: Specialized technical domains
- **Patterns**: DevOps, Data/ML, Security, API, Performance
- **Confidence**: 89.4% average
- **Size**: 2.39 MB
- **Use when**: Domain-specific expertise needed

---

## Usage Examples

### Basic Queries

```bash
# Query patterns
npx claude-flow@alpha memory query \
  "How to optimize database queries?" \
  --reasoningbank

# Search with filters
npx claude-flow@alpha memory query \
  "authentication patterns" \
  --namespace security \
  --reasoningbank

# Get high-confidence patterns only
npx claude-flow@alpha memory query \
  "API rate limiting" \
  --min-confidence 0.8 \
  --reasoningbank
```

### JavaScript/Node.js Integration

```javascript
const Database = require('better-sqlite3');
const db = new Database(process.env.HOME + '/.swarm/memory.db');

// Query patterns by domain
function getPatterns(domain, limit = 10) {
  return db.prepare(`
    SELECT
      p.*,
      pe.embedding
    FROM patterns p
    LEFT JOIN pattern_embeddings pe ON p.id = pe.pattern_id
    WHERE p.domain = ?
    ORDER BY p.confidence DESC, p.success_rate DESC
    LIMIT ?
  `).all(domain, limit);
}

// Semantic search
function semanticSearch(query, topK = 5) {
  const queryEmb = generateEmbedding(query); // Use your embedding function

  const patterns = db.prepare(`
    SELECT
      p.*,
      pe.embedding
    FROM patterns p
    JOIN pattern_embeddings pe ON p.id = pe.pattern_id
  `).all();

  // Calculate similarities
  const results = patterns
    .map(p => ({
      pattern: p,
      similarity: cosineSimilarity(queryEmb, JSON.parse(p.embedding))
    }))
    .sort((a, b) => b.similarity - a.similarity)
    .slice(0, topK);

  return results;
}

// Get related patterns via links
function getRelatedPatterns(patternId) {
  return db.prepare(`
    SELECT
      p.*,
      pl.link_type,
      pl.strength
    FROM pattern_links pl
    JOIN patterns p ON pl.target_id = p.id
    WHERE pl.source_id = ?
    ORDER BY pl.strength DESC
  `).all(patternId);
}

// Usage
const patterns = getPatterns('api-development', 10);
console.log('Top 10 API development patterns:', patterns);

const similar = semanticSearch('JWT authentication best practices', 5);
console.log('Similar patterns:', similar);
```

### Python Integration

```python
import sqlite3
import json

# Connect to database
conn = sqlite3.connect(f"{os.environ['HOME']}/.swarm/memory.db")
cursor = conn.cursor()

def get_patterns(domain, limit=10):
    """Get patterns by domain"""
    cursor.execute("""
        SELECT
            p.*,
            pe.embedding
        FROM patterns p
        LEFT JOIN pattern_embeddings pe ON p.id = pe.pattern_id
        WHERE p.domain = ?
        ORDER BY p.confidence DESC, p.success_rate DESC
        LIMIT ?
    """, (domain, limit))

    return cursor.fetchall()

def semantic_search(query, top_k=5):
    """Semantic search using embeddings"""
    query_emb = generate_embedding(query)  # Your embedding function

    cursor.execute("""
        SELECT p.*, pe.embedding
        FROM patterns p
        JOIN pattern_embeddings pe ON p.id = pe.pattern_id
    """)

    patterns = cursor.fetchall()

    # Calculate similarities
    results = []
    for pattern in patterns:
        emb = json.loads(pattern[-1])  # Last column is embedding
        similarity = cosine_similarity(query_emb, emb)
        results.append((pattern, similarity))

    # Sort and return top K
    results.sort(key=lambda x: x[1], reverse=True)
    return results[:top_k]

# Usage
patterns = get_patterns('api-development', 10)
print(f"Found {len(patterns)} patterns")

similar = semantic_search('JWT authentication best practices', 5)
for pattern, similarity in similar:
    print(f"Similarity: {similarity:.3f} - {pattern[1]}")  # pattern[1] is description
```

### CLI Integration

```bash
#!/bin/bash
# query-patterns.sh

DB_PATH="$HOME/.swarm/memory.db"

# Function to query patterns
query_patterns() {
  local query="$1"
  local limit="${2:-10}"

  sqlite3 "$DB_PATH" << SQL
.mode column
.headers on
SELECT
  id,
  SUBSTR(description, 1, 60) as description,
  ROUND(confidence, 2) as conf,
  ROUND(success_rate, 2) as success,
  domain
FROM patterns
WHERE description LIKE '%$query%'
ORDER BY confidence DESC, success_rate DESC
LIMIT $limit;
SQL
}

# Function to get pattern details
get_pattern() {
  local id="$1"

  sqlite3 "$DB_PATH" << SQL
.mode line
SELECT * FROM patterns WHERE id = $id;
SQL
}

# Function to get related patterns
get_related() {
  local id="$1"

  sqlite3 "$DB_PATH" << SQL
.mode column
.headers on
SELECT
  p.id,
  SUBSTR(p.description, 1, 50) as description,
  pl.link_type,
  ROUND(pl.strength, 2) as strength
FROM pattern_links pl
JOIN patterns p ON pl.target_id = p.id
WHERE pl.source_id = $id
ORDER BY pl.strength DESC;
SQL
}

# Usage
case "$1" in
  search)
    query_patterns "$2" "$3"
    ;;
  get)
    get_pattern "$2"
    ;;
  related)
    get_related "$2"
    ;;
  *)
    echo "Usage: $0 {search|get|related} <query|id>"
    exit 1
    ;;
esac
```

---

## Integration Patterns

### Pattern 1: Agentic-Flow Integration

```javascript
// Configure agentic-flow to use ReasoningBank
import { AgenticFlow } from 'agentic-flow';

const agent = new AgenticFlow('coder', {
  reasoningBank: {
    enabled: true,
    dbPath: process.env.HOME + '/.swarm/memory.db',
    minConfidence: 0.7,
    topK: 5
  }
});

// Agent automatically queries ReasoningBank for context
const result = await agent.execute({
  task: 'Implement JWT authentication',
  // ReasoningBank provides relevant patterns automatically
});
```

### Pattern 2: Claude Code Agent Context

```bash
# Pre-load patterns for code generation
npx claude-flow@alpha memory query \
  "authentication best practices" \
  --reasoningbank \
  --format json > context.json

# Use context in Claude Code agent
claude code \
  --context context.json \
  "Implement secure JWT authentication"
```

### Pattern 3: API Endpoint

```javascript
const express = require('express');
const Database = require('better-sqlite3');

const app = express();
const db = new Database(process.env.HOME + '/.swarm/memory.db');

// Pattern query endpoint
app.get('/api/patterns/search', (req, res) => {
  const { query, domain, minConfidence } = req.query;

  const patterns = db.prepare(`
    SELECT *
    FROM patterns
    WHERE
      description LIKE ? AND
      (? IS NULL OR domain = ?) AND
      (? IS NULL OR confidence >= ?)
    ORDER BY confidence DESC
    LIMIT 20
  `).all(
    `%${query}%`,
    domain, domain,
    minConfidence, minConfidence
  );

  res.json({ patterns });
});

app.listen(3000, () => {
  console.log('ReasoningBank API running on port 3000');
});
```

### Pattern 4: Background Learning

```javascript
// Continuously update confidence based on outcomes
class ReasoningBankLearner {
  constructor(dbPath) {
    this.db = new Database(dbPath);
  }

  async recordOutcome(patternId, success) {
    // Bayesian confidence update
    const pattern = this.db.prepare(
      'SELECT confidence, success_rate FROM patterns WHERE id = ?'
    ).get(patternId);

    const newConfidence = success
      ? pattern.confidence * 1.2  // +20% on success
      : pattern.confidence * 0.85; // -15% on failure

    // Update pattern
    this.db.prepare(`
      UPDATE patterns
      SET
        confidence = MIN(0.95, ?),
        success_rate = (success_rate * 0.9) + (? * 0.1),
        updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(newConfidence, success ? 1.0 : 0.0, patternId);
  }
}

// Usage
const learner = new ReasoningBankLearner('~/.swarm/memory.db');
await learner.recordOutcome(patternId, true); // Pattern succeeded
```

---

## Troubleshooting

### Issue: "Database locked" Error

**Cause**: Multiple processes accessing the same database

**Solution**:
```bash
# Enable WAL mode (allows concurrent reads)
sqlite3 ~/.swarm/memory.db "PRAGMA journal_mode=WAL;"

# Or use separate databases for different processes
export CLAUDE_FLOW_DB_PATH=./my-app/.swarm/memory.db
```

### Issue: Slow Queries

**Cause**: Missing indexes or large database

**Solution**:
```bash
# Rebuild indexes
sqlite3 ~/.swarm/memory.db << SQL
REINDEX;
ANALYZE;
VACUUM;
SQL

# Add missing indexes
sqlite3 ~/.swarm/memory.db << SQL
CREATE INDEX IF NOT EXISTS idx_patterns_confidence
  ON patterns(confidence DESC);
CREATE INDEX IF NOT EXISTS idx_patterns_domain
  ON patterns(domain);
SQL
```

### Issue: Wrong Model Loaded

**Cause**: Copied wrong memory.db

**Solution**:
```bash
# Verify model
sqlite3 ~/.swarm/memory.db "SELECT domain, COUNT(*) FROM patterns GROUP BY domain;"

# Should show your expected domains
# If wrong, restore correct model
cp /path/to/correct/model/memory.db ~/.swarm/memory.db
```

### Issue: No Results from Queries

**Cause**: Namespace mismatch or missing data

**Solution**:
```bash
# Check what's in the database
sqlite3 ~/.swarm/memory.db "SELECT COUNT(*) FROM patterns;"

# Check namespaces
sqlite3 ~/.swarm/memory.db "SELECT DISTINCT domain FROM patterns;"

# Query without namespace filter
npx claude-flow@alpha memory query "test" --reasoningbank --all-namespaces
```

---

## Best Practices

### 1. **Backup Before Replacing**
```bash
# Always backup existing database
cp ~/.swarm/memory.db ~/.swarm/memory.db.$(date +%Y%m%d)
```

### 2. **Validate After Installation**
```bash
# Verify model is working
npx claude-flow@alpha memory query "test" --reasoningbank
```

### 3. **Use Appropriate Model**
- Code tasks → Code Reasoning model
- Planning → Google Research model
- Learning systems → SAFLA model

### 4. **Monitor Performance**
```javascript
// Add query timing
console.time('pattern-query');
const patterns = getPatterns('domain');
console.timeEnd('pattern-query');
// Should be < 10ms
```

### 5. **Update Confidence Scores**
```javascript
// Record outcomes to improve model
await learner.recordOutcome(patternId, wasSuccessful);
```

---

## Next Steps

1. **Choose your model** from the [Model Selection Guide](#model-selection-guide)
2. **Install using** one of the [Installation Methods](#installation-methods)
3. **Test with** the [Usage Examples](#usage-examples)
4. **Integrate using** the [Integration Patterns](#integration-patterns)
5. **Optimize with** [Best Practices](#best-practices)

**Need help?** See [Troubleshooting](#troubleshooting) or open an issue on GitHub.

---

**Happy reasoning!** 🧠✨
