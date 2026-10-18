import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import * as nodeModule from 'node:module';

const required = process.env.RUFLO_WEIGHT_EFT_REQUIRED === '1';
const resolveFrom = process.env.RUFLO_WEIGHT_EFT_RESOLVE_FROM;
const require = nodeModule.createRequire(resolveFrom ? pathToFileURL(resolveFrom) : import.meta.url);
let entry;
try {
  // Package is import-only; CommonJS require.resolve would reject its exports.
  entry = fileURLToPath(execFileSync(process.execPath, ['--input-type=module', '-e',
    "process.stdout.write(import.meta.resolve('@metaharness/weight-eft'))"], {
    cwd: resolveFrom ? dirname(resolveFrom) : dirname(fileURLToPath(import.meta.url)),
    encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
  }));
} catch (err) { if (required) throw err; }

test('installed weight EFT exports real SFT/DPO, excludes holdout, plans and evaluates', { skip: !entry && 'Install optional @metaharness/weight-eft; RUFLO_WEIGHT_EFT_REQUIRED=1 makes absence fail' }, async () => {
  assert.ok(entry, 'required optional package must resolve');
  const pkg = JSON.parse(readFileSync(join(dirname(entry), '..', 'package.json'), 'utf8'));
  assert.equal(pkg.name, '@metaharness/weight-eft');
  assert.equal(pkg.version, '0.1.2');
  const realApi = await import(pathToFileURL(entry).href);
  const importer = async () => realApi;
  const source = readFileSync(new URL('../../v3/@claude-flow/cli/src/services/weight-eft.ts', import.meta.url), 'utf8');
  const dir = mkdtempSync(join(tmpdir(), 'ruflo-weight-eft-installed-'));
  try {
    const js = typeof nodeModule.stripTypeScriptTypes === 'function'
      ? nodeModule.stripTypeScriptTypes(source)
      : require('typescript').transpileModule(source, { compilerOptions: { target: 9, module: 7 } }).outputText;
    writeFileSync(join(dir, 'service.mjs'), js);
    const service = await import(pathToFileURL(join(dir, 'service.mjs')).href);
    assert.equal(await service.loadWeightEft(importer), realApi, 'real API must pass all five function checks');
    const messages = [
      { role: 'system', content: 'You are a coding agent.' },
      { role: 'user', content: 'Fix the null dereference in cache.ts' },
      { role: 'assistant', content: 'Here is the patch.' },
    ];
    const record = { v: 1, ts: '2026-10-18T00:00:00Z', instance_id: 'inst-dpo', task_hash: 'fixture', model: 'z-ai/glm-5.2', tier: 'cheap', resolved: true, resolved_source: 'api-success', messages, model_patch: 'diff --git a/cache.ts b/cache.ts\n+ if (x) return;', sample: 0, source: 'regression-fixture' };
    const { trajectories, proxyNote } = service.buildArchiveFromRecords([
      record,
      { ...record, sample: 1, resolved: false, model_patch: '', messages: [...messages.slice(0, 2), { role: 'assistant', content: 'I could not solve it.' }] },
      { ...record, instance_id: 'held' },
    ]);
    assert.match(proxyNote, /PROXY/);
    const exported = await service.runExport({ archive: trajectories, evalHoldout: ['held'], importer });
    assert.equal(exported.degraded, false, exported.reason);
    assert.ok(exported.sftRows >= 1);
    assert.ok(exported.dpoRows >= 1);
    assert.equal(exported.report.excludedByHoldout, 1);
    assert.ok(!exported.report.sftInstanceIds.includes('held'));
    assert.ok(JSON.parse(exported.sftJsonl.trim().split('\n')[0]).messages);
    const preference = JSON.parse(exported.dpoJsonl.trim().split('\n')[0]);
    assert.ok(preference.chosen);
    assert.ok(preference.rejected);
    const plan = await service.runPlan({ sftPath: '/tmp/sft.jsonl', dpoPath: '/tmp/dpo.jsonl', importer });
    assert.equal(plan.degraded, false, plan.reason);
    assert.match(plan.sft.command, /ruvllm|microlora|sft/i);
    assert.ok(plan.dpo.command);
    const base = [{ instance_id: 'one', cheapResolved: false, escalated: true, resolved: true, costUsd: 1 }];
    const adapter = [{ instance_id: 'one', cheapResolved: true, escalated: false, resolved: true, costUsd: 0.1 }];
    const evaluation = await service.runEval({ baseOutcomes: base, adapterOutcomes: adapter, importer });
    assert.equal(evaluation.degraded, false, evaluation.reason);
    assert.ok(evaluation.delta.escalationRateReduction > 0);
    console.log(JSON.stringify({ package: `${pkg.name}@${pkg.version}`, sftRows: exported.sftRows, dpoRows: exported.dpoRows, heldOut: exported.report.excludedByHoldout, planOnly: true, escalationRateReduction: evaluation.delta.escalationRateReduction }));
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
