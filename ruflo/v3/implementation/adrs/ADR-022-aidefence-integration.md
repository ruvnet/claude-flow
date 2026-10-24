# ADR-022: AIDEFENCE (AIMDS) Integration

## Status
**Proposed** - Design Review

## Date
2026-01-12

## Context

The `aidefence` npm package (v2.1.1) provides a production-ready AI Manipulation Defense System (AIMDS) with capabilities that complement and enhance Claude Flow V3's security architecture:

### AIMDS Capabilities

| Component | Performance | Description |
|-----------|-------------|-------------|
| Detection Layer | <10ms (~8ms actual) | Pattern matching, prompt injection (50+ patterns), PII detection |
| Analysis Layer | <100ms (~80ms actual) | Behavioral analysis, Lyapunov chaos detection, LTL policy verification |
| Response Layer | <50ms | Adaptive mitigation with 25-level meta-learning (strange-loop) |
| API Throughput | >12,000 req/s | Production-grade performance |

### Strategic Alignment

| aidefence Feature | Claude Flow V3 Equivalent | Synergy |
|-------------------|---------------------------|---------|
| AgentDB integration | `@claude-flow/memory` with AgentDB | **Direct compatibility** - both use AgentDB for vector search |
| HNSW threat search | HNSW pattern search (150x faster) | **Shared infrastructure** - unified threat pattern index |
| Prompt injection detection | Security domain service | **Enhancement** - 50+ patterns vs current regex-based |
| Behavioral analysis | SecurityDomainService.detectThreats() | **Enhancement** - temporal/chaos analysis |
| Meta-learning (strange-loop) | ReasoningBank pattern learning | **Integration** - shared learning substrate |
| Express REST API | MCP server HTTP transport | **Bridge** - unified security API |
| Prometheus metrics | CLI performance metrics | **Observability** - unified dashboards |

### Current Security Gaps

The current `@claude-flow/security` module addresses CVE-2, CVE-3, HIGH-1, HIGH-2 but lacks:

1. **Real-time prompt injection detection** - Current approach is pattern-based without ML
2. **Behavioral anomaly detection** - No temporal/chaos analysis for adversarial inputs
3. **Adaptive response learning** - No meta-learning for mitigation strategies
4. **Production throughput** - Not benchmarked for >10,000 req/s

---

## Decision

Integrate `aidefence` as a security enhancement layer within Claude Flow V3 using a **bounded context** approach with clear domain boundaries.

### 1. Domain-Driven Design Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                        Claude Flow V3 Security Domain                        │
├──────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  ┌────────────────────────────┐    ┌────────────────────────────────────┐   │
│  │  @claude-flow/security     │    │  @claude-flow/aidefence            │   │
│  │  (Core Security Context)   │    │  (AI Defense Context)              │   │
│  ├────────────────────────────┤    ├────────────────────────────────────┤   │
│  │  • CVE remediation         │◄──►│  • Prompt injection detection      │   │
│  │  • Password hashing        │    │  • Behavioral analysis             │   │
│  │  • Safe execution          │    │  • Adaptive response               │   │
│  │  • Path validation         │    │  • Meta-learning (strange-loop)    │   │
│  │  • Token generation        │    │  • PII detection                   │   │
│  │  • Input validation        │    │  • Policy verification (LTL)       │   │
│  └────────────────────────────┘    └────────────────────────────────────┘   │
│              │                                    │                          │
│              └──────────────┬─────────────────────┘                          │
│                             │                                                │
│                             ▼                                                │
│  ┌──────────────────────────────────────────────────────────────────────┐   │
│  │              Shared Security Infrastructure Layer                     │   │
│  ├──────────────────────────────────────────────────────────────────────┤   │
│  │  • AgentDB Vector Store (HNSW-indexed threat patterns)               │   │
│  │  • ReasoningBank (shared learning patterns)                          │   │
│  │  • MCP Security Endpoints                                            │   │
│  │  • Prometheus Metrics                                                │   │
│  └──────────────────────────────────────────────────────────────────────┘   │
│                                                                              │
└──────────────────────────────────────────────────────────────────────────────┘
```

### 2. Bounded Context Definitions

#### 2.1 Core Security Context (`@claude-flow/security`)
**Responsibility**: Foundational security primitives and CVE remediation

```typescript
// Domain entities remain unchanged
interface CoreSecurityContext {
  passwordHasher: PasswordHasher;      // CVE-2 fix
  credentialGenerator: CredentialGenerator; // CVE-3 fix
  safeExecutor: SafeExecutor;          // HIGH-1 fix
  pathValidator: PathValidator;         // HIGH-2 fix
  inputValidator: InputValidator;
  tokenGenerator: TokenGenerator;
}
```

#### 2.2 AI Defense Context (`@claude-flow/aidefence`) - NEW
**Responsibility**: AI-specific adversarial defense

```typescript
// New domain entities from aidefence
interface AIDefenseContext {
  // Detection subdomain
  detection: {
    promptInjectionDetector: PromptInjectionDetector;
    piiDetector: PIIDetector;
    patternMatcher: AhoCorasickMatcher;
  };

  // Analysis subdomain
  analysis: {
    behavioralAnalyzer: BehavioralAnalyzer;
    chaosDetector: LyapunovChaosDetector;
    policyVerifier: LTLPolicyVerifier;
    anomalyDetector: StatisticalAnomalyDetector;
  };

  // Response subdomain
  response: {
    mitigationEngine: AdaptiveMitigationEngine;
    metaLearner: StrangeLoopMetaLearner;
    rollbackManager: RollbackManager;
  };
}
```

### 3. Anti-Corruption Layer (ACL)

Translate between aidefence and claude-flow domains:

```typescript
// v3/@claude-flow/aidefence/src/infrastructure/aidefence-adapter.ts

import { DefenseResult as AIDefenseResult } from 'aidefence';
import { ThreatDetectionResult } from '@claude-flow/security';

export class AIDefenceAdapter {
  private aidefence: AIMDSClient;

  constructor(config: AIDefenceConfig) {
    this.aidefence = new AIMDSClient(config);
  }

  /**
   * Translate aidefence detection result to claude-flow threat format
   */
  async detectThreats(input: string): Promise<ThreatDetectionResult> {
    const result: AIDefenseResult = await this.aidefence.defend({
      action: input,
      source: 'claude-flow-agent'
    });

    return this.translateToThreatResult(result);
  }

  /**
   * Batch analysis for swarm coordination
   */
  async analyzeAgentBehavior(
    agentId: string,
    actions: string[]
  ): Promise<BehavioralAnalysisResult> {
    const embeddings = await this.generateActionEmbeddings(actions);
    return this.aidefence.analyzeBehavior({
      entityId: agentId,
      actionEmbeddings: embeddings,
      temporalWindow: '1h'
    });
  }

  /**
   * Store threat pattern in shared AgentDB
   */
  async learnThreatPattern(
    pattern: ThreatPattern,
    effectiveness: number
  ): Promise<void> {
    // Store in shared AgentDB namespace
    await this.aidefence.storePattern({
      ...pattern,
      namespace: 'security_threats',
      reward: effectiveness
    });
  }

  private translateToThreatResult(
    result: AIDefenseResult
  ): ThreatDetectionResult {
    return {
      safe: result.status === 'safe',
      threats: result.detections.map(d => ({
        type: this.mapThreatType(d.type),
        severity: this.mapSeverity(d.confidence),
        description: d.description,
        location: d.location
      }))
    };
  }

  private mapThreatType(aidefenceType: string): string {
    const mapping: Record<string, string> = {
      'prompt_injection': 'prompt-injection',
      'jailbreak': 'jailbreak-attempt',
      'pii_exposure': 'credential-exposure',
      'adversarial': 'adversarial-input'
    };
    return mapping[aidefenceType] ?? aidefenceType;
  }

  private mapSeverity(confidence: number): 'low' | 'medium' | 'high' | 'critical' {
    if (confidence >= 0.9) return 'critical';
    if (confidence >= 0.7) return 'high';
    if (confidence >= 0.5) return 'medium';
    return 'low';
  }
}
```

### 4. Integration Points

#### 4.1 MCP Server Integration

```typescript
// v3/@claude-flow/mcp/src/tools/aidefence-tools.ts

export const aidefenceTools: ToolDefinition[] = [
  {
    name: 'aidefence_scan',
    description: 'Scan input for AI manipulation attempts (prompt injection, jailbreak, PII)',
    inputSchema: {
      type: 'object',
      properties: {
        input: { type: 'string', description: 'Input to scan' },
        mode: { enum: ['quick', 'thorough', 'paranoid'], default: 'thorough' }
      },
      required: ['input']
    },
    handler: async (params, context) => {
      const adapter = context.get<AIDefenceAdapter>('aidefence');
      return adapter.detectThreats(params.input);
    }
  },
  {
    name: 'aidefence_analyze_behavior',
    description: 'Analyze agent behavior patterns for anomalies',
    inputSchema: {
      type: 'object',
      properties: {
        agentId: { type: 'string' },
        timeWindow: { type: 'string', default: '1h' }
      },
      required: ['agentId']
    },
    handler: async (params, context) => {
      const adapter = context.get<AIDefenceAdapter>('aidefence');
      const actions = await context.get<Memory>('memory')
        .searchByAgent(params.agentId, params.timeWindow);
      return adapter.analyzeAgentBehavior(params.agentId, actions);
    }
  },
  {
    name: 'aidefence_verify_policy',
    description: 'Verify agent behavior against LTL security policies',
    inputSchema: {
      type: 'object',
      properties: {
        agentId: { type: 'string' },
        policy: { type: 'string', description: 'LTL policy formula' }
      },
      required: ['agentId', 'policy']
    },
    handler: async (params, context) => {
      const adapter = context.get<AIDefenceAdapter>('aidefence');
      return adapter.verifyPolicy(params.agentId, params.policy);
    }
  }
];
```

#### 4.2 CLI Command Integration

```typescript
// v3/@claude-flow/cli/src/commands/security.ts (extension)

// Add aidefence subcommands to existing security command
securityCommand
  .command('defend')
  .description('Run AI manipulation defense scan')
  .option('-i, --input <text>', 'Input text to scan')
  .option('-f, --file <path>', 'File to scan')
  .option('-m, --mode <mode>', 'Scan mode: quick|thorough|paranoid', 'thorough')
  .option('--json', 'Output as JSON')
  .action(async (options) => {
    const adapter = await getAIDefenceAdapter();
    const input = options.file
      ? await readFile(options.file, 'utf-8')
      : options.input;

    const result = await adapter.detectThreats(input);

    if (options.json) {
      console.log(JSON.stringify(result, null, 2));
    } else {
      printDefenseResult(result);
    }
  });

securityCommand
  .command('behavior')
  .description('Analyze agent behavioral patterns')
  .requiredOption('-a, --agent <id>', 'Agent ID to analyze')
  .option('-w, --window <duration>', 'Time window', '1h')
  .action(async (options) => {
    const adapter = await getAIDefenceAdapter();
    const result = await adapter.analyzeAgentBehavior(
      options.agent,
      options.window
    );
    printBehaviorAnalysis(result);
  });
```

#### 4.3 Hooks Integration

```typescript
// v3/@claude-flow/cli/src/hooks/aidefence-hooks.ts

export const aidefenceHooks: HookDefinition[] = [
  {
    name: 'pre-agent-input',
    description: 'Scan agent inputs for manipulation attempts',
    handler: async (context) => {
      const { input, agentId } = context;
      const adapter = getAIDefenceAdapter();

      const result = await adapter.detectThreats(input);

      if (!result.safe) {
        const critical = result.threats.filter(t => t.severity === 'critical');
        if (critical.length > 0) {
          throw new SecurityError(
            `Blocked: ${critical.length} critical threats detected`,
            { threats: critical }
          );
        }

        // Log non-critical threats
        await logSecurityEvent('threats_detected', {
          agentId,
          threats: result.threats
        });
      }

      return { proceed: result.safe || result.threats.every(t => t.severity !== 'critical') };
    }
  },
  {
    name: 'post-agent-action',
    description: 'Learn from agent actions for behavioral modeling',
    handler: async (context) => {
      const { agentId, action, result, success } = context;
      const adapter = getAIDefenceAdapter();

      // Feed action to meta-learner
      await adapter.recordAction({
        agentId,
        action,
        result,
        success,
        timestamp: Date.now()
      });

      // Periodically check for behavioral anomalies
      if (Math.random() < 0.1) { // 10% sampling
        const analysis = await adapter.analyzeAgentBehavior(agentId, '10m');
        if (analysis.anomalyScore > 0.8) {
          await notifySecurityTeam('behavioral_anomaly', { agentId, analysis });
        }
      }
    }
  }
];
```

### 5. Skill Definition

```yaml
# v3/@claude-flow/cli/.claude/skills/aidefence.yaml

name: aidefence
version: 1.0.0
description: AI Manipulation Defense System integration for real-time threat detection
author: rUv

capabilities:
  - prompt_injection_detection
  - behavioral_analysis
  - pii_detection
  - policy_verification
  - adaptive_mitigation

commands:
  scan:
    description: Scan input for AI manipulation attempts
    usage: /aidefence scan <input>
    options:
      - name: mode
        type: choice
        choices: [quick, thorough, paranoid]
        default: thorough

  analyze:
    description: Analyze agent behavior for anomalies
    usage: /aidefence analyze <agent-id>
    options:
      - name: window
        type: string
        default: "1h"

  policy:
    description: Verify agent against security policy
    usage: /aidefence policy <agent-id> <ltl-formula>

hooks:
  pre-agent-input:
    enabled: true
    config:
      block_critical: true
      log_all: true

  post-agent-action:
    enabled: true
    config:
      sampling_rate: 0.1
      anomaly_threshold: 0.8

integration:
  agentdb:
    namespace: security_threats
    hnsw_enabled: true

  reasoningbank:
    store_patterns: true
    learn_mitigations: true
```

### 6. Agent Definition Enhancement

```yaml
# v3/@claude-flow/cli/.claude/agents/v3/security-architect.yaml (enhancement)

# Add to existing security-architect capabilities
capabilities:
  # ... existing capabilities ...

  # NEW: aidefence integration
  - aidefence_threat_detection     # Real-time prompt injection detection
  - aidefence_behavioral_analysis  # Temporal anomaly detection
  - aidefence_policy_verification  # LTL security policy verification
  - aidefence_meta_learning        # Adaptive mitigation learning

# Add aidefence-specific hooks
hooks:
  pre: |
    # ... existing pre-hook ...

    # NEW: Check for similar attack patterns via aidefence
    ATTACK_PATTERNS=$(npx claude-flow@v3alpha security defend --input "$TASK" --mode thorough --json)
    if echo "$ATTACK_PATTERNS" | jq -e '.threats | length > 0' > /dev/null; then
      echo "⚠️  Potential manipulation detected in task request"
      echo "$ATTACK_PATTERNS" | jq -r '.threats[] | "  - \(.type): \(.description)"'
    fi

  post: |
    # ... existing post-hook ...

    # NEW: Feed security assessment to aidefence meta-learner
    npx claude-flow@v3alpha security behavior --agent "security-architect-$(date +%s)" --record-action "$TASK"
```

### 7. Shared Infrastructure

#### 7.1 AgentDB Namespace Configuration

```typescript
// v3/@claude-flow/memory/src/config/security-namespaces.ts

export const securityNamespaces: NamespaceConfig[] = [
  {
    name: 'security_threats',
    description: 'Shared threat pattern storage (aidefence + claude-flow)',
    vectorDimension: 384,
    hnswConfig: {
      m: 16,
      efConstruction: 200,
      efSearch: 100
    },
    schema: {
      type: { type: 'string', index: true },
      severity: { type: 'string', index: true },
      pattern: { type: 'string' },
      mitigation: { type: 'string' },
      effectiveness: { type: 'number' },
      source: { type: 'string', enum: ['aidefence', 'claude-flow', 'manual'] }
    }
  },
  {
    name: 'security_behaviors',
    description: 'Agent behavioral patterns for anomaly detection',
    vectorDimension: 384,
    hnswConfig: {
      m: 12,
      efConstruction: 150,
      efSearch: 50
    },
    schema: {
      agentId: { type: 'string', index: true },
      actionType: { type: 'string', index: true },
      timestamp: { type: 'number', index: true },
      lyapunovExponent: { type: 'number' },
      attractorType: { type: 'string' }
    }
  },
  {
    name: 'security_mitigations',
    description: 'Learned mitigation strategies from meta-learning',
    vectorDimension: 384,
    schema: {
      threatType: { type: 'string', index: true },
      strategy: { type: 'string' },
      effectiveness: { type: 'number' },
      rollbackAvailable: { type: 'boolean' },
      recursionDepth: { type: 'number' } // strange-loop depth
    }
  }
];
```

#### 7.2 Prometheus Metrics Integration

```typescript
// v3/@claude-flow/aidefence/src/infrastructure/metrics.ts

import { Registry, Counter, Histogram, Gauge } from 'prom-client';

export function registerAIDefenceMetrics(registry: Registry) {
  // Threat detection metrics
  new Counter({
    name: 'aidefence_threats_detected_total',
    help: 'Total threats detected by type',
    labelNames: ['type', 'severity'],
    registers: [registry]
  });

  new Histogram({
    name: 'aidefence_detection_latency_ms',
    help: 'Threat detection latency in milliseconds',
    buckets: [1, 5, 10, 25, 50, 100],
    registers: [registry]
  });

  new Histogram({
    name: 'aidefence_analysis_latency_ms',
    help: 'Behavioral analysis latency in milliseconds',
    buckets: [10, 25, 50, 100, 250, 500],
    registers: [registry]
  });

  // Behavioral analysis metrics
  new Gauge({
    name: 'aidefence_anomaly_score',
    help: 'Current anomaly score by agent',
    labelNames: ['agentId'],
    registers: [registry]
  });

  // Meta-learning metrics
  new Counter({
    name: 'aidefence_mitigations_applied_total',
    help: 'Total mitigations applied by strategy',
    labelNames: ['strategy', 'success'],
    registers: [registry]
  });

  new Gauge({
    name: 'aidefence_meta_learning_depth',
    help: 'Current strange-loop recursion depth',
    registers: [registry]
  });
}
```

---

## Package Structure

```
v3/@claude-flow/aidefence/
├── package.json
├── src/
│   ├── index.ts                    # Public API exports
│   ├── domain/
│   │   ├── entities/
│   │   │   ├── threat.ts           # Threat domain entity
│   │   │   ├── behavior-pattern.ts # Behavioral pattern entity
│   │   │   └── mitigation.ts       # Mitigation strategy entity
│   │   ├── services/
│   │   │   ├── detection-service.ts
│   │   │   ├── analysis-service.ts
│   │   │   └── mitigation-service.ts
│   │   └── events/
│   │       ├── threat-detected.ts
│   │       └── anomaly-detected.ts
│   ├── application/
│   │   ├── commands/
│   │   │   ├── scan-input.ts
│   │   │   └── analyze-behavior.ts
│   │   └── queries/
│   │       ├── get-threat-patterns.ts
│   │       └── get-behavior-analysis.ts
│   └── infrastructure/
│       ├── aidefence-adapter.ts    # Anti-corruption layer
│       ├── metrics.ts              # Prometheus integration
│       └── agentdb-repository.ts   # Shared storage
├── __tests__/
│   ├── unit/
│   ├── integration/
│   └── acceptance/
└── README.md
```

---

## Dependencies

```json
{
  "name": "@claude-flow/aidefence",
  "version": "3.0.0-alpha.1",
  "dependencies": {
    "aidefence": "^2.1.1",
    "@claude-flow/security": "workspace:*",
    "@claude-flow/memory": "workspace:*",
    "@claude-flow/core": "workspace:*",
    "agentdb": "^2.0.0-alpha.3"
  },
  "peerDependencies": {
    "prom-client": "^15.1.0"
  }
}
```

---

## Validation Criteria

### Performance Requirements

| Metric | Requirement | aidefence Baseline |
|--------|-------------|-------------------|
| Detection latency | <15ms p99 | ~8ms actual |
| Analysis latency | <150ms p99 | ~80ms actual |
| API throughput | >5,000 req/s | >12,000 req/s |
| Memory overhead | <50MB | ~30MB |

### Security Requirements

| Requirement | Validation Method |
|-------------|-------------------|
| Prompt injection detection | Test suite with 100+ known injection patterns |
| No false negatives on critical threats | Adversarial testing with red team samples |
| PII detection accuracy >95% | Synthetic PII test dataset |
| Behavioral anomaly detection | Simulated attack scenarios |

### Integration Requirements

| Requirement | Validation Method |
|-------------|-------------------|
| AgentDB namespace sharing works | Integration tests with shared data |
| MCP tools registered correctly | MCP test client validation |
| CLI commands function | E2E CLI tests |
| Hooks fire correctly | Hook integration tests |
| Metrics exposed | Prometheus scrape test |

---

## Consequences

### Positive

- **Enhanced threat detection**: 50+ prompt injection patterns vs current regex
- **Behavioral analysis**: Temporal anomaly detection currently missing
- **Meta-learning**: Adaptive mitigation improves over time
- **Performance**: Production-proven throughput (>12,000 req/s)
- **Shared infrastructure**: Leverages existing AgentDB/HNSW investment
- **Same author**: Maintained by rUv, ensuring alignment

### Negative

- **Additional dependency**: Adds aidefence (782KB unpacked)
- **Complexity**: Another bounded context to maintain
- **Resource usage**: Behavioral analysis requires background processing
- **Version coordination**: Must keep aidefence and adapter in sync

### Trade-offs

- **Adapter overhead**: ACL adds ~1-2ms latency but ensures decoupling
- **Dual threat detection**: Some overlap with existing detection (can be tuned)
- **Memory for behavioral analysis**: ~30MB for agent pattern caching

---

## Migration Path

### Phase 1: Package Setup (Week 1)
- Create `@claude-flow/aidefence` package
- Implement AIDefenceAdapter anti-corruption layer
- Add to workspace dependencies

### Phase 2: CLI Integration (Week 2)
- Add `security defend` command
- Add `security behavior` command
- Implement hook handlers

### Phase 3: MCP Integration (Week 3)
- Register MCP tools
- Add to server capabilities
- Integration tests

### Phase 4: Agent Enhancement (Week 4)
- Update security-architect agent definition
- Add aidefence capabilities to skill
- End-to-end validation

---

## References

- [aidefence npm package](https://www.npmjs.com/package/aidefence)
- [AIMDS GitHub (midstream repo)](https://github.com/ruvnet/midstream/tree/main/AIMDS)
- [ADR-013: Core Security Module](./ADR-013-core-security-module.md)
- [ADR-012: MCP Security Features](./ADR-012-mcp-security-features.md)
- [AIDEFEND Framework (HelpNetSecurity)](https://www.helpnetsecurity.com/2025/09/01/aidefend-free-ai-defense-framework/)
- [OWASP LLM Top 10](https://owasp.org/www-project-top-10-for-large-language-model-applications/)
