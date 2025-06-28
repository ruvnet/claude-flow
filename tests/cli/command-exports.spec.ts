import { describe, expect, it } from '@jest/globals';

const commandFiles = [
  'src/cli/commands/claude.ts',
  'src/cli/commands/config.ts',
  'src/cli/commands/mcp.ts',
  'src/cli/commands/memory.ts',
  'src/cli/commands/session.ts',
  'src/cli/commands/workflow.ts',
];

describe('CLI command wiring', () => {
  it.each(commandFiles)('%s must export a Command instance', async (file) => {
    const { Command } = await import('@cliffy/command');
    const mod = await import(`../../${file}`);
    const exported = Object.values(mod).find((v) => v instanceof Command);
    expect(exported).toBeTruthy();
  });
});