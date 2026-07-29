/**
 * Dual-Mode CLI Commands
 * CLI interface for running collaborative dual-mode swarms
 */

import { Command } from 'commander';
import chalk from 'chalk';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  DualModeOrchestrator,
  DualModeConfig,
  WorkerConfig,
  CollaborationTemplates,
  CollaborationResult,
  loadSwarmAutomationConfig,
} from './orchestrator.js';
import { CodexWorktreeCoordinator } from '../worktrees/coordinator.js';

/**
 * Create the dual-mode command
 */
export function createDualModeCommand(): Command {
  const cmd = new Command('dual')
    .description('Run collaborative dual-mode swarms (Claude Code + Codex)')
    .addCommand(createRunCommand())
    .addCommand(createTemplateCommand())
    .addCommand(createStatusCommand());

  return cmd;
}

/**
 * Run a dual-mode collaboration
 */
function createRunCommand(): Command {
  return new Command('run')
    .description('Run a collaborative dual-mode swarm')
    .argument('[template]', 'Pre-built template name (feature, security, refactor) — positional alias for --template')
    .option('-t, --template <name>', 'Use a pre-built template (feature, security, refactor)')
    .option(
      '-w, --worker <spec>',
      'Worker spec "<platform>:<role>:<prompt>" (platform = claude|codex). Repeatable. Workers chain sequentially unless --parallel-workers.',
      (val: string, acc: string[]) => { acc.push(val); return acc; },
      [] as string[],
    )
    .option('--parallel-workers', 'Run --worker specs in parallel instead of chaining them sequentially', false)
    .option('-c, --config <path>', 'Path to collaboration config JSON')
    .option('--task <description>', 'Task description for the swarm')
    .option('--max-concurrent <n>', 'Maximum concurrent workers (bounded by .agents/config.toml)')
    .option('--timeout <ms>', 'Worker timeout in milliseconds (bounded by .agents/config.toml)')
    .option('--namespace <name>', 'Shared memory namespace', 'collaboration')
    .action(async (templateArg: string | undefined, options) => {
      console.log(chalk.cyan('═══════════════════════════════════════════════════════════════'));
      console.log(chalk.cyan.bold('  DUAL-MODE COLLABORATIVE EXECUTION'));
      console.log(chalk.cyan('  Claude Code + Codex workers with shared memory'));
      console.log(chalk.cyan('═══════════════════════════════════════════════════════════════'));
      console.log();

      const automation = loadSwarmAutomationConfig(process.cwd());
      if (!automation.enabled) {
        throw new Error('unattended swarm automation is disabled; set [swarm.automation] enabled = true');
      }
      const requestedConcurrency = options.maxConcurrent
        ? parseInt(options.maxConcurrent, 10)
        : automation.maxConcurrent;
      const requestedTimeout = options.timeout
        ? parseInt(options.timeout, 10)
        : automation.agentTimeoutSeconds * 1000;
      const config: DualModeConfig = {
        projectPath: process.cwd(),
        maxConcurrent: Math.min(requestedConcurrency, automation.maxConcurrent),
        maxWriters: automation.maxWriters,
        worktreeIsolation: automation.worktreeIsolation,
        dependencyFailure: automation.dependencyFailure,
        timeout: Math.min(requestedTimeout, automation.agentTimeoutSeconds * 1000),
        maxOutputBytes: automation.maxOutputBytes,
        policyPreflight: true,
        sharedNamespace: options.namespace,
      };

      const orchestrator = new DualModeOrchestrator(config);

      // Set up event listeners
      orchestrator.on('memory:initialized', ({ namespace }) => {
        console.log(chalk.green(`✓ Shared memory initialized: ${namespace}`));
      });

      orchestrator.on('worker:started', ({ id, role, platform }) => {
        const icon = platform === 'claude' ? '🔵' : '🟢';
        console.log(chalk.blue(`${icon} [${platform}] ${role} (${id}) started`));
      });

      orchestrator.on('worker:completed', ({ id }) => {
        console.log(chalk.green(`✓ Worker ${id} completed`));
      });

      orchestrator.on('worker:failed', ({ id, error }) => {
        console.log(chalk.red(`✗ Worker ${id} failed: ${error}`));
      });

      let workers: WorkerConfig[];
      let taskContext: string;

      const workerSpecs: string[] = (options.worker as string[] | undefined) ?? [];
      const templateName: string | undefined = options.template ?? templateArg;

      if (workerSpecs.length > 0) {
        workers = parseWorkerSpecs(workerSpecs, options.parallelWorkers === true);
        taskContext = options.task || `Custom dual-mode swarm: ${workers.map(w => `${w.platform}:${w.role}`).join(' -> ')}`;
      } else if (templateName) {
        const task = options.task || 'Complete the assigned task';
        workers = getTemplateWorkers(templateName, task);
        taskContext = `Template: ${templateName}, Task: ${task}`;
      } else if (options.config) {
        const configData = await loadWorkerConfig(options.config, process.cwd());
        workers = configData.workers;
        taskContext = configData.taskContext || options.task || 'Collaborative task';
      } else {
        console.log(chalk.yellow('Please specify --template <name>, a [template] argument, --worker <spec> (repeatable), or --config <path>'));
        console.log();
        console.log('Templates:');
        console.log('  feature  - Feature development (architect -> coder -> tester -> reviewer)');
        console.log('  security - Security audit (scanner -> analyzer -> fixer)');
        console.log('  refactor - Code refactoring (analyzer -> planner -> refactorer -> validator)');
        console.log();
        console.log('Custom workers:');
        console.log('  --worker "claude:architect:Design the API" --worker "codex:coder:Implement it"');
        return;
      }

      if (automation.worktreeIsolation) {
        const runId = `dual-${Date.now().toString(36)}`;
        const coordinator = new CodexWorktreeCoordinator(process.cwd());
        const record = coordinator.prepare(
          runId,
          workers.map((worker) => ({
            id: worker.id,
            ...(worker.readOnly === undefined ? {} : { readOnly: worker.readOnly }),
          })),
        );
        const assignments = new Map(record.assignments.map((item) => [item.agentId, item.path]));
        workers = workers.map((worker) => {
          const worktreePath = assignments.get(worker.id);
          return { ...worker, ...(worktreePath ? { worktreePath } : {}) };
        });
        console.log(chalk.gray(`  Worktree run: ${runId} (retained for explicit integrate/cleanup)`));
      }

      console.log();
      console.log(chalk.bold('Swarm Configuration:'));
      console.log(`  Workers: ${workers.length}`);
      console.log(`  Max Concurrent: ${config.maxConcurrent}`);
      console.log(`  Timeout: ${config.timeout}ms`);
      console.log(`  Namespace: ${config.sharedNamespace}`);
      console.log();

      console.log(chalk.bold('Worker Pipeline:'));
      for (const w of workers) {
        const deps = w.dependsOn?.length ? ` (after: ${w.dependsOn.join(', ')})` : '';
        const icon = w.platform === 'claude' ? '🔵' : '🟢';
        console.log(`  ${icon} ${w.id}: ${w.role}${deps}`);
      }
      console.log();

      console.log(chalk.bold('Starting collaboration...'));
      console.log();

      const startTime = Date.now();
      const result = await orchestrator.runCollaboration(workers, taskContext);

      console.log();
      console.log(chalk.cyan('═══════════════════════════════════════════════════════════════'));
      console.log(chalk.cyan.bold('  COLLABORATION COMPLETE'));
      console.log(chalk.cyan('═══════════════════════════════════════════════════════════════'));
      console.log();

      printResults(result);
    });
}

export async function loadWorkerConfig(
  configPath: string,
  cwd = process.cwd(),
): Promise<{ workers: WorkerConfig[]; taskContext?: string }> {
  const absolute = path.resolve(cwd, configPath);
  const loaded = path.extname(absolute).toLowerCase() === '.json'
    ? JSON.parse(await readFile(absolute, 'utf8'))
    : await import(pathToFileURL(absolute).href);
  const config = loaded.default && typeof loaded.default === 'object'
    ? loaded.default
    : loaded;
  if (!Array.isArray(config.workers)) {
    throw new Error(`Dual-mode config must export a workers array: ${absolute}`);
  }
  return {
    workers: config.workers,
    ...(typeof config.taskContext === 'string' ? { taskContext: config.taskContext } : {}),
  };
}

/**
 * List available templates
 */
function createTemplateCommand(): Command {
  return new Command('templates')
    .description('List available collaboration templates')
    .action(() => {
      console.log(chalk.bold('\nAvailable Collaboration Templates:\n'));

      console.log(chalk.cyan('feature') + ' - Feature Development Swarm');
      console.log('  Pipeline: architect → coder → tester → reviewer');
      console.log('  Platforms: Claude (architect, reviewer) + Codex (coder, tester)');
      console.log('  Usage: npx claude-flow-codex dual run --template feature --task "Add user auth"');
      console.log();

      console.log(chalk.cyan('security') + ' - Security Audit Swarm');
      console.log('  Pipeline: scanner → analyzer → fixer');
      console.log('  Platforms: Codex (scanner, fixer) + Claude (analyzer)');
      console.log('  Usage: npx claude-flow-codex dual run --template security --task "src/auth/"');
      console.log();

      console.log(chalk.cyan('refactor') + ' - Refactoring Swarm');
      console.log('  Pipeline: analyzer → planner → refactorer → validator');
      console.log('  Platforms: Claude (analyzer, planner) + Codex (refactorer, validator)');
      console.log('  Usage: npx claude-flow-codex dual run --template refactor --task "src/legacy/"');
      console.log();

      console.log(chalk.gray('Custom configurations can be provided via --config <path.json>'));
    });
}

/**
 * Check status of running collaboration
 */
function createStatusCommand(): Command {
  return new Command('status')
    .description('Check status of dual-mode collaboration')
    .option('--namespace <name>', 'Memory namespace to check', 'collaboration')
    .action(async (options) => {
      console.log(chalk.bold('\nDual-Mode Collaboration Status\n'));

      // Check shared memory
      const { spawn } = await import('child_process');

      const proc = spawn('npx', [
        'ruflo@latest', 'memory', 'list',
        '--namespace', options.namespace
      ], { stdio: 'inherit' });

      proc.on('close', () => {
        console.log();
      });
    });
}

/**
 * Parse `--worker "<platform>:<role>:<prompt>"` specs into WorkerConfig[].
 * Splits on the first two `:` so the prompt may itself contain colons.
 * Workers chain sequentially (each depends on the previous) unless `parallel`.
 */
export function parseWorkerSpecs(specs: string[], parallel: boolean): WorkerConfig[] {
  const usedIds = new Set<string>();
  const workers: WorkerConfig[] = [];

  specs.forEach((spec, index) => {
    const firstColon = spec.indexOf(':');
    const secondColon = firstColon >= 0 ? spec.indexOf(':', firstColon + 1) : -1;
    if (firstColon < 0 || secondColon < 0) {
      throw new Error(`Invalid --worker spec "${spec}". Expected "<platform>:<role>:<prompt>" (platform = claude|codex).`);
    }
    const platformRaw = spec.slice(0, firstColon).trim().toLowerCase();
    const role = spec.slice(firstColon + 1, secondColon).trim() || `worker-${index + 1}`;
    const prompt = spec.slice(secondColon + 1).trim();
    if (!prompt) {
      throw new Error(`Invalid --worker spec "${spec}". Missing prompt after "<platform>:<role>:".`);
    }
    if (platformRaw !== 'claude' && platformRaw !== 'codex') {
      throw new Error(`Invalid platform "${platformRaw}" in --worker spec "${spec}". Use "claude" or "codex".`);
    }
    const platform: 'claude' | 'codex' = platformRaw;

    // Derive a unique id from the role.
    const base = role.replace(/\s+/g, '-');
    let id = base;
    let suffix = 2;
    while (usedIds.has(id)) { id = `${base}-${suffix++}`; }
    usedIds.add(id);

    const worker: WorkerConfig = { id, platform, role, prompt };
    const prev = workers[workers.length - 1];
    if (!parallel && prev) {
      worker.dependsOn = [prev.id];
    }
    workers.push(worker);
  });

  return workers;
}

/**
 * Get workers for a template
 */
function getTemplateWorkers(template: string, task: string): WorkerConfig[] {
  switch (template) {
    case 'feature':
      return CollaborationTemplates.featureDevelopment(task);
    case 'security':
      return CollaborationTemplates.securityAudit(task);
    case 'refactor':
      return CollaborationTemplates.refactoring(task);
    default:
      throw new Error(`Unknown template: ${template}`);
  }
}

/**
 * Print collaboration results
 */
function printResults(result: CollaborationResult): void {
  console.log(chalk.bold('Results:'));
  console.log(`  Status: ${result.success ? chalk.green('SUCCESS') : chalk.red('FAILED')}`);
  console.log(`  Duration: ${(result.totalDuration / 1000).toFixed(2)}s`);
  console.log();

  console.log(chalk.bold('Worker Summary:'));
  for (const worker of result.workers) {
    const status = worker.status === 'completed' ? chalk.green('✓') :
                   worker.status === 'failed' ? chalk.red('✗') :
                   chalk.yellow('○');
    const duration = worker.startedAt && worker.completedAt
      ? `${((worker.completedAt.getTime() - worker.startedAt.getTime()) / 1000).toFixed(1)}s`
      : '-';
    const icon = worker.platform === 'claude' ? '🔵' : '🟢';

    console.log(`  ${status} ${icon} ${worker.id} (${worker.role}): ${duration}`);
  }

  if (result.errors.length > 0) {
    console.log();
    console.log(chalk.red.bold('Errors:'));
    for (const error of result.errors) {
      console.log(chalk.red(`  • ${error}`));
    }
  }

  console.log();
  console.log(chalk.gray('View shared memory: npx ruflo@latest memory list --namespace collaboration'));
}
