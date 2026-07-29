import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';

const HELPER = resolve(__dirname, '../.claude/helpers/intelligence.cjs');

describe('#2818 intelligence helper project-root storage', () => {
  it('writes at CLAUDE_PROJECT_DIR and recovers legacy nested pending insights', () => {
    const root = mkdtempSync(join(tmpdir(), 'ruflo-2818-'));
    const nested = join(root, 'src');
    const legacyDir = join(nested, '.claude-flow', 'data');
    mkdirSync(join(root, '.claude-flow'), { recursive: true });
    mkdirSync(legacyDir, { recursive: true });
    const legacyLine = JSON.stringify({ type: 'edit', file: 'legacy.ts', success: true });
    writeFileSync(join(legacyDir, 'pending-insights.jsonl'), `${legacyLine}\n`, 'utf-8');

    try {
      execFileSync(process.execPath, ['-e', `require(${JSON.stringify(HELPER)}).recordEdit('current.ts', true)`], {
        cwd: nested,
        env: { ...process.env, CLAUDE_PROJECT_DIR: root },
      });
      const rootPending = join(root, '.claude-flow', 'data', 'pending-insights.jsonl');
      expect(existsSync(rootPending)).toBe(true);
      const contents = readFileSync(rootPending, 'utf-8');
      expect(contents).toContain(legacyLine);
      expect(contents).toContain('"file":"current.ts"');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
