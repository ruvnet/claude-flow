/**
 * Dual-Mode Orchestrator
 * Runs Claude Code and Codex workers in parallel with shared memory
 */

import { spawn, ChildProcess } from 'child_process';
import { EventEmitter } from 'events';
import * as path from 'path';
import * as fs from 'fs';
import * as TOML from '@iarna/toml';

export interface WorkerCapabilityEnvelope {
  actions?: string[];
  resources?: string[];
  tools?: string[];
  maxConcurrency?: number;
  network?: boolean;
  destructive?: boolean;
  delegationDepth?: number;
  expiresAt?: number;
}

export interface WorkerConfig {
  id: string;
  platform: 'claude' | 'codex';
  role: string;
  prompt: string;
  model?: string;
  maxTurns?: number;
  timeout?: number;
  dependsOn?: string[];
  /** Required for concurrent writing roles; each writer must own one cwd. */
  worktreePath?: string;
  readOnly?: boolean;
  capabilityEnvelope?: WorkerCapabilityEnvelope;
}

export interface WorkerResult {
  id: string;
  platform: 'claude' | 'codex';
  role: string;
  status: 'pending' | 'running' | 'completed' | 'failed' | 'skipped';
  output?: string;
  error?: string;
  startedAt?: Date;
  completedAt?: Date;
  memoryKeys?: string[];
}

export interface DualModeConfig {
  projectPath: string;
  /** One database shared by bootstrap, collection, policy, and worker CLIs. */
  memoryDbPath?: string;
  maxConcurrent?: number;
  sharedNamespace?: string;
  timeout?: number;
  claudeCommand?: string;
  codexCommand?: string;
  maxOutputBytes?: number;
  maxWriters?: number;
  worktreeIsolation?: boolean;
  dependencyFailure?: 'cancel' | 'skip';
  policyPreflight?: boolean;
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
    if (!Number.isInteger(config.maxConcurrent ?? 4) || (config.maxConcurrent ?? 4) < 1) {
      throw new Error('maxConcurrent must be a positive integer');
    }
    if (!Number.isFinite(config.maxOutputBytes ?? 1_048_576) || (config.maxOutputBytes ?? 1_048_576) < 1) {
      throw new Error('maxOutputBytes must be positive');
    }
    if (!Number.isInteger(config.maxWriters ?? 2) || (config.maxWriters ?? 2) < 1) {
      throw new Error('maxWriters must be a positive integer');
    }
    this.config = {
      projectPath: config.projectPath,
      memoryDbPath: path.resolve(
        config.memoryDbPath
          ?? process.env.CLAUDE_FLOW_DB_PATH
          ?? path.join(config.projectPath, '.claude-flow', 'dual-mode-memory.db'),
      ),
      maxConcurrent: config.maxConcurrent ?? 4,
      sharedNamespace: config.sharedNamespace ?? 'collaboration',
      timeout: config.timeout ?? 300000, // 5 minutes
      claudeCommand: config.claudeCommand ?? 'claude',
      codexCommand: config.codexCommand ?? 'codex',
      maxOutputBytes: config.maxOutputBytes ?? 1_048_576,
      maxWriters: config.maxWriters ?? 2,
      worktreeIsolation: config.worktreeIsolation ?? false,
      dependencyFailure: config.dependencyFailure ?? 'cancel',
      policyPreflight: config.policyPreflight ?? false,
    };
  }

  /**
   * Initialize shared memory for collaboration
   */
  async initializeSharedMemory(taskContext: string): Promise<void> {
    const { projectPath, sharedNamespace, memoryDbPath } = this.config;
    fs.mkdirSync(path.dirname(memoryDbPath), { recursive: true });

    // Initialize memory database
    await this.runCommand(
      'npx',
      ['ruflo@latest', 'memory', 'init'],
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

    if (this.config.policyPreflight) {
      try {
        await this.authorizeWorker(config);
      } catch (error) {
        result.status = 'failed';
        result.error = error instanceof Error ? error.message : String(error);
        result.completedAt = new Date();
        this.emit('worker:failed', { id: config.id, error: result.error });
        throw error;
      }
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
    const { projectPath, timeout, maxOutputBytes } = this.config;
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
      args = ['exec', '--sandbox',
        config.readOnly ? 'read-only' : 'workspace-write',
        '--skip-git-repo-check',
      ];
      if (config.model) {
        args.push('-m', config.model);
      }
      args.push(enhancedPrompt);
    }

    return new Promise((resolve, reject) => {
      let output = '';
      let errorOutput = '';

      const proc = spawn(command, args, {
        cwd: config.worktreePath ? path.resolve(config.worktreePath) : projectPath,
        env: this.workerEnvironment(config),
        stdio: ['pipe', 'pipe', 'pipe'],
      });

      // #2947: both platforms receive their prompt positionally/via flag
      // (never over stdin), but the pipe is left open. `claude -p` ignores
      // an open stdin, so this was invisible in practice — `codex exec`
      // instead blocks in resolve_root_prompt waiting for stdin EOF that
      // never comes, hanging every real Codex worker until the orchestrator's
      // own timeout kills it.
      proc.stdin?.end();

      this.processes.set(config.id, proc);

      proc.stdout?.on('data', (data) => {
        if (output.length < maxOutputBytes) output += data.toString().slice(0, maxOutputBytes - output.length);
      });

      proc.stderr?.on('data', (data) => {
        if (errorOutput.length < maxOutputBytes) errorOutput += data.toString().slice(0, maxOutputBytes - errorOutput.length);
      });

      const timer = setTimeout(() => {
        proc.kill('SIGTERM');
        reject(new Error(`Worker ${config.id} timed out after ${timeout}ms`));
      }, timeout);

      proc.on('close', (code) => {
        clearTimeout(timer);
        this.processes.delete(config.id);

        if (code === 0) {
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
Working Directory: ${config.worktreePath ? path.resolve(config.worktreePath) : projectPath}
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

    // Execute each level with a hard concurrency cap.
    let cancelled = false;
    collaboration: for (const level of levels) {
      for (const batch of this.partitionLevel(level)) {
        await Promise.all(batch.map(async (worker) => {
          const failedDependency = worker.dependsOn?.find((id) => this.workers.get(id)?.status !== 'completed');
          if (failedDependency) {
            this.workers.set(worker.id, {
              id: worker.id,
              platform: worker.platform,
              role: worker.role,
              status: 'skipped',
              error: `dependency failed: ${failedDependency}`,
            });
            errors.push(`${worker.id}: dependency failed: ${failedDependency}`);
            return;
          }
          await this.spawnWorker(worker).catch(err => {
            errors.push(`${worker.id}: ${err.message}`);
          });
          const result = this.workers.get(worker.id);
          if (result?.status === 'failed') errors.push(`${worker.id}: ${result.error}`);
        }));
        if (this.config.dependencyFailure === 'cancel'
          && batch.some((worker) => this.workers.get(worker.id)?.status === 'failed')) {
          cancelled = true;
          break collaboration;
        }
      }
    }
    if (cancelled) {
      for (const worker of workers) {
        if (this.workers.has(worker.id)) continue;
        this.workers.set(worker.id, {
          id: worker.id,
          platform: worker.platform,
          role: worker.role,
          status: 'skipped',
          error: 'collaboration cancelled after worker failure',
        });
      }
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
    const ids = new Set<string>();
    for (const worker of workers) {
      if (!worker.id || ids.has(worker.id)) throw new Error(`duplicate worker id: ${worker.id}`);
      ids.add(worker.id);
    }
    for (const worker of workers) {
      for (const dependency of worker.dependsOn ?? []) {
        if (!ids.has(dependency)) throw new Error(`worker ${worker.id} depends on missing worker ${dependency}`);
      }
    }
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
        const remaining = workers.filter((worker) => !placed.has(worker.id)).map((worker) => worker.id);
        throw new Error(`worker dependency cycle: ${remaining.join(', ')}`);
      }

      for (const worker of level) {
        placed.add(worker.id);
      }

      if (level.length > 0) {
        levels.push(level);
      }
    }

    for (const level of levels) {
      const writerPaths = new Set<string>();
      const writers = level.filter((item) => !item.readOnly);
      for (const worker of writers) {
        if (this.config.worktreeIsolation && !worker.worktreePath) {
          throw new Error(`writer ${worker.id} requires an isolated worktree`);
        }
        const writerPath = path.resolve(worker.worktreePath ?? this.config.projectPath);
        if (this.config.worktreeIsolation && writerPaths.has(writerPath)) {
          throw new Error(`concurrent writers must use distinct worktrees: ${writerPath}`);
        }
        writerPaths.add(writerPath);
      }
    }
    return levels;
  }

  /** Preserve read-only parallelism while independently bounding writers. */
  private partitionLevel(level: WorkerConfig[]): WorkerConfig[][] {
    const remaining = [...level];
    const batches: WorkerConfig[][] = [];
    while (remaining.length > 0) {
      const batch: WorkerConfig[] = [];
      let writers = 0;
      for (let index = 0; index < remaining.length && batch.length < this.config.maxConcurrent;) {
        const candidate = remaining[index]!;
        if (!candidate.readOnly && writers >= this.config.maxWriters) {
          index += 1;
          continue;
        }
        batch.push(candidate);
        if (!candidate.readOnly) writers += 1;
        remaining.splice(index, 1);
      }
      // maxWriters is validated as positive, so at least one item is schedulable.
      batches.push(batch);
    }
    return batches;
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
      const proc = spawn(command, args, {
        cwd,
        env: this.sharedEnvironment(),
        stdio: ['pipe', 'pipe', 'pipe'],
      });
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

  private async authorizeWorker(worker: WorkerConfig): Promise<void> {
    const envelope = this.resolveWorkerEnvelope(worker);
    const request = {
      identity: { id: `agent:${worker.id}`, type: 'agent', roles: [worker.role] },
      action: {
        type: 'swarm.worker.spawn',
        resource: worker.worktreePath ?? this.config.projectPath,
        tool: worker.platform,
        concurrency: 1,
        network: false,
        destructive: false,
      },
      context: {
        metadata: { childCapabilityEnvelope: envelope },
      },
    };
    const raw = await this.runCommand(
      'npx',
      ['ruflo@latest', 'policy', 'evaluate', JSON.stringify(request)],
      this.config.projectPath,
    );
    const decision = JSON.parse(raw) as { enforcedOutcome?: string; reason?: string };
    if (decision.enforcedOutcome !== 'allowed') {
      throw new Error(`worker policy denied: ${decision.reason ?? 'unknown reason'}`);
    }
    worker.capabilityEnvelope = envelope;
  }

  private defaultWorkerEnvelope(worker: WorkerConfig): WorkerCapabilityEnvelope {
    return {
      actions: ['*'],
      resources: ['*'],
      tools: ['*'],
      maxConcurrency: 1,
      network: false,
      destructive: false,
      delegationDepth: 0,
      expiresAt: Date.now() + this.config.timeout,
    };
  }

  private resolveWorkerEnvelope(worker: WorkerConfig): WorkerCapabilityEnvelope {
    const parent = this.defaultWorkerEnvelope(worker);
    const requested = worker.capabilityEnvelope;
    if (!requested) return parent;
    const child = { ...parent, ...requested };
    const matches = (patterns: string[] | undefined, value: string): boolean => (
      !patterns?.length
      || patterns.some((pattern) => pattern === '*' || pattern === value
        || (pattern.endsWith('*') && value.startsWith(pattern.slice(0, -1))))
    );
    const subset = (values: string[] | undefined, patterns: string[] | undefined): boolean => (
      !patterns?.length || (!!values?.length && values.every((value) => matches(patterns, value)))
    );
    const valid = subset(child.actions, parent.actions)
      && subset(child.resources, parent.resources)
      && subset(child.tools, parent.tools)
      && (parent.maxConcurrency === undefined
        || (child.maxConcurrency !== undefined && child.maxConcurrency <= parent.maxConcurrency))
      && (parent.expiresAt === undefined
        || (child.expiresAt !== undefined && child.expiresAt <= parent.expiresAt))
      && (parent.delegationDepth === undefined
        || (child.delegationDepth !== undefined && child.delegationDepth <= parent.delegationDepth))
      && !(child.network === true && parent.network !== true)
      && !(child.destructive === true && parent.destructive !== true);
    if (!valid) throw new Error(`worker ${worker.id} capability envelope cannot expand`);
    return child;
  }

  private workerEnvironment(worker: WorkerConfig): NodeJS.ProcessEnv {
    const env: NodeJS.ProcessEnv = {};
    const sensitive = /(?:^|_)(?:API_?KEY|KEY|SECRET|TOKEN|PASSWORD|CREDENTIALS?)$/i;
    for (const [name, value] of Object.entries(process.env)) {
      if (sensitive.test(name)
        || name.startsWith('CLAUDE_FLOW_POLICY_')
        || name === 'CLAUDE_FLOW_PRINCIPAL_ID') continue;
      env[name] = value;
    }
    env.FORCE_COLOR = '0';
    env.CLAUDE_FLOW_DB_PATH = this.config.memoryDbPath;
    env.CLAUDE_FLOW_PRINCIPAL_ID = `agent:${worker.id}`;
    env.CLAUDE_FLOW_CAPABILITY_ENVELOPE = JSON.stringify(
      this.resolveWorkerEnvelope(worker),
    );
    return env;
  }

  /** Keep every Ruflo subprocess on the same collaboration database. */
  private sharedEnvironment(): NodeJS.ProcessEnv {
    return {
      ...process.env,
      CLAUDE_FLOW_DB_PATH: this.config.memoryDbPath,
    };
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

export interface LoadedSwarmAutomationConfig {
  enabled: boolean;
  maxConcurrent: number;
  maxWriters: number;
  worktreeIsolation: boolean;
  agentTimeoutSeconds: number;
  maxOutputBytes: number;
  dependencyFailure: 'cancel' | 'skip';
}

export function loadSwarmAutomationConfig(projectPath: string): LoadedSwarmAutomationConfig {
  const defaults: LoadedSwarmAutomationConfig = {
    enabled: false,
    maxConcurrent: 4,
    maxWriters: 2,
    worktreeIsolation: true,
    agentTimeoutSeconds: 1800,
    maxOutputBytes: 1_048_576,
    dependencyFailure: 'cancel',
  };
  const file = [
    path.join(projectPath, '.agents', 'config.toml'),
    path.join(projectPath, '.codex', 'config.toml'),
  ].find((candidate) => fs.existsSync(candidate));
  if (!file) return defaults;
  const parsed = TOML.parse(fs.readFileSync(file, 'utf8')) as {
    swarm?: { automation?: Record<string, unknown> };
  };
  const automation = parsed.swarm?.automation;
  if (!automation) return defaults;
  const integer = (name: string, fallback: number): number => {
    const value = automation[name];
    return Number.isInteger(value) && Number(value) > 0 ? Number(value) : fallback;
  };
  return {
    enabled: automation.enabled === true,
    maxConcurrent: integer('max_concurrent', defaults.maxConcurrent),
    maxWriters: integer('max_writers', defaults.maxWriters),
    worktreeIsolation: automation.worktree_isolation !== false,
    agentTimeoutSeconds: integer('agent_timeout_seconds', defaults.agentTimeoutSeconds),
    maxOutputBytes: integer('max_output_bytes', defaults.maxOutputBytes),
    dependencyFailure: automation.dependency_failure === 'skip' ? 'skip' : 'cancel',
  };
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
      readOnly: true,
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
      readOnly: true,
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
      readOnly: true,
      prompt: `Scan ${target} for security vulnerabilities. Check OWASP Top 10.`,
      maxTurns: 10,
    },
    {
      id: 'analyzer',
      platform: 'claude',
      role: 'security-analyst',
      readOnly: true,
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
      readOnly: true,
      prompt: `Analyze ${target} for refactoring opportunities. Identify code smells.`,
      maxTurns: 8,
    },
    {
      id: 'planner',
      platform: 'claude',
      role: 'refactor-planner',
      readOnly: true,
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
      readOnly: true,
      prompt: `Run tests and validate the refactoring didn't break anything.`,
      dependsOn: ['refactorer'],
      maxTurns: 5,
    },
  ],
};
