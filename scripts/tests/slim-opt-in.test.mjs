import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync, mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { stripTypeScriptTypes } from 'node:module';
import { execFileSync } from 'node:child_process';
const root = new URL('../../', import.meta.url);
const read = p => JSON.parse(readFileSync(new URL(p, root)));

test('umbrella SLIM is an exact optional peer without an automatic installation edge', () => {
  const pkg = read('package.json');
  const lock = read('package-lock.json').packages[''];
  for (const p of [pkg, lock]) {
    assert.equal(p.dependencies?.['@agntcy/slim-bindings'], undefined);
    assert.equal(p.optionalDependencies?.['@agntcy/slim-bindings'], undefined);
    assert.equal(p.peerDependencies?.['@agntcy/slim-bindings'], '2.0.0-alpha.5');
    assert.equal(p.peerDependenciesMeta?.['@agntcy/slim-bindings']?.optional, true);
  }
  assert.equal(read('v3/@claude-flow/cli/package.json').optionalDependencies['@agntcy/slim-bindings'], pkg.peerDependencies['@agntcy/slim-bindings']);
});

test('actual SLIM runtime detection preserves absent, explicit installation and broken import behavior', () => {
  const dir = mkdtempSync(join(tmpdir(), 'ruflo-slim-contract-'));
  try {
    const source = readFileSync(new URL('v3/@claude-flow/cli/src/commands/agntcy/runtime.ts', root), 'utf8');
    writeFileSync(join(dir, 'runtime.mjs'), stripTypeScriptTypes(source));
    const moduleDir = join(dir, 'node_modules', '@agntcy', 'slim-bindings');
    function probe(env, expected) {
      writeFileSync(join(dir, 'probe.mjs'), `import assert from 'node:assert/strict'; import {detectAgntcyRuntime} from './runtime.mjs'; const s=await detectAgntcyRuntime(${JSON.stringify(env)}); assert.equal(s.configured,${expected}); console.log(JSON.stringify(s));`);
      return JSON.parse(execFileSync(process.execPath, [join(dir, 'probe.mjs')], { encoding: 'utf8', env: { ...process.env, NODE_PATH: '', NODE_OPTIONS: '' } }));
    }
    assert.match(probe({}, false).reason, /not set/);
    const env = { RUFLO_AGNTCY_SLIM_ENDPOINT: 'http://127.0.0.1:46357' };
    assert.match(probe(env, false).reason, /not installed/);
    mkdirSync(moduleDir, { recursive: true });
    writeFileSync(join(moduleDir, 'package.json'), JSON.stringify({ name: '@agntcy/slim-bindings', type: 'module', exports: './index.js' }));
    writeFileSync(join(moduleDir, 'index.js'), 'export const fixture = true;');
    assert.match(probe(env, true).reason, /resolved/);
    writeFileSync(join(moduleDir, 'index.js'), 'throw Error("broken native binding");');
    assert.match(probe(env, false).reason, /broken native binding/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('linked MCP retains its compatible Express major despite root overrides', () => {
  const lock = read('package-lock.json').packages;
  const workspace = read('v3/@claude-flow/mcp/package.json');
  assert.match(workspace.dependencies.express, /\^4\./);
  assert.match(lock['v3/@claude-flow/mcp/node_modules/express']?.version ?? '', /^4\./);
  assert.ok(lock['v3/@claude-flow/mcp/node_modules/express'].integrity);
});
