/**
 * V3 CLI Autopilot Command
 * Persistent swarm completion — keeps agents working until ALL tasks are done.
 *
 * ADR-072: Autopilot Integration
 */

import type { Command, CommandContext, CommandResult } from '../types.js';
import { output } from '../output.js';
import {
  loadState, saveState, appendLog, loadLog, discoverTasks,
  getProgress, calculateReward, tryLoadLearning, validateNumber,
  validateTaskSources, LOG_FILE,
} from '../autopilot-state.js';
import { getCheckpointGate, CheckpointGate } from '../services/checkpoint-gate.js';

/**
 * Opt-in checkpoint/rollback gate for the autopilot tick (agenticow step 3).
 *
 * The autopilot loop's memory mutation happens OUT OF PROCESS — a re-engaged
 * tick returns a continuation prompt, and the spawned agent (plus agentic-flow
 * learning) mutates `.rvf` memory. So there is no in-process fn to wrap with
 * CheckpointGate.guard() here; instead we bracket the loop across ticks:
 *   - checkpoint the configured `.rvf` right before handing off a risky tick
 *     (re-engage), and
 *   - roll it back when the loop's own regression signal fires (stall auto-disable).
 *
 * Entirely opt-in: it does nothing unless CLAUDE_FLOW_AUTOPILOT_CHECKPOINT_MEM
 * points at an `.rvf` file the loop mutates, agenticow is installed, and the
 * CLAUDE_FLOW_AGENTICOW_DISABLE kill switch is unset. Every call is non-fatal —
 * a checkpoint/rollback failure never breaks the loop.
 */
async function checkpointTick(label: string): Promise<void> {
  const memPath = CheckpointGate.configuredMemPath();
  if (!memPath) return;
  try {
    const r = await getCheckpointGate().checkpoint(memPath, label);
    if (r.ok) appendLog({ ts: Date.now(), event: 'checkpoint', label, memPath });
  } catch { /* non-fatal: memory branching is best-effort */ }
}

async function rollbackTick(reason: string): Promise<void> {
  const memPath = CheckpointGate.configuredMemPath();
  if (!memPath) return;
  try {
    const r = await getCheckpointGate().rollback(memPath);
    if (r.ok) appendLog({ ts: Date.now(), event: 'rollback', reason, memPath });
  } catch { /* non-fatal */ }
}

// ── Check Handler (for Stop hook) ─────────────────────────────

export async function autopilotCheck(): Promise<{ allowStop: boolean; reason: string; continueWith?: string }> {
  const state = loadState();

  if (!state.enabled) {
    return { allowStop: true, reason: 'Autopilot disabled' };
  }

  // Safety: max iterations
  if (state.iterations >= state.maxIterations) {
    state.enabled = false;
    saveState(state);
    appendLog({ ts: Date.now(), event: 'max-iterations-reached', iterations: state.iterations });
    return { allowStop: true, reason: `Max iterations (${state.maxIterations}) reached` };
  }

  // Safety: timeout
  const elapsed = Date.now() - state.startTime;
  if (elapsed > state.timeoutMinutes * 60000) {
    state.enabled = false;
    saveState(state);
    appendLog({ ts: Date.now(), event: 'timeout-reached', elapsed: Math.round(elapsed / 60000) });
    return { allowStop: true, reason: `Timeout (${state.timeoutMinutes} min) reached` };
  }

  // Discover tasks
  const tasks = discoverTasks(state.taskSources);
  if (tasks.length === 0) {
    return { allowStop: true, reason: 'No tasks discovered from any source' };
  }

  const progress = getProgress(tasks);

  if (progress.incomplete.length === 0) {
    const reward = calculateReward(state.iterations, elapsed);
    state.enabled = false;
    saveState(state);
    appendLog({ ts: Date.now(), event: 'all-tasks-complete', total: progress.total, iterations: state.iterations, durationMs: elapsed, reward });
    return { allowStop: true, reason: `All ${progress.total} tasks complete (${state.iterations} iterations, reward: ${reward})` };
  }

  // Stall detection
  const recentHistory = state.history.slice(-5);
  const isStalled = recentHistory.length >= 5 && recentHistory.every(h => h.completed === progress.completed);

  if (isStalled && state.history.length >= 10) {
    state.enabled = false;
    saveState(state);
    appendLog({ ts: Date.now(), event: 'stall-auto-disable', iterations: state.iterations, completed: progress.completed });
    // Regression signal: the loop stalled. Roll `.rvf` memory back to the last
    // good per-tick checkpoint (opt-in via CLAUDE_FLOW_AUTOPILOT_CHECKPOINT_MEM).
    await rollbackTick('stall-auto-disable');
    return { allowStop: true, reason: `Stalled: no progress in 10 iterations (${progress.completed}/${progress.total} complete)` };
  }

  // Re-engage
  state.iterations++;
  state.lastCheck = Date.now();
  state.history.push({ ts: Date.now(), iteration: state.iterations, completed: progress.completed, total: progress.total });
  saveState(state);

  // Checkpoint `.rvf` memory before the risky tick runs (opt-in). The next
  // check() rolls back to here if this tick regresses (stall detection above).
  await checkpointTick(`autopilot-iter-${state.iterations}`);

  const stallWarning = isStalled
    ? '\nWARNING: No progress in 5 iterations. Consider breaking tasks into smaller subtasks or trying a different approach.'
    : '';

  const taskList = progress.incomplete.slice(0, 5).map(t => `- ${t.subject} (${t.status})`).join('\n');
  const moreCount = progress.incomplete.length > 5 ? `\n... and ${progress.incomplete.length - 5} more` : '';

  const continuePrompt = [
    `AUTOPILOT: ${progress.completed}/${progress.total} tasks complete (${progress.percent}%).`,
    `Iteration ${state.iterations}/${state.maxIterations}.`,
    `Remaining tasks:\n${taskList}${moreCount}`,
    stallWarning,
    `Continue working on the remaining tasks. Do not stop until all are complete.`,
  ].join('\n');

  appendLog({ ts: Date.now(), event: 're-engaging', iteration: state.iterations, completed: progress.completed, remaining: progress.incomplete.length });

  return { allowStop: false, reason: `${progress.incomplete.length}/${progress.total} tasks remaining (iteration ${state.iterations}/${state.maxIterations})`, continueWith: continuePrompt };
}

// ── Subcommands ───────────────────────────────────────────────

const statusCommand: Command = {
  name: 'status',
  description: 'Show autopilot state, iterations, and task progress',
  options: [{ name: 'json', type: 'boolean', description: 'Output as JSON' }],
  action: async (ctx: CommandContext): Promise<CommandResult> => {
    const state = loadState();
    const tasks = discoverTasks(state.taskSources);
    const progress = getProgress(tasks);
    const elapsed = state.enabled ? Date.now() - state.startTime : 0;

    if (ctx.flags?.json) {
      output.printJson({
        enabled: state.enabled, sessionId: state.sessionId, iterations: state.iterations,
        maxIterations: state.maxIterations, timeoutMinutes: state.timeoutMinutes, elapsedMs: elapsed,
        tasks: { completed: progress.completed, total: progress.total, percent: progress.percent },
        taskSources: state.taskSources,
      });
      return { success: true };
    }

    output.writeln(`Autopilot: ${state.enabled ? '✓ ENABLED' : '✗ DISABLED'}`);
    output.writeln(`Session: ${state.sessionId.slice(0, 8)}...`);
    output.writeln(`Iterations: ${state.iterations}/${state.maxIterations}`);
    output.writeln(`Timeout: ${state.timeoutMinutes} min`);
    output.writeln(`Elapsed: ${Math.round(elapsed / 60000)} min`);
    output.writeln(`Tasks: ${progress.completed}/${progress.total} (${progress.percent}%)`);
    output.writeln(`Sources: ${state.taskSources.join(', ')}`);

    if (progress.incomplete.length > 0 && progress.incomplete.length <= 10) {
      output.writeln('\nRemaining tasks:');
      for (const t of progress.incomplete) {
        output.writeln(`  - [${t.source}] ${t.subject} (${t.status})`);
      }
    }
    return { success: true };
  },
};

const enableCommand: Command = {
  name: 'enable',
  description: 'Enable persistent completion',
  action: async (): Promise<CommandResult> => {
    const state = loadState();
    state.enabled = true;
    state.startTime = Date.now();
    state.iterations = 0;
    saveState(state);
    appendLog({ ts: Date.now(), event: 'enabled', sessionId: state.sessionId, maxIterations: state.maxIterations });
    output.writeln(output.success(`Autopilot enabled (max ${state.maxIterations} iterations, ${state.timeoutMinutes} min timeout)`));
    return { success: true };
  },
};

const disableCommand: Command = {
  name: 'disable',
  description: 'Disable re-engagement loop',
  action: async (): Promise<CommandResult> => {
    const state = loadState();
    const wasEnabled = state.enabled;
    state.enabled = false;
    saveState(state);
    if (wasEnabled) appendLog({ ts: Date.now(), event: 'disabled', iterations: state.iterations });
    output.writeln('Autopilot disabled');
    return { success: true };
  },
};

const configCommand: Command = {
  name: 'config',
  description: 'Configure max iterations, timeout, and task sources',
  options: [
    { name: 'max-iterations', type: 'string', description: 'Max re-engagement iterations (1-1000)' },
    { name: 'timeout', type: 'string', description: 'Timeout in minutes (1-1440)' },
    { name: 'task-sources', type: 'string', description: 'Comma-separated task sources' },
  ],
  action: async (ctx: CommandContext): Promise<CommandResult> => {
    const state = loadState();
    const maxIter = ctx.flags?.['max-iterations'] as string | undefined;
    const timeout = ctx.flags?.timeout as string | undefined;
    const sources = ctx.flags?.['task-sources'] as string | undefined;

    if (maxIter) state.maxIterations = validateNumber(maxIter, 1, 1000, state.maxIterations);
    if (timeout) state.timeoutMinutes = validateNumber(timeout, 1, 1440, state.timeoutMinutes);
    if (sources) state.taskSources = validateTaskSources(sources.split(',').map(s => s.trim()).filter(Boolean));

    saveState(state);
    appendLog({ ts: Date.now(), event: 'config-updated', maxIterations: state.maxIterations, timeoutMinutes: state.timeoutMinutes, taskSources: state.taskSources });
    output.writeln(`Config updated: maxIterations=${state.maxIterations}, timeout=${state.timeoutMinutes}min, sources=${state.taskSources.join(',')}`);
    return { success: true };
  },
};

const resetCommand: Command = {
  name: 'reset',
  description: 'Reset iteration counter and timer',
  action: async (): Promise<CommandResult> => {
    const state = loadState();
    state.iterations = 0;
    state.startTime = Date.now();
    state.history = [];
    state.lastCheck = null;
    saveState(state);
    appendLog({ ts: Date.now(), event: 'reset' });
    output.writeln('Autopilot state reset (iterations=0, timer restarted)');
    return { success: true };
  },
};

const logCommand: Command = {
  name: 'log',
  description: 'View autopilot event log',
  options: [
    { name: 'last', type: 'string', description: 'Show last N entries' },
    { name: 'json', type: 'boolean', description: 'Output as JSON' },
    { name: 'clear', type: 'boolean', description: 'Clear the log' },
  ],
  action: async (ctx: CommandContext): Promise<CommandResult> => {
    if (ctx.flags?.clear) {
      const { writeFileSync } = await import('node:fs');
      const { resolve } = await import('node:path');
      try { writeFileSync(resolve(LOG_FILE), '[]'); } catch { /* ignore */ }
      output.writeln('Autopilot log cleared');
      return { success: true };
    }

    const log = loadLog();
    const lastRaw = ctx.flags?.last as string | undefined;
    const last = lastRaw ? validateNumber(lastRaw, 1, 10000, 50) : undefined;
    const entries = last ? log.slice(-last) : log;

    if (ctx.flags?.json) {
      output.printJson(entries);
      return { success: true };
    }

    if (entries.length === 0) {
      output.writeln('No autopilot events logged');
      return { success: true };
    }

    for (const e of entries) {
      const time = new Date(e.ts).toISOString().slice(11, 19);
      const details = Object.entries(e).filter(([k]) => k !== 'ts' && k !== 'event').map(([k, v]) => `${k}=${v}`).join(' ');
      output.writeln(`[${time}] ${e.event} ${details}`);
    }
    return { success: true };
  },
};

const learnCommand: Command = {
  name: 'learn',
  description: 'Discover success patterns from past completions',
  options: [{ name: 'json', type: 'boolean', description: 'Output as JSON' }],
  action: async (ctx: CommandContext): Promise<CommandResult> => {
    const learning = await tryLoadLearning();
    if (!learning) {
      output.writeln('Learning not available (AgentDB not initialized). Autopilot still works for task completion tracking.');
      return { success: true };
    }

    const metrics = await (learning as unknown as { getMetrics: () => Promise<{ episodes: number; patterns: number; trajectories: number }> }).getMetrics();
    const patterns = await (learning as unknown as { discoverSuccessPatterns: () => Promise<Array<{ pattern: string; frequency: number; avgReward: number }>> }).discoverSuccessPatterns();

    if (ctx.flags?.json) {
      output.printJson({ metrics, patterns });
      return { success: true };
    }

    output.writeln(`Episodes: ${metrics.episodes}`);
    output.writeln(`Patterns: ${metrics.patterns}`);
    output.writeln(`Trajectories: ${metrics.trajectories}`);

    if (patterns.length > 0) {
      output.writeln('\nDiscovered patterns:');
      for (const p of patterns) {
        output.writeln(`  - ${p.pattern} (freq: ${p.frequency}, reward: ${p.avgReward.toFixed(2)})`);
      }
    }
    return { success: true };
  },
};

const historyCommand: Command = {
  name: 'history',
  description: 'Search past completion episodes',
  options: [
    { name: 'query', type: 'string', description: 'Search query', required: true },
    { name: 'limit', type: 'string', description: 'Max results (default 10)' },
    { name: 'json', type: 'boolean', description: 'Output as JSON' },
  ],
  action: async (ctx: CommandContext): Promise<CommandResult> => {
    const query = (ctx.flags?.query || '') as string;
    const limit = validateNumber(ctx.flags?.limit, 1, 100, 10);

    if (!query) {
      output.writeln('Usage: autopilot history --query "search terms" [--limit N]');
      return { success: false, message: 'Missing --query' };
    }

    const learning = await tryLoadLearning();
    if (!learning) {
      output.writeln('Learning not available. No history to search.');
      return { success: true };
    }

    const results = await (learning as unknown as { recallSimilarTasks: (query: string, limit: number) => Promise<unknown[]> }).recallSimilarTasks(query, limit);
    if (ctx.flags?.json) {
      output.printJson(results);
    } else if (results.length === 0) {
      output.writeln(`No matching episodes for: "${query}"`);
    } else {
      output.printJson(results);
    }
    return { success: true };
  },
};

const predictCommand: Command = {
  name: 'predict',
  description: 'Predict optimal next action',
  options: [{ name: 'json', type: 'boolean', description: 'Output as JSON' }],
  action: async (ctx: CommandContext): Promise<CommandResult> => {
    const state = loadState();
    const learning = await tryLoadLearning();

    if (learning) {
      const prediction = await (learning as unknown as { predictNextAction: (state: unknown) => Promise<{ action?: string; confidence?: number; alternatives?: string[] } | null> }).predictNextAction(state);
      if (ctx.flags?.json) {
        output.printJson(prediction);
      } else {
        output.writeln(`Action: ${prediction?.action || 'unknown'}`);
        output.writeln(`Confidence: ${prediction?.confidence || 0}`);
        if (prediction?.alternatives && prediction.alternatives.length > 0) output.writeln(`Alternatives: ${prediction.alternatives.join(', ')}`);
      }
      return { success: true };
    }

    // Heuristic fallback
    const tasks = discoverTasks(state.taskSources);
    const progress = getProgress(tasks);

    if (progress.incomplete.length === 0) {
      output.writeln('All tasks complete. No action needed.');
      return { success: true };
    }

    const next = progress.incomplete[0];
    const result = { action: `Work on: ${next.subject}`, confidence: 0.5, remaining: progress.incomplete.length };
    if (ctx.flags?.json) {
      output.printJson(result);
    } else {
      output.writeln(`Action: ${result.action}`);
      output.writeln(`Confidence: ${result.confidence} (heuristic — learning not available)`);
      output.writeln(`Remaining: ${result.remaining} tasks`);
    }
    return { success: true };
  },
};

const checkCommand: Command = {
  name: 'check',
  description: 'Run completion check (used by stop hook)',
  options: [{ name: 'json', type: 'boolean', description: 'Output as JSON' }],
  action: async (ctx: CommandContext): Promise<CommandResult> => {
    const result = await autopilotCheck();
    if (ctx.flags?.json) {
      output.printJson(result);
    } else {
      output.writeln(`${result.allowStop ? 'ALLOW STOP' : 'CONTINUE'}: ${result.reason}`);
    }
    return { success: true };
  },
};

// ── Main Command ──────────────────────────────────────────────

export const autopilotCommand: Command = {
  name: 'autopilot',
  description: 'Persistent swarm completion — keeps agents working until ALL tasks are done',
  aliases: ['ap'],
  subcommands: [statusCommand, enableCommand, disableCommand, configCommand, resetCommand, logCommand, learnCommand, historyCommand, predictCommand, checkCommand],
  examples: [
    { command: 'claude-flow autopilot status', description: 'Show current state and progress' },
    { command: 'claude-flow autopilot enable', description: 'Enable persistent completion' },
    { command: 'claude-flow autopilot config --max-iterations 100 --timeout 180', description: 'Configure limits' },
    { command: 'claude-flow autopilot predict', description: 'Get recommended next action' },
  ],
  action: async (): Promise<CommandResult> => {
    output.writeln(output.bold('Autopilot — Persistent Swarm Completion'));
    output.writeln(output.dim('Keeps agents working until ALL tasks are done'));
    output.writeln();
    output.printList([
      'status    — Show state, iterations, and task progress',
      'enable    — Enable persistent completion',
      'disable   — Disable re-engagement loop',
      'config    — Configure max iterations, timeout, sources',
      'reset     — Reset iteration counter and timer',
      'log       — View autopilot event log',
      'learn     — Discover success patterns',
      'history   — Search past completion episodes',
      'predict   — Predict optimal next action',
      'check     — Run completion check (stop hook)',
    ]);
    return { success: true };
  },
};

export default autopilotCommand;
