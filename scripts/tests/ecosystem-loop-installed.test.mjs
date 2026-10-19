import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { buildWebReceipt } from '../build-ecosystem-web.mjs';
const required = process.env.RUFLO_RUVECTOR_REQUIRED === '1';
test('real two cycle ecosystem evaluation preserves inventory and produces source bound capability evidence', {skip:!required}, async () => {
  const folder = await mkdtemp(join(tmpdir(),'rsi-installed-'));
  const digest = async path => createHash('sha256').update(await readFile(path)).digest('hex');
  const inputs=['data/npm-downloads.latest.json','data/npm-dependencies.latest.json','package.json','v3/@claude-flow/cli/package.json','ruflo/package.json'];
  const before=await Promise.all(inputs.map(digest));
  try {
    const output=join(folder,'result.json'),ledger=join(folder,'ledger.json');
    const child=spawnSync(process.execPath,['scripts/ecosystem-loop.mjs','--iterations','2','--max-duration-ms','120000','--output',output,'--ledger',ledger],{encoding:'utf8',timeout:135000,env:{...process.env,NODE_TEST_CONTEXT:''}});
    assert.equal(child.status,2,child.stdout+child.stderr); // Passing checks, explicitly incomplete coverage.
    const receipt=JSON.parse(await readFile(output));
    assert.equal(receipt.checksPassed,true);assert.equal(receipt.loop.completedIterations,2);
    assert.equal(receipt.plan.affected.length,401);assert.equal(receipt.plan.uncoveredPackages.length,390);
    assert.equal(receipt.ledger.length,1);assert.equal(receipt.loop.newSourceIdentities,1);
    assert.equal(receipt.artifactReview.status,'review-ready');assert.equal(receipt.artifactReview.baselineIsolates,138);assert.equal(receipt.artifactReview.candidateIsolates,95);
    assert.equal(receipt.artifactReview.runtimeCompatibilityEstablished,false);assert.equal(receipt.loop.automaticPromotion,false);
    const web=await buildWebReceipt(receipt,process.cwd());assert.equal(web.capabilities.filter(c=>c.status==='passed').length,10);
    assert.equal(web.proposals[0].kind,'measured-download-regression');assert.equal(web.proposals[0].additionalBytes,111971638);
    assert.deepEqual(await Promise.all(inputs.map(digest)),before);
  } finally {await rm(folder,{recursive:true,force:true});}
});
