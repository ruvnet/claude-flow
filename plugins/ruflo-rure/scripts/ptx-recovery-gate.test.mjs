import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, symlinkSync, truncateSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { artifactReader, evaluateRecoveryGate, LIMITS } from './ptx-recovery-gate.mjs';

const root = dirname(fileURLToPath(import.meta.url));
const policy = JSON.parse(readFileSync(resolve(root, '../docs/benchmarks/cuda-recovery-gate.json'), 'utf8'));
const hash = text => createHash('sha256').update(text).digest('hex');

// Synthetic schema fixture only. These records are NOT real CUDA measurements.
function fixture() {
  const files = new Map();
  const artifact = (path, text) => {
    const bytes = Buffer.from(typeof text === 'string' ? text : JSON.stringify(text));
    const ref = { path, sha256: hash(bytes) }; files.set(path, bytes); return ref;
  };
  const kernels = Array.from({ length: 100 }, (_, i) => ({ id: `k${i}`, sourceSha256: hash(`source${i}`), canonicalProgramSha256: hash(`program${i}`),
    project: i < 70 ? 'development-project' : 'confirmation-project', family: i < 70 ? 'development-family' : 'confirmation-family', split: i < 70 ? 'development' : 'confirmation' }));
  const artifacts = Object.fromEntries(['candidate', 'baseline', 'evaluator'].map(k => [k, artifact(`${k}.txt`, k)]));
  const bindings = { schemaVersion: 1, protocolId: policy.protocolId, track: 'ptx-to-cuda-cpp', policySha256: hash(JSON.stringify(policy)),
    ...Object.fromEntries(Object.entries(artifacts).map(([k, v]) => [`${k}Sha256`, v.sha256])),
    compilerVersions: ['nvcc-a', 'nvcc-b'], gpuArchitectures: ['sm-a', 'sm-b'], confirmationExposures: 1,
    candidateAuthor: 'author', datasetLicenseEvidence: 'synthetic-fixture-not-public-benchmark',
    baselineSelection: { inputEquivalent: true, rationale: 'schema test only', licenseEvidence: 'test-fixture', unresolvedStrongerBaselines: [] } };
  const source = artifact('generated.cu', 'test source'), binary = artifact('binary.bin', 'test bytes');
  const output = artifact('output.txt', '42'), inputs = artifact('inputs.json', '[42]');
  const workloads = [];
  const cases = policy.validation.requiredCases.map(category => ({ id: category, category }));
  const observations = kernels.flatMap((k, i) => bindings.compilerVersions.flatMap(c => bindings.gpuArchitectures.map(g => {
    const identity = { kernelId: k.id, compilerVersion: c, gpuArchitecture: g };
    const prefix = `${k.id}-${c}-${g}`;
    const tests = artifact(`${prefix}-tests.json`, { schemaVersion: 1, ...identity, inputSha256: inputs.sha256, referenceOutputSha256: output.sha256,
      comparison: 'exact-output-bytes', cases });
    workloads.push({ ...identity, inputSha256: inputs.sha256, testManifestSha256: tests.sha256,
      referenceOutputSha256: output.sha256, originalArtifactSha256: binary.sha256 });
    const record = { schemaVersion: 1, runId: prefix, executor: 'synthetic-executor', command: 'synthetic fixture only', status: 'ok', exitCode: 0,
      completionVersion: 1, completionVerified: true, ...identity, inputSha256: inputs.sha256, testManifestSha256: tests.sha256,
      compiledArtifactSha256: binary.sha256, outputSha256: output.sha256, caseIds: cases.map(c => c.id) };
    const original = { compiledArtifact: binary, actualOutput: output, executionReceipt: artifact(`${prefix}-original.json`, record) };
    const side = name => ({ admitted: true, outputLanguage: 'cuda-cpp', originalProgramPassthrough: false, testCases: cases.length, compileExitCode: 0, runExitCode: 0,
      generatedSource: source, compiledArtifact: binary, actualOutput: output, referenceOutput: output,
      executionReceipt: artifact(`${prefix}-${name}.json`, { ...record, toolSha256: bindings[`${name}Sha256`], generatedSourceSha256: source.sha256 }) });
    return { ...identity, inputs, testManifest: tests, referenceOutput: output, original, candidate: side('candidate'), baseline: i < 90 ? side('baseline') : {
      admitted: false, rejectionReceipt: artifact(`${prefix}-rejected.json`, { schemaVersion: 1, ...identity, runId: prefix, executor: 'synthetic-executor',
        command: 'synthetic fixture only', status: 'rejected', reason: 'unsupported-input', exitCode: 1, toolSha256: bindings.baselineSha256,
        inputSha256: inputs.sha256, testManifestSha256: tests.sha256 }) } };
  })));
  artifacts.dataset = artifact('dataset.json', { kernels, workloads });
  artifacts.independentReview = artifact('review.json', { candidateSha256: artifacts.candidate.sha256, datasetSha256: artifacts.dataset.sha256,
    evaluatorSha256: artifacts.evaluator.sha256, reviewer: 'independent-evaluator', reproductionReceipt: 'independent-run-1' });
  Object.assign(bindings, Object.fromEntries(Object.entries(artifacts).map(([k, v]) => [`${k}Sha256`, v.sha256])));
  const first = observations[0];
  const negativeOutput = artifact('negative-output.txt', '43'), mutated = artifact('mutated.bin', 'mutated program bytes');
  const negativeReceipt = artifact('negative-receipt.json', { ...JSON.parse(files.get(first.original.executionReceipt.path)),
    compiledArtifactSha256: mutated.sha256, outputSha256: negativeOutput.sha256 });
  const memoryReceipt = artifact('memory-check.json', { schemaVersion: 1, tool: 'compute-sanitizer', mode: 'memcheck', exitCode: 0, errors: 0,
    executor: 'synthetic-executor', command: 'synthetic fixture only', candidateSha256: bindings.candidateSha256, datasetSha256: bindings.datasetSha256, checkedMatrixRows: observations.length });
  const report = { schemaVersion: 1, protocolId: policy.protocolId, track: bindings.track, artifacts, observations,
    fullCostMicrousd: { candidate: 100, baseline: 100, includesDevelopmentAndReview: true },
    negativeControl: { kernelId: first.kernelId, compilerVersion: first.compilerVersion, gpuArchitecture: first.gpuArchitecture, inputs: first.inputs,
      testManifest: first.testManifest, mutatedArtifact: mutated, actualOutput: negativeOutput, referenceOutput: output, executionReceipt: negativeReceipt },
    gpuChecks: { memcheck: 'passed', synchronization: 'unsupported', executionReceipt: memoryReceipt } };
  const reader = ref => { const bytes = files.get(ref.path); if (!bytes || hash(bytes) !== ref.sha256) throw Error('artifact digest mismatch'); return bytes; };
  const run = () => evaluateRecoveryGate(report, bindings, reader, policy);
  const updateReceipt = (row, side, updates) => {
    const current = JSON.parse(files.get(row[side].executionReceipt.path));
    row[side].executionReceipt = artifact(`${row.kernelId}-${row.compilerVersion}-${row.gpuArchitecture}-${side}-modified.json`, { ...current, ...updates });
  };
  const admitBaseline = row => { row.baseline = { ...row.candidate }; updateReceipt(row, 'baseline', { toolSha256: bindings.baselineSha256 }); };
  const rejectSide = (row, side) => { row[side] = { admitted: false, rejectionReceipt: artifact(`${row.kernelId}-${row.compilerVersion}-${row.gpuArchitecture}-${side}-rejected.json`, {
    schemaVersion: 1, kernelId: row.kernelId, compilerVersion: row.compilerVersion, gpuArchitecture: row.gpuArchitecture, runId: 'synthetic-rejection',
    executor: 'synthetic-executor', command: 'synthetic fixture only', status: 'rejected', reason: 'unsupported-input', exitCode: 1,
    toolSha256: bindings[`${side}Sha256`], inputSha256: row.inputs.sha256, testManifestSha256: row.testManifest.sha256 }) }; };
  return { report, bindings, files, kernels, workloads, artifact, run, updateReceipt, admitBaseline, rejectSide };
}

test('missing evidence and self-declared ACCEPT never prove SOTA', () => {
  const r = evaluateRecoveryGate({ pass: true, sotaProven: true, verdict: 'ACCEPT' }, {}, () => Buffer.from('{}'), policy);
  assert.equal(r.verdict, 'INCONCLUSIVE'); assert.equal(r.sotaProven, false); assert.equal(r.promotionVerdict, 'INCONCLUSIVE');
});

test('exact ten percentage points is eligible for review only', () => {
  const f = fixture(), r = f.run();
  assert.equal(r.verdict, 'READY_FOR_INDEPENDENT_REVIEW');
  assert.equal(r.metrics.coverageGainPercentagePoints, 10); assert.equal(r.metrics.distinctKernels, 100);
  assert.equal(r.metrics.observedMatrixRows, 400); assert.equal(r.sotaProven, false); assert.equal(r.authenticatedExecution, false);
});

test('real-file audit rejects empty source, binary, receipts and outputs', () => {
  const f = fixture(), directory = mkdtempSync(resolve(tmpdir(), 'rure-gate-empty-'));
  const empty = f.artifact('empty', '');
  for (const row of f.report.observations) for (const side of ['candidate', 'baseline']) if (row[side].admitted) {
    for (const field of ['generatedSource', 'compiledArtifact', 'executionReceipt', 'actualOutput', 'referenceOutput']) row[side][field] = empty;
  }
  try {
    for (const [path, bytes] of f.files) writeFileSync(resolve(directory, path), bytes);
    const result = evaluateRecoveryGate(f.report, f.bindings, artifactReader(directory), policy);
    assert.notEqual(result.verdict, 'READY_FOR_INDEPENDENT_REVIEW');
    assert.ok(result.missing.some(m => m.includes('empty')));
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test('candidate and baseline cannot choose independent reference outputs', () => {
  const f = fixture(), row = f.report.observations[0];
  row.baseline.referenceOutput = f.artifact('alternative-reference', '9001');
  row.baseline.actualOutput = row.baseline.referenceOutput;
  f.updateReceipt(row, 'baseline', { outputSha256: row.baseline.actualOutput.sha256 });
  const result = f.run(); assert.equal(result.verdict, 'INCONCLUSIVE');
  assert.ok(result.missing.some(m => m.includes('same frozen reference')));
});

test('missing frozen workloads, test manifests and original outputs fail closed', () => {
  for (const field of ['workloads', 'testManifest', 'original']) {
    const f = fixture();
    if (field === 'workloads') {
      f.report.artifacts.dataset = f.artifact('dataset.json', { kernels: f.kernels });
      f.bindings.datasetSha256 = f.report.artifacts.dataset.sha256;
    } else delete f.report.observations[0][field];
    assert.notEqual(f.run().verdict, 'READY_FOR_INDEPENDENT_REVIEW', field);
  }
});

test('missing author and wrong baseline-availability types fail closed', () => {
  const f = fixture(); delete f.bindings.candidateAuthor; f.bindings.baselineSelection.unresolvedStrongerBaselines = '';
  const result = f.run(); assert.equal(result.verdict, 'INCONCLUSIVE');
  assert.ok(result.missing.includes('candidate author identity missing'));
  assert.ok(result.missing.includes('stronger baseline availability unresolved'));
});

test('unexecuted baseline admission false is unknown, never zero observed coverage', () => {
  const f = fixture(); f.report.observations.at(-1).baseline = { admitted: false };
  const result = f.run(); assert.equal(result.verdict, 'INCONCLUSIVE');
  assert.ok(result.missing.some(m => m.includes('baseline observation')));
});

test('receipt prose or a nonempty JSON object cannot stand in for execution bindings', () => {
  const f = fixture(); f.report.observations[0].candidate.executionReceipt = f.artifact('empty-json-receipt', {});
  const result = f.run(); assert.equal(result.verdict, 'INCONCLUSIVE');
  assert.ok(result.missing.some(m => m.includes('execution receipt fields incomplete')));
});

test('stale recorded inputs and executed case IDs fail closed', () => {
  for (const change of [{ inputSha256: hash('other-input') }, { caseIds: ['unexecuted-case'] }]) {
    const f = fixture(); f.updateReceipt(f.report.observations[0], 'candidate', change);
    assert.equal(f.run().verdict, 'INCONCLUSIVE');
  }
});

test('original program must produce the shared frozen reference', () => {
  const f = fixture(), row = f.report.observations[0];
  row.original.actualOutput = f.artifact('incorrect-original-output', '43');
  f.updateReceipt(row, 'original', { outputSha256: row.original.actualOutput.sha256 });
  const result = f.run(); assert.equal(result.verdict, 'REJECT');
  assert.ok(result.failures.some(m => m.includes('original program disagrees')));
});

test('required validation categories must occur in the bound executed test manifests', () => {
  const f = fixture();
  for (const row of f.report.observations) {
    const tests = JSON.parse(f.files.get(row.testManifest.path)); tests.cases = [{ id: 'one', category: 'unrelated' }];
    row.testManifest = f.artifact(row.testManifest.path, tests);
    f.workloads.find(w => w.kernelId === row.kernelId && w.compilerVersion === row.compilerVersion && w.gpuArchitecture === row.gpuArchitecture).testManifestSha256 = row.testManifest.sha256;
    for (const side of ['candidate', 'baseline', 'original']) if (side === 'original' || row[side].admitted) {
      row[side].testCases = 1; f.updateReceipt(row, side, { testManifestSha256: row.testManifest.sha256, caseIds: ['one'] });
    } else f.rejectSide(row, side);
  }
  f.report.artifacts.dataset = f.artifact('dataset.json', { kernels: f.kernels, workloads: f.workloads });
  f.bindings.datasetSha256 = f.report.artifacts.dataset.sha256;
  const result = f.run(); assert.equal(result.verdict, 'INCONCLUSIVE');
  assert.ok(result.missing.some(m => m.startsWith('required validation case category missing:')));
});

test('GPU check status cannot replace a bound nonempty receipt', () => {
  const f = fixture(); f.report.gpuChecks.executionReceipt = f.artifact('unbound-gpu-check.json', { status: 'passed' });
  assert.equal(f.run().verdict, 'INCONCLUSIVE');
});

test('below frozen ten points rejects without retuning', () => {
  const f = fixture(); for (const row of f.report.observations) if (row.kernelId === 'k90') f.admitBaseline(row);
  assert.equal(f.run().verdict, 'REJECT'); assert.ok(f.run().failures.includes('coverage gain below frozen 10 percentage points'));
});

test('development gains cannot hide a confirmation regression', () => {
  const f = fixture();
  for (const row of f.report.observations) {
    const id = Number(row.kernelId.slice(1));
    if (id < 50 || id >= 70) f.admitBaseline(row); else f.rejectSide(row, 'baseline');
    if (id >= 90) f.rejectSide(row, 'candidate');
  }
  const r = f.run(); assert.equal(r.metrics.coverageGainPercentagePoints, 10);
  assert.equal(r.verdict, 'REJECT'); assert.ok(r.failures.some(m => m.includes('confirmation gain')));
});

test('an unavailable stronger baseline stays unknown', () => {
  const f = fixture(); f.bindings.baselineSelection.unresolvedStrongerBaselines.push('unavailable-weights');
  assert.equal(f.run().verdict, 'INCONCLUSIVE');
});

test('missing matrix rows cannot inflate correct kernel coverage', () => {
  const f = fixture(); f.report.observations.pop(); assert.equal(f.run().verdict, 'INCONCLUSIVE');
});

test('duplicate observations reject', () => {
  const f = fixture(); f.report.observations.push(f.report.observations[0]); assert.equal(f.run().verdict, 'REJECT');
});

test('wrong observed output rejects despite reported pass', () => {
  const f = fixture(); f.report.observations[0].candidate.actualOutput = f.artifact('wrong.txt', '43');
  f.report.observations[0].candidate.pass = true;
  f.updateReceipt(f.report.observations[0], 'candidate', { outputSha256: f.report.observations[0].candidate.actualOutput.sha256 });
  const r = f.run(); assert.equal(r.verdict, 'REJECT'); assert.equal(r.metrics.incorrectAccepted, 1);
});

test('PTX passthrough cannot become executable source recovery', () => {
  const f = fixture(); f.report.observations[0].candidate.originalProgramPassthrough = true;
  assert.equal(f.run().verdict, 'INCONCLUSIVE');
});

test('stale artifact hash fails closed', () => {
  const f = fixture(); f.files.set('candidate.txt', Buffer.from('edited candidate')); assert.equal(f.run().verdict, 'INCONCLUSIVE');
});

test('missing license and reused confirmation fail closed', () => {
  const f = fixture(); f.bindings.baselineSelection.licenseEvidence = ''; f.bindings.confirmationExposures = 2;
  const r = f.run(); assert.equal(r.verdict, 'INCONCLUSIVE'); assert.ok(r.missing.some(m => m.includes('license')));
});

test('changed frozen threshold fails policy binding', () => {
  const f = fixture(); f.bindings.policySha256 = hash('weakened policy'); assert.equal(f.run().verdict, 'INCONCLUSIVE');
});

test('source variants and confirmation leakage reject', () => {
  const f = fixture(); f.kernels[99].canonicalProgramSha256 = f.kernels[98].canonicalProgramSha256;
  f.kernels[70].family = 'development-family';
  f.report.artifacts.dataset = f.artifact('dataset.json', { kernels: f.kernels, workloads: f.workloads });
  f.bindings.datasetSha256 = f.report.artifacts.dataset.sha256;
  const r = f.run(); assert.equal(r.verdict, 'REJECT'); assert.ok(r.failures.some(m => m.includes('inflated'))); assert.ok(r.failures.some(m => m.includes('leakage')));
});

test('cost regression uses an exact integer ratio', () => {
  const f = fixture(); f.report.fullCostMicrousd.candidate = 112;
  assert.equal(f.run().verdict, 'REJECT'); assert.ok(f.run().failures.includes('cost per validated kernel regressed'));
});

test('unknown cost is not zero', () => {
  const f = fixture(); f.report.fullCostMicrousd.candidate = null; assert.equal(f.run().verdict, 'INCONCLUSIVE');
});

test('performance is a separate unfulfilled claim', () => {
  const f = fixture(); f.report.performanceClaim = true; assert.equal(f.run().verdict, 'INCONCLUSIVE');
});

test('negative-control prose cannot replace a measured mismatch', () => {
  const f = fixture(); f.report.negativeControl.actualOutput = f.report.negativeControl.referenceOutput;
  const record = JSON.parse(f.files.get(f.report.negativeControl.executionReceipt.path));
  f.report.negativeControl.executionReceipt = f.artifact('no-mismatch-receipt.json', { ...record, outputSha256: f.report.negativeControl.actualOutput.sha256 });
  f.report.negativeControl.observedMismatch = true;
  assert.equal(f.run().verdict, 'REJECT');
});

test('oversized environment matrix fails before expansion', () => {
  const f = fixture(); f.bindings.compilerVersions = Array.from({ length: 1000 }, (_, i) => `compiler-${i}`);
  assert.equal(f.run().verdict, 'INCONCLUSIVE');
});

test('invalid duplicate kernels cannot amplify frozen matrix expansion', () => {
  const f = fixture();
  const inflated = [...f.kernels, ...Array.from({ length: 9900 }, () => ({ id: 'k0' }))];
  f.bindings.compilerVersions = Array.from({ length: 8 }, (_, i) => `compiler-${i}`);
  f.bindings.gpuArchitectures = Array.from({ length: 8 }, (_, i) => `gpu-${i}`);
  f.report.artifacts.dataset = f.artifact('dataset.json', { kernels: inflated, workloads: f.workloads });
  f.bindings.datasetSha256 = f.report.artifacts.dataset.sha256;
  const originalStringify = JSON.stringify;
  let matrixKeys = 0;
  JSON.stringify = (value, ...rest) => {
    if (Array.isArray(value) && value.length === 3 && typeof value[0] === 'string' && value[0].startsWith('k')) matrixKeys++;
    return originalStringify(value, ...rest);
  };
  try {
    const result = f.run(); assert.equal(result.verdict, 'REJECT');
    assert.ok(result.failures.includes('invalid, duplicated or variant-inflated kernel manifest'));
    assert.equal(result.metrics.expectedMatrixRows, 6400);
    assert.ok(matrixKeys < 8000, `matrix key work ${matrixKeys} must depend on validated unique IDs`);
  } finally { JSON.stringify = originalStringify; }
});

test('aggregate case processing stops at the frozen work budget', () => {
  const f = fixture();
  const cases = Array.from({ length: 10000 }, (_, i) => ({ id: `c${i}`, category: 'integer-boundaries' }));
  for (const row of f.report.observations.slice(0, 101)) {
    const tests = JSON.parse(f.files.get(row.testManifest.path)); tests.cases = cases;
    row.testManifest = f.artifact(row.testManifest.path, tests);
    f.workloads.find(w => w.kernelId === row.kernelId && w.compilerVersion === row.compilerVersion && w.gpuArchitecture === row.gpuArchitecture).testManifestSha256 = row.testManifest.sha256;
  }
  f.report.artifacts.dataset = f.artifact('dataset.json', { kernels: f.kernels, workloads: f.workloads });
  f.bindings.datasetSha256 = f.report.artifacts.dataset.sha256;
  const result = f.run(); assert.equal(result.verdict, 'INCONCLUSIVE');
  assert.ok(result.missing.includes('aggregate executed case-reference budget exceeded'));
});

test('artifact reader rejects changed files, traversal, symlinks and directories', () => {
  const directory = mkdtempSync(resolve(tmpdir(), 'rure-gate-test-'));
  try {
    writeFileSync(resolve(directory, 'good'), 'ok');
    const read = artifactReader(directory), good = { path: 'good', sha256: hash('ok') };
    assert.equal(read(good).toString(), 'ok');
    assert.throws(() => read({ path: '../outside', sha256: hash('ok') }));
    assert.throws(() => read({ path: '.', sha256: hash('ok') }));
    symlinkSync(resolve(directory, 'good'), resolve(directory, 'link'));
    assert.throws(() => read({ ...good, path: 'link' }));
    writeFileSync(resolve(directory, 'good'), 'changed');
    assert.equal(read(good).toString(), 'ok', 'cache returns its verified snapshot, not new mutable bytes');
    assert.throws(() => artifactReader(directory)(good), 'a new audit must detect changed bytes');
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test('aggregate bytes and reference attempts are bounded, including cache hits', () => {
  const directory = mkdtempSync(resolve(tmpdir(), 'rure-gate-budget-'));
  try {
    writeFileSync(resolve(directory, 'one'), '1234'); writeFileSync(resolve(directory, 'two'), '5678');
    const first = { path: 'one', sha256: hash('1234') }, second = { path: 'two', sha256: hash('5678') };
    const limitedBytes = artifactReader(directory, { artifactBytes: 4, totalArtifactBytes: 6 });
    assert.equal(limitedBytes(first).toString(), '1234'); assert.equal(limitedBytes(first).toString(), '1234');
    assert.throws(() => limitedBytes(second), /bounded/);
    const limitedReads = artifactReader(directory, { readAttempts: 2 });
    limitedReads(first); limitedReads(first); assert.throws(() => limitedReads(first), /budget/);
    const failedDigests = artifactReader(directory, { artifactBytes: 4, totalArtifactBytes: 4 });
    assert.throws(() => failedDigests({ ...first, sha256: hash('wrong') }), /digest/);
    assert.throws(() => failedDigests(first), /budget/, 'invalid digests also consume the read-byte budget');
    assert.throws(() => artifactReader(directory, { totalArtifactBytes: LIMITS.totalArtifactBytes + 1 }), /reduced/);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test('top-level report and bindings reads reject oversized files before allocation', () => {
  const directory = mkdtempSync(resolve(tmpdir(), 'rure-gate-input-'));
  try {
    const report = resolve(directory, 'report.json'), bindings = resolve(directory, 'bindings.json');
    writeFileSync(report, '{}'); writeFileSync(bindings, '{}'); truncateSync(bindings, LIMITS.bindingsBytes + 1);
    const command = () => spawnSync(process.execPath, [resolve(root, 'ptx-recovery-gate.mjs'), '--evidence', report, '--bindings', bindings], { encoding: 'utf8', timeout: 5000 });
    let run = command(); assert.equal(run.status, 1); assert.match(run.stdout, /bounded regular file/);
    writeFileSync(bindings, '{}'); truncateSync(report, LIMITS.reportBytes + 1);
    run = command(); assert.equal(run.status, 1); assert.match(run.stdout, /bounded regular file/);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});
