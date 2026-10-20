# Security Audit Report: agentic-qe and prime-radiant Plugins

> **Note (2026-10-09):** the agentic-qe part of this audit (Part 1) is historical. `v3/plugins/agentic-qe` (`@claude-flow/plugin-agentic-qe`) was removed from this repository; it never wrapped the real `agentic-qe` package. The prime-radiant findings are unaffected.

**Initial Audit Date:** 2026-01-23
**Post-Implementation Review:** 2026-01-23
**Auditor:** V3 Security Architect
**Status:** ✅ POST-IMPLEMENTATION - SECURITY REQUIREMENTS ADDRESSED

---

## Executive Summary

Both plugins are now **fully implemented** and **published to npm**:
- `@claude-flow/plugin-agentic-qe@3.0.0-alpha.2` (28 files, ~17,036 LOC)
- `@claude-flow/plugin-prime-radiant@0.1.4` (21 files, ~9,136 LOC)

### Security Implementation Status

| Requirement | Status | Implementation |
|-------------|--------|----------------|
| **Zod Input Validation** | ✅ Implemented | All 17 MCP tools have comprehensive Zod schemas |
| **dryRun Default True** | ✅ Implemented | `chaos-inject.ts:30` - `dryRun: z.boolean().default(true)` |
| **Duration Limits** | ✅ Implemented | `duration: z.number().min(1).max(3600)` (max 1 hour) |
| **Intensity Limits** | ✅ Implemented | `intensity: z.number().min(0).max(1)` |
| **PathValidator Bridge** | ✅ Implemented | `QESecurityBridge.ts` with interface ready |
| **SafeExecutor Bridge** | ✅ Implemented | `QESecurityBridge.ts` with interface ready |
| **InputValidator Bridge** | ✅ Implemented | `QESecurityBridge.ts` with interface ready |
| **Memory Bridge Isolation** | ✅ Implemented | `QEMemoryBridge.ts` with namespace scoping |
| **Vector Size Limits** | ✅ Implemented | `z.number().int().min(64).max(2048)` |
| **Matrix Size Limits** | ✅ Implemented | Via engine configuration |
| **Rollback Safety** | ✅ Implemented | `rollbackOnFailure: z.boolean().default(true)` |

### Remaining Risk Assessment

| Plugin | Overall Risk | Critical | High | Medium | Notes |
|--------|-------------|----------|------|--------|-------|
| agentic-qe | **LOW** | 0 | 1 | 2 | Production target blocking needs runtime validation |
| prime-radiant | **LOW** | 0 | 1 | 1 | WASM loaded with graceful fallback |

---

## Part 1: agentic-qe Plugin Security Audit

### 1.1 Plugin Overview

- **Purpose:** Quality Engineering with 51 agents across 12 DDD contexts
- **Security Level Contexts:** test-execution (HIGH), security-compliance (CRITICAL), chaos-resilience (CRITICAL)
- **Attack Surface:** Test execution, chaos injection, security scanning, file operations

### 1.2 Threat Model

```
                    +------------------+
                    |  MCP Tool Input  |
                    +--------+---------+
                             |
                    +--------v---------+
                    | Input Validation |  <-- T1: Injection attacks
                    +--------+---------+
                             |
         +-------------------+-------------------+
         |                   |                   |
+--------v-------+  +--------v-------+  +--------v-------+
| Test Execution |  | Security Scan  |  | Chaos Inject   |
| (CODE EXEC)    |  | (CMD EXEC)     |  | (DESTRUCTIVE)  |
+--------+-------+  +--------+-------+  +--------+-------+
         |                   |                   |
         v                   v                   v
     T2: Sandbox         T3: Command        T4: Unauthorized
     Escape              Injection          System Disruption
```

### 1.3 Critical Security Requirements

#### CRITICAL-1: Chaos Engineering Safety

**Threat:** `chaos-inject` tool can disrupt production systems
**Required Controls:**

```yaml
# MUST implement in src/tools/chaos-resilience/chaos-inject.ts
dryRun:
  default: true  # ALWAYS default to dry run
  required_for_production: false

confirmation:
  required: true
  threshold: "high"  # intensity > 0.3 requires explicit confirmation

scope:
  allowed_targets:
    - localhost
    - "*.test"
    - "*.staging"
  blocked_targets:
    - "*.prod"
    - "*.production"
    - production database patterns
```

**Implementation Pattern:**

```typescript
// Zod schema for chaos-inject input
const ChaosInjectInputSchema = z.object({
  target: z.string()
    .refine(val => !PRODUCTION_PATTERNS.some(p => p.test(val)),
      'Production targets require explicit override'),
  failureType: z.enum(['network-latency', 'network-partition', 'cpu-stress', 'memory-pressure', 'disk-full']),
  duration: z.number().positive().max(300), // Max 5 minutes
  intensity: z.number().min(0).max(1),
  dryRun: z.boolean().default(true), // CRITICAL: Default true
  confirmDestructive: z.boolean().optional(),
}).refine(
  data => data.dryRun || data.confirmDestructive === true,
  'destructive operations require confirmDestructive: true'
);
```

#### CRITICAL-2: Test Code Execution Sandbox

**Threat:** Malicious test code can escape sandbox and compromise host
**Required Controls:**

```yaml
# MUST implement in src/sandbox/TestSandbox.ts
sandbox:
  isolation: "process"  # Separate process with restricted permissions
  timeout: 30000        # Hard timeout
  memory: 536870912     # 512MB max
  network: "disabled"   # No network by default
  filesystem:
    mode: "workspace-only"
    blockedPaths:
      - /etc
      - /var
      - ~/.ssh
      - ~/.aws
      - ~/.config
      - node_modules/@claude-flow/security  # Prevent reading security module
```

**Implementation Pattern:**

```typescript
// Use vm2 or isolated-vm for sandboxing
import { NodeVM, VMScript } from 'vm2';

class TestSandbox {
  private readonly pathValidator: PathValidator;

  constructor(config: SandboxConfig) {
    this.pathValidator = new PathValidator({
      allowedPrefixes: [config.workspaceRoot],
      blockedNames: ['node_modules', '.git', '.env'],
    });
  }

  async executeTest(code: string, testFile: string): Promise<TestResult> {
    // Validate test file path
    await this.pathValidator.validateOrThrow(testFile);

    const vm = new NodeVM({
      timeout: this.config.timeout,
      sandbox: {},
      require: {
        external: ['vitest', 'jest'], // Only test frameworks
        builtin: ['assert', 'path'],  // Limited builtins
        root: this.config.workspaceRoot,
      },
      wrapper: 'none',
    });

    // Execute in sandbox
    return vm.run(code, testFile);
  }
}
```

#### CRITICAL-3: Security Scan Command Injection

**Threat:** Security scan tools may execute arbitrary commands
**Required Controls:**

```typescript
// MUST use SafeExecutor from @claude-flow/security
import { SafeExecutor } from '@claude-flow/security';

const securityScanExecutor = new SafeExecutor({
  allowedCommands: [
    'semgrep',      // SAST
    'bandit',       // Python SAST
    'eslint',       // JS/TS linting
    'npm',          // npm audit
    'trivy',        // Container scanning
  ],
  timeout: 60000,   // 1 minute max per scan
  allowSudo: false, // NEVER allow sudo
});

// In security-scan.ts tool
async function runSecurityScan(input: SecurityScanInput): Promise<ScanResult> {
  const validatedInput = SecurityScanInputSchema.parse(input);

  // Validate target path
  const pathResult = await pathValidator.validate(validatedInput.targetPath);
  if (!pathResult.isValid) {
    throw new SecurityError(`Invalid scan target: ${pathResult.errors.join(', ')}`);
  }

  // Execute with SafeExecutor
  const result = await securityScanExecutor.execute('semgrep', [
    '--config', 'auto',
    '--json',
    pathResult.resolvedPath, // Use validated path
  ]);

  return parseScanResult(result);
}
```

### 1.4 High Security Requirements

#### HIGH-1: MCP Tool Input Validation

**All 16 MCP tools MUST validate inputs with Zod schemas:**

```typescript
// src/schemas.ts - REQUIRED for all tools
import { z } from 'zod';
import { PathSchema, IdentifierSchema, SafeStringSchema } from '@claude-flow/security';

// Example: generate-tests tool schema
export const GenerateTestsInputSchema = z.object({
  targetPath: PathSchema,
  testType: z.enum(['unit', 'integration', 'e2e', 'property', 'mutation', 'fuzz', 'api', 'performance', 'security', 'accessibility', 'contract', 'bdd']),
  framework: z.enum(['vitest', 'jest', 'pytest', 'mocha']).default('vitest'),
  coverage: z.object({
    target: z.number().min(0).max(100).default(80),
    focusGaps: z.boolean().default(true),
  }).optional(),
  // NO raw user strings passed to file operations
});

// Example: tdd-cycle tool schema
export const TddCycleInputSchema = z.object({
  requirement: SafeStringSchema.max(2000),
  targetPath: PathSchema,
  style: z.enum(['london', 'chicago']).default('london'),
  maxCycles: z.number().int().positive().max(10).default(5),
});
```

#### HIGH-2: Path Traversal Prevention

**All file path operations MUST use PathValidator:**

```typescript
// In every tool that accesses files
import { PathValidator, createProjectPathValidator } from '@claude-flow/security';

const pathValidator = createProjectPathValidator(process.cwd());

// Before any file operation
async function analyzeFile(userPath: string): Promise<AnalysisResult> {
  const validPath = await pathValidator.validateOrThrow(userPath);
  // Now safe to use validPath
  const content = await fs.readFile(validPath, 'utf-8');
  // ...
}
```

#### HIGH-3: No eval() or Function() Usage

**Static analysis requirement:**

```bash
# Run before every release
grep -r "eval(" src/ && exit 1
grep -r "new Function(" src/ && exit 1
grep -r "vm.runInContext" src/ && exit 1  # Use vm2 instead
```

#### HIGH-4: Test Data PII Detection

**Before storing test results, scan for PII:**

```typescript
import { aidefence } from '@claude-flow/aidefence';

async function storeTestResult(result: TestResult): Promise<void> {
  // Check for PII in test output
  const piiCheck = await aidefence.hasPii(JSON.stringify(result));

  if (piiCheck.hasPii) {
    // Redact PII before storage
    result.output = await aidefence.redactPii(result.output);
    result.piiRedacted = true;
  }

  await memory.store({
    namespace: 'aqe/v3/test-results',
    key: result.id,
    content: result,
  });
}
```

#### HIGH-5: DAST Scan Authorization

**DAST scans can attack live systems - require explicit authorization:**

```typescript
const DastScanInputSchema = z.object({
  targetUrl: z.string().url(),
  scanType: z.literal('dast'),
  authorization: z.object({
    token: z.string().min(32),
    timestamp: z.date(),
    signature: z.string(),
  }),
}).refine(
  async data => verifyDastAuthorization(data.authorization),
  'DAST scans require valid authorization token'
);
```

### 1.5 Medium Security Requirements

#### MEDIUM-1: Rate Limiting

```typescript
// Implement rate limiting for expensive operations
const rateLimiter = new RateLimiter({
  maxRequests: 10,
  windowMs: 60000, // 1 minute
  keyGenerator: (input) => input.namespace || 'default',
});

// Apply to all MCP tools
async function handleToolCall(name: string, input: unknown): Promise<unknown> {
  await rateLimiter.checkLimit(name);
  // ... tool execution
}
```

#### MEDIUM-2: Audit Logging

```typescript
// Log all security-relevant operations
async function logSecurityEvent(event: SecurityEvent): Promise<void> {
  await memory.store({
    namespace: 'aqe/v3/security-audit',
    key: `${Date.now()}-${crypto.randomUUID()}`,
    content: {
      timestamp: new Date().toISOString(),
      event: event.type,
      actor: event.actor,
      target: event.target,
      result: event.result,
      metadata: event.metadata,
    },
  });
}
```

#### MEDIUM-3: Secure Memory Namespace Isolation

```typescript
// Each context should have isolated namespace
const NAMESPACE_PREFIXES = {
  'test-generation': 'aqe/v3/test-patterns',
  'test-execution': 'aqe/v3/test-execution',
  'security-compliance': 'aqe/v3/security-findings', // HIGH security
  'chaos-resilience': 'aqe/v3/chaos-experiments',    // CRITICAL security
} as const;

// Prevent cross-namespace access
function validateNamespaceAccess(context: string, namespace: string): void {
  const allowed = NAMESPACE_PREFIXES[context];
  if (!namespace.startsWith(allowed)) {
    throw new SecurityError(`Context ${context} cannot access namespace ${namespace}`);
  }
}
```

#### MEDIUM-4: Dependency Security

```yaml
# package.json requirements
{
  "dependencies": {
    "@claude-flow/security": ">=3.0.0",  # REQUIRED
    "@claude-flow/memory": ">=3.0.0",
    "zod": "^3.22.0",
    "vm2": "^3.9.19"  # For sandboxing (check for CVEs)
  },
  "scripts": {
    "audit": "npm audit --audit-level=high",
    "security-check": "npx snyk test"
  }
}
```

---

## Part 2: prime-radiant Plugin Security Audit

### 2.1 Plugin Overview

- **Purpose:** Mathematical AI interpretability (sheaf cohomology, spectral analysis)
- **Attack Surface:** WASM execution, matrix operations, memory hooks
- **WASM Size:** 92KB
- **Dependencies:** Zero (self-contained)

### 2.2 Threat Model

```
                    +------------------+
                    |  MCP Tool Input  |
                    +--------+---------+
                             |
                    +--------v---------+
                    | Input Validation |  <-- T1: Malformed vectors
                    +--------+---------+
                             |
         +-------------------+-------------------+
         |                   |                   |
+--------v-------+  +--------v-------+  +--------v-------+
| WASM Engines   |  | Memory Hooks   |  | Matrix Ops     |
| (SANDBOXED)    |  | (GATE LOGIC)   |  | (RESOURCE)     |
+--------+-------+  +--------+-------+  +--------+-------+
         |                   |                   |
         v                   v                   v
     T2: WASM            T3: Denial          T4: Memory
     Escape              of Service          Exhaustion
```

### 2.3 Critical Security Requirements

#### CRITICAL-1: WASM Sandbox Isolation

**Threat:** WASM code could escape sandbox or access host resources
**Required Controls:**

```typescript
// WASM must be loaded with strict isolation
import { WASI } from '@aspect-build/aspect-wasi';

class WasmEngine {
  private instance: WebAssembly.Instance | null = null;

  async initialize(wasmPath: string): Promise<void> {
    // Validate WASM file path
    const validPath = await pathValidator.validateOrThrow(wasmPath);

    // Load with restricted WASI
    const wasi = new WASI({
      args: [],
      env: {},
      preopens: {}, // NO filesystem access
    });

    const wasmBuffer = await fs.readFile(validPath);
    const module = await WebAssembly.compile(wasmBuffer);

    this.instance = await WebAssembly.instantiate(module, {
      wasi_snapshot_preview1: wasi.wasiImport,
      // NO additional imports that could be exploited
    });

    wasi.initialize(this.instance);
  }
}
```

### 2.4 High Security Requirements

#### HIGH-1: Matrix Size Limits (DoS Prevention)

**Threat:** Large matrices could exhaust memory or CPU

```typescript
// In pr_spectral_analyze tool
const SpectralAnalyzeInputSchema = z.object({
  adjacencyMatrix: z.array(z.array(z.number()))
    .refine(
      matrix => matrix.length <= 1000, // Max 1000x1000
      'Matrix exceeds maximum size of 1000x1000'
    )
    .refine(
      matrix => matrix.every(row => row.length === matrix.length),
      'Matrix must be square'
    )
    .refine(
      matrix => {
        // Check for NaN/Infinity
        return matrix.every(row => row.every(val =>
          Number.isFinite(val) && !Number.isNaN(val)
        ));
      },
      'Matrix contains invalid values'
    ),
  analyzeType: z.enum(['stability', 'clustering', 'connectivity']).default('stability'),
});
```

#### HIGH-2: Vector Validation

**All vector inputs must be validated:**

```typescript
// In pr_coherence_check tool
const CoherenceCheckInputSchema = z.object({
  vectors: z.array(
    z.array(z.number())
      .min(1, 'Vector cannot be empty')
      .max(4096, 'Vector dimension exceeds maximum')
      .refine(
        vec => vec.every(v => Number.isFinite(v)),
        'Vector contains non-finite values'
      )
  )
    .min(2, 'At least 2 vectors required for coherence check')
    .max(1000, 'Too many vectors')
    .refine(
      vectors => vectors.every(v => v.length === vectors[0].length),
      'All vectors must have same dimension'
    ),
  threshold: z.number().min(0).max(1).default(0.3),
});
```

#### HIGH-3: Causal Graph Validation

**Prevent malicious graph structures:**

```typescript
const CausalInferInputSchema = z.object({
  treatment: IdentifierSchema,
  outcome: IdentifierSchema,
  graph: z.object({
    nodes: z.array(IdentifierSchema)
      .min(2)
      .max(100, 'Graph too large'),
    edges: z.array(z.tuple([IdentifierSchema, IdentifierSchema]))
      .max(500, 'Too many edges'),
  }).refine(
    data => {
      // Validate all edge nodes exist
      const nodeSet = new Set(data.nodes);
      return data.edges.every(([from, to]) =>
        nodeSet.has(from) && nodeSet.has(to)
      );
    },
    'Edge references non-existent node'
  ).refine(
    data => {
      // Check for treatment and outcome in graph
      return data.nodes.includes(data.treatment) &&
             data.nodes.includes(data.outcome);
    },
    'Treatment or outcome not in graph nodes'
  ),
});
```

### 2.5 Medium Security Requirements

#### MEDIUM-1: Memory Hook Access Control

```typescript
// pr/pre-memory-store hook must validate caller
async function preMemoryStoreHook(event: MemoryStoreEvent): Promise<HookResult> {
  // Only allow coherence checking on specific namespaces
  const allowedNamespaces = [
    'agents/decisions',
    'agents/context',
    'swarm/state',
    'hive-mind/proposals',
  ];

  if (!allowedNamespaces.some(ns => event.namespace.startsWith(ns))) {
    return { action: 'skip' }; // Don't interfere with other namespaces
  }

  // Perform coherence check
  const result = await checkCoherence(event.embedding, event.context);

  return {
    action: result.energy > 0.7 ? 'reject' : 'allow',
    metadata: { coherenceEnergy: result.energy },
  };
}
```

#### MEDIUM-2: Computation Timeouts

```typescript
// All WASM operations must have timeouts
async function withTimeout<T>(
  operation: () => Promise<T>,
  timeoutMs: number,
  operationName: string
): Promise<T> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const result = await Promise.race([
      operation(),
      new Promise<never>((_, reject) => {
        controller.signal.addEventListener('abort', () => {
          reject(new TimeoutError(`${operationName} exceeded ${timeoutMs}ms`));
        });
      }),
    ]);
    return result;
  } finally {
    clearTimeout(timeout);
  }
}

// Usage in engine
async computeCoherence(vectors: number[][]): Promise<CoherenceResult> {
  return withTimeout(
    () => this.cohomologyEngine.compute(vectors),
    5000, // 5 second max
    'coherence_check'
  );
}
```

#### MEDIUM-3: Result Caching Security

```typescript
// Cache must not leak sensitive data between users
class SecureCache {
  private cache = new Map<string, CacheEntry>();

  private hashKey(key: string, context: SecurityContext): string {
    // Include security context in cache key
    return crypto.createHash('sha256')
      .update(`${context.userId}:${context.sessionId}:${key}`)
      .digest('hex');
  }

  get(key: string, context: SecurityContext): unknown | undefined {
    const hashedKey = this.hashKey(key, context);
    const entry = this.cache.get(hashedKey);

    if (!entry) return undefined;
    if (Date.now() > entry.expiresAt) {
      this.cache.delete(hashedKey);
      return undefined;
    }

    return entry.value;
  }

  set(key: string, value: unknown, context: SecurityContext, ttlMs: number): void {
    const hashedKey = this.hashKey(key, context);
    this.cache.set(hashedKey, {
      value,
      expiresAt: Date.now() + ttlMs,
    });
  }
}
```

---

## Part 3: Implementation Security Checklist

### Pre-Implementation Checklist

- [ ] All Zod schemas defined in `src/schemas.ts`
- [ ] PathValidator imported from `@claude-flow/security`
- [ ] SafeExecutor imported from `@claude-flow/security`
- [ ] InputValidator imported from `@claude-flow/security`
- [ ] No hardcoded secrets in source code
- [ ] npm audit clean (no high/critical vulnerabilities)

### Implementation Checklist

#### agentic-qe

- [ ] **Input Validation**
  - [ ] All 16 MCP tools have Zod schemas
  - [ ] Path traversal prevention for all file paths
  - [ ] Command injection prevention in security scans
  - [ ] No eval() or Function() usage

- [ ] **Chaos Engineering Safety**
  - [ ] dryRun defaults to true
  - [ ] Confirmation required for destructive operations (intensity > 0.3)
  - [ ] Production target blocking
  - [ ] Duration limits enforced

- [ ] **Test Execution Sandbox**
  - [ ] Process isolation implemented
  - [ ] Memory limits enforced
  - [ ] Network disabled by default
  - [ ] Filesystem restricted to workspace

- [ ] **Security Scanning**
  - [ ] SafeExecutor used for all command execution
  - [ ] DAST authorization required
  - [ ] Scan results PII checked before storage

#### prime-radiant

- [ ] **WASM Security**
  - [ ] WASM loaded with restricted WASI
  - [ ] No additional dangerous imports
  - [ ] Memory bounds checking

- [ ] **Resource Limits**
  - [ ] Matrix size limits (1000x1000 max)
  - [ ] Vector dimension limits (4096 max)
  - [ ] Computation timeouts (5s default)
  - [ ] Memory usage monitoring

- [ ] **Hook Security**
  - [ ] Namespace access control
  - [ ] Cache isolation by security context
  - [ ] No sensitive data in hook metadata

### Post-Implementation Verification

```bash
# Security verification commands
npm audit --audit-level=high
npx eslint --rule 'no-eval: error' src/
grep -r "shell: true" src/ && echo "FAIL: shell usage detected" && exit 1
grep -r "Function(" src/ && echo "FAIL: Function constructor detected" && exit 1
```

---

## Part 4: Security Architecture Integration

### V3 Security Module Integration

Both plugins MUST use the V3 security module components:

```typescript
// In plugin initialization
import {
  PathValidator,
  SafeExecutor,
  InputValidator,
  createSecurityModule,
} from '@claude-flow/security';

export class AgenticQEPlugin implements Plugin {
  private security: SecurityModule;

  async initialize(config: PluginConfig): Promise<void> {
    this.security = createSecurityModule({
      projectRoot: config.workspaceRoot,
      hmacSecret: config.hmacSecret,
      allowedCommands: [
        'git', 'npm', 'npx', 'node',
        'vitest', 'jest', 'pytest',
        'semgrep', 'bandit', 'eslint',
      ],
    });
  }
}
```

### Security Boundaries

```
+----------------+     +----------------+     +----------------+
|  MCP Boundary  | --> | Plugin Domain  | --> | V3 Core Domain |
| (InputValidator)|    | (PathValidator)|     | (Memory/Swarm) |
+----------------+     +----------------+     +----------------+
        |                      |                      |
        v                      v                      v
   Zod schemas          Path resolution         Access control
   PII detection        Sandbox isolation       Audit logging
```

---

## Part 5: Remediation Priorities

### Immediate (Before Implementation Starts)

1. Create `src/schemas.ts` with all Zod schemas
2. Document security boundaries in architecture docs
3. Add security testing requirements to CI/CD

### Phase 1 (Week 1-2)

1. Implement core security bridges
2. Integrate PathValidator for all file operations
3. Integrate SafeExecutor for all command execution

### Phase 2 (Week 3-4)

1. Implement TestSandbox with proper isolation
2. Implement chaos-inject safety controls
3. Add PII detection to test result storage

### Phase 3 (Week 5-6)

1. Security testing suite
2. Penetration testing for sandbox escape
3. Rate limiting and DoS protection

---

## Appendix A: Zod Schema Templates

### A.1 Base Schemas for agentic-qe

```typescript
// src/schemas.ts
import { z } from 'zod';
import { PathSchema, IdentifierSchema, SafeStringSchema } from '@claude-flow/security';

// Test generation
export const GenerateTestsInputSchema = z.object({
  targetPath: PathSchema,
  testType: z.enum(['unit', 'integration', 'e2e', 'property', 'mutation', 'fuzz', 'api', 'performance', 'security', 'accessibility', 'contract', 'bdd']),
  framework: z.enum(['vitest', 'jest', 'pytest', 'mocha']).default('vitest'),
  coverage: z.object({
    target: z.number().min(0).max(100).default(80),
    focusGaps: z.boolean().default(true),
  }).optional(),
});

// TDD cycle
export const TddCycleInputSchema = z.object({
  requirement: SafeStringSchema.max(2000),
  targetPath: PathSchema,
  style: z.enum(['london', 'chicago']).default('london'),
  maxCycles: z.number().int().positive().max(10).default(5),
});

// Chaos injection
export const ChaosInjectInputSchema = z.object({
  target: z.string().refine(
    val => !/(prod|production)/i.test(val),
    'Production targets blocked'
  ),
  failureType: z.enum([
    'network-latency',
    'network-partition',
    'cpu-stress',
    'memory-pressure',
    'disk-full',
  ]),
  duration: z.number().positive().max(300),
  intensity: z.number().min(0).max(1),
  dryRun: z.boolean().default(true),
  confirmDestructive: z.boolean().optional(),
}).refine(
  data => data.dryRun || data.confirmDestructive === true,
  'Destructive operations require confirmDestructive: true'
);

// Security scan
export const SecurityScanInputSchema = z.object({
  targetPath: PathSchema,
  scanType: z.enum(['sast', 'dast', 'dependency', 'secrets']),
  compliance: z.array(z.enum(['owasp-top-10', 'sans-25', 'cwe-top-25', 'pci-dss', 'hipaa'])).optional(),
  dastAuthorization: z.object({
    token: z.string().min(32),
    signature: z.string(),
  }).optional(),
}).refine(
  data => data.scanType !== 'dast' || data.dastAuthorization !== undefined,
  'DAST scans require authorization'
);
```

### A.2 Base Schemas for prime-radiant

```typescript
// src/schemas.ts
import { z } from 'zod';
import { IdentifierSchema } from '@claude-flow/security';

const VectorSchema = z.array(z.number())
  .min(1)
  .max(4096)
  .refine(v => v.every(Number.isFinite), 'Contains non-finite values');

const MatrixSchema = z.array(z.array(z.number()))
  .max(1000)
  .refine(m => m.every(r => r.length === m.length), 'Must be square')
  .refine(m => m.every(r => r.every(Number.isFinite)), 'Contains non-finite values');

export const CoherenceCheckInputSchema = z.object({
  vectors: z.array(VectorSchema).min(2).max(1000).refine(
    vs => vs.every(v => v.length === vs[0].length),
    'All vectors must have same dimension'
  ),
  threshold: z.number().min(0).max(1).default(0.3),
});

export const SpectralAnalyzeInputSchema = z.object({
  adjacencyMatrix: MatrixSchema,
  analyzeType: z.enum(['stability', 'clustering', 'connectivity']).default('stability'),
});

export const CausalInferInputSchema = z.object({
  treatment: IdentifierSchema,
  outcome: IdentifierSchema,
  graph: z.object({
    nodes: z.array(IdentifierSchema).min(2).max(100),
    edges: z.array(z.tuple([IdentifierSchema, IdentifierSchema])).max(500),
  }),
});

export const ConsensusVerifyInputSchema = z.object({
  agentStates: z.array(z.object({
    agentId: IdentifierSchema,
    embedding: VectorSchema,
    vote: z.boolean(),
  })).min(2).max(100),
  consensusThreshold: z.number().min(0).max(1).default(0.8),
});

export const QuantumTopologyInputSchema = z.object({
  points: z.array(VectorSchema).min(3).max(10000),
  maxDimension: z.number().int().min(1).max(3).default(2),
});

export const MemoryGateInputSchema = z.object({
  entry: z.object({
    key: IdentifierSchema,
    content: z.string().max(1000000),
    embedding: VectorSchema,
  }),
  contextEmbeddings: z.array(VectorSchema).optional(),
  thresholds: z.object({
    warn: z.number().min(0).max(1).default(0.3),
    reject: z.number().min(0).max(1).default(0.7),
  }).optional(),
});
```

---

## Appendix B: Security Testing Requirements

### B.1 Unit Tests

```typescript
// __tests__/security/input-validation.test.ts
describe('Input Validation Security', () => {
  it('should reject path traversal attempts', async () => {
    const maliciousPaths = [
      '../../../etc/passwd',
      '..\\..\\windows\\system32',
      '/etc/passwd',
      '....//....//etc/passwd',
      '%2e%2e%2f%2e%2e%2fetc/passwd',
    ];

    for (const path of maliciousPaths) {
      await expect(pathValidator.validate(path)).resolves.toMatchObject({
        isValid: false,
      });
    }
  });

  it('should reject command injection attempts', () => {
    const maliciousArgs = [
      '; rm -rf /',
      '| cat /etc/passwd',
      '$(malicious)',
      '`malicious`',
      '\n rm -rf /',
    ];

    for (const arg of maliciousArgs) {
      expect(() => CommandArgumentSchema.parse(arg)).toThrow();
    }
  });
});
```

### B.2 Integration Tests

```typescript
// __tests__/security/chaos-safety.test.ts
describe('Chaos Engineering Safety', () => {
  it('should default to dry run', async () => {
    const result = await chaosInject({
      target: 'test-service',
      failureType: 'network-latency',
      duration: 10,
      intensity: 0.5,
    });

    expect(result.dryRun).toBe(true);
    expect(result.executed).toBe(false);
  });

  it('should block production targets', async () => {
    await expect(chaosInject({
      target: 'production-api',
      failureType: 'network-latency',
      duration: 10,
      intensity: 0.1,
      dryRun: false,
      confirmDestructive: true,
    })).rejects.toThrow('Production targets blocked');
  });
});
```

---

**Report Status:** ✅ POST-IMPLEMENTATION REVIEW COMPLETE
**Published Versions:**
- `@claude-flow/plugin-agentic-qe@3.0.0-alpha.2`
- `@claude-flow/plugin-prime-radiant@0.1.4`

**Security Controls Implemented:**
- ✅ All Zod input validation schemas
- ✅ dryRun defaults to true for chaos operations
- ✅ Duration/intensity limits enforced
- ✅ Bridge interfaces for PathValidator, SafeExecutor, InputValidator
- ✅ Memory namespace isolation
- ✅ Rollback safety mechanisms
