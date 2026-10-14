# Quality Engineering Integration Points

> **Retired (2026-10-09):** the in-repo `v3/plugins/agentic-qe` implementation described here was removed; it never wrapped the real `agentic-qe` package. This document is kept for history. Use the maintained [`agentic-qe`](https://www.npmjs.com/package/agentic-qe) npm package or its Claude Code plugin `agentic-qe-fleet` ([proffesor-for-testing/agentic-qe](https://github.com/proffesor-for-testing/agentic-qe)).

## Overview

This document describes how the Quality Engineering (agentic-qe) plugin integrates with Claude Flow V3's existing domains: Security, Core, Memory, Integration, and Coordination.

## Integration Architecture

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                              Integration Layer                                   │
├─────────────────────────────────────────────────────────────────────────────────┤
│                                                                                  │
│   ┌─────────────────────────────────────────────────────────────────────────┐   │
│   │                    Anti-Corruption Layer (ACL)                           │   │
│   │   Translates between agentic-qe and claude-flow V3 domains              │   │
│   └─────────────────────────────────────────────────────────────────────────┘   │
│                                        │                                         │
│     ┌──────────────┬──────────────────┼──────────────────┬──────────────┐       │
│     │              │                  │                  │              │       │
│     ▼              ▼                  ▼                  ▼              ▼       │
│  ┌──────┐    ┌──────────┐      ┌──────────┐      ┌────────────┐   ┌─────────┐  │
│  │Memory│    │ Security │      │   Core   │      │Coordination│   │ MCP     │  │
│  │Bridge│    │  Bridge  │      │  Bridge  │      │   Bridge   │   │ Bridge  │  │
│  └──────┘    └──────────┘      └──────────┘      └────────────┘   └─────────┘  │
│     │              │                  │                  │              │       │
│     │              │                  │                  │              │       │
└─────┼──────────────┼──────────────────┼──────────────────┼──────────────┼───────┘
      │              │                  │                  │              │
      ▼              ▼                  ▼                  ▼              ▼
┌──────────┐  ┌──────────┐      ┌──────────┐      ┌────────────┐   ┌─────────┐
│@claude-  │  │@claude-  │      │@claude-  │      │@claude-    │   │@claude- │
│flow/     │  │flow/     │      │flow/     │      │flow/       │   │flow/    │
│memory    │  │security  │      │core      │      │coordination│   │mcp      │
└──────────┘  └──────────┘      └──────────┘      └────────────┘   └─────────┘
```

## Domain Integration Details

### 1. Memory Domain Integration

**Integration Type**: Shared Kernel

The QE domain shares the Memory domain's infrastructure for vector storage, HNSW indexing, and pattern retrieval.

#### Shared Components

| V3 Component | QE Usage | Namespace |
|--------------|----------|-----------|
| AgentDB Adapter | Test pattern storage | `aqe/v3/test-patterns` |
| HNSW Index | Coverage gap search | `aqe/v3/coverage-data` |
| Embeddings Service | Code semantic search | `aqe/v3/code-knowledge` |
| ReasoningBank | Learning trajectories | `aqe/v3/learning-trajectories` |

#### Memory Bridge Implementation

```typescript
// v3/plugins/agentic-qe/src/infrastructure/memory-bridge.ts

import type { IMemoryService, MemoryEntry } from '@claude-flow/memory';
import type { EmbeddingsService } from '@claude-flow/embeddings';

export class QEMemoryBridge {
  constructor(
    private memory: IMemoryService,
    private embeddings: EmbeddingsService
  ) {}

  /**
   * Store test pattern with semantic embedding
   */
  async storeTestPattern(pattern: TestPattern): Promise<string> {
    // Generate embedding using V3 embeddings service
    const embedding = await this.embeddings.generate(
      `${pattern.type} ${pattern.description} ${pattern.code}`
    );

    // Store in shared memory with QE namespace
    return this.memory.store({
      namespace: 'aqe/v3/test-patterns',
      content: JSON.stringify(pattern),
      embedding,
      metadata: {
        type: pattern.type,
        language: pattern.language,
        framework: pattern.framework,
        effectiveness: pattern.effectiveness
      },
      type: 'semantic'
    });
  }

  /**
   * Search for similar patterns using HNSW (150x faster)
   */
  async searchSimilarPatterns(
    query: string,
    k: number = 10,
    filters?: PatternFilters
  ): Promise<TestPattern[]> {
    const embedding = await this.embeddings.generate(query);

    const results = await this.memory.searchSemantic(embedding, k, {
      namespace: 'aqe/v3/test-patterns',
      filters: filters ? this.toMemoryFilters(filters) : undefined
    });

    return results.map(r => JSON.parse(r.content) as TestPattern);
  }

  /**
   * Store coverage gap with risk embedding
   */
  async storeCoverageGap(gap: CoverageGap): Promise<string> {
    const embedding = await this.embeddings.generate(
      `coverage gap ${gap.file} ${gap.type} ${gap.location}`
    );

    return this.memory.store({
      namespace: 'aqe/v3/coverage-data',
      content: JSON.stringify(gap),
      embedding,
      metadata: {
        file: gap.file,
        type: gap.type,
        riskScore: gap.riskScore,
        priority: gap.priority
      },
      type: 'episodic',
      ttl: 86400000 // 24h TTL for coverage data
    });
  }

  /**
   * Store learning trajectory for ReasoningBank
   */
  async storeTrajectory(trajectory: LearningTrajectory): Promise<string> {
    const embedding = await this.embeddings.generate(
      trajectory.steps.map(s => s.action).join(' ')
    );

    return this.memory.store({
      namespace: 'aqe/v3/learning-trajectories',
      content: JSON.stringify(trajectory),
      embedding,
      metadata: {
        taskType: trajectory.taskType,
        agentId: trajectory.agentId,
        success: trajectory.success,
        reward: trajectory.reward
      },
      type: 'procedural'
    });
  }

  private toMemoryFilters(filters: PatternFilters): Record<string, unknown> {
    const memoryFilters: Record<string, unknown> = {};
    if (filters.type) memoryFilters['type'] = filters.type;
    if (filters.language) memoryFilters['language'] = filters.language;
    if (filters.framework) memoryFilters['framework'] = filters.framework;
    if (filters.minEffectiveness) {
      memoryFilters['effectiveness'] = { $gte: filters.minEffectiveness };
    }
    return memoryFilters;
  }
}
```

#### Embedding Reuse

The QE domain reuses V3's `@claude-flow/embeddings` service instead of running separate `@xenova/transformers` instances:

```typescript
// Embedding generation delegation
async function generateQEEmbedding(text: string): Promise<Float32Array> {
  const v3Embeddings = await context.get<EmbeddingsService>('embeddings');

  // Use V3's ONNX-based embedding generation (75x faster)
  return v3Embeddings.generate(text, {
    normalize: true,
    hyperbolic: false // Use Euclidean for QE patterns
  });
}
```

### 2. Security Domain Integration

**Integration Type**: Conformist

The QE security-compliance context adapts to V3's security module patterns and uses its primitives.

#### Security Compliance Mapping

| QE Security Feature | V3 Security Component | Integration |
|---------------------|----------------------|-------------|
| SAST Scanner | PathValidator | Validate scan targets |
| DAST Scanner | SafeExecutor | Execute probes safely |
| Audit Trail | TokenGenerator | Sign audit entries |
| PII Detection | InputValidator | Reuse validation schemas |
| Secret Scanning | CredentialGenerator | Pattern matching |

#### Security Bridge Implementation

```typescript
// v3/plugins/agentic-qe/src/infrastructure/security-bridge.ts

import type { SecurityModule } from '@claude-flow/security';

export class QESecurityBridge {
  constructor(private security: SecurityModule) {}

  /**
   * Validate file path before security scan (prevents traversal)
   */
  async validateScanTarget(path: string): Promise<ValidatedPath> {
    const result = await this.security.pathValidator.validate(path, {
      allowedPrefixes: [process.cwd()],
      allowSymlinks: false,
      resolveRealPath: true
    });

    if (!result.valid) {
      throw new QESecurityError(`Invalid scan target: ${result.error}`);
    }

    return { path: result.resolvedPath, valid: true };
  }

  /**
   * Execute DAST probe with security constraints
   */
  async executeDAST(
    target: string,
    probes: DASTPprobe[]
  ): Promise<DASTResult[]> {
    // Use V3 SafeExecutor for controlled execution
    return this.security.safeExecutor.execute(
      'node',
      ['--input-type=module', '-e', this.generateProbeScript(probes)],
      {
        timeout: 30000,
        cwd: process.cwd(),
        allowedPaths: [target],
        networkPolicy: 'local-only' // Restrict to localhost
      }
    );
  }

  /**
   * Generate signed audit entry
   */
  async createAuditEntry(event: AuditEvent): Promise<SignedAuditEntry> {
    const entry: AuditEntry = {
      id: crypto.randomUUID(),
      event,
      timestamp: Date.now(),
      actor: event.actor
    };

    // Sign with V3 token generator
    const signature = this.security.tokenGenerator.sign(
      JSON.stringify(entry),
      { algorithm: 'HS256' }
    );

    return {
      ...entry,
      signature,
      verifiable: true
    };
  }

  /**
   * Detect PII using V3 input validator patterns
   */
  async detectPII(content: string): Promise<PIIDetection[]> {
    const patterns = this.security.inputValidator.getPIIPatterns();
    const detections: PIIDetection[] = [];

    for (const [type, pattern] of Object.entries(patterns)) {
      const matches = content.matchAll(pattern);
      for (const match of matches) {
        detections.push({
          type: type as PIIType,
          location: { start: match.index!, end: match.index! + match[0].length },
          confidence: 0.95
        });
      }
    }

    return detections;
  }

  private generateProbeScript(probes: DASTPprobe[]): string {
    // Generate safe probe execution script
    return `/* DAST probe script */`;
  }
}
```

### 3. Core Domain Integration

**Integration Type**: Customer-Supplier

QE acts as a customer of V3 Core services, generating tests that Core executes.

#### Core Service Usage

| QE Feature | V3 Core Service | Interaction |
|------------|-----------------|-------------|
| Test Generation | Agent Spawning | QE generates, Core spawns executors |
| Test Execution | Task Orchestration | Core orchestrates test runs |
| Coverage Collection | Process Management | Core manages coverage processes |
| Quality Gates | Workflow Engine | Core enforces gates |

#### Core Bridge Implementation

```typescript
// v3/plugins/agentic-qe/src/infrastructure/core-bridge.ts

import type { AgentService, TaskService, WorkflowService } from '@claude-flow/core';

export class QECoreBridge {
  constructor(
    private agents: AgentService,
    private tasks: TaskService,
    private workflows: WorkflowService
  ) {}

  /**
   * Spawn test execution agents via V3 Core
   */
  async spawnTestExecutor(
    testSuite: TestSuite,
    config: ExecutorConfig
  ): Promise<AgentHandle> {
    return this.agents.spawn({
      type: 'qe-test-executor',
      name: `test-executor-${testSuite.id}`,
      capabilities: ['test-execution', testSuite.framework],
      config: {
        testSuiteId: testSuite.id,
        parallel: config.parallel,
        maxWorkers: config.maxWorkers,
        retryCount: config.retryCount
      }
    });
  }

  /**
   * Create test execution task via V3 Task Service
   */
  async createTestTask(
    testSuite: TestSuite,
    priority: Priority
  ): Promise<TaskHandle> {
    return this.tasks.create({
      type: 'test-execution',
      description: `Execute test suite: ${testSuite.name}`,
      priority,
      payload: {
        testSuiteId: testSuite.id,
        testCount: testSuite.testCases.length
      },
      timeout: testSuite.estimatedDuration * 2 // 2x safety margin
    });
  }

  /**
   * Execute quality gate workflow
   */
  async executeQualityGateWorkflow(
    gates: QualityGate[],
    metrics: QualityMetrics
  ): Promise<WorkflowResult> {
    return this.workflows.execute({
      name: 'quality-gate-evaluation',
      steps: gates.map(gate => ({
        name: `gate-${gate.id}`,
        type: 'condition',
        config: {
          criteria: gate.criteria,
          metrics
        }
      })),
      failFast: true
    });
  }
}
```

### 4. Coordination Domain Integration

**Integration Type**: Shared Kernel

QE's Queen Coordinator integrates with V3's Hive Mind for swarm coordination.

#### Coordination Mapping

| QE Coordinator | V3 Hive Mind | Integration |
|----------------|--------------|-------------|
| Queen | Queen Role | QE Queen joins as specialized queen |
| Worker Agents | Worker Role | QE agents join as workers |
| Byzantine Tolerance | Consensus Module | Shared BFT implementation |
| Task Distribution | Broadcast | Message passing |
| Shared State | Memory | Coordination state |

#### Hive Mind Bridge Implementation

```typescript
// v3/plugins/agentic-qe/src/infrastructure/hive-bridge.ts

import type { HiveMindService, ConsensusResult } from '@claude-flow/coordination';

export class QEHiveBridge {
  private queenId: string;

  constructor(private hiveMind: HiveMindService) {
    this.queenId = `aqe-queen-${Date.now()}`;
  }

  /**
   * Register QE Queen with Hive Mind
   */
  async registerQueen(): Promise<void> {
    await this.hiveMind.join({
      agentId: this.queenId,
      role: 'queen',
      capabilities: [
        'qe-coordination',
        'test-orchestration',
        'coverage-analysis',
        'quality-gate-enforcement'
      ],
      metadata: {
        source: 'agentic-qe',
        version: '3.2.3'
      }
    });
  }

  /**
   * Spawn QE worker and join to hive
   */
  async spawnQEWorker(
    agentType: string,
    context: string
  ): Promise<string> {
    const workerId = `aqe-${agentType}-${Date.now()}`;

    await this.hiveMind.join({
      agentId: workerId,
      role: 'worker',
      capabilities: [agentType, `context:${context}`],
      metadata: {
        parentQueen: this.queenId,
        qeContext: context
      }
    });

    return workerId;
  }

  /**
   * Propose QE task allocation via consensus
   */
  async proposeTaskAllocation(
    task: QETask,
    requiredAgents: string[]
  ): Promise<ConsensusResult> {
    return this.hiveMind.consensus({
      action: 'propose',
      type: 'qe-task-allocation',
      value: {
        taskId: task.id,
        taskType: task.type,
        requiredAgents,
        priority: task.priority
      }
    });
  }

  /**
   * Broadcast QE results to hive
   */
  async broadcastResult(
    taskId: string,
    result: QEResult
  ): Promise<void> {
    await this.hiveMind.broadcast({
      message: JSON.stringify({
        type: 'qe-result',
        taskId,
        result
      }),
      priority: result.critical ? 'critical' : 'normal',
      fromId: this.queenId
    });
  }

  /**
   * Store QE state in hive memory
   */
  async storeQEState(key: string, value: unknown): Promise<void> {
    await this.hiveMind.memory({
      action: 'set',
      key: `qe:${key}`,
      value: JSON.stringify(value)
    });
  }

  /**
   * Retrieve QE state from hive memory
   */
  async getQEState<T>(key: string): Promise<T | null> {
    const result = await this.hiveMind.memory({
      action: 'get',
      key: `qe:${key}`
    });

    return result.value ? JSON.parse(result.value) : null;
  }
}
```

### 5. MCP Server Integration

**Integration Type**: Published Language

QE tools are registered with V3's MCP server using the standard tool definition format.

#### MCP Tool Categories

| Category | Tool Count | Description |
|----------|------------|-------------|
| test-generation | 8 | Test creation tools |
| coverage-analysis | 4 | Coverage analysis tools |
| security-compliance | 4 | Security scanning tools |
| quality-assessment | 3 | Quality gate tools |
| defect-intelligence | 3 | Defect prediction tools |
| contract-testing | 3 | Contract validation tools |
| chaos-resilience | 4 | Chaos engineering tools |
| visual-accessibility | 3 | Visual/a11y testing tools |
| **Total** | **32** | - |

#### MCP Registration

```typescript
// v3/plugins/agentic-qe/src/mcp-tools/registration.ts

import type { MCPServer, ToolDefinition } from '@claude-flow/mcp';
import { mcpTools } from './index';

export async function registerQETools(server: MCPServer): Promise<void> {
  // Register all QE tools with MCP server
  for (const tool of mcpTools) {
    await server.registerTool({
      name: `aqe/${tool.name}`,
      description: tool.description,
      category: `qe:${tool.category}`,
      version: tool.version,
      inputSchema: tool.inputSchema,
      handler: async (params, context) => {
        // Wrap handler with QE context injection
        const qeContext = {
          ...context,
          bridge: context.get('aqe.bridge'),
          sandbox: context.get('aqe.sandbox'),
          modelRouter: context.get('modelRouter')
        };

        return tool.handler(params, qeContext);
      }
    });
  }
}
```

### 6. Model Routing Integration

**Integration Type**: Adapter

TinyDancer model routing is aligned with V3's ADR-026 Agent Booster routing.

#### Routing Tier Alignment

| TinyDancer Category | ADR-026 Tier | Model | Rationale |
|---------------------|--------------|-------|-----------|
| Simple transforms | Tier 1 | Agent Booster | AST-based, no LLM |
| Unit test generation | Tier 2 | Haiku | Low complexity |
| Integration tests | Tier 2 | Sonnet | Medium complexity |
| E2E/Security tests | Tier 3 | Opus | High complexity |
| Architecture analysis | Tier 3 | Opus | Complex reasoning |

#### Routing Adapter

```typescript
// v3/plugins/agentic-qe/src/infrastructure/model-routing-adapter.ts

import type { EnhancedModelRouter, EnhancedRouteResult } from '@claude-flow/cli/ruvector';

export class QEModelRoutingAdapter {
  constructor(private v3Router: EnhancedModelRouter) {}

  /**
   * Route QE task using unified ADR-026 routing
   */
  async routeQETask(task: QETask): Promise<QERouteResult> {
    // Map QE category to complexity
    const complexity = this.mapCategoryToComplexity(task.category);

    // Get V3 route decision
    const v3Result = await this.v3Router.route(task.description, {
      filePath: task.targetPath
    });

    // Enhance with QE-specific routing
    return {
      ...v3Result,
      qeCategory: task.category,
      qeComplexity: complexity,
      recommendedAgents: this.getAgentsForTier(v3Result.tier, task.category),
      costEstimate: this.estimateCost(v3Result, task)
    };
  }

  private mapCategoryToComplexity(category: string): number {
    const complexityMap: Record<string, number> = {
      // Tier 1: Agent Booster
      'add-test-import': 0.1,
      'add-assertion': 0.15,

      // Tier 2: Haiku
      'generate-unit-test': 0.25,
      'analyze-coverage-line': 0.2,

      // Tier 2: Sonnet
      'generate-integration-test': 0.45,
      'validate-contract': 0.4,

      // Tier 3: Opus
      'generate-e2e-test': 0.7,
      'security-audit': 0.85,
      'chaos-design': 0.9
    };

    return complexityMap[category] ?? 0.5;
  }

  private getAgentsForTier(tier: 1 | 2 | 3, category: string): string[] {
    const tierAgentCounts = { 1: 1, 2: 3, 3: 5 };
    const count = tierAgentCounts[tier];

    // Get agents for category, limited by tier
    const contextMapper = new ContextMapper();
    const allAgents = contextMapper.getAgentsForContext(
      this.categoryToContext(category)
    );

    return allAgents.slice(0, count);
  }

  private categoryToContext(category: string): string {
    const mapping: Record<string, string> = {
      'generate-unit-test': 'test-generation',
      'generate-integration-test': 'test-generation',
      'generate-e2e-test': 'test-generation',
      'analyze-coverage': 'coverage-analysis',
      'security-audit': 'security-compliance',
      'validate-contract': 'contract-testing',
      'chaos-design': 'chaos-resilience'
    };
    return mapping[category] ?? 'test-generation';
  }

  private estimateCost(result: EnhancedRouteResult, task: QETask): number {
    // Estimate based on tier and expected token usage
    const tierCosts = {
      1: 0,           // Agent Booster - free
      2: 0.0002,      // Haiku
      3: result.model === 'opus' ? 0.015 : 0.003 // Opus or Sonnet
    };

    const baseCost = tierCosts[result.tier];
    const complexity = this.mapCategoryToComplexity(task.category);

    // Adjust for task complexity
    return baseCost * (1 + complexity);
  }
}
```

## Data Flow Diagrams

### Test Generation Flow

```
User Request
     │
     ▼
┌─────────────────┐
│  QE Plugin      │
│  ┌───────────┐  │
│  │Model Router│◄─────┐
│  └───────────┘  │     │
│       │         │     │
│       ▼         │     │
│  ┌───────────┐  │     │
│  │Test Gen   │  │     │
│  │Service    │  │     │
│  └───────────┘  │     │
└───────┬─────────┘     │
        │               │
        ▼               │
┌───────────────┐       │
│ V3 Memory     │       │
│ (Pattern      │       │
│  Retrieval)   │       │
└───────┬───────┘       │
        │               │
        ▼               │
┌───────────────┐       │
│ V3 Core       │       │
│ (Agent Spawn) │       │
└───────┬───────┘       │
        │               │
        ▼               │
┌───────────────┐       │
│ V3 MCP        │───────┘
│ (Tool Call)   │ ADR-026 Routing
└───────┬───────┘
        │
        ▼
   Generated Tests
```

### Coverage Analysis Flow

```
Coverage Report
     │
     ▼
┌─────────────────┐
│  QE Plugin      │
│  ┌───────────┐  │
│  │J-L Projec │  │  Johnson-Lindenstrauss
│  │(O(log n)) │  │  for O(log n) analysis
│  └───────────┘  │
│       │         │
│       ▼         │
│  ┌───────────┐  │
│  │Gap Detect │  │
│  └───────────┘  │
└───────┬─────────┘
        │
        ▼
┌───────────────┐
│ V3 Memory     │
│ (HNSW Search) │  150x faster
└───────┬───────┘
        │
        ▼
┌───────────────┐
│ V3 Memory     │
│ (Store Gaps)  │
└───────┬───────┘
        │
        ▼
   Prioritized Gaps
```

### Security Scan Flow

```
Scan Target
     │
     ▼
┌─────────────────┐
│ V3 Security     │
│ (Path Validate) │  Traversal prevention
└───────┬─────────┘
        │
        ▼
┌─────────────────┐
│  QE Plugin      │
│  ┌───────────┐  │
│  │SAST/DAST  │  │
│  │Scanner    │  │
│  └───────────┘  │
└───────┬─────────┘
        │
        ▼
┌───────────────┐
│ V3 Security   │
│ (SafeExecutor)│  Controlled execution
└───────┬───────┘
        │
        ▼
┌───────────────┐
│ V3 Memory     │
│ (Store        │
│  Findings)    │
└───────┬───────┘
        │
        ▼
   Security Report
```

## Error Handling

### Integration Error Types

```typescript
// QE-specific errors that bridge to V3 error system

class QEIntegrationError extends Error {
  constructor(
    message: string,
    public code: QEErrorCode,
    public v3Error?: Error,
    public context?: Record<string, unknown>
  ) {
    super(message);
    this.name = 'QEIntegrationError';
  }
}

enum QEErrorCode {
  MEMORY_BRIDGE_FAILED = 'QE001',
  SECURITY_VALIDATION_FAILED = 'QE002',
  HIVE_COORDINATION_FAILED = 'QE003',
  MCP_TOOL_FAILED = 'QE004',
  MODEL_ROUTING_FAILED = 'QE005',
  SANDBOX_TIMEOUT = 'QE006',
  PATTERN_NOT_FOUND = 'QE007'
}

// Error translation from V3 to QE domain
function translateV3Error(error: Error): QEIntegrationError {
  if (error instanceof MemoryError) {
    return new QEIntegrationError(
      `Memory operation failed: ${error.message}`,
      QEErrorCode.MEMORY_BRIDGE_FAILED,
      error
    );
  }

  if (error instanceof SecurityError) {
    return new QEIntegrationError(
      `Security validation failed: ${error.message}`,
      QEErrorCode.SECURITY_VALIDATION_FAILED,
      error
    );
  }

  if (error instanceof HiveMindError) {
    return new QEIntegrationError(
      `Hive coordination failed: ${error.message}`,
      QEErrorCode.HIVE_COORDINATION_FAILED,
      error
    );
  }

  // Unknown error
  return new QEIntegrationError(
    `Unknown integration error: ${error.message}`,
    QEErrorCode.MCP_TOOL_FAILED,
    error
  );
}
```

## Performance Considerations

### Shared Resource Optimization

| Resource | Optimization | Benefit |
|----------|--------------|---------|
| HNSW Index | Single shared index | No duplicate index builds |
| Embeddings Model | Single ONNX instance | 75x faster, lower memory |
| SQLite Connection | Connection pooling | Reduced I/O contention |
| Agent Pool | Shared worker pool | Better resource utilization |

### Namespace Isolation

Each QE context has isolated namespaces to prevent data conflicts:

```
Memory Namespace Hierarchy
├── aqe/                    # QE root namespace
│   └── v3/                 # Version namespace
│       ├── test-patterns/  # Isolated per context
│       ├── coverage-data/
│       ├── defect-patterns/
│       ├── code-knowledge/
│       ├── security-findings/
│       ├── contracts/
│       ├── visual-baselines/
│       ├── chaos-experiments/
│       └── learning-trajectories/
```

## Related Documentation

- [README](./README.md) - Domain overview
- [Domain Model](./domain-model.md) - Entities and aggregates
- [ADR-030: Agentic-QE Integration](../../implementation/adrs/ADR-030-agentic-qe-integration.md)
- [ADR-006: Unified Memory Service](../../implementation/adrs/ADR-006-UNIFIED-MEMORY.md)
- [ADR-013: Core Security Module](../../implementation/adrs/ADR-013-core-security-module.md)
- [ADR-026: Agent Booster Model Routing](../../implementation/adrs/ADR-026-agent-booster-model-routing.md)
