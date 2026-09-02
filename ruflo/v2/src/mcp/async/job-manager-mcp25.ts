/**
 * MCP 2025-11 Async Job Manager
 *
 * Implements async job lifecycle per MCP 2025-11 specification:
 * - Job handles with request_id
 * - Poll/resume semantics
 * - Progress tracking
 * - Job persistence
 */

import { EventEmitter } from 'events';
import { v4 as uuidv4 } from 'uuid';
import type { ILogger } from '../../interfaces/logger.js';

/**
 * MCP tool request (2025-11 format)
 */
export interface MCPToolRequest {
  request_id: string;
  tool_id: string;
  arguments: Record<string, any>;
  session?: string;
  mode: 'async' | 'sync';
  context?: {
    trace_id?: string;
    client_name?: string;
    [key: string]: any;
  };
}

/**
 * MCP job handle (2025-11 format)
 */
export interface MCPJobHandle {
  request_id: string;
  job_id: string;
  status: 'in_progress' | 'success' | 'error';
  poll_after: number; // seconds
  progress?: {
    percent: number;
    message?: string;
  };
}

/**
 * MCP job result (2025-11 format)
 */
export interface MCPJobResult {
  request_id: string;
  status: 'success' | 'error' | 'in_progress';
  result?: any;
  error?: {
    code: string;
    message: string;
    details?: any;
  };
  progress?: {
    percent: number;
    message?: string;
  };
  metadata: {
    duration_ms?: number;
    tokens_used?: number;
    [key: string]: any;
  };
}

/**
 * Internal job state
 */
interface AsyncJob {
  request_id: string;
  job_id: string;
  tool_id: string;
  arguments: Record<string, any>;
  mode: 'async' | 'sync';
  status: 'queued' | 'running' | 'success' | 'error' | 'cancelled';
  progress: number;
  progress_message?: string;
  result?: any;
  error?: any;
  context?: any;
  created_at: Date;
  started_at?: Date;
  completed_at?: Date;
  tokens_used?: number;
  abortController?: AbortController;
}

/**
 * Job persistence interface
 */
export interface JobPersistence {
  save(job: AsyncJob): Promise<void>;
  load(job_id: string): Promise<AsyncJob | null>;
  list(filter?: { status?: string; limit?: number }): Promise<AsyncJob[]>;
  delete(job_id: string): Promise<void>;
}

/**
 * Simple in-memory job persistence (fallback)
 */
export class MemoryJobPersistence implements JobPersistence {
  private jobs: Map<string, AsyncJob> = new Map();

  async save(job: AsyncJob): Promise<void> {
    this.jobs.set(job.job_id, { ...job });
  }

  async load(job_id: string): Promise<AsyncJob | null> {
    const job = this.jobs.get(job_id);
    return job ? { ...job } : null;
  }

  async list(filter?: { status?: string; limit?: number }): Promise<AsyncJob[]> {
    let jobs = Array.from(this.jobs.values());

    if (filter?.status) {
      jobs = jobs.filter(j => j.status === filter.status);
    }

    if (filter?.limit) {
      jobs = jobs.slice(0, filter.limit);
    }

    return jobs;
  }

  async delete(job_id: string): Promise<void> {
    this.jobs.delete(job_id);
  }
}

/**
 * MCP 2025-11 Async Job Manager
 */
export class MCPAsyncJobManager extends EventEmitter {
  private jobs: Map<string, AsyncJob> = new Map();
  private executors: Map<string, Promise<any>> = new Map();
  private persistence: JobPersistence;

  constructor(
    persistence: JobPersistence | null,
    private logger: ILogger,
    private config: {
      maxJobs?: number;
      jobTTL?: number;
      defaultPollInterval?: number;
    } = {}
  ) {
    super();
    this.persistence = persistence || new MemoryJobPersistence();

    // Default config
    this.config.maxJobs = this.config.maxJobs || 1000;
    this.config.jobTTL = this.config.jobTTL || 86400000; // 24 hours
    this.config.defaultPollInterval = this.config.defaultPollInterval || 5;

    // Cleanup expired jobs periodically
    setInterval(() => this.cleanupExpiredJobs(), 3600000); // Every hour
  }

  /**
   * Submit async job (MCP 2025-11 format)
   */
  async submitJob(
    request: MCPToolRequest,
    executor: (args: any, onProgress: (percent: number, message?: string) => void) => Promise<any>
  ): Promise<MCPJobHandle> {
    // Check capacity
    if (this.jobs.size >= this.config.maxJobs!) {
      throw new Error('Job queue full. Please try again later.');
    }

    // Check for duplicate request_id (prevent race conditions)
    const existingJob = Array.from(this.jobs.values()).find(
      j => j.request_id === request.request_id &&
           (j.status === 'queued' || j.status === 'running')
    );
    if (existingJob) {
      throw new Error(`Duplicate request_id: ${request.request_id}. Job already submitted.`);
    }

    // Create job
    const job: AsyncJob = {
      request_id: request.request_id,
      job_id: uuidv4(),
      tool_id: request.tool_id,
      arguments: request.arguments,
      mode: request.mode,
      status: 'queued',
      progress: 0,
      context: request.context,
      created_at: new Date(),
    };

    // Save to persistence
    await this.persistence.save(job);
    this.jobs.set(job.job_id, job);

    this.logger.info('Job submitted', {
      job_id: job.job_id,
      request_id: job.request_id,
      tool_id: job.tool_id,
    });

    // Start execution in background
    this.executeJob(job, executor);

    // Return job handle immediately
    return {
      request_id: job.request_id,
      job_id: job.job_id,
      status: 'in_progress',
      poll_after: this.config.defaultPollInterval!,
    };
  }

  /**
   * Poll job status
   */
  async pollJob(job_id: string): Promise<MCPJobHandle> {
    const job = await this.persistence.load(job_id);

    if (!job) {
      throw new Error(`Job not found: ${job_id}`);
    }

    const status = job.status === 'success' ? 'success' :
                   job.status === 'error' ? 'error' : 'in_progress';

    const handle: MCPJobHandle = {
      request_id: job.request_id,
      job_id: job.job_id,
      status,
      poll_after: status === 'in_progress' ? this.config.defaultPollInterval! : 0,
    };

    if (status === 'in_progress') {
      handle.progress = {
        percent: job.progress,
        message: job.progress_message,
      };
    }

    return handle;
  }

  /**
   * Resume job (get results)
   */
  async resumeJob(job_id: string): Promise<MCPJobResult> {
    const job = await this.persistence.load(job_id);

    if (!job) {
      throw new Error(`Job not found: ${job_id}`);
    }

    const result: MCPJobResult = {
      request_id: job.request_id,
      status: job.status === 'success' ? 'success' :
              job.status === 'error' ? 'error' : 'in_progress',
      metadata: {},
    };

    if (job.status === 'success') {
      result.result = job.result;
      result.metadata.duration_ms = job.completed_at && job.started_at
        ? job.completed_at.getTime() - job.started_at.getTime()
        : undefined;
      result.metadata.tokens_used = job.tokens_used;
    } else if (job.status === 'error') {
      result.error = {
        code: 'EXECUTION_ERROR',
        message: job.error?.message || 'Job execution failed',
        details: job.error,
      };
    } else {
      // Still in progress
      result.progress = {
        percent: job.progress,
        message: job.progress_message,
      };
    }

    return result;
  }

  /**
   * Cancel a running job
   */
  async cancelJob(job_id: string): Promise<boolean> {
    const job = this.jobs.get(job_id);

    if (!job) {
      return false;
    }

    if (job.status === 'success' || job.status === 'error') {
      return false; // Already finished
    }

    // Abort execution if AbortController is available
    if (job.abortController) {
      job.abortController.abort();
    }

    job.status = 'cancelled';
    job.completed_at = new Date();
    await this.persistence.save(job);

    this.emit('job:cancelled', job_id);
    this.logger.info('Job cancelled', { job_id });

    return true;
  }

  /**
   * List jobs
   */
  async listJobs(filter?: {
    status?: string;
    limit?: number;
  }): Promise<AsyncJob[]> {
    return await this.persistence.list(filter);
  }

  /**
   * Execute job in background
   */
  private async executeJob(
    job: AsyncJob,
    executor: (args: any, onProgress: (percent: number, message?: string) => void) => Promise<any>
  ): Promise<void> {
    // Update status to running
    job.status = 'running';
    job.started_at = new Date();

    // Create AbortController for cancellation support
    job.abortController = new AbortController();

    await this.persistence.save(job);

    this.emit('job:started', job.job_id);
    this.logger.info('Job started', { job_id: job.job_id, tool_id: job.tool_id });

    try {
      // Progress callback
      const onProgress = (percent: number, message?: string) => {
        job.progress = Math.min(100, Math.max(0, percent));
        job.progress_message = message;
        this.persistence.save(job).catch(err =>
          this.logger.error('Failed to save progress', { job_id: job.job_id, error: err })
        );
        this.emit('job:progress', job.job_id, job.progress, message);
      };

      // Check if already cancelled
      if (job.abortController.signal.aborted) {
        throw new Error('Job cancelled before execution');
      }

      // Execute with abort support
      const result = await executor(job.arguments, onProgress);

      // Mark successful
      job.status = 'success';
      job.result = result;
      job.progress = 100;
      job.completed_at = new Date();
      await this.persistence.save(job);

      this.emit('job:completed', job.job_id, result);
      this.logger.info('Job completed', {
        job_id: job.job_id,
        duration_ms: job.completed_at.getTime() - job.started_at!.getTime(),
      });
    } catch (error: any) {
      // Mark failed
      job.status = 'error';
      job.error = {
        message: error.message,
        stack: error.stack,
        code: error.code,
      };
      job.completed_at = new Date();
      await this.persistence.save(job);

      this.emit('job:failed', job.job_id, error);
      this.logger.error('Job failed', {
        job_id: job.job_id,
        error: error.message,
      });
    }
  }

  /**
   * Cleanup expired jobs
   */
  private async cleanupExpiredJobs(): Promise<number> {
    const now = Date.now();
    const jobs = await this.persistence.list();
    let cleaned = 0;

    for (const job of jobs) {
      const age = now - job.created_at.getTime();

      // Remove if expired and not running
      if (age > this.config.jobTTL! && job.status !== 'running') {
        await this.persistence.delete(job.job_id);
        this.jobs.delete(job.job_id);
        cleaned++;
      }
    }

    if (cleaned > 0) {
      this.logger.info('Cleaned up expired jobs', { count: cleaned });
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
        success: jobs.filter(j => j.status === 'success').length,
        error: jobs.filter(j => j.status === 'error').length,
        cancelled: jobs.filter(j => j.status === 'cancelled').length,
      },
      averageDuration: this.calculateAverageDuration(jobs),
    };
  }

  private calculateAverageDuration(jobs: AsyncJob[]): number {
    const completed = jobs.filter(j =>
      (j.status === 'success' || j.status === 'error') &&
      j.started_at && j.completed_at
    );

    if (completed.length === 0) return 0;

    const total = completed.reduce((sum, j) =>
      sum + (j.completed_at!.getTime() - j.started_at!.getTime()), 0
    );

    return total / completed.length;
  }
}
