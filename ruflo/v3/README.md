# Claude Flow V3

> **Modular AI Agent Coordination System** - A complete reimagining of Claude-Flow with 15-agent hierarchical mesh swarm coordination.

[![Version](https://img.shields.io/badge/version-3.0.0--alpha.1-blue.svg)](https://github.com/ruvnet/claude-flow)
[![Node.js](https://img.shields.io/badge/node-%3E%3D20.0.0-green.svg)](https://nodejs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.3+-blue.svg)](https://www.typescriptlang.org/)
[![License](https://img.shields.io/badge/license-MIT-purple.svg)](../LICENSE)

## Introduction

Claude Flow V3 is a next-generation AI agent coordination system built on 10 Architecture Decision Records (ADRs). It provides a modular, security-first, high-performance platform for orchestrating multi-agent swarms with hierarchical mesh topology.

V3 represents a complete architectural overhaul:
- **10x faster testing** with Vitest
- **150x-12,500x faster search** with HNSW indexing
- **2.49x-7.47x Flash Attention speedup**
- **50-75% memory reduction**

## Features

### Core Capabilities

- **15-Agent Hierarchical Mesh** - Queen-led coordination with specialized worker agents
- **Domain-Driven Design** - Clean bounded contexts with separation of concerns
- **Plugin Architecture** - Microkernel pattern for extensibility
- **MCP-First API** - Consistent interfaces across all modules
- **Event Sourcing** - Full audit trail for state changes
- **Hybrid Memory Backend** - SQLite + AgentDB for optimal performance

### Security

- **CVE Remediation** - All known vulnerabilities addressed
- **Input Validation** - Zod-based schema validation
- **Secure ID Generation** - Cryptographic random IDs
- **Path Security** - Traversal protection
- **SQL Injection Prevention** - Parameterized queries

### Performance

| Metric | Target | Achieved |
|--------|--------|----------|
| Event Bus (100k events) | <50ms | ~6ms |
| Map Lookup (100k gets) | <20ms | ~16ms |
| Array.find vs Map O(1) | N/A | 978x speedup |
| Flash Attention | 2.49x-7.47x | Validated |
| AgentDB Search | 150x-12,500x | HNSW indexed |

## Architecture

### Architecture Decision Records (ADRs)

| ADR | Decision |
|-----|----------|
| ADR-001 | Adopt agentic-flow as core foundation |
| ADR-002 | Domain-Driven Design structure |
| ADR-003 | Single coordination engine (UnifiedSwarmCoordinator) |
| ADR-004 | Plugin-based architecture (microkernel) |
| ADR-005 | MCP-first API design |
| ADR-006 | Unified memory service (AgentDB) |
| ADR-007 | Event sourcing for state changes |
| ADR-008 | Vitest over Jest (10x faster) |
| ADR-009 | Hybrid memory backend default |
| ADR-010 | Remove Deno support (Node.js 20+ only) |

### Module Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                     @claude-flow/v3-monorepo                    │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐          │
│  │   security   │  │    memory    │  │    swarm     │          │
│  │  CVE fixes   │  │   AgentDB    │  │ 15-agent     │          │
│  │  validation  │  │   HNSW       │  │ coordination │          │
│  └──────────────┘  └──────────────┘  └──────────────┘          │
│                                                                 │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐          │
│  │ integration  │  │  performance │  │    neural    │          │
│  │ agentic-flow │  │ Flash Attn   │  │   SONA       │          │
│  │  bridge      │  │ benchmarks   │  │  learning    │          │
│  └──────────────┘  └──────────────┘  └──────────────┘          │
│                                                                 │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐          │
│  │     cli      │  │   testing    │  │  deployment  │          │
│  │  commands    │  │ TDD London   │  │   release    │          │
│  │  prompts     │  │   School     │  │    CI/CD     │          │
│  └──────────────┘  └──────────────┘  └──────────────┘          │
│                                                                 │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │                       shared                             │   │
│  │  types • events • core • hooks • resilience • plugins   │   │
│  └─────────────────────────────────────────────────────────┘   │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

## Directory Structure

```
v3/
├── @claude-flow/                    # Modular packages
│   ├── security/                    # Security module
│   │   └── src/
│   │       ├── index.ts             # Password hashing, validators
│   │       └── ...
│   │
│   ├── memory/                      # Memory module
│   │   ├── src/
│   │   │   ├── agentdb-backend.ts   # AgentDB integration
│   │   │   ├── hnsw-index.ts        # HNSW vector indexing
│   │   │   ├── hybrid-backend.ts    # SQLite + AgentDB
│   │   │   ├── sqlite-backend.ts    # SQLite backend
│   │   │   ├── cache-manager.ts     # Caching layer
│   │   │   └── domain/              # DDD entities
│   │   ├── benchmarks/              # Performance benchmarks
│   │   └── examples/                # Usage examples
│   │
│   ├── swarm/                       # Swarm coordination
│   │   └── src/
│   │       ├── unified-coordinator.ts  # Main coordinator
│   │       ├── topology-manager.ts     # Topology management
│   │       ├── consensus/              # Consensus protocols
│   │       └── domain/                 # DDD entities
│   │
│   ├── integration/                 # agentic-flow integration
│   │   └── src/
│   │       ├── agentic-flow-bridge.ts  # Core bridge
│   │       ├── agent-adapter.ts        # Agent adaptation
│   │       └── sona-adapter.ts         # SONA learning
│   │
│   ├── performance/                 # Performance module
│   │   ├── src/
│   │   │   └── framework/           # Benchmark framework
│   │   └── benchmarks/
│   │       ├── startup/             # Startup benchmarks
│   │       └── attention/           # Flash Attention
│   │
│   ├── neural/                      # Neural/SONA module
│   │   └── src/
│   │       ├── algorithms/          # Learning algorithms
│   │       └── modes/               # Neural modes
│   │
│   ├── cli/                         # CLI module
│   │   ├── bin/                     # Executable
│   │   └── src/
│   │       └── commands/            # Command handlers
│   │
│   ├── testing/                     # Testing framework
│   │   └── src/
│   │       ├── fixtures/            # Test fixtures
│   │       ├── mocks/               # Mock services
│   │       ├── helpers/             # Test helpers
│   │       └── regression/          # Regression tests
│   │
│   ├── shared/                      # Shared utilities
│   │   └── src/
│   │       ├── types/               # Shared types
│   │       ├── events/              # Event system
│   │       ├── core/                # Core interfaces
│   │       ├── hooks/               # Hook system
│   │       ├── resilience/          # Retry, circuit breaker
│   │       ├── plugins/             # Plugin system
│   │       └── security/            # Security utilities
│   │
│   └── deployment/                  # Deployment module
│       └── src/                     # Release management
│
├── mcp/                             # MCP Server
│   ├── server.ts                    # Main server
│   ├── tools/                       # MCP tools
│   │   ├── agent-tools.ts
│   │   ├── swarm-tools.ts
│   │   ├── memory-tools.ts
│   │   └── hooks-tools.ts
│   └── transport/                   # Transport layers
│       ├── stdio.ts
│       ├── http.ts
│       └── websocket.ts
│
├── __tests__/                       # Integration tests
│   └── integration/
│       ├── memory-integration.test.ts
│       ├── swarm-integration.test.ts
│       ├── mcp-integration.test.ts
│       └── workflow-integration.test.ts
│
├── docs/                            # Documentation
│   ├── README.md                    # Docs overview
│   ├── guides/                      # User guides
│   └── implementation/              # Implementation details
│
├── helpers/                         # Cross-platform helpers
│   ├── claude-flow-v3.sh            # Master helper (Linux/macOS)
│   ├── claude-flow-v3.ps1           # Master helper (Windows)
│   └── templates/                   # Helper templates
│
├── scripts/                         # Utility scripts
│   └── quick-benchmark.mjs          # Quick perf test
│
├── index.ts                         # Main entry point
├── swarm.config.ts                  # Swarm configuration
├── vitest.config.ts                 # Test configuration
└── package.json                     # Monorepo package
```

## Modules

### @claude-flow/security
Security-first implementation with CVE fixes, input validation, and credential management.

```typescript
import { PasswordHasher, validateInput, sanitizePath } from '@claude-flow/security';

const hasher = new PasswordHasher();
const hash = await hasher.hash('password');
const valid = await hasher.verify('password', hash);
```

### @claude-flow/memory
Unified memory service with AgentDB, HNSW indexing, and 150x-12,500x faster search.

```typescript
import { HybridMemoryRepository, HNSWIndex } from '@claude-flow/memory';

const memory = new HybridMemoryRepository({
  backend: 'agentdb',
  vectorSearch: true
});

await memory.store({ key: 'knowledge', value: 'context', embedding: [...] });
const results = await memory.search({ query: 'knowledge', limit: 10 });
```

### @claude-flow/swarm
15-agent hierarchical mesh coordination with consensus protocols.

```typescript
import { UnifiedSwarmCoordinator } from '@claude-flow/swarm';

const coordinator = new UnifiedSwarmCoordinator({
  topology: 'hierarchical-mesh',
  maxAgents: 15
});

await coordinator.initialize();
await coordinator.spawnAgent({ type: 'queen-coordinator' });
```

### @claude-flow/integration
Deep integration with agentic-flow@alpha per ADR-001.

```typescript
import { AgenticFlowBridge } from '@claude-flow/integration';

const bridge = new AgenticFlowBridge();
await bridge.initialize();
const agent = await bridge.createAgent({ type: 'coder' });
```

### @claude-flow/performance
Benchmarking framework with Flash Attention validation.

```typescript
import { BenchmarkRunner, formatTime } from '@claude-flow/performance';

const runner = new BenchmarkRunner();
const result = await runner.run('map-lookup', () => map.get(key), {
  iterations: 100000,
  targetTime: 20
});
```

### @claude-flow/neural
SONA learning integration for self-optimizing agents.

```typescript
import { SONAAdapter } from '@claude-flow/neural';

const sona = new SONAAdapter();
await sona.train({ patterns: learningData });
const prediction = await sona.predict(context);
```

### @claude-flow/cli
Modern CLI with interactive prompts and formatted output.

```bash
npx @claude-flow/cli swarm init --topology hierarchical-mesh
npx @claude-flow/cli agent spawn --type queen-coordinator
npx @claude-flow/cli memory search "knowledge"
```

### @claude-flow/testing
TDD London School framework with mocks, fixtures, and regression testing.

```typescript
import { createMockAgent, createTestFixture } from '@claude-flow/testing';

const mockAgent = createMockAgent({ type: 'coder' });
const fixture = createTestFixture('swarm-coordination');
```

### @claude-flow/shared
Common types, events, utilities, and core interfaces.

```typescript
import { EventBus, Result, success, failure } from '@claude-flow/shared';
import type { AgentId, TaskStatus } from '@claude-flow/shared/types';
```

### @claude-flow/deployment
Release management and CI/CD automation.

```typescript
import { ReleaseManager } from '@claude-flow/deployment';

const release = new ReleaseManager();
await release.prepare({ version: '3.0.0', changelog: '...' });
```

## Usage

### Quick Start

```typescript
import { initializeV3Swarm } from '@claude-flow/v3';

// Initialize the swarm
const swarm = await initializeV3Swarm();

// Spawn agents
await swarm.spawnAllAgents();

// Submit a task
const task = swarm.submitTask({
  type: 'implementation',
  title: 'Implement feature X',
  description: 'Detailed description...',
  domain: 'core',
  phase: 'phase-2-core',
  priority: 'high'
});

// Wait for completion
const result = await swarm.waitForTask(task.id);
```

### Import Specific Modules

```typescript
// Import everything
import * as claudeFlow from '@claude-flow/v3';

// Or import specific modules for tree-shaking
import { UnifiedSwarmCoordinator } from '@claude-flow/swarm';
import { PasswordHasher } from '@claude-flow/security';
import { HNSWIndex } from '@claude-flow/memory';
```

### MCP Server

```typescript
import { createMCPServer } from '@claude-flow/v3/mcp';

const server = createMCPServer({
  transport: 'stdio',
  tools: ['agent', 'swarm', 'memory', 'hooks']
});

await server.start();
```

## Helper System

Cross-platform automation for V3 development:

```bash
# Linux/macOS
./helpers/claude-flow-v3.sh init
./helpers/claude-flow-v3.sh status
./helpers/claude-flow-v3.sh update domain 3

# Windows (PowerShell)
.\helpers\claude-flow-v3.ps1 init
.\helpers\claude-flow-v3.ps1 status
.\helpers\claude-flow-v3.ps1 update domain 3
```

Features:
- **Progress Tracking**: Real-time domain/agent/performance metrics
- **Checkpointing**: Auto-commit with development milestones
- **Validation**: Environment and configuration verification
- **GitHub Integration**: PR management and issue tracking

## Installation

```bash
# Clone the repository
git clone https://github.com/ruvnet/claude-flow.git
cd claude-flow/v3

# Install dependencies
pnpm install

# Build all modules
pnpm build
```

## Testing

```bash
# Run all tests
pnpm test

# Run integration tests
pnpm test:integration

# Run specific module tests
pnpm test:memory
pnpm test:swarm
pnpm test:security

# Run benchmarks
pnpm bench

# Quick benchmark (no dependencies)
node scripts/quick-benchmark.mjs

# Coverage report
pnpm test:coverage
```

## Performance Targets

| Category | Metric | Target |
|----------|--------|--------|
| **Search** | AgentDB HNSW | 150x-12,500x faster |
| **Attention** | Flash Attention | 2.49x-7.47x speedup |
| **Memory** | Reduction | 50-75% |
| **Code** | Total lines | <5,000 |
| **Startup** | Cold start | <500ms |
| **Learning** | SONA adaptation | <0.05ms |

## Links

### Documentation
- [Docs Overview](./docs/README.md)
- [Implementation Details](./docs/implementation/)
- [User Guides](./docs/guides/)
- [Helper System](./helpers/README.md)

### Modules
- [@claude-flow/security](./@claude-flow/security/)
- [@claude-flow/memory](./@claude-flow/memory/)
- [@claude-flow/swarm](./@claude-flow/swarm/)
- [@claude-flow/integration](./@claude-flow/integration/)
- [@claude-flow/performance](./@claude-flow/performance/)
- [@claude-flow/neural](./@claude-flow/neural/)
- [@claude-flow/cli](./@claude-flow/cli/)
- [@claude-flow/testing](./@claude-flow/testing/)
- [@claude-flow/shared](./@claude-flow/shared/)
- [@claude-flow/deployment](./@claude-flow/deployment/)

### Examples
- [AgentDB Example](./@claude-flow/memory/examples/agentdb-example.ts)
- [Cross-Platform Usage](./@claude-flow/memory/examples/cross-platform-usage.ts)

### MCP Tools
- [Agent Tools](./mcp/tools/agent-tools.ts)
- [Swarm Tools](./mcp/tools/swarm-tools.ts)
- [Memory Tools](./mcp/tools/memory-tools.ts)
- [Hooks Tools](./mcp/tools/hooks-tools.ts)

### External
- [GitHub Repository](https://github.com/ruvnet/claude-flow)
- [agentic-flow Integration](https://github.com/ruvnet/agentic-flow)
- [AgentDB](https://github.com/ruvnet/agentdb)

## Requirements

- **Node.js**: >=20.0.0
- **pnpm**: >=8.0.0
- **TypeScript**: >=5.3.0

## License

MIT License - See [LICENSE](../LICENSE) for details.

---

**Built with the SPARC methodology and 15-agent hierarchical mesh coordination.**
