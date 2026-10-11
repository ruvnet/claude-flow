import { existsSync, realpathSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { EXECUTORS } from '../../src/dashboard/executors.js';
import { parseMcpOutput, resolveRufloCommand, RufloClient, RufloError, runArgv, scrubEnv } from '../../src/dashboard/exec.js';

const dirs: string[] = [];
const tmp = () => { const d = mkdtempSync(join(tmpdir(), 'rfexec-')); dirs.push(d); return d; };
afterEach(() => { for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }); });

/** A stand-in "ruflo" that reports exactly the argv it received, in the real `Result:` output format. */
function fakeRuflo(dir: string): string[] {
  const script = join(dir, 'fake-ruflo.mjs');
  writeFileSync(script, 'console.log("[INFO] Executing tool");\nconsole.log("Result:");\nconsole.log(JSON.stringify({ argv: process.argv.slice(2), env: Object.keys(process.env), cwd: process.cwd() }));\n');
  return [process.execPath, script];
}

describe('argv safety', () => {
  it('keeps hostile objectives as a single argv element and never invokes a shell', async () => {
    const dir = tmp(); const canary = join(dir, 'pwned');
    const hostile = [`; touch ${canary}`, `$(touch ${canary})`, `\`touch ${canary}\``, `x' ; touch ${canary} ; '`, `&& touch ${canary}`, '| cat /etc/passwd', 'a\nb', '--help'];
    const client = new RufloClient(fakeRuflo(dir), dir);
    for (const objective of hostile) {
      const r = (await client.mcp('mission_create', { objective, requestId: 'req-0000001' })) as { argv: string[] };
      expect(r.argv).toEqual(['mcp', 'exec', '-t', 'mission_create', '-p', JSON.stringify({ objective, requestId: 'req-0000001' })]);
      expect(r.argv).toHaveLength(6); // objective is inside ONE json argument, never split
    }
    expect(existsSync(canary)).toBe(false);
  });

  it('rejects tool names that are not plain identifiers', () => {
    const c = new RufloClient(['x'], '.');
    for (const bad of ['a b', 'a;b', '$(x)', '../x', '', 'A'.repeat(80), '-t']) expect(() => c.argvFor(bad)).toThrow(RufloError);
  });

  it('rejects argv with NUL bytes or empty argv', async () => {
    await expect(runArgv([], { cwd: '.' })).rejects.toThrow();
    await expect(runArgv(['echo', 'a\0b'], { cwd: '.' })).rejects.toThrow();
  });

  it('scrubs the environment to an allowlist (no tokens leak into ruflo)', async () => {
    const dir = tmp();
    const env = scrubEnv({ PATH: '/usr/bin', HOME: '/h', ANTHROPIC_API_KEY: 'k', GITHUB_TOKEN: 't', NODE_OPTIONS: '--inspect', AWS_SECRET_ACCESS_KEY: 's' });
    expect(Object.keys(env).sort()).toEqual(['FORCE_COLOR', 'HOME', 'NO_COLOR', 'PATH']);
    process.env.__RFD_SECRET = 'leak'; process.env.ANTHROPIC_API_KEY ??= 'dummy-for-test';
    const r = (await new RufloClient(fakeRuflo(dir), dir).mcp('system_info')) as { env: string[]; cwd: string };
    expect(r.env).not.toContain('__RFD_SECRET'); expect(r.env).not.toContain('ANTHROPIC_API_KEY');
    expect(r.cwd).toBe(realpathSync(dir));
    delete process.env.__RFD_SECRET;
  });
});

describe('limits', () => {
  it('kills a command that exceeds the timeout', async () => {
    const t0 = Date.now();
    const r = await runArgv([process.execPath, '-e', 'setTimeout(()=>{},60000)'], { cwd: '.', timeoutMs: 300 });
    expect(r.timedOut).toBe(true); expect(Date.now() - t0).toBeLessThan(5000);
  });
  it('kills a command that exceeds the output cap', async () => {
    const r = await runArgv([process.execPath, '-e', 'for(;;)process.stdout.write("x".repeat(65536))'], { cwd: '.', maxBytes: 100_000, timeoutMs: 8000 });
    expect(r.truncated).toBe(true); expect(r.stdout.length).toBeLessThanOrEqual(100_000);
  });
  it('surfaces timeouts and a missing binary as RufloError, not a crash', async () => {
    await expect(new RufloClient([process.execPath, '-e', 'setTimeout(()=>{},60000)', '--'], '.', 300).mcp('system_info')).rejects.toMatchObject({ code: 'timeout' });
    await expect(new RufloClient(['/nonexistent/ruflo-bin'], '.').mcp('system_info')).rejects.toMatchObject({ code: 'spawn_failed' });
  });
});

describe('parseMcpOutput', () => {
  it('extracts the JSON after the Result: marker, ignoring log noise', () => {
    expect(parseMcpOutput('[INFO] Executing tool: x\nTransformers.js loaded: m\n[OK] Tool executed in 3ms\nResult:\n{\n  "a": 1\n}\n')).toEqual({ a: 1 });
  });
  it('reports tool errors, missing and invalid results', () => {
    expect(() => parseMcpOutput('[ERROR] Unknown tool: nope')).toThrow(/Unknown tool/);
    expect(() => parseMcpOutput('hello')).toThrowError(/no Result/);
    expect(() => parseMcpOutput('Result:\n{oops')).toThrowError(/not valid JSON/);
  });
});

describe('executor mapping', () => {
  const ctx = (mcp: (t: string, p?: Record<string, unknown>) => Promise<unknown>) => ({ ruflo: { mcp }, cid: 'cmd_abcdefghijklmnop', refreshAll: async () => ({ sent: [] }), refreshSection: async () => ({ sent: false }) });
  it('clamps swarm size to 6 even if called with more', async () => {
    const seen: unknown[] = [];
    await EXECUTORS['swarm.init']({ topology: 'hierarchical', maxAgents: 99 }, ctx(async (_t, p) => { seen.push(p); return { swarmId: 's', topology: 'hierarchical', maxAgents: 6 }; }));
    expect(seen).toEqual([{ topology: 'hierarchical', maxAgents: 6 }]);
  });
  it('mission actions: stop maps to cancel with the current revision and the cid as idempotency key', async () => {
    const calls: [string, unknown][] = [];
    const r = await EXECUTORS['mission.stop']({ missionId: 'msn_' + 'c'.repeat(24) }, ctx(async (t, p) => { calls.push([t, p]); return t === 'mission_get' ? { ok: true, data: { record: { revision: 4 } } } : { ok: true, data: { missionId: p!.missionId, state: 'cancelled', revision: 5 } }; }));
    expect(r.ok).toBe(true);
    expect(calls[1]).toEqual(['mission_request_action', { missionId: 'msn_' + 'c'.repeat(24), action: 'cancel', expectedRevision: 4, requestId: 'cmd_abcdefghijklmnop', reason: 'requested from ruflo dashboard' }]);
  });
  it('a refused tool call (ok:false) becomes a failure with the code, not a success', async () => {
    await expect(EXECUTORS['mission.create']({ objective: 'abc', requestId: 'req-00000001' }, ctx(async () => ({ ok: false, code: 'invalid-input', message: 'nope' })))).rejects.toThrow(/invalid-input/);
  });
  it('caps and masks results', async () => {
    const r = await EXECUTORS['memory.search']({ query: 'q', limit: 5 }, ctx(async () => ({ total: 1, results: Array.from({ length: 50 }, (_, i) => ({ key: 'k' + i + ' token=supersecretvalue123', namespace: 'n', similarity: 0.5 })) })));
    expect(r.ok).toBe(true);
    expect(JSON.stringify(r)).not.toContain('supersecretvalue123');
    expect(JSON.stringify(r).length).toBeLessThan(4200);
  });
});

describe('launcher resolution (L11)', () => {
  it('has no npx fallback: missing ruflo is a clear error; config and PATH win', () => {
    expect(() => resolveRufloCommand(undefined, '/nonexistent-dir')).toThrowError(/not on PATH/);
    expect(resolveRufloCommand(['/opt/ruflo', '--x'])).toEqual(['/opt/ruflo', '--x']);
    const d = tmp(); const bin = join(d, 'ruflo'); writeFileSync(bin, '#!/bin/sh\n', { mode: 0o755 });
    expect(resolveRufloCommand(undefined, d)).toEqual([bin]); // absolute path, so the child never searches PATH
  });
});
