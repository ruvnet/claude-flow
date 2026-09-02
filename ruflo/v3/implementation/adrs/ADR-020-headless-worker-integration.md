# ADR-020: Headless Worker Integration Architecture

**Status:** Implemented
**Date:** 2026-01-07
**Updated:** 2026-01-08
**Author:** System Architecture Designer
**Version:** 1.1.0
**Extends:** ADR-019 (Headless Runtime Package)

## Context

The V3 worker daemon (`WorkerDaemon`) currently runs 12 background workers that perform metrics collection, security auditing, and optimization tasks. These workers execute **local logic** (file scanning, JSON generation).

By integrating `CLAUDE_CODE_HEADLESS` mode, workers can:
1. **Invoke Claude Code** for intelligent analysis (not just file scanning)
2. **Execute in sandboxed environments** per worker type
3. **Scale across containers** for parallel AI execution
4. **Chain worker outputs** to Claude Code prompts

## Decision

Extend the existing `WorkerDaemon` with a new `HeadlessWorkerExecutor` that enables workers to invoke Claude Code headlessly with configurable sandbox profiles.

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────┐
│                         WorkerDaemon (V3)                           │
├─────────────────────────────────────────────────────────────────────┤
│  Workers:                                                           │
│  ┌─────────┐ ┌─────────┐ ┌─────────┐ ┌─────────┐ ┌─────────┐       │
│  │   map   │ │  audit  │ │optimize │ │testgaps │ │document │       │
│  │ (local) │ │(headless)│ │(headless)│ │(headless)│ │(headless)│    │
│  └────┬────┘ └────┬────┘ └────┬────┘ └────┬────┘ └────┬────┘       │
│       │          │          │          │          │                │
│       ▼          ▼          ▼          ▼          ▼                │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │              HeadlessWorkerExecutor                          │   │
│  │  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐       │   │
│  │  │   Sandbox    │  │   Process    │  │    Output    │       │   │
│  │  │   Manager    │  │     Pool     │  │   Collector  │       │   │
│  │  └──────────────┘  └──────────────┘  └──────────────┘       │   │
│  └─────────────────────────────────────────────────────────────┘   │
│                                ▼                                    │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │                  Claude Code (Headless)                      │   │
│  │  CLAUDE_CODE_HEADLESS=true                                   │   │
│  │  CLAUDE_CODE_SANDBOX_MODE=<per-worker>                       │   │
│  └─────────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────┘
```

---

## Enhanced Worker Types

### Worker Execution Modes

| Worker | Mode | Sandbox | Use Case |
|--------|------|---------|----------|
| `map` | local | N/A | Fast file scanning (no AI needed) |
| `audit` | **headless** | strict | AI-powered security analysis |
| `optimize` | **headless** | permissive | AI-suggested optimizations |
| `consolidate` | local | N/A | Memory cleanup (no AI needed) |
| `testgaps` | **headless** | permissive | AI-generated test suggestions |
| `predict` | **headless** | strict | Predictive preloading |
| `document` | **headless** | permissive | AI-generated documentation |
| `ultralearn` | **headless** | strict | Deep knowledge acquisition |
| `refactor` | **headless** | permissive | AI refactoring suggestions |
| `benchmark` | local | N/A | Performance measurement |
| `deepdive` | **headless** | strict | AI code analysis |
| `preload` | local | N/A | Resource caching |

### Headless Worker Definition

```typescript
// src/services/headless-worker-executor.ts

export interface HeadlessWorkerConfig extends WorkerConfig {
  // Execution mode
  mode: 'local' | 'headless';

  // Headless-specific options
  headless?: {
    // Prompt template for Claude Code
    promptTemplate: string;

    // Sandbox profile
    sandbox: 'strict' | 'permissive' | 'disabled';

    // Model to use
    model?: 'sonnet' | 'opus' | 'haiku';

    // Max tokens for output
    maxOutputTokens?: number;

    // Timeout (overrides default)
    timeoutMs?: number;

    // Files to include as context
    contextPatterns?: string[];

    // Output parsing
    outputFormat?: 'text' | 'json' | 'markdown';
  };
}

// Enhanced worker configurations
export const HEADLESS_WORKERS: HeadlessWorkerConfig[] = [
  // LOCAL WORKERS (unchanged)
  {
    type: 'map',
    mode: 'local',
    intervalMs: 15 * 60 * 1000,
    priority: 'normal',
    description: 'Codebase mapping',
    enabled: true,
  },
  {
    type: 'consolidate',
    mode: 'local',
    intervalMs: 30 * 60 * 1000,
    priority: 'low',
    description: 'Memory consolidation',
    enabled: true,
  },
  {
    type: 'benchmark',
    mode: 'local',
    intervalMs: 60 * 60 * 1000,
    priority: 'low',
    description: 'Performance benchmarking',
    enabled: false,
  },
  {
    type: 'preload',
    mode: 'local',
    intervalMs: 5 * 60 * 1000,
    priority: 'low',
    description: 'Resource preloading',
    enabled: false,
  },

  // HEADLESS WORKERS (AI-powered)
  {
    type: 'audit',
    mode: 'headless',
    intervalMs: 30 * 60 * 1000,
    priority: 'critical',
    description: 'AI-powered security analysis',
    enabled: true,
    headless: {
      promptTemplate: `Analyze this codebase for security vulnerabilities:
        - Check for hardcoded secrets (API keys, passwords)
        - Identify SQL injection risks
        - Find XSS vulnerabilities
        - Check for insecure dependencies
        - Identify authentication/authorization issues

        Provide a JSON report with:
        {
          "vulnerabilities": [{ "severity": "high|medium|low", "file": "...", "line": N, "description": "..." }],
          "riskScore": 0-100,
          "recommendations": ["..."]
        }`,
      sandbox: 'strict',
      model: 'haiku',  // Fast for security checks
      outputFormat: 'json',
      contextPatterns: ['**/*.ts', '**/*.js', '**/.env*', '**/package.json'],
    },
  },
  {
    type: 'optimize',
    mode: 'headless',
    intervalMs: 60 * 60 * 1000,
    priority: 'normal',
    description: 'AI optimization suggestions',
    enabled: true,
    headless: {
      promptTemplate: `Analyze this codebase for performance optimizations:
        - Identify N+1 query patterns
        - Find unnecessary re-renders in React
        - Suggest caching opportunities
        - Identify memory leaks
        - Find redundant computations

        Provide actionable suggestions with code examples.`,
      sandbox: 'permissive',
      model: 'sonnet',
      outputFormat: 'markdown',
      contextPatterns: ['src/**/*.ts', 'src/**/*.tsx'],
    },
  },
  {
    type: 'testgaps',
    mode: 'headless',
    intervalMs: 60 * 60 * 1000,
    priority: 'normal',
    description: 'AI test gap analysis',
    enabled: true,
    headless: {
      promptTemplate: `Analyze test coverage and identify gaps:
        - Find untested functions and classes
        - Identify edge cases not covered
        - Suggest new test scenarios
        - Check for missing error handling tests
        - Identify integration test gaps

        For each gap, provide a test skeleton.`,
      sandbox: 'permissive',
      model: 'sonnet',
      outputFormat: 'markdown',
      contextPatterns: ['src/**/*.ts', 'tests/**/*.ts', '__tests__/**/*.ts'],
    },
  },
  {
    type: 'document',
    mode: 'headless',
    intervalMs: 120 * 60 * 1000,
    priority: 'low',
    description: 'AI documentation generation',
    enabled: false,
    headless: {
      promptTemplate: `Generate documentation for undocumented code:
        - Add JSDoc comments to functions
        - Create README sections for modules
        - Document API endpoints
        - Add inline comments for complex logic
        - Generate usage examples

        Focus on public APIs and exported functions.`,
      sandbox: 'permissive',
      model: 'haiku',  // Fast for documentation
      outputFormat: 'markdown',
      contextPatterns: ['src/**/*.ts'],
    },
  },
  {
    type: 'ultralearn',
    mode: 'headless',
    intervalMs: 0,  // Manual trigger only
    priority: 'normal',
    description: 'Deep knowledge acquisition',
    enabled: false,
    headless: {
      promptTemplate: `Deeply analyze this codebase to learn:
        - Architectural patterns used
        - Coding conventions
        - Domain-specific terminology
        - Common patterns and idioms
        - Team preferences

        Store insights for future context.`,
      sandbox: 'strict',
      model: 'opus',  // Deep analysis
      outputFormat: 'json',
      contextPatterns: ['**/*.ts', '**/CLAUDE.md', '**/README.md'],
    },
  },
  {
    type: 'refactor',
    mode: 'headless',
    intervalMs: 0,  // Manual trigger only
    priority: 'normal',
    description: 'AI refactoring suggestions',
    enabled: false,
    headless: {
      promptTemplate: `Suggest refactoring opportunities:
        - Identify code duplication
        - Suggest better abstractions
        - Find opportunities for design patterns
        - Identify overly complex functions
        - Suggest module reorganization

        Provide before/after code examples.`,
      sandbox: 'permissive',
      model: 'sonnet',
      outputFormat: 'markdown',
      contextPatterns: ['src/**/*.ts'],
    },
  },
  {
    type: 'deepdive',
    mode: 'headless',
    intervalMs: 0,  // Manual trigger only
    priority: 'normal',
    description: 'Deep code analysis',
    enabled: false,
    headless: {
      promptTemplate: `Perform deep analysis of this codebase:
        - Understand data flow
        - Map dependencies
        - Identify architectural issues
        - Find potential bugs
        - Analyze error handling

        Provide comprehensive report.`,
      sandbox: 'strict',
      model: 'opus',
      outputFormat: 'markdown',
      contextPatterns: ['src/**/*.ts'],
    },
  },
  {
    type: 'predict',
    mode: 'headless',
    intervalMs: 10 * 60 * 1000,
    priority: 'low',
    description: 'Predictive preloading',
    enabled: false,
    headless: {
      promptTemplate: `Based on recent activity, predict what the developer needs:
        - Files likely to be edited next
        - Tests that should be run
        - Documentation to reference
        - Dependencies to check

        Provide preload suggestions.`,
      sandbox: 'strict',
      model: 'haiku',
      outputFormat: 'json',
      contextPatterns: ['.claude-flow/metrics/*.json'],
    },
  },
];
```

---

## HeadlessWorkerExecutor Implementation

```typescript
// src/services/headless-worker-executor.ts

import { spawn } from 'child_process';
import { EventEmitter } from 'events';
import { glob } from 'glob';
import { readFileSync } from 'fs';
import { join } from 'path';

export interface HeadlessExecutionResult {
  success: boolean;
  output: string;
  parsedOutput?: unknown;
  durationMs: number;
  tokensUsed?: number;
  model: string;
  sandboxMode: string;
}

export class HeadlessWorkerExecutor extends EventEmitter {
  private projectRoot: string;
  private processPool: Map<string, ChildProcess> = new Map();
  private maxConcurrent: number;

  constructor(projectRoot: string, options?: { maxConcurrent?: number }) {
    super();
    this.projectRoot = projectRoot;
    this.maxConcurrent = options?.maxConcurrent ?? 2;
  }

  /**
   * Execute a headless worker
   */
  async execute(config: HeadlessWorkerConfig): Promise<HeadlessExecutionResult> {
    if (config.mode !== 'headless' || !config.headless) {
      throw new Error(`Worker ${config.type} is not configured for headless execution`);
    }

    const startTime = Date.now();
    const { headless } = config;

    // Build context from file patterns
    const context = await this.buildContext(headless.contextPatterns || []);

    // Build the full prompt
    const fullPrompt = this.buildPrompt(headless.promptTemplate, context);

    // Execute Claude Code headlessly
    const result = await this.executeClaudeCode(fullPrompt, {
      sandbox: headless.sandbox,
      model: headless.model,
      timeoutMs: headless.timeoutMs || config.intervalMs || 300000,
    });

    // Parse output if JSON expected
    let parsedOutput: unknown;
    if (headless.outputFormat === 'json') {
      try {
        parsedOutput = JSON.parse(result.output);
      } catch {
        // Keep raw output if parsing fails
      }
    }

    return {
      success: result.success,
      output: result.output,
      parsedOutput,
      durationMs: Date.now() - startTime,
      tokensUsed: result.tokensUsed,
      model: headless.model || 'sonnet',
      sandboxMode: headless.sandbox,
    };
  }

  /**
   * Build context from file patterns
   */
  private async buildContext(patterns: string[]): Promise<string> {
    if (patterns.length === 0) return '';

    const files: string[] = [];
    for (const pattern of patterns) {
      const matches = await glob(pattern, { cwd: this.projectRoot });
      files.push(...matches);
    }

    // Limit to reasonable context size
    const maxFiles = 20;
    const maxCharsPerFile = 5000;
    const selectedFiles = files.slice(0, maxFiles);

    const contextParts: string[] = [];
    for (const file of selectedFiles) {
      try {
        const content = readFileSync(join(this.projectRoot, file), 'utf-8');
        const truncated = content.slice(0, maxCharsPerFile);
        contextParts.push(`--- ${file} ---\n${truncated}`);
      } catch {
        // Skip unreadable files
      }
    }

    return contextParts.join('\n\n');
  }

  /**
   * Build full prompt with context
   */
  private buildPrompt(template: string, context: string): string {
    return `${template}

## Codebase Context

${context || 'No context files provided.'}

## Instructions

Analyze the above codebase and provide your response.`;
  }

  /**
   * Execute Claude Code in headless mode
   */
  private async executeClaudeCode(
    prompt: string,
    options: {
      sandbox: 'strict' | 'permissive' | 'disabled';
      model?: string;
      timeoutMs: number;
    }
  ): Promise<{ success: boolean; output: string; tokensUsed?: number }> {
    return new Promise((resolve, reject) => {
      const env = {
        ...process.env,
        CLAUDE_CODE_HEADLESS: 'true',
        CLAUDE_CODE_SANDBOX_MODE: options.sandbox,
        ANTHROPIC_MODEL: options.model || 'claude-sonnet-4-20250514',
      };

      // Use claude CLI directly
      const child = spawn('claude', ['--print', prompt], {
        cwd: this.projectRoot,
        env,
        timeout: options.timeoutMs,
      });

      let stdout = '';
      let stderr = '';

      child.stdout?.on('data', (data) => {
        stdout += data.toString();
        this.emit('output', { type: 'stdout', data: data.toString() });
      });

      child.stderr?.on('data', (data) => {
        stderr += data.toString();
        this.emit('output', { type: 'stderr', data: data.toString() });
      });

      child.on('close', (code) => {
        resolve({
          success: code === 0,
          output: stdout || stderr,
        });
      });

      child.on('error', (error) => {
        reject(error);
      });

      // Timeout handling
      setTimeout(() => {
        child.kill('SIGTERM');
        reject(new Error(`Execution timed out after ${options.timeoutMs}ms`));
      }, options.timeoutMs);
    });
  }

  /**
   * Check if Claude Code is available
   */
  async isAvailable(): Promise<boolean> {
    try {
      const { execSync } = await import('child_process');
      execSync('claude --version', { stdio: 'pipe' });
      return true;
    } catch {
      return false;
    }
  }
}
```

---

## Enhanced WorkerDaemon Integration

```typescript
// src/services/worker-daemon.ts (enhanced)

import { HeadlessWorkerExecutor, HeadlessWorkerConfig, HEADLESS_WORKERS } from './headless-worker-executor.js';

export class WorkerDaemon extends EventEmitter {
  private headlessExecutor: HeadlessWorkerExecutor | null = null;
  private headlessAvailable = false;

  constructor(projectRoot: string, config?: Partial<DaemonConfig>) {
    super();
    // ... existing constructor code ...

    // Initialize headless executor
    this.initHeadlessExecutor();
  }

  /**
   * Initialize headless executor if Claude Code is available
   */
  private async initHeadlessExecutor(): Promise<void> {
    this.headlessExecutor = new HeadlessWorkerExecutor(this.projectRoot, {
      maxConcurrent: this.config.maxConcurrent,
    });

    this.headlessAvailable = await this.headlessExecutor.isAvailable();

    if (this.headlessAvailable) {
      this.log('info', 'Claude Code headless mode available - AI workers enabled');
    } else {
      this.log('warn', 'Claude Code not found - AI workers will run in local mode');
    }
  }

  /**
   * Run worker logic (enhanced with headless support)
   */
  private async runWorkerLogic(workerConfig: WorkerConfig): Promise<unknown> {
    // Check if this is a headless worker
    const headlessConfig = HEADLESS_WORKERS.find(w => w.type === workerConfig.type);

    if (headlessConfig?.mode === 'headless' && this.headlessAvailable && this.headlessExecutor) {
      this.log('info', `Running ${workerConfig.type} in headless mode`);
      return this.headlessExecutor.execute(headlessConfig);
    }

    // Fall back to local execution
    switch (workerConfig.type) {
      case 'map':
        return this.runMapWorker();
      case 'audit':
        return this.runAuditWorkerLocal(); // Fallback if no Claude Code
      // ... other workers ...
    }
  }

  /**
   * Local audit worker (fallback when headless unavailable)
   */
  private async runAuditWorkerLocal(): Promise<unknown> {
    // Basic file-based security checks (existing implementation)
    return {
      timestamp: new Date().toISOString(),
      mode: 'local',
      checks: {
        envFilesProtected: true,
        gitIgnoreExists: true,
      },
      note: 'Install Claude Code for AI-powered security analysis',
    };
  }
}
```

---

## CLI Integration

### New Daemon Flags

```bash
# Start daemon with headless workers
npx claude-flow@v3alpha daemon start --headless

# Start with specific sandbox mode for all workers
npx claude-flow@v3alpha daemon start --sandbox strict

# Trigger headless worker manually
npx claude-flow@v3alpha daemon trigger -w audit --headless

# Show worker modes
npx claude-flow@v3alpha daemon status --show-modes
```

### Output Example

```
┌─────────────────────────────────────────────────────┐
│                   Worker Daemon                     │
├─────────────────────────────────────────────────────┤
│ Status: ● RUNNING (background)                      │
│ PID: 12345                                          │
│ Started: 2026-01-07T23:00:00Z                       │
│ Claude Code: ✓ Available (headless enabled)        │
│ Workers: 5 enabled (3 headless, 2 local)            │
└─────────────────────────────────────────────────────┘

Worker Status
┌────────────┬────────┬──────────┬─────────┬──────────┐
│ Worker     │ Mode   │ Sandbox  │ Status  │ Last Run │
├────────────┼────────┼──────────┼─────────┼──────────┤
│ map        │ local  │ -        │ idle    │ 5m ago   │
│ audit      │ headless│ strict  │ idle    │ 10m ago  │
│ optimize   │ headless│ permissive│ running │ -       │
│ testgaps   │ headless│ permissive│ idle   │ 30m ago  │
│ consolidate│ local  │ -        │ idle    │ 15m ago  │
└────────────┴────────┴──────────┴─────────┴──────────┘
```

---

## Docker-Based Worker Pool

For high-throughput scenarios, workers can run in container pools:

```typescript
// src/services/container-worker-pool.ts

export class ContainerWorkerPool {
  private containers: Map<string, ContainerInfo> = new Map();
  private config: ContainerPoolConfig;

  constructor(config: ContainerPoolConfig) {
    this.config = config;
  }

  /**
   * Execute worker in isolated container
   */
  async executeWorkerInContainer(
    worker: HeadlessWorkerConfig
  ): Promise<HeadlessExecutionResult> {
    const container = await this.acquireContainer();

    try {
      // Mount workspace and execute
      const result = await container.exec([
        'npx', 'claude-flow@v3alpha', 'daemon', 'trigger',
        '-w', worker.type,
        '--headless',
        '--sandbox', worker.headless?.sandbox || 'strict',
      ]);

      return this.parseResult(result);
    } finally {
      await this.releaseContainer(container);
    }
  }

  /**
   * Scale pool for parallel worker execution
   */
  async scaleForBatchExecution(workerCount: number): Promise<void> {
    const targetSize = Math.min(workerCount, this.config.maxContainers);
    await this.ensureContainerCount(targetSize);
  }
}
```

### Docker Compose for Worker Pool

```yaml
# docker-compose.workers.yml
version: '3.8'

services:
  worker-pool:
    image: ghcr.io/ruvnet/claude-flow-headless:latest
    deploy:
      replicas: 3
      resources:
        limits:
          cpus: '2'
          memory: 4G
    environment:
      - ANTHROPIC_API_KEY=${ANTHROPIC_API_KEY}
      - CLAUDE_CODE_HEADLESS=true
      - CLAUDE_CODE_SANDBOX_MODE=strict
    volumes:
      - workspace:/workspace:ro
      - claude-flow-state:/root/.claude-flow
    command: daemon start --foreground --workers audit,optimize,testgaps

  queue-manager:
    image: ghcr.io/ruvnet/claude-flow-headless:latest
    environment:
      - REDIS_URL=redis://redis:6379
    depends_on:
      - redis
    command: queue manager --workers 3

  redis:
    image: redis:7-alpine
    volumes:
      - redis-data:/data

volumes:
  workspace:
  claude-flow-state:
  redis-data:
```

---

## Benefits of Integration

| Benefit | Local Workers | Headless Workers |
|---------|--------------|------------------|
| Speed | Fast (ms) | Slower (seconds) |
| Intelligence | Pattern-based | AI-powered |
| Resource Usage | Low | Medium |
| Accuracy | Limited | High |
| Context Understanding | None | Full codebase |
| Suggestions Quality | Basic | Expert-level |

### Use Case Matrix

| Scenario | Recommended Workers |
|----------|---------------------|
| CI/CD Pipeline | audit (headless), testgaps (headless) |
| Development | map (local), optimize (headless) |
| Code Review | deepdive (headless), refactor (headless) |
| Documentation Sprint | document (headless) |
| Security Audit | audit (headless, strict sandbox) |
| Performance Tuning | benchmark (local), optimize (headless) |

---

## Implementation Phases

### Phase 1: Core Integration (Week 1) ✅ COMPLETE
1. ✅ Add `HeadlessWorkerExecutor` to existing daemon
2. ✅ Create headless worker configurations
3. ✅ Implement graceful fallback for missing Claude Code
4. ✅ Add `--headless` flag to CLI

### Phase 2: Sandbox Profiles (Week 2) ✅ COMPLETE
1. ✅ Implement per-worker sandbox configuration
2. ✅ Add sandbox validation
3. ✅ Create security policies for each worker type
4. ✅ Add monitoring for sandbox violations

### Phase 3: Container Pool (Week 3) ✅ COMPLETE
1. ✅ Create `ContainerWorkerPool` (src/services/container-worker-pool.ts)
2. ✅ Docker image with pre-installed Claude Code (docker/Dockerfile.headless)
3. ✅ Docker Compose for local development (docker/docker-compose.workers.yml)
4. ⏳ Kubernetes manifests for production (future enhancement)

### Phase 4: Queue Integration (Week 4) ✅ COMPLETE
1. ✅ Redis-based worker queue (src/services/worker-queue.ts)
2. ✅ Priority scheduling for headless workers
3. ✅ Result persistence with TTL
4. ⏳ Web dashboard for monitoring (future enhancement)

---

## Consequences

### Positive

1. **AI-Powered Workers** - Intelligent analysis beyond pattern matching
2. **Sandboxed Execution** - Security-first worker execution
3. **Scalable** - Container pools for high throughput
4. **Graceful Degradation** - Works without Claude Code (local mode)
5. **Unified System** - Single daemon manages all worker types

### Negative

1. **Complexity** - More configuration options
2. **Cost** - API usage for headless workers
3. **Latency** - Headless workers slower than local

### Neutral

1. **Optional** - Users can disable headless mode
2. **Backward Compatible** - Existing local workers unchanged

---

## References

- ADR-019: @claude-flow/headless Runtime Package
- ADR-014: Workers System
- V3 Worker Daemon: `src/services/worker-daemon.ts`
- Claude Code Environment Variables

---

**Status:** Implemented
**Implementation:** All 4 phases complete (2026-01-08)

### Implementation Files:
- `src/services/headless-worker-executor.ts` - Core executor with 8 AI workers
- `src/services/worker-daemon.ts` - Enhanced daemon with headless integration
- `src/services/container-worker-pool.ts` - Docker container pool management
- `src/services/worker-queue.ts` - Redis-based task queue with priority scheduling
- `docker/Dockerfile.headless` - Worker container image
- `docker/docker-compose.workers.yml` - Multi-container orchestration
- `__tests__/services/headless-worker-executor.test.ts` - Comprehensive test suite
