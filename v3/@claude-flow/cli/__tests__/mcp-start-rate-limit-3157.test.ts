// #3157: `mcp start` exposes the HTTP per-IP and per-session rate limits that
// @claude-flow/mcp used to hardcode. Out-of-range values are refused before the
// server starts; valid ones reach MCPServerManager options.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  manager: {
    on: vi.fn(),
    start: vi.fn(),
    stop: vi.fn(async () => {}),
    checkHealth: vi.fn(async () => ({ healthy: true })),
  },
  getServerManager: vi.fn(),
  createMCPServer: vi.fn(),
}));

vi.mock('@claude-flow/mcp', () => ({ createMCPServer: h.createMCPServer }));

vi.mock('../src/mcp-server.js', () => ({
  MCPServerManager: class {},
  createMCPServerManager: vi.fn(),
  getServerManager: h.getServerManager,
  startMCPServer: vi.fn(),
  stopMCPServer: vi.fn(),
  getMCPServerStatus: vi.fn(async () => ({ running: false })),
  filterAdvertisedMcpTools: (tools: unknown[]) => tools,
  parseMcpToolSelection: () => 'all',
  resolveMcpHttpAuthToken: () => undefined,
}));

vi.mock('../src/mcp-client.js', () => ({
  listMCPTools: () => [],
  callMCPTool: vi.fn(),
  hasTool: vi.fn(),
  getToolMetadata: vi.fn(),
}));

vi.mock('../src/runtime/parent-death-watchdog.js', () => ({ installParentDeathWatchdog: vi.fn() }));
vi.mock('../src/prompt.js', () => ({ select: vi.fn(), confirm: vi.fn() }));
vi.mock('../src/output.js', () => ({
  output: {
    writeln: vi.fn(),
    printInfo: vi.fn(),
    printWarning: vi.fn(),
    printError: vi.fn(),
    printSuccess: vi.fn(),
    printTable: vi.fn(),
    dim: (value: string) => value,
    success: (value: string) => value,
    bold: (value: string) => value,
  },
}));

import { mcpCommand } from '../src/commands/mcp.js';

describe('mcp start rate limit options (#3157)', () => {
  const start = mcpCommand.subcommands!.find((command) => command.name === 'start')!;
  const run = (flags: Record<string, unknown>) =>
    start.action!({ args: [], flags, interactive: false } as never);

  beforeEach(() => {
    h.manager.start.mockReset().mockImplementation(() => new Promise(() => {}));
    h.getServerManager.mockReset().mockReturnValue(h.manager);
  });
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it.each([
    ['rate-limit-per-ip', 0],
    ['rate-limit-per-ip', 100_001],
    ['rate-limit-window-ms', 999],
    ['rate-limit-window-ms', Number.NaN],
    ['rate-limit-per-session', -1],
    ['rate-limit-per-session', 1.5],
    ['rate-limit-global-rps', 10_001],
    ['rate-limit-global-burst', 0],
  ])('refuses --%s %s', async (flag, value) => {
    const result = await run({ transport: 'http', [flag]: value });

    expect(result).toMatchObject({ success: false, exitCode: 1 });
    expect(h.getServerManager).not.toHaveBeenCalled();
  });

  it('refuses an invalid value from the environment', async () => {
    vi.stubEnv('RUFLO_MCP_RATE_LIMIT_PER_SESSION', 'lots');
    const result = await run({ transport: 'http' });

    expect(result).toMatchObject({ success: false, exitCode: 1 });
  });

  it('passes flag and environment values to the server manager', async () => {
    vi.stubEnv('RUFLO_MCP_RATE_LIMIT_PER_SESSION', '200');
    void run({ transport: 'http', rateLimitPerIp: 600, 'rate-limit-window-ms': 30_000, rateLimitGlobalBurst: 1000 });
    await vi.waitFor(() => expect(h.manager.start).toHaveBeenCalled());

    expect(h.getServerManager).toHaveBeenCalledWith(expect.objectContaining({
      rateLimitPerIp: 600,
      rateLimitWindowMs: 30_000,
      rateLimitPerSession: 200,
      rateLimitGlobalBurst: 1000,
    }));
  });
});

describe('MCPServerManager rate limit mapping (#3157)', () => {
  const startHttp = async (options: Record<string, unknown>) => {
    const { MCPServerManager } = await vi.importActual<typeof import('../src/mcp-server.js')>('../src/mcp-server.js');
    h.createMCPServer.mockReset().mockReturnValue({
      registerTools: () => ({ failed: [] }),
      start: async () => {},
    });
    await (new MCPServerManager({ transport: 'http', ...options }) as any).startHttpServer();
    return h.createMCPServer.mock.calls[0][0];
  };

  it('maps the options onto the MCP server config', async () => {
    const config = await startHttp({ rateLimitPerIp: 600, rateLimitPerSession: 500, rateLimitGlobalBurst: 1000 });

    expect(config.rateLimit).toStrictEqual({ limit: 600 });
    expect(config.sessionRateLimit).toStrictEqual({ perSessionLimit: 500, burstSize: 1000 });
  });

  it('leaves the limits unset by default', async () => {
    const config = await startHttp({});

    expect(config.rateLimit).toBeUndefined();
    expect(config.sessionRateLimit).toBeUndefined();
  });

  describe('on a non-loopback host', () => {
    const token = 'a'.repeat(32);

    beforeEach(() => {
      vi.stubEnv('RUFLO_MCP_ALLOW_UNAUTHENTICATED_HTTP', '1');
    });
    afterEach(() => {
      vi.unstubAllEnvs();
    });

    it.each([
      [{ rateLimitPerIp: 121 }],
      [{ rateLimitWindowMs: 59_999 }],
      [{ rateLimitPerSession: 51 }],
      [{ rateLimitGlobalRps: 101 }],
      [{ rateLimitGlobalBurst: 201 }],
    ])('refuses %o above the defaults without a token', async (limits) => {
      await expect(startHttp({ host: '0.0.0.0', ...limits })).rejects.toThrow(/Refusing to raise MCP rate limits/);
      expect(h.createMCPServer).not.toHaveBeenCalled();
    });

    it('accepts limits at or below the defaults without a token', async () => {
      const config = await startHttp({ host: '0.0.0.0', rateLimitPerIp: 120, rateLimitWindowMs: 120_000, rateLimitPerSession: 10 });

      expect(config.rateLimit).toStrictEqual({ windowMs: 120_000, limit: 120 });
    });

    it('accepts raised limits with a token', async () => {
      const config = await startHttp({ host: '0.0.0.0', authToken: token, rateLimitPerIp: 600, rateLimitGlobalBurst: 1000 });

      expect(config.rateLimit).toStrictEqual({ limit: 600 });
      expect(config.sessionRateLimit).toStrictEqual({ burstSize: 1000 });
    });
  });
});
