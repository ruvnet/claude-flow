# ReasoningBank Basic Tutorial

## Welcome! 👋

This hands-on tutorial will teach you the fundamentals of ReasoningBank's persistent memory and semantic search system. By the end, you'll be able to:

- ✅ Store and retrieve memories
- ✅ Use semantic search effectively
- ✅ Organize knowledge with namespaces
- ✅ Understand confidence scoring
- ✅ Track usage patterns

**Time Required**: 30 minutes
**Prerequisites**: Node.js 18+, basic command-line skills

## Table of Contents

1. [Setup](#setup)
2. [Your First Memory](#your-first-memory)
3. [Semantic Search](#semantic-search)
4. [Namespaces for Organization](#namespaces-for-organization)
5. [Confidence & Usage Tracking](#confidence--usage-tracking)
6. [Practical Examples](#practical-examples)
7. [Best Practices](#best-practices)

---

## Setup

### Step 1: Install Claude-Flow

```bash
# Install latest alpha version
npx claude-flow@alpha init --force

# Verify installation
npx claude-flow@alpha --version
# Expected: v2.7.0-alpha.10
```

### Step 2: Verify ReasoningBank

```bash
npx claude-flow@alpha memory status --reasoningbank
```

**Expected Output:**
```
ReasoningBank Status:
✅ Backend: agentic-flow@1.5.13
✅ Database: .swarm/memory.db
✅ Patterns stored: 0
✅ Ready to use
```

---

## Your First Memory

Let's store your first memory and understand what's happening under the hood.

### Store a Simple Memory

```bash
npx claude-flow@alpha memory store greeting \
  "Hello! I'm learning ReasoningBank." \
  --namespace tutorial --reasoningbank
```

**What Just Happened?**

1. **Pattern Created**: Your memory was stored as a "pattern"
2. **Embedding Generated**: A 1024-dimension vector representing the semantic meaning (1ms)
3. **SQLite Storage**: Saved to `.swarm/memory.db` database (3-5ms)
4. **Initial Confidence**: Set to 0.5 (50%) - will improve with usage

**Output:**
```
✅ Stored: greeting (namespace: tutorial)
Confidence: 50%
Storage time: 5ms
```

### Retrieve Your Memory

```bash
npx claude-flow@alpha memory list --namespace tutorial --reasoningbank
```

**Output:**
```
📋 Patterns in namespace 'tutorial':

1. greeting
   Content: Hello! I'm learning ReasoningBank.
   Confidence: 50%
   Created: 2025-10-14 10:30:15
   Usage: 0 times
```

---

## Semantic Search

The real power of ReasoningBank is **semantic search** - finding relevant memories by meaning, not just keywords.

### Example 1: Exact Match

```bash
# Store a memory
npx claude-flow@alpha memory store api_auth \
  "Use JWT tokens with 15-minute expiration" \
  --namespace backend --reasoningbank

# Query with exact keyword
npx claude-flow@alpha memory query "JWT" \
  --namespace backend --reasoningbank
```

**Output:**
```
✅ Found 1 result (semantic search)

Key: api_auth
Value: Use JWT tokens with 15-minute expiration
Match Score: 95%
Confidence: 50%
Query time: 2ms
```

### Example 2: Semantic Match (No Exact Keywords!)

```bash
# Query with related concept (doesn't contain "JWT")
npx claude-flow@alpha memory query "authentication" \
  --namespace backend --reasoningbank
```

**Output:**
```
✅ Found 1 result (semantic search)

Key: api_auth
Value: Use JWT tokens with 15-minute expiration
Match Score: 78%  ← Lower but still found!
Confidence: 50%
Query time: 2ms
```

**Why It Works:** The embedding for "authentication" is semantically similar to the embedding for "JWT tokens" because they're related concepts!

### Example 3: Multi-Concept Search

Let's store more patterns and see how semantic search finds related memories:

```bash
# Store related patterns
npx claude-flow@alpha memory store db_connection \
  "PostgreSQL with connection pooling (max 20 connections)" \
  --namespace backend --reasoningbank

npx claude-flow@alpha memory store cache_strategy \
  "Redis for session storage with 24-hour TTL" \
  --namespace backend --reasoningbank

npx claude-flow@alpha memory store rate_limiting \
  "100 requests per minute per IP using sliding window" \
  --namespace backend --reasoningbank

# Query with broad concept
npx claude-flow@alpha memory query "performance optimization" \
  --namespace backend --reasoningbank
```

**Output:**
```
✅ Found 3 results (semantic search)

1. cache_strategy
   Value: Redis for session storage with 24-hour TTL
   Match Score: 82%
   Confidence: 50%

2. db_connection
   Value: PostgreSQL with connection pooling (max 20 connections)
   Match Score: 71%
   Confidence: 50%

3. rate_limiting
   Value: 100 requests per minute per IP using sliding window
   Match Score: 65%
   Confidence: 50%

Query time: 3ms
```

**Amazing!** Even though "performance optimization" doesn't appear in any pattern, the system understood that caching, connection pooling, and rate limiting are all performance-related concepts!

---

## Namespaces for Organization

Namespaces are like folders for organizing memories. Think of them as knowledge domains.

### Common Namespace Patterns

```bash
# Backend patterns
npx claude-flow@alpha memory store rest_api \
  "RESTful endpoints with versioning /api/v1/" \
  --namespace backend --reasoningbank

# Frontend patterns
npx claude-flow@alpha memory store react_hooks \
  "Use useEffect for side effects, useMemo for expensive computations" \
  --namespace frontend --reasoningbank

# DevOps patterns
npx claude-flow@alpha memory store ci_pipeline \
  "GitHub Actions with parallel test execution" \
  --namespace devops --reasoningbank

# Architecture decisions
npx claude-flow@alpha memory store microservices \
  "Event-driven architecture with message queues" \
  --namespace architecture --reasoningbank
```

### Query Across Namespaces

```bash
# Query specific namespace
npx claude-flow@alpha memory query "API design" \
  --namespace backend --reasoningbank

# Query all namespaces (omit --namespace)
npx claude-flow@alpha memory query "API design" \
  --reasoningbank
```

### List All Namespaces

```bash
npx claude-flow@alpha memory list --reasoningbank
```

**Output:**
```
📂 Namespaces:
├── backend (4 patterns)
├── frontend (1 pattern)
├── devops (1 pattern)
├── architecture (1 pattern)
└── tutorial (1 pattern)

Total: 8 patterns across 5 namespaces
```

---

## Confidence & Usage Tracking

ReasoningBank uses **SAFLA (Self-Aware Feedback Loop Algorithm)** to learn from usage patterns.

### Understanding Confidence Scores

| Confidence | Interpretation | Action |
|-----------|----------------|--------|
| **0-30%** | Untested or failed | Use with caution |
| **30-50%** | New or uncertain | Default starting point |
| **50-70%** | Moderately proven | Generally reliable |
| **70-85%** | Well-tested | Highly reliable |
| **85-100%** | Extensively validated | Best practices |

### How Confidence Changes

```bash
# Initial storage
npx claude-flow@alpha memory store api_v1 \
  "Basic password authentication" \
  --namespace backend --reasoningbank
# Confidence: 50%

# Query and use the pattern (usage_count++)
npx claude-flow@alpha memory query "authentication" \
  --namespace backend --reasoningbank
# Confidence: 50% (no change yet)
# Usage: 1

# After multiple successful uses (simulated)
# Confidence: 50% → 60% → 68% → 75%
# Usage: 1 → 5 → 10 → 20
```

### View Usage Statistics

```bash
npx claude-flow@alpha memory status --reasoningbank
```

**Output:**
```
ReasoningBank Statistics:

Total Patterns: 8
Total Queries: 15
Average Confidence: 52%

Most Used Patterns:
1. api_auth (8 uses, 65% confidence)
2. cache_strategy (5 uses, 58% confidence)
3. db_connection (3 uses, 53% confidence)

Top Performing Namespaces:
1. backend (4 patterns, avg 59% confidence)
2. frontend (1 pattern, avg 50% confidence)
```

---

## Practical Examples

### Example 1: Building an API

**Scenario**: You're building a REST API and want to remember best practices.

```bash
# Store patterns as you learn
npx claude-flow@alpha memory store api_versioning \
  "Use /api/v1/, /api/v2/ for backward compatibility" \
  --namespace api_design --reasoningbank

npx claude-flow@alpha memory store error_handling \
  "Return consistent error format: {error, message, code, details}" \
  --namespace api_design --reasoningbank

npx claude-flow@alpha memory store pagination \
  "Cursor-based pagination with limit/before/after params" \
  --namespace api_design --reasoningbank

npx claude-flow@alpha memory store security \
  "CORS, rate limiting, input validation, SQL injection prevention" \
  --namespace api_design --reasoningbank

# Later, query when implementing
npx claude-flow@alpha memory query "error responses" \
  --namespace api_design --reasoningbank
```

**Output:**
```
✅ Found 1 result

Key: error_handling
Value: Return consistent error format: {error, message, code, details}
Match Score: 88%
```

### Example 2: Debugging a Problem

**Scenario**: You encountered a React re-render issue and solved it.

```bash
# Store the solution
npx claude-flow@alpha memory store react_rerender_fix \
  "Circular ref in useEffect deps causing infinite loop. Fix: Use useRef or useCallback with empty deps" \
  --namespace debugging --reasoningbank

# Weeks later, similar issue occurs
npx claude-flow@alpha memory query "React infinite loop" \
  --namespace debugging --reasoningbank
```

**Output:**
```
✅ Found 1 result

Key: react_rerender_fix
Value: Circular ref in useEffect deps causing infinite loop. Fix: Use useRef...
Match Score: 85%
Usage: 1 (you've seen this before!)
```

### Example 3: Team Knowledge Base

**Scenario**: Your team stores architectural decisions.

```bash
# Team member 1 stores decision
npx claude-flow@alpha memory store arch_001_messaging \
  "Use RabbitMQ for event-driven architecture. Kafka considered but RabbitMQ better for our scale" \
  --namespace team_decisions --reasoningbank

# Team member 2 queries later
npx claude-flow@alpha memory query "event system" \
  --namespace team_decisions --reasoningbank
```

**Output:**
```
✅ Found 1 result

Key: arch_001_messaging
Value: Use RabbitMQ for event-driven architecture. Kafka considered but...
Match Score: 79%

💡 This helps new team members understand past decisions!
```

---

## Best Practices

### 1. Descriptive Keys

```bash
# ❌ Bad: Vague key
npx claude-flow@alpha memory store config "JWT secret" --reasoningbank

# ✅ Good: Descriptive key
npx claude-flow@alpha memory store jwt_secret_config \
  "JWT secret stored in .env, 256-bit random string" \
  --reasoningbank
```

### 2. Rich Content

```bash
# ❌ Bad: Too brief
npx claude-flow@alpha memory store db "Postgres" --reasoningbank

# ✅ Good: Context included
npx claude-flow@alpha memory store db_choice \
  "PostgreSQL chosen for ACID compliance, JSON support, and team expertise. MySQL considered but Postgres better for complex queries" \
  --namespace architecture --reasoningbank
```

### 3. Namespace Organization

```bash
# ✅ Good: Clear hierarchy
backend/
  api/
    authentication
    rate_limiting
  database/
    connection_pooling
    migrations
frontend/
  components/
    hooks
    context
debugging/
  errors/
    memory_leaks
    infinite_loops
```

### 4. Regular Queries

The more you query, the better the system learns what's useful!

```bash
# Query frequently to build usage data
npx claude-flow@alpha memory query "API patterns" --reasoningbank
# This increments usage_count, improving confidence over time
```

### 5. Update vs. Store New

```bash
# ❌ Bad: Store duplicate
npx claude-flow@alpha memory store api_auth "JWT tokens" --reasoningbank
npx claude-flow@alpha memory store api_auth_v2 "JWT with refresh" --reasoningbank

# ✅ Good: Store as evolution
npx claude-flow@alpha memory store api_auth_basic \
  "Simple JWT tokens (deprecated)" --reasoningbank

npx claude-flow@alpha memory store api_auth_production \
  "JWT with refresh token rotation (current)" --reasoningbank
```

---

## Exercises

### Exercise 1: Personal Knowledge Base

Build a knowledge base of your favorite tools/libraries:

```bash
# Store 5 patterns about tools you use
npx claude-flow@alpha memory store tool_1 "..." --namespace tools --reasoningbank
npx claude-flow@alpha memory store tool_2 "..." --namespace tools --reasoningbank
# ... 3 more

# Query to find relevant tool
npx claude-flow@alpha memory query "testing" --namespace tools --reasoningbank
```

### Exercise 2: Bug Solutions

Store 3 bugs you've solved recently:

```bash
npx claude-flow@alpha memory store bug_001 \
  "CORS error: Add Access-Control-Allow-Origin header" \
  --namespace debugging --reasoningbank

# Add 2 more bugs...

# Later, query when you see a similar error
npx claude-flow@alpha memory query "CORS" --namespace debugging --reasoningbank
```

### Exercise 3: Code Patterns

Store code snippets you frequently use:

```bash
npx claude-flow@alpha memory store async_error \
  "try-catch with async/await: async function() { try { await... } catch (e) { ... } }" \
  --namespace code_snippets --reasoningbank

# Add more patterns...
```

---

## Common Issues & Solutions

### Issue 1: No Results Found

```bash
npx claude-flow@alpha memory query "foobar" --reasoningbank
# ❌ Found 0 results
```

**Solution**: Your query might be too specific or no related patterns exist. Try broader terms:

```bash
npx claude-flow@alpha memory query "configuration" --reasoningbank
# ✅ Found 3 results
```

### Issue 2: Irrelevant Results

```bash
npx claude-flow@alpha memory query "security" --reasoningbank
# Returns patterns about "secure sockets" instead of "authentication"
```

**Solution**: Use more specific queries or namespace filtering:

```bash
npx claude-flow@alpha memory query "authentication security" \
  --namespace backend --reasoningbank
```

### Issue 3: Database File Missing

```bash
npx claude-flow@alpha memory status --reasoningbank
# ❌ Database not found: .swarm/memory.db
```

**Solution**: Initialize the system:

```bash
npx claude-flow@alpha memory store init "Initializing database" --reasoningbank
```

---

## What's Next?

Congratulations! You've mastered the basics of ReasoningBank. 🎉

### Continue Learning:

1. **[Advanced Tutorial](./tutorial-advanced.md)** - Self-learning, pattern linking, cognitive diversity
2. **[Architecture](./architecture.md)** - Deep-dive into how it works
3. **[Agentic-Flow Integration](./agentic-flow-integration.md)** - Use with AI agents

### Try These Advanced Features:

```bash
# Pattern linking (covered in advanced tutorial)
npx claude-flow@alpha memory link api_auth requires secret_management

# Cognitive patterns
npx claude-flow@alpha memory store problem_solving \
  "Use divergent thinking for creative solutions" \
  --cognitive-pattern divergent --reasoningbank

# Export/backup
npx claude-flow@alpha memory export --namespace backend > backup.json
```

---

## Summary

You learned:

- ✅ How to store and retrieve memories
- ✅ Semantic search with 2-3ms latency
- ✅ Namespace organization
- ✅ Confidence scoring and SAFLA learning
- ✅ Practical use cases

**Key Takeaway**: ReasoningBank is like a **second brain** for your development workflow. The more you use it, the smarter it gets!

---

**Need Help?**
- GitHub Issues: https://github.com/ruvnet/claude-flow/issues
- Documentation: https://github.com/ruvnet/claude-flow/tree/main/docs/reasoningbank

**Happy Learning! 🚀**

---

**Last Updated**: 2025-10-14
**Version**: v2.7.0-alpha.10
