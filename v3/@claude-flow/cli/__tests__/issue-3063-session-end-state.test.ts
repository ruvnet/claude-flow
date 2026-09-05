import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const bridgeSessionEnd = vi.fn();
const shutdownBridge = vi.fn();

vi.mock('../src/memory/memory-bridge.js', () => ({
  bridgeSessionEnd,
  shutdownBridge,
}));

import { hooksSessionEnd } from '../src/mcp-tools/hooks-tools.js';

describe('hooks session-end real session state (#3063)', () => {
  const now = new Date('2026-08-21T10:00:00.000Z');
  const startedAt = new Date('2026-08-21T09:50:00.000Z');
  const beforeSession = new Date('2026-08-21T09:40:00.000Z');
  let workdir: string;
  let previousCwd: string | undefined;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(now);
    workdir = mkdtempSync(join(tmpdir(), 'ruflo-3063-'));
    previousCwd = process.env.CLAUDE_FLOW_CWD;
    process.env.CLAUDE_FLOW_CWD = workdir;

    for (const directory of ['sessions', 'tasks', 'memory']) {
      mkdirSync(join(workdir, '.claude-flow', directory), { recursive: true });
    }

    writeFileSync(join(workdir, '.claude-flow', 'sessions', 'current.json'), JSON.stringify({
      id: 'session-real-3063',
      startedAt: startedAt.toISOString(),
      metrics: { edits: 4, commands: 2, tasks: 3, errors: 1 },
    }));
    writeFileSync(join(workdir, '.claude-flow', 'tasks', 'store.json'), JSON.stringify({
      version: '3.0.0',
      tasks: {
        completedNow: { status: 'completed', completedAt: '2026-08-21T09:55:00.000Z' },
        failedNow: { status: 'failed', completedAt: '2026-08-21T09:56:00.000Z' },
        completedBefore: { status: 'completed', completedAt: beforeSession.toISOString() },
        pending: { status: 'pending', completedAt: null },
      },
    }));
    writeFileSync(join(workdir, '.claude-flow', 'memory', 'store.json'), JSON.stringify({
      version: '3.0.0',
      entries: {
        learnedNow: {
          key: 'routing-decision:reviewer',
          value: { success: true },
          namespace: 'patterns',
          metadata: { type: 'routing-decision' },
          storedAt: '2026-08-21T09:57:00.000Z',
          accessCount: 0,
          lastAccessed: '2026-08-21T09:57:00.000Z',
        },
        oldPattern: {
          key: 'pattern-old',
          value: 'old',
          storedAt: beforeSession.toISOString(),
          accessCount: 0,
          lastAccessed: beforeSession.toISOString(),
        },
        misleadingTaskKey: {
          key: 'task-not-a-completed-task',
          value: 'not a task record or pattern',
          storedAt: '2026-08-21T09:58:00.000Z',
          accessCount: 0,
          lastAccessed: '2026-08-21T09:58:00.000Z',
        },
      },
    }));

    bridgeSessionEnd.mockReset();
    shutdownBridge.mockReset();
    bridgeSessionEnd.mockResolvedValue({ controller: 'test', persisted: true });
    shutdownBridge.mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.useRealTimers();
    rmSync(workdir, { recursive: true, force: true });
    if (previousCwd === undefined) delete process.env.CLAUDE_FLOW_CWD;
    else process.env.CLAUDE_FLOW_CWD = previousCwd;
  });

  it('persists the active session id with session-scoped task and pattern counts', async () => {
    const result = await hooksSessionEnd.handler({ saveState: true, stopDaemon: false }) as Record<string, any>;

    expect(bridgeSessionEnd).toHaveBeenCalledWith(expect.objectContaining({
      sessionId: 'session-real-3063',
      tasksCompleted: 1,
      patternsLearned: 1,
      summary: '1 task completed; 1 pattern learned; 4 edits recorded; 2 commands recorded; 1 error recorded; duration 10 minutes',
    }));
    expect(result).toMatchObject({
      sessionId: 'session-real-3063',
      duration: 600_000,
      statePath: '.claude/sessions/session-real-3063.json',
      summary: {
        tasksExecuted: 1,
        filesModified: 4,
        agentsSpawned: 0,
      },
      learningUpdates: { patternsLearned: 1 },
    });
  });

  it('refuses to fabricate an id when no active session exists', async () => {
    unlinkSync(join(workdir, '.claude-flow', 'sessions', 'current.json'));

    await expect(hooksSessionEnd.handler({ saveState: true, stopDaemon: false }))
      .rejects.toThrow('No active session state found');
    expect(bridgeSessionEnd).not.toHaveBeenCalled();
  });
});
