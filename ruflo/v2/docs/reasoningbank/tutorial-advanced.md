# ReasoningBank Advanced Tutorial: Self-Learning & Optimization

## Overview

This advanced tutorial covers **SAFLA (Self-Aware Feedback Loop Algorithm)**, pattern linking, cognitive diversity patterns, and optimization strategies for building intelligent, self-improving AI systems.

**Prerequisites**: Complete [Basic Tutorial](./tutorial-basic.md) first
**Time Required**: 60 minutes
**Level**: Advanced

## Table of Contents

1. [SAFLA: Self-Aware Feedback Loop Algorithm](#safla-self-aware-feedback-loop-algorithm)
2. [Pattern Linking & Causal Reasoning](#pattern-linking--causal-reasoning)
3. [Cognitive Diversity Patterns](#cognitive-diversity-patterns)
4. [Task Trajectory Tracking](#task-trajectory-tracking)
5. [Bayesian Confidence Learning](#bayesian-confidence-learning)
6. [Advanced Query Strategies](#advanced-query-strategies)
7. [Building Self-Learning Agents](#building-self-learning-agents)
8. [Performance Optimization](#performance-optimization)

---

## SAFLA: Self-Aware Feedback Loop Algorithm

**SAFLA** is the core intelligence system that makes ReasoningBank self-aware and continuously improving.

### How SAFLA Works

```
┌──────────────────────────────────────────────────────┐
│                  SAFLA Cycle                         │
│                                                      │
│  1. OBSERVE                                          │
│     └─ Track pattern usage and outcomes             │
│                                                      │
│  2. ANALYZE                                          │
│     └─ Evaluate success/failure of patterns         │
│                                                      │
│  3. LEARN                                            │
│     └─ Update confidence scores (Bayesian)          │
│                                                      │
│  4. ADAPT                                            │
│     └─ Adjust rankings and recommendations          │
│                                                      │
│  5. FEEDBACK                                         │
│     └─ Return to step 1 (continuous loop)           │
└──────────────────────────────────────────────────────┘
```

### SAFLA Key Capabilities

#### 1. Semantic Understanding 🔍

**Example**: Finding related patterns without exact keywords

```bash
# Store security patterns
npx claude-flow@alpha memory store sql_injection \
  "Use parameterized queries to prevent SQL injection attacks" \
  --namespace security --reasoningbank

npx claude-flow@alpha memory store xss_prevention \
  "Sanitize user input and escape HTML to prevent XSS" \
  --namespace security --reasoningbank

npx claude-flow@alpha memory store csrf_protection \
  "Use CSRF tokens for state-changing operations" \
  --namespace security --reasoningbank

# Query with broad term
npx claude-flow@alpha memory query "prevent attacks" \
  --namespace security --reasoningbank
```

**Output:**
```
✅ Found 3 results (semantic search)

1. sql_injection
   Match Score: 82%
   Confidence: 50%
   → System understands "prevent attacks" relates to SQL injection

2. xss_prevention
   Match Score: 79%
   Confidence: 50%
   → Also finds XSS without exact keyword match

3. csrf_protection
   Match Score: 71%
   Confidence: 50%
   → Finds CSRF through semantic similarity
```

#### 2. Usage Tracking 📊

SAFLA tracks every pattern access to identify valuable knowledge:

```bash
# Check pattern statistics
npx claude-flow@alpha memory status --detailed --reasoningbank
```

**Output:**
```
Usage Statistics (Last 30 Days):

Most Accessed Patterns:
1. jwt_authentication (42 uses) ⭐
2. error_handling (31 uses)
3. database_pooling (28 uses)
4. cache_strategy (15 uses)
5. rate_limiting (8 uses)

Least Accessed:
- deprecated_api_v1 (0 uses) ⚠️
- old_auth_method (1 use) ⚠️

💡 High usage patterns get priority in search results
```

#### 3. Confidence Scoring 💯

Every pattern has a confidence score that evolves based on usage:

```bash
# Track confidence evolution
npx claude-flow@alpha memory info jwt_authentication --reasoningbank
```

**Output:**
```
Pattern: jwt_authentication
Content: JWT with refresh token rotation and 15-min expiration

Confidence History:
├─ Initial: 50% (2025-10-01)
├─ After 5 uses: 58% (2025-10-05)
├─ After 10 uses: 65% (2025-10-08)
├─ After 20 uses: 73% (2025-10-12)
└─ Current: 78% (2025-10-14) ✅

Usage: 42 times
Last Success: 2025-10-14
Last Failure: None

Trend: ↗️ Increasing (High reliability)
```

#### 4. Cross-Domain Learning 🌐

SAFLA builds a knowledge graph connecting related concepts:

```bash
# Store related patterns across domains
npx claude-flow@alpha memory store jwt_auth \
  "JWT tokens with HMAC SHA256 signing" \
  --namespace backend --reasoningbank

npx claude-flow@alpha memory store token_storage \
  "Store tokens in httpOnly cookies, not localStorage" \
  --namespace frontend --reasoningbank

npx claude-flow@alpha memory store token_refresh \
  "Refresh tokens before expiration using interceptors" \
  --namespace frontend --reasoningbank

# Query finds related patterns across namespaces!
npx claude-flow@alpha memory query "token management" --reasoningbank
```

**Output:**
```
✅ Found 3 results across 2 namespaces

Backend:
1. jwt_auth (88% match)

Frontend:
2. token_storage (82% match)
3. token_refresh (79% match)

💡 SAFLA discovered that backend JWT and frontend storage are related!
```

#### 5. Match Scoring 🎯

SAFLA uses **MMR (Maximal Marginal Relevance)** scoring:

```javascript
Score = 0.4 * Semantic_Similarity +
        0.3 * Reliability_Confidence +
        0.2 * Recency +
        0.1 * Diversity
```

**Example**:

```bash
npx claude-flow@alpha memory query "authentication" \
  --namespace backend --reasoningbank --verbose
```

**Output:**
```
✅ Found 2 results (with scoring breakdown)

1. jwt_auth_v2
   Total Score: 87%
   ├─ Semantic: 35% (0.4 * 87.5% similarity)
   ├─ Reliability: 23% (0.3 * 78% confidence)
   ├─ Recency: 18% (0.2 * 92% - used 2 days ago)
   └─ Diversity: 11% (0.1 * 100% - unique result)

2. basic_auth_deprecated
   Total Score: 42%
   ├─ Semantic: 30% (0.4 * 75% similarity)
   ├─ Reliability: 9% (0.3 * 31% confidence) ⚠️ Low!
   ├─ Recency: 2% (0.2 * 12% - used 180 days ago) ⚠️ Old!
   └─ Diversity: 1% (0.1 * 5% - similar to result 1)
```

---

## Pattern Linking & Causal Reasoning

Pattern linking enables **causal reasoning** - understanding how patterns relate to each other.

### Link Types

| Type | Meaning | Example |
|------|---------|---------|
| **causes** | A leads to B | Poor error handling → Production crashes |
| **requires** | A needs B first | JWT auth → Secret key management |
| **conflicts** | A incompatible with B | Stateless auth ↔ Server sessions |
| **enhances** | A improves B | Caching → Database performance |
| **alternative** | A substitutes B | OAuth2 vs Basic auth |

### Creating Links

```bash
# Method 1: Explicit linking (future feature)
npx claude-flow@alpha memory link \
  jwt_authentication requires secret_key_rotation \
  --strength 0.9 --reasoningbank

# Method 2: Automatic discovery (current)
# SAFLA automatically discovers links based on:
# - Co-occurrence in queries
# - Semantic similarity
# - Usage patterns
```

### Link Discovery Example

```bash
# Store patterns
npx claude-flow@alpha memory store postgres_db \
  "PostgreSQL with connection pooling" \
  --namespace database --reasoningbank

npx claude-flow@alpha memory store db_indexing \
  "B-tree indexes on foreign keys and WHERE clause columns" \
  --namespace database --reasoningbank

npx claude-flow@alpha memory store query_optimization \
  "Use EXPLAIN ANALYZE to identify slow queries" \
  --namespace database --reasoningbank

# Query multiple times - SAFLA learns relationships
npx claude-flow@alpha memory query "database performance" --reasoningbank
npx claude-flow@alpha memory query "slow queries" --reasoningbank
npx claude-flow@alpha memory query "PostgreSQL optimization" --reasoningbank

# After usage, SAFLA discovers links:
# db_indexing → enhances → postgres_db
# query_optimization → requires → db_indexing
```

### Querying with Links (Future Feature)

```bash
# Find all patterns that REQUIRE a specific pattern
npx claude-flow@alpha memory links jwt_authentication --type requires
```

**Expected Output:**
```
Patterns that REQUIRE jwt_authentication:

1. token_refresh (strength: 0.95)
   → Can't refresh tokens without JWT system

2. api_authorization (strength: 0.88)
   → API auth depends on JWT validation

3. user_session_management (strength: 0.75)
   → Sessions need JWT for state
```

---

## Cognitive Diversity Patterns

ReasoningBank supports **6 cognitive reasoning strategies** inspired by cognitive science research.

### The Six Patterns

| Pattern | Description | Use Case |
|---------|-------------|----------|
| **Convergent** | Focus on single best solution | Optimization, debugging |
| **Divergent** | Explore multiple possibilities | Brainstorming, architecture |
| **Lateral** | Creative indirect approaches | Innovation, problem-solving |
| **Systems** | Holistic interconnected thinking | Complex systems, architecture |
| **Critical** | Evaluate and challenge assumptions | Code review, security |
| **Adaptive** | Learn and evolve strategies | Self-improving agents |

### Using Cognitive Patterns

```bash
# Store pattern with cognitive type
npx claude-flow@alpha memory store debug_approach \
  "Use binary search to isolate bugs: test middle, eliminate half" \
  --namespace debugging \
  --cognitive-pattern convergent \
  --reasoningbank

npx claude-flow@alpha memory store architecture_brainstorm \
  "Consider microservices, monolith, serverless, hybrid approaches" \
  --namespace architecture \
  --cognitive-pattern divergent \
  --reasoningbank

npx claude-flow@alpha memory store security_audit \
  "Question all assumptions: Is this input validated? Can this be spoofed?" \
  --namespace security \
  --cognitive-pattern critical \
  --reasoningbank
```

### Query by Cognitive Pattern

```bash
# Find convergent (focused) approaches
npx claude-flow@alpha memory query "optimization" \
  --cognitive-pattern convergent --reasoningbank
```

**Output:**
```
✅ Found convergent thinking patterns:

1. debug_approach
   Binary search to isolate bugs
   Pattern: Convergent (narrowing down)

2. performance_profiling
   Profile first, optimize bottleneck, measure again
   Pattern: Convergent (focused optimization)
```

### Cognitive Pattern in Action

**Scenario**: Building a new authentication system

```bash
# Phase 1: Divergent (explore options)
npx claude-flow@alpha memory query "authentication approaches" \
  --cognitive-pattern divergent --reasoningbank
# Returns: JWT, OAuth2, Session-based, API keys, certificates

# Phase 2: Critical (evaluate each)
npx claude-flow@alpha memory query "JWT security concerns" \
  --cognitive-pattern critical --reasoningbank
# Returns: Token theft, XSS risks, CSRF considerations

# Phase 3: Convergent (pick best solution)
npx claude-flow@alpha memory query "production JWT implementation" \
  --cognitive-pattern convergent --reasoningbank
# Returns: JWT with refresh rotation (best practice)

# Phase 4: Systems (understand full picture)
npx claude-flow@alpha memory query "JWT integration points" \
  --cognitive-pattern systems --reasoningbank
# Returns: Frontend storage, backend validation, refresh flow, logout

# Phase 5: Adaptive (learn from implementation)
# After implementation, confidence scores update based on success/failure
```

---

## Task Trajectory Tracking

Track **sequential reasoning steps** to learn complete workflows.

### Recording Trajectories

```bash
# Start a task trajectory
npx claude-flow@alpha memory trajectory start build_api \
  "Building RESTful API with authentication" \
  --reasoningbank

# Record each step
npx claude-flow@alpha memory trajectory step build_api \
  "Designed database schema with users, tokens tables" \
  --reasoningbank

npx claude-flow@alpha memory trajectory step build_api \
  "Implemented JWT token generation with HMAC SHA256" \
  --reasoningbank

npx claude-flow@alpha memory trajectory step build_api \
  "Added refresh token rotation with secure cookies" \
  --reasoningbank

npx claude-flow@alpha memory trajectory step build_api \
  "Tested with Postman: 100% pass rate" \
  --reasoningbank

# Complete trajectory
npx claude-flow@alpha memory trajectory end build_api \
  --outcome success --reasoningbank
```

### Retrieving Trajectories

```bash
# Get full trajectory
npx claude-flow@alpha memory trajectory get build_api --reasoningbank
```

**Output:**
```
Trajectory: build_api
Task: Building RESTful API with authentication
Outcome: ✅ Success
Steps: 4

Step 1: Designed database schema with users, tokens tables
  Duration: 15 minutes

Step 2: Implemented JWT token generation with HMAC SHA256
  Duration: 30 minutes

Step 3: Added refresh token rotation with secure cookies
  Duration: 20 minutes

Step 4: Tested with Postman: 100% pass rate
  Duration: 10 minutes

Total Time: 75 minutes
Confidence: 75% (successful trajectory)
```

### Learning from Trajectories

SAFLA uses trajectories to:

1. **Identify successful sequences** - "These steps led to success"
2. **Spot failure patterns** - "Step 3 always causes issues"
3. **Recommend workflows** - "Users who did A, B, C succeeded"
4. **Estimate timelines** - "This task typically takes 60-90 minutes"

**Example**:

```bash
# Query for similar task
npx claude-flow@alpha memory query "build authentication API" \
  --include-trajectories --reasoningbank
```

**Output:**
```
✅ Found 1 matching trajectory: build_api

Recommended Steps (based on successful past execution):
1. Design database schema (est. 15 min)
2. Implement JWT generation (est. 30 min)
3. Add refresh rotation (est. 20 min)
4. Test thoroughly (est. 10 min)

Total Estimated Time: 75 minutes
Success Rate: 100% (1/1 trajectories succeeded)
Confidence: 75%
```

---

## Bayesian Confidence Learning

SAFLA uses **Bayesian updating** to learn from outcomes.

### The Formula

```
P(pattern works | evidence) = P(evidence | pattern works) * P(pattern works)
                               ─────────────────────────────────────────────
                                            P(evidence)

Simplified:
  new_confidence = old_confidence + learning_rate * (outcome - old_confidence)
```

### Learning Curve Example

```bash
# Day 1: Store new pattern
npx claude-flow@alpha memory store async_pattern \
  "Use async/await with try-catch for error handling" \
  --namespace javascript --reasoningbank
# Confidence: 50% (prior belief: "probably works")

# Day 5: First use → Success
# Confidence: 50% → 60% (+20% of remaining 50%)

# Day 10: Second use → Success
# Confidence: 60% → 68% (+20% of remaining 40%)

# Day 15: Third use → Failure!
# Confidence: 68% → 58% (-15% of current 68%)

# Day 20: Fourth use → Success
# Confidence: 58% → 66% (+20% of remaining 42%)

# Day 30: Fifth use → Success
# Confidence: 66% → 73% (+20% of remaining 34%)
```

### Manual Confidence Updates

```bash
# Report success (future feature)
npx claude-flow@alpha memory feedback async_pattern \
  --outcome success --notes "Worked perfectly in production" \
  --reasoningbank

# Report failure (future feature)
npx claude-flow@alpha memory feedback async_pattern \
  --outcome failure --notes "Didn't handle promise rejection properly" \
  --reasoningbank
```

### Confidence-Based Recommendations

```bash
# Query with confidence threshold
npx claude-flow@alpha memory query "error handling" \
  --min-confidence 0.7 --reasoningbank
```

**Output:**
```
✅ Found 3 results (confidence >= 70%)

1. try_catch_async (confidence: 87%) ⭐⭐⭐
   Proven approach, highly reliable

2. error_middleware (confidence: 79%) ⭐⭐
   Good approach, moderately tested

3. logging_errors (confidence: 72%) ⭐
   Acceptable approach, some validation

Excluded (low confidence):
- manual_error_check (31%) ⚠️ Unreliable
- custom_error_class (45%) ⚠️ Untested
```

---

## Advanced Query Strategies

### 1. Multi-Factor Queries

```bash
# Prioritize recent, reliable patterns
npx claude-flow@alpha memory query "database optimization" \
  --min-confidence 0.6 \
  --max-age 90 \
  --namespace backend \
  --reasoningbank
```

### 2. Similarity Threshold

```bash
# Only return highly relevant results
npx claude-flow@alpha memory query "authentication" \
  --min-similarity 0.75 \
  --reasoningbank
```

### 3. Cross-Namespace Search

```bash
# Search all namespaces, group by domain
npx claude-flow@alpha memory query "performance" \
  --all-namespaces \
  --group-by namespace \
  --reasoningbank
```

**Output:**
```
✅ Found 8 results across 3 namespaces

Backend (4 results):
1. db_connection_pooling (89% match)
2. query_optimization (82% match)
3. caching_strategy (78% match)
4. api_rate_limiting (71% match)

Frontend (3 results):
5. lazy_loading (85% match)
6. code_splitting (79% match)
7. image_optimization (74% match)

DevOps (1 result):
8. cdn_configuration (81% match)
```

### 4. Temporal Queries

```bash
# Find patterns used recently
npx claude-flow@alpha memory query "API design" \
  --since "2025-10-01" \
  --reasoningbank

# Find patterns from specific time period
npx claude-flow@alpha memory query "security" \
  --between "2025-09-01" "2025-10-01" \
  --reasoningbank
```

---

## Building Self-Learning Agents

Integrate ReasoningBank with AI agents for **autonomous learning**.

### Agent Architecture

```javascript
class SelfLearningAgent {
  constructor(namespace) {
    this.namespace = namespace;
    this.reasoningBank = new ReasoningBankClient();
  }

  async solveTask(task) {
    // 1. Query ReasoningBank for relevant patterns
    const patterns = await this.reasoningBank.query(task, {
      namespace: this.namespace,
      minConfidence: 0.5
    });

    // 2. Apply highest-confidence pattern
    const bestPattern = patterns[0];
    const result = await this.applyPattern(bestPattern, task);

    // 3. Record outcome
    await this.reasoningBank.recordOutcome(bestPattern.id, {
      success: result.success,
      duration: result.duration,
      notes: result.notes
    });

    // 4. Update confidence (SAFLA learning)
    // Happens automatically in ReasoningBank

    // 5. Store trajectory for complex tasks
    if (task.complex) {
      await this.reasoningBank.recordTrajectory({
        task: task.description,
        steps: result.steps,
        outcome: result.success ? 'success' : 'failure'
      });
    }

    return result;
  }

  async learnFromExperience() {
    // Analyze recent patterns
    const stats = await this.reasoningBank.getStatistics(this.namespace);

    // Identify low-confidence patterns
    const unreliable = stats.patterns.filter(p => p.confidence < 0.4);

    // Suggest improvements or alternatives
    for (const pattern of unreliable) {
      const alternatives = await this.reasoningBank.query(pattern.title, {
        excludeIds: [pattern.id],
        minConfidence: 0.6
      });

      if (alternatives.length > 0) {
        console.log(`Consider replacing ${pattern.title} with ${alternatives[0].title}`);
      }
    }
  }
}

// Usage
const agent = new SelfLearningAgent('backend');
await agent.solveTask({ description: 'Implement API authentication' });
await agent.learnFromExperience();
```

### Example: Code Review Agent

```bash
# Agent learns from code reviews over time

# Week 1: Store initial patterns
npx claude-flow@alpha memory store code_review_001 \
  "Check for SQL injection vulnerabilities in raw queries" \
  --namespace code_review --reasoningbank

# Week 2: Agent finds SQL injection → Confidence increases
# Confidence: 50% → 65%

# Week 5: Agent misses XSS vulnerability → Need new pattern
npx claude-flow@alpha memory store code_review_002 \
  "Validate and escape user input to prevent XSS attacks" \
  --namespace code_review --reasoningbank

# Week 10: Agent now catches both SQL injection AND XSS
# Pattern 1 confidence: 65% → 82%
# Pattern 2 confidence: 50% → 74%

# Week 20: Query for code review patterns
npx claude-flow@alpha memory query "security vulnerabilities" \
  --namespace code_review --reasoningbank
# Returns both patterns, ranked by reliability!
```

---

## Performance Optimization

### 1. Batch Operations

```bash
# ❌ Slow: Sequential stores
for file in *.md; do
  npx claude-flow@alpha memory store "$file" "$(cat $file)" --reasoningbank
done

# ✅ Fast: Batch import (future feature)
npx claude-flow@alpha memory import patterns.json --reasoningbank
```

### 2. Namespace Partitioning

```bash
# For large databases, partition by namespace
# Each namespace becomes separate table/index

npx claude-flow@alpha memory optimize --partition-namespaces --reasoningbank
```

### 3. Embedding Caching

```bash
# Cache embeddings for frequently queried terms
npx claude-flow@alpha memory cache-embeddings \
  --queries "authentication,performance,security" \
  --reasoningbank
```

### 4. Approximate Nearest Neighbors

```bash
# For > 10,000 patterns, use ANN (future feature)
npx claude-flow@alpha memory config \
  --search-algorithm ann \
  --ann-neighbors 100 \
  --reasoningbank
```

### 5. Query Result Caching

```javascript
// Client-side caching
const cache = new Map();

async function queryWithCache(query, options) {
  const cacheKey = JSON.stringify({ query, options });

  if (cache.has(cacheKey)) {
    return cache.get(cacheKey);
  }

  const results = await reasoningBank.query(query, options);
  cache.set(cacheKey, results);

  return results;
}
```

---

## Exercises

### Exercise 1: Build a Learning System

Create a self-improving bug tracking system:

```bash
# 1. Store 10 bug solutions
# 2. Query for similar bugs
# 3. Track which solutions work
# 4. Observe confidence scores improving
```

### Exercise 2: Create a Knowledge Graph

Build a linked knowledge base:

```bash
# 1. Store related patterns
# 2. Document relationships (requires, enhances, conflicts)
# 3. Query and observe cross-domain recommendations
```

### Exercise 3: Implement Cognitive Strategies

Apply different cognitive patterns to the same problem:

```bash
# 1. Use divergent thinking to explore solutions
# 2. Use critical thinking to evaluate each
# 3. Use convergent thinking to select best
# 4. Use systems thinking to understand integration
```

---

## Summary

You've mastered:

- ✅ **SAFLA**: Self-aware feedback loop learning
- ✅ **Pattern Linking**: Causal reasoning and relationships
- ✅ **Cognitive Patterns**: 6 reasoning strategies
- ✅ **Trajectories**: Sequential workflow learning
- ✅ **Bayesian Learning**: Confidence evolution
- ✅ **Advanced Queries**: Multi-factor search strategies
- ✅ **Self-Learning Agents**: Autonomous improvement
- ✅ **Optimization**: Performance at scale

**Key Insight**: ReasoningBank is not just a database—it's a **self-aware learning system** that gets smarter with every use.

---

## Next Steps

- **[Agentic-Flow Integration](./agentic-flow-integration.md)** - How it all works under the hood
- **[Architecture](./architecture.md)** - Technical implementation details

---

**Last Updated**: 2025-10-14
**Version**: v2.7.0-alpha.10
