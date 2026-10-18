#!/usr/bin/env node
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { createConnectivityIndex } from './lib/ecosystem-connectivity.mjs';
import { analyzeWithRuVector } from './lib/ecosystem-ruvector.mjs';
import { applyRuntimeRelationships } from './lib/ecosystem-runtime-relationships.mjs';

export const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
export async function analyzeEcosystem({ input, runtime, resolveFrom, changed = ['metaharness', '@ruvector/core', '@claude-flow/memory'], benchmarkRuns = 21 }) {
  const bytes = await readFile(input), snapshot = JSON.parse(bytes);
  const raw = createConnectivityIndex(snapshot);
  let parityQueries = 0;
  for (const [mode, field] of [['required', 'reverseImpact'], ['capabilities', 'capabilityReverseImpact']]) {
    if (!snapshot[field]) throw new Error(`Missing snapshot impact oracle: ${field}`);
    for (const node of snapshot.nodes) {
      const expected = [...new Set([node.name, ...snapshot[field][node.name]])].sort();
      assert.deepEqual(raw.planChanges([node.name], { mode }).affected, expected, `Impact parity: ${mode}/${node.name}`);
      parityQueries++;
    }
  }
  const overlay = runtime ? JSON.parse(await readFile(runtime, 'utf8')) : null;
  const enriched = overlay ? applyRuntimeRelationships(snapshot, overlay, sha256(bytes)) : snapshot;
  const index = createConnectivityIndex(enriched);
  const require = createRequire(resolve(resolveFrom));
  const entry = require.resolve('ruvector');
  let directory = dirname(entry), manifest;
  for (;;) {
    try { const candidate = JSON.parse(await readFile(join(directory, 'package.json'))); if (candidate.name === 'ruvector') { manifest = candidate; break; } } catch {}
    const parent = dirname(directory); if (parent === directory) throw new Error('Cannot resolve RuVector manifest'); directory = parent;
  }
  if (manifest.version !== '0.2.41') throw new Error(`Expected pinned RuVector 0.2.41; received ${manifest.version}`);
  const options = { importer: async () => require('ruvector'), version: manifest.version, benchmarkRuns };
  const declarations = await analyzeWithRuVector(snapshot, options);
  const required = await analyzeWithRuVector(snapshot, { ...options, requiredOnly: true });
  const runtimeGraph = overlay ? await analyzeWithRuVector(enriched, options) : null;
  const plans = changed.map(name => {
    const before = raw.planChanges([name], { mode: 'capabilities' });
    const after = index.planChanges([name], { mode: 'capabilities' });
    return { ...after, previouslyAffected: before.affected, newlyIncluded: after.affected.filter(n => !before.affected.includes(n)), selectedPackageCount: after.affected.length, inventoryCount: snapshot.nodes.length, scopeReductionPercent: Number((100 * (1 - after.affected.length / snapshot.nodes.length)).toFixed(2)), scopeMeaning: 'Package candidates for targeted regression; not proof of test coverage or measured execution speedup.' };
  });
  return { schema: 'ruflo-ecosystem-analysis/v1', capturedAt: new Date().toISOString(), sourceSnapshotSha256: sha256(bytes), runtimeEvidenceSha256: runtime ? sha256(await readFile(runtime)) : null,
    engine: { package: 'ruvector', version: manifest.version, entrySha256: sha256(await readFile(entry)), graphAlgorithmsSha256: sha256(await readFile(join(directory, 'dist/core/graph-algorithms.js'))), nativeAcceleration: false },
    analysisSourceSha256: Object.fromEntries(await Promise.all(['analyze-ecosystem.mjs', 'lib/ecosystem-connectivity.mjs', 'lib/ecosystem-ruvector.mjs', 'lib/ecosystem-runtime-relationships.mjs'].map(async path => [path, sha256(await readFile(new URL(path, import.meta.url)))]))),
    validation: { parityQueries, exactImpactAgreement: true, releaseAuthorized: false, runtimeIntegrationCoverage: 'Not established by graph analysis' },
    declarations: { topology: raw.analyze(), cuts: declarations, requiredCuts: required },
    runtime: overlay ? { relationshipCount: overlay.relationships.length, topology: index.analyze(), cuts: runtimeGraph, unresolved: overlay.unresolved, findings: overlay.findings ?? [] } : null,
    plans };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2), opts = { input: 'data/npm-dependencies.latest.json', runtime: 'data/npm-runtime-relationships.latest.json', resolveFrom: 'v3/@claude-flow/cli/package.json' };
  let output = 'data/npm-connectivity.latest.json';
  for (let i = 0; i < args.length; i++) {
    const key = args[i], value = args[++i];
    if (!value) throw new Error(`Missing value for ${key}`);
    if (key === '--input') opts.input = value;
    else if (key === '--runtime') opts.runtime = value === 'none' ? null : value;
    else if (key === '--ruvector-from') opts.resolveFrom = value;
    else if (key === '--output') output = value;
    else if (key === '--changed') (opts.changed ??= []).push(value);
    else throw new Error(`Unknown option ${key}`);
  }
  const result = await analyzeEcosystem(opts);
  await writeFile(output, `${JSON.stringify(result, null, 2)}\n`);
  console.log(JSON.stringify({ output, packages: result.declarations.topology.nodeCount, parityQueries: result.validation.parityQueries, declaredIsolates: result.declarations.topology.capabilities.trueIsolates.length, runtimeIsolates: result.runtime?.topology.capabilities.trueIsolates.length }));
}
