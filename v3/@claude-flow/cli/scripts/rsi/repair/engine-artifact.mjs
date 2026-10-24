#!/usr/bin/env node
/** Build and attest a quarantined isolation-engine artifact. Never launches a namespace. */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { chmodSync, closeSync, constants, fsyncSync, lstatSync, mkdirSync, openSync, readFileSync,
  realpathSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseElfDynamic, parseElfInterpreter } from './runtime-layout.mjs';

const ROOT = dirname(fileURLToPath(import.meta.url));
const PLAN_PATH = join(ROOT, 'engine-build-plan.json');
const MAX_TEXT = 1024 * 1024;
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const stableHash = value => digest(Buffer.from(JSON.stringify(value)));
const exact = (value, keys, label) => assert(value && typeof value === 'object' && !Array.isArray(value) &&
  Object.keys(value).sort().join(',') === [...keys].sort().join(','), `${label} fields`);

export function validateEngineBuildPlan(plan) {
  exact(plan, ['schema','stagnationRule','source','build','artifact','proofBoundary','legacyMission'], 'plan');
  assert.equal(plan.schema, 'ruflo.repair-isolation-engine-build-plan/v1');
  assert.deepEqual(plan.source, {
    repository: 'https://github.com/containers/bubblewrap', releaseTag: 'v0.12.0',
    releasePublishedAt: '2026-08-26T10:11:18Z',
    releaseAssetUrl: 'https://github.com/containers/bubblewrap/releases/download/v0.12.0/bubblewrap-0.12.0.tar.xz',
    releaseAssetSha256: '9760d007363e3abba7c747489910f9f82d9fca53ba3bd3282e396fa3c97a3314',
    releaseCommit: '2a76602a8c71f36c1527cf9fc3417d9149822e0c',
    releaseTree: '021e149edf2e8b9f4a0339e0b5cc0075d299c9a9',
    tagObject: '014a04330642e5c870418beb621532cb896e0002', commitSignatureVerified: false,
    rejectedVersion: '0.10.0', rejectionReason: 'GHSA-pxhw-h44j-8pfx affects every version below 0.12.0',
  });
  assert.equal(plan.build.runner, 'ubuntu-24.04');
  assert.equal(plan.build.nodeVersion, '24.19.0');
  assert.deepEqual(plan.build.workflowActions, {
    checkout: '11d5960a326750d5838078e36cf38b85af677262',
    setupNode: '49933ea5288caeca8642d1e84afbd3f7d6820020',
    uploadArtifact: 'ea165f8d65b6e75b540449e92b4886f43607fa02',
  });
  assert.deepEqual(plan.artifact.requiredHelpArguments, ['--bind-fd','--ro-bind-fd','--ro-bind-data']);
  assert.equal(plan.artifact.forbiddenLaunchArgument, '--not-a-security-boundary');
  assert.deepEqual(plan.proofBoundary, { engineArtifactOnly: true, nativeFdSemanticsVerified: false,
    runtimeCompatibilityVerified: false, osIsolationVerified: false, resourceAuthorizationPresent: false,
    candidateExecutionEnabled: false, boundedRsiEvidenceAccepted: false });
  assert.deepEqual(plan.legacyMission, { head: '5a0e219e871fcf616209807c828c5793c29752f8d190fc38a0bc95e4db88422e',
    nativeFieldCallsReserved: 209784, epochsConsumed: 7,
    originalAnchor: 'c5c6da0b728c52414f2dff86f9d23121776d600defff0f214f1502a091f69088' });
  return { planHash: stableHash(plan), candidateExecutionEnabled: false };
}

export function validateEngineBuildReservation(planPath, reservationPath, repositoryRoot) {
  assert(isAbsolute(planPath) && isAbsolute(reservationPath) && isAbsolute(repositoryRoot), 'absolute reservation inputs');
  const planBytes = readFileSync(planPath), plan = JSON.parse(planBytes);
  validateEngineBuildPlan(plan);
  const reservationBytes = readFileSync(reservationPath), reservation = JSON.parse(reservationBytes);
  exact(reservation, ['schema','mission','parentHead','planSha256','plannedSourceFiles','upstream','startedAt','scope',
    'reservedEngineeringParentProcessStarts','reservedObservedChildProcessStarts','reservedWallMs',
    'repairCandidateEvaluations','isolatedProcessStarts','nativeFieldCalls','externalProviderSpendUsd','totalUsd',
    'retainOnInterruption','missionBudgetChanged','resourceAuthorizationPresent','candidateExecutionEnabled',
    'boundedRsiEvidenceAccepted'], 'reservation');
  assert.equal(reservation.schema, 'ruflo.repair-engine-artifact-engineering-reservation/v1');
  assert.equal(reservation.planSha256, digest(planBytes), 'reserved plan bytes');
  assert.deepEqual(reservation.upstream, {
    rejectedVersion: plan.source.rejectedVersion, advisory: 'GHSA-pxhw-h44j-8pfx',
    selectedVersion: '0.12.0', releaseCommit: plan.source.releaseCommit,
    releaseTree: plan.source.releaseTree, releaseAssetSha256: plan.source.releaseAssetSha256,
  });
  assert(Object.keys(reservation.plannedSourceFiles).length >= 3, 'complete planned source set');
  for (const [path, expected] of Object.entries(reservation.plannedSourceFiles)) {
    assert(/^[a-f0-9]{64}$/.test(expected) && !path.startsWith('/') && !path.split('/').includes('..'), 'safe source binding');
    assert.equal(digest(readFileSync(join(repositoryRoot, path))), expected, `reserved source bytes: ${path}`);
  }
  assert.equal(reservation.repairCandidateEvaluations, 0); assert.equal(reservation.isolatedProcessStarts, 0);
  assert.equal(reservation.nativeFieldCalls, 0); assert.equal(reservation.externalProviderSpendUsd, 0);
  assert.equal(reservation.totalUsd, null); assert.equal(reservation.retainOnInterruption, true);
  assert.equal(reservation.missionBudgetChanged, false); assert.equal(reservation.resourceAuthorizationPresent, false);
  assert.equal(reservation.candidateExecutionEnabled, false); assert.equal(reservation.boundedRsiEvidenceAccepted, false);
  return { reservationHash: digest(reservationBytes), reservation, plan };
}

function runObserved(command, args, options, costs) {
  const started = performance.now();
  const child = spawnSync(command, args, { cwd: options.cwd, env: options.env ?? process.env,
    encoding: options.encoding ?? 'utf8', timeout: options.timeout ?? 120000,
    maxBuffer: options.maxBuffer ?? MAX_TEXT, shell: false, killSignal: 'SIGKILL' });
  costs.observedChildProcessStarts += child.pid > 0 ? 1 : 0;
  costs.summedChildWallMs += performance.now() - started;
  costs.childAttempts += 1;
  assert.equal(child.error, undefined, `${command} spawn error`);
  assert.equal(child.signal, null, `${command} signal`);
  assert.equal(child.status, 0, `${command} exit status: ${child.stderr ?? ''}`);
  return child.stdout ?? '';
}

function durableNew(path, value) {
  const fd = openSync(path, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
  try { writeFileSync(fd, JSON.stringify(value, null, 2) + '\n'); fsyncSync(fd); }
  finally { closeSync(fd); }
  const parent = openSync(dirname(path), 'r'); try { fsyncSync(parent); } finally { closeSync(parent); }
}

function packageVersions(packages, costs) {
  return packages.map(name => ({ name, version: runObserved('dpkg-query', ['-W', '-f=${Version}', name], {}, costs).trim() }));
}

export function validateEngineObservation(plan, observation) {
  validateEngineBuildPlan(plan);
  exact(observation, ['sourceAssetSha256','sourceAssetBytes','versionStdout','helpStdout','binary','elf','toolchain','runner','costs'], 'observation');
  assert.equal(observation.sourceAssetSha256, plan.source.releaseAssetSha256);
  assert(Number.isSafeInteger(observation.sourceAssetBytes) && observation.sourceAssetBytes > 0);
  assert.equal(observation.versionStdout, plan.artifact.expectedVersionStdout);
  for (const flag of plan.artifact.requiredHelpArguments) assert(observation.helpStdout.includes(flag), `missing ${flag}`);
  assert(!observation.binary.launchArguments.includes(plan.artifact.forbiddenLaunchArgument), 'unsafe launch argument');
  assert(/^[a-f0-9]{64}$/.test(observation.binary.sha256));
  assert(observation.binary.size > 0 && observation.binary.size <= plan.artifact.maximumBytes);
  assert.equal(observation.binary.mode, 0o555);
  assert.equal(observation.binary.setuid, false); assert.equal(observation.binary.setgid, false);
  assert.equal(observation.elf.machine, 'x86_64');
  assert.equal(observation.elf.rpath.length, 0); assert.equal(observation.elf.runpath.length, 0);
  assert(observation.elf.needed.includes('libcap.so.2') && observation.elf.needed.includes('libc.so.6'));
  assert(!observation.elf.needed.includes('libselinux.so.1'), 'SELinux dependency must be disabled');
  assert.equal(observation.runner.imageOS, 'ubuntu24');
  assert.equal(observation.runner.architecture, 'x64');
  exact(observation.costs, ['childAttempts','observedChildProcessStarts','summedChildWallMs','bootstrapProcessStarts',
    'acquisitionBytes','acquisitionUsd','buildRunnerUsd','modelCalls','candidateEvaluations','isolatedProcessStarts',
    'nativeFieldCalls','externalProviderSpendUsd','totalUsd'], 'costs');
  assert(Number.isSafeInteger(observation.costs.childAttempts) && observation.costs.childAttempts > 0);
  assert.equal(observation.costs.observedChildProcessStarts, observation.costs.childAttempts);
  assert(Number.isFinite(observation.costs.summedChildWallMs) && observation.costs.summedChildWallMs >= 0);
  assert.equal(observation.costs.bootstrapProcessStarts, null);
  assert.equal(observation.costs.acquisitionBytes, observation.sourceAssetBytes);
  assert.equal(observation.costs.acquisitionUsd, null); assert.equal(observation.costs.buildRunnerUsd, null);
  assert.equal(observation.costs.modelCalls, 0); assert.equal(observation.costs.nativeFieldCalls, 0);
  assert.equal(observation.costs.candidateEvaluations, 0);
  assert.equal(observation.costs.isolatedProcessStarts, 0);
  assert.equal(observation.costs.externalProviderSpendUsd, 0);
  assert.equal(observation.costs.totalUsd, null);
  return { artifactSha256: observation.binary.sha256, candidateExecutionEnabled: false };
}

export function recordEngineArtifact(workRoot, receiptPath, planPath = PLAN_PATH) {
  assert(isAbsolute(workRoot) && isAbsolute(receiptPath), 'absolute paths required');
  const repositoryRoot = process.env.GITHUB_WORKSPACE ? realpathSync(process.env.GITHUB_WORKSPACE) : null;
  const reservationPath = process.env.RUFLO_ENGINE_RESERVATION;
  assert(repositoryRoot && reservationPath && isAbsolute(reservationPath), 'durable CI reservation required');
  const reservationCheck = validateEngineBuildReservation(planPath, reservationPath, repositoryRoot);
  const plan = reservationCheck.plan;
  const { planHash } = validateEngineBuildPlan(plan);
  const invocation = {
    repository: process.env.GITHUB_REPOSITORY ?? null, headSha: process.env.RUFLO_ENGINE_HEAD_SHA ?? null,
    eventName: process.env.GITHUB_EVENT_NAME ?? null, runId: process.env.GITHUB_RUN_ID ?? null,
    runAttempt: process.env.GITHUB_RUN_ATTEMPT ?? null, workflowRef: process.env.GITHUB_WORKFLOW_REF ?? null,
    workflowFileSha256: digest(readFileSync(join(repositoryRoot, '.github/workflows/rsi-engine-artifact.yml'))),
  };
  assert.equal(invocation.repository, 'ruvnet/ruflo'); assert.match(invocation.headSha ?? '', /^[a-f0-9]{40}$/);
  assert.equal(invocation.eventName, 'pull_request'); assert.match(invocation.runId ?? '', /^[1-9][0-9]*$/);
  assert.match(invocation.runAttempt ?? '', /^[1-9][0-9]*$/);
  assert(invocation.workflowRef?.includes('/.github/workflows/rsi-engine-artifact.yml@'));
  mkdirSync(workRoot, { recursive: false, mode: 0o700 });
  const sourceArchive = join(workRoot, 'bubblewrap.tar.xz');
  const source = join(workRoot, 'source'), build = join(workRoot, 'build'), artifact = join(workRoot, 'artifact');
  mkdirSync(source, { mode: 0o700 }); mkdirSync(artifact, { mode: 0o700 });
  const costs = { childAttempts: 0, observedChildProcessStarts: 0, summedChildWallMs: 0 };
  runObserved('curl', ['--proto', '=https', '--tlsv1.2', '--fail', '--location', '--silent', '--show-error',
    '--output', sourceArchive, plan.source.releaseAssetUrl], {}, costs);
  const archive = readFileSync(sourceArchive);
  assert.equal(digest(archive), plan.source.releaseAssetSha256, 'release asset SHA-256');
  runObserved('tar', ['--extract','--xz','--file',sourceArchive,'--directory',source,'--strip-components=1',
    '--no-same-owner','--no-same-permissions'], {}, costs);
  const mesonArgs = ['setup', build, source, ...plan.build.mesonOptions];
  runObserved('meson', mesonArgs, {}, costs);
  runObserved('meson', ['compile','-C',build], {}, costs);
  const built = join(build, 'bwrap'), bytes = readFileSync(built), output = join(artifact, 'bwrap');
  assert(bytes.length <= plan.artifact.maximumBytes, 'bounded engine artifact');
  const fd = openSync(output, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o555);
  try { writeFileSync(fd, bytes); fsyncSync(fd); } finally { closeSync(fd); }
  chmodSync(output, 0o555);
  const stat = lstatSync(output), dynamic = parseElfDynamic(bytes);
  const versionStdout = runObserved(output, ['--version'], { cwd: '/' }, costs);
  const helpStdout = runObserved(output, ['--help'], { cwd: '/' }, costs);
  const tools = {};
  for (const [name, command, args] of [
    ['node', process.execPath, ['--version']], ['meson','meson',['--version']], ['ninja','ninja',['--version']],
    ['cc','cc',['--version']], ['ld','ld',['--version']], ['pkgConfig','pkg-config',['--version']],
  ]) tools[name] = runObserved(command, args, {}, costs).split('\n')[0];
  const observation = {
    sourceAssetSha256: digest(archive), sourceAssetBytes: archive.length, versionStdout, helpStdout,
    binary: { path: 'artifact/bwrap', sha256: digest(bytes), size: bytes.length, mode: stat.mode & 0o777,
      setuid: Boolean(stat.mode & 0o4000), setgid: Boolean(stat.mode & 0o2000), launchArguments: [] },
    elf: { machine: 'x86_64', interpreter: parseElfInterpreter(bytes), needed: dynamic.needed,
      soname: dynamic.soname, rpath: dynamic.rpath, runpath: dynamic.runpath },
    toolchain: { tools, packages: packageVersions(plan.build.aptPackages, costs), mesonArguments: mesonArgs },
    runner: { imageOS: process.env.ImageOS ?? null, imageVersion: process.env.ImageVersion ?? null,
      architecture: process.arch },
    costs: { ...costs, bootstrapProcessStarts: null, acquisitionBytes: archive.length,
      acquisitionUsd: null, buildRunnerUsd: null, modelCalls: 0, candidateEvaluations: 0,
      isolatedProcessStarts: 0, nativeFieldCalls: 0, externalProviderSpendUsd: 0, totalUsd: null },
  };
  validateEngineObservation(plan, observation);
  const receipt = { schema: 'ruflo.repair-isolation-engine-artifact/v1', planHash,
    invocation, reservation: { path: reservationPath.slice(repositoryRoot.length + 1),
      sha256: reservationCheck.reservationHash, parentHead: reservationCheck.reservation.parentHead },
    source: plan.source, observation, proofBoundary: plan.proofBoundary,
    legacyMission: plan.legacyMission, candidateExecutionEnabled: false, boundedRsiEvidenceAccepted: false };
  durableNew(receiptPath, receipt);
  return receipt;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const [command, workRoot, receiptPath] = process.argv.slice(2);
    if (command !== 'build' || !workRoot || !receiptPath || process.argv.length !== 5)
      throw Error('usage: engine-artifact.mjs build NEW_ABSOLUTE_WORK_ROOT NEW_ABSOLUTE_RECEIPT');
    console.log(JSON.stringify(recordEngineArtifact(resolve(workRoot), resolve(receiptPath)), null, 2));
  } catch (error) { console.error(error.stack ?? error.message); process.exitCode = 1; }
}
