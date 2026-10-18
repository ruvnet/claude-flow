import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { inventoryNames, buildDependencyGraph } from '../lib/ecosystem-dependency-graph.mjs';
import { collectManifests, main } from '../collect-ecosystem-dependencies.mjs';
const inventory = { packages: [{ package: 'app' }, { package: 'memory' }, { package: 'core' }] };
const manifest = (name, rest = {}) => ({ name, version: '1.2.3', ...rest });

test('deduplicates inventory and includes explicitly unavailable packages', () => {
  assert.deepEqual(inventoryNames({ packages: [{ package: 'a' }, 'a'], unavailable_packages: ['@scope/missing'] }), ['@scope/missing', 'a']);
  assert.throws(() => inventoryNames({ packages: ['https://evil.example/pkg'] }), /Invalid/);
});
test('models typed edges, optional overrides, pinned evidence and leaf-first order', () => {
  const graph = buildDependencyGraph(inventory, {
    app: manifest('app', { dependencies: { memory: '^1', core: '^1', external: '^2' }, optionalDependencies: { core: '^2' }, peerDependencies: { core: '^1' }, peerDependenciesMeta: { core: { optional: true } }, gitHead: 'abc', dist: { integrity: 'sha512-example', attestations: { url: 'https://example.invalid/provenance' } } }),
    memory: manifest('memory', { dependencies: { core: '^1' } }), core: manifest('core'),
  });
  assert.equal(graph.edges.filter(e => e.source === 'app' && e.target === 'core' && e.type === 'dependency').length, 0);
  assert.equal(graph.edges.find(e => e.type === 'peer').optionalPeer, true);
  assert.equal(graph.edges.find(e => e.target === 'external').internal, false);
  assert.deepEqual(graph.releaseOrder, ['core', 'memory', 'app']);
  assert.deepEqual(graph.reverseImpact.core, ['app', 'memory']);
  assert.equal(graph.nodes[0].integrity, 'sha512-example');
  assert.equal(graph.nodes[0].gitHead, 'abc');
  assert.match(graph.nodes[0].registryUrl, /\/1.2.3$/);
  assert.equal(graph.releaseReady, true);
});
test('rejects hard cycles, preserves capability cycles without blocking release', () => {
  const manifests = { app: manifest('app', { dependencies: { memory: '^1' } }), memory: manifest('memory', { dependencies: { app: '^1' } }), core: manifest('core', { dependencies: { core: '^1' } }) };
  const graph = buildDependencyGraph(inventory, manifests);
  assert.deepEqual(graph.hardCycles, [['app', 'memory'], ['core']]);
  assert.equal(graph.releaseOrder, null);
  manifests.memory = manifest('memory', { peerDependencies: { app: '^1' }, peerDependenciesMeta: { app: { optional: true } } });
  manifests.core = manifest('core');
  const optional = buildDependencyGraph(inventory, manifests);
  assert.equal(optional.hardDependenciesAcyclic, true);
  assert.deepEqual(optional.capabilityReverseImpact.app, ['memory']);
});
test('incomplete or spoofed registry identity never produces a release plan', () => {
  const graph = buildDependencyGraph(inventory, { app: manifest('other'), memory: manifest('memory') }, { errors: { core: 'registry HTTP 404' } });
  assert.deepEqual(graph.missing, ['app', 'core']);
  assert.equal(graph.releaseReady, false);
  assert.equal(graph.releaseOrder, null);
  assert.equal(graph.nodes.find(n => n.name === 'core').reason, 'registry HTTP 404');
});
test('collector bounds concurrency and only requests fixed public registry URLs', async () => {
  let active = 0, peak = 0;
  const { manifests, errors } = await collectManifests(['a', '@scope/b', 'c', 'd'], { concurrency: 2, fetchImpl: async (url, options) => {
    assert.equal(new URL(url).origin, 'https://registry.npmjs.org');
    assert.equal(options.redirect, 'error');
    assert.equal(Object.keys(options.headers).length, 1);
    active++; peak = Math.max(peak, active);
    await new Promise(resolve => setTimeout(resolve, 4)); active--;
    const name = decodeURIComponent(new URL(url).pathname.slice(1, -7));
    return { ok: name !== 'c', status: 404, json: async () => manifest(name) };
  } });
  assert.equal(peak, 2);
  assert.equal(manifests['@scope/b'].name, '@scope/b');
  assert.equal(errors.c, 'registry HTTP 404');
  await assert.rejects(collectManifests(['a'], { concurrency: 100 }), /concurrency/);
});
test('collector records thrown failures without claiming success', async () => {
  const result = await collectManifests(['a'], { fetchImpl: async () => { throw new DOMException('timeout', 'TimeoutError'); } });
  assert.equal(result.errors.a, 'registry request timed out');
  assert.equal(result.manifests.a, null);
});
test('offline CLI fixture emits graph and returns nonzero for cycle or required completeness', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'ruflo-dependency-test-'));
  try {
    const input = join(directory, 'fixture.json'), output = join(directory, 'graph.json');
    await writeFile(input, JSON.stringify({ inventory: { packages: ['a'] }, manifests: { a: manifest('a', { dependencies: { a: '*' } }) }, capturedAt: '2026-10-18T00:00:00Z' }));
    assert.equal(await main(['--input', input, '--output', output]), 1);
    assert.equal(JSON.parse(await readFile(output)).capturedAt, '2026-10-18T00:00:00Z');
    await writeFile(input, JSON.stringify({ inventory: { packages: ['a'] }, manifests: {} }));
    assert.equal(await main(['--input', input, '--output', output, '--require-complete']), 2);
  } finally { await rm(directory, { recursive: true, force: true }); }
});
