/**
 * ADR-476 -- hive-mind gate behaviour matrix (caller type x credential).
 *
 *   caller                          no cred   wrong cred   operator secret   hiveToken
 *   local  (no context / stdio/cli)   ok         ok            ok              ok
 *   remote (http / websocket)         refused    refused       ok              ok*
 *   remote w/ no secret configured    refused    refused       refused         ok*
 *   RUFLO_HIVE_REQUIRE_AUTH=1 (any)   treated as remote
 *   (* every gated tool except hive-mind_init, which takes only the secret)
 *
 * The caller class comes from the server-built `context.transport`, never from
 * a tool argument.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync, readFileSync, readdirSync, statSync, existsSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const cryptoSpy = vi.hoisted(() => ({ calls: [] as Array<[number, number]> }));
vi.mock('node:crypto', async () => {
  const actual = await vi.importActual<typeof import('node:crypto')>('node:crypto');
  return {
    ...actual,
    timingSafeEqual: (a: NodeJS.ArrayBufferView, b: NodeJS.ArrayBufferView) => {
      cryptoSpy.calls.push([a.byteLength, b.byteLength]);
      return actual.timingSafeEqual(a, b);
    },
  };
});

import { hiveMindTools, getHiveTokenForCli } from '../src/mcp-tools/hive-mind-tools.js';

const SECRET = 'operator-secret-0123456789abcdef';
const posix = process.platform !== 'win32';

type Ctx = Record<string, unknown> | undefined;
const LOCAL_CTXS: Array<[string, Ctx]> = [
  ['in-process (no context)', undefined],
  ['stdio MCP', { sessionId: 's', transport: 'stdio' }],
  ['CLI mcp exec', { sessionId: 's', transport: 'cli' }],
];
const REMOTE_CTXS: Array<[string, Ctx]> = [
  ['http', { sessionId: 's', transport: 'http' }],
  ['websocket', { sessionId: 's', transport: 'websocket' }],
  ['context naming no transport', { sessionId: 's' }],
  ['spoofed transport string', { sessionId: 's', transport: 'stdio-but-not-really' }],
];

const raw = (name: string) => hiveMindTools.find((t) => t.name === name)!;
const run = (name: string, input: Record<string, unknown>, ctx: Ctx) =>
  raw(name).handler(input, ctx) as Promise<any>;

/** Every gated operation, with a predicate for "this call was refused". */
interface Op {
  name: string;
  tool: string;
  tokenAllowed: boolean;
  input: (cred: Record<string, unknown>) => Record<string, unknown>;
  refused: (r: any) => boolean;
}
const op = (name: string, tool: string, tokenAllowed: boolean, input: Op['input'], refused: Op['refused']): Op => ({ name, tool, tokenAllowed, input, refused });
const failedFlag = (r: any) => r?.success === false || typeof r?.error === 'string';
const OPS: Op[] = [
  op('init', 'hive-mind_init', false, (c) => ({ consensus: 'raft', ...c }), failedFlag),
  op('join', 'hive-mind_join', true, (c) => ({ agentId: 'w-join', ...c }), failedFlag),
  op('spawn', 'hive-mind_spawn', true, (c) => ({ count: 1, ...c }), failedFlag),
  op('propose', 'hive-mind_consensus', true, (c) => ({ action: 'propose', type: 't', value: 'v', strategy: 'raft', ...c }), failedFlag),
  op('broadcast', 'hive-mind_broadcast', true, (c) => ({ message: 'hi', ...c }), failedFlag),
  op('memory set', 'hive-mind_memory', true, (c) => ({ action: 'set', key: 'k', value: 'v', ...c }), failedFlag),
  op('memory delete', 'hive-mind_memory', true, (c) => ({ action: 'delete', key: 'k', ...c }), failedFlag),
  op('optimize-memory', 'hive-mind_optimize-memory', true, (c) => ({ ...c }), (r) => typeof r?.error === 'string'),
  op('shutdown', 'hive-mind_shutdown', true, (c) => ({ force: true, ...c }), failedFlag),
];

describe('hive-mind gate matrix (ADR-476)', () => {
  let dir: string;
  let prevCwd: string | undefined;
  const hiveDir = () => join(dir, '.claude-flow', 'hive-mind');

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'hive-gate-'));
    prevCwd = process.env.CLAUDE_FLOW_CWD;
    process.env.CLAUDE_FLOW_CWD = dir;
    delete process.env.RUFLO_HIVE_BOOTSTRAP_SECRET;
    delete process.env.RUFLO_HIVE_REQUIRE_AUTH;
    cryptoSpy.calls.length = 0;
  });
  afterEach(() => {
    delete process.env.RUFLO_HIVE_BOOTSTRAP_SECRET;
    delete process.env.RUFLO_HIVE_REQUIRE_AUTH;
    if (prevCwd === undefined) delete process.env.CLAUDE_FLOW_CWD;
    else process.env.CLAUDE_FLOW_CWD = prevCwd;
    rmSync(dir, { recursive: true, force: true });
  });

  /** Local operator init (what `hive-mind init` / a stdio client does). */
  async function localInit() {
    const r = await run('hive-mind_init', { consensus: 'raft' }, undefined);
    expect(r.success).toBe(true);
    return getHiveTokenForCli() as string;
  }

  describe('local callers keep working with no extra step', () => {
    for (const [label, ctx] of LOCAL_CTXS) {
      it(`${label}: init, join, spawn, propose, broadcast, memory set/delete, optimize, shutdown all succeed with no credential`, async () => {
        for (const o of OPS) {
          if (o.name === 'shutdown') continue;
          const r = await run(o.tool, o.input({}), ctx);
          expect(o.refused(r), `${o.name} refused for ${label}: ${JSON.stringify(r)}`).toBe(false);
        }
        const r = await run('hive-mind_shutdown', { force: true }, ctx);
        expect(r.success).toBe(true);
      });
    }

    it('a local MCP client can init, then join and vote with no token ever shown to it', async () => {
      const ctx = { sessionId: 's', transport: 'stdio' };
      const init = await run('hive-mind_init', {}, ctx);
      expect(init.success).toBe(true);
      expect(init.hiveToken).toBeUndefined();
      expect((await run('hive-mind_join', { agentId: 'w1' }, ctx)).success).toBe(true);
      const p = await run('hive-mind_consensus', { action: 'propose', type: 't', value: 1, strategy: 'raft' }, ctx);
      const v = await run('hive-mind_consensus', { action: 'vote', proposalId: p.proposalId, vote: true, voterId: 'w1' }, ctx);
      expect(v.error).toBeUndefined();
    });
  });

  describe('remote callers (no file access) are refused for every gated tool', () => {
    for (const o of OPS) {
      for (const [label, ctx] of REMOTE_CTXS) {
        it(`${o.name} via ${label}: no credential, wrong secret and wrong token are refused and change nothing`, async () => {
          process.env.RUFLO_HIVE_BOOTSTRAP_SECRET = SECRET;
          await localInit();
          const before = readFileSync(join(hiveDir(), 'state.json'), 'utf-8');
          const attempts: Array<Record<string, unknown>> = [
            {},
            { bootstrapSecret: 'x'.repeat(SECRET.length) },
            { bootstrapSecret: 'short' },
            { hiveToken: 'forged' },
            { bootstrapSecret: '' },
          ];
          for (const cred of attempts) {
            const r = await run(o.tool, o.input(cred), ctx);
            expect(o.refused(r), `${o.name}/${label}/${JSON.stringify(cred)} -> ${JSON.stringify(r)}`).toBe(true);
          }
          expect(readFileSync(join(hiveDir(), 'state.json'), 'utf-8')).toBe(before);
        });
      }
    }

    it('remote callers cannot init a brand-new hive: nothing is written to disk', async () => {
      process.env.RUFLO_HIVE_BOOTSTRAP_SECRET = SECRET;
      const r = await run('hive-mind_init', {}, { sessionId: 's', transport: 'http' });
      expect(r.success).toBe(false);
      expect(existsSync(join(hiveDir(), 'state.json'))).toBe(false);
    });

    it('a remote call never creates the secret file (only a local init does)', async () => {
      await run('hive-mind_init', { bootstrapSecret: 'guess' }, { sessionId: 's', transport: 'http' });
      expect(existsSync(join(hiveDir(), 'bootstrap.secret'))).toBe(false);
    });

    it('with no secret configured anywhere, even an attacker-chosen secret is refused', async () => {
      const r = await run('hive-mind_init', { bootstrapSecret: 'anything-long-enough-0123' }, { sessionId: 's', transport: 'http' });
      expect(r.success).toBe(false);
    });
  });

  describe('remote callers the operator has given the secret to', () => {
    const HTTP = { sessionId: 's', transport: 'http' };

    for (const o of OPS) {
      it(`${o.name}: accepted with the operator secret (env)`, async () => {
        process.env.RUFLO_HIVE_BOOTSTRAP_SECRET = SECRET;
        await localInit();
        const r = await run(o.tool, o.input({ bootstrapSecret: SECRET }), HTTP);
        expect(o.refused(r), JSON.stringify(r)).toBe(false);
      });
      if (o.tokenAllowed) {
        it(`${o.name}: accepted with the hiveToken`, async () => {
          const token = await localInit();
          const r = await run(o.tool, o.input({ hiveToken: token }), HTTP);
          expect(o.refused(r), JSON.stringify(r)).toBe(false);
        });
      }
    }

    it('works with the file-based secret too (no env), once a local init created it', async () => {
      await localInit();
      const fileSecret = readFileSync(join(hiveDir(), 'bootstrap.secret'), 'utf-8').trim();
      const r = await run('hive-mind_spawn', { count: 1, bootstrapSecret: fileSecret }, HTTP);
      expect(r.success).toBe(true);
    });
  });

  describe('secret sources', () => {
    const HTTP = { sessionId: 's', transport: 'http' };

    it('env overrides the file: the file value stops working, the env value works', async () => {
      await localInit();
      const fileSecret = readFileSync(join(hiveDir(), 'bootstrap.secret'), 'utf-8').trim();
      process.env.RUFLO_HIVE_BOOTSTRAP_SECRET = SECRET;
      expect((await run('hive-mind_spawn', { bootstrapSecret: fileSecret }, HTTP)).success).toBe(false);
      expect((await run('hive-mind_spawn', { bootstrapSecret: SECRET }, HTTP)).success).toBe(true);
    });

    it('an env secret shorter than 16 chars is ignored (cannot be a weak shared password)', async () => {
      process.env.RUFLO_HIVE_BOOTSTRAP_SECRET = 'abc';
      await localInit();
      expect((await run('hive-mind_spawn', { bootstrapSecret: 'abc' }, HTTP)).success).toBe(false);
    });

    it('a local init does not overwrite an existing secret file', async () => {
      mkdirSync(hiveDir(), { recursive: true });
      writeFileSync(join(hiveDir(), 'bootstrap.secret'), 'pre-existing-operator-secret-xyz');
      await localInit();
      expect(readFileSync(join(hiveDir(), 'bootstrap.secret'), 'utf-8')).toBe('pre-existing-operator-secret-xyz');
    });

    it('a local init is satisfied by an env secret and writes no file', async () => {
      process.env.RUFLO_HIVE_BOOTSTRAP_SECRET = SECRET;
      await localInit();
      expect(existsSync(join(hiveDir(), 'bootstrap.secret'))).toBe(false);
    });
  });

  describe('RUFLO_HIVE_REQUIRE_AUTH=1 (strict mode for bridged/shared stdio)', () => {
    it('treats stdio and in-process callers as remote', async () => {
      await localInit();
      process.env.RUFLO_HIVE_REQUIRE_AUTH = '1';
      for (const [, ctx] of LOCAL_CTXS) {
        expect((await run('hive-mind_spawn', { count: 1 }, ctx)).success).toBe(false);
      }
      const token = getHiveTokenForCli();
      expect((await run('hive-mind_spawn', { count: 1, hiveToken: token }, { transport: 'stdio' })).success).toBe(true);
    });
  });

  describe('constant-time comparison', () => {
    it('compares fixed-length digests via timingSafeEqual for any supplied length (no length oracle, no throw)', async () => {
      process.env.RUFLO_HIVE_BOOTSTRAP_SECRET = SECRET;
      await localInit();
      cryptoSpy.calls.length = 0;
      for (const supplied of ['a', 'b'.repeat(7), SECRET.slice(0, -1), SECRET + 'x', 'c'.repeat(5000)]) {
        const r = await run('hive-mind_spawn', { bootstrapSecret: supplied }, { transport: 'http' });
        expect(r.success).toBe(false);
      }
      expect(cryptoSpy.calls.length).toBeGreaterThanOrEqual(5);
      for (const [a, b] of cryptoSpy.calls) {
        expect(a).toBe(32);
        expect(b).toBe(32);
      }
    });
  });

  describe('credentials never leave the server', () => {
    it('no tool response, denial or console/stdout output contains the token or the secret', async () => {
      process.env.RUFLO_HIVE_BOOTSTRAP_SECRET = SECRET;
      const logged: string[] = [];
      const spies = (['log', 'info', 'warn', 'error', 'debug'] as const).map((m) =>
        vi.spyOn(console, m).mockImplementation((...a: unknown[]) => { logged.push(a.map(String).join(' ')); }),
      );
      const out = vi.spyOn(process.stdout, 'write').mockImplementation(((c: unknown) => { logged.push(String(c)); return true; }) as never);
      const err = vi.spyOn(process.stderr, 'write').mockImplementation(((c: unknown) => { logged.push(String(c)); return true; }) as never);
      try {
        const responses: unknown[] = [];
        responses.push(await run('hive-mind_init', {}, undefined));
        const token = getHiveTokenForCli() as string;
        responses.push(await run('hive-mind_init', { bootstrapSecret: 'wrong' }, { transport: 'http' }));
        responses.push(await run('hive-mind_init', { bootstrapSecret: SECRET }, { transport: 'http' }));
        for (const o of OPS.filter((x) => x.name !== 'init' && x.name !== 'shutdown')) {
          responses.push(await run(o.tool, o.input({}), { transport: 'http' }));
          responses.push(await run(o.tool, o.input({ hiveToken: 'forged' }), { transport: 'http' }));
          responses.push(await run(o.tool, o.input({ bootstrapSecret: 'forged' }), { transport: 'http' }));
          responses.push(await run(o.tool, o.input({}), undefined));
        }
        responses.push(await run('hive-mind_status', {}, { transport: 'http' }));
        responses.push(await run('hive-mind_status', {}, undefined));
        responses.push(await run('hive-mind_memory', { action: 'list' }, { transport: 'http' }));
        responses.push(await run('hive-mind_shutdown', { force: true }, undefined));

        const blob = JSON.stringify(responses) + logged.join('\n');
        expect(blob).not.toContain(token);
        expect(blob).not.toContain(SECRET);
        expect(blob).not.toMatch(/"hiveToken":\s*"[0-9a-f]{64}"/);
      } finally {
        spies.forEach((s) => s.mockRestore());
        out.mockRestore();
        err.mockRestore();
      }
    });
  });

  describe.skipIf(!posix)('file permissions (POSIX)', () => {
    const mode = (p: string) => statSync(p).mode & 0o777;

    it('state.json and bootstrap.secret are 0600, the hive directory 0700, after init and after later writes', async () => {
      await localInit();
      await run('hive-mind_memory', { action: 'set', key: 'k', value: 'v' }, undefined);
      expect(mode(join(hiveDir(), 'state.json'))).toBe(0o600);
      expect(mode(join(hiveDir(), 'bootstrap.secret'))).toBe(0o600);
      expect(mode(hiveDir())).toBe(0o700);
    });

    it('tightens a pre-existing world-readable state.json on the next write', async () => {
      await localInit();
      const { chmodSync } = await import('node:fs');
      chmodSync(join(hiveDir(), 'state.json'), 0o644);
      await run('hive-mind_memory', { action: 'set', key: 'k2', value: 'v' }, undefined);
      expect(mode(join(hiveDir(), 'state.json'))).toBe(0o600);
    });

    it('writes atomically: no temp files are left behind and the file is always valid JSON', async () => {
      await localInit();
      for (let i = 0; i < 20; i++) await run('hive-mind_memory', { action: 'set', key: `k${i}`, value: i }, undefined);
      expect(readdirSync(hiveDir()).filter((f) => f.endsWith('.tmp'))).toEqual([]);
      expect(() => JSON.parse(readFileSync(join(hiveDir(), 'state.json'), 'utf-8'))).not.toThrow();
    });
  });
});
