/**
 * Dual-Mode Orchestrator
 * Runs Claude Code and Codex workers in parallel with shared memory
 */

import { spawn, ChildProcess } from 'child_process';
import { EventEmitter } from 'events';
import * as path from 'path';
import * as fs from 'fs';

export interface WorkerConfig {
  id: string;
  platform: 'claude' | 'codex';
  role: string;
  prompt: string;
  model?: string;
  maxTurns?: number;
  timeout?: number;
  dependsOn?: string[];
}

export interface WorkerResult {
  id: string;
  platform: 'claude' | 'codex';
  role: string;
  status: 'pending' | 'running' | 'completed' | 'failed';
  output?: string;
  error?: string;
  startedAt?: Date;
  completedAt?: Date;
  memoryKeys?: string[];
}

export interface DualModeConfig {
  projectPath: string;
  maxConcurrent?: number;
  sharedNamespace?: string;
  timeout?: number;
  claudeCommand?: string;
  codexCommand?: string;
}

export interface CollaborationResult {
  success: boolean;
  workers: WorkerResult[];
  sharedMemory: Record<string, any>;
  totalDuration: number;
  errors: string[];
}

/**
 * Orchestrates parallel execution of Claude Code and Codex workers
 */
export class DualModeOrchestrator extends EventEmitter {
  private config: Required<DualModeConfig>;
  private workers: Map<string, WorkerResult> = new Map();
  private processes: Map<string, ChildProcess> = new Map();

  constructor(config: DualModeConfig) {
    super();
    this.config = {
      projectPath: config.projectPath,
      maxConcurrent: config.maxConcurrent ?? 4,
      sharedNamespace: config.sharedNamespace ?? 'collaboration',
      timeout: config.timeout ?? 300000, // 5 minutes
      claudeCommand: config.claudeCommand ?? 'claude',
      codexCommand: config.codexCommand ?? 'codex',
    };
  }

  /**
   * Initialize shared memory for collaboration
   */
  async initializeSharedMemory(taskContext: string): Promise<void> {
    const { projectPath, sharedNamespace } = this.config;

    // Initialize memory database
    await this.runCommand(
      'npx',
      ['ruflo@latest', 'memory', 'init', '--force'],
      projectPath
    );

    // Store task context
    await this.runCommand(
      'npx',
      [
        'ruflo@latest', 'memory', 'store',
        '--key', 'task-context',
        '--value', taskContext,
        '--namespace', sharedNamespace
      ],
      projectPath
    );

    this.emit('memory:initialized', { namespace: sharedNamespace, taskContext });
  }

  /**
   * Spawn a headless worker
   */
  async spawnWorker(config: WorkerConfig): Promise<void> {
    const result: WorkerResult = {
      id: config.id,
      platform: config.platform,
      role: config.role,
      status: 'pending',
      memoryKeys: [],
    };
    this.workers.set(config.id, result);

    // Wait for dependencies
    if (config.dependsOn?.length) {
      await this.waitForDependencies(config.dependsOn);
    }

    result.status = 'running';
    result.startedAt = new Date();
    this.emit('worker:started', { id: config.id, role: config.role, platform: config.platform });

    try {
      const output = await this.executeHeadless(config);
      result.status = 'completed';
      result.output = output;
      result.completedAt = new Date();
      this.emit('worker:completed', { id: config.id, output: output.slice(0, 200) });
    } catch (error) {
      result.status = 'failed';
      result.error = error instanceof Error ? error.message : String(error);
      result.completedAt = new Date();
      this.emit('worker:failed', { id: config.id, error: result.error });
    }
  }

  /**
   * Execute a headless Claude/Codex instance
   */
  private async executeHeadless(config: WorkerConfig): Promise<string> {
    const { projectPath, timeout } = this.config;
    const command = config.platform === 'claude' ? this.config.claudeCommand : this.config.codexCommand;

    // Build the prompt with memory integration
    const enhancedPrompt = this.buildCollaborativePrompt(config);

    // Each platform has its own non-interactive entry point and flag set:
    //   Claude Code:  claude -p <prompt> --output-format text [--max-turns N] [--model M]
    //   OpenAI Codex: codex exec --sandbox workspace-write --skip-git-repo-check [-m M] <prompt>
    // (`codex exec` runs autonomously; PROMPT is a positional arg and must come last.)
    let args: string[];
    if (config.platform === 'claude') {
      args = ['-p', enhancedPrompt, '--output-format', 'text'];
      if (config.maxTurns) {
        args.push('--max-turns', String(config.maxTurns));
      }
      if (config.model) {
        args.push('--model', config.model);
      }
    } else {
      args = ['exec', '--sandbox', 'workspace-write', '--skip-git-repo-check'];
      if (config.model) {
        args.push('-m', config.model);
      }
      args.push(enhancedPrompt);
    }

    return new Promise((resolve, reject) => {
      let output = '';
      let errorOutput = '';

      const proc = spawn(command, args, {
        cwd: projectPath,
        env: { ...process.env, FORCE_COLOR: '0' },
        stdio: ['pipe', 'pipe', 'pipe'],
      });

      this.processes.set(config.id, proc);

      proc.stdout?.on('data', (data) => {
        output += data.toString();
      });

      proc.stderr?.on('data', (data) => {
        errorOutput += data.toString();
      });

      const timer = setTimeout(() => {
        proc.kill('SIGTERM');
        reject(new Error(`Worker ${config.id} timed out after ${timeout}ms`));
      }, timeout);

      proc.on('close', (code) => {
        clearTimeout(timer);
        this.processes.delete(config.id);

        if (code === 0 || output.length > 0) {
          resolve(output || errorOutput);
        } else {
          reject(new Error(`Worker ${config.id} exited with code ${code}: ${errorOutput}`));
        }
      });

      proc.on('error', (err) => {
        clearTimeout(timer);
        this.processes.delete(config.id);
        reject(err);
      });
    });
  }

  /**
   * Build a prompt that includes memory coordination instructions
   */
  private buildCollaborativePrompt(config: WorkerConfig): string {
    const { sharedNamespace, projectPath } = this.config;

    return `You are a ${config.role.toUpperCase()} agent in a collaborative dual-mode swarm.
Platform: ${config.platform === 'claude' ? 'Claude Code' : 'OpenAI Codex'}
Working Directory: ${projectPath}
Shared Memory Namespace: ${sharedNamespace}

COLLABORATION PROTOCOL:
1. Search shared memory for context: npx ruflo@latest memory search --query "<relevant terms>" --namespace ${sharedNamespace}
2. Complete your assigned task
3. Store your results: npx ruflo@latest memory store --key "${config.id}-result" --value "<your summary>" --namespace ${sharedNamespace}

YOUR TASK:
${config.prompt}

Remember: Other agents depend on your results in shared memory. Be concise and store actionable outputs.`;
  }

  /**
   * Wait for dependent workers to complete
   */
  private async waitForDependencies(deps: string[]): Promise<void> {
    const checkInterval = 500;
    const maxWait = this.config.timeout;
    let waited = 0;

    while (waited < maxWait) {
      const allComplete = deps.every(depId => {
        const worker = this.workers.get(depId);
        return worker && (worker.status === 'completed' || worker.status === 'failed');
      });

      if (allComplete) return;

      await new Promise(resolve => setTimeout(resolve, checkInterval));
      waited += checkInterval;
    }

    throw new Error(`Dependencies [${deps.join(', ')}] did not complete in time`);
  }

  /**
   * Run a swarm of collaborative workers
   */
  async runCollaboration(workers: WorkerConfig[], taskContext: string): Promise<CollaborationResult> {
    const startTime = Date.now();
    const errors: string[] = [];

    // Initialize shared memory
    await this.initializeSharedMemory(taskContext);

    // Group workers by dependency level
    const levels = this.buildDependencyLevels(workers);

    // Execute each level in parallel
    for (const level of levels) {
      const promises = level.map(worker =>
        this.spawnWorker(worker).catch(err => {
          errors.push(`${worker.id}: ${err.message}`);
        })
      );
      await Promise.all(promises);
    }

    // Collect shared memory results
    const sharedMemory = await this.collectSharedMemory();

    return {
      success: errors.length === 0,
      workers: Array.from(this.workers.values()),
      sharedMemory,
      totalDuration: Date.now() - startTime,
      errors,
    };
  }

  /**
   * Build dependency levels for parallel execution
   */
  private buildDependencyLevels(workers: WorkerConfig[]): WorkerConfig[][] {
    const levels: WorkerConfig[][] = [];
    const placed = new Set<string>();

    while (placed.size < workers.length) {
      const level: WorkerConfig[] = [];

      for (const worker of workers) {
        if (placed.has(worker.id)) continue;

        const depsReady = !worker.dependsOn ||
          worker.dependsOn.every(dep => placed.has(dep));

        if (depsReady) {
          level.push(worker);
        }
      }

      if (level.length === 0 && placed.size < workers.length) {
        // Circular dependency detected, add remaining
        for (const worker of workers) {
          if (!placed.has(worker.id)) {
            level.push(worker);
          }
        }
      }

      for (const worker of level) {
        placed.add(worker.id);
      }

      if (level.length > 0) {
        levels.push(level);
      }
    }

    return levels;
  }

  /**
   * Collect results from shared memory
   */
  private async collectSharedMemory(): Promise<Record<string, any>> {
    const { projectPath, sharedNamespace } = this.config;

    try {
      const output = await this.runCommand(
        'npx',
        ['ruflo@latest', 'memory', 'list', '--namespace', sharedNamespace, '--format', 'json'],
        projectPath
      );
      return JSON.parse(output);
    } catch {
      return {};
    }
  }

  /**
   * Run a command and return output
   */
  private runCommand(command: string, args: string[], cwd: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const proc = spawn(command, args, { cwd, stdio: ['pipe', 'pipe', 'pipe'] });
      let output = '';
      let error = '';

      proc.stdout?.on('data', (data) => { output += data.toString(); });
      proc.stderr?.on('data', (data) => { error += data.toString(); });

      proc.on('close', (code) => {
        if (code === 0) {
          resolve(output);
        } else {
          reject(new Error(error || `Command failed with code ${code}`));
        }
      });

      proc.on('error', reject);
    });
  }

  /**
   * Stop all running workers
   */
  stopAll(): void {
    for (const [id, proc] of this.processes) {
      proc.kill('SIGTERM');
      this.emit('worker:stopped', { id });
    }
    this.processes.clear();
  }
}

/**
 * Pre-built collaboration templates
 */
export const CollaborationTemplates = {
  /**
   * Feature development swarm
   */
  featureDevelopment: (feature: string): WorkerConfig[] => [
    {
      id: 'architect',
      platform: 'claude',
      role: 'architect',
      prompt: `Design the architecture for: ${feature}. Define components, interfaces, and data flow.`,
      maxTurns: 10,
    },
    {
      id: 'coder',
      platform: 'codex',
      role: 'coder',
      prompt: `Implement the feature based on the architecture. Write clean, typed code.`,
      dependsOn: ['architect'],
      maxTurns: 15,
    },
    {
      id: 'tester',
      platform: 'codex',
      role: 'tester',
      prompt: `Write comprehensive tests for the implementation. Target 80% coverage.`,
      dependsOn: ['coder'],
      maxTurns: 10,
    },
    {
      id: 'reviewer',
      platform: 'claude',
      role: 'reviewer',
      prompt: `Review the code and tests for quality, security, and best practices.`,
      dependsOn: ['coder', 'tester'],
      maxTurns: 8,
    },
  ],

  /**
   * Security audit swarm
   */
  securityAudit: (target: string): WorkerConfig[] => [
    {
      id: 'scanner',
      platform: 'codex',
      role: 'security-scanner',
      prompt: `Scan ${target} for security vulnerabilities. Check OWASP Top 10.`,
      maxTurns: 10,
    },
    {
      id: 'analyzer',
      platform: 'claude',
      role: 'security-analyst',
      prompt: `Analyze scan results and identify critical vulnerabilities.`,
      dependsOn: ['scanner'],
      maxTurns: 8,
    },
    {
      id: 'fixer',
      platform: 'codex',
      role: 'security-fixer',
      prompt: `Generate fixes for identified vulnerabilities.`,
      dependsOn: ['analyzer'],
      maxTurns: 12,
    },
  ],

  /**
   * Refactoring swarm
   */
  refactoring: (target: string): WorkerConfig[] => [
    {
      id: 'analyzer',
      platform: 'claude',
      role: 'code-analyzer',
      prompt: `Analyze ${target} for refactoring opportunities. Identify code smells.`,
      maxTurns: 8,
    },
    {
      id: 'planner',
      platform: 'claude',
      role: 'refactor-planner',
      prompt: `Create a refactoring plan based on the analysis.`,
      dependsOn: ['analyzer'],
      maxTurns: 6,
    },
    {
      id: 'refactorer',
      platform: 'codex',
      role: 'refactorer',
      prompt: `Execute the refactoring plan. Maintain all existing functionality.`,
      dependsOn: ['planner'],
      maxTurns: 15,
    },
    {
      id: 'validator',
      platform: 'codex',
      role: 'validator',
      prompt: `Run tests and validate the refactoring didn't break anything.`,
      dependsOn: ['refactorer'],
      maxTurns: 5,
    },
  ],
};
