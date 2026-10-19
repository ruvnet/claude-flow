import assert from 'node:assert/strict';
import * as nodeModule from 'node:module';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import test from 'node:test';

// Load the actual adapter in a pristine directory, outside the workspace's
// dependency resolution tree. No native binding or host keychain is touched.
async function loadIsolatedAdapter(t) {
  const dir = await mkdtemp(join(tmpdir(), 'optional-keychain-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const source = await readFile(new URL('../../v3/@claude-flow/security/src/keychain-adapter.ts', import.meta.url), 'utf8');
  const js = typeof nodeModule.stripTypeScriptTypes === 'function'
    ? nodeModule.stripTypeScriptTypes(source)
    : (() => {
      const ts = nodeModule.createRequire(import.meta.url)('typescript');
      return ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 } }).outputText;
    })();
  await writeFile(join(dir, 'adapter.mjs'), js);
  await assert.rejects(import(pathToFileURL(join(dir, 'node_modules/@napi-rs/keyring/index.js')).href), { code: 'ERR_MODULE_NOT_FOUND' });
  return import(pathToFileURL(join(dir, 'adapter.mjs')).href);
}

test('absent optional native binding selects a functional session-only secret store', async t => {
  const { createKeychainAdapter, SessionOnlyKeychainAdapter } = await loadIsolatedAdapter(t);
  const adapter = await createKeychainAdapter();
  assert.ok(adapter instanceof SessionOnlyKeychainAdapter);
  assert.equal(await adapter.isAvailable(), true);
  await adapter.setSecret('service', 'account', 'ephemeral');
  assert.equal(await adapter.getSecret('service', 'account'), 'ephemeral');
  await adapter.deleteSecret('service', 'account');
  assert.equal(await adapter.getSecret('service', 'account'), null);
});

test('session-only fallback never persists secrets between adapter instances', async t => {
  const { createKeychainAdapter } = await loadIsolatedAdapter(t);
  const first = await createKeychainAdapter();
  await first.setSecret('service', 'account', 'ephemeral');
  const next = await createKeychainAdapter();
  assert.equal(await next.getSecret('service', 'account'), null);
});
