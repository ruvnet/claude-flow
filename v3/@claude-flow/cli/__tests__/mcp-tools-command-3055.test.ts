import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../src/mcp-client.js', () => ({
  listMCPTools: () => [
    { name: 'memory_store', category: 'memory', description: 'Store memory' },
    { name: 'swarm_init', category: 'swarm', description: 'Initialize a swarm' },
    { name: 'agent_spawn', category: 'agent', description: 'Spawn an agent' },
  ],
  callMCPTool: vi.fn(),
  hasTool: vi.fn(),
  getToolMetadata: vi.fn(),
}));

vi.mock('../src/output.js', () => ({
  output: {
    printJson: vi.fn(),
    writeln: vi.fn(),
    bold: (value: string) => value,
    highlight: (value: string) => value,
    printTable: vi.fn(),
    printInfo: vi.fn(),
    success: (value: string) => value,
    dim: (value: string) => value,
  },
}));

import { mcpCommand } from '../src/commands/mcp.js';

const originalSelection = process.env.CLAUDE_FLOW_MCP_TOOLS;

afterEach(() => {
  if (originalSelection === undefined) delete process.env.CLAUDE_FLOW_MCP_TOOLS;
  else process.env.CLAUDE_FLOW_MCP_TOOLS = originalSelection;
});

describe('mcp tools environment filtering (#3055)', () => {
  it('lists only tools selected by CLAUDE_FLOW_MCP_TOOLS', async () => {
    process.env.CLAUDE_FLOW_MCP_TOOLS = 'memory,agent';
    const toolsCommand = mcpCommand.subcommands?.find((command) => command.name === 'tools');
    expect(toolsCommand).toBeDefined();

    const result = await toolsCommand!.action({ flags: { format: 'json' } } as never);
    expect((result.data as Array<{ name: string }>).map((tool) => tool.name))
      .toEqual(['memory_store', 'agent_spawn']);
  });
});
