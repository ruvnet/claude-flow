import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { CommandContext } from '../src/types.js';

vi.mock('../src/output.js', () => ({ output: new Proxy({}, {
  get: (_target, name) => name === 'createSpinner'
    ? () => ({ start() {}, succeed() {}, stop() {}, fail() {} })
    : vi.fn((value) => value),
}) }));
vi.mock('../src/prompt.js', () => ({ select: vi.fn(), confirm: vi.fn(), input: vi.fn() }));
vi.mock('../src/mcp-client.js', () => ({ callMCPTool: vi.fn(), MCPClientError: class extends Error {} }));
vi.mock('../src/commands/transfer-store.js', () => ({ storeCommand: {} }));
vi.mock('../src/funnel/local-signals.js', () => ({
  getSecurityStatus: vi.fn(), getSwarmStatus: vi.fn(), getGitUncommittedCount: vi.fn(),
}));
import { hooksCommand } from '../src/commands/hooks.js';
import { callMCPTool } from '../src/mcp-client.js';

const cwd = process.cwd();
let root: string;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'hooks-coverage-disk-'));
  process.chdir(root);
  mkdirSync('coverage');
  vi.mocked(callMCPTool).mockReset();
});
afterEach(() => { process.chdir(cwd); rmSync(root, { recursive: true, force: true }); });

async function run(name: string, flags: Record<string, unknown> = {}) {
  const command = hooksCommand.subcommands!.find(c => c.name === name)!;
  return command.action!({ flags: { format: 'json', ...flags }, args: [] } as unknown as CommandContext);
}

describe('coverage hooks disk integration (#4082–#4084)', () => {
  it('does not route or suggest tests for empty instrumented files', async () => {
    const metric = { total: 0, covered: 0, pct: 'Unknown' };
    const empty = { lines: metric, branches: metric, functions: metric, statements: metric };
    writeFileSync('coverage/coverage-summary.json', JSON.stringify({ total: empty, 'src/empty.ts': empty }));
    const gaps = await run('coverage-gaps');
    expect(gaps).toMatchObject({ success: true, data: { gaps: [], summary: { overallLineCoverage: 100 } } });
    const route = await run('coverage-route', { task: 'write tests for empty' });
    expect(route).toMatchObject({ success: true, data: { gaps: [], metrics: { avgCoverage: 100 } } });
    const suggest = await run('coverage-suggest', { path: 'src/empty.ts' });
    expect(suggest.success).toBe(true);
    expect(callMCPTool).not.toHaveBeenCalled();
  });
  it('propagates weighted LCOV totals to gaps and routing', async () => {
    writeFileSync('coverage/lcov.info', 'SF:large.ts\nLF:100\nLH:10\nBRF:100\nBRH:10\nend_of_record\nSF:small.ts\nLF:1\nLH:1\nBRF:1\nBRH:1\nend_of_record\n');
    const gaps = await run('coverage-gaps');
    expect((gaps.data as any).summary.overallLineCoverage).toBeCloseTo(1100 / 101);
    expect((gaps.data as any).summary.overallBranchCoverage).toBeCloseTo(1100 / 101);
    const route = await run('coverage-route', { task: 'write tests' });
    expect((route.data as any).metrics.avgCoverage).toBeCloseTo(1100 / 101);
    expect(callMCPTool).not.toHaveBeenCalled();
  });
  it('reads Istanbul final counters through every coverage hook without MCP fallback', async () => {
    writeFileSync('coverage/coverage-final.json', JSON.stringify({ 'src/auth.ts': {
      s: { 0: 1, 1: 0 }, f: { 0: 0 }, b: { 0: [1, 0] },
      statementMap: { 0: { start: { line: 1 } }, 1: { start: { line: 2 } } },
    } }));
    for (const name of ['coverage-gaps', 'coverage-route', 'coverage-suggest']) {
      const result = await run(name, { task: 'test auth', path: 'src/auth.ts' });
      expect(result.success).toBe(true);
      expect((result.data as any).source).toBe('coverage/coverage-final.json');
    }
    expect(callMCPTool).not.toHaveBeenCalled();
  });
  it("clamps impossible LCOV counts so a corrupt report cannot exceed 100% or go negative", async () => {
    writeFileSync("coverage/lcov.info", "SF:over.ts\nLF:10\nLH:99\nBRF:4\nBRH:-3\nend_of_record\n");
    const gaps = await run("coverage-gaps");
    const summary = (gaps.data as any).summary;
    expect(summary.overallLineCoverage).toBe(100);
    expect(summary.overallBranchCoverage).toBe(0);
  });
  it("ignores a coverage report larger than the size cap instead of loading it into memory", async () => {
    const valid = "SF:big.ts\nLF:10\nLH:10\nend_of_record\n";
    writeFileSync("coverage/lcov.info", Buffer.concat([Buffer.from(valid), Buffer.alloc(65 * 1024 * 1024, 0x20)]));
    writeFileSync("coverage/coverage-final.json", JSON.stringify({ "src/x.ts": {
      s: { 0: 1 }, f: {}, b: {}, statementMap: { 0: { start: { line: 1 } } } } }));
    const gaps = await run("coverage-gaps");
    expect((gaps.data as any).source).toBe("coverage/coverage-final.json");
  });
});
