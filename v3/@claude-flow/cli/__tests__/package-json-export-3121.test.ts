// #3121: `require('@claude-flow/cli/package.json')` threw ERR_PACKAGE_PATH_NOT_EXPORTED on Node 22+
// because the exports map had no "./package.json" entry. Resolution runs in a child Node process from
// the package root, so the package self-reference goes through the real exports map (not Vite aliases).

import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const pkgRoot = resolve(__dirname, '..');
const pkg = JSON.parse(readFileSync(resolve(pkgRoot, 'package.json'), 'utf8'));

function runNode(args: string[]) {
  return spawnSync(process.execPath, args, { cwd: pkgRoot, encoding: 'utf8' });
}

describe('@claude-flow/cli exports ./package.json (#3121)', () => {
  it('CommonJS require of the package.json subpath returns the manifest', () => {
    const r = runNode(['-e', "process.stdout.write(require('@claude-flow/cli/package.json').version)"]);
    expect(r.stderr).not.toMatch(/ERR_PACKAGE_PATH_NOT_EXPORTED/);
    expect(r.status).toBe(0);
    expect(r.stdout).toBe(pkg.version);
  });

  it('ESM import of the package.json subpath (with type: json) returns the manifest', () => {
    const r = runNode([
      '--input-type=module',
      '-e',
      "const m = await import('@claude-flow/cli/package.json', { with: { type: 'json' } }); process.stdout.write(m.default.name)",
    ]);
    expect(r.stderr).not.toMatch(/ERR_PACKAGE_PATH_NOT_EXPORTED/);
    expect(r.status).toBe(0);
    expect(r.stdout).toBe('@claude-flow/cli');
  });

  it('keeps the existing subpaths exported (control)', () => {
    expect(Object.keys(pkg.exports)).toEqual(
      expect.arrayContaining(['.', './dist/*', './mcp-tools', './memory', './intelligence', './ruvector', './ruvector/*']),
    );
  });
});
