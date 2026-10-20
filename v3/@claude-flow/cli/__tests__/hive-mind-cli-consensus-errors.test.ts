import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const printed = vi.hoisted(() => ({ printJson: vi.fn(), printSuccess: vi.fn(), printError: vi.fn() }));
vi.mock('../src/output.js', () => ({ output: printed }));
vi.mock('../src/prompt.js', () => ({ select: vi.fn(), confirm: vi.fn(), input: vi.fn() }));
vi.mock('../src/mcp-client.js', async () => {
  const { hiveMindTools } = await import('../src/mcp-tools/hive-mind-tools.js');
  return {
    MCPClientError: class extends Error {},
    callMCPTool: async (name: string, input: Record<string, unknown>) => {
      const tool = hiveMindTools.find(tool => tool.name === name);
      if (!tool) throw new Error(`Unexpected tool: ${name}`);
      return tool.handler(input);
    },
  };
});
import { hiveMindCommand } from '../src/commands/hive-mind.js';
import { hiveMindTools } from '../src/mcp-tools/hive-mind-tools.js';
import type { CommandContext } from '../src/types.js';

// Only the MCP dispatch seam and output presentation are replaced. The real
// command action calls the real hive handler, which reads/writes disposable files.
function tool(name: string) { return hiveMindTools.find(tool => tool.name === name)!; }
const consensus = hiveMindCommand.subcommands!.find(command => command.name === 'consensus')!;
describe('CLI consensus outcomes reflect actual persisted hive state', () => {
  let dir: string;
  let previous: string | undefined;
  let token: string;
  let proposalId: string;
  function bytes() { return readFileSync(join(dir, '.claude-flow/hive-mind/state.json'), 'utf8'); }
  function run(flags: Record<string, unknown>) {
    return consensus.action!({ args: [], flags, raw: [], cwd: dir } as unknown as CommandContext);
  }
  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), 'ruflo-cli-consensus-'));
    previous = process.env.CLAUDE_FLOW_CWD;
    process.env.CLAUDE_FLOW_CWD = dir;
    vi.clearAllMocks();
    const init = await tool('hive-mind_init').handler({ consensus: 'quorum' }) as Record<string, unknown>;
    token = init.hiveToken as string;
    for (const agentId of ['worker-1', 'worker-2', 'worker-3']) {
      await tool('hive-mind_join').handler({ agentId, hiveToken: token });
    }
    const proposal = await tool('hive-mind_consensus').handler({ action: 'propose', type: 'design', value: 'use-jwt' }) as Record<string, unknown>;
    proposalId = proposal.proposalId as string;
  });
  afterEach(() => {
    if (previous === undefined) delete process.env.CLAUDE_FLOW_CWD;
    else process.env.CLAUDE_FLOW_CWD = previous;
    rmSync(dir, { recursive: true, force: true });
  });
  it('JSON vote denial returns failure and leaves real state byte-identical', async () => {
    const before = bytes();
    const result = await run({ action: 'vote', proposalId, voterId: 'outsider', vote: 'yes', format: 'json' });
    expect(result.success).toBe(false);
    expect(result.exitCode).toBe(1);
    expect(printed.printJson).toHaveBeenCalledWith(expect.objectContaining({ error: expect.stringContaining('not a registered') }));
    expect(bytes()).toBe(before);
  });
  it('human vote denial prints its reason without a false success message', async () => {
    const before = bytes();
    const result = await run({ action: 'vote', proposalId, voterId: 'outsider', vote: 'yes' });
    expect(result.success).toBe(false);
    expect(printed.printSuccess).not.toHaveBeenCalled();
    expect(printed.printError).toHaveBeenCalledWith(expect.stringContaining('not a registered'));
    expect(bytes()).toBe(before);
  });
  it('missing proposal is a failed command, not a vote receipt', async () => {
    const before = bytes();
    const result = await run({ action: 'vote', proposalId: 'missing', voterId: 'worker-1', vote: 'yes' });
    expect(result.success).toBe(false);
    expect(printed.printSuccess).not.toHaveBeenCalled();
    expect(bytes()).toBe(before);
  });
  it('duplicate votes fail while preserving the already recorded vote', async () => {
    await run({ action: 'vote', proposalId, voterId: 'worker-1', vote: 'yes', format: 'json' });
    const before = bytes();
    const result = await run({ action: 'vote', proposalId, voterId: 'worker-1', vote: 'yes', format: 'json' });
    expect(result.success).toBe(false);
    expect(result.exitCode).toBe(1);
    expect(bytes()).toBe(before);
  });
  it('accepted worker vote remains successful and actually persists', async () => {
    const result = await run({ action: 'vote', proposalId, voterId: 'worker-1', vote: 'yes' });
    expect(result.success).toBe(true);
    const state = JSON.parse(bytes());
    expect(state.consensus.pending[0].votes['worker-1']).toBe(true);
    expect(printed.printSuccess).toHaveBeenCalledWith('Vote recorded (For: 1, Against: 0)');
  });
  it('successful JSON status remains a successful read without a write', async () => {
    const before = bytes();
    const result = await run({ action: 'status', proposalId, format: 'json' });
    expect(result.success).toBe(true);
    expect(printed.printJson).toHaveBeenCalled();
    expect(bytes()).toBe(before);
  });
});
