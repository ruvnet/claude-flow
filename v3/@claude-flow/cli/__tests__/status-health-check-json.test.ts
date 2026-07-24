/**
 * Tests for `status --health-check --format json`.
 *
 * performHealthCheck() has always computed a structured result —
 * `{ checks, summary }` is returned in CommandResult.data — but the JSON
 * format flag was only honored by the plain `status` path four lines above
 * the health-check dispatch, so `status --health-check --format json`
 * printed decorated human text. CI wants to parse health checks; this
 * pins the machine-readable contract:
 *   (a) `--health-check --format json` emits exactly one printJson payload
 *       shaped { checks, summary } with no decorated text around it;
 *   (b) exit-code semantics are unchanged (exit 1 when any check fails)
 *       and the JSON is still emitted on failure — a red health check must
 *       remain parseable in CI;
 *   (c) text mode is untouched (no printJson without the format flag).
 *
 * Mock-first per house style: mcp-client and output are mocked; the
 * command action is driven directly (same harness as commands.test.ts;
 * note getSystemStatus calls the underscore tool names swarm_status /
 * mcp_status / memory_stats / task_summary).
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { statusCommand } from '../src/commands/status.js';
import type { CommandContext } from '../src/types.js';
import * as fs from 'fs';
import { output } from '../src/output.js';
import { callMCPTool } from '../src/mcp-client.js';

vi.mock('fs', () => ({
  existsSync: vi.fn(),
  mkdirSync: vi.fn(),
  writeFileSync: vi.fn(),
  readFileSync: vi.fn(),
  unlinkSync: vi.fn()
}));

vi.mock('../src/mcp-client.js', () => ({
  MCPClientError: class MCPClientError extends Error {},
  callMCPTool: vi.fn()
}));

vi.mock('../src/output.js', () => ({
  output: {
    writeln: vi.fn(),
    printInfo: vi.fn(),
    printSuccess: vi.fn(),
    printError: vi.fn(),
    printWarning: vi.fn(),
    printTable: vi.fn(),
    printJson: vi.fn(),
    printList: vi.fn(),
    printBox: vi.fn(),
    createSpinner: vi.fn(() => ({
      start: vi.fn(),
      succeed: vi.fn(),
      fail: vi.fn(),
      stop: vi.fn()
    })),
    highlight: (str: string) => str,
    bold: (str: string) => str,
    dim: (str: string) => str,
    success: (str: string) => str,
    error: (str: string) => str,
    warning: (str: string) => str,
    info: (str: string) => str,
    progressBar: () => '[=====>    ]',
    setColorEnabled: vi.fn()
  }
}));

/** Healthy-system responses for the tools getSystemStatus actually calls. */
function mockHealthySystem(): void {
  vi.mocked(callMCPTool).mockImplementation(async (toolName: string) => {
    if (toolName === 'swarm_status') {
      return {
        swarmId: 'swarm-json-1',
        topology: 'hierarchical-mesh',
        agents: { total: 5, active: 3, idle: 2, terminated: 0 },
        health: 'healthy',
        uptime: 3600000
      };
    }
    if (toolName === 'mcp_status') {
      return { running: true, port: 3000, transport: 'stdio' };
    }
    if (toolName === 'memory_stats') {
      return {
        entries: 100,
        size: 1024000,
        backend: 'hybrid',
        performance: { avgSearchTime: 0.5, cacheHitRate: 0.85 }
      };
    }
    if (toolName === 'task_summary') {
      return { total: 10, pending: 3, running: 2, completed: 5, failed: 0 };
    }
    throw new Error(`unexpected tool: ${toolName}`);
  });
}

describe('status --health-check --format json', () => {
  let ctx: CommandContext;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(fs.existsSync).mockReturnValue(true);
    ctx = {
      args: [],
      flags: { 'health-check': true, format: 'json', _: [] },
      cwd: '/test/project',
      interactive: false
    };
  });

  it('emits one machine-readable { checks, summary } payload and no decorated text', async () => {
    mockHealthySystem();

    const result = await statusCommand.action!(ctx);

    expect(result.success).toBe(true);
    expect(result.exitCode ?? 0).toBe(0);

    expect(output.printJson).toHaveBeenCalledTimes(1);
    const payload = vi.mocked(output.printJson).mock.calls[0][0] as {
      checks: Array<{ name: string; status: string; message: string }>;
      summary: { passed: number; warned: number; failed: number };
    };
    expect(Array.isArray(payload.checks)).toBe(true);
    expect(payload.checks.length).toBeGreaterThan(0);
    for (const check of payload.checks) {
      expect(['pass', 'warn', 'fail']).toContain(check.status);
      expect(typeof check.name).toBe('string');
      expect(typeof check.message).toBe('string');
    }
    // Summary counts must reconcile with the checks array.
    expect(payload.summary).toEqual({
      passed: payload.checks.filter(c => c.status === 'pass').length,
      warned: payload.checks.filter(c => c.status === 'warn').length,
      failed: payload.checks.filter(c => c.status === 'fail').length
    });
    expect(payload.summary.failed).toBe(0);

    // JSON mode must not interleave decorated text on stdout.
    expect(output.writeln).not.toHaveBeenCalled();
    expect(output.printSuccess).not.toHaveBeenCalled();
    expect(output.printError).not.toHaveBeenCalled();

    // data keeps the same shape callers already rely on.
    expect(result.data).toEqual(payload);
  });

  it('still emits JSON and exits 1 when a check fails (parseable red result for CI)', async () => {
    // swarm_status throwing = system not running -> "System Running" fails.
    vi.mocked(callMCPTool).mockRejectedValue(new Error('ECONNREFUSED'));

    const result = await statusCommand.action!(ctx);

    expect(result.success).toBe(false);
    expect(result.exitCode).toBe(1);

    expect(output.printJson).toHaveBeenCalledTimes(1);
    const payload = vi.mocked(output.printJson).mock.calls[0][0] as {
      checks: Array<{ name: string; status: string }>;
      summary: { passed: number; warned: number; failed: number };
    };
    expect(payload.summary.failed).toBeGreaterThan(0);
    expect(payload.checks.some(c => c.status === 'fail')).toBe(true);
    expect(output.writeln).not.toHaveBeenCalled();
  });

  it('leaves text mode untouched when --format json is absent', async () => {
    mockHealthySystem();
    ctx.flags = { 'health-check': true, _: [] };

    const result = await statusCommand.action!(ctx);

    expect(result.success).toBe(true);
    expect(output.printJson).not.toHaveBeenCalled();
    // The decorated report still renders.
    expect(output.writeln).toHaveBeenCalled();
    expect(output.printSuccess).toHaveBeenCalled();
    expect(result.data).toHaveProperty('checks');
    expect(result.data).toHaveProperty('summary');
  });
});
