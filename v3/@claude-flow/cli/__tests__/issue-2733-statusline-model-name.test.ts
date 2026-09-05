/**
 * Regression coverage for issue #2733: `hooks statusline`'s model-name
 * resolution was fully hardcoded (`const modelName = 'Opus 4.6 (1M context)'`)
 * and ignored the actual active model Claude Code passes on stdin entirely.
 *
 * The CLI is spawned as a real subprocess (not imported) because the
 * hardcoded value lived inside a large nested function in the command's
 * `action`, not a unit-testable export — the same reasoning documented in
 * memory-search-recall-2558.test.ts for using a real process here. Skipped
 * when the CLI hasn't been built (`bin/cli.js` absent) — standard flow is
 * `npm run build && npm test`.
 */
import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CLI = path.resolve(HERE, '..', 'bin', 'cli.js');
const CLI_BUILT = fs.existsSync(CLI);

function runStatusline(stdin: string): { user: { modelName: string } } {
  const raw = execFileSync('node', [CLI, 'hooks', 'statusline', '--json'], {
    input: stdin,
    encoding: 'utf8',
    timeout: 15_000,
  });
  // The CLI may print unrelated warnings (e.g. helper-integrity notices) to
  // stdout ahead of the JSON payload in some environments; the JSON object
  // itself is always the last well-formed `{...}` block in the output.
  const start = raw.indexOf('{');
  const parsed = JSON.parse(raw.slice(start));
  return parsed;
}

describe.skipIf(!CLI_BUILT)('hooks statusline model name — issue #2733', () => {
  it('reports the real active model from Claude Code stdin JSON', () => {
    const result = runStatusline(JSON.stringify({ model: { display_name: 'Sonnet 4.6 (1M context)' } }));
    expect(result.user.modelName).toBe('Sonnet 4.6 (1M context)');
    expect(result.user.modelName).not.toBe('Opus 4.6 (1M context)');
  });

  it('never renders the old hardcoded model string regardless of stdin', () => {
    const result = runStatusline(JSON.stringify({ model: { display_name: 'Haiku 4.5' } }));
    expect(result.user.modelName).toBe('Haiku 4.5');
  });

  it('falls back to a generic label (not a fixed fake model name) when stdin has no model field', () => {
    const result = runStatusline(JSON.stringify({}));
    expect(result.user.modelName).not.toBe('Opus 4.6 (1M context)');
    expect(result.user.modelName).toBe('Claude Code');
  });

  it('falls back gracefully on malformed stdin', () => {
    const result = runStatusline('not json');
    expect(result.user.modelName).not.toBe('Opus 4.6 (1M context)');
    expect(result.user.modelName).toBe('Claude Code');
  });
});
