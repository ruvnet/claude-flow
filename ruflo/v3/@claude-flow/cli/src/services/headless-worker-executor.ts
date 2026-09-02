/**
 * Headless Worker Executor
 * Enables workers to invoke Claude Code in headless mode with configurable sandbox profiles.
 *
 * ADR-020: Headless Worker Integration Architecture
 * - Integrates with CLAUDE_CODE_HEADLESS and CLAUDE_CODE_SANDBOX_MODE environment variables
 * - Provides process pool for concurrent execution
 * - Builds context from file glob patterns
 * - Supports prompt templates and output parsing
 * - Implements timeout and graceful error handling
 *
 * Key Features:
 * - Process pool with configurable maxConcurrent
 * - Context building from file glob patterns with caching
 * - Prompt template system with context injection
 * - Output parsing (text, json, markdown)
 * - Timeout handling with graceful termination
 * - Execution logging for debugging
 * - Event emission for monitoring
 */

import { spawn, execSync, type ChildProcess } from 'child_process';
import { EventEmitter } from 'events';
import { existsSync, readFileSync, readdirSync, mkdirSync, writeFileSync } from 'fs';
import { join, relative } from 'path';
import type { WorkerType } from './worker-daemon.js';

// ============================================
// Type Definitions
// ============================================

/**
 * Headless worker types - workers that use Claude Code AI
 */
export type HeadlessWorkerType =
  | 'audit'
  | 'optimize'
  | 'testgaps'
  | 'document'
  | 'ultralearn'
  | 'refactor'
  | 'deepdive'
  | 'predict';

/**
 * Local worker types - workers that run locally without AI
 */
export type LocalWorkerType = 'map' | 'consolidate' | 'benchmark' | 'preload';

/**
 * Sandbox mode for headless execution
 */
export type SandboxMode = 'strict' | 'permissive' | 'disabled';

/**
 * Model types for Claude Code
 */
export type ModelType = 'sonnet' | 'opus' | 'haiku';

/**
 * Output format for worker results
 */
export type OutputFormat = 'text' | 'json' | 'markdown';

/**
 * Execution mode for workers
 */
export type ExecutionMode = 'local' | 'headless';

/**
 * Worker priority levels
 */
export type WorkerPriority = 'low' | 'normal' | 'high' | 'critical';

// ============================================
// Interfaces
// ============================================

/**
 * Base worker configuration (matching worker-daemon.ts)
 */
export interface WorkerConfig {
  type: WorkerType;
  intervalMs: number;
  priority: WorkerPriority;
  description: string;
  enabled: boolean;
}

/**
 * Headless-specific options
 */
export interface HeadlessOptions {
  /** Prompt template for Claude Code */
  promptTemplate: string;

  /** Sandbox profile: strict, permissive, or disabled */
  sandbox: SandboxMode;

  /** Model to use: sonnet, opus, or haiku */
  model?: ModelType;

  /** Maximum tokens for output */
  maxOutputTokens?: number;

  /** Timeout in milliseconds (overrides default) */
  timeoutMs?: number;

  /** File glob patterns to include as context */
  contextPatterns?: string[];

  /** Output parsing format */
  outputFormat?: OutputFormat;
}

/**
 * Extended worker configuration with headless options
 */
export interface HeadlessWorkerConfig extends WorkerConfig {
  /** Execution mode: local or headless */
  mode: ExecutionMode;

  /** Headless-specific options (required when mode is 'headless') */
  headless?: HeadlessOptions;
}

/**
 * Executor configuration options
 */
export interface HeadlessExecutorConfig {
  /** Maximum concurrent headless processes */
  maxConcurrent?: number;

  /** Default timeout in milliseconds */
  defaultTimeoutMs?: number;

  /** Maximum files to include in context */
  maxContextFiles?: number;

  /** Maximum characters per file in context */
  maxCharsPerFile?: number;

  /** Log directory for execution logs */
  logDir?: string;

  /** Whether to cache context between runs */
  cacheContext?: boolean;

  /** Context cache TTL in milliseconds */
  cacheTtlMs?: number;
}

/**
 * Result from headless execution
 */
export interface HeadlessExecutionResult {
  /** Whether execution completed successfully */
  success: boolean;

  /** Raw output from Claude Code */
  output: string;

  /** Parsed output (if outputFormat is json or markdown) */
  parsedOutput?: unknown;

  /** Execution duration in milliseconds */
  durationMs: number;

  /** Estimated tokens used (if available) */
  tokensUsed?: number;

  /** Model used for execution */
  model: string;

  /** Sandbox mode used */
  sandboxMode: SandboxMode;

  /** Worker type that was executed */
  workerType: HeadlessWorkerType;

  /** Timestamp of execution */
  timestamp: Date;

  /** Error message if execution failed */
  error?: string;

  /** Execution ID for tracking */
  executionId: string;
}

/**
 * Process pool entry
 */
interface PoolEntry {
  process: ChildProcess;
  executionId: string;
  workerType: HeadlessWorkerType;
  startTime: Date;
  timeout: NodeJS.Timeout;
}

/**
 * Pending queue entry
 */
interface QueueEntry {
  workerType: HeadlessWorkerType;
  config?: Partial<HeadlessOptions>;
  resolve: (result: HeadlessExecutionResult) => void;
  reject: (error: Error) => void;
  queuedAt: Date;
}

/**
 * Context cache entry
 */
interface CacheEntry {
  content: string;
  timestamp: number;
  patterns: string[];
}

/**
 * Pool status information
 */
export interface PoolStatus {
  activeCount: number;
  queueLength: number;
  maxConcurrent: number;
  activeWorkers: Array<{
    executionId: string;
    workerType: HeadlessWorkerType;
    startTime: Date;
    elapsedMs: number;
  }>;
  queuedWorkers: Array<{
    workerType: HeadlessWorkerType;
    queuedAt: Date;
    waitingMs: number;
  }>;
}

// ============================================
// Constants
// ============================================

/**
 * Array of headless worker types for runtime checking
 */
export const HEADLESS_WORKER_TYPES: HeadlessWorkerType[] = [
  'audit',
  'optimize',
  'testgaps',
  'document',
  'ultralearn',
  'refactor',
  'deepdive',
  'predict',
];

/**
 * Array of local worker types
 */
export const LOCAL_WORKER_TYPES: LocalWorkerType[] = [
  'map',
  'consolidate',
  'benchmark',
  'preload',
];

/**
 * Model ID mapping
 */
const MODEL_IDS: Record<ModelType, string> = {
  sonnet: 'claude-sonnet-4-20250514',
  opus: 'claude-opus-4-20250514',
  haiku: 'claude-haiku-4-20250514',
};

/**
 * Default headless worker configurations based on ADR-020
 */
export const HEADLESS_WORKER_CONFIGS: Record<HeadlessWorkerType, HeadlessWorkerConfig> = {
  audit: {
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
      model: 'haiku',
      outputFormat: 'json',
      contextPatterns: ['**/*.ts', '**/*.js', '**/.env*', '**/package.json'],
      timeoutMs: 5 * 60 * 1000,
    },
  },

  optimize: {
    type: 'optimize',
    mode: 'headless',
    intervalMs: 60 * 60 * 1000,
    priority: 'high',
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
      timeoutMs: 10 * 60 * 1000,
    },
  },

  testgaps: {
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
      timeoutMs: 10 * 60 * 1000,
    },
  },

  document: {
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
      model: 'haiku',
      outputFormat: 'markdown',
      contextPatterns: ['src/**/*.ts'],
      timeoutMs: 10 * 60 * 1000,
    },
  },

  ultralearn: {
    type: 'ultralearn',
    mode: 'headless',
    intervalMs: 0, // Manual trigger only
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

Provide insights as JSON:
{
  "architecture": { "patterns": [...], "style": "..." },
  "conventions": { "naming": "...", "formatting": "..." },
  "domains": ["..."],
  "insights": ["..."]
}`,
      sandbox: 'strict',
      model: 'opus',
      outputFormat: 'json',
      contextPatterns: ['**/*.ts', '**/CLAUDE.md', '**/README.md'],
      timeoutMs: 15 * 60 * 1000,
    },
  },

  refactor: {
    type: 'refactor',
    mode: 'headless',
    intervalMs: 0, // Manual trigger only
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
      timeoutMs: 10 * 60 * 1000,
    },
  },

  deepdive: {
    type: 'deepdive',
    mode: 'headless',
    intervalMs: 0, // Manual trigger only
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
      timeoutMs: 15 * 60 * 1000,
    },
  },

  predict: {
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

Provide preload suggestions as JSON:
{
  "filesToPreload": ["..."],
  "testsToRun": ["..."],
  "docsToReference": ["..."],
  "confidence": 0.0-1.0
}`,
      sandbox: 'strict',
      model: 'haiku',
      outputFormat: 'json',
      contextPatterns: ['.claude-flow/metrics/*.json'],
      timeoutMs: 2 * 60 * 1000,
    },
  },
};

/**
 * Local worker configurations
 */
export const LOCAL_WORKER_CONFIGS: Record<LocalWorkerType, HeadlessWorkerConfig> = {
  map: {
    type: 'map',
    mode: 'local',
    intervalMs: 15 * 60 * 1000,
    priority: 'normal',
    description: 'Codebase mapping',
    enabled: true,
  },
  consolidate: {
    type: 'consolidate',
    mode: 'local',
    intervalMs: 30 * 60 * 1000,
    priority: 'low',
    description: 'Memory consolidation',
    enabled: true,
  },
  benchmark: {
    type: 'benchmark',
    mode: 'local',
    intervalMs: 60 * 60 * 1000,
    priority: 'low',
    description: 'Performance benchmarking',
    enabled: false,
  },
  preload: {
    type: 'preload',
    mode: 'local',
    intervalMs: 5 * 60 * 1000,
    priority: 'low',
    description: 'Resource preloading',
    enabled: false,
  },
};

/**
 * Combined worker configurations
 */
export const ALL_WORKER_CONFIGS: HeadlessWorkerConfig[] = [
  ...Object.values(HEADLESS_WORKER_CONFIGS),
  ...Object.values(LOCAL_WORKER_CONFIGS),
];

// ============================================
// Utility Functions
// ============================================

/**
 * Check if a worker type is a headless worker
 */
export function isHeadlessWorker(type: WorkerType): type is HeadlessWorkerType {
  return HEADLESS_WORKER_TYPES.includes(type as HeadlessWorkerType);
}

/**
 * Check if a worker type is a local worker
 */
export function isLocalWorker(type: WorkerType): type is LocalWorkerType {
  return LOCAL_WORKER_TYPES.includes(type as LocalWorkerType);
}

/**
 * Get model ID from model type
 */
export function getModelId(model: ModelType): string {
  return MODEL_IDS[model];
}

/**
 * Get worker configuration by type
 */
export function getWorkerConfig(type: WorkerType): HeadlessWorkerConfig | undefined {
  if (isHeadlessWorker(type)) {
    return HEADLESS_WORKER_CONFIGS[type];
  }
  if (isLocalWorker(type)) {
    return LOCAL_WORKER_CONFIGS[type];
  }
  return undefined;
}

// ============================================
// HeadlessWorkerExecutor Class
// ============================================

/**
 * HeadlessWorkerExecutor - Executes workers using Claude Code in headless mode
 *
 * Features:
 * - Process pool with configurable concurrency limit
 * - Pending queue for overflow requests
 * - Context caching with configurable TTL
 * - Execution logging for debugging
 * - Event emission for monitoring
 * - Graceful termination
 */
export class HeadlessWorkerExecutor extends EventEmitter {
  private projectRoot: string;
  private config: Required<HeadlessExecutorConfig>;
  private processPool: Map<string, PoolEntry> = new Map();
  private pendingQueue: QueueEntry[] = [];
  private contextCache: Map<string, CacheEntry> = new Map();
  private claudeCodeAvailable: boolean | null = null;
  private claudeCodeVersion: string | null = null;

  constructor(projectRoot: string, options?: HeadlessExecutorConfig) {
    super();
    this.projectRoot = projectRoot;

    // Merge with defaults
    this.config = {
      maxConcurrent: options?.maxConcurrent ?? 2,
      defaultTimeoutMs: options?.defaultTimeoutMs ?? 5 * 60 * 1000,
      maxContextFiles: options?.maxContextFiles ?? 20,
      maxCharsPerFile: options?.maxCharsPerFile ?? 5000,
      logDir: options?.logDir ?? join(projectRoot, '.claude-flow', 'logs', 'headless'),
      cacheContext: options?.cacheContext ?? true,
      cacheTtlMs: options?.cacheTtlMs ?? 60000, // 1 minute default
    };

    // Ensure log directory exists
    this.ensureLogDir();
  }

  // ============================================
  // Public API
  // ============================================

  /**
   * Check if Claude Code CLI is available
   */
  async isAvailable(): Promise<boolean> {
    if (this.claudeCodeAvailable !== null) {
      return this.claudeCodeAvailable;
    }

    try {
      const output = execSync('claude --version', {
        encoding: 'utf-8',
        stdio: 'pipe',
        timeout: 5000,
      });
      this.claudeCodeAvailable = true;
      this.claudeCodeVersion = output.trim();
      this.emit('status', { available: true, version: this.claudeCodeVersion });
      return true;
    } catch {
      this.claudeCodeAvailable = false;
      this.emit('status', { available: false });
      return false;
    }
  }

  /**
   * Get Claude Code version
   */
  async getVersion(): Promise<string | null> {
    await this.isAvailable();
    return this.claudeCodeVersion;
  }

  /**
   * Execute a headless worker
   */
  async execute(
    workerType: HeadlessWorkerType,
    configOverrides?: Partial<HeadlessOptions>
  ): Promise<HeadlessExecutionResult> {
    const baseConfig = HEADLESS_WORKER_CONFIGS[workerType];
    if (!baseConfig) {
      throw new Error(`Unknown headless worker type: ${workerType}`);
    }

    // Check availability
    const available = await this.isAvailable();
    if (!available) {
      const result = this.createErrorResult(
        workerType,
        'Claude Code CLI not available. Install with: npm install -g @anthropic-ai/claude-code'
      );
      this.emit('error', result);
      return result;
    }

    // Check concurrent limit
    if (this.processPool.size >= this.config.maxConcurrent) {
      // Queue the request
      return new Promise((resolve, reject) => {
        const entry: QueueEntry = {
          workerType,
          config: configOverrides,
          resolve,
          reject,
          queuedAt: new Date(),
        };
        this.pendingQueue.push(entry);
        this.emit('queued', {
          workerType,
          queuePosition: this.pendingQueue.length,
        });
      });
    }

    // Execute immediately
    return this.executeInternal(workerType, configOverrides);
  }

  /**
   * Get pool status
   */
  getPoolStatus(): PoolStatus {
    const now = Date.now();
    return {
      activeCount: this.processPool.size,
      queueLength: this.pendingQueue.length,
      maxConcurrent: this.config.maxConcurrent,
      activeWorkers: Array.from(this.processPool.values()).map((entry) => ({
        executionId: entry.executionId,
        workerType: entry.workerType,
        startTime: entry.startTime,
        elapsedMs: now - entry.startTime.getTime(),
      })),
      queuedWorkers: this.pendingQueue.map((entry) => ({
        workerType: entry.workerType,
        queuedAt: entry.queuedAt,
        waitingMs: now - entry.queuedAt.getTime(),
      })),
    };
  }

  /**
   * Get number of active executions
   */
  getActiveCount(): number {
    return this.processPool.size;
  }

  /**
   * Cancel a running execution
   */
  cancel(executionId: string): boolean {
    const entry = this.processPool.get(executionId);
    if (!entry) {
      return false;
    }

    clearTimeout(entry.timeout);
    entry.process.kill('SIGTERM');
    this.processPool.delete(executionId);
    this.emit('cancelled', { executionId });

    // Process next in queue
    this.processQueue();

    return true;
  }

  /**
   * Cancel all running executions
   */
  cancelAll(): number {
    let cancelled = 0;

    // Cancel active processes (convert to array to avoid iterator issues)
    const entries = Array.from(this.processPool.entries());
    for (const [executionId, entry] of entries) {
      clearTimeout(entry.timeout);
      entry.process.kill('SIGTERM');
      this.emit('cancelled', { executionId });
      cancelled++;
    }
    this.processPool.clear();

    // Reject pending queue
    for (const entry of this.pendingQueue) {
      entry.reject(new Error('Executor cancelled all executions'));
    }
    this.pendingQueue = [];

    this.emit('allCancelled', { count: cancelled });
    return cancelled;
  }

  /**
   * Clear context cache
   */
  clearContextCache(): void {
    this.contextCache.clear();
    this.emit('cacheClear', {});
  }

  /**
   * Get worker configuration
   */
  getConfig(workerType: HeadlessWorkerType): HeadlessWorkerConfig | undefined {
    return HEADLESS_WORKER_CONFIGS[workerType];
  }

  /**
   * Get all headless worker types
   */
  getHeadlessWorkerTypes(): HeadlessWorkerType[] {
    return [...HEADLESS_WORKER_TYPES];
  }

  /**
   * Get all local worker types
   */
  getLocalWorkerTypes(): LocalWorkerType[] {
    return [...LOCAL_WORKER_TYPES];
  }

  // ============================================
  // Private Methods
  // ============================================

  /**
   * Ensure log directory exists
   */
  private ensureLogDir(): void {
    try {
      if (!existsSync(this.config.logDir)) {
        mkdirSync(this.config.logDir, { recursive: true });
      }
    } catch (error) {
      this.emit('warning', { message: 'Failed to create log directory', error });
    }
  }

  /**
   * Internal execution logic
   */
  private async executeInternal(
    workerType: HeadlessWorkerType,
    configOverrides?: Partial<HeadlessOptions>
  ): Promise<HeadlessExecutionResult> {
    const baseConfig = HEADLESS_WORKER_CONFIGS[workerType];
    const headless = { ...baseConfig.headless!, ...configOverrides };

    const startTime = Date.now();
    const executionId = `${workerType}_${startTime}_${Math.random().toString(36).slice(2, 8)}`;

    this.emit('start', { executionId, workerType, config: headless });

    try {
      // Build context from file patterns
      const context = await this.buildContext(headless.contextPatterns || []);

      // Build the full prompt
      const fullPrompt = this.buildPrompt(headless.promptTemplate, context);

      // Log prompt for debugging
      this.logExecution(executionId, 'prompt', fullPrompt);

      // Execute Claude Code headlessly
      const result = await this.executeClaudeCode(fullPrompt, {
        sandbox: headless.sandbox,
        model: headless.model || 'sonnet',
        timeoutMs: headless.timeoutMs || this.config.defaultTimeoutMs,
        executionId,
        workerType,
      });

      // Parse output based on format
      let parsedOutput: unknown;
      if (headless.outputFormat === 'json' && result.output) {
        parsedOutput = this.parseJsonOutput(result.output);
      } else if (headless.outputFormat === 'markdown' && result.output) {
        parsedOutput = this.parseMarkdownOutput(result.output);
      }

      const executionResult: HeadlessExecutionResult = {
        success: result.success,
        output: result.output,
        parsedOutput,
        durationMs: Date.now() - startTime,
        tokensUsed: result.tokensUsed,
        model: headless.model || 'sonnet',
        sandboxMode: headless.sandbox,
        workerType,
        timestamp: new Date(),
        executionId,
        error: result.error,
      };

      // Log result
      this.logExecution(executionId, 'result', JSON.stringify(executionResult, null, 2));

      this.emit('complete', executionResult);
      return executionResult;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      const executionResult = this.createErrorResult(workerType, errorMessage);
      executionResult.executionId = executionId;
      executionResult.durationMs = Date.now() - startTime;

      this.logExecution(executionId, 'error', errorMessage);
      this.emit('error', executionResult);

      return executionResult;
    } finally {
      // Process next in queue
      this.processQueue();
    }
  }

  /**
   * Process the pending queue
   */
  private processQueue(): void {
    while (
      this.pendingQueue.length > 0 &&
      this.processPool.size < this.config.maxConcurrent
    ) {
      const next = this.pendingQueue.shift();
      if (!next) break;

      this.executeInternal(next.workerType, next.config)
        .then(next.resolve)
        .catch(next.reject);
    }
  }

  /**
   * Build context from file patterns
   */
  private async buildContext(patterns: string[]): Promise<string> {
    if (patterns.length === 0) return '';

    // Check cache
    const cacheKey = patterns.sort().join('|');
    if (this.config.cacheContext) {
      const cached = this.contextCache.get(cacheKey);
      if (cached && Date.now() - cached.timestamp < this.config.cacheTtlMs) {
        return cached.content;
      }
    }

    // Collect files matching patterns
    const files: string[] = [];
    for (const pattern of patterns) {
      const matches = this.simpleGlob(pattern);
      files.push(...matches);
    }

    // Deduplicate and limit
    const uniqueFiles = Array.from(new Set(files)).slice(0, this.config.maxContextFiles);

    // Build context
    const contextParts: string[] = [];
    for (const file of uniqueFiles) {
      try {
        const fullPath = join(this.projectRoot, file);
        if (!existsSync(fullPath)) continue;

        const content = readFileSync(fullPath, 'utf-8');
        const truncated = content.slice(0, this.config.maxCharsPerFile);
        const wasTruncated = content.length > this.config.maxCharsPerFile;

        contextParts.push(
          `--- ${file}${wasTruncated ? ' (truncated)' : ''} ---\n${truncated}`
        );
      } catch {
        // Skip unreadable files
      }
    }

    const contextContent = contextParts.join('\n\n');

    // Cache the result
    if (this.config.cacheContext) {
      this.contextCache.set(cacheKey, {
        content: contextContent,
        timestamp: Date.now(),
        patterns,
      });
    }

    return contextContent;
  }

  /**
   * Simple glob implementation for file matching
   */
  private simpleGlob(pattern: string): string[] {
    const results: string[] = [];

    // Handle simple patterns (no wildcards)
    if (!pattern.includes('*')) {
      const fullPath = join(this.projectRoot, pattern);
      if (existsSync(fullPath)) {
        results.push(pattern);
      }
      return results;
    }

    // Parse pattern parts
    const parts = pattern.split('/');

    const scanDir = (dir: string, remainingParts: string[]): void => {
      if (remainingParts.length === 0) return;
      if (results.length >= 100) return; // Limit results

      try {
        const fullDir = join(this.projectRoot, dir);
        if (!existsSync(fullDir)) return;

        const entries = readdirSync(fullDir, { withFileTypes: true });
        const currentPart = remainingParts[0];
        const isLastPart = remainingParts.length === 1;

        for (const entry of entries) {
          // Skip common non-code directories
          if (
            entry.name === 'node_modules' ||
            entry.name === '.git' ||
            entry.name === 'dist' ||
            entry.name === 'build' ||
            entry.name === 'coverage' ||
            entry.name === '.next' ||
            entry.name === '.cache'
          ) {
            continue;
          }

          const entryPath = dir ? `${dir}/${entry.name}` : entry.name;

          if (currentPart === '**') {
            // Recursive glob
            if (entry.isDirectory()) {
              scanDir(entryPath, remainingParts); // Continue with **
              scanDir(entryPath, remainingParts.slice(1)); // Try next part
            } else if (entry.isFile() && remainingParts.length > 1) {
              // Check if file matches next pattern part
              const nextPart = remainingParts[1];
              if (this.matchesPattern(entry.name, nextPart)) {
                results.push(entryPath);
              }
            }
          } else if (this.matchesPattern(entry.name, currentPart)) {
            if (isLastPart && entry.isFile()) {
              results.push(entryPath);
            } else if (!isLastPart && entry.isDirectory()) {
              scanDir(entryPath, remainingParts.slice(1));
            }
          }
        }
      } catch {
        // Skip unreadable directories
      }
    };

    scanDir('', parts);
    return results;
  }

  /**
   * Match filename against a simple pattern
   */
  private matchesPattern(name: string, pattern: string): boolean {
    if (pattern === '*') return true;
    if (pattern === '**') return true;

    // Handle *.ext patterns
    if (pattern.startsWith('*.')) {
      return name.endsWith(pattern.slice(1));
    }

    // Handle prefix* patterns
    if (pattern.endsWith('*')) {
      return name.startsWith(pattern.slice(0, -1));
    }

    // Handle *suffix patterns
    if (pattern.startsWith('*')) {
      return name.endsWith(pattern.slice(1));
    }

    // Exact match
    return name === pattern;
  }

  /**
   * Build full prompt with context
   */
  private buildPrompt(template: string, context: string): string {
    if (!context) {
      return `${template}

## Instructions

Analyze the codebase and provide your response following the format specified in the task.`;
    }

    return `${template}

## Codebase Context

${context}

## Instructions

Analyze the above codebase context and provide your response following the format specified in the task.`;
  }

  /**
   * Execute Claude Code in headless mode
   */
  private executeClaudeCode(
    prompt: string,
    options: {
      sandbox: SandboxMode;
      model: ModelType;
      timeoutMs: number;
      executionId: string;
      workerType: HeadlessWorkerType;
    }
  ): Promise<{ success: boolean; output: string; tokensUsed?: number; error?: string }> {
    return new Promise((resolve) => {
      const env: Record<string, string> = {
        ...(process.env as Record<string, string>),
        CLAUDE_CODE_HEADLESS: 'true',
        CLAUDE_CODE_SANDBOX_MODE: options.sandbox,
      };

      // Set model
      env.ANTHROPIC_MODEL = MODEL_IDS[options.model];

      // Spawn claude CLI process
      const child = spawn('claude', ['--print', prompt], {
        cwd: this.projectRoot,
        env,
        stdio: ['pipe', 'pipe', 'pipe'],
      });

      // Setup timeout
      const timeoutHandle = setTimeout(() => {
        if (this.processPool.has(options.executionId)) {
          child.kill('SIGTERM');
          // Give it a moment to terminate gracefully
          setTimeout(() => {
            if (!child.killed) {
              child.kill('SIGKILL');
            }
          }, 5000);
        }
      }, options.timeoutMs);

      // Track in process pool
      const poolEntry: PoolEntry = {
        process: child,
        executionId: options.executionId,
        workerType: options.workerType,
        startTime: new Date(),
        timeout: timeoutHandle,
      };
      this.processPool.set(options.executionId, poolEntry);

      let stdout = '';
      let stderr = '';
      let resolved = false;

      const cleanup = () => {
        clearTimeout(timeoutHandle);
        this.processPool.delete(options.executionId);
      };

      child.stdout?.on('data', (data: Buffer) => {
        const chunk = data.toString();
        stdout += chunk;
        this.emit('output', {
          executionId: options.executionId,
          type: 'stdout',
          data: chunk,
        });
      });

      child.stderr?.on('data', (data: Buffer) => {
        const chunk = data.toString();
        stderr += chunk;
        this.emit('output', {
          executionId: options.executionId,
          type: 'stderr',
          data: chunk,
        });
      });

      child.on('close', (code: number | null) => {
        if (resolved) return;
        resolved = true;
        cleanup();

        resolve({
          success: code === 0,
          output: stdout || stderr,
          error: code !== 0 ? stderr || `Process exited with code ${code}` : undefined,
        });
      });

      child.on('error', (error: Error) => {
        if (resolved) return;
        resolved = true;
        cleanup();

        resolve({
          success: false,
          output: '',
          error: error.message,
        });
      });

      // Handle timeout
      setTimeout(() => {
        if (resolved) return;
        if (!this.processPool.has(options.executionId)) return;

        resolved = true;
        child.kill('SIGTERM');
        cleanup();

        resolve({
          success: false,
          output: stdout || stderr,
          error: `Execution timed out after ${options.timeoutMs}ms`,
        });
      }, options.timeoutMs + 100); // Slightly after the kill timeout
    });
  }

  /**
   * Parse JSON output from Claude Code
   */
  private parseJsonOutput(output: string): unknown {
    try {
      // Try to find JSON in code blocks first
      const codeBlockMatch = output.match(/```(?:json)?\s*([\s\S]*?)```/);
      if (codeBlockMatch) {
        return JSON.parse(codeBlockMatch[1].trim());
      }

      // Try to find any JSON object
      const jsonMatch = output.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        return JSON.parse(jsonMatch[0]);
      }

      // Try direct parse
      return JSON.parse(output.trim());
    } catch {
      return {
        parseError: true,
        rawOutput: output,
      };
    }
  }

  /**
   * Parse markdown output into sections
   */
  private parseMarkdownOutput(output: string): {
    sections: Array<{ title: string; content: string; level: number }>;
    codeBlocks: Array<{ language: string; code: string }>;
  } {
    const sections: Array<{ title: string; content: string; level: number }> = [];
    const codeBlocks: Array<{ language: string; code: string }> = [];

    // Extract code blocks first
    const codeBlockRegex = /```(\w*)\n([\s\S]*?)```/g;
    let codeMatch;
    while ((codeMatch = codeBlockRegex.exec(output)) !== null) {
      codeBlocks.push({
        language: codeMatch[1] || 'text',
        code: codeMatch[2].trim(),
      });
    }

    // Parse sections
    const lines = output.split('\n');
    let currentSection: { title: string; content: string; level: number } | null = null;

    for (const line of lines) {
      const headerMatch = line.match(/^(#{1,6})\s+(.+)$/);
      if (headerMatch) {
        if (currentSection) {
          sections.push(currentSection);
        }
        currentSection = {
          title: headerMatch[2].trim(),
          content: '',
          level: headerMatch[1].length,
        };
      } else if (currentSection) {
        currentSection.content += line + '\n';
      }
    }

    if (currentSection) {
      currentSection.content = currentSection.content.trim();
      sections.push(currentSection);
    }

    return { sections, codeBlocks };
  }

  /**
   * Create an error result
   */
  private createErrorResult(
    workerType: HeadlessWorkerType,
    error: string
  ): HeadlessExecutionResult {
    return {
      success: false,
      output: '',
      durationMs: 0,
      model: 'unknown',
      sandboxMode: 'strict',
      workerType,
      timestamp: new Date(),
      executionId: `error_${Date.now()}`,
      error,
    };
  }

  /**
   * Log execution details for debugging
   */
  private logExecution(
    executionId: string,
    type: 'prompt' | 'result' | 'error',
    content: string
  ): void {
    try {
      const timestamp = new Date().toISOString();
      const logFile = join(this.config.logDir, `${executionId}_${type}.log`);
      const logContent = `[${timestamp}] ${type.toUpperCase()}\n${'='.repeat(60)}\n${content}\n`;
      writeFileSync(logFile, logContent);
    } catch {
      // Ignore log write errors
    }
  }
}

// Export default
export default HeadlessWorkerExecutor;
