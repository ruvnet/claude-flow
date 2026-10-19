import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
const from = process.env.RUFLO_RUVECTOR_RESOLVE_FROM;
test('real pinned RuVector CLI verifies all cuts and 802 impact queries, including runtime overlay', { skip: !from && process.env.RUFLO_RUVECTOR_REQUIRED !== '1' }, async () => {
  assert.ok(from, 'RUFLO_RUVECTOR_RESOLVE_FROM required');
  const directory = await mkdtemp(join(tmpdir(), 'ruflo-graph-'));
  try {
    const output = join(directory, 'analysis.json');
    execFileSync(process.execPath, ['scripts/analyze-ecosystem.mjs', '--ruvector-from', resolve(from), '--output', output], { stdio: 'pipe' });
    const report = JSON.parse(await readFile(output));
    assert.equal(report.validation.parityQueries, 802);
    assert.equal(report.engine.version, '0.2.41');
    assert.equal(report.engine.nativeAcceleration, false);
    assert.equal(report.declarations.cuts.componentCount, 146);
    assert.equal(report.declarations.cuts.isolates.length, 138);
    assert.equal(report.runtime.relationshipCount, 42);
    assert.equal(report.runtime.cuts.componentCount, 104);
    assert.equal(report.runtime.cuts.isolates.length, 95);
    for (const cuts of [report.declarations.cuts, report.declarations.requiredCuts, report.runtime.cuts]) assert.equal(cuts.verification.exactAgreement, true);
    assert.deepEqual(report.runtime.topology.required, report.declarations.topology.required);
    const plan = report.plans.find(p => p.changed.includes('metaharness'));
    assert.equal(plan.newlyIncluded.length, 37);
    assert.equal(plan.releaseAuthorized, false);
    assert.throws(() => execFileSync(process.execPath, ['scripts/analyze-ecosystem.mjs', '--ruvector-from', resolve(from), '--changed', 'does-not-exist', '--output', output], { stdio: 'pipe' }));
  } finally { await rm(directory, { recursive: true, force: true }); }
});
