import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { chmodSync, fstatSync, lstatSync, mkdtempSync, mkdirSync, readSync, renameSync, rmSync,
  symlinkSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { withFdBoundLaunch } from './fd-launch.mjs';

const hash = bytes => createHash('sha256').update(bytes).digest('hex');

for (const role of ['engine', 'candidate']) {
  test(`FIFO substitution at ${role} rejects before launch without blocking`, { skip: process.platform !== 'linux' }, () => fixture(({ launch, bindings }) => {
    const path = bindings[role].path;
    unlinkSync(path);
    const made = spawnSync('mkfifo', ['--', path], { timeout: 1000, encoding: 'utf8', shell: false });
    assert.equal(made.status, 0, made.stderr);
    // A separate bounded child prevents a regressed blocking open from hanging CI.
    // Only the descriptor validator runs: the launch callback must never execute.
    const script = `import assert from 'node:assert/strict';
      import { withFdBoundLaunch } from ${JSON.stringify(new URL('./fd-launch.mjs', import.meta.url).href)};
      let called = false;
      assert.throws(() => withFdBoundLaunch(${JSON.stringify(launch)}, ${JSON.stringify(bindings)},
        () => { called = true; }), /regular file/);
      assert.equal(called, false);`;
    const checked = spawnSync(process.execPath, ['--input-type=module', '-e', script],
      { timeout: 1000, killSignal: 'SIGKILL', maxBuffer: 4096, encoding: 'utf8', shell: false });
    assert.equal(checked.error, undefined, checked.error?.message);
    assert.equal(checked.status, 0, checked.stderr);
  }));
}
function readAt(fd, size) { const out = Buffer.alloc(size); assert.equal(readSync(fd, out, 0, size, 0), size); return out; }

function fixture(fn) {
  const root = mkdtempSync(join(tmpdir(), 'ruflo-fd-launch-'));
  const engine = join(root, 'bwrap'), usr = join(root, 'usr'), node = join(root, 'node');
  const candidate = join(root, 'candidate'), output = join(root, 'output');
  mkdirSync(usr); mkdirSync(node); mkdirSync(candidate); mkdirSync(output);
  writeFileSync(engine, 'reviewed-engine'); chmodSync(engine, 0o555);
  const probe = join(candidate, 'probe.mjs'); writeFileSync(probe, 'reviewed-probe', { mode: 0o600 });
  const launch = { schema: 'ruflo.repair-isolation-launch/v2', command: engine,
    args: ['--ro-bind', usr, '/usr', '--ro-bind', node, '/opt/node',
      '--ro-bind', candidate, '/workspace', '--bind', output, '/output',
      '/opt/node/bin/node', '/workspace/probe.mjs'], shell: false, candidateExecutionEnabled: false };
  const bindings = {
    engine: { path: engine, sha256: hash(Buffer.from('reviewed-engine')), size: 15, mode: 0o555,
      nativeBindFdSemanticsVerified: true },
    runtimeMounts: [{ source: usr, target: '/usr' }, { source: node, target: '/opt/node' }],
    candidate: { directory: candidate, path: probe, target: '/workspace/probe.mjs',
      sha256: hash(Buffer.from('reviewed-probe')), size: 14, mode: 0o600 },
    output: { path: output, target: '/output' },
  };
  try { return fn({ root, engine, usr, node, candidate, probe, output, launch, bindings }); }
  finally { rmSync(root, { recursive: true, force: true }); }
}

test('binds engine, runtime roots, fixed probe and output through inherited descriptors', () => fixture(({ launch, bindings }) => {
  const value = withFdBoundLaunch(launch, bindings, (bound, options) => {
    assert.equal(bound.command, '/proc/self/fd/3');
    assert.deepEqual(bound.args.slice(0, 6),
      ['--ro-bind-fd','4','/usr','--ro-bind-fd','5','/opt/node']);
    assert(bound.args.join(' ').includes('--dir /workspace --ro-bind-data 6 /workspace/probe.mjs'));
    assert(bound.args.join(' ').includes('--bind-fd 7 /output'));
    assert.deepEqual(options.stdio.slice(0, 3), ['ignore','pipe','pipe']);
    assert.equal(options.stdio.length, 8);
    assert.equal(bound.descriptorBindings.length, 5);
    assert.equal(bound.pathnameReplacementExcluded, true);
    assert.equal(bound.sameUidContentMutationExcluded, false);
    assert.equal(bound.candidateExecutionEnabled, false);
    return 'bound';
  });
  assert.equal(value, 'bound');
}));

test('Bubblewrap 0.9-style pathname binds are refused even when descriptors are open', () => fixture(({ launch, bindings }) => {
  const unsupported = structuredClone(bindings);
  delete unsupported.engine.nativeBindFdSemanticsVerified;
  assert.throws(() => withFdBoundLaunch(launch, unsupported, () => {}),
    /reviewed Bubblewrap native bind-fd semantics required/);
}));

test('opened engine and probe survive pathname replacement with original bytes', () => fixture(({ engine, probe, launch, bindings }) => {
  withFdBoundLaunch(launch, bindings, (_bound, { parentFds }) => {
    renameSync(engine, `${engine}.old`); writeFileSync(engine, 'attacker-engine');
    unlinkSync(probe); writeFileSync(probe, 'attacker-probe', { mode: 0o600 });
    assert.equal(readAt(parentFds[0], 15).toString(), 'reviewed-engine');
    assert.equal(readAt(parentFds[3], 14).toString(), 'reviewed-probe');
  });
}));

test('descriptor binding rejects substituted bytes, symlinks and ambiguous bind arguments', () => fixture(({ root, engine, launch, bindings }) => {
  const wrong = structuredClone(bindings); wrong.engine.sha256 = '0'.repeat(64);
  assert.throws(() => withFdBoundLaunch(launch, wrong, () => {}), /SHA-256/);
  const link = join(root, 'engine-link'); symlinkSync(engine, link);
  assert.throws(() => withFdBoundLaunch(launch, { ...bindings, engine: { ...bindings.engine, path: link } }, () => {}), /ELOOP/);
  const ambiguous = { ...launch, args: [...launch.args, '--ro-bind', bindings.runtimeMounts[0].source, '/usr'] };
  assert.throws(() => withFdBoundLaunch(ambiguous, bindings, () => {}), /exact bind occurrence/);
}));

test('a mount root replaced after validation is rejected by inode identity', () => fixture(({ usr, launch, bindings }) => {
  const stat = lstatSync(usr);
  bindings.runtimeMounts[0].descriptorIdentity = {
    dev: stat.dev.toString(), ino: stat.ino.toString(), mode: stat.mode, size: stat.size,
  };
  renameSync(usr, `${usr}.old`); mkdirSync(usr);
  assert.throws(() => withFdBoundLaunch(launch, bindings, () => {}), /opened descriptor identity/);
}));

test('all parent descriptors close when launch preparation or callback fails', () => fixture(({ launch, bindings }) => {
  let descriptors = [];
  assert.throws(() => withFdBoundLaunch(launch, bindings, (_bound, options) => {
    descriptors = [...options.parentFds]; throw Error('simulated spawn interruption');
  }), /simulated spawn interruption/);
  for (const fd of descriptors) assert.throws(() => fstatSync(fd), /EBADF/);
}));
