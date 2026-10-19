import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdtempSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
// Usage: node harness-guidance-pack-validation.mjs EVIDENCE_DIRECTORY
// Directory must contain baseline/ and candidate/ local npm packs.
// Run build, lint and package tests separately; this validates only the packs.
if (!process.argv[2]) throw new Error('Evidence directory required');
const root = resolve(process.argv[2]);
const archive = side => join(root, side, 'metaharness-harness-0.2.0.tgz');
const sha = value => createHash('sha256').update(value).digest('hex');
const entries = side => execFileSync('tar', ['-tzf', archive(side)], { encoding: 'utf8' }).trim().split('\n').sort();
const bytes = (side, name) => execFileSync('tar', ['-xOzf', archive(side), name]);
const baseline = entries('baseline');
const candidate = entries('candidate');
assert.deepEqual(candidate.filter(x => !baseline.includes(x)), ['package/AGENTS.md']);
assert.deepEqual(baseline.filter(x => !candidate.includes(x)), []);
for (const name of baseline.filter(x => x !== 'package/package.json')) assert.deepEqual(bytes('baseline', name), bytes('candidate', name), name);
const oldManifest = JSON.parse(bytes('baseline', 'package/package.json'));
const newManifest = JSON.parse(bytes('candidate', 'package/package.json'));
assert.deepEqual(newManifest.files, [...oldManifest.files, 'AGENTS.md']);
delete oldManifest.files; delete newManifest.files;
assert.deepEqual(newManifest, oldManifest);
const consumerSource = `
import assert from 'node:assert/strict';
import { HarnessKernel, AlgorithmRouter, AgentPool, VerifierRegistry, predicateVerifier, PolicyGate, allowTools, ReceiptLog } from '@metaharness/harness';
let calls = 0;
const make = allowed => new HarnessKernel({
 router: new AlgorithmRouter({ check: { intent: 'check', steps: [{ kind: 'sum' }] } }),
 pool: new AgentPool([{ id: 'sum', model: 'local-fixture', handles: ['sum'], run: () => { calls++; return { output: 42, quality: 1, confidence: 1, risk: 0, costUsd: 0, latencyMs: 0 }; } }]),
 verifiers: new VerifierRegistry().register(predicateVerifier('answer', 'syntax', x => x === 42)),
 policy: new PolicyGate([allowTools(allowed ? ['sum'] : [])])
});
const pass = await make(true).run({ text: 'sum', intent: 'check' }, 'packed-check');
assert.equal(pass.success, true); assert.equal(pass.result, 42); assert.equal(pass.receiptsValid, true); assert.equal(calls, 1);
const replay = await make(true).run({ text: 'sum', intent: 'check' }, 'packed-check');
assert.deepEqual(replay.receipts, pass.receipts); assert.equal(calls, 2);
const denied = await make(false).run({ text: 'sum', intent: 'check' }, 'packed-denied');
assert.equal(denied.success, false); assert.equal(denied.receiptsValid, true); assert.equal(calls, 2);
const log = ReceiptLog.import(JSON.stringify({ receipts: pass.receipts })); assert.equal(log.verify().ok, true);
const changed = structuredClone(pass.receipts); changed[0].outputHash = '0'.repeat(64);
assert.throws(() => ReceiptLog.import(JSON.stringify({ receipts: changed })), /chain broken/);
console.log(JSON.stringify({ passed: ['esm-import', 'deterministic-arithmetic', 'receipt-replay', 'denied-worker-not-called', 'receipt-tamper-rejected'], workerCalls: calls }));
`;
const consumers = {};
for (const side of ['baseline', 'candidate']) {
 const cwd = mkdtempSync(join(root, side + '-consumer-'));
 writeFileSync(join(cwd, 'package.json'), JSON.stringify({ name: 'packed-harness-validation', private: true, type: 'module' }));
 const start = performance.now();
 const install = execFileSync('npm', ['install', '--ignore-scripts', '--no-audit', '--no-fund', '--cache', join(cwd, 'cache'), archive(side)], { cwd, encoding: 'utf8', timeout: 60000 });
 const installMs = Math.round(performance.now() - start);
 writeFileSync(join(cwd, 'consumer.mjs'), consumerSource);
 const result = JSON.parse(execFileSync(process.execPath, ['consumer.mjs'], { cwd, encoding: 'utf8', timeout: 10000 }));
 consumers[side] = { installMs, installOutput: install.trim(), result };
}
const result = {
 schemaVersion: 1, package: '@metaharness/harness', version: '0.2.0',
 sourceCommit: 'e0dfd44da72b7adfb7c57fdd42d124be58ed7086',
 repository: 'https://github.com/ruvnet/metaharness', directory: 'packages/harness',
 node: process.version, platform: process.platform, arch: process.arch,
 npm: execFileSync('npm', ['--version'], { encoding: 'utf8' }).trim(),
 scriptPolicy: '--ignore-scripts --no-audit --no-fund; independent empty consumer caches',
 baseline: { compressedBytes: statSync(archive('baseline')).size, sha256: sha(readFileSync(archive('baseline'))), files: baseline.length },
 candidate: { compressedBytes: statSync(archive('candidate')).size, sha256: sha(readFileSync(archive('candidate'))), files: candidate.length },
 newFiles: ['AGENTS.md'], guidanceBytes: bytes('candidate', 'package/AGENTS.md').length,
 unchangedPriorNonManifestFiles: baseline.length - 1,
 validationScope: 'pack contents and packed consumers only; source build/lint/tests must be run separately',
 consumers,
 limitations: ['Unsigned local packs, not release acceptance', 'No full workspace Rust/WASM/native or multi-platform release validation', 'Existing published advisory security gate failure is not remediated', 'Local tarball install times are not npm network download benchmarks'],
 rollback: 'Before release, revert only the new package AGENTS.md and package.json files entry; remove shared policy only if no other package references it. No runtime or stored data changes.'
};
result.compressedDeltaBytes = result.candidate.compressedBytes - result.baseline.compressedBytes;
writeFileSync(join(root, 'pack-revalidation.json'), JSON.stringify(result, null, 2) + '\n');
console.log(JSON.stringify(result, null, 2));
