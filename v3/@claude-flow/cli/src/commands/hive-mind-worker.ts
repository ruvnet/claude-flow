/**
 * Hive-mind worker execution: the MCP config handed to a spawned Claude, and
 * `hive-mind work`, which actually runs a queued task.
 *
 * Before this, `hive-mind task` only wrote a `pending` row to the task store.
 * Workers are records, not processes, and nothing ever claimed the row: the
 * task stayed pending and the worker stayed idle forever. `work` is the missing
 * consumer — claim one task, assign it to an idle hive worker, run it through
 * `claude -p`, and record the outcome.
 */

import type { Command, CommandContext, CommandResult } from '../types.js';
import { output } from '../output.js';
import { callMCPTool, MCPClientError } from '../mcp-client.js';
import { spawn as childSpawn } from 'child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { resolveClaudeLaunchCommand } from '../runtime/claude-command.js';

type ServerMap = Record<string, unknown>;

/** The server key the hive-mind prompt addresses (`mcp__ruflo__*`). */
const RUFLO_SERVER = 'ruflo';

function readServers(path: string, cwd: string): ServerMap | null {
  try {
    if (!existsSync(path)) return null;
    const parsed = JSON.parse(readFileSync(path, 'utf-8')) as Record<string, unknown>;
    const isMap = (v: unknown): v is ServerMap =>
      !!v && typeof v === 'object' && !Array.isArray(v) && Object.keys(v).length > 0;
    if (isMap(parsed.mcpServers)) return parsed.mcpServers;
    // ~/.claude.json keeps project-scoped servers under projects[<cwd>].
    const project = (parsed.projects as Record<string, { mcpServers?: unknown }> | undefined)?.[cwd];
    if (isMap(project?.mcpServers)) return project.mcpServers;
  } catch {
    // Unreadable or not JSON: not a usable config.
  }
  return null;
}

export interface WorkerMcpConfigOptions {
  /** `--mcp-config` from the caller; used verbatim when given. */
  explicit?: string;
  cwd: string;
  home: string;
  /** Where the generated config is written (e.g. `.hive-mind/sessions`). */
  outDir: string;
  swarmId: string;
  /** The ruflo MCP server to register when no source config provides one. */
  rufloServer: { command: string; args: string[] };
}

/**
 * The MCP config file to pass to a spawned Claude.
 *
 * A source file is never passed through as-is. `~/.claude.json` is Claude
 * Code's whole state file; on a machine where it has no top-level
 * `mcpServers` (a fresh desktop), Claude exits at startup with "Invalid MCP
 * configuration: mcpServers: Invalid input", before any task can run. And a
 * config lacking a `ruflo` server leaves the worker without the tools its
 * prompt names. So the servers are extracted, a `ruflo` server is guaranteed,
 * and the result is written as a config Claude is known to accept.
 */
export function resolveWorkerMcpConfig(opts: WorkerMcpConfigOptions): string {
  if (opts.explicit) return opts.explicit;
  const candidates = [join(opts.cwd, '.mcp.json')];
  if (opts.home) candidates.push(join(opts.home, '.claude.json'), join(opts.home, '.claude', 'mcp.json'));
  let servers: ServerMap = {};
  for (const c of candidates) {
    const found = readServers(c, opts.cwd);
    if (found) {
      servers = found;
      break;
    }
  }
  if (!servers[RUFLO_SERVER]) {
    servers = {
      ...servers,
      [RUFLO_SERVER]: {
        command: opts.rufloServer.command,
        args: opts.rufloServer.args,
        // The MCP server keys its stores off this, so the worker's tool calls
        // land in the same task/agent stores as the CLI that dispatched it.
        env: { CLAUDE_FLOW_CWD: opts.cwd },
      },
    };
  }
  mkdirSync(opts.outDir, { recursive: true });
  const path = join(opts.outDir, `mcp-${opts.swarmId}.json`);
  writeFileSync(path, JSON.stringify({ mcpServers: servers }, null, 2), 'utf-8');
  return path;
}

/**
 * The ruflo MCP server as launched by THIS cli, so a worker and the CLI that
 * dispatched it share one version and one store format. `@latest` could
 * resolve to a different release mid-session.
 */
export function currentRufloServer(): { command: string; args: string[] } {
  const entry = process.argv[1];
  return entry
    ? { command: process.execPath, args: [entry, 'mcp', 'start'] }
    : { command: 'npx', args: ['-y', '@claude-flow/cli@latest', 'mcp', 'start'] };
}

export interface RunOutcome {
  ok: boolean;
  output: string;
  exitCode: number | null;
  sessionId?: string;
  costUsd?: number;
  durationMs: number;
}

export type TaskRunner = (prompt: string, opts: { mcpConfig: string; timeoutMs: number; cwd: string }) => Promise<RunOutcome>;

/** Run one prompt through `claude -p` and parse its JSON result. */
export const runWithClaude: TaskRunner = (prompt, opts) =>
  new Promise((resolve) => {
    const started = Date.now();
    const launch = resolveClaudeLaunchCommand();
    if (!launch) {
      resolve({ ok: false, output: 'Claude Code CLI not found in PATH', exitCode: null, durationMs: 0 });
      return;
    }
    // The prompt goes on stdin, not argv: a task description has no length
    // bound and `--mcp-config` is variadic (#1780).
    const child = childSpawn(
      launch.command,
      [...launch.argsPrefix, '-p', '--output-format', 'json', `--mcp-config=${opts.mcpConfig}`],
      { cwd: opts.cwd, stdio: ['pipe', 'pipe', 'pipe'] },
    );
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => (stdout += d));
    child.stderr.on('data', (d) => (stderr += d));
    const timer = setTimeout(() => child.kill('SIGTERM'), opts.timeoutMs);
    child.on('error', (e) => {
      clearTimeout(timer);
      resolve({ ok: false, output: e.message, exitCode: null, durationMs: Date.now() - started });
    });
    child.on('close', (code, signal) => {
      clearTimeout(timer);
      const durationMs = Date.now() - started;
      try {
        const r = JSON.parse(stdout) as { is_error?: boolean; result?: string; session_id?: string; total_cost_usd?: number };
        resolve({
          ok: code === 0 && !r.is_error,
          output: r.result ?? '',
          exitCode: code,
          sessionId: r.session_id,
          costUsd: r.total_cost_usd,
          durationMs,
        });
      } catch {
        const why = signal === 'SIGTERM' ? `timed out after ${opts.timeoutMs}ms` : (stderr || stdout).trim().slice(-2000);
        resolve({ ok: false, output: why, exitCode: code, durationMs });
      }
    });
    child.stdin.end(prompt);
  });

interface TaskView {
  taskId: string;
  description: string;
  status: string;
  tags?: string[];
  createdAt: string;
}

export interface WorkOnceOptions {
  cwd: string;
  mcpConfig: string;
  runner: TaskRunner;
  taskId?: string;
  workerId?: string;
  defaultTimeoutMs?: number;
}

export type WorkOnceResult =
  | { dispatched: false; reason: string }
  | { dispatched: true; taskId: string; workerId: string; status: 'completed' | 'failed'; outcome: RunOutcome };

function timeoutFromTags(tags: string[] | undefined, fallback: number): number {
  const tag = tags?.find((t) => /^timeout:\d+s$/.test(t));
  return tag ? Number(tag.slice('timeout:'.length, -1)) * 1000 : fallback;
}

/**
 * One dispatch cycle: the oldest pending hive task goes to an idle hive worker,
 * runs, and its outcome is recorded on the task. Every state change goes
 * through the MCP task tools, so the store is the same one `hive-mind status`
 * and `task status` read.
 */
export async function workOnce(opts: WorkOnceOptions): Promise<WorkOnceResult> {
  let taskId = opts.taskId;
  if (!taskId) {
    const listed = await callMCPTool<{ tasks: TaskView[] }>('task_list', { status: 'pending', type: 'hive-mind', limit: 1000 });
    const oldest = [...(listed.tasks ?? [])].sort((a, b) => a.createdAt.localeCompare(b.createdAt))[0];
    if (!oldest) return { dispatched: false, reason: 'No pending hive-mind tasks' };
    taskId = oldest.taskId;
  }
  const task = await callMCPTool<TaskView>('task_status', { taskId });
  if (task.status !== 'pending') {
    return { dispatched: false, reason: `Task ${taskId} is ${task.status}, not pending` };
  }

  let workerId = opts.workerId;
  if (!workerId) {
    const hive = await callMCPTool<{ workers?: Array<{ id: string; status: string }> }>('hive-mind_status', {});
    workerId = hive.workers?.find((w) => w.status === 'idle')?.id;
    if (!workerId) return { dispatched: false, reason: 'No idle hive worker — run "hive-mind spawn" first' };
  }

  await callMCPTool('task_assign', { taskId, agentIds: [workerId] });
  const prompt =
    `You are hive-mind worker ${workerId}. Complete this task, then reply with ` +
    `the result only.\n\nTask ${taskId}:\n${task.description}`;
  const outcome = await opts.runner(prompt, {
    mcpConfig: opts.mcpConfig,
    timeoutMs: timeoutFromTags(task.tags, opts.defaultTimeoutMs ?? 300_000),
    cwd: opts.cwd,
  });
  const result = {
    worker: workerId,
    output: outcome.output,
    exitCode: outcome.exitCode,
    durationMs: outcome.durationMs,
    ...(outcome.sessionId ? { sessionId: outcome.sessionId } : {}),
    ...(outcome.costUsd !== undefined ? { costUsd: outcome.costUsd } : {}),
  };
  if (outcome.ok) {
    await callMCPTool('task_complete', { taskId, result });
    return { dispatched: true, taskId, workerId, status: 'completed', outcome };
  }
  await callMCPTool('task_update', { taskId, status: 'failed', result });
  return { dispatched: true, taskId, workerId, status: 'failed', outcome };
}

export const workCommand: Command = {
  name: 'work',
  description: 'Run the next pending hive task on an idle worker via Claude Code and record the result',
  options: [
    { name: 'task', description: 'Run this task id instead of the oldest pending one', type: 'string' },
    { name: 'worker', description: 'Assign to this worker id instead of the first idle one', type: 'string' },
    { name: 'mcp-config', description: 'MCP config for the worker (default: generated, with the ruflo server)', type: 'string' },
  ],
  examples: [
    { command: 'claude-flow hive-mind work', description: 'Run the oldest pending hive task' },
    { command: 'claude-flow hive-mind work --task task-123', description: 'Run a specific task' },
  ],
  action: async (ctx: CommandContext): Promise<CommandResult> => {
    const cwd = ctx.cwd || process.cwd();
    try {
      const mcpConfig = resolveWorkerMcpConfig({
        explicit: ctx.flags.mcpConfig as string | undefined,
        cwd,
        home: process.env.HOME || process.env.USERPROFILE || '',
        outDir: join(cwd, '.hive-mind', 'sessions'),
        swarmId: 'worker',
        rufloServer: currentRufloServer(),
      });
      const r = await workOnce({
        cwd,
        mcpConfig,
        runner: runWithClaude,
        taskId: ctx.flags.task as string | undefined,
        workerId: ctx.flags.worker as string | undefined,
      });
      if (ctx.flags.format === 'json') {
        output.printJson(r);
      } else if (!r.dispatched) {
        output.printInfo(r.reason);
      } else {
        output.printBox(
          [
            `Task ID: ${r.taskId}`,
            `Worker: ${r.workerId}`,
            `Status: ${r.status}`,
            `Duration: ${r.outcome.durationMs}ms`,
            '',
            r.outcome.output.slice(0, 2000),
          ].join('\n'),
          r.status === 'completed' ? 'Task Completed' : 'Task Failed',
        );
        output.writeln(output.dim(`  Full record: claude-flow task status ${r.taskId}`));
      }
      // Nothing to do is not an error; a task that ran and failed is.
      const failed = r.dispatched && r.status === 'failed';
      return { success: !failed, exitCode: failed ? 1 : 0, data: r };
    } catch (error) {
      const msg = error instanceof MCPClientError ? error.message : String(error);
      output.printError(`Work error: ${msg}`);
      return { success: false, exitCode: 1 };
    }
  },
};
