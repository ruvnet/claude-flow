/**
 * #3572 — `swarm status` reported 5% progress for a swarm with no tasks: a
 * hard-coded number shown as `[##----] 5.0%` that never changed as agents were
 * spawned. With no tasks there is nothing to be a fraction of, so progress is
 * `null` with a reason (JSON) and `n/a (no tasks)` (text), matching the
 * neighbouring `Tokens Used: unknown` / `Success Rate: no data` fields.
 *
 * Exercised via real execFileSync against bin/cli.js in temp cwds, matching
 * the harness in swarm-status-id-and-stop.test.ts.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const CLI = join(__dirname, '..', 'bin', 'cli.js');
const dirs: string[] = [];

function run(args: string[], cwd: string): string {
  try {
    return execFileSync('node', [CLI, ...args], {
      cwd, encoding: 'utf-8', stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch (err) {
    const e = err as { stdout?: Buffer; stderr?: Buffer };
    return (e.stdout?.toString() ?? '') + (e.stderr?.toString() ?? '');
  }
}

function statusJson(cwd: string): Record<string, unknown> {
  const out = run(['swarm', 'status', '--format', 'json'], cwd);
  return JSON.parse(out.slice(out.indexOf('{')));
}

/** A swarm as `swarm init` leaves it, with `agents` spawned and the given task statuses. */
function fixture(agents: number, taskStatuses: string[]): string {
  const cwd = mkdtempSync(join(tmpdir(), 'swarm-progress-3572-'));
  dirs.push(cwd);
  mkdirSync(join(cwd, '.swarm'), { recursive: true });
  writeFileSync(join(cwd, '.swarm', 'state.json'), JSON.stringify({
    id: 'swarm-3572', status: 'initialized', topology: 'hierarchical',
  }));
  if (agents > 0) {
    mkdirSync(join(cwd, '.claude-flow', 'metrics'), { recursive: true });
    writeFileSync(join(cwd, '.claude-flow', 'metrics', 'swarm-activity.json'), JSON.stringify({
      swarm: { agent_count: agents, coordination_active: false },
    }));
  }
  if (taskStatuses.length > 0) {
    mkdirSync(join(cwd, '.swarm', 'tasks'), { recursive: true });
    taskStatuses.forEach((status, i) => {
      writeFileSync(join(cwd, '.swarm', 'tasks', `task-${i}.json`), JSON.stringify({ id: `task-${i}`, status }));
    });
  }
  return cwd;
}

afterEach(() => {
  while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true });
});

describe('#3572 swarm status progress is never invented', () => {
  for (const agents of [0, 1, 2, 3]) {
    it(`reports no percentage for a swarm with no tasks and ${agents} agent(s)`, () => {
      const cwd = fixture(agents, []);

      const json = statusJson(cwd);
      expect(json.progress).toBeNull();
      expect(json.progressReason).toBe('no tasks');

      const text = run(['swarm', 'status'], cwd);
      const line = text.split('\n').find(l => l.includes('Overall Progress')) ?? '';
      expect(line).toContain('n/a (no tasks)');
      expect(line).not.toMatch(/\d+(\.\d+)?%/);
      expect(line).not.toContain('#');
    });
  }

  it('reports completed/total when tasks exist: 1 of 4 completed is 25%', () => {
    const cwd = fixture(2, ['completed', 'in_progress', 'pending', 'pending']);

    const json = statusJson(cwd);
    expect(json.progress).toBe(25);
    expect(json.progressReason).toBeNull();

    const text = run(['swarm', 'status'], cwd);
    const line = text.split('\n').find(l => l.includes('Overall Progress')) ?? '';
    expect(line).toContain('25');
    expect(line).not.toContain('n/a');
  });

  it('reports 100% when every task is completed', () => {
    const cwd = fixture(1, ['completed', 'done']);
    expect(statusJson(cwd).progress).toBe(100);
  });
});
