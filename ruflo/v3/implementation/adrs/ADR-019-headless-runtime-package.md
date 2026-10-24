# ADR-019: @claude-flow/headless Runtime Package

**Status:** Proposed
**Date:** 2026-01-07
**Author:** System Architecture Designer
**Version:** 1.0.0

## Context

The undocumented `CLAUDE_CODE_HEADLESS` and `CLAUDE_CODE_SANDBOX_MODE` environment variables in Claude Code enable programmatic, non-interactive execution. This creates opportunities for:

1. **CI/CD Integration** - Automated code review, generation, and testing
2. **Batch Processing** - Queue-based task execution without user interaction
3. **Distributed Agents** - Remote Claude Code instances in swarm topology
4. **API Gateway** - REST/WebSocket interface to Claude Code capabilities
5. **Container Orchestration** - Docker/K8s-native Claude Code execution

## Decision

Create `@claude-flow/headless` package providing:
- Programmatic Claude Code invocation with environment control
- Sandbox-aware execution contexts
- Batch task queue with persistence
- HTTP/WebSocket API server
- Docker-native execution support

---

## Package Architecture

```
@claude-flow/headless/
├── src/
│   ├── index.ts                 # Main exports
│   ├── executor/
│   │   ├── headless-executor.ts # Core execution engine
│   │   ├── sandbox-manager.ts   # Sandbox mode control
│   │   ├── process-pool.ts      # Process pooling
│   │   └── timeout-controller.ts # Execution timeouts
│   ├── queue/
│   │   ├── task-queue.ts        # Persistent task queue
│   │   ├── priority-scheduler.ts # Priority-based scheduling
│   │   └── dead-letter.ts       # Failed task handling
│   ├── api/
│   │   ├── server.ts            # HTTP/WS API server
│   │   ├── routes.ts            # REST endpoints
│   │   └── websocket.ts         # Real-time streaming
│   ├── docker/
│   │   ├── container-executor.ts # Docker execution
│   │   ├── image-manager.ts     # Image lifecycle
│   │   └── volume-manager.ts    # Workspace volumes
│   ├── monitoring/
│   │   ├── metrics.ts           # Prometheus metrics
│   │   ├── health.ts            # Health checks
│   │   └── logging.ts           # Structured logging
│   └── types.ts                 # TypeScript definitions
├── Dockerfile                   # Container image
├── docker-compose.yml           # Development stack
└── package.json
```

---

## Core Interfaces

### 1. Headless Executor

```typescript
// src/executor/headless-executor.ts

export interface HeadlessConfig {
  // Claude Code path (auto-detected if not provided)
  claudeCodePath?: string;

  // Sandbox configuration
  sandbox: {
    mode: 'strict' | 'permissive' | 'disabled' | 'auto';
    allowedPaths?: string[];
    deniedPaths?: string[];
    networkPolicy?: 'allow' | 'deny' | 'local-only';
  };

  // Execution limits
  limits: {
    maxConcurrent: number;      // Max parallel executions
    timeoutMs: number;          // Default timeout (max 10min)
    maxOutputSize: number;      // Max output bytes
    maxContextTokens?: number;  // Token limit
  };

  // Model configuration
  model?: 'sonnet' | 'opus' | 'haiku';

  // API key (falls back to ANTHROPIC_API_KEY)
  apiKey?: string;
}

export interface ExecutionRequest {
  id: string;
  prompt: string;
  workingDirectory?: string;

  // Optional context files to include
  contextFiles?: string[];

  // Environment variables for this execution
  env?: Record<string, string>;

  // Sandbox override for this request
  sandboxMode?: 'strict' | 'permissive' | 'disabled';

  // Callback for streaming output
  onOutput?: (chunk: string) => void;

  // Priority (higher = sooner)
  priority?: number;

  // Tags for filtering/grouping
  tags?: string[];
}

export interface ExecutionResult {
  id: string;
  success: boolean;

  // Full output (stdout + formatted)
  output: string;

  // Structured data if extractable
  data?: {
    filesCreated?: string[];
    filesModified?: string[];
    commands?: string[];
    errors?: string[];
  };

  // Execution metadata
  metadata: {
    startTime: Date;
    endTime: Date;
    durationMs: number;
    tokensUsed?: number;
    model: string;
    exitCode: number;
  };

  // Error details if failed
  error?: {
    code: string;
    message: string;
    stack?: string;
  };
}

export class HeadlessExecutor {
  constructor(config: HeadlessConfig);

  /**
   * Execute a single prompt headlessly
   */
  async execute(request: ExecutionRequest): Promise<ExecutionResult>;

  /**
   * Execute multiple prompts in batch
   */
  async executeBatch(
    requests: ExecutionRequest[],
    options?: { parallel?: number; stopOnError?: boolean }
  ): Promise<ExecutionResult[]>;

  /**
   * Execute with streaming output
   */
  executeStream(request: ExecutionRequest): AsyncIterable<string>;

  /**
   * Cancel a running execution
   */
  async cancel(id: string): Promise<boolean>;

  /**
   * Get execution status
   */
  getStatus(id: string): ExecutionStatus | undefined;

  /**
   * Graceful shutdown
   */
  async shutdown(): Promise<void>;
}
```

### 2. Sandbox Manager

```typescript
// src/executor/sandbox-manager.ts

export interface SandboxProfile {
  name: string;
  mode: 'strict' | 'permissive' | 'disabled';

  // Filesystem restrictions
  filesystem: {
    readOnly?: string[];       // Read-only paths
    readWrite?: string[];      // Read-write paths
    denied?: string[];         // Completely blocked
    tempDir?: string;          // Temp directory location
  };

  // Network restrictions
  network: {
    policy: 'allow' | 'deny' | 'allowlist';
    allowedHosts?: string[];   // For allowlist mode
    allowedPorts?: number[];
  };

  // Process restrictions
  process: {
    allowShell: boolean;
    allowedCommands?: string[];
    deniedCommands?: string[];
    maxProcesses?: number;
  };

  // Resource limits
  resources: {
    maxMemoryMb?: number;
    maxCpuPercent?: number;
    maxDiskMb?: number;
  };
}

export class SandboxManager {
  /**
   * Create sandbox environment variables
   */
  createEnvironment(profile: SandboxProfile): Record<string, string>;

  /**
   * Get predefined profiles
   */
  getProfile(name: 'ci' | 'development' | 'production' | 'testing'): SandboxProfile;

  /**
   * Validate sandbox configuration
   */
  validate(profile: SandboxProfile): ValidationResult;

  /**
   * Apply sandbox to working directory
   */
  async prepareSandbox(workDir: string, profile: SandboxProfile): Promise<SandboxContext>;

  /**
   * Clean up sandbox artifacts
   */
  async cleanup(context: SandboxContext): Promise<void>;
}

// Predefined profiles
export const SANDBOX_PROFILES = {
  ci: {
    name: 'ci',
    mode: 'strict' as const,
    filesystem: {
      readWrite: ['${WORKSPACE}'],
      denied: ['/etc', '/root', '~/.ssh', '~/.aws'],
      tempDir: '/tmp/claude-ci'
    },
    network: {
      policy: 'allowlist' as const,
      allowedHosts: ['api.anthropic.com', 'registry.npmjs.org', 'github.com'],
      allowedPorts: [443, 80]
    },
    process: {
      allowShell: true,
      deniedCommands: ['rm -rf /', 'sudo', 'chmod 777', 'curl | bash'],
      maxProcesses: 10
    },
    resources: {
      maxMemoryMb: 4096,
      maxCpuPercent: 80
    }
  },

  development: {
    name: 'development',
    mode: 'permissive' as const,
    filesystem: {
      readWrite: ['${WORKSPACE}', '${HOME}/.npm', '${HOME}/.cache'],
      denied: ['~/.ssh/id_*', '~/.aws/credentials']
    },
    network: { policy: 'allow' as const },
    process: {
      allowShell: true,
      deniedCommands: ['rm -rf /'],
      maxProcesses: 50
    },
    resources: {
      maxMemoryMb: 8192
    }
  },

  production: {
    name: 'production',
    mode: 'strict' as const,
    filesystem: {
      readOnly: ['${WORKSPACE}'],
      readWrite: ['/tmp/claude-prod'],
      denied: ['**/.env*', '**/secrets/**', '**/*.pem']
    },
    network: {
      policy: 'allowlist' as const,
      allowedHosts: ['api.anthropic.com'],
      allowedPorts: [443]
    },
    process: {
      allowShell: false,
      allowedCommands: ['node', 'npm', 'git'],
      maxProcesses: 5
    },
    resources: {
      maxMemoryMb: 2048,
      maxCpuPercent: 50,
      maxDiskMb: 1024
    }
  },

  testing: {
    name: 'testing',
    mode: 'disabled' as const,
    filesystem: { readWrite: ['**'] },
    network: { policy: 'allow' as const },
    process: { allowShell: true, maxProcesses: 100 },
    resources: {}
  }
};
```

### 3. Task Queue

```typescript
// src/queue/task-queue.ts

export interface QueuedTask {
  id: string;
  request: ExecutionRequest;
  status: 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';
  priority: number;
  createdAt: Date;
  startedAt?: Date;
  completedAt?: Date;
  result?: ExecutionResult;
  retryCount: number;
  maxRetries: number;
}

export interface QueueConfig {
  // Persistence backend
  persistence: 'memory' | 'sqlite' | 'redis';
  persistencePath?: string;

  // Queue behavior
  maxSize: number;
  defaultPriority: number;
  maxRetries: number;
  retryDelayMs: number;

  // Processing
  concurrency: number;
  processingTimeoutMs: number;
}

export class TaskQueue {
  constructor(config: QueueConfig, executor: HeadlessExecutor);

  /**
   * Add task to queue
   */
  async enqueue(request: ExecutionRequest): Promise<string>;

  /**
   * Add multiple tasks
   */
  async enqueueBatch(requests: ExecutionRequest[]): Promise<string[]>;

  /**
   * Get task by ID
   */
  async getTask(id: string): Promise<QueuedTask | null>;

  /**
   * Cancel a pending/running task
   */
  async cancel(id: string): Promise<boolean>;

  /**
   * Get queue statistics
   */
  getStats(): QueueStats;

  /**
   * Start processing queue
   */
  start(): void;

  /**
   * Stop processing (wait for current tasks)
   */
  async stop(): Promise<void>;

  /**
   * Drain queue (cancel all pending)
   */
  async drain(): Promise<void>;

  /**
   * Subscribe to task events
   */
  on(event: 'taskStarted' | 'taskCompleted' | 'taskFailed', handler: (task: QueuedTask) => void): void;
}
```

### 4. HTTP/WebSocket API

```typescript
// src/api/server.ts

export interface APIServerConfig {
  port: number;
  host: string;

  // Authentication
  auth: {
    type: 'none' | 'api-key' | 'jwt';
    apiKeys?: string[];
    jwtSecret?: string;
  };

  // Rate limiting
  rateLimit: {
    windowMs: number;
    maxRequests: number;
  };

  // CORS
  cors: {
    enabled: boolean;
    origins: string[];
  };
}

export class APIServer {
  constructor(
    config: APIServerConfig,
    executor: HeadlessExecutor,
    queue: TaskQueue
  );

  /**
   * Start the API server
   */
  async start(): Promise<void>;

  /**
   * Stop the server
   */
  async stop(): Promise<void>;

  /**
   * Get server status
   */
  getStatus(): ServerStatus;
}

// REST API Endpoints
//
// POST   /api/v1/execute           - Execute prompt (sync)
// POST   /api/v1/execute/stream    - Execute with SSE streaming
// POST   /api/v1/queue             - Add to queue (async)
// GET    /api/v1/queue/:id         - Get queued task
// DELETE /api/v1/queue/:id         - Cancel task
// GET    /api/v1/queue             - List queue
// GET    /api/v1/stats             - Get statistics
// GET    /api/v1/health            - Health check
//
// WebSocket /ws/v1/execute         - Real-time execution
// WebSocket /ws/v1/queue           - Queue events stream
```

### 5. Docker Executor

```typescript
// src/docker/container-executor.ts

export interface DockerConfig {
  // Base image with Claude Code pre-installed
  image: string;  // e.g., 'ghcr.io/ruvnet/claude-flow-headless:latest'

  // Container resources
  resources: {
    cpus: number;
    memoryMb: number;
    diskMb: number;
  };

  // Network configuration
  network: {
    mode: 'bridge' | 'host' | 'none';
    exposePorts?: number[];
  };

  // Volume mounts
  volumes: {
    workspace: string;     // Host path for workspace
    cache?: string;        // Host path for cache
  };

  // Environment variables to pass through
  envPassthrough: string[];

  // Auto-cleanup containers
  autoRemove: boolean;

  // Pool configuration
  pool: {
    minContainers: number;
    maxContainers: number;
    idleTimeoutMs: number;
  };
}

export class ContainerExecutor {
  constructor(config: DockerConfig);

  /**
   * Initialize container pool
   */
  async initialize(): Promise<void>;

  /**
   * Execute in container
   */
  async execute(request: ExecutionRequest): Promise<ExecutionResult>;

  /**
   * Execute in isolated container (no pooling)
   */
  async executeIsolated(request: ExecutionRequest): Promise<ExecutionResult>;

  /**
   * Get container pool stats
   */
  getPoolStats(): PoolStats;

  /**
   * Scale pool
   */
  async scale(targetSize: number): Promise<void>;

  /**
   * Cleanup all containers
   */
  async cleanup(): Promise<void>;
}
```

---

## CLI Commands

```bash
# Start headless server
npx @claude-flow/headless serve --port 3001 --sandbox strict

# Execute single prompt
npx @claude-flow/headless exec "Fix the bug in auth.ts" --cwd ./project

# Execute from file
npx @claude-flow/headless exec --file tasks.txt --parallel 3

# Queue management
npx @claude-flow/headless queue add "Refactor utils" --priority high
npx @claude-flow/headless queue list
npx @claude-flow/headless queue cancel <id>

# Docker mode
npx @claude-flow/headless docker start --containers 3
npx @claude-flow/headless docker exec "Run tests" --isolated
npx @claude-flow/headless docker scale 5

# Monitoring
npx @claude-flow/headless status
npx @claude-flow/headless metrics --prometheus
```

---

## Use Cases

### 1. CI/CD Code Review

```yaml
# .github/workflows/claude-review.yml
name: Claude Code Review
on: [pull_request]

jobs:
  review:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Run Claude Review
        env:
          ANTHROPIC_API_KEY: ${{ secrets.ANTHROPIC_API_KEY }}
          CLAUDE_CODE_HEADLESS: "true"
          CLAUDE_CODE_SANDBOX_MODE: "strict"
        run: |
          npx @claude-flow/headless exec \
            "Review this PR for bugs, security issues, and code quality. \
             Provide actionable feedback." \
            --output review.md

      - name: Post Review Comment
        uses: actions/github-script@v7
        with:
          script: |
            const review = require('fs').readFileSync('review.md', 'utf8');
            github.rest.issues.createComment({
              owner: context.repo.owner,
              repo: context.repo.repo,
              issue_number: context.issue.number,
              body: review
            });
```

### 2. Batch Test Generation

```typescript
import { HeadlessExecutor, TaskQueue } from '@claude-flow/headless';

const executor = new HeadlessExecutor({
  sandbox: { mode: 'permissive' },
  limits: { maxConcurrent: 3, timeoutMs: 300000 }
});

const queue = new TaskQueue(
  { persistence: 'sqlite', concurrency: 3 },
  executor
);

// Find all source files without tests
const files = glob.sync('src/**/*.ts').filter(f => !f.includes('.test.'));

// Queue test generation for each
for (const file of files) {
  await queue.enqueue({
    id: `test-${path.basename(file)}`,
    prompt: `Generate comprehensive unit tests for ${file}.
             Use Vitest. Follow TDD London School (mock dependencies).
             Achieve 80%+ coverage.`,
    workingDirectory: process.cwd(),
    priority: 1,
    tags: ['test-generation', path.dirname(file)]
  });
}

queue.start();

// Wait for completion
queue.on('taskCompleted', (task) => {
  console.log(`✓ Generated tests for ${task.id}`);
});
```

### 3. Kubernetes Job Orchestration

```yaml
# claude-job.yaml
apiVersion: batch/v1
kind: Job
metadata:
  name: claude-migration
spec:
  template:
    spec:
      containers:
      - name: claude
        image: ghcr.io/ruvnet/claude-flow-headless:latest
        env:
        - name: ANTHROPIC_API_KEY
          valueFrom:
            secretKeyRef:
              name: anthropic-credentials
              key: api-key
        - name: CLAUDE_CODE_HEADLESS
          value: "true"
        - name: CLAUDE_CODE_SANDBOX_MODE
          value: "strict"
        command:
        - npx
        - "@claude-flow/headless"
        - exec
        - "Migrate database schema from v2 to v3"
        volumeMounts:
        - name: workspace
          mountPath: /workspace
      volumes:
      - name: workspace
        persistentVolumeClaim:
          claimName: project-workspace
      restartPolicy: Never
```

### 4. Distributed Swarm Execution

```typescript
import { ContainerExecutor } from '@claude-flow/headless';

const executor = new ContainerExecutor({
  image: 'ghcr.io/ruvnet/claude-flow-headless:latest',
  resources: { cpus: 2, memoryMb: 4096, diskMb: 10240 },
  pool: { minContainers: 5, maxContainers: 20, idleTimeoutMs: 60000 }
});

await executor.initialize();

// Parallel execution across containers
const tasks = [
  'Implement authentication module',
  'Build REST API endpoints',
  'Create database migrations',
  'Write integration tests',
  'Generate API documentation'
];

const results = await Promise.all(
  tasks.map((task, i) => executor.execute({
    id: `task-${i}`,
    prompt: task,
    workingDirectory: '/workspace'
  }))
);

console.log(`Completed ${results.filter(r => r.success).length}/${tasks.length} tasks`);
```

---

## Security Considerations

### 1. API Key Protection

```typescript
// Never expose API keys in logs or responses
const sanitizeOutput = (output: string): string => {
  return output
    .replace(/sk-ant-[a-zA-Z0-9-_]+/g, '[REDACTED_API_KEY]')
    .replace(/ANTHROPIC_API_KEY=[^\s]+/g, 'ANTHROPIC_API_KEY=[REDACTED]');
};
```

### 2. Sandbox Enforcement

```typescript
// Validate sandbox mode before execution
if (config.sandbox.mode === 'disabled' && !process.env.ALLOW_UNSAFE) {
  throw new Error(
    'Sandbox mode "disabled" requires ALLOW_UNSAFE=true environment variable'
  );
}
```

### 3. Resource Limits

```typescript
// Enforce hard limits
const HARD_LIMITS = {
  maxTimeoutMs: 600000,      // 10 minutes
  maxOutputBytes: 10485760,  // 10MB
  maxConcurrent: 50,
  maxQueueSize: 1000
};
```

---

## Implementation Phases

### Phase 1: Core Executor (Week 1)
- HeadlessExecutor with basic execution
- SandboxManager with predefined profiles
- Environment variable handling
- Basic CLI commands

### Phase 2: Task Queue (Week 2)
- Persistent task queue (SQLite)
- Priority scheduling
- Retry logic with dead-letter handling
- Queue CLI commands

### Phase 3: API Server (Week 3)
- REST API endpoints
- WebSocket streaming
- Authentication (API key, JWT)
- Rate limiting

### Phase 4: Docker Integration (Week 4)
- Container executor
- Pool management
- Dockerfile and compose
- Kubernetes examples

### Phase 5: Monitoring & Polish (Week 5)
- Prometheus metrics
- Health checks
- Documentation
- Integration tests

---

## Dependencies

```json
{
  "name": "@claude-flow/headless",
  "version": "3.0.0-alpha.1",
  "dependencies": {
    "@claude-flow/shared": "^3.0.0-alpha.1",
    "better-sqlite3": "^9.0.0",
    "express": "^4.18.2",
    "ws": "^8.14.2",
    "dockerode": "^4.0.0",
    "prom-client": "^15.0.0",
    "winston": "^3.11.0",
    "zod": "^3.22.0"
  },
  "peerDependencies": {
    "@anthropic-ai/claude-code": ">=2.0.0"
  },
  "peerDependenciesMeta": {
    "@anthropic-ai/claude-code": {
      "optional": true
    }
  }
}
```

---

## Consequences

### Positive

1. **CI/CD Native** - First-class support for automated workflows
2. **Scalable** - Container pooling enables high throughput
3. **Secure** - Multiple sandbox profiles for different contexts
4. **Observable** - Prometheus metrics, structured logging

### Negative

1. **Complexity** - Another package to maintain
2. **Dependencies** - Docker, SQLite add requirements
3. **Undocumented APIs** - Claude Code env vars may change

### Neutral

1. **Optional** - Users who don't need headless can skip it
2. **Standalone** - Can be used without other claude-flow packages

---

## References

- ADR-018: Claude Code Deep Integration
- ADR-017: RuVector Integration Architecture
- Claude Code Environment Variables (undocumented)
- Docker Best Practices for CI/CD

---

**Status:** Proposed
**Next Steps:** Await approval, then begin Phase 1 implementation
