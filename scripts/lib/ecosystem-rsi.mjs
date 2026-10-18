import { readFile, realpath, readdir } from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { createConnectivityIndex } from './ecosystem-connectivity.mjs';
import { applyRuntimeRelationships } from './ecosystem-runtime-relationships.mjs';

const hash = value => createHash('sha256').update(value).digest('hex');
const sort = values => [...new Set(values)].sort();
const executions = new WeakSet();
function bounded(value, max, label) {
  if (!Number.isInteger(value) || value < 1 || value > max) throw new Error(`Invalid ${label} budget`);
  return value;
}
async function contained(root, relative) {
  if (typeof relative !== 'string' || path.isAbsolute(relative) || relative.split(/[\\/]/).includes('..')) throw new Error('Unsafe repository path');
  const actual = await realpath(path.resolve(root, relative));
  if (!actual.startsWith(root + path.sep)) throw new Error('Path escapes repository');
  return actual;
}
async function binding(root, paths) {
  const files = {};
  for (const relative of sort(paths)) files[relative] = hash(await readFile(await contained(root, relative)));
  return { files, sha256: hash(JSON.stringify(files)) };
}
async function validateRegistry(root, registry, names) {
  if (registry?.schema !== 'ruflo-capabilities/v1' || !Array.isArray(registry.checks) || !Array.isArray(registry.capabilities)) throw new Error('Invalid capability registry');
  const ids = new Set();
  for (const check of registry.checks) {
    if (!check || typeof check.id !== 'string' || !/^[a-zA-Z0-9._-]+$/.test(check.id) || ids.has(check.id)) throw new Error('Invalid or duplicate check id');
    ids.add(check.id);
    if (!Array.isArray(check.packages) || !check.packages.length || check.packages.some(name => !names.has(name))) throw new Error('Unknown check package');
    if (!Array.isArray(check.testFiles) || !check.testFiles.length) throw new Error('Missing test files');
    if (check.sourceFiles !== undefined && !Array.isArray(check.sourceFiles)) throw new Error('Invalid source files');
    for (const file of check.sourceFiles ?? []) await contained(root, file);
    for (const file of check.testFiles) {
      if (typeof file !== 'string' || !/^scripts\/tests\/[a-zA-Z0-9._-]+\.test\.mjs$/.test(file)) throw new Error('Unregistered test path');
      await contained(root, file);
    }
  }
  const capabilities = new Set();
  for (const capability of registry.capabilities) {
    if (!capability || typeof capability.id !== 'string' || capabilities.has(capability.id) || !['contract', 'integration'].includes(capability.kind)) throw new Error('Invalid capability');
    capabilities.add(capability.id);
    if (!Array.isArray(capability.packages) || capability.packages.some(name => !names.has(name)) || !Array.isArray(capability.checks) || !capability.checks.length || capability.checks.some(id => !ids.has(id))) throw new Error('Invalid capability references');
  }
}

export async function createRsiPlan({ repoRoot, registryPath, graphPath, runtimePath, changed = [], maxChecks = 8, benchmarkPath = null }) {
  const root = await realpath(repoRoot);
  bounded(maxChecks, 64, 'checks');
  const registry = JSON.parse(await readFile(await contained(root, registryPath), 'utf8'));
  const graphBytes = await readFile(await contained(root, graphPath));
  const graph = JSON.parse(graphBytes);
  const benchmark = benchmarkPath ? JSON.parse(await readFile(await contained(root, benchmarkPath), 'utf8')) : null;
  const runtime = runtimePath ? JSON.parse(await readFile(await contained(root, runtimePath), 'utf8')) : null;
  const effective = runtime ? applyRuntimeRelationships(graph, runtime, hash(graphBytes)) : graph;
  const index = createConnectivityIndex(effective), analysis = index.analyze();
  const names = new Set(graph.nodes.map(node => node.name));
  await validateRegistry(root, registry, names);
  const affected = changed.length ? index.planChanges(changed, { mode: 'capabilities' }).affected : sort(names);
  const relevant = registry.checks.filter(check => check.packages.some(name => affected.includes(name))).sort((a, b) => a.id.localeCompare(b.id));
  const selectedChecks = relevant.slice(0, maxChecks).map(check => ({ id: check.id, packages: sort(check.packages), testFiles: sort(check.testFiles) }));
  const covered = new Set(selectedChecks.flatMap(check => check.packages));
  const registered = new Set(registry.checks.flatMap(check => check.packages));
  const findings = [
    ...analysis.capabilities.trueIsolates.map(name => ({ kind: 'unexplained-isolate', packages: [name], priority: 60, reason: 'No captured internal relationship; standalone intent needs evidence.' })),
    ...(runtime?.relationships ?? []).filter(link => !/^\d+\.\d+\.\d+(?:-[\w.-]+)?$/.test(link.targetSelector)).map(link => ({ kind: 'floating-runtime-selector', packages: [link.source, link.target], priority: 90, selector: link.targetSelector })),
    ...graph.edges.filter(edge => edge.type === 'peer' && edge.optionalPeer && !edge.internal).map(edge => ({ kind: 'optional-peer-outside-inventory', packages: [edge.source], target: edge.target, priority: 40, reason: 'Inventory coverage gap, not proof of missing installation.' })),
  ];
  for (const delta of benchmark?.dependencyDelta ?? []) if (Number.isFinite(delta.additionalBytes) && delta.additionalBytes > 0 && names.has(delta.package)) findings.push({ kind: 'measured-download-regression', packages: [delta.package], priority: 100, additionalBytes: delta.additionalBytes, increasePercent: delta.increasePercent, reason: 'Captured bundle preserving benchmark; remeasure after a proposed change.' });
  for (const finding of runtime?.findings ?? []) if (finding.type === 'optional-peer-registry-check' && finding.status === 'HTTP 404') findings.push({ kind: 'unavailable-optional-peer', packages: finding.consumers, target: finding.package, priority: 85, checkedAt: finding.checkedAt, reason: 'Registry returned 404 at capture time; not a default installation failure.' });
  findings.sort((a, b) => b.priority - a.priority || JSON.stringify(a).localeCompare(JSON.stringify(b)));
  const libraries = (await readdir(path.join(root, 'scripts/lib'))).filter(file => file.endsWith('.mjs')).map(file => `scripts/lib/${file}`);
  const entrypoints = (await readdir(path.join(root, 'scripts'))).filter(file => /^(ecosystem-|build-ecosystem).*\.mjs$/.test(file)).map(file => `scripts/${file}`);
  const sourceBinding = await binding(root, [registryPath, graphPath, ...(benchmarkPath ? [benchmarkPath] : []), ...(runtimePath ? [runtimePath] : []), ...libraries, ...entrypoints, 'scripts/ecosystem-rsi.mjs', ...registry.checks.flatMap(check => [...check.testFiles, ...(check.sourceFiles ?? [])])]);
  const plan = { schema: 'ruflo-ecosystem-rsi-plan/v1', inputs: { registryPath, graphPath, runtimePath: runtimePath ?? null, benchmarkPath }, sourceBinding,
    changed: sort(changed), affected, findings, selectedChecks, deferredCheckIds: relevant.slice(maxChecks).map(check => check.id),
    uncoveredPackages: affected.filter(name => !covered.has(name)), unregisteredPackages: affected.filter(name => !registered.has(name)),
    metadataComplete: analysis.metadataComplete, maxChecks, finiteCycles: 1, promotionAllowed: false };
  return { ...plan, inputHash: hash(JSON.stringify(plan)) };
}

function runCheck(root, check, timeoutMs) {
  return new Promise(resolve => {
    const started = performance.now(); let output = '', truncated = false, timedOut = false, finished = false;
    const environment = { ...process.env, NODE_OPTIONS: '', NODE_PATH: '' };
    delete environment.NODE_TEST_CONTEXT;
    const child = spawn(process.execPath, ['--test', '--test-reporter=tap', ...check.testFiles], { cwd: root, shell: false, detached: process.platform !== 'win32', env: environment, stdio: ['ignore', 'pipe', 'pipe'] });
    const append = chunk => { const text = chunk.toString(); if (output.length + text.length > 16384) { truncated = true; try { if (process.platform !== 'win32') process.kill(-child.pid, 'SIGKILL'); else child.kill('SIGKILL'); } catch {} } output = (output + text).slice(0, 16384); };
    child.stdout.on('data', append); child.stderr.on('data', append);
    const timer = setTimeout(() => { timedOut = true; try { if (process.platform !== 'win32') process.kill(-child.pid, 'SIGKILL'); else child.kill('SIGKILL'); } catch {} }, timeoutMs);
    const finish = (exitCode, error) => {
      if (finished) return; finished = true; clearTimeout(timer);
      resolve({ id: check.id, status: timedOut ? 'timedout' : exitCode === 0 && !error && !truncated && /# tests [1-9]\d*/.test(output) && /# skipped 0(?:\r?\n|$)/.test(output) ? 'passed' : 'failed', exitCode, durationMs: performance.now() - started, output, outputTruncated: truncated, ...(error ? { error: error.message } : {}) });
    };
    child.on('error', error => finish(null, error)); child.on('close', code => finish(code));
  });
}

export function assessRsiCandidate(execution, objective) {
  if (!executions.has(execution)) return { status: 'rejected', reason: 'Trusted local check execution required' };
  if (execution.sourceUnchanged === false) return { status: 'rejected', reason: 'Source changed during evaluation' };
  if (execution.results.some(result => result.status !== 'passed')) return { status: 'rejected', reason: 'A registered check failed, timed out or was skipped' };
  if (!execution.complete) return { status: 'rejected', reason: 'Registered checks passed; affected package coverage remains incomplete' };
  if (!objective || !['lower', 'higher'].includes(objective.direction) || !Number.isFinite(objective.baseline) || !Number.isFinite(objective.candidate) || objective.baseline <= 0 || objective.candidate < 0) return { status: 'rejected', reason: 'Finite positive baseline and measured objective required' };
  return { status: 'rejected', reason: 'Caller supplied objective is not trusted measurement evidence; source-bound measurement runner required', promotionAllowed: false };
}

export async function evaluateRsiPlan(plan, { repoRoot, maxDurationMs = 30000, ledger = [], objective = null } = {}) {
  const root = await realpath(repoRoot); bounded(maxDurationMs, 300000, 'duration');
  if (plan?.schema !== 'ruflo-ecosystem-rsi-plan/v1') throw new Error('Invalid RSI plan');
  const { inputHash, ...body } = plan;
  if (hash(JSON.stringify(body)) !== inputHash) throw new Error('Plan integrity mismatch');
  const current = await createRsiPlan({ repoRoot: root, ...plan.inputs, changed: plan.changed, maxChecks: plan.maxChecks });
  if (current.sourceBinding.sha256 !== plan.sourceBinding.sha256 || JSON.stringify(current.selectedChecks) !== JSON.stringify(plan.selectedChecks)) throw new Error('Stale plan source binding');
  if (!Array.isArray(ledger)) throw new Error('Invalid ledger');
  const start = performance.now(), results = [];
  for (const check of current.selectedChecks) {
    const remaining = Math.floor(maxDurationMs - (performance.now() - start));
    if (remaining < 1) { results.push({ id: check.id, status: 'timedout', exitCode: null, durationMs: 0, output: 'Total evaluation budget exhausted', outputTruncated: false }); break; }
    results.push(await runCheck(root, check, remaining));
  }
  // Recheck after execution so tests cannot silently alter bound candidate sources.
  const after = await binding(root, Object.keys(current.sourceBinding.files));
  const complete = after.sha256 === current.sourceBinding.sha256 && current.metadataComplete && !current.uncoveredPackages.length && !current.deferredCheckIds.length && results.length === current.selectedChecks.length && results.length > 0;
  const execution = { inputHash, results, complete, sourceUnchanged: after.sha256 === current.sourceBinding.sha256, checksPassed: results.length > 0 && results.length === current.selectedChecks.length && results.every(result => result.status === 'passed') }; executions.add(execution);
  const gate = assessRsiCandidate(execution, objective);
  let artifactReview = { status: 'unmeasured', scope: 'relationship evidence only', promotionAllowed: false };
  const requiredEvidenceChecks = ['graph-impact', 'relationship-provenance', 'ruvector-workflow'];
  if (execution.sourceUnchanged && current.inputs.runtimePath && requiredEvidenceChecks.every(id => results.some(result => result.id === id && result.status === 'passed'))) {
    const graphBytes = await readFile(await contained(root, current.inputs.graphPath));
    const rawGraph = JSON.parse(graphBytes), overlay = JSON.parse(await readFile(await contained(root, current.inputs.runtimePath), 'utf8'));
    const baseline = createConnectivityIndex(rawGraph).analyze().capabilities.trueIsolates.length;
    const candidate = createConnectivityIndex(applyRuntimeRelationships(rawGraph, overlay, hash(graphBytes))).analyze().capabilities.trueIsolates.length;
    const improvementPercent = baseline > 0 ? 100 * (baseline - candidate) / baseline : 0;
    artifactReview = { ...artifactReview, status: improvementPercent >= 10 ? 'review-ready' : 'below-threshold', baselineIsolates: baseline, candidateIsolates: candidate, improvementPercent, thresholdPercent: 10, measurement: 'Unexplained graph isolates reduced by source evidenced runtime annotations', runtimeCompatibilityEstablished: false, newlyDiscoveredThisCycle: false };
  }

  const entry = { inputHash, sourceSha256: current.sourceBinding.sha256, checks: results.map(({ id, status }) => ({ id, status })), successfulChecks: results.filter(result => result.status === 'passed').length, complete, adoptionScore: null };
  return { schema: 'ruflo-ecosystem-rsi-result/v1', plan, ...execution, gate, artifactReview, nextActions: current.findings.map(finding => ({ ...finding, nextAction: 'Review source evidence, propose a bounded patch, rerun registered checks and source-bound measurement before adoption' })), deduplicated: ledger.some(item => item.inputHash === inputHash), ledger: [...ledger.filter(item => item.inputHash !== inputHash), entry] };
}

export async function verifySourceBinding(plan, { repoRoot }) {
  const root = await realpath(repoRoot);
  if (!plan?.sourceBinding?.files) throw new Error('Missing source binding');
  const current = await binding(root, Object.keys(plan.sourceBinding.files));
  if (current.sha256 !== plan.sourceBinding.sha256) throw new Error('Stale plan source binding');
  return true;
}
