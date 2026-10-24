/**
 * Regression guard for ruvnet/ruflo#4463 (HeadlessWorkerExecutor.executeClaudeCode).
 *  1. cancel() must settle the execution promise and escalate to SIGKILL.
 *  2. The fallback deadline timer must not outlive the child.
 *  3. SIGKILL escalation keys off "child exited", not `child.killed`
 *     (which only means a signal was delivered).
 * Uses a fake child and fake timers; no CLI is launched and no real signal is sent.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EventEmitter } from 'events';

const fake = vi.hoisted(() => ({ child: null as any }));
vi.mock('child_process', async (orig) => {
  const actual = await orig<typeof import('child_process')>();
  return { ...actual, spawn: vi.fn(() => fake.child) };
});

import { HeadlessWorkerExecutor } from '../src/services/headless-worker-executor.js';

function makeChild() {
  const child: any = new EventEmitter();
  child.pid = 12345;
  child.killed = false;
  child.exitCode = null;
  child.signalCode = null;
  child.stdin = { end() {} };
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.kill = vi.fn(() => { child.killed = true; return true; });
  return child;
}

describe('#4463 — HeadlessWorkerExecutor cancel / timers / escalation', () => {
  let signals: Array<[number, string]>;
  let killSpy: any;
  let exec: any;

  beforeEach(() => {
    vi.useFakeTimers();
    fake.child = makeChild();
    signals = [];
    killSpy = vi.spyOn(process, 'kill').mockImplementation(((pid: number, sig: string) => { signals.push([pid, sig]); return true; }) as any);
    exec = new HeadlessWorkerExecutor('/tmp/ruflo-4463-nonexistent');
  });

  afterEach(() => {
    killSpy.mockRestore();
    vi.useRealTimers();
  });

  const run = (timeoutMs = 10_000) =>
    exec.executeClaudeCode('p', { sandbox: 'strict', model: 'haiku', timeoutMs, executionId: 'e1', workerType: 'audit' });

  it('cancel() settles the promise and SIGKILLs a child that ignores SIGTERM', async () => {
    const p = run();
    expect(exec.cancel('e1')).toBe(true);
    const r = await p; // must not hang
    expect(r.success).toBe(false);
    expect(r.error).toMatch(/cancel/i);
    expect(signals.map((s) => s[1])).toEqual(['SIGTERM']);
    await vi.advanceTimersByTimeAsync(5_000);
    expect(signals.map((s) => s[1])).toEqual(['SIGTERM', 'SIGKILL']);
  });

  it('cancel() does not SIGKILL a child that exited after SIGTERM', async () => {
    const p = run();
    exec.cancel('e1');
    fake.child.exitCode = 0;
    fake.child.emit('close', 0);
    await p;
    await vi.advanceTimersByTimeAsync(5_000);
    expect(signals.map((s) => s[1])).toEqual(['SIGTERM']);
  });

  it('clears the fallback deadline timer once the child closes', async () => {
    const p = run();
    fake.child.exitCode = 0;
    fake.child.emit('close', 0);
    await p;
    expect(vi.getTimerCount()).toBe(0);
  });

  it('timeout escalation sends exactly one SIGTERM then SIGKILL while the child has not exited', async () => {
    const p = run(1_000);
    // A signal was delivered (killed=true) but the child has not exited.
    fake.child.killed = true;
    await vi.advanceTimersByTimeAsync(1_000);
    await vi.advanceTimersByTimeAsync(5_000);
    await p;
    expect(signals.map((s) => s[1])).toEqual(['SIGTERM', 'SIGKILL']);
  });
});
