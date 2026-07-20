/**
 * advisor-tip.ts — ADR-316 co-pilot advisor tip.
 *
 * Every test injects a fake FableHarness-shaped object (or a fully
 * constructed FableHarness with an injected spawnClaude) so no test ever
 * shells out to `claude` or spends a cent. Coverage:
 *   • consent gate (never refreshes without 'advisor-tips' consent)
 *   • TTL gate (never re-spends within ADVISOR_REFRESH_TTL_MS)
 *   • cache read/write shape, including the "no-tip" case (still stamps
 *     _ts so a "nothing to say" answer isn't re-asked all window long)
 *   • readAdvisorTip() is a pure, synchronous cache reader — TTL-expired
 *     entries return null
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { recordConsent } from '../src/funnel/consent.js';
import {
  ADVISOR_REFRESH_TTL_MS,
  readAdvisorTip,
  refreshAdvisorTipIfStale,
} from '../src/funnel/advisor-tip.js';
import type { FableHarness as FableHarnessType } from '../src/services/fable-harness.js';

let stateDir: string;
let savedEnv: NodeJS.ProcessEnv;

beforeEach(() => {
  stateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'advisor-tip-test-'));
  savedEnv = { ...process.env };
  process.env.RUFLO_STATE_DIR = stateDir;
});

afterEach(() => {
  process.env = savedEnv;
  fs.rmSync(stateDir, { recursive: true, force: true });
});

describe('refreshAdvisorTipIfStale — consent gate', () => {
  it('never calls the harness without advisor-tips consent', async () => {
    let called = false;
    const harness = { adviseCoPilotTip: async () => { called = true; return null; } } as unknown as FableHarnessType;
    const result = await refreshAdvisorTipIfStale({}, { harness });
    expect(result).toEqual({ refreshed: false, reason: 'not-consented' });
    expect(called).toBe(false);
  });

  it('calls the harness once consent is granted', async () => {
    recordConsent('advisor-tips', true, 'test');
    let called = false;
    const harness = {
      adviseCoPilotTip: async () => { called = true; return { headline: 'x', detail: 'y', confidence: 0.5 }; },
    } as unknown as FableHarnessType;
    const result = await refreshAdvisorTipIfStale({}, { harness });
    expect(result).toEqual({ refreshed: true });
    expect(called).toBe(true);
  });
});

describe('refreshAdvisorTipIfStale — TTL gate (at most once per window)', () => {
  it('does not re-spend within the TTL window', async () => {
    recordConsent('advisor-tips', true, 'test');
    let calls = 0;
    const harness = {
      adviseCoPilotTip: async () => { calls++; return { headline: 'tip', detail: 'd', confidence: 0.9 }; },
    } as unknown as FableHarnessType;
    const t0 = new Date(0);
    const first = await refreshAdvisorTipIfStale({}, { now: t0, harness });
    expect(first.refreshed).toBe(true);
    expect(calls).toBe(1);

    const stillFresh = new Date(t0.getTime() + ADVISOR_REFRESH_TTL_MS - 1000);
    const second = await refreshAdvisorTipIfStale({}, { now: stillFresh, harness });
    expect(second).toEqual({ refreshed: false, reason: 'fresh' });
    expect(calls).toBe(1); // no second spawn
  });

  it('re-spends once the TTL window has elapsed', async () => {
    recordConsent('advisor-tips', true, 'test');
    let calls = 0;
    const harness = {
      adviseCoPilotTip: async () => { calls++; return { headline: 'tip', detail: 'd', confidence: 0.9 }; },
    } as unknown as FableHarnessType;
    const t0 = new Date(0);
    await refreshAdvisorTipIfStale({}, { now: t0, harness });
    const afterTtl = new Date(t0.getTime() + ADVISOR_REFRESH_TTL_MS + 1000);
    const result = await refreshAdvisorTipIfStale({}, { now: afterTtl, harness });
    expect(result.refreshed).toBe(true);
    expect(calls).toBe(2);
  });
});

describe('refreshAdvisorTipIfStale — cache write shape', () => {
  it('writes headline+detail to the cache on a real tip', async () => {
    recordConsent('advisor-tips', true, 'test');
    const harness = {
      adviseCoPilotTip: async () => ({ headline: 'Commit your work', detail: '50 files uncommitted.', confidence: 0.8 }),
    } as unknown as FableHarnessType;
    const now = new Date();
    await refreshAdvisorTipIfStale({ gitUncommittedCount: 50 }, { now, harness });
    const tip = readAdvisorTip(now);
    expect(tip).toEqual({ headline: 'Commit your work', detail: '50 files uncommitted.' });
  });

  it('stamps the cache even when the model finds nothing worth surfacing (no re-ask within the window)', async () => {
    recordConsent('advisor-tips', true, 'test');
    let calls = 0;
    const harness = { adviseCoPilotTip: async () => { calls++; return null; } } as unknown as FableHarnessType;
    const now = new Date();
    const first = await refreshAdvisorTipIfStale({}, { now, harness });
    expect(first).toEqual({ refreshed: true, reason: 'no-tip' });
    expect(readAdvisorTip(now)).toBeNull(); // nothing to show, but...
    const second = await refreshAdvisorTipIfStale({}, { now: new Date(now.getTime() + 1000), harness });
    expect(second).toEqual({ refreshed: false, reason: 'fresh' }); // ...not re-asked
    expect(calls).toBe(1);
  });

  it('surfaces harness errors as refreshed:false without throwing', async () => {
    recordConsent('advisor-tips', true, 'test');
    const harness = { adviseCoPilotTip: async () => { throw new Error('spawn failed'); } } as unknown as FableHarnessType;
    const result = await refreshAdvisorTipIfStale({}, { harness });
    expect(result).toEqual({ refreshed: false, reason: 'error' });
  });
});

describe('readAdvisorTip — pure cache reader', () => {
  it('returns null when nothing has been cached', () => {
    expect(readAdvisorTip()).toBeNull();
  });

  it('returns null for an expired cache entry', async () => {
    recordConsent('advisor-tips', true, 'test');
    const harness = {
      adviseCoPilotTip: async () => ({ headline: 'tip', detail: 'd', confidence: 0.9 }),
    } as unknown as FableHarnessType;
    const t0 = new Date(0);
    await refreshAdvisorTipIfStale({}, { now: t0, harness });
    const expired = new Date(t0.getTime() + ADVISOR_REFRESH_TTL_MS + 1);
    expect(readAdvisorTip(expired)).toBeNull();
  });
});
