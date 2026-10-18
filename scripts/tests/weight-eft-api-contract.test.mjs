import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import * as nodeModule from 'node:module';

const source = readFileSync(new URL('../../v3/@claude-flow/cli/src/services/weight-eft.ts', import.meta.url), 'utf8');
const dir = mkdtempSync(join(tmpdir(), 'ruflo-weight-eft-contract-'));
let service;
try {
  const transpile = typeof nodeModule.stripTypeScriptTypes === 'function'
    ? nodeModule.stripTypeScriptTypes
    : source => {
      const ts = nodeModule.createRequire(import.meta.url)('typescript');
      return ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 } }).outputText;
    };
  writeFileSync(join(dir, 'service.mjs'), transpile(source));
  service = await import(pathToFileURL(join(dir, 'service.mjs')).href);
} finally { rmSync(dir, { recursive: true, force: true }); }

const required = ['exportTrainingData', 'sftToJsonl', 'dpoToJsonl', 'costParetoDelta', 'twoStagePlan'];
const api = () => Object.fromEntries(required.map(name => [name, () => {}]));

test('selects complete ESM namespace or CJS default surface', async () => {
  const complete = api();
  assert.equal(await service.loadWeightEft(async () => complete), complete);
  assert.equal(await service.loadWeightEft(async () => ({ default: complete })), complete);
  assert.equal(await service.loadWeightEft(async () => ({ exportTrainingData() {}, default: complete })), complete);
});

test('rejects each partial or incompatible surface before export, plan or eval runs', async () => {
  for (const name of required) {
    for (const invalid of [undefined, null, true, 'function']) {
      const partial = { ...api(), [name]: invalid };
      assert.equal(await service.loadWeightEft(async () => partial), null, `${name}: ${invalid}`);
      assert.equal(await service.loadWeightEft(async () => ({ default: partial })), null);
    }
  }
});

test('absence and load failures degrade cleanly at entry points', async () => {
  for (const value of [undefined, null, {}, false, 1]) assert.equal(await service.loadWeightEft(async () => value), null);
  const importer = async () => { throw Error('module unavailable'); };
  assert.equal(await service.loadWeightEft(importer), null);
  assert.deepEqual(await service.runExport({ archive: [], importer }), { degraded: true, reason: 'weight-eft-not-available' });
  assert.equal((await service.runPlan({ sftPath: 'sft.jsonl', dpoPath: 'dpo.jsonl', importer })).degraded, true);
});
