import { describe, expect, it } from 'vitest';
import { DEFAULT_INIT_OPTIONS } from '../src/init/types.js';
import { generateSettings } from '../src/init/settings-generator.js';

describe('generated hook settings', () => {
  it('only wires commands implemented by hook-handler.cjs', () => {
    const settings = generateSettings(DEFAULT_INIT_OPTIONS) as {
      hooks: Record<string, Array<{ hooks: Array<{ command: string }> }>>;
    };
    const hooks = settings.hooks;
    const commands = Object.values(hooks)
      .flatMap((groups) => groups.flatMap((group) => group.hooks.map((hook) => hook.command)));

    for (const unsupported of ['pre-edit', 'post-bash', 'compact-manual', 'compact-auto', 'status', 'notify']) {
      expect(commands.some((command) => command.endsWith(` ${unsupported}`))).toBe(false);
    }
    expect(hooks.PreToolUse).toBeDefined();
    expect(hooks.PostToolUse).toBeDefined();
    expect(hooks.PreCompact).toBeDefined();
    expect(commands.some((command) => command.endsWith(' pre-bash'))).toBe(true);
    expect(commands.some((command) => command.endsWith(' post-edit'))).toBe(true);
    expect(commands.some((command) => command.endsWith(' session-end'))).toBe(true);
  });
});
