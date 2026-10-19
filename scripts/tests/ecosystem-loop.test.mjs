import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { runEcosystemLoop } from '../ecosystem-loop.mjs';
import { buildWebReceipt } from '../build-ecosystem-web.mjs';
async function fixture(t) {
  const repoRoot = await mkdtemp(join(tmpdir(), 'ecosystem-loop-'));
  t.after(() => rm(repoRoot, { recursive: true, force: true }));
  await mkdir(join(repoRoot, 'scripts/tests'), { recursive: true }); await mkdir(join(repoRoot, 'scripts/lib'));
  await writeFile(join(repoRoot, 'scripts/ecosystem-rsi.mjs'), '// fixture identity');
  await writeFile(join(repoRoot, 'scripts/tests/check.test.mjs'), "import test from 'node:test'; test('contract',()=>{});");
  await writeFile(join(repoRoot, 'graph.json'), JSON.stringify({ nodes: [{name:'core',status:'captured',version:'1.0.0'},{name:'unmapped',status:'captured',version:'1.0.0'}], edges: [] }));
  await writeFile(join(repoRoot, 'registry.json'), JSON.stringify({schema:'ruflo-capabilities/v1',capabilities:[{id:'core',title:'Contract',kind:'contract',packages:['core'],checks:['core']}],checks:[{id:'core',packages:['core'],testFiles:['scripts/tests/check.test.mjs']}]}));
  return {repoRoot,graphPath:'graph.json',registryPath:'registry.json',iterations:2,maxDurationMs:5000};
}
test('finite real cycles deduplicate learning, expose coverage gaps and generate honest matrix', async t => {
  const options = await fixture(t), receipt = await runEcosystemLoop(options);
  assert.equal(receipt.loop.completedIterations, 2); assert.equal(receipt.loop.newSourceIdentities, 1);
  assert.equal(receipt.ledger.length, 1); assert.equal(receipt.checksPassed, true); assert.equal(receipt.complete, false);
  assert.deepEqual(receipt.plan.uncoveredPackages, ['unmapped']); assert.equal(receipt.gate.status, 'rejected');
  const web = await buildWebReceipt(receipt, options.repoRoot);
  assert.equal(web.capabilities[0].status, 'passed'); assert.equal(web.capabilities[0].kind, 'contract');
  assert.equal(web.capabilities[0].availability, 'not-probed'); assert.equal(web.adoption.measured, false);
  assert.equal(web.cycle.registeredPackageCount, 1);
  await assert.rejects(buildWebReceipt({...receipt,inputHash:'forged'},options.repoRoot), /identity/);
  await writeFile(join(options.repoRoot,'scripts/tests/check.test.mjs'), "import test from 'node:test';test('changed',()=>{});");
  await assert.rejects(buildWebReceipt(receipt, options.repoRoot), /Stale/);
  const next = await runEcosystemLoop({...options,ledger:receipt.ledger});
  assert.equal(next.ledger.length, 2); assert.equal(next.loop.newSourceIdentities, 1);
});
test('failing checks lead the next work queue and never upgrade matrix evidence', async t => {
  const options = await fixture(t);
  await writeFile(join(options.repoRoot,'scripts/tests/check.test.mjs'), "import test from 'node:test';test('failure',()=>{throw Error('regression')});");
  const receipt = await runEcosystemLoop({...options,iterations:1});
  assert.equal(receipt.checksPassed, false); assert.equal(receipt.nextActions[0].kind,'check-regression');
  assert.equal((await buildWebReceipt(receipt,options.repoRoot)).capabilities[0].status,'failed');
});
test('unbounded iterations and invalid duration are rejected before execution', async t => {
  const options = await fixture(t);
  for (const iterations of [0,6,Infinity,1.5]) await assert.rejects(runEcosystemLoop({...options,iterations}), /Iterations/);
  await assert.rejects(runEcosystemLoop({...options,maxDurationMs:Infinity}), /duration/);
});
