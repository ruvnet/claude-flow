import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DEFAULT_INIT_OPTIONS, MINIMAL_INIT_OPTIONS } from '../src/init/types.js';
import { generateSettingsJson } from '../src/init/settings-generator.js';
import { executeUpgrade, mergeSettingsForUpgrade } from '../src/init/executor.js';

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

const broadHelperPermission = 'Bash(node .claude/*)';

describe('#4205 generated helper permissions', () => {
  it.each([
    ['standard', DEFAULT_INIT_OPTIONS],
    ['minimal', MINIMAL_INIT_OPTIONS],
  ] as const)('%s settings do not pre-authorize arbitrary project scripts', (_name, options) => {
    const settings = JSON.parse(generateSettingsJson(options));
    expect(settings.permissions.allow).not.toContain(broadHelperPermission);
    expect(settings.permissions.allow).toContain('mcp__claude-flow__*');
    expect(settings.permissions.deny).toContain('Read(./.env)');
    if (options.components.helpers) {
      expect(settings.hooks.SessionStart[0].hooks[0].command).toContain('hook-handler.cjs');
    }
  });

  it('creates upgrade settings without adding a blanket helper permission', async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'ruflo-4205-'));
    roots.push(cwd);
    const result = await executeUpgrade(cwd, true);
    expect(result.success).toBe(true);
    const settings = JSON.parse(readFileSync(join(cwd, '.claude', 'settings.json'), 'utf-8'));
    expect(settings.permissions.allow).not.toContain(broadHelperPermission);
    expect(settings.hooks.SessionStart[0].hooks[0].command).toContain('hook-handler.cjs');
  });

  it('preserves explicit permissions already present in user settings during upgrade', () => {
    const permissions = { allow: [broadHelperPermission, 'Bash(npm test)'], deny: ['Read(private/**)'] };
    const { merged } = mergeSettingsForUpgrade({ permissions });
    expect(merged.permissions).toEqual(permissions);
  });
});
