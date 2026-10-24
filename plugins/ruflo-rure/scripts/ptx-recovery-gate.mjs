#!/usr/bin/env node
/** Evidence audit only. This program cannot authenticate executions or promote code. */
import { createHash } from 'node:crypto';
import { constants, closeSync, fstatSync, openSync, readFileSync, readSync, realpathSync } from 'node:fs';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const POLICY = resolve(HERE, '../docs/benchmarks/cuda-recovery-gate.json');
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const isHash = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const nonempty = value => typeof value === 'string' && value.length > 0 && value.length <= 1024;
const integer = value => Number.isSafeInteger(value) && value >= 0;
export const LIMITS = Object.freeze({ artifactBytes: 64 * 1024 * 1024, totalArtifactBytes: 256 * 1024 * 1024,
  readAttempts: 2_000_000, reportBytes: 32 * 1024 * 1024, bindingsBytes: 1024 * 1024, observations: 100_000, caseReferences: 1_000_000 });

function boundedFile(path, maximum) {
  const fd = openSync(path, constants.O_RDONLY | constants.O_NONBLOCK | (constants.O_NOFOLLOW ?? 0));
  try {
    const stat = fstatSync(fd);
    if (!stat.isFile() || stat.size > maximum) throw Error('file is not a bounded regular file');
    const buffer = Buffer.alloc(Math.min(stat.size + 1, maximum + 1));
    let used = 0;
    while (used < buffer.length) { const n = readSync(fd, buffer, used, buffer.length - used, null); if (!n) break; used += n; }
    if (used > stat.size || used > maximum) throw Error('file changed size while reading');
    return buffer.subarray(0, used);
  } finally { closeSync(fd); }
}

/**
 * Read bounded regular-file snapshots. The caller must own an immutable evidence
 * directory: path checks are not a sandbox against concurrent directory renames.
 * Cache already verified snapshots; never reread a repeated reference per row.
 */
export function artifactReader(directory, requestedLimits = {}) {
  const root = realpathSync(directory);
  const limits = Object.fromEntries(['artifactBytes', 'totalArtifactBytes', 'readAttempts'].map(k => {
    const n = requestedLimits[k] ?? LIMITS[k];
    if (!Number.isSafeInteger(n) || n < 1 || n > LIMITS[k]) throw Error('reader limits may only be reduced');
    return [k, n];
  }));
  const cache = new Map();
  let total = 0, attempts = 0;
  return ref => {
    if (++attempts > limits.readAttempts) throw Error('artifact read-attempt budget exceeded');
    if (!ref || !nonempty(ref.path) || isAbsolute(ref.path) || !isHash(ref.sha256)) throw Error('invalid artifact reference');
    const path = resolve(root, ref.path);
    const rel = relative(root, path);
    if (!rel || rel === '..' || rel.startsWith(`..${sep}`)) throw Error('artifact escapes evidence directory');
    const cacheKey = `${path}\0${ref.sha256}`;
    if (cache.has(cacheKey)) return cache.get(cacheKey);
    const actual = realpathSync(path);
    const realRel = relative(root, actual);
    if (!realRel || realRel === '..' || realRel.startsWith(`..${sep}`)) throw Error('artifact resolves outside evidence directory');
    if (actual !== path) throw Error('artifact symlinks are unsupported');
    const remaining = limits.totalArtifactBytes - total;
    if (remaining < 1) throw Error('aggregate artifact byte budget exceeded');
    const bytes = boundedFile(path, Math.min(limits.artifactBytes, remaining));
    // Failed digest checks consume the I/O budget too; otherwise distinct bad
    // digests could force repeated large reads without ever populating cache.
    total += bytes.length;
    if (digest(bytes) !== ref.sha256) throw Error('artifact digest mismatch');
    cache.set(cacheKey, bytes);
    return bytes;
  };
}

/**
 * Audit recorded measurements against independently supplied frozen bindings.
 * Matching files are integrity evidence, never proof that an executor ran them.
 * The best verdict is READY_FOR_INDEPENDENT_REVIEW, never ACCEPT or SOTA.
 */
export function evaluateRecoveryGate(report, bindings, readArtifact, policy = JSON.parse(readFileSync(POLICY, 'utf8'))) {
  const missing = [], failures = [];
  const require = (condition, message) => { if (!condition) missing.push(message); };
  const metrics = {};
  const nonemptyArtifact = (ref, label) => {
    const bytes = readArtifact(ref);
    if (!Buffer.isBuffer(bytes) || bytes.length === 0) throw Error(`${label} is empty`);
    return bytes;
  };
  const jsonCache = new Map();
  const jsonArtifact = (ref, label) => {
    const bytes = nonemptyArtifact(ref, label);
    if (bytes.length > 1024 * 1024) throw Error(`${label} JSON exceeds one MiB`);
    if (!jsonCache.has(ref.sha256)) {
      const value = JSON.parse(bytes.toString('utf8'));
      if (!value || typeof value !== 'object' || Array.isArray(value)) throw Error(`${label} must be an object`);
      jsonCache.set(ref.sha256, value);
    }
    return jsonCache.get(ref.sha256);
  };
  const verifyExecutionRecord = (ref, expected, caseIds) => {
    const record = jsonArtifact(ref, 'execution receipt');
    if (record.schemaVersion !== 1 || !nonempty(record.runId) || !nonempty(record.executor) || !nonempty(record.command)
      || record.status !== 'ok' || record.exitCode !== 0 || record.completionVersion !== 1 || record.completionVerified !== true) throw Error('execution receipt fields incomplete');
    for (const [key, value] of Object.entries(expected)) if (record[key] !== value) throw Error(`execution receipt ${key} mismatch`);
    if (!Array.isArray(record.caseIds) || record.caseIds.length !== caseIds.length || record.caseIds.some((id, i) => id !== caseIds[i])) throw Error('execution receipt case set mismatch');
    return record;
  };
  const result = () => ({
    schemaVersion: 1,
    protocolId: policy.protocolId,
    verdict: failures.length ? 'REJECT' : missing.length ? 'INCONCLUSIVE' : 'READY_FOR_INDEPENDENT_REVIEW',
    promotionVerdict: 'INCONCLUSIVE', sotaProven: false, authenticatedExecution: false,
    metrics, failures: [...new Set(failures)], missing: [...new Set(missing)],
    limitation: 'Local file integrity and numerical summaries do not authenticate execution, independence, license permission, novelty, or approval.',
  });
  if (!report || typeof report !== 'object' || !bindings || typeof bindings !== 'object') {
    missing.push('independently frozen bindings and an evidence report are required'); return result();
  }
  require(report.schemaVersion === 1 && bindings.schemaVersion === 1, 'schemaVersion must be 1');
  require(report.protocolId === policy.protocolId && bindings.protocolId === policy.protocolId, 'protocol binding mismatch');
  require(report.track === bindings.track && policy.tracks.includes(report.track), 'input-equivalent track binding missing');
  require(isHash(bindings.policySha256) && bindings.policySha256 === digest(Buffer.from(JSON.stringify(policy))), 'frozen policy digest mismatch');
  const documents = {};
  for (const key of ['dataset', 'candidate', 'baseline', 'evaluator', 'independentReview']) {
    try {
      require(isHash(bindings[`${key}Sha256`]), `frozen ${key} digest missing`);
      if (report.artifacts?.[key]?.sha256 !== bindings[`${key}Sha256`]) throw Error('frozen digest mismatch');
      const bytes = nonemptyArtifact(report.artifacts[key], key);
      if (key === 'dataset' || key === 'independentReview') documents[key] = JSON.parse(bytes.toString('utf8'));
    } catch (e) { missing.push(`${key} artifact: ${e.message}`); }
  }
  const kernels = documents.dataset?.kernels;
  if (!Array.isArray(kernels) || kernels.length > 10000) { missing.push('bounded kernel manifest missing'); return result(); }
  const ids = new Set(), sourceHashes = new Set(), programs = new Set();
  const projects = { development: new Set(), confirmation: new Set() };
  const families = { development: new Set(), confirmation: new Set() };
  const counts = { development: 0, confirmation: 0 };
  for (const k of kernels) {
    if (!k || !nonempty(k.id) || ids.has(k.id) || !isHash(k.sourceSha256) || !isHash(k.canonicalProgramSha256)
      || sourceHashes.has(k.sourceSha256) || programs.has(k.canonicalProgramSha256)
      || !nonempty(k.project) || !nonempty(k.family) || !Object.hasOwn(counts, k.split)) {
      failures.push('invalid, duplicated or variant-inflated kernel manifest'); continue;
    }
    ids.add(k.id); sourceHashes.add(k.sourceSha256); programs.add(k.canonicalProgramSha256);
    projects[k.split].add(k.project); families[k.split].add(k.family); counts[k.split]++;
  }
  require(ids.size >= policy.corpus.minimumDistinctKernels, 'fewer than 100 distinct kernels');
  require(counts.development >= policy.corpus.minimumDevelopmentKernels && counts.confirmation >= policy.corpus.minimumConfirmationKernels, '70 development / 30 confirmation minimum not met');
  if ([...projects.development].some(x => projects.confirmation.has(x)) || [...families.development].some(x => families.confirmation.has(x))) failures.push('project or family leakage across confirmation split');
  const compilers = bindings.compilerVersions, architectures = bindings.gpuArchitectures;
  const validCompilers = Array.isArray(compilers) && compilers.length >= 2 && compilers.length <= 8 && compilers.every(nonempty) && new Set(compilers).size === compilers.length;
  const validArchitectures = Array.isArray(architectures) && architectures.length >= 2 && architectures.length <= 8 && architectures.every(nonempty) && new Set(architectures).size === architectures.length;
  require(validCompilers, 'two to eight distinct frozen compiler versions required');
  require(validArchitectures, 'two to eight distinct frozen GPU architectures required');
  require(bindings.confirmationExposures === 1, 'confirmation must be exposed exactly once');
  require(bindings.baselineSelection?.inputEquivalent === true && nonempty(bindings.baselineSelection?.rationale), 'strongest input-equivalent baseline selection missing');
  require(nonempty(bindings.baselineSelection?.licenseEvidence) && nonempty(bindings.datasetLicenseEvidence), 'baseline and corpus license evidence missing');
  require(Array.isArray(bindings.baselineSelection?.unresolvedStrongerBaselines) && bindings.baselineSelection.unresolvedStrongerBaselines.length === 0, 'stronger baseline availability unresolved');
  require(nonempty(bindings.candidateAuthor), 'candidate author identity missing');
  const review = documents.independentReview;
  require(review?.candidateSha256 === bindings.candidateSha256 && review?.datasetSha256 === bindings.datasetSha256 && review?.evaluatorSha256 === bindings.evaluatorSha256,
    'independent review does not bind the frozen candidate/dataset/evaluator');
  require(nonempty(review?.reviewer) && nonempty(review?.reproductionReceipt) && review?.reviewer !== bindings.candidateAuthor, 'independent reviewer/reproduction reference missing');
  if (!validCompilers || !validArchitectures) return result();
  if (ids.size * compilers.length * architectures.length > LIMITS.observations) { missing.push('frozen observation matrix exceeds work budget'); return result(); }
  // Expand only validated unique IDs. Invalid duplicate manifest rows must not
  // amplify work beyond the product checked immediately above.
  const expected = new Set([...ids].flatMap(id => compilers.flatMap(c => architectures.map(a => JSON.stringify([id, c, a])))));
  const workloads = documents.dataset?.workloads;
  const frozenWorkloads = new Map();
  if (!Array.isArray(workloads) || workloads.length > LIMITS.observations) { missing.push('frozen per-workload input/test/reference manifest missing'); return result(); }
  for (const workload of workloads) {
    const key = JSON.stringify([workload?.kernelId, workload?.compilerVersion, workload?.gpuArchitecture]);
    if (!expected.has(key) || frozenWorkloads.has(key) || !['inputSha256', 'testManifestSha256', 'referenceOutputSha256', 'originalArtifactSha256'].every(k => isHash(workload?.[k]))) {
      failures.push('invalid or duplicate frozen workload binding'); continue;
    }
    frozenWorkloads.set(key, workload);
  }
  require(frozenWorkloads.size === expected.size, 'frozen workload manifest matrix incomplete');
  const rows = report.observations;
  if (!Array.isArray(rows) || rows.length > LIMITS.observations) { missing.push('bounded observation matrix missing'); return result(); }
  const seen = new Set(), correct = { candidate: new Map(), baseline: new Map() };
  const caseCategories = new Set();
  let incorrectAccepted = 0, caseReferences = 0;
  for (const row of rows) {
    const key = JSON.stringify([row?.kernelId, row?.compilerVersion, row?.gpuArchitecture]);
    if (!expected.has(key) || seen.has(key)) { failures.push('unexpected or duplicated observation'); continue; }
    seen.add(key);
    const frozen = frozenWorkloads.get(key);
    let reference = null, caseIds = [];
    try {
      if (!frozen) throw Error('workload was not frozen');
      for (const [field, binding] of [['inputs', 'inputSha256'], ['testManifest', 'testManifestSha256'], ['referenceOutput', 'referenceOutputSha256']]) {
        if (row[field]?.sha256 !== frozen[binding]) throw Error(`${field} frozen digest mismatch`);
        nonemptyArtifact(row[field], field);
      }
      const tests = jsonArtifact(row.testManifest, 'test manifest');
      if (tests.schemaVersion !== 1 || tests.kernelId !== row.kernelId || tests.compilerVersion !== row.compilerVersion || tests.gpuArchitecture !== row.gpuArchitecture
        || tests.inputSha256 !== frozen.inputSha256 || tests.referenceOutputSha256 !== frozen.referenceOutputSha256 || tests.comparison !== 'exact-output-bytes'
        || !Array.isArray(tests.cases) || tests.cases.length < 1 || tests.cases.length > 10000
        || tests.cases.some(c => !nonempty(c?.id) || !nonempty(c?.category))) throw Error('test manifest fields incomplete');
      caseReferences += tests.cases.length;
      if (caseReferences > LIMITS.caseReferences) { missing.push('aggregate executed case-reference budget exceeded'); return result(); }
      caseIds = tests.cases.map(c => c.id);
      if (new Set(caseIds).size !== caseIds.length) throw Error('test manifest has duplicate case IDs');
      reference = nonemptyArtifact(row.referenceOutput, 'shared reference output');
      if (row.original?.compiledArtifact?.sha256 !== frozen.originalArtifactSha256) throw Error('original program digest mismatch');
      nonemptyArtifact(row.original.compiledArtifact, 'original program');
      const originalOutput = nonemptyArtifact(row.original.actualOutput, 'original output');
      verifyExecutionRecord(row.original.executionReceipt, {
        kernelId: row.kernelId, compilerVersion: row.compilerVersion, gpuArchitecture: row.gpuArchitecture,
        inputSha256: frozen.inputSha256, testManifestSha256: frozen.testManifestSha256,
        compiledArtifactSha256: frozen.originalArtifactSha256, outputSha256: row.original.actualOutput.sha256,
      }, caseIds);
      if (!originalOutput.equals(reference)) { failures.push(`original program disagrees with reference: ${row.kernelId}`); reference = null; }
      else for (const c of tests.cases) caseCategories.add(c.category);
    } catch (e) { missing.push(`shared observation ${row.kernelId}: ${e.message}`); reference = null; }
    for (const side of ['candidate', 'baseline']) {
      const value = row[side];
      if (!value || typeof value.admitted !== 'boolean') { missing.push(`${side} admission missing`); continue; }
      let passed = false;
      if (value.admitted) {
        try {
          if (!reference || !frozen) throw Error('shared frozen reference/original verification missing');
          if (value.outputLanguage !== (report.track === 'ptx-to-cuda-cpp' ? 'cuda-cpp' : 'llvm-ir')) throw Error('wrong recovery output language');
          if (value.originalProgramPassthrough !== false) throw Error('original-program passthrough is not recovered code');
          if (value.testCases !== caseIds.length || value.compileExitCode !== 0 || value.runExitCode !== 0) throw Error('compile/execute/test evidence incomplete');
          nonemptyArtifact(value.generatedSource, 'generated source'); nonemptyArtifact(value.compiledArtifact, 'compiled artifact');
          if (value.referenceOutput?.sha256 !== frozen.referenceOutputSha256) throw Error('candidate/baseline must use the same frozen reference');
          nonemptyArtifact(value.referenceOutput, 'side reference output');
          const actual = nonemptyArtifact(value.actualOutput, 'actual output');
          verifyExecutionRecord(value.executionReceipt, {
            kernelId: row.kernelId, compilerVersion: row.compilerVersion, gpuArchitecture: row.gpuArchitecture,
            toolSha256: bindings[`${side}Sha256`], generatedSourceSha256: value.generatedSource.sha256,
            inputSha256: frozen.inputSha256, testManifestSha256: frozen.testManifestSha256,
            compiledArtifactSha256: value.compiledArtifact.sha256, outputSha256: value.actualOutput.sha256,
          }, caseIds);
          passed = actual.equals(reference);
          if (!passed && side === 'candidate') incorrectAccepted++;
        } catch (e) { missing.push(`${side} observation ${row.kernelId}: ${e.message}`); }
      } else {
        try {
          const rejection = jsonArtifact(value.rejectionReceipt, `${side} rejection receipt`);
          if (!frozen || rejection.schemaVersion !== 1 || rejection.status !== 'rejected' || !nonempty(rejection.runId)
            || !nonempty(rejection.executor) || !nonempty(rejection.command) || !Number.isSafeInteger(rejection.exitCode)
            || !['unsupported-input', 'compile-failure', 'runtime-failure'].includes(rejection.reason)
            || rejection.kernelId !== row.kernelId || rejection.compilerVersion !== row.compilerVersion || rejection.gpuArchitecture !== row.gpuArchitecture
            || rejection.toolSha256 !== bindings[`${side}Sha256`] || rejection.inputSha256 !== frozen.inputSha256
            || rejection.testManifestSha256 !== frozen.testManifestSha256) throw Error('rejection attempt fields/bindings incomplete; unavailable baseline is unknown');
        } catch (e) { missing.push(`${side} observation ${row.kernelId}: ${e.message}`); }
      }
      const prior = correct[side].get(row.kernelId) ?? true;
      correct[side].set(row.kernelId, prior && passed);
    }
  }
  require(seen.size === expected.size, 'incomplete compiler/GPU/kernel matrix');
  for (const category of policy.validation.requiredCases) require(caseCategories.has(category), `required validation case category missing: ${category}`);
  const count = side => [...ids].filter(id => correct[side].get(id) === true).length;
  const candidateCorrect = count('candidate'), baselineCorrect = count('baseline');
  const confirmationIds = kernels.filter(k => k?.split === 'confirmation' && ids.has(k.id)).map(k => k.id);
  const confirmationCandidateCorrect = confirmationIds.filter(id => correct.candidate.get(id) === true).length;
  const confirmationBaselineCorrect = confirmationIds.filter(id => correct.baseline.get(id) === true).length;
  Object.assign(metrics, { distinctKernels: ids.size, developmentKernels: counts.development, confirmationKernels: counts.confirmation,
    expectedMatrixRows: expected.size, observedMatrixRows: seen.size, candidateCorrect, baselineCorrect,
    confirmationCandidateCorrect, confirmationBaselineCorrect, incorrectAccepted });
  if (incorrectAccepted > 0) failures.push('candidate accepted an observed incorrect program');
  if (seen.size === expected.size && ids.size > 0 && !missing.some(m => m.includes('observation'))) {
    metrics.coverageGainPercentagePoints = 100 * (candidateCorrect - baselineCorrect) / ids.size;
    // Exact integer comparison: 10 percentage points is not rounded float arithmetic.
    if (BigInt(candidateCorrect - baselineCorrect) * 100n < BigInt(policy.recovery.minimumCoverageGainPercentagePoints) * BigInt(ids.size)) failures.push('coverage gain below frozen 10 percentage points');
    metrics.confirmationCoverageGainPercentagePoints = confirmationIds.length ? 100 * (confirmationCandidateCorrect - confirmationBaselineCorrect) / confirmationIds.length : null;
    if (confirmationIds.length && BigInt(confirmationCandidateCorrect - confirmationBaselineCorrect) * 100n < BigInt(policy.recovery.minimumCoverageGainPercentagePoints) * BigInt(confirmationIds.length)) failures.push('untouched confirmation gain below frozen 10 percentage points');
  }
  const costs = report.fullCostMicrousd;
  require(costs && integer(costs.candidate) && integer(costs.baseline) && costs.includesDevelopmentAndReview === true, 'complete measured cost accounting missing');
  if (costs && integer(costs.candidate) && integer(costs.baseline) && candidateCorrect > 0 && baselineCorrect > 0) {
    if (BigInt(costs.candidate) * BigInt(baselineCorrect) > BigInt(costs.baseline) * BigInt(candidateCorrect)) failures.push('cost per validated kernel regressed');
  } else require(false, 'cost per validated kernel not comparable');
  try {
    const negative = report.negativeControl;
    const frozen = frozenWorkloads.get(JSON.stringify([negative?.kernelId, negative?.compilerVersion, negative?.gpuArchitecture]));
    if (!frozen || negative.referenceOutput?.sha256 !== frozen.referenceOutputSha256 || negative.inputs?.sha256 !== frozen.inputSha256
      || negative.testManifest?.sha256 !== frozen.testManifestSha256) throw Error('negative control does not bind a frozen workload');
    nonemptyArtifact(negative.inputs, 'negative control inputs');
    const tests = jsonArtifact(negative.testManifest, 'negative control test manifest');
    const actual = nonemptyArtifact(negative.actualOutput, 'negative control output'), reference = nonemptyArtifact(negative.referenceOutput, 'negative control reference');
    nonemptyArtifact(negative.mutatedArtifact, 'mutated program');
    if (negative.mutatedArtifact.sha256 === frozen.originalArtifactSha256) throw Error('negative control retained the original program');
    verifyExecutionRecord(negative.executionReceipt, {
      kernelId: negative.kernelId, compilerVersion: negative.compilerVersion, gpuArchitecture: negative.gpuArchitecture,
      inputSha256: frozen.inputSha256, testManifestSha256: frozen.testManifestSha256,
      compiledArtifactSha256: negative.mutatedArtifact.sha256, outputSha256: negative.actualOutput.sha256,
    }, tests.cases.map(c => c.id));
    if (actual.equals(reference)) failures.push('mutation negative control did not produce a mismatch');
  } catch (e) { missing.push(`independent mutation negative control missing: ${e.message}`); }
  require(report.gpuChecks?.memcheck === 'passed' && report.gpuChecks?.synchronization === 'unsupported', 'GPU memory check or conservative synchronization scope missing');
  try {
    const memory = jsonArtifact(report.gpuChecks.executionReceipt, 'GPU check receipt');
    if (memory.schemaVersion !== 1 || memory.tool !== 'compute-sanitizer' || memory.mode !== 'memcheck'
      || memory.exitCode !== 0 || memory.errors !== 0 || !nonempty(memory.executor) || !nonempty(memory.command)
      || memory.candidateSha256 !== bindings.candidateSha256 || memory.datasetSha256 !== bindings.datasetSha256
      || memory.checkedMatrixRows !== expected.size) throw Error('GPU check receipt fields/bindings incomplete');
  } catch (e) { missing.push(`GPU check receipt missing: ${e.message}`); }
  if (report.performanceClaim === true) missing.push('performance claim requires a separate reviewed timing evaluator; recovery gate cannot certify speed');
  return result();
}

export function main(args = process.argv.slice(2)) {
  const options = Object.fromEntries(args.map((arg, i) => arg.startsWith('--') ? [arg, args[i + 1]] : null).filter(Boolean));
  const policy = JSON.parse(readFileSync(POLICY, 'utf8'));
  if (!options['--evidence'] || !options['--bindings']) {
    console.log(JSON.stringify(evaluateRecoveryGate(null, null, null, policy), null, 2)); return 1;
  }
  try {
    const path = resolve(options['--evidence']);
    const report = JSON.parse(boundedFile(path, LIMITS.reportBytes).toString('utf8'));
    const bindings = JSON.parse(boundedFile(resolve(options['--bindings']), LIMITS.bindingsBytes).toString('utf8'));
    const result = evaluateRecoveryGate(report, bindings, artifactReader(dirname(path)), policy);
    console.log(JSON.stringify(result, null, 2));
    return result.verdict === 'READY_FOR_INDEPENDENT_REVIEW' ? 0 : 1;
  } catch (e) {
    console.log(JSON.stringify({ verdict: 'INCONCLUSIVE', promotionVerdict: 'INCONCLUSIVE', sotaProven: false, error: e.message }, null, 2)); return 1;
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) process.exitCode = main();
