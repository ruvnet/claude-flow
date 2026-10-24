# RuVector NPM Package API Documentation

Version: 0.1.95
Package: `ruvector`
Repository: https://github.com/ruvnet/ruvector

## Overview

RuVector is a high-performance vector database for Node.js with automatic native/WASM fallback. It provides self-learning intelligence for Claude Code with Q-learning optimization, vector memory, and automatic agent routing.

## Installation

```bash
npm install ruvector
```

## MCP Server Integration

Add to Claude Code:

```bash
claude mcp add ruvector-mcp -- npx ruvector mcp-server
```

---

## Hooks API Reference

The hooks API provides 30+ MCP tools for intelligent agent routing, code analysis, and self-learning capabilities.

### Core Routing Functions

#### `hooks_route`

Routes a task to the best agent based on learned patterns.

**Input Parameters:**
| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `task` | string | Yes | Task description to route |
| `file` | string | No | File path for context-aware routing |

**Return Type:**
```typescript
interface RouteResult {
  success: boolean;
  task: string;
  file?: string;
  agent: string;           // Recommended agent (e.g., "typescript-developer")
  confidence: number;      // Confidence score 0.0-1.0
  reason: string;          // Explanation for routing decision
  alternates?: string[];   // Alternative agent suggestions
  sonaPatterns?: number;   // Number of SONA patterns used (if engine enabled)
  engineRouted?: boolean;  // Whether full engine was used
}
```

**Example Usage:**
```javascript
// MCP Tool Call
const result = await mcp.call('hooks_route', {
  task: 'implement user authentication',
  file: 'src/auth/login.ts'
});

// CLI Usage
npx ruvector hooks route "implement user login"
```

**Error Handling:**
- Returns default agent mapping if no patterns learned
- Falls back to file extension-based routing if task unclear

---

#### `hooks_route_enhanced`

Enhanced routing using AST complexity, coverage, and diff analysis signals.

**Input Parameters:**
| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `task` | string | Yes | Task description |
| `file` | string | No | File context for analysis |

**Return Type:**
```typescript
interface EnhancedRouteResult {
  success: boolean;
  agent: string;
  confidence: number;
  signals: {
    complexity?: number;    // Cyclomatic complexity
    coverage?: number;      // Test coverage percentage
    riskScore?: number;     // Change risk assessment
    diffCategory?: string;  // feature/bugfix/refactor
  };
  explanation: string;
}
```

**Example Usage:**
```javascript
const result = await mcp.call('hooks_route_enhanced', {
  task: 'refactor authentication module',
  file: 'src/auth/handlers.ts'
});
```

---

### AST Analysis Functions

#### `hooks_ast_analyze`

Parses file AST and extracts symbols, imports, and complexity metrics.

**Input Parameters:**
| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `file` | string | Yes | File path to analyze |

**Return Type:**
```typescript
interface FileAnalysis {
  file: string;
  language: string;           // TypeScript, JavaScript, Python, etc.
  imports: ImportInfo[];      // Import statements
  exports: ExportInfo[];      // Export statements
  functions: FunctionInfo[];  // Function definitions
  classes: ClassInfo[];       // Class definitions
  variables: string[];        // Variable declarations
  types: string[];           // Type definitions
  complexity: number;        // Overall complexity score
  lines: number;             // Total lines
  parseTime: number;         // Parse duration in ms
}

interface FunctionInfo {
  name: string;
  params: string[];
  returnType?: string;
  async: boolean;
  exported: boolean;
  startLine: number;
  endLine: number;
  complexity: number;
  calls: string[];           // Functions called within
}

interface ClassInfo {
  name: string;
  extends?: string;
  implements: string[];
  methods: FunctionInfo[];
  properties: string[];
  exported: boolean;
  startLine: number;
  endLine: number;
}

interface ImportInfo {
  source: string;
  default?: string;
  named: string[];
  namespace?: string;
  type: 'esm' | 'commonjs' | 'dynamic';
}
```

**Example Usage:**
```javascript
const analysis = await mcp.call('hooks_ast_analyze', {
  file: 'src/api/routes.ts'
});

// CLI Usage
npx ruvector hooks ast-analyze src/api/routes.ts --json
```

**Error Handling:**
- Returns `{ success: false, error: message }` if file not found
- Falls back to regex-based analysis if tree-sitter unavailable

---

#### `hooks_ast_complexity`

Calculates cyclomatic and cognitive complexity metrics for files.

**Input Parameters:**
| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `files` | string[] | Yes | Array of file paths to analyze |
| `threshold` | number | No | Warn if complexity exceeds (default: 10) |

**Return Type:**
```typescript
interface ComplexityResult {
  success: boolean;
  files: Array<{
    file: string;
    complexity: number;
    functions: Array<{
      name: string;
      complexity: number;
      exceeds: boolean;
    }>;
  }>;
  warnings: string[];
  averageComplexity: number;
}
```

**Example Usage:**
```javascript
const result = await mcp.call('hooks_ast_complexity', {
  files: ['src/auth/*.ts'],
  threshold: 15
});
```

---

### Diff Analysis Functions

#### `hooks_diff_analyze`

Analyzes git diff with semantic embeddings and risk scoring.

**Input Parameters:**
| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `commit` | string | No | Commit hash (defaults to staged changes) |

**Return Type:**
```typescript
interface CommitAnalysis {
  hash: string;
  message: string;
  author: string;
  date: string;
  files: DiffAnalysis[];
  totalAdditions: number;
  totalDeletions: number;
  riskScore: number;        // 0.0-1.0 risk assessment
  embedding?: number[];     // Semantic embedding
}

interface DiffAnalysis {
  file: string;
  hunks: DiffHunk[];
  totalAdditions: number;
  totalDeletions: number;
  complexity: number;
  riskScore: number;
  category: 'feature' | 'bugfix' | 'refactor' | 'docs' | 'test' | 'config' | 'unknown';
  embedding?: number[];
}

interface DiffHunk {
  file: string;
  oldStart: number;
  oldLines: number;
  newStart: number;
  newLines: number;
  content: string;
  additions: string[];
  deletions: string[];
}
```

**Example Usage:**
```javascript
// Analyze staged changes
const staged = await mcp.call('hooks_diff_analyze', {});

// Analyze specific commit
const commit = await mcp.call('hooks_diff_analyze', {
  commit: 'abc123'
});

// CLI Usage
npx ruvector hooks diff-analyze --json
npx ruvector hooks diff-analyze abc123 --json
```

**Error Handling:**
- Returns empty analysis if no changes found
- Handles merge commits and binary files gracefully

---

#### `hooks_diff_classify`

Classifies change type based on diff patterns.

**Input Parameters:**
| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `commit` | string | No | Commit hash (defaults to HEAD) |

**Return Type:**
```typescript
interface ClassifyResult {
  success: boolean;
  category: 'feature' | 'bugfix' | 'refactor' | 'docs' | 'test' | 'config' | 'unknown';
  confidence: number;
  indicators: string[];  // Patterns that led to classification
}
```

**Example Usage:**
```javascript
const classification = await mcp.call('hooks_diff_classify', {
  commit: 'HEAD~1'
});
```

---

### Coverage Analysis Functions

#### `hooks_coverage_route`

Gets coverage-aware agent routing for a file.

**Input Parameters:**
| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `file` | string | Yes | File to analyze |

**Return Type:**
```typescript
interface CoverageRouteResult {
  success: boolean;
  file: string;
  route: boolean;          // Whether to route to tester
  reason: string;          // Explanation
  coverage: number;        // Coverage percentage (0-100)
  weights: {
    coder: number;         // Weight for coder agent
    tester: number;        // Weight for tester agent
    reviewer: number;      // Weight for reviewer agent
  };
}
```

**Example Usage:**
```javascript
const routing = await mcp.call('hooks_coverage_route', {
  file: 'src/services/auth.ts'
});

// CLI Usage
npx ruvector hooks coverage-route src/services/auth.ts
```

**Error Handling:**
- Returns default weights if no coverage report found
- Searches common locations: coverage/, .nyc_output/, lcov.info

---

#### `hooks_coverage_suggest`

Suggests tests for files based on coverage data.

**Input Parameters:**
| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `files` | string[] | Yes | Files to analyze |

**Return Type:**
```typescript
interface TestSuggestion {
  file: string;
  testFile: string;           // Suggested test file path
  reason: string;
  priority: 'high' | 'medium' | 'low';
  coverage: number;           // Current coverage %
  uncoveredFunctions: string[];
}

interface SuggestResult {
  success: boolean;
  suggestions: TestSuggestion[];
  overall: {
    lines: number;
    functions: number;
    branches: number;
  };
}
```

**Example Usage:**
```javascript
const suggestions = await mcp.call('hooks_coverage_suggest', {
  files: ['src/api/*.ts', 'src/services/*.ts']
});
```

---

### Graph Analysis Functions

#### `hooks_graph_mincut`

Finds optimal code boundaries using MinCut algorithm (Stoer-Wagner).

**Input Parameters:**
| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `files` | string[] | Yes | Files to analyze for module boundaries |

**Return Type:**
```typescript
interface Partition {
  groups: string[][];    // Two groups of files
  cutWeight: number;     // Weight of edges between groups
  modularity: number;    // Modularity score
}

interface MinCutResult {
  success: boolean;
  partition: Partition;
  bridges: Array<{       // Critical connections
    from: string;
    to: string;
  }>;
  articulationPoints: string[];  // Critical nodes
}
```

**Example Usage:**
```javascript
const boundaries = await mcp.call('hooks_graph_mincut', {
  files: ['src/**/*.ts']
});

// CLI Usage
npx ruvector hooks graph-mincut src/**/*.ts
```

**Error Handling:**
- Requires at least 2 connected files
- Returns empty partition for disconnected graphs

---

#### `hooks_graph_cluster`

Detects code communities using spectral or Louvain clustering.

**Input Parameters:**
| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `files` | string[] | Yes | Files to analyze |
| `method` | string | No | 'spectral' or 'louvain' (default: 'louvain') |
| `clusters` | number | No | Number of clusters for spectral (default: 3) |

**Return Type:**
```typescript
interface ClusterResult {
  success: boolean;
  method: string;
  clusters: Map<string, number>;  // file -> cluster ID
  numClusters: number;
  modularity: number;
  // For spectral method only:
  eigenvalues?: number[];
  coordinates?: Map<string, number[]>;
}
```

**Example Usage:**
```javascript
// Louvain community detection (automatic cluster count)
const louvain = await mcp.call('hooks_graph_cluster', {
  files: ['src/**/*.ts'],
  method: 'louvain'
});

// Spectral clustering (specify cluster count)
const spectral = await mcp.call('hooks_graph_cluster', {
  files: ['src/**/*.ts'],
  method: 'spectral',
  clusters: 5
});

// CLI Usage
npx ruvector hooks graph-cluster src/**/*.ts --method louvain
npx ruvector hooks graph-cluster src/**/*.ts --method spectral --clusters 5
```

---

## Additional MCP Tools

### Memory Functions

| Tool | Description |
|------|-------------|
| `hooks_remember` | Store context in vector memory |
| `hooks_recall` | Search vector memory for relevant context |

### Learning Functions

| Tool | Description |
|------|-------------|
| `hooks_learn` | Combined learning: record experience and get recommendation |
| `hooks_batch_learn` | Record multiple experiences in batch |
| `hooks_learning_config` | Configure learning algorithms (9 algorithms available) |
| `hooks_learning_stats` | Get learning statistics |

### Trajectory Functions

| Tool | Description |
|------|-------------|
| `hooks_trajectory_begin` | Begin tracking execution trajectory |
| `hooks_trajectory_step` | Add step to current trajectory |
| `hooks_trajectory_end` | End trajectory with quality score |

### Security Functions

| Tool | Description |
|------|-------------|
| `hooks_security_scan` | Parallel vulnerability pattern detection |

### Neural Functions

| Tool | Description |
|------|-------------|
| `hooks_attention_info` | Get available attention mechanisms |
| `hooks_gnn_info` | Get GNN layer capabilities |
| `hooks_rag_context` | RAG-enhanced context retrieval |

---

## Programmatic API

### VectorDB

```typescript
import { VectorDb } from 'ruvector';

const db = new VectorDb({
  dimensions: 384,           // Must match embedding model
  maxElements: 10000,
  storagePath: './vectors.db'
});

// Insert
await db.insert({
  id: 'doc1',
  vector: new Float32Array(384),
  metadata: { title: 'Document 1' }
});

// Search
const results = await db.search({
  vector: queryVector,
  k: 5,
  threshold: 0.7
});

// Get
const doc = await db.get('doc1');

// Delete
await db.delete('doc1');
```

### Core Modules

```typescript
// AST Parser
import { getCodeParser } from 'ruvector/dist/core/ast-parser';
const parser = getCodeParser();
await parser.init();
const analysis = await parser.analyze('file.ts');

// Diff Embeddings
import diffEmbeddings from 'ruvector/dist/core/diff-embeddings';
const commit = await diffEmbeddings.analyzeCommit('HEAD');
const similar = await diffEmbeddings.findSimilarCommits(diff, 50, 5);

// Coverage Router
import coverage from 'ruvector/dist/core/coverage-router';
const data = coverage.getFileCoverage('file.ts');
const tests = coverage.suggestTests(['file.ts']);

// Graph Algorithms
import graph from 'ruvector/dist/core/graph-algorithms';
const g = graph.buildGraph(nodes, edges);
const partition = graph.minCut(g);
const clusters = graph.louvainCommunities(g);
```

---

## Performance Characteristics

| Operation | Latency | Notes |
|-----------|---------|-------|
| ONNX inference | ~400ms | Initial embedding |
| HNSW search | ~0.045ms | 8,800x faster than inference |
| Memory cache | ~0.01ms | 40,000x speedup |
| Native Rust | <0.5ms | p50 latency |
| WASM fallback | 10-50ms | Universal compatibility |

---

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `RUVECTOR_INTELLIGENCE_ENABLED` | `true` | Enable/disable intelligence |
| `RUVECTOR_LEARNING_RATE` | `0.1` | Q-learning rate (0.0-1.0) |
| `RUVECTOR_MEMORY_BACKEND` | `rvlite` | Memory storage backend |
| `INTELLIGENCE_MODE` | `treatment` | A/B testing mode |

---

## CLI Commands

```bash
# Initialize hooks
npx ruvector hooks init --pretrain --build-agents quality

# Verify setup
npx ruvector hooks verify
npx ruvector hooks doctor --fix

# Analysis
npx ruvector hooks ast-analyze <file> --json
npx ruvector hooks ast-complexity <files> --threshold 10
npx ruvector hooks diff-analyze [commit] --json
npx ruvector hooks diff-classify [commit]
npx ruvector hooks coverage-route <file>
npx ruvector hooks coverage-suggest <files>
npx ruvector hooks graph-mincut <files>
npx ruvector hooks graph-cluster <files> --method louvain

# Memory
npx ruvector hooks remember "context" -t project
npx ruvector hooks recall "query"
npx ruvector hooks route "task description"

# Stats and export
npx ruvector hooks stats
npx ruvector hooks export -o backup.json
npx ruvector hooks import backup.json --merge
```

---

## Dependencies

- `@modelcontextprotocol/sdk`: ^1.0.0
- `@ruvector/attention`: ^0.1.3
- `@ruvector/core`: ^0.1.25
- `@ruvector/gnn`: ^0.1.22
- `@ruvector/sona`: ^0.1.4
- `@xenova/transformers`: ^2.17.2

---

## Links

- [npm Package](https://www.npmjs.com/package/ruvector)
- [GitHub Repository](https://github.com/ruvnet/ruvector)
- [Hooks Documentation](https://github.com/ruvnet/ruvector/blob/main/npm/packages/ruvector/HOOKS.md)
