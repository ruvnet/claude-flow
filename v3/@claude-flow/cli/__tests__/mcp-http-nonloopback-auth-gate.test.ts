// Dream Cycle 2026-10-01 (security) + follow-up: the MCP HTTP server
// (`ruflo mcp start -t http`) used to start with no authentication at all on
// any host. Two controls close that for the cases a configuration can express:
//
//   1. startHttpServer() refuses a NON-loopback --host unless the request path
//      is authenticated (RUFLO_MCP_HTTP_TOKEN / --auth-token-file) or the
//      operator explicitly sets RUFLO_MCP_ALLOW_UNAUTHENTICATED_HTTP=1.
//   2. With a token, @claude-flow/mcp's HTTP transport requires
//      `Authorization: Bearer <token>` on every request.
//
// Loopback WITHOUT a token stays unauthenticated by design (any local process
// can call tools) - that is documented, not closed.
//
// The wiring tests drive the real MCPServerManager.start() (the entry the CLI
// uses) with @claude-flow/mcp mocked, so they assert the actual decision made
// in startHttpServer: delete the `throw` there and the refusal tests fail.
// Transport-level enforcement is tested in
// v3/@claude-flow/mcp/__tests__/http-transport-auth.test.ts.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

const createMCPServer = vi.fn();

vi.mock('@claude-flow/mcp', () => ({
  createMCPServer: (...args: unknown[]) => createMCPServer(...args),
}));
vi.mock('../src/mcp-client.js', () => ({
  listMCPTools: () => [],
  callMCPTool: async () => ({}),
}));

import {
  MCPServerManager,
  isLoopbackHost,
  isUnauthenticatedHttpAllowed,
  resolveMcpHttpAuthToken,
  shouldRefuseUnauthenticatedHttp,
} from '../src/mcp-server.js';

const TOKEN = 'correct-horse-battery-staple-42';
const OPT_OUT = 'RUFLO_MCP_ALLOW_UNAUTHENTICATED_HTTP';

let tmp: string;
let managers: MCPServerManager[] = [];
const savedEnv = { ...process.env };

function lanIp(): string {
  for (const addrs of Object.values(os.networkInterfaces())) {
    for (const a of addrs ?? []) if (a.family === 'IPv4' && !a.internal) return a.address;
  }
  return '192.168.1.5';
}

function manager(options: ConstructorParameters<typeof MCPServerManager>[0]): MCPServerManager {
  const m = new MCPServerManager({
    transport: 'http',
    port: 39000 + Math.floor(Math.random() * 1000),
    pidFile: path.join(tmp, 'mcp.pid'),
    logFile: path.join(tmp, 'mcp.log'),
    ...options,
  });
  m.on('error', () => { /* start() rethrows; this only stops the EventEmitter 'error' rethrow */ });
  managers.push(m);
  return m;
}

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-auth-gate-'));
  delete process.env[OPT_OUT];
  delete process.env.RUFLO_MCP_HTTP_TOKEN;
  createMCPServer.mockReset();
  createMCPServer.mockImplementation(() => ({
    registerTools: () => ({ failed: [] }),
    start: async () => {},
    stop: async () => {},
  }));
});

afterEach(async () => {
  for (const m of managers) { try { await m.stop(); } catch { /* not started */ } }
  managers = [];
  process.env = { ...savedEnv };
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe('MCPServerManager.start() - non-loopback hosts are refused without auth', () => {
  const hosts = ['0.0.0.0', '::', lanIp()];

  for (const host of hosts) {
    it(`refuses host ${host} with the documented message and never builds a server`, async () => {
      await expect(manager({ host }).start()).rejects.toThrow(/Refusing to start the MCP HTTP server on non-loopback host/);
      await expect(manager({ host }).start()).rejects.toThrow(/RUFLO_MCP_HTTP_TOKEN/);
      await expect(manager({ host }).start()).rejects.toThrow(/RUFLO_MCP_ALLOW_UNAUTHENTICATED_HTTP=1/);
      expect(createMCPServer).not.toHaveBeenCalled();
    });

    it(`starts host ${host} when the explicit opt-out is set (no auth configured)`, async () => {
      process.env[OPT_OUT] = '1';
      await manager({ host }).start();
      expect(createMCPServer).toHaveBeenCalledTimes(1);
      expect(createMCPServer.mock.calls[0][0].auth).toBeUndefined();
    });

    it(`starts host ${host} with a token and no opt-out, and wires the token into the transport`, async () => {
      await manager({ host, authToken: TOKEN }).start();
      expect(createMCPServer).toHaveBeenCalledTimes(1);
      const cfg = createMCPServer.mock.calls[0][0];
      expect(cfg.host).toBe(host);
      expect(cfg.auth).toEqual({ enabled: true, method: 'token', tokens: [TOKEN] });
    });
  }

  it('an invalid opt-out value does not lift the gate', async () => {
    for (const v of ['0', 'false', 'yes', '']) {
      process.env[OPT_OUT] = v;
      await expect(manager({ host: '0.0.0.0' }).start()).rejects.toThrow(/Refusing to start/);
    }
    expect(createMCPServer).not.toHaveBeenCalled();
  });

  it('a token with the standalone websocket transport is rejected (no working check there)', async () => {
    await expect(manager({ transport: 'websocket', host: '0.0.0.0', authToken: TOKEN }).start())
      .rejects.toThrow(/only supported with --transport http/);
    expect(createMCPServer).not.toHaveBeenCalled();
  });

  it('websocket transport on a non-loopback host is still refused without the opt-out', async () => {
    await expect(manager({ transport: 'websocket', host: '0.0.0.0' }).start()).rejects.toThrow(/Refusing to start/);
  });
});

describe('MCPServerManager.start() - loopback hosts start', () => {
  for (const host of ['localhost', '127.0.0.1', '::1']) {
    it(`starts ${host} with no token and no opt-out (unauthenticated, as documented)`, async () => {
      await manager({ host }).start();
      expect(createMCPServer).toHaveBeenCalledTimes(1);
      expect(createMCPServer.mock.calls[0][0].auth).toBeUndefined();
    });

    it(`starts ${host} with a token and enforces it`, async () => {
      await manager({ host, authToken: TOKEN }).start();
      expect(createMCPServer.mock.calls[0][0].auth).toMatchObject({ enabled: true, tokens: [TOKEN] });
    });
  }

  it('does not leak the token through the "starting" event', async () => {
    const m = manager({ host: '127.0.0.1', authToken: TOKEN });
    const seen: string[] = [];
    m.on('starting', (d) => seen.push(JSON.stringify(d)));
    await m.start();
    expect(seen.join('')).not.toContain(TOKEN);
    expect(seen.join('')).toContain('[redacted]');
  });
});

describe('isLoopbackHost', () => {
  it('is true for exactly the three recognized loopback spellings', () => {
    for (const h of ['localhost', '127.0.0.1', '::1']) expect(isLoopbackHost(h)).toBe(true);
  });

  it('fails closed for everything else, including other loopback spellings', () => {
    // 127.0.0.2, [::1], LOCALHOST and 0:0:0:0:0:0:0:1 are loopback to the OS
    // but are not normalized: they need the token or the opt-out.
    for (const h of ['0.0.0.0', '::', '192.168.1.5', '127.0.0.2', '[::1]', 'LOCALHOST', '0:0:0:0:0:0:0:1', '']) {
      expect(isLoopbackHost(h)).toBe(false);
    }
  });
});

describe('isUnauthenticatedHttpAllowed', () => {
  it('only the documented values opt out', () => {
    expect(isUnauthenticatedHttpAllowed({})).toBe(false);
    for (const v of ['yes', '0', 'false', 'TRUE', ' 1']) {
      expect(isUnauthenticatedHttpAllowed({ [OPT_OUT]: v })).toBe(false);
    }
    expect(isUnauthenticatedHttpAllowed({ [OPT_OUT]: '1' })).toBe(true);
    expect(isUnauthenticatedHttpAllowed({ [OPT_OUT]: 'true' })).toBe(true);
  });
});

describe('shouldRefuseUnauthenticatedHttp - the decision matrix', () => {
  it.each([
    // host, optOut, authenticated, refuse?
    ['0.0.0.0', false, false, true],
    ['0.0.0.0', true, false, false],
    ['0.0.0.0', false, true, false],
    ['0.0.0.0', true, true, false],
    ['127.0.0.1', false, false, false],
    ['localhost', false, false, false],
    ['::1', false, false, false],
    ['127.0.0.2', false, false, true],
  ])('host=%s optOut=%s authenticated=%s -> refuse=%s', (host, optOut, authenticated, refuse) => {
    const env = optOut ? { [OPT_OUT]: '1' } : {};
    expect(shouldRefuseUnauthenticatedHttp(host, env, authenticated)).toBe(refuse);
  });
});

describe('resolveMcpHttpAuthToken', () => {
  it('returns undefined when nothing is configured (env unset or empty)', () => {
    expect(resolveMcpHttpAuthToken({}, {})).toBeUndefined();
    expect(resolveMcpHttpAuthToken({}, { RUFLO_MCP_HTTP_TOKEN: '' })).toBeUndefined();
  });

  it('reads the env var, a file (trailing newline stripped), or an explicit flag, in flag > file > env order', () => {
    expect(resolveMcpHttpAuthToken({}, { RUFLO_MCP_HTTP_TOKEN: TOKEN })).toBe(TOKEN);
    expect(resolveMcpHttpAuthToken({ tokenFile: '/x' }, { RUFLO_MCP_HTTP_TOKEN: 'e'.repeat(20) }, () => `${TOKEN}\n`)).toBe(TOKEN);
    expect(resolveMcpHttpAuthToken({ token: TOKEN, tokenFile: '/x' }, {}, () => 'f'.repeat(20))).toBe(TOKEN);
  });

  it('rejects malformed tokens without echoing them (fail closed, never "no auth")', () => {
    for (const bad of ['short', 'has space in the middle of it', 'ünïcödé-token-ünïcödé-token', 'x'.repeat(513), 'tab\there-and-more-chars']) {
      let message = '';
      try { resolveMcpHttpAuthToken({}, { RUFLO_MCP_HTTP_TOKEN: bad }); } catch (e) { message = (e as Error).message; }
      expect(message).toMatch(/Invalid MCP HTTP auth token from RUFLO_MCP_HTTP_TOKEN/);
      expect(message).not.toContain(bad);
    }
    expect(() => resolveMcpHttpAuthToken({ token: '' }, {})).toThrow(/Invalid MCP HTTP auth token/);
  });

  it('an unreadable token file is an error, not "no token"', () => {
    expect(() => resolveMcpHttpAuthToken({ tokenFile: '/nope' }, {}, () => { throw new Error('ENOENT /nope'); }))
      .toThrow(/Could not read the MCP HTTP auth token file/);
  });
});
