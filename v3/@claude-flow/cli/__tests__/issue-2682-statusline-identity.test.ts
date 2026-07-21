/** Regression coverage for issue #2682: the default statusline identity is
 * the current project, while author display remains an explicit opt-in. */
import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { generateStatuslineScript } from '../src/init/statusline-generator.js';
import { DEFAULT_INIT_OPTIONS } from '../src/init/types.js';

const SCRIPT = generateStatuslineScript(DEFAULT_INIT_OPTIONS);
const stripAnsi = (value: string) => value.replace(/\x1b\[[0-9;]*m/g, '');

describe('statusline identity — issue #2682', () => {
  it('renders the project directory name by default without requiring git', () => {
    const parent = mkdtempSync(path.join(tmpdir(), 'ruflo-identity-'));
    const cwd = path.join(parent, 'my-ruflo-project');
    const script = path.join(parent, 'statusline.cjs');
    mkdirSync(cwd);
    writeFileSync(script, SCRIPT, 'utf8');
    try {
      const output = execFileSync(process.execPath, [script], {
        cwd,
        input: JSON.stringify({ model: { display_name: 'Codex' } }),
        encoding: 'utf8',
        env: { PATH: '/nonexistent', HOME: parent },
        timeout: 15_000,
      });
      expect(stripAnsi(output).split('\n')[0]).toContain('my-ruflo-project');
    } finally {
      rmSync(parent, { recursive: true, force: true });
    }
  });

  it('documents and implements the author compatibility opt-in', () => {
    expect(SCRIPT).toContain('RUFLO_STATUSLINE_IDENTITY');
    expect(SCRIPT).toContain("CONFIG.identityMode === 'author'");
    expect(SCRIPT).toContain("git config user.name");
  });
});
