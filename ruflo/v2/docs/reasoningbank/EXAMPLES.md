# ReasoningBank Examples & Code Snippets

## Quick Reference

This document provides ready-to-use examples and code snippets for common ReasoningBank operations.

## Table of Contents

- [CLI Examples](#cli-examples)
- [JavaScript/TypeScript Examples](#javascripttypescript-examples)
- [Use Case Examples](#use-case-examples)
- [Integration Patterns](#integration-patterns)

---

## CLI Examples

### Basic Operations

```bash
# Store a simple pattern
npx claude-flow@alpha memory store api_key \
  "JWT tokens with HMAC SHA256 signing" \
  --namespace backend --reasoningbank

# Query with semantic search
npx claude-flow@alpha memory query "authentication" \
  --namespace backend --reasoningbank

# List all patterns in namespace
npx claude-flow@alpha memory list --namespace backend --reasoningbank

# Delete a pattern
npx claude-flow@alpha memory delete api_key \
  --namespace backend --reasoningbank

# Check system status
npx claude-flow@alpha memory status --reasoningbank
```

### Advanced Queries

```bash
# Query with confidence threshold
npx claude-flow@alpha memory query "security" \
  --min-confidence 0.7 --reasoningbank

# Query with similarity threshold
npx claude-flow@alpha memory query "performance" \
  --min-similarity 0.8 --reasoningbank

# Cross-namespace search
npx claude-flow@alpha memory query "API design" --reasoningbank

# Query with limit
npx claude-flow@alpha memory query "optimization" \
  --limit 5 --reasoningbank
```

### Cognitive Patterns

```bash
# Store with cognitive pattern
npx claude-flow@alpha memory store debug_strategy \
  "Use binary search to isolate bugs" \
  --cognitive-pattern convergent \
  --reasoningbank

# Query by cognitive pattern
npx claude-flow@alpha memory query "problem solving" \
  --cognitive-pattern divergent --reasoningbank
```

---

## JavaScript/TypeScript Examples

### Basic Integration

```javascript
import { spawn } from 'child_process';
import path from 'path';

class ReasoningBankClient {
  constructor() {
    this.messageId = 0;
    this.pendingRequests = new Map();
  }

  async initialize() {
    // Spawn agentic-flow process
    const agenticFlowPath = path.join(
      process.cwd(),
      'node_modules/agentic-flow/dist/index.js'
    );

    this.process = spawn('node', [agenticFlowPath]);

    // Handle responses
    this.process.stdout.on('data', data => {
      try {
        const response = JSON.parse(data.toString());
        const handler = this.pendingRequests.get(response.id);

        if (handler) {
          if (response.error) {
            handler.reject(new Error(response.error.message));
          } else {
            handler.resolve(response.result);
          }
          this.pendingRequests.delete(response.id);
        }
      } catch (err) {
        console.error('Failed to parse response:', err);
      }
    });

    this.process.stderr.on('data', data => {
      console.error('agentic-flow error:', data.toString());
    });
  }

  async sendRequest(method, params) {
    const id = ++this.messageId;

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pendingRequests.delete(id);
        reject(new Error('Request timeout'));
      }, 30000); // 30 second timeout

      this.pendingRequests.set(id, {
        resolve: result => {
          clearTimeout(timeout);
          resolve(result);
        },
        reject: error => {
          clearTimeout(timeout);
          reject(error);
        }
      });

      const request = JSON.stringify({
        jsonrpc: '2.0',
        method,
        params,
        id
      });

      this.process.stdin.write(request + '\n');
    });
  }

  async storePattern(title, content, options = {}) {
    return this.sendRequest('storePattern', {
      title,
      content,
      namespace: options.namespace || 'default',
      components: options.components || {}
    });
  }

  async query(query, options = {}) {
    return this.sendRequest('searchPatterns', {
      query,
      namespace: options.namespace || 'default',
      limit: options.limit || 10,
      minConfidence: options.minConfidence,
      minSimilarity: options.minSimilarity
    });
  }

  async getPattern(id) {
    return this.sendRequest('getPattern', { id });
  }

  async deletePattern(id) {
    return this.sendRequest('deletePattern', { id });
  }

  async getStatistics(namespace) {
    return this.sendRequest('getStatistics', { namespace });
  }

  shutdown() {
    if (this.process) {
      this.process.kill();
    }
  }
}

// Usage
const client = new ReasoningBankClient();
await client.initialize();

// Store a pattern
await client.storePattern('jwt_auth', 'JWT with refresh tokens', {
  namespace: 'backend',
  components: { reliability: 0.8 }
});

// Query patterns
const results = await client.query('authentication', {
  namespace: 'backend',
  limit: 5
});

console.log('Found patterns:', results);

// Cleanup
client.shutdown();
```

### Self-Learning Agent

```javascript
class SelfLearningAgent {
  constructor(namespace) {
    this.namespace = namespace;
    this.client = new ReasoningBankClient();
  }

  async initialize() {
    await this.client.initialize();
  }

  async learn(task, outcome, notes) {
    // Store the task as a pattern
    await this.client.storePattern(
      `task_${Date.now()}`,
      `${task} - ${notes}`,
      {
        namespace: this.namespace,
        components: {
          reliability: outcome === 'success' ? 0.7 : 0.3,
          task_type: this.classifyTask(task),
          outcome,
          timestamp: Date.now()
        }
      }
    );
  }

  async recall(query, options = {}) {
    // Query relevant past experiences
    const results = await this.client.query(query, {
      namespace: this.namespace,
      minConfidence: options.minConfidence || 0.5,
      limit: options.limit || 5
    });

    // Sort by reliability
    return results.sort((a, b) =>
      (b.components?.reliability || 0) - (a.components?.reliability || 0)
    );
  }

  async solve(task) {
    // 1. Recall similar past tasks
    const similarTasks = await this.recall(task, { minConfidence: 0.6 });

    if (similarTasks.length === 0) {
      console.log('No prior experience found. Exploring...');
      return this.exploreNewSolution(task);
    }

    // 2. Apply highest confidence approach
    const bestApproach = similarTasks[0];
    console.log(`Applying approach: ${bestApproach.title}`);
    console.log(`Confidence: ${(bestApproach.components.reliability * 100).toFixed(0)}%`);

    // 3. Execute approach
    const result = await this.executeApproach(bestApproach, task);

    // 4. Learn from outcome
    await this.learn(task, result.success ? 'success' : 'failure', result.notes);

    return result;
  }

  async exploreNewSolution(task) {
    // Implement exploration logic
    return {
      success: false,
      notes: 'Exploration in progress'
    };
  }

  async executeApproach(approach, task) {
    // Implement execution logic
    return {
      success: true,
      notes: `Successfully applied ${approach.title}`
    };
  }

  classifyTask(task) {
    // Simple classification based on keywords
    const keywords = task.toLowerCase();

    if (keywords.includes('auth') || keywords.includes('login')) {
      return 'authentication';
    } else if (keywords.includes('database') || keywords.includes('query')) {
      return 'database';
    } else if (keywords.includes('api')) {
      return 'api';
    } else {
      return 'general';
    }
  }

  shutdown() {
    this.client.shutdown();
  }
}

// Usage
const agent = new SelfLearningAgent('development');
await agent.initialize();

// Agent learns from experience
await agent.solve('Implement user authentication');
await agent.solve('Build REST API endpoints');
await agent.solve('Add JWT token validation');

// Agent gets smarter over time!
const approaches = await agent.recall('authentication');
console.log('Learned approaches:', approaches);

agent.shutdown();
```

---

## Use Case Examples

### 1. Team Knowledge Base

```bash
# Team members store architectural decisions
npx claude-flow@alpha memory store arch_001 \
  "Microservices with event-driven architecture using Kafka" \
  --namespace team_decisions --reasoningbank

npx claude-flow@alpha memory store arch_002 \
  "Use PostgreSQL for transactional data, Redis for caching" \
  --namespace team_decisions --reasoningbank

npx claude-flow@alpha memory store arch_003 \
  "API Gateway pattern with Kong for rate limiting and auth" \
  --namespace team_decisions --reasoningbank

# New team member queries decisions
npx claude-flow@alpha memory query "message queue" \
  --namespace team_decisions --reasoningbank
# Returns: arch_001 (Kafka decision)

npx claude-flow@alpha memory query "database choice" \
  --namespace team_decisions --reasoningbank
# Returns: arch_002 (PostgreSQL/Redis)
```

### 2. Bug Solution Database

```bash
# Store bug solutions as you fix them
npx claude-flow@alpha memory store bug_cors_error \
  "CORS error on API calls: Add Access-Control-Allow-Origin header in Express middleware" \
  --namespace debugging --reasoningbank

npx claude-flow@alpha memory store bug_react_rerender \
  "Infinite re-renders in useEffect: Use useRef for values that don't need re-renders" \
  --namespace debugging --reasoningbank

npx claude-flow@alpha memory store bug_memory_leak \
  "Memory leak in React: Clean up subscriptions in useEffect return function" \
  --namespace debugging --reasoningbank

# Later, when you encounter similar bugs
npx claude-flow@alpha memory query "React infinite loop" \
  --namespace debugging --reasoningbank
# Instantly finds the solution!
```

### 3. API Best Practices Library

```bash
# Build a library of API patterns
npx claude-flow@alpha memory store api_versioning \
  "Use /api/v1/, /api/v2/ URL versioning for backward compatibility" \
  --namespace api_patterns --reasoningbank

npx claude-flow@alpha memory store api_pagination \
  "Cursor-based pagination: /api/items?limit=20&cursor=abc123" \
  --namespace api_patterns --reasoningbank

npx claude-flow@alpha memory store api_error_format \
  'Consistent error format: {"error": true, "message": "...", "code": 400}' \
  --namespace api_patterns --reasoningbank

npx claude-flow@alpha memory store api_rate_limiting \
  "100 requests/minute per IP using sliding window algorithm" \
  --namespace api_patterns --reasoningbank

# Query when designing new API
npx claude-flow@alpha memory query "API response format" \
  --namespace api_patterns --reasoningbank
```

---

## Integration Patterns

### Pattern 1: Pre-Task Retrieval

```javascript
// Before starting a task, retrieve relevant patterns
async function executeTask(task) {
  // 1. Query ReasoningBank
  const relevantPatterns = await reasoningBank.query(task.description, {
    namespace: task.domain,
    limit: 3
  });

  // 2. Display patterns to user/agent
  console.log('Relevant past experiences:');
  relevantPatterns.forEach((pattern, i) => {
    console.log(`${i + 1}. ${pattern.title} (${(pattern.score * 100).toFixed(0)}% match)`);
    console.log(`   ${pattern.content}`);
  });

  // 3. Ask user/agent to select or proceed with new approach
  const selected = await promptUser('Use which pattern? (0 for new)');

  if (selected > 0) {
    return applyPattern(relevantPatterns[selected - 1], task);
  } else {
    return exploreNewApproach(task);
  }
}
```

### Pattern 2: Post-Task Learning

```javascript
// After completing a task, store the outcome
async function completeTask(task, outcome) {
  // 1. Store pattern with outcome
  await reasoningBank.storePattern(
    `${task.type}_${Date.now()}`,
    task.solution,
    {
      namespace: task.domain,
      components: {
        reliability: outcome.success ? 0.7 : 0.3,
        duration_ms: outcome.duration,
        outcome: outcome.success ? 'success' : 'failure',
        error: outcome.error
      }
    }
  );

  // 2. If similar pattern exists, update its confidence
  if (outcome.basedOnPattern) {
    const existingPattern = await reasoningBank.getPattern(outcome.basedOnPattern);

    if (outcome.success) {
      existingPattern.components.reliability += 0.1;
    } else {
      existingPattern.components.reliability -= 0.15;
    }

    await reasoningBank.updatePattern(existingPattern.id, existingPattern);
  }
}
```

### Pattern 3: Continuous Learning Loop

```javascript
// Implement SAFLA (Self-Aware Feedback Loop Algorithm)
class SAFLAAgent {
  async executeSAFLACycle(task) {
    // 1. OBSERVE: Retrieve relevant patterns
    const patterns = await this.reasoningBank.query(task, {
      namespace: this.namespace,
      minConfidence: 0.4
    });

    // 2. ANALYZE: Evaluate pattern relevance and confidence
    const analysis = this.analyzePatterns(patterns);

    // 3. LEARN: Select best approach
    const selectedPattern = analysis.bestPattern;

    // 4. ADAPT: Execute with selected pattern
    const result = await this.execute(selectedPattern, task);

    // 5. FEEDBACK: Update confidence and store outcome
    await this.updateConfidence(selectedPattern.id, result.success);
    await this.storeOutcome(task, result);

    // Return to step 1 for next task
    return result;
  }

  analyzePatterns(patterns) {
    return {
      bestPattern: patterns[0],
      alternatives: patterns.slice(1),
      confidence: patterns[0]?.components.reliability || 0.5
    };
  }

  async updateConfidence(patternId, success) {
    const pattern = await this.reasoningBank.getPattern(patternId);

    if (success) {
      pattern.components.reliability = Math.min(
        1.0,
        pattern.components.reliability + 0.15
      );
    } else {
      pattern.components.reliability = Math.max(
        0.0,
        pattern.components.reliability - 0.1
      );
    }

    await this.reasoningBank.updatePattern(patternId, pattern);
  }
}
```

---

## Shell Scripts

### Bulk Import

```bash
#!/bin/bash
# bulk-import.sh - Import patterns from CSV file

# CSV format: title,content,namespace
while IFS=',' read -r title content namespace; do
  npx claude-flow@alpha memory store "$title" "$content" \
    --namespace "$namespace" --reasoningbank
done < patterns.csv

echo "Import complete!"
```

### Backup & Restore

```bash
#!/bin/bash
# backup-memory.sh - Backup ReasoningBank database

BACKUP_DIR="backups/$(date +%Y%m%d_%H%M%S)"
mkdir -p "$BACKUP_DIR"

# Copy database
cp .swarm/memory.db "$BACKUP_DIR/"

# Export as JSON (if feature available)
npx claude-flow@alpha memory export --all > "$BACKUP_DIR/patterns.json"

echo "Backup saved to $BACKUP_DIR"
```

### Generate Report

```bash
#!/bin/bash
# report.sh - Generate usage report

echo "ReasoningBank Usage Report"
echo "=========================="
echo ""

npx claude-flow@alpha memory status --detailed --reasoningbank | \
  grep -E "(Total Patterns|Most Used|Average Confidence)"

echo ""
echo "Namespaces:"
npx claude-flow@alpha memory list --reasoningbank | \
  grep -E "^├──|^└──"
```

---

## Summary

This document provided:

- ✅ CLI command examples
- ✅ JavaScript/TypeScript integration code
- ✅ Real-world use cases
- ✅ Integration patterns (pre-task, post-task, SAFLA)
- ✅ Shell scripts for automation

For more examples, see:
- **[Basic Tutorial](./tutorial-basic.md)** - Step-by-step learning
- **[Advanced Tutorial](./tutorial-advanced.md)** - Advanced patterns
- **[Architecture](./architecture.md)** - Implementation details

---

**Last Updated**: 2025-10-14
**Version**: v2.7.0-alpha.10
