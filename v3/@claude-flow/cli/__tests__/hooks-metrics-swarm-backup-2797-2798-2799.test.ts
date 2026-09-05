/**
 * Regression guards for the 2026-07-27 "clean exit, no real work reflected"
 * batch — three reader/writer-mismatch bugs reported by vidaunited:
 *
 *   #2797 — hooks metrics Pattern Learning always 0 (pattern reader filtered
 *           on a key/type shape no writer produces)
 *   #2798 — memory backup silent no-op under CLAUDE_FLOW_ENCRYPT_AT_REST
 *           (better-sqlite3 online backup can't open the RFE1 blob)
 *   #2799 — swarm status always Total 0 agents (read .swarm/agents/ that
 *           no writer creates, while agent spawn writes swarm-activity.json)
 *
 * All three exercised via real execFileSync against bin/cli.js in temp cwds.
 */

import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, existsSync, readdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';

const CLI = join(__dirname, '..', 'bin', 'cli.js');

function run(args: string[], cwd: string, env: NodeJS.ProcessEnv = {}): { stdout: string; exit: number } {
  try {
    const stdout = execFileSync('node', [CLI, ...args], {
      cwd, encoding: 'utf-8', stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, ...env },
    });
    return { stdout, exit: 0 };
  } catch (err) {
    const e = err as { status?: number; stdout?: Buffer; stderr?: Buffer };
    return { stdout: (e.stdout?.toString() ?? '') + (e.stderr?.toString() ?? ''), exit: e.status ?? -1 };
  }
}

describe('#2797 hooks metrics Pattern Learning counts real writes', () => {
  it('Pattern Learning total is non-zero after a store-results post-task', () => {
    const wd = mkdtempSync(join(tmpdir(), 'ruflo-2797-'));
    try {
      run(['memory', 'init'], wd);
      run(['hooks', 'post-task', '-i', 't1', '--success', 'true', '-q', '0.95', '--task', 'some task', '--agent', 'coder', '--store-results'], wd);
      run(['hooks', 'post-task', '-i', 't2', '--success', 'false', '-q', '0.2', '--task', 'failed task', '--agent', 'coder', '--store-results'], wd);
      const { stdout } = run(['hooks', 'metrics', '--format', 'json'], wd);
      const data = JSON.parse(stdout.slice(stdout.indexOf('{')));
      expect(data.patterns.total).toBe(2);
      expect(data.patterns.successful).toBe(1);
      expect(data.patterns.failed).toBe(1);
      expect(data.patterns.successful + data.patterns.failed).toBeLessThanOrEqual(data.patterns.total);
      expect(data.patterns.described).toBe(2);
      expect(data.patterns.descriptionCoverage).toBe(1);
      expect(data.agents.routingAccuracy).toBeNull();
      expect(data.agents.averageConfidence).toBeGreaterThan(0);
      expect(data.agents.outcomeSuccessRate).toBe(0.5);
    } finally {
      try { rmSync(wd, { recursive: true, force: true }); } catch { /* */ }
    }
  }, 60_000);
});

describe('#2798 memory backup falls back to byte-copy under encryption', () => {
  it('produces a snapshot when CLAUDE_FLOW_ENCRYPT_AT_REST=1 (RFE1 blob)', () => {
    const wd = mkdtempSync(join(tmpdir(), 'ruflo-2798-'));
    const key = randomBytes(32).toString('hex');
    const env = { CLAUDE_FLOW_ENCRYPT_AT_REST: '1', CLAUDE_FLOW_ENCRYPTION_KEY: key };
    try {
      run(['memory', 'init'], wd, env);
      run(['memory', 'store', '--key', 'k', '--value', 'encrypted note'], wd, env);
      // Confirm the source really is the encrypted RFE1 blob (not native SQLite).
      const header = readFileSync(join(wd, '.swarm', 'memory.db')).subarray(0, 4).toString('latin1');
      expect(header).toBe('RFE1');
      const { stdout } = run(['memory', 'backup'], wd, env);
      expect(stdout).toMatch(/Backed up →/);
      const backups = existsSync(join(wd, '.swarm', 'backups'))
        ? readdirSync(join(wd, '.swarm', 'backups')).filter((f) => /^memory-.*\.db$/.test(f))
        : [];
      expect(backups.length).toBeGreaterThan(0);
    } finally {
      try { rmSync(wd, { recursive: true, force: true }); } catch { /* */ }
    }
  }, 60_000);
});

describe('#2799 swarm status reflects spawned agents', () => {
  it('swarm status agent total matches agent spawn count (via swarm-activity.json)', () => {
    const wd = mkdtempSync(join(tmpdir(), 'ruflo-2799-'));
    try {
      run(['swarm', 'init', '--topology', 'mesh', '--max-agents', '5'], wd);
      for (const a of ['coder', 'reviewer', 'researcher', 'tester']) {
        run(['agent', 'spawn', '--type', a, '--name', `x-${a}`], wd);
      }
      const status = run(['swarm', 'status'], wd).stdout;
      // The Agents section's Total must now be 4, not 0. Match the "Total | 4"
      // row in the agents table (allow ANSI/box chars around it).
      expect(status).toMatch(/Total\D+4/);
      expect(status).toMatch(/Active\D+0/);
      expect(status).toMatch(/Idle\D+4/);
      const list = run(['agent', 'list'], wd).stdout;
      expect(list).toMatch(/\| agent-\d+/);
      // Sanity: the activity file the fix reads was actually written.
      const activityPath = join(wd, '.claude-flow', 'metrics', 'swarm-activity.json');
      if (existsSync(activityPath)) {
        const activity = JSON.parse(readFileSync(activityPath, 'utf-8'));
        expect(activity.swarm.agent_count).toBe(4);
      }
    } finally {
      try { rmSync(wd, { recursive: true, force: true }); } catch { /* */ }
    }
  }, 60_000);
});
