/** #3888: every settings/manifest JSON file the repo ships must parse. */
import { describe, expect, it } from 'vitest';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const REPO = join(__dirname, '..', '..', '..', '..');

function shippedJsonFiles(): string[] {
  const files = [
    join(REPO, '.claude', 'settings.json'),
    join(REPO, 'v3', '@claude-flow', 'cli', '.claude', 'settings.json'),
    join(REPO, 'v3', '@claude-flow', 'mcp', '.claude', 'settings.json'),
  ];
  const pluginsDir = join(REPO, 'plugins');
  if (existsSync(pluginsDir)) {
    for (const p of readdirSync(pluginsDir)) {
      files.push(join(pluginsDir, p, '.claude-plugin', 'plugin.json'));
      files.push(join(pluginsDir, p, 'hooks', 'hooks.json'));
      files.push(join(pluginsDir, p, '.mcp.json'));
    }
  }
  return files.filter((f) => existsSync(f));
}

describe('#3888 shipped JSON files parse', () => {
  const files = shippedJsonFiles();
  it('finds the shipped settings files', () => {
    expect(files.length).toBeGreaterThanOrEqual(3);
  });
  it.each(files)('%s is valid JSON', (file) => {
    expect(() => JSON.parse(readFileSync(file, 'utf8'))).not.toThrow();
  });
});
