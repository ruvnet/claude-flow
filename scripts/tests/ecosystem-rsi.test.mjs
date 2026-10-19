import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm, symlink } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createRsiPlan, evaluateRsiPlan, assessRsiCandidate, verifySourceBinding } from '../lib/ecosystem-rsi.mjs';
async function fixture(t, source = "import test from 'node:test'; test('works',()=>{});") {
  const repoRoot = await mkdtemp(path.join(os.tmpdir(), 'rsi-test-'));
  t.after(() => rm(repoRoot, { recursive: true, force: true }));
  await mkdir(path.join(repoRoot, 'scripts/tests'), { recursive: true });
  await mkdir(path.join(repoRoot, 'scripts/lib'), { recursive: true });
  await writeFile(path.join(repoRoot, 'scripts/ecosystem-rsi.mjs'), '// fixture');
  await writeFile(path.join(repoRoot, 'scripts/lib/fixture.mjs'), '// fixture');
  await writeFile(path.join(repoRoot, 'scripts/tests/fixture.test.mjs'), source);
  const registry = { schema: 'ruflo-capabilities/v1', capabilities: [{ id: 'core', kind: 'contract', packages: ['a'], checks: ['check'] }], checks: [{ id: 'check', packages: ['a'], testFiles: ['scripts/tests/fixture.test.mjs'] }] };
  await writeFile(path.join(repoRoot, 'registry.json'), JSON.stringify(registry));
  await writeFile(path.join(repoRoot, 'graph.json'), JSON.stringify({ nodes: [{ name: 'a', status: 'captured', version: '1.0.0' }], edges: [] }));
  return { repoRoot, registryPath: 'registry.json', graphPath: 'graph.json', registry };
}

test('executes real registered check and deduplicates ledger without skipping reexecution', async t => {
  const options = await fixture(t), plan = await createRsiPlan(options);
  assert.equal(await verifySourceBinding(plan, options), true);
  const first = await evaluateRsiPlan(plan, options);
  assert.equal(first.results[0].status, 'passed', JSON.stringify(first.results)); assert.equal(first.complete, true);
  const second = await evaluateRsiPlan(plan, { ...options, ledger: first.ledger });
  assert.equal(second.deduplicated, true); assert.equal(second.ledger.length, 1); assert.equal(second.results[0].status, 'passed');
  assert.equal(assessRsiCandidate({ complete: true, results: [] }, { baseline: 100, candidate: 50, direction: 'lower' }).status, 'rejected');
});

test('rejects stale source, tampered plan, traversal and escaping symlink', async t => {
  const options = await fixture(t), plan = await createRsiPlan(options);
  await writeFile(path.join(options.repoRoot, 'scripts/lib/fixture.mjs'), '// changed');
  await assert.rejects(evaluateRsiPlan(plan, options), /Stale/);
  await assert.rejects(evaluateRsiPlan({ ...plan, changed: ['injected'] }, options), /integrity/);
  options.registry.checks[0].testFiles = ['scripts/tests/../../malicious.test.mjs'];
  await writeFile(path.join(options.repoRoot, 'registry.json'), JSON.stringify(options.registry));
  await assert.rejects(createRsiPlan(options), /test path/);
  options.registry.checks[0].testFiles = ['scripts/tests/escape.test.mjs'];
  await symlink('/etc/passwd', path.join(options.repoRoot, 'scripts/tests/escape.test.mjs'));
  await writeFile(path.join(options.repoRoot, 'registry.json'), JSON.stringify(options.registry));
  await assert.rejects(createRsiPlan(options), /escapes/);
});

test('timeout kills child and rejected gate cannot become success', async t => {
  const options = await fixture(t, "import test from 'node:test'; test('hangs',async()=>{ await new Promise(()=>{}); }); setInterval(()=>{},1000);");
  const result = await evaluateRsiPlan(await createRsiPlan(options), { ...options, maxDurationMs: 200 });
  assert.equal(result.results[0].status, 'timedout'); assert.equal(result.gate.status, 'rejected');
});

test('skips and caller supplied objectives never authorize improvement', async t => {
  const options = await fixture(t, "import test from 'node:test'; test.skip('skipped',()=>{});");
  const result = await evaluateRsiPlan(await createRsiPlan(options), { ...options, objective: { baseline: 100, candidate: 50, direction: 'lower' } });
  assert.equal(result.results[0].status, 'failed'); assert.equal(result.gate.status, 'rejected');
});

test('uncovered packages remain explicit and budget validation fails closed', async t => {
  const options = await fixture(t);
  await writeFile(path.join(options.repoRoot, 'graph.json'), JSON.stringify({ nodes: ['a', 'b'].map(name => ({ name, status: 'captured', version: '1.0.0' })), edges: [] }));
  const plan = await createRsiPlan(options);
  assert.deepEqual(plan.uncoveredPackages, ['b']);
  const result = await evaluateRsiPlan(plan, options); assert.equal(result.complete, false);
  await assert.rejects(createRsiPlan({ ...options, maxChecks: Infinity }), /budget/);
});

test('output overflow is bounded and fails closed', async t => {
  const options = await fixture(t, "console.log('x'.repeat(20000));");
  const overflow = await evaluateRsiPlan(await createRsiPlan(options), options);
  assert.equal(overflow.results[0].status, 'failed');
  assert.equal(overflow.results[0].outputTruncated, true);
  assert.ok(overflow.results[0].output.length <= 16384);
});

test('successful tests cannot turn unverified objective numbers into adoption evidence', async t => {
  const options = await fixture(t);
  const result = await evaluateRsiPlan(await createRsiPlan(options), { ...options, objective: { baseline: 100, candidate: 50, direction: 'lower' } });
  assert.equal(result.complete, true);
  assert.equal(result.gate.status, 'rejected');
  assert.match(result.gate.reason, /not trusted/);
});

test('explicit sourceFiles are hash bound and unsafe check ids cannot inject commands', async t => {
  const options = await fixture(t);
  await writeFile(path.join(options.repoRoot, 'source.ts'), 'export const value = 1;');
  options.registry.checks[0].sourceFiles = ['source.ts'];
  await writeFile(path.join(options.repoRoot, 'registry.json'), JSON.stringify(options.registry));
  const plan = await createRsiPlan(options);
  await writeFile(path.join(options.repoRoot, 'source.ts'), 'export const value = 2;');
  await assert.rejects(verifySourceBinding(plan, options), /Stale/);
  options.registry.checks[0].id = 'check; touch /tmp/injected';
  await writeFile(path.join(options.repoRoot, 'registry.json'), JSON.stringify(options.registry));
  await assert.rejects(createRsiPlan(options), /check id/);
});
