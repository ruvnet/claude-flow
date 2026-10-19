#!/usr/bin/env node
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRsiPlan, verifySourceBinding } from './lib/ecosystem-rsi.mjs';
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
export async function buildWebReceipt(receipt, repoRoot) {
  await verifySourceBinding(receipt.plan, { repoRoot });
  const fresh = await createRsiPlan({ repoRoot, ...receipt.plan.inputs, changed: receipt.plan.changed, maxChecks: receipt.plan.maxChecks });
  if (fresh.inputHash !== receipt.inputHash || fresh.inputHash !== receipt.plan.inputHash || receipt.sourceUnchanged !== true) throw new Error('Invalid or stale execution identity');
  const registryBytes = await readFile(resolve(repoRoot, fresh.inputs.registryPath));
  const registry = JSON.parse(registryBytes), results = new Map();
  for (const result of receipt.results) {
    if (results.has(result.id) || !fresh.selectedChecks.some(check => check.id === result.id) || !['passed', 'failed', 'timedout'].includes(result.status)) throw new Error('Invalid check receipt');
    results.set(result.id, result);
  }
  const capabilities = registry.capabilities.map(capability => {
    const checks = capability.checks.map(id => results.get(id));
    const status = checks.length && checks.every(check => check?.status === 'passed') ? 'passed' : checks.some(check => check && check.status !== 'passed') ? 'failed' : 'unknown';
    return { id: capability.id, kind: capability.kind, status, availability: 'not-probed', evidence: checks.filter(Boolean).map(check => `${check.id}: ${check.status}`) };
  });
  return { schema: 'ruflo-ecosystem-web/v1', generatedAt: new Date().toISOString(), provenance: { verified: true, semantics: 'Local source identity verification, not signed authorship or runtime availability', dependencySnapshotSha256: hash(await readFile(resolve(repoRoot, fresh.inputs.graphPath))), runtimeSnapshotSha256: fresh.inputs.runtimePath ? hash(await readFile(resolve(repoRoot, fresh.inputs.runtimePath))) : null, registrySha256: hash(registryBytes), sourceSha256: fresh.sourceBinding.sha256, executionInputHash: receipt.inputHash }, capabilities,
    cycle: { ...receipt.loop, checks: receipt.results.map(({ id, status, durationMs }) => ({ id, status, durationMs })), gate: receipt.gate, artifactReview: receipt.artifactReview, affectedPackages: fresh.affected.length, uncoveredPackages: fresh.uncoveredPackages, registeredPackageCount: fresh.affected.length - fresh.unregisteredPackages.length },
    proposals: receipt.nextActions.slice(0, 100), adoption: { measured: false, reason: 'No usage telemetry collected; downloads are not unique users.' } };
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const receipt = JSON.parse(await readFile(process.argv[2] ?? 'data/ecosystem-rsi.latest.json', 'utf8'));
  const output = process.argv[3] ?? 'data/ecosystem-web.latest.json';
  const result = await buildWebReceipt(receipt, process.cwd());
  await writeFile(output, JSON.stringify(result, null, 2) + '\n');
  console.log(JSON.stringify({ output, capabilities: result.capabilities.length, passed: result.capabilities.filter(c => c.status === 'passed').length }));
}
