# ADR-024: Embeddings MCP Tools

## Status
**Implemented** | 2026-01-12

## Context

Following ADR-023 (ONNX Hyperbolic Embeddings Initialization), the CLI now has a comprehensive `embeddings` command with init, status, and neural subcommands. However, Claude Code and other MCP clients need programmatic access to embedding operations without invoking CLI commands.

### Problem Statement

How do we expose embedding operations through the MCP protocol for:
1. Initializing the embedding subsystem from MCP clients
2. Generating embeddings on-demand
3. Comparing text similarity
4. Semantic search across stored embeddings
5. Neural substrate operations (RuVector)
6. Hyperbolic embedding operations (Poincaré ball)

### Design Principles

Following ADR-005 (MCP-First API Design):
- CLI commands should be thin wrappers around MCP tools
- All business logic lives in MCP tool handlers
- Tools should be stateless and composable

## Decision

Implement 7 MCP tools in `@claude-flow/cli/src/mcp-tools/embeddings-tools.ts`:

### 1. `embeddings/init`
Initialize the ONNX embedding subsystem with hyperbolic support.

```typescript
{
  name: 'embeddings/init',
  inputSchema: {
    type: 'object',
    properties: {
      model: { type: 'string', enum: ['all-MiniLM-L6-v2', 'all-mpnet-base-v2'] },
      hyperbolic: { type: 'boolean', default: true },
      curvature: { type: 'number', default: -1 },
      cacheSize: { type: 'number', default: 256 },
      force: { type: 'boolean', default: false },
    },
  },
}
```

### 2. `embeddings/generate`
Generate embeddings for text (Euclidean or hyperbolic).

```typescript
{
  name: 'embeddings/generate',
  inputSchema: {
    type: 'object',
    properties: {
      text: { type: 'string', required: true },
      hyperbolic: { type: 'boolean', default: false },
      normalize: { type: 'boolean', default: true },
    },
  },
}
```

### 3. `embeddings/compare`
Compare similarity between two texts.

```typescript
{
  name: 'embeddings/compare',
  inputSchema: {
    type: 'object',
    properties: {
      text1: { type: 'string', required: true },
      text2: { type: 'string', required: true },
      metric: { type: 'string', enum: ['cosine', 'euclidean', 'poincare'] },
    },
  },
}
```

### 4. `embeddings/search`
Semantic search across stored embeddings.

```typescript
{
  name: 'embeddings/search',
  inputSchema: {
    type: 'object',
    properties: {
      query: { type: 'string', required: true },
      topK: { type: 'number', default: 5 },
      threshold: { type: 'number', default: 0.5 },
      namespace: { type: 'string' },
    },
  },
}
```

### 5. `embeddings/neural`
Neural substrate operations (RuVector integration).

```typescript
{
  name: 'embeddings/neural',
  inputSchema: {
    type: 'object',
    properties: {
      action: { type: 'string', enum: ['status', 'init', 'drift', 'consolidate', 'adapt'] },
      driftThreshold: { type: 'number', default: 0.3 },
      decayRate: { type: 'number', default: 0.01 },
    },
  },
}
```

Actions:
- `status` - Get neural substrate status
- `init` - Initialize RuVector with SONA, Flash Attention, EWC++
- `drift` - Check semantic drift status
- `consolidate` - Run memory consolidation (hippocampal dynamics)
- `adapt` - Trigger SONA adaptation cycle

### 6. `embeddings/hyperbolic`
Hyperbolic embedding operations (Poincaré ball).

```typescript
{
  name: 'embeddings/hyperbolic',
  inputSchema: {
    type: 'object',
    properties: {
      action: { type: 'string', enum: ['status', 'convert', 'distance', 'midpoint'] },
      embedding: { type: 'array', items: { type: 'number' } },
      embedding1: { type: 'array', items: { type: 'number' } },
      embedding2: { type: 'array', items: { type: 'number' } },
    },
  },
}
```

Actions:
- `status` - Get hyperbolic configuration
- `convert` - Convert Euclidean embedding to Poincaré ball
- `distance` - Calculate hyperbolic distance between two points
- `midpoint` - Calculate hyperbolic midpoint

### 7. `embeddings/status`
Get embeddings system status and configuration.

```typescript
{
  name: 'embeddings/status',
  inputSchema: { type: 'object', properties: {} },
}
```

## Implementation Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                   Embeddings MCP Tools                       │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  ┌────────────────┐    ┌────────────────┐    ┌───────────┐ │
│  │ embeddings/    │    │ embeddings/    │    │embeddings/│ │
│  │ init           │    │ generate       │    │ compare   │ │
│  └───────┬────────┘    └───────┬────────┘    └─────┬─────┘ │
│          │                     │                    │       │
│          ▼                     ▼                    ▼       │
│  ┌─────────────────────────────────────────────────────────┐│
│  │               Configuration Layer                        ││
│  │    .claude-flow/embeddings.json (persistent config)      ││
│  └─────────────────────────────────────────────────────────┘│
│                          │                                   │
│          ┌───────────────┼───────────────┐                  │
│          ▼               ▼               ▼                  │
│  ┌──────────────┐ ┌──────────────┐ ┌──────────────┐        │
│  │ Embedding    │ │ Hyperbolic   │ │ Neural       │        │
│  │ Generation   │ │ Projection   │ │ Substrate    │        │
│  │ (mock/ONNX)  │ │ (Poincaré)   │ │ (RuVector)   │        │
│  └──────────────┘ └──────────────┘ └──────────────┘        │
│                                                              │
│  ┌────────────────┐    ┌────────────────┐    ┌───────────┐ │
│  │ embeddings/    │    │ embeddings/    │    │embeddings/│ │
│  │ search         │    │ neural         │    │hyperbolic │ │
│  └────────────────┘    └────────────────┘    └───────────┘ │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

## Mathematical Functions

### Poincaré Ball Operations

**Exponential Map (Euclidean → Poincaré):**
```
exp_0(v) = tanh(√c · ||v|| / 2) · v / (√c · ||v||)
```

**Poincaré Distance:**
```
d(x, y) = (1/√c) · arcosh(1 + 2c · ||x-y||² / ((1-c||x||²)(1-c||y||²)))
```

**Hyperbolic Midpoint (simplified):**
```
m(x, y) = scale · (x + y) / 2
where scale ensures ||m|| < maxNorm
```

## Configuration

Tools store configuration in `.claude-flow/embeddings.json`:

```json
{
  "model": "all-MiniLM-L6-v2",
  "modelPath": ".claude-flow/models",
  "dimension": 384,
  "cacheSize": 256,
  "hyperbolic": {
    "enabled": true,
    "curvature": -1,
    "epsilon": 1e-15,
    "maxNorm": 0.99999
  },
  "neural": {
    "enabled": true,
    "driftThreshold": 0.3,
    "decayRate": 0.01,
    "ruvector": {
      "enabled": true,
      "sona": true,
      "flashAttention": true,
      "ewcPlusPlus": true
    },
    "features": {
      "semanticDrift": true,
      "memoryPhysics": true,
      "stateMachine": true,
      "swarmCoordination": true,
      "coherenceMonitor": true
    }
  },
  "initialized": "2026-01-12T18:30:00.000Z"
}
```

## Tool Registration

Tools are registered in `mcp-client.ts`:

```typescript
import { embeddingsTools } from './mcp-tools/embeddings-tools.js';

registerTools([
  // ... existing tools
  ...embeddingsTools,
]);
```

And exported from `mcp-tools/index.ts`:

```typescript
export { embeddingsTools } from './embeddings-tools.js';
```

## Usage Examples

### Initialize Embeddings via MCP
```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "tools/call",
  "params": {
    "name": "embeddings/init",
    "arguments": {
      "model": "all-MiniLM-L6-v2",
      "hyperbolic": true,
      "curvature": -1
    }
  }
}
```

### Generate Embedding
```json
{
  "jsonrpc": "2.0",
  "id": 2,
  "method": "tools/call",
  "params": {
    "name": "embeddings/generate",
    "arguments": {
      "text": "async function processData()",
      "hyperbolic": true
    }
  }
}
```

### Compare Texts
```json
{
  "jsonrpc": "2.0",
  "id": 3,
  "method": "tools/call",
  "params": {
    "name": "embeddings/compare",
    "arguments": {
      "text1": "authentication middleware",
      "text2": "auth guard handler",
      "metric": "cosine"
    }
  }
}
```

### Check Neural Status
```json
{
  "jsonrpc": "2.0",
  "id": 4,
  "method": "tools/call",
  "params": {
    "name": "embeddings/neural",
    "arguments": { "action": "status" }
  }
}
```

## Consequences

### Positive
- **MCP-first design**: Embeddings accessible to all MCP clients
- **Consistent API**: Same tools for CLI and programmatic access
- **Full feature coverage**: Init, generate, compare, search, neural, hyperbolic
- **RuVector integration**: SONA, Flash Attention, EWC++ available via MCP
- **Stateless tools**: Configuration persisted to disk

### Negative
- **Additional complexity**: 7 new tools to maintain
- **Mock implementation**: Full ONNX runtime not yet integrated

### Neutral
- Follows existing MCP tool patterns
- Uses standard JSON configuration
- Adds `embeddings` category to tool list

## Related ADRs

- ADR-005: MCP-First API Design
- ADR-006: Unified Memory Service
- ADR-017: RuVector Integration
- ADR-023: ONNX Hyperbolic Embeddings Initialization

## References

- MCP Protocol Specification
- Poincaré Embeddings (Nickel & Kiela, 2017)
- ONNX Runtime documentation
