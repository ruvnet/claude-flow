/**
 * runHeadlessProcess / buildWorkerEnvironment — the process and env helpers
 * shared by the dual-mode orchestrator and the CLI team runner.
 */
import { describe, it, expect } from 'vitest';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runHeadlessProcess, buildWorkerEnvironment } from '../src/dual-mode/index.js';

const node = process.execPath;

describe('runHeadlessProcess', () => {
  it('writes stdin, closes it, and returns the exit code', async () => {
    const result = await runHeadlessProcess({
      command: node,
      args: ['-e', "let s='';process.stdin.on('data',d=>s+=d);process.stdin.on('end',()=>{process.stdout.write('got:'+s);process.exit(4)})"],
      cwd: process.cwd(),
      env: process.env,
      stdinText: 'hello',
      timeoutMs: 5000,
      maxOutputBytes: 1024,
    });
    expect(result.stdout).toBe('got:hello');
    expect(result.code).toBe(4);
    expect(result.timedOut).toBe(false);
  });

  it('closes stdin even when no text is sent', async () => {
    const result = await runHeadlessProcess({
      command: node,
      args: ['-e', "process.stdin.resume();process.stdin.on('end',()=>process.stdout.write('eof'))"],
      cwd: process.cwd(),
      env: process.env,
      timeoutMs: 3000,
      maxOutputBytes: 1024,
    });
    expect(result.stdout).toBe('eof');
    expect(result.code).toBe(0);
  });

  it('times out and reports timedOut', async () => {
    const result = await runHeadlessProcess({
      command: node,
      args: ['-e', 'setTimeout(()=>{}, 10000)'],
      cwd: process.cwd(),
      env: process.env,
      timeoutMs: 200,
      maxOutputBytes: 1024,
    });
    expect(result.timedOut).toBe(true);
    expect(result.code).toBeNull();
    expect(result.ms).toBeLessThan(3000);
  });

  it('caps captured output and keeps the tail', async () => {
    const result = await runHeadlessProcess({
      command: node,
      args: ['-e', "process.stdout.write('x'.repeat(5000) + 'END')"],
      cwd: process.cwd(),
      env: process.env,
      timeoutMs: 5000,
      maxOutputBytes: 100,
    });
    expect(result.truncated).toBe(true);
    expect(result.stdout.endsWith('END')).toBe(true);
    expect(result.stdout).toContain('bytes of output dropped');
    expect(result.stdout.replace(/\n…\(\d+ bytes of output dropped\)…\n/, '').length).toBe(100);
  });

  it('keeps the terminal line of a long JSONL stream', async () => {
    const script = [
      "process.stdout.write(JSON.stringify({type:'thread.started',thread_id:'t1'})+'\\n');",
      "for (let i=0;i<2000;i++) process.stdout.write(JSON.stringify({type:'item.delta',i})+'\\n');",
      "process.stdout.write(JSON.stringify({type:'turn.completed'})+'\\n');",
    ].join('');
    const result = await runHeadlessProcess({
      command: node,
      args: ['-e', script],
      cwd: process.cwd(),
      env: process.env,
      timeoutMs: 5000,
      maxOutputBytes: 4096,
    });
    expect(result.truncated).toBe(true);
    expect(result.stdout).toContain('"thread.started"');
    expect(result.stdout.trimEnd().endsWith('{"type":"turn.completed"}')).toBe(true);
  });

  it('decodes a multi-byte character split across chunks', async () => {
    // "é" is 0xC3 0xA9; write the two bytes in separate chunks.
    const result = await runHeadlessProcess({
      command: node,
      args: ['-e', "process.stdout.write(Buffer.from([0xc3]));setTimeout(()=>process.stdout.write(Buffer.from([0xa9])),50)"],
      cwd: process.cwd(),
      env: process.env,
      timeoutMs: 5000,
      maxOutputBytes: 1024,
    });
    expect(result.stdout).toBe('é');
  });

  it.skipIf(process.platform === 'win32')('kills the whole process group on timeout and resolves after exit', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'headless-orphan-'));
    const marker = join(dir, 'ORPHAN');
    const started = Date.now();
    const result = await runHeadlessProcess({
      command: 'sh',
      args: ['-c', `(sleep 2; touch '${marker}') & wait`],
      cwd: dir,
      env: process.env,
      timeoutMs: 300,
      killGraceMs: 500,
      maxOutputBytes: 1024,
    });
    expect(result.timedOut).toBe(true);
    expect(result.code).toBeNull();
    expect(Date.now() - started).toBeLessThan(2000);
    await new Promise((r) => setTimeout(r, 2500));
    expect(existsSync(marker)).toBe(false);
    rmSync(dir, { recursive: true, force: true });
  }, 10000);

  it.skipIf(process.platform === 'win32')('escalates to SIGKILL when SIGTERM is ignored', async () => {
    const result = await runHeadlessProcess({
      command: node,
      args: ['-e', "process.on('SIGTERM',()=>{});setInterval(()=>{},1000)"],
      cwd: process.cwd(),
      env: process.env,
      timeoutMs: 300,
      killGraceMs: 300,
      maxOutputBytes: 1024,
    });
    expect(result.timedOut).toBe(true);
    expect(result.ms).toBeGreaterThanOrEqual(550);
    expect(result.ms).toBeLessThan(3000);
  }, 10000);

  it('stops the process when the signal aborts', async () => {
    const ac = new AbortController();
    setTimeout(() => ac.abort(), 100);
    const result = await runHeadlessProcess({
      command: node,
      args: ['-e', 'setTimeout(()=>{}, 10000)'],
      cwd: process.cwd(),
      env: process.env,
      timeoutMs: 10000,
      killGraceMs: 500,
      maxOutputBytes: 1024,
      signal: ac.signal,
    });
    expect(result.aborted).toBe(true);
    expect(result.timedOut).toBe(false);
    expect(result.ms).toBeLessThan(3000);
  });

  it('rejects when the command cannot be spawned', async () => {
    await expect(runHeadlessProcess({
      command: 'definitely-not-a-real-command-xyz',
      args: [],
      cwd: process.cwd(),
      env: process.env,
      timeoutMs: 1000,
      maxOutputBytes: 100,
    })).rejects.toThrow();
  });
});

describe('buildWorkerEnvironment', () => {
  const base = {
    PATH: '/bin',
    FOO_TOKEN: 'secret',
    OPENAI_API_KEY: 'sk-test',
    CLAUDE_FLOW_POLICY_MODE: 'x',
    CLAUDE_FLOW_PRINCIPAL_ID: 'someone-else',
  };

  it('strips sensitive names and sets the worker identity', () => {
    const env = buildWorkerEnvironment(base, { principalId: 'agent:w1', dbPath: '/db', envelope: { tools: ['a'] } });
    expect(env.PATH).toBe('/bin');
    expect(env.FOO_TOKEN).toBeUndefined();
    expect(env.OPENAI_API_KEY).toBeUndefined();
    expect(env.CLAUDE_FLOW_POLICY_MODE).toBeUndefined();
    expect(env.CLAUDE_FLOW_PRINCIPAL_ID).toBe('agent:w1');
    expect(env.CLAUDE_FLOW_DB_PATH).toBe('/db');
    expect(env.FORCE_COLOR).toBe('0');
    expect(JSON.parse(env.CLAUDE_FLOW_CAPABILITY_ENVELOPE!)).toEqual({ tools: ['a'] });
  });

  it('re-adds passEnv names after the strip', () => {
    const env = buildWorkerEnvironment(base, { principalId: 'agent:w1', passEnv: ['OPENAI_API_KEY', 'MISSING'] });
    expect(env.OPENAI_API_KEY).toBe('sk-test');
    expect(env.FOO_TOKEN).toBeUndefined();
    expect('MISSING' in env).toBe(false);
    expect(env.CLAUDE_FLOW_CAPABILITY_ENVELOPE).toBeUndefined();
  });
});
