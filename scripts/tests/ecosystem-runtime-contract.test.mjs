import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

const root = new URL('../../', import.meta.url);
const read = path => JSON.parse(readFileSync(new URL(path, root), 'utf8'));
const runtimeImports = ['@claude-flow/memory', '@ruvector/core', '@ruvector/sona', '@metaharness/weight-eft'];

for (const path of ['package.json', 'v3/@claude-flow/cli/package.json']) {
  test(`${path}: native extensions have direct optional ownership and isolated resolution`, () => {
    const pkg = read(path);
    const dir = mkdtempSync(join(tmpdir(), 'ruflo-dependency-contract-'));
    try {
      // Only direct declared edges get fixture packages. No ancestor node_modules
      // or transitive hoisting can conceal a missing declaration here.
      for (const name of runtimeImports) {
        assert.ok(pkg.optionalDependencies?.[name], `Missing optional edge ${name}`);
        assert.equal(pkg.dependencies?.[name], undefined, `${name} must remain optional`);
        const dest = join(dir, 'node_modules', name);
        mkdirSync(dest, { recursive: true });
        writeFileSync(join(dest, 'package.json'), JSON.stringify({ name, type: 'module', exports: './index.js' }));
        writeFileSync(join(dest, 'index.js'), `export const packageName = ${JSON.stringify(name)};`);
      }
      writeFileSync(join(dir, 'probe.mjs'), `for (const name of ${JSON.stringify(runtimeImports)}) { const m = await import(name); if (m.packageName !== name) throw Error(name); }`);
      const result = spawnSync(process.execPath, [join(dir, 'probe.mjs')], { encoding: 'utf8', env: { ...process.env, NODE_PATH: '' } });
      assert.equal(result.status, 0, result.stderr);
      assert.match(pkg.optionalDependencies['@claude-flow/memory'], /^\d+\.\d+\.\d+$/);
      assert.equal(pkg.optionalDependencies['@metaharness/weight-eft'], '0.1.2');
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
}

test('CLI native extensions match the existing umbrella compatibility minima', () => {
  const umbrella = read('package.json');
  const cli = read('v3/@claude-flow/cli/package.json');
  for (const name of runtimeImports) assert.equal(cli.optionalDependencies[name], umbrella.optionalDependencies[name]);
  const wrapper = read('ruflo/package.json');
  assert.equal(wrapper.dependencies['@claude-flow/cli'], cli.version);
});
