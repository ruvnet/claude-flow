/** #3888: .claude/settings.json template must be valid JSON. */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const SETTINGS_PATH = join(__dirname, '..', '.claude', 'settings.json');

describe('#3888 settings.json template', () => {
  it('parses as valid JSON', () => {
    const raw = readFileSync(SETTINGS_PATH, 'utf8');
    expect(() => JSON.parse(raw)).not.toThrow();
  });

  it('preserves shell-level quoting around $CLAUDE_PROJECT_DIR after JSON parsing', () => {
    const settings = JSON.parse(readFileSync(SETTINGS_PATH, 'utf8'));
    const command = settings.hooks.PreToolUse[0].hooks[0].command as string;
    expect(command).toContain('"$CLAUDE_PROJECT_DIR');
    expect(command).toBe('node "$CLAUDE_PROJECT_DIR/.claude/helpers/hook-handler.cjs" pre-bash');
  });
});
