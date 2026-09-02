# MCP Spec 2025 Implementation Plan for Claude Flow

**Timeline**: RC November 14, 2025 → Final November 25, 2025
**Status**: Implementation Phase
**Priority**: CRITICAL - Spec-breaking changes require immediate action

---

## Executive Summary

The upcoming MCP spec introduces **3 major changes** that require updates to Claude Flow:

1. **Async Operations** (First-class support for long-running tasks)
2. **Registry-Backed Discovery** (Formal MCP Registry integration)
3. **Code Execution Pattern** (98% token reduction - already planned)

Combined with Anthropic's engineering guidance, these changes will:
- Enable resumable workflows without blocking
- Provide automatic server discovery via MCP Registry
- Reduce token usage by 98% (150k → 2k tokens)
- Improve privacy with execution-environment data processing

---

## 🎯 Implementation Phases

### Phase 0: Pre-RC Preparation (Before Nov 14)
**Goal**: Have infrastructure ready for RC validation

### Phase 1: RC Validation Window (Nov 14-25)
**Goal**: Test compatibility and fix issues before final spec

### Phase 2: Production Rollout (After Nov 25)
**Goal**: Deploy to production with full spec compliance

---

## 📋 Detailed Implementation Plan

## PHASE 0A: Async Operations Architecture (PRIORITY 1)

### Overview
MCP will support first-class async operations:
- Servers start long-running work and return job handles
- Clients poll or resume to retrieve results without blocking
- Job state persisted for resumability

### Current State: Claude Flow
- Tools execute synchronously in `handler()` functions
- No job persistence or state management
- Long-running tasks block the MCP connection

### Required Changes

#### 1. Job Management System

**Create**: `src/mcp/async/job-manager.ts`

```typescript
import { EventEmitter } from 'events';
import { v4 as uuidv4 } from 'uuid';

export type JobStatus =
  | 'queued'      // Job submitted but not started
  | 'running'     // Job in progress
  | 'completed'   // Job finished successfully
  | 'failed'      // Job failed with error
  | 'cancelled';  // Job cancelled by user

export interface AsyncJob<TInput = any, TResult = any> {
  id: string;
  toolName: string;
  status: JobStatus;
  progress?: number; // 0-100
  input: TInput;
  result?: TResult;
  error?: {
    code: string;
    message: string;
    details?: any;
  };
  metadata: {
    createdAt: Date;
    startedAt?: Date;
    completedAt?: Date;
    estimatedDuration?: number; // milliseconds
    actualDuration?: number;
  };
  context?: any; // Tool context
}

export interface JobHandle {
  jobId: string;
  status: JobStatus;
  progress?: number;
  pollUrl?: string; // URL to poll for status
  webhookUrl?: string; // Optional webhook for completion
}

/**
 * Manages async job lifecycle for MCP tools
 * Supports polling, resumption, and cancellation
 */
export class JobManager extends EventEmitter {
  private jobs: Map<string, AsyncJob> = new Map();
  private executors: Map<string, Promise<any>> = new Map();

  constructor(
    private maxJobs: number = 1000,
    private jobTTL: number = 86400000 // 24 hours
  ) {
    super();

    // Cleanup expired jobs every hour
    setInterval(() => this.cleanupExpiredJobs(), 3600000);
  }

  /**
   * Submit a new async job
   * Returns job handle immediately, execution happens in background
   */
  async submitJob<TInput, TResult>(
    toolName: string,
    input: TInput,
    executor: (input: TInput, progress: (percent: number) => void) => Promise<TResult>,
    context?: any
  ): Promise<JobHandle> {
    // Check capacity
    if (this.jobs.size >= this.maxJobs) {
      this.cleanupExpiredJobs();
      if (this.jobs.size >= this.maxJobs) {
        throw new Error('Job queue full. Please try again later.');
      }
    }

    // Create job
    const jobId = uuidv4();
    const job: AsyncJob<TInput, TResult> = {
      id: jobId,
      toolName,
      status: 'queued',
      input,
      metadata: {
        createdAt: new Date(),
      },
      context,
    };

    this.jobs.set(jobId, job);

    // Start execution in background
    this.executeJob(job, executor);

    // Return handle immediately
    return {
      jobId,
      status: 'queued',
      pollUrl: `/mcp/jobs/${jobId}`,
    };
  }

  /**
   * Execute job in background
   */
  private async executeJob<TInput, TResult>(
    job: AsyncJob<TInput, TResult>,
    executor: (input: TInput, progress: (percent: number) => void) => Promise<TResult>
  ): Promise<void> {
    // Update status to running
    job.status = 'running';
    job.metadata.startedAt = new Date();
    this.emit('job:started', job.id);

    try {
      // Execute with progress callback
      const progressCallback = (percent: number) => {
        job.progress = Math.min(100, Math.max(0, percent));
        this.emit('job:progress', job.id, job.progress);
      };

      const result = await executor(job.input, progressCallback);

      // Mark completed
      job.status = 'completed';
      job.result = result;
      job.progress = 100;
      job.metadata.completedAt = new Date();
      job.metadata.actualDuration =
        job.metadata.completedAt.getTime() - job.metadata.startedAt!.getTime();

      this.emit('job:completed', job.id, result);
    } catch (error: any) {
      // Mark failed
      job.status = 'failed';
      job.error = {
        code: error.code || 'EXECUTION_ERROR',
        message: error.message,
        details: error.details || error.stack,
      };
      job.metadata.completedAt = new Date();

      this.emit('job:failed', job.id, error);
    }
  }

  /**
   * Get job status (for polling)
   */
  getJobStatus(jobId: string): JobHandle | null {
    const job = this.jobs.get(jobId);
    if (!job) return null;

    return {
      jobId: job.id,
      status: job.status,
      progress: job.progress,
      pollUrl: `/mcp/jobs/${jobId}`,
    };
  }

  /**
   * Get full job details
   */
  getJob(jobId: string): AsyncJob | null {
    return this.jobs.get(jobId) || null;
  }

  /**
   * Get job result (blocks until completed or failed)
   */
  async waitForJob<TResult>(
    jobId: string,
    timeout: number = 300000 // 5 minutes default
  ): Promise<TResult> {
    const job = this.jobs.get(jobId);
    if (!job) {
      throw new Error(`Job not found: ${jobId}`);
    }

    // If already completed, return immediately
    if (job.status === 'completed') {
      return job.result as TResult;
    }

    if (job.status === 'failed') {
      throw new Error(job.error?.message || 'Job failed');
    }

    // Wait for completion
    return new Promise((resolve, reject) => {
      const timeoutHandle = setTimeout(() => {
        this.removeListener('job:completed', completedHandler);
        this.removeListener('job:failed', failedHandler);
        reject(new Error('Job timeout'));
      }, timeout);

      const completedHandler = (completedJobId: string, result: TResult) => {
        if (completedJobId === jobId) {
          clearTimeout(timeoutHandle);
          this.removeListener('job:failed', failedHandler);
          resolve(result);
        }
      };

      const failedHandler = (failedJobId: string, error: Error) => {
        if (failedJobId === jobId) {
          clearTimeout(timeoutHandle);
          this.removeListener('job:completed', completedHandler);
          reject(error);
        }
      };

      this.on('job:completed', completedHandler);
      this.on('job:failed', failedHandler);
    });
  }

  /**
   * Cancel a running job
   */
  async cancelJob(jobId: string): Promise<boolean> {
    const job = this.jobs.get(jobId);
    if (!job) return false;

    if (job.status === 'completed' || job.status === 'failed') {
      return false; // Already finished
    }

    job.status = 'cancelled';
    job.metadata.completedAt = new Date();

    this.emit('job:cancelled', jobId);
    return true;
  }

  /**
   * List jobs with filtering
   */
  listJobs(filter?: {
    status?: JobStatus;
    toolName?: string;
    limit?: number;
  }): AsyncJob[] {
    let jobs = Array.from(this.jobs.values());

    if (filter?.status) {
      jobs = jobs.filter(j => j.status === filter.status);
    }

    if (filter?.toolName) {
      jobs = jobs.filter(j => j.toolName === filter.toolName);
    }

    // Sort by creation time (newest first)
    jobs.sort((a, b) =>
      b.metadata.createdAt.getTime() - a.metadata.createdAt.getTime()
    );

    if (filter?.limit) {
      jobs = jobs.slice(0, filter.limit);
    }

    return jobs;
  }

  /**
   * Cleanup expired jobs
   */
  private cleanupExpiredJobs(): number {
    const now = Date.now();
    let cleaned = 0;

    for (const [jobId, job] of this.jobs.entries()) {
      const age = now - job.metadata.createdAt.getTime();

      // Remove if expired and not running
      if (age > this.jobTTL && job.status !== 'running') {
        this.jobs.delete(jobId);
        cleaned++;
      }
    }

    return cleaned;
  }

  /**
   * Get metrics
   */
  getMetrics() {
    const jobs = Array.from(this.jobs.values());

    return {
      total: jobs.length,
      byStatus: {
        queued: jobs.filter(j => j.status === 'queued').length,
        running: jobs.filter(j => j.status === 'running').length,
        completed: jobs.filter(j => j.status === 'completed').length,
        failed: jobs.filter(j => j.status === 'failed').length,
        cancelled: jobs.filter(j => j.status === 'cancelled').length,
      },
      averageDuration: this.calculateAverageDuration(jobs),
    };
  }

  private calculateAverageDuration(jobs: AsyncJob[]): number {
    const completed = jobs.filter(j =>
      j.status === 'completed' && j.metadata.actualDuration
    );

    if (completed.length === 0) return 0;

    const total = completed.reduce((sum, j) =>
      sum + (j.metadata.actualDuration || 0), 0
    );

    return total / completed.length;
  }
}
```

#### 2. Async Tool Wrapper

**Create**: `src/mcp/async/async-tool.ts`

```typescript
import type { MCPTool } from '../types.js';
import type { ILogger } from '../../interfaces/logger.js';
import { JobManager, JobHandle } from './job-manager.js';

/**
 * Wraps synchronous tools to support async execution
 */
export function makeToolAsync(
  tool: MCPTool,
  jobManager: JobManager,
  logger: ILogger
): MCPTool {
  return {
    ...tool,
    name: `${tool.name}:async`,
    description: `${tool.description} (Async version - returns job handle immediately)`,

    // Add async-specific parameters
    inputSchema: {
      type: 'object',
      properties: {
        ...((tool.inputSchema as any).properties || {}),
        _async: {
          type: 'object',
          properties: {
            mode: {
              type: 'string',
              enum: ['fire-and-forget', 'wait', 'poll'],
              description: 'Execution mode',
              default: 'poll',
            },
            timeout: {
              type: 'number',
              description: 'Timeout in ms (for wait mode)',
              default: 300000,
            },
            webhook: {
              type: 'string',
              description: 'Webhook URL for completion notification',
            },
          },
        },
      },
      required: (tool.inputSchema as any).required || [],
    },

    handler: async (input: any, context?: any) => {
      const { _async, ...toolInput } = input;
      const mode = _async?.mode || 'poll';

      // Submit job
      const jobHandle = await jobManager.submitJob(
        tool.name,
        toolInput,
        async (input, onProgress) => {
          // Execute original tool
          return await tool.handler(input, context);
        },
        context
      );

      logger.info('Async job submitted', {
        jobId: jobHandle.jobId,
        tool: tool.name,
        mode
      });

      // Handle different modes
      if (mode === 'fire-and-forget') {
        // Return job handle immediately
        return {
          async: true,
          jobHandle,
          message: 'Job submitted. Use jobs/status to check progress.',
        };
      } else if (mode === 'wait') {
        // Wait for completion
        try {
          const result = await jobManager.waitForJob(
            jobHandle.jobId,
            _async?.timeout || 300000
          );

          return {
            async: true,
            jobHandle,
            completed: true,
            result,
          };
        } catch (error: any) {
          return {
            async: true,
            jobHandle,
            completed: false,
            error: error.message,
            message: 'Use jobs/status to check current state.',
          };
        }
      } else {
        // Poll mode (default)
        return {
          async: true,
          jobHandle,
          message: 'Job submitted. Poll the jobHandle.pollUrl to check status.',
        };
      }
    },
  };
}
```

#### 3. Job Management Tools

**Create**: `src/mcp/tools/jobs/status.ts`

```typescript
import type { MCPTool, ClaudeFlowToolContext } from '../../types.js';
import type { ILogger } from '../../../interfaces/logger.js';

export function createJobStatusTool(logger: ILogger): MCPTool {
  return {
    name: 'jobs/status',
    description: 'Get status of an async job. Use for polling long-running operations.',

    inputSchema: {
      type: 'object',
      properties: {
        jobId: {
          type: 'string',
          description: 'Job ID returned from async tool call',
        },
      },
      required: ['jobId'],
    },

    metadata: {
      category: 'jobs',
      tags: ['async', 'status', 'polling'],
      detailLevel: 'standard',
    },

    handler: async (input: any, context?: ClaudeFlowToolContext) => {
      if (!context?.jobManager) {
        throw new Error('Job manager not available');
      }

      const { jobId } = input;
      const job = context.jobManager.getJob(jobId);

      if (!job) {
        return {
          success: false,
          error: 'Job not found',
          jobId,
        };
      }

      return {
        success: true,
        job: {
          id: job.id,
          toolName: job.toolName,
          status: job.status,
          progress: job.progress,
          result: job.status === 'completed' ? job.result : undefined,
          error: job.status === 'failed' ? job.error : undefined,
          metadata: job.metadata,
        },
      };
    },
  };
}

export const toolMetadata = {
  name: 'jobs/status',
  description: 'Get async job status',
  category: 'jobs',
  detailLevel: 'standard',
};
```

**Create**: `src/mcp/tools/jobs/list.ts`

```typescript
import type { MCPTool, ClaudeFlowToolContext } from '../../types.js';
import type { ILogger } from '../../../interfaces/logger.js';

export function createJobListTool(logger: ILogger): MCPTool {
  return {
    name: 'jobs/list',
    description: 'List async jobs with optional filtering',

    inputSchema: {
      type: 'object',
      properties: {
        status: {
          type: 'string',
          enum: ['queued', 'running', 'completed', 'failed', 'cancelled'],
          description: 'Filter by status',
        },
        toolName: {
          type: 'string',
          description: 'Filter by tool name',
        },
        limit: {
          type: 'number',
          description: 'Maximum number of jobs to return',
          default: 20,
        },
      },
    },

    handler: async (input: any, context?: ClaudeFlowToolContext) => {
      if (!context?.jobManager) {
        throw new Error('Job manager not available');
      }

      const jobs = context.jobManager.listJobs(input);

      return {
        success: true,
        jobs: jobs.map(j => ({
          id: j.id,
          toolName: j.toolName,
          status: j.status,
          progress: j.progress,
          createdAt: j.metadata.createdAt,
          duration: j.metadata.actualDuration,
        })),
        total: jobs.length,
      };
    },
  };
}

export const toolMetadata = {
  name: 'jobs/list',
  description: 'List async jobs',
  category: 'jobs',
  detailLevel: 'standard',
};
```

**Create**: `src/mcp/tools/jobs/cancel.ts`

```typescript
import type { MCPTool, ClaudeFlowToolContext } from '../../types.js';
import type { ILogger } from '../../../interfaces/logger.js';

export function createJobCancelTool(logger: ILogger): MCPTool {
  return {
    name: 'jobs/cancel',
    description: 'Cancel a running async job',

    inputSchema: {
      type: 'object',
      properties: {
        jobId: {
          type: 'string',
          description: 'Job ID to cancel',
        },
      },
      required: ['jobId'],
    },

    handler: async (input: any, context?: ClaudeFlowToolContext) => {
      if (!context?.jobManager) {
        throw new Error('Job manager not available');
      }

      const { jobId } = input;
      const cancelled = await context.jobManager.cancelJob(jobId);

      return {
        success: cancelled,
        jobId,
        message: cancelled
          ? 'Job cancelled successfully'
          : 'Job not found or already completed',
      };
    },
  };
}

export const toolMetadata = {
  name: 'jobs/cancel',
  description: 'Cancel async job',
  category: 'jobs',
  detailLevel: 'standard',
};
```

#### 4. Integration with MCP Server

**Update**: `src/mcp/server.ts`

```typescript
import { JobManager } from './async/job-manager.js';
import { makeToolAsync } from './async/async-tool.js';

export class MCPServer {
  private jobManager: JobManager;

  constructor(config: MCPConfig, eventBus: IEventBus, logger: ILogger) {
    // ... existing code ...

    // Initialize job manager
    this.jobManager = new JobManager(
      config.async?.maxJobs || 1000,
      config.async?.jobTTL || 86400000
    );

    logger.info('Job manager initialized', {
      maxJobs: config.async?.maxJobs || 1000,
    });
  }

  /**
   * Register tool with optional async support
   */
  async registerTool(tool: MCPTool, enableAsync: boolean = true): Promise<void> {
    // Register synchronous version
    await this.toolRegistry.registerTool(tool);

    // Also register async version if enabled
    if (enableAsync && this.isLongRunningTool(tool)) {
      const asyncTool = makeToolAsync(tool, this.jobManager, this.logger);
      await this.toolRegistry.registerTool(asyncTool);

      this.logger.info('Registered async version of tool', {
        tool: tool.name,
        asyncName: asyncTool.name
      });
    }
  }

  /**
   * Determine if tool should have async version
   */
  private isLongRunningTool(tool: MCPTool): boolean {
    // Tools that typically take > 5 seconds should be async
    const longRunningCategories = [
      'agents/spawn',
      'agents/spawn-parallel',
      'tasks/create',
      'workflow/execute',
      'data/filter',
      'swarm/',
    ];

    return longRunningCategories.some(prefix => tool.name.startsWith(prefix));
  }

  /**
   * Add job manager to tool context
   */
  private get toolContext(): ClaudeFlowToolContext {
    return {
      orchestrator: this.orchestrator,
      swarmCoordinator: this.swarmCoordinator,
      jobManager: this.jobManager, // NEW
      sessionId: this.currentSessionId,
    };
  }
}
```

#### 5. Configuration Updates

**Update**: `src/config/default-config.ts`

```typescript
export interface MCPConfig {
  // ... existing config ...

  async: {
    enabled: boolean;
    maxJobs: number;
    jobTTL: number; // milliseconds
    defaultTimeout: number; // milliseconds
    enableWebhooks: boolean;
  };
}

export const defaultConfig: MCPConfig = {
  // ... existing config ...

  async: {
    enabled: true,
    maxJobs: 1000,
    jobTTL: 86400000, // 24 hours
    defaultTimeout: 300000, // 5 minutes
    enableWebhooks: false,
  },
};
```

---

## PHASE 0B: MCP Registry Integration (PRIORITY 2)

### Overview
The MCP Registry provides:
- Centralized server catalog with metadata
- API for server discovery
- Capability negotiation
- Health checks and monitoring

### Required Changes

#### 1. Registry Client

**Create**: `src/mcp/registry/client.ts`

```typescript
/**
 * MCP Registry Client
 * Integrates with official MCP Registry for server discovery
 */

export interface ServerMetadata {
  name: string;
  version: string;
  description: string;
  author: string;
  homepage?: string;
  repository?: string;
  capabilities: {
    tools: boolean;
    resources: boolean;
    prompts: boolean;
    async: boolean;
    streaming: boolean;
  };
  categories: string[];
  tags: string[];
  transport: Array<'stdio' | 'http' | 'websocket'>;
  healthCheck?: {
    endpoint: string;
    interval: number; // seconds
  };
  security: {
    authRequired: boolean;
    authMethods: Array<'token' | 'basic' | 'oauth'>;
    piiHandling: 'none' | 'tokenized' | 'encrypted';
  };
}

export class RegistryClient {
  private baseUrl: string = 'https://registry.mcp.anthropic.com/api/v1';

  constructor(private apiKey?: string) {}

  /**
   * Publish server to registry
   */
  async publishServer(metadata: ServerMetadata): Promise<{
    success: boolean;
    serverId: string;
    url: string;
  }> {
    const response = await fetch(`${this.baseUrl}/servers`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify(metadata),
    });

    if (!response.ok) {
      throw new Error(`Failed to publish server: ${response.statusText}`);
    }

    return await response.json();
  }

  /**
   * Update server metadata
   */
  async updateServer(
    serverId: string,
    metadata: Partial<ServerMetadata>
  ): Promise<void> {
    const response = await fetch(`${this.baseUrl}/servers/${serverId}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify(metadata),
    });

    if (!response.ok) {
      throw new Error(`Failed to update server: ${response.statusText}`);
    }
  }

  /**
   * Report health status
   */
  async reportHealth(
    serverId: string,
    health: {
      status: 'healthy' | 'degraded' | 'unhealthy';
      latency?: number;
      metrics?: Record<string, number>;
    }
  ): Promise<void> {
    await fetch(`${this.baseUrl}/servers/${serverId}/health`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify(health),
    });
  }

  /**
   * Search registry for servers
   */
  async searchServers(query: {
    category?: string;
    tags?: string[];
    capabilities?: string[];
    limit?: number;
  }): Promise<ServerMetadata[]> {
    const params = new URLSearchParams();
    if (query.category) params.set('category', query.category);
    if (query.tags) params.set('tags', query.tags.join(','));
    if (query.capabilities) params.set('capabilities', query.capabilities.join(','));
    if (query.limit) params.set('limit', query.limit.toString());

    const response = await fetch(`${this.baseUrl}/servers?${params}`);

    if (!response.ok) {
      throw new Error(`Failed to search servers: ${response.statusText}`);
    }

    return await response.json();
  }
}
```

#### 2. Auto-Publish Script

**Create**: `scripts/publish-to-registry.ts`

```typescript
#!/usr/bin/env node

import { RegistryClient, ServerMetadata } from '../src/mcp/registry/client.js';
import { version } from '../package.json';

async function main() {
  const apiKey = process.env.MCP_REGISTRY_API_KEY;
  if (!apiKey) {
    console.error('❌ MCP_REGISTRY_API_KEY not set');
    process.exit(1);
  }

  const client = new RegistryClient(apiKey);

  const metadata: ServerMetadata = {
    name: 'claude-flow',
    version,
    description: 'Advanced MCP server with swarm coordination, async operations, and neural capabilities',
    author: 'ruvnet',
    homepage: 'https://github.com/ruvnet/claude-flow',
    repository: 'https://github.com/ruvnet/claude-flow',
    capabilities: {
      tools: true,
      resources: true,
      prompts: true,
      async: true,
      streaming: true,
    },
    categories: [
      'orchestration',
      'swarm-coordination',
      'task-management',
      'memory-management',
    ],
    tags: [
      'async',
      'swarm',
      'neural',
      'coordination',
      'agentdb',
      'reasoningbank',
    ],
    transport: ['stdio', 'http'],
    healthCheck: {
      endpoint: '/health',
      interval: 60,
    },
    security: {
      authRequired: true,
      authMethods: ['token', 'oauth'],
      piiHandling: 'tokenized',
    },
  };

  console.log('📤 Publishing to MCP Registry...');

  const result = await client.publishServer(metadata);

  console.log('✅ Published successfully!');
  console.log(`   Server ID: ${result.serverId}`);
  console.log(`   URL: ${result.url}`);
}

main().catch(console.error);
```

#### 3. Health Check Endpoint

**Create**: `src/mcp/endpoints/health.ts`

```typescript
export class HealthCheckHandler {
  constructor(
    private server: MCPServer,
    private jobManager: JobManager,
    private toolRegistry: ToolRegistry
  ) {}

  async getHealth(): Promise<{
    status: 'healthy' | 'degraded' | 'unhealthy';
    uptime: number;
    metrics: {
      activeJobs: number;
      totalTools: number;
      avgResponseTime: number;
      errorRate: number;
    };
  }> {
    const jobMetrics = this.jobManager.getMetrics();
    const toolMetrics = await this.toolRegistry.getMetrics();

    // Calculate health status
    const errorRate = toolMetrics.failedInvocations / toolMetrics.totalInvocations;
    const status = errorRate > 0.1 ? 'unhealthy' : errorRate > 0.05 ? 'degraded' : 'healthy';

    return {
      status,
      uptime: process.uptime(),
      metrics: {
        activeJobs: jobMetrics.byStatus.running,
        totalTools: toolMetrics.totalTools,
        avgResponseTime: toolMetrics.averageExecutionTime,
        errorRate,
      },
    };
  }
}
```

#### 4. CI Integration

**Update**: `.github/workflows/publish.yml`

```yaml
name: Publish to MCP Registry

on:
  release:
    types: [published]
  push:
    branches: [main]

jobs:
  publish-registry:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3

      - name: Setup Node.js
        uses: actions/setup-node@v3
        with:
          node-version: '20'

      - name: Install dependencies
        run: npm ci

      - name: Build
        run: npm run build

      - name: Run tests
        run: npm test

      - name: Publish to MCP Registry
        env:
          MCP_REGISTRY_API_KEY: ${{ secrets.MCP_REGISTRY_API_KEY }}
        run: npm run registry:publish

      - name: Update health check
        env:
          MCP_REGISTRY_API_KEY: ${{ secrets.MCP_REGISTRY_API_KEY }}
        run: npm run registry:health
```

---

## PHASE 0C: Code Execution Pattern (Already Planned)

This is covered in the original plan (Phase 1: Progressive Disclosure, Phase 4: Data Processing).

**Status**: Implementation details provided in main plan

---

## PHASE 1: RC Validation (November 14-25)

### Test Suite for Spec Compliance

**Create**: `tests/mcp-spec-2025-compliance.test.ts`

```typescript
import { describe, it, expect, beforeAll } from '@jest/globals';

describe('MCP Spec 2025 Compliance', () => {
  describe('Async Operations', () => {
    it('should return job handle immediately for long-running tasks', async () => {
      const result = await mcpClient.callTool('agents/spawn:async', {
        type: 'researcher',
        name: 'Test Agent',
        _async: { mode: 'poll' },
      });

      expect(result).toHaveProperty('jobHandle');
      expect(result.jobHandle).toHaveProperty('jobId');
      expect(result.jobHandle).toHaveProperty('pollUrl');
    });

    it('should allow polling for job status', async () => {
      const { jobHandle } = await mcpClient.callTool('agents/spawn:async', {
        type: 'researcher',
        name: 'Test Agent',
        _async: { mode: 'poll' },
      });

      const status = await mcpClient.callTool('jobs/status', {
        jobId: jobHandle.jobId,
      });

      expect(status.job.status).toMatch(/queued|running|completed/);
    });

    it('should support wait mode with timeout', async () => {
      const result = await mcpClient.callTool('agents/spawn:async', {
        type: 'researcher',
        name: 'Test Agent',
        _async: { mode: 'wait', timeout: 10000 },
      });

      expect(result).toHaveProperty('completed');
      if (result.completed) {
        expect(result).toHaveProperty('result');
      }
    });

    it('should support job cancellation', async () => {
      const { jobHandle } = await mcpClient.callTool('workflow/execute:async', {
        workflowId: 'long-running-workflow',
        _async: { mode: 'poll' },
      });

      const cancelled = await mcpClient.callTool('jobs/cancel', {
        jobId: jobHandle.jobId,
      });

      expect(cancelled.success).toBe(true);

      const status = await mcpClient.callTool('jobs/status', {
        jobId: jobHandle.jobId,
      });

      expect(status.job.status).toBe('cancelled');
    });
  });

  describe('Registry Integration', () => {
    it('should be discoverable in MCP Registry', async () => {
      const servers = await registryClient.searchServers({
        tags: ['claude-flow'],
      });

      expect(servers).toContainEqual(
        expect.objectContaining({
          name: 'claude-flow',
          capabilities: expect.objectContaining({
            async: true,
          }),
        })
      );
    });

    it('should report health status', async () => {
      const health = await fetch('http://localhost:3000/health');
      const data = await health.json();

      expect(data.status).toMatch(/healthy|degraded|unhealthy/);
      expect(data.metrics).toHaveProperty('activeJobs');
    });
  });

  describe('Code Execution Pattern', () => {
    it('should process data in execution environment', async () => {
      // Create large dataset (10,000 rows)
      const largeDataset = Array.from({ length: 10000 }, (_, i) => ({
        id: i,
        value: Math.random() * 1000,
        category: ['A', 'B', 'C'][i % 3],
      }));

      // Store in memory
      await memoryStore.store('test-dataset', JSON.stringify(largeDataset));

      // Filter in execution environment
      const result = await mcpClient.callTool('data/filter', {
        dataSource: 'memory',
        source: 'test-dataset',
        filters: [
          { field: 'value', operator: 'gt', value: 500 },
          { field: 'category', operator: 'eq', value: 'A' },
        ],
        returnFormat: 'summary',
      });

      // Result should be small (summary only)
      const resultSize = JSON.stringify(result).length;
      expect(resultSize).toBeLessThan(1000); // < 1KB

      // Original dataset was ~500KB
      const originalSize = JSON.stringify(largeDataset).length;
      expect(originalSize).toBeGreaterThan(500000);

      // Verify token savings
      const tokenReduction = ((originalSize - resultSize) / originalSize) * 100;
      expect(tokenReduction).toBeGreaterThan(98);
    });
  });
});
```

---

## PHASE 2: Production Rollout Checklist

### Pre-Rollout (Before Nov 25)
- [ ] All async operation tests passing
- [ ] Registry integration tested
- [ ] Code execution pattern validated
- [ ] Performance benchmarks meet targets
- [ ] Security audit completed
- [ ] Documentation updated

### Rollout (Nov 25)
- [ ] Deploy to staging
- [ ] Smoke tests in staging
- [ ] Monitor metrics for 24 hours
- [ ] Deploy to production
- [ ] Monitor production metrics
- [ ] Update registry with production endpoint

### Post-Rollout (After Nov 25)
- [ ] Performance monitoring active
- [ ] Token usage tracked
- [ ] User feedback collected
- [ ] Optimization iterations

---

## 📊 Success Metrics

### Token Reduction
- **Target**: 98% reduction (150k → 2k tokens)
- **Measure**: Average tokens per workflow
- **Baseline**: Measure before implementation
- **Validation**: A/B test with old vs new pattern

### Async Performance
- **Target**: 95% of long-running tasks complete within timeout
- **Measure**: Job completion rate, average duration
- **Alert**: >5% failure rate

### Registry Health
- **Target**: 99% uptime reported to registry
- **Measure**: Health check success rate
- **Alert**: Status degraded for >5 minutes

### User Adoption
- **Target**: 80% of users switch to async pattern
- **Measure**: Async tool usage vs sync tool usage
- **Goal**: Deprecate sync versions of long-running tools

---

## 🚀 Quick Start Commands

```bash
# Install dependencies
npm install

# Run async operation tests
npm run test:async

# Run registry integration tests
npm run test:registry

# Run full compliance suite
npm run test:compliance

# Publish to registry
npm run registry:publish

# Start server with async support
npm run start:async

# Monitor job queue
npm run jobs:monitor
```

---

## 📞 Escalation Path

- **Spec Questions**: mcp-spec@anthropic.com
- **Registry Issues**: registry-support@anthropic.com
- **Claude Flow Issues**: GitHub Issues
- **Urgent**: Create issue with `[MCP-2025-URGENT]` prefix

---

## Next Steps

1. **Immediate**: Review this plan with team
2. **This Week**: Implement Phase 0A (Async Operations)
3. **Next Week**: Implement Phase 0B (Registry Integration)
4. **Nov 14**: Begin RC validation
5. **Nov 25**: Production rollout

Would you like me to start implementing any specific phase?
