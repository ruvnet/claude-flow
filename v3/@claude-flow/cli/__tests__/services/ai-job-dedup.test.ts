/**
 * #2661 invariant 5 — cross-worktree AI job dedup registry.
 * Same repositoryId + HEAD + worker + config → at most one run per
 * freshness window, shared across registry instances (daemons).
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import {
  AiJobDedupRegistry,
  computeAiJobKey,
  hashWorkerConfig,
} from '../../src/services/ai-job-dedup.js';

const PARTS = {
  repositoryId: 'repo-abc',
  head: 'deadbeef',
  workerType: 'audit',
  configHash: 'cfg-1',
};

describe('#2661 — AI job dedup registry', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'ai-jobs-test-'));
    delete process.env.RUFLO_AI_DEDUP_DISABLE;
  });

  afterEach(() => {
    delete process.env.RUFLO_AI_DEDUP_DISABLE;
    rmSync(dir, { recursive: true, force: true });
  });

  describe('computeAiJobKey', () => {
    it('is stable for identical parts and distinct when any part changes', () => {
      const base = computeAiJobKey(PARTS);
      expect(computeAiJobKey({ ...PARTS })).toBe(base);
      expect(computeAiJobKey({ ...PARTS, head: 'other' })).not.toBe(base);
      expect(computeAiJobKey({ ...PARTS, workerType: 'optimize' })).not.toBe(base);
      expect(computeAiJobKey({ ...PARTS, repositoryId: 'repo-xyz' })).not.toBe(base);
      expect(computeAiJobKey({ ...PARTS, configHash: 'cfg-2' })).not.toBe(base);
    });
  });

  describe('hashWorkerConfig', () => {
    it('is insensitive to object key order', () => {
      expect(hashWorkerConfig({ a: 1, b: { c: 2, d: 3 } }))
        .toBe(hashWorkerConfig({ b: { d: 3, c: 2 }, a: 1 }));
    });

    it('changes when values change', () => {
      expect(hashWorkerConfig({ a: 1 })).not.toBe(hashWorkerConfig({ a: 2 }));
    });
  });

  describe('freshness', () => {
    it('a recorded success is fresh within the window and shared across instances', () => {
      const key = computeAiJobKey(PARTS);
      const daemonA = new AiJobDedupRegistry({ baseDir: dir });
      const daemonB = new AiJobDedupRegistry({ baseDir: dir });

      expect(daemonA.isFresh(key, 60_000).fresh).toBe(false);
      daemonA.recordSuccess(key, { workerType: 'audit', repositoryId: PARTS.repositoryId, workspace: '/tmp/wt-a' });

      // Sibling worktree's daemon sees the same registry.
      const seen = daemonB.isFresh(key, 60_000);
      expect(seen.fresh).toBe(true);
      expect(seen.lastRunAt).toBeTypeOf('number');
    });

    it('goes stale outside the freshness window', () => {
      const key = computeAiJobKey(PARTS);
      const reg = new AiJobDedupRegistry({ baseDir: dir });
      reg.recordSuccess(key, { workerType: 'audit', repositoryId: PARTS.repositoryId, workspace: '/tmp/wt' });
      expect(reg.isFresh(key, 0).fresh).toBe(false);
    });

    it('a different HEAD is a different job (never deduped)', () => {
      const reg = new AiJobDedupRegistry({ baseDir: dir });
      const keyA = computeAiJobKey(PARTS);
      reg.recordSuccess(keyA, { workerType: 'audit', repositoryId: PARTS.repositoryId, workspace: '/tmp/wt' });
      const keyB = computeAiJobKey({ ...PARTS, head: 'cafebabe' });
      expect(reg.isFresh(keyB, 60_000).fresh).toBe(false);
    });

    it('RUFLO_AI_DEDUP_DISABLE=1 turns dedup off', () => {
      const key = computeAiJobKey(PARTS);
      const reg = new AiJobDedupRegistry({ baseDir: dir });
      reg.recordSuccess(key, { workerType: 'audit', repositoryId: PARTS.repositoryId, workspace: '/tmp/wt' });
      process.env.RUFLO_AI_DEDUP_DISABLE = '1';
      expect(reg.isFresh(key, 60_000).fresh).toBe(false);
    });
  });
});
