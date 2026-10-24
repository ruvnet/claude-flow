import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateEngineBuildPlan, validateEngineBuildReservation, validateEngineObservation } from './engine-artifact.mjs';

const ROOT = dirname(fileURLToPath(import.meta.url));
const plan = () => JSON.parse(readFileSync(join(ROOT, 'engine-build-plan.json'), 'utf8'));
const observation = () => ({
  sourceAssetSha256: plan().source.releaseAssetSha256, sourceAssetBytes: 126452,
  versionStdout: 'bubblewrap 0.12.0\n', helpStdout: '--bind-fd --ro-bind-fd --ro-bind-data --not-a-security-boundary',
  binary: { path: 'artifact/bwrap', sha256: 'a'.repeat(64), size: 80000, mode: 0o555,
    setuid: false, setgid: false, launchArguments: [] },
  elf: { machine: 'x86_64', interpreter: '/lib64/ld-linux-x86-64.so.2',
    needed: ['libcap.so.2','libc.so.6'], soname: null, rpath: [], runpath: [] },
  toolchain: { tools: {}, packages: [], mesonArguments: [] },
  runner: { imageOS: 'ubuntu24', imageVersion: '20260901.1', architecture: 'x64' },
  costs: { childAttempts: 17, observedChildProcessStarts: 17, summedChildWallMs: 1200,
    bootstrapProcessStarts: null, acquisitionBytes: 126452, acquisitionUsd: null, buildRunnerUsd: null,
    modelCalls: 0, candidateEvaluations: 0, isolatedProcessStarts: 0, nativeFieldCalls: 0,
    externalProviderSpendUsd: 0, totalUsd: null },
});

test('reviewed plan rejects the now-vulnerable 0.10 lineage and keeps every gate closed', () => {
  const result = validateEngineBuildPlan(plan());
  assert.match(plan().source.rejectionReason, /GHSA-pxhw-h44j-8pfx/);
  assert.match(result.planHash, /^[a-f0-9]{64}$/);
  assert.equal(result.candidateExecutionEnabled, false);
});

test('patched source-bound engine observation is admitted only as a quarantined artifact', () => {
  assert.deepEqual(validateEngineObservation(plan(), observation()), {
    artifactSha256: 'a'.repeat(64), candidateExecutionEnabled: false,
  });
});

test('older version, missing fd-bind surface, unsafe launch option, privilege bits and SELinux drift fail closed', () => {
  for (const mutate of [
    value => { value.versionStdout = 'bubblewrap 0.10.0\n'; },
    value => { value.helpStdout = '--bind-fd --ro-bind-data'; },
    value => { value.binary.launchArguments = ['--not-a-security-boundary']; },
    value => { value.binary.setuid = true; },
    value => { value.elf.needed.push('libselinux.so.1'); },
  ]) { const value = observation(); mutate(value); assert.throws(() => validateEngineObservation(plan(), value)); }
});

test('costs cannot hide repair, isolation, native or dollar consumption', () => {
  for (const [field, value] of [['candidateEvaluations',1],['isolatedProcessStarts',1],
    ['externalProviderSpendUsd',0.01],['totalUsd',0]]) {
    const item = observation(); item.costs[field] = value;
    assert.throws(() => validateEngineObservation(plan(), item));
  }
});

test('source, workflow action and legacy ledger substitutions fail closed', () => {
  for (const mutate of [
    value => { value.source.releaseAssetSha256 = '0'.repeat(64); },
    value => { value.build.workflowActions.checkout = '0'.repeat(40); },
    value => { value.legacyMission.nativeFieldCallsReserved = 0; },
  ]) { const value = plan(); mutate(value); assert.throws(() => validateEngineBuildPlan(value)); }
});

test('durable reservation binds every planned source byte before build', () => {
  const repositoryRoot = resolve(ROOT, '../../../../../..');
  const result = validateEngineBuildReservation(join(ROOT, 'engine-build-plan.json'),
    join(ROOT, '../evidence/loop-development/repair-engine-artifact-closure.reservation.json'), repositoryRoot);
  assert.match(result.reservationHash, /^[a-f0-9]{64}$/);
  assert.equal(result.reservation.candidateExecutionEnabled, false);
});
