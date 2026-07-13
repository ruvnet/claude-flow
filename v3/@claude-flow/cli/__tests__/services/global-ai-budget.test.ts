/**
 * #2661 — Global AI launch budget (emergency cost fuse).
 *
 * The budget is the user-global invariant that bounds autonomous
 * `claude --print` launches independent of worktree/daemon count:
 *   - at most maxConcurrentGlobal active children
 *   - at most maxLaunchesPerHour / maxLaunchesPerDay launches
 *   - a quota error opens a circuit breaker that pauses everything
 *   - every denial carries a reason and is receipted
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, readFileSync, existsSync, writeFileSync, symlinkSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import {
  GlobalAiBudget,
  DEFAULT_AI_BUDGET_LIMITS,
  isQuotaErrorText,
} from '../../src/services/global-ai-budget.js';

const REQ = { workerType: 'audit', model: 'haiku', workspace: '/tmp/wt-1' };

describe('#2661 — GlobalAiBudget', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'ai-budget-test-'));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
    delete process.env.RUFLO_AI_BUDGET_DISABLE;
  });

  const makeBudget = (limits?: Partial<typeof DEFAULT_AI_BUDGET_LIMITS>) =>
    new GlobalAiBudget({ baseDir: dir, limits });

  describe('defaults', () => {
    it('ships the #2661 containment limits', () => {
      expect(DEFAULT_AI_BUDGET_LIMITS).toEqual({
        maxConcurrentGlobal: 1,
        maxLaunchesPerHour: 2,
        maxLaunchesPerDay: 12,
        pauseOnQuotaErrorMinutes: 60,
      });
    });
  });

  describe('reserve', () => {
    it('grants a permit when under budget', async () => {
      const budget = makeBudget();
      const permit = await budget.reserve(REQ);
      expect(permit.allowed).toBe(true);
      expect(permit.permitId).toBeTruthy();
    });

    it('denies the second concurrent launch at maxConcurrentGlobal=1', async () => {
      const budget = makeBudget({ maxLaunchesPerHour: 10, maxLaunchesPerDay: 10 });
      const first = await budget.reserve(REQ);
      expect(first.allowed).toBe(true);

      const second = await budget.reserve({ ...REQ, workspace: '/tmp/wt-2' });
      expect(second.allowed).toBe(false);
      expect(second.reason).toMatch(/global-concurrency/);
    });

    it('allows a new launch after release() frees the concurrency slot', async () => {
      const budget = makeBudget({ maxLaunchesPerHour: 10, maxLaunchesPerDay: 10 });
      const first = await budget.reserve(REQ);
      await budget.release(first.permitId);

      const second = await budget.reserve(REQ);
      expect(second.allowed).toBe(true);
    });

    it('enforces the hourly launch budget even after release', async () => {
      const budget = makeBudget({ maxConcurrentGlobal: 10, maxLaunchesPerHour: 2, maxLaunchesPerDay: 10 });
      for (let i = 0; i < 2; i++) {
        const p = await budget.reserve(REQ);
        expect(p.allowed).toBe(true);
        await budget.release(p.permitId);
      }
      const denied = await budget.reserve(REQ);
      expect(denied.allowed).toBe(false);
      expect(denied.reason).toMatch(/hourly-budget/);
    });

    it('enforces the daily budget across the 24h window', async () => {
      const budget = makeBudget({ maxConcurrentGlobal: 10, maxLaunchesPerHour: 10, maxLaunchesPerDay: 3 });
      for (let i = 0; i < 3; i++) {
        const p = await budget.reserve(REQ);
        expect(p.allowed).toBe(true);
        await budget.release(p.permitId);
      }
      const denied = await budget.reserve(REQ);
      expect(denied.allowed).toBe(false);
      expect(denied.reason).toMatch(/daily-budget/);
    });

    it('is shared across budget INSTANCES (simulating separate daemons/worktrees)', async () => {
      // Two daemons in two worktrees each create their own GlobalAiBudget —
      // the ledger on disk is the shared source of truth.
      const daemonA = makeBudget({ maxConcurrentGlobal: 10, maxLaunchesPerHour: 1, maxLaunchesPerDay: 10 });
      const daemonB = makeBudget({ maxConcurrentGlobal: 10, maxLaunchesPerHour: 1, maxLaunchesPerDay: 10 });

      const a = await daemonA.reserve({ ...REQ, workspace: '/tmp/wt-a' });
      expect(a.allowed).toBe(true);
      await daemonA.release(a.permitId);

      const b = await daemonB.reserve({ ...REQ, workspace: '/tmp/wt-b' });
      expect(b.allowed).toBe(false);
      expect(b.reason).toMatch(/hourly-budget/);
    });

    it('RUFLO_AI_BUDGET_DISABLE=1 bypasses the fuse (explicit escape hatch)', async () => {
      process.env.RUFLO_AI_BUDGET_DISABLE = '1';
      const budget = makeBudget({ maxLaunchesPerHour: 0, maxLaunchesPerDay: 0, maxConcurrentGlobal: 0 });
      const p = await budget.reserve(REQ);
      expect(p.allowed).toBe(true);
    });

    it('fails CLOSED when the ledger is a symlink (invariant 9)', async () => {
      const budget = makeBudget();
      writeFileSync(join(dir, 'evil-target.json'), '{}');
      symlinkSync(join(dir, 'evil-target.json'), join(dir, 'ai-budget.json'));
      const p = await budget.reserve(REQ);
      expect(p.allowed).toBe(false);
      expect(p.reason).toMatch(/budget-ledger-error/);
    });
  });

  describe('quota circuit breaker', () => {
    it('recordQuotaError pauses ALL subsequent launches for the cooldown', async () => {
      const budget = makeBudget({ maxConcurrentGlobal: 10, maxLaunchesPerHour: 10, maxLaunchesPerDay: 10 });
      await budget.recordQuotaError('audit: 429 rate limit exceeded');

      const denied = await budget.reserve(REQ);
      expect(denied.allowed).toBe(false);
      expect(denied.reason).toMatch(/circuit-open/);

      const usage = budget.getUsage();
      expect(usage.pausedUntil).toBeGreaterThan(Date.now());
    });

    it('circuit opened by one instance pauses another instance', async () => {
      const daemonA = makeBudget();
      const daemonB = makeBudget();
      await daemonA.recordQuotaError('quota exhausted');
      const p = await daemonB.reserve(REQ);
      expect(p.allowed).toBe(false);
      expect(p.reason).toMatch(/circuit-open/);
    });
  });

  describe('receipts (invariant 10)', () => {
    it('writes launch and deny receipts with reasons', async () => {
      const budget = makeBudget({ maxConcurrentGlobal: 10, maxLaunchesPerHour: 1, maxLaunchesPerDay: 10 });
      const p = await budget.reserve(REQ);
      await budget.release(p.permitId);
      await budget.reserve(REQ); // denied

      const receiptsFile = join(dir, 'ai-budget-receipts.jsonl');
      expect(existsSync(receiptsFile)).toBe(true);
      const lines = readFileSync(receiptsFile, 'utf-8').trim().split('\n').map((l) => JSON.parse(l));
      expect(lines.some((r) => r.event === 'launch')).toBe(true);
      const deny = lines.find((r) => r.event === 'deny');
      expect(deny).toBeTruthy();
      expect(deny.reason).toMatch(/hourly-budget/);
    });
  });

  describe('getUsage', () => {
    it('reports launches and active reservations', async () => {
      const budget = makeBudget({ maxConcurrentGlobal: 10, maxLaunchesPerHour: 10, maxLaunchesPerDay: 10 });
      await budget.reserve(REQ);
      const p2 = await budget.reserve(REQ);
      await budget.release(p2.permitId);

      const usage = budget.getUsage();
      expect(usage.lastHour).toBe(2);
      expect(usage.lastDay).toBe(2);
      expect(usage.active).toBe(1);
    });
  });

  describe('isQuotaErrorText', () => {
    it('matches quota / rate-limit failure signatures', () => {
      expect(isQuotaErrorText('HTTP 429 Too Many Requests')).toBe(true);
      expect(isQuotaErrorText('You have hit your usage limit')).toBe(true);
      expect(isQuotaErrorText('rate_limit_error: quota exceeded')).toBe(true);
      expect(isQuotaErrorText('overloaded_error')).toBe(true);
    });

    it('does not match unrelated errors', () => {
      expect(isQuotaErrorText('Process exited with code 1')).toBe(false);
      expect(isQuotaErrorText('ENOENT: claude not found')).toBe(false);
      expect(isQuotaErrorText(undefined)).toBe(false);
    });
  });
});
