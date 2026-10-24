/** Descriptor-bound Bubblewrap launch construction.
 *
 * This closes pathname replacement between validation and spawn for the
 * isolation engine, fixed probe, runtime mount roots and output mount root,
 * but only with reviewed Bubblewrap native fd-bind semantics.
 * It deliberately does not claim immutable file contents against another
 * process with the same uid; that remains a runner-admission requirement.
 */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { closeSync, constants, fstatSync, openSync, readSync } from 'node:fs';

const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const MAX_PINNED_FILE_BYTES = 134217728;

function readPinnedBytes(fd, size, label) {
  assert(Number.isSafeInteger(size) && size >= 0 && size <= MAX_PINNED_FILE_BYTES,
    `${label} bounded size`);
  const bytes = Buffer.alloc(size);
  let offset = 0;
  while (offset < size) {
    const count = readSync(fd, bytes, offset, size - offset, offset);
    assert(count > 0, `${label} complete read`);
    offset += count;
  }
  return bytes;
}

function exactOccurrence(args, flag, source, target, label) {
  const matches = [];
  for (let index = 0; index + 2 < args.length; index++) {
    if (args[index] === flag && args[index + 1] === source && args[index + 2] === target) matches.push(index);
  }
  assert.equal(matches.length, 1, `${label} exact bind occurrence`);
  return matches[0];
}

function identity(stat) {
  return { dev: stat.dev.toString(), ino: stat.ino.toString(), mode: stat.mode, size: stat.size };
}

function assertIdentity(fd, expected, label) {
  assert.deepEqual(identity(fstatSync(fd)), expected, `${label} descriptor identity drift`);
}

function openFile(binding, label) {
  assert(binding && typeof binding.path === 'string' && /^[a-f0-9]{64}$/.test(binding.sha256), `${label} pinned file`);
  // A substituted FIFO must reach fstat without waiting for a writer. Regular
  // files retain positional-read semantics; non-regular descriptors are rejected.
  const fd = openSync(binding.path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const stat = fstatSync(fd);
    assert(stat.isFile(), `${label} regular file`);
    if (binding.descriptorIdentity)
      assert.deepEqual(identity(stat), binding.descriptorIdentity, `${label} opened descriptor identity`);
    assert.equal(stat.size, binding.size, `${label} size`);
    assert.equal(stat.mode & 0o777, binding.mode, `${label} mode`);
    // Positional reads leave the descriptor offset at zero. Bubblewrap's
    // --ro-bind-data consumes the fixed probe descriptor from that offset.
    assert.equal(digest(readPinnedBytes(fd, stat.size, label)), binding.sha256, `${label} SHA-256`);
    return { fd, identity: identity(stat) };
  } catch (error) { closeSync(fd); throw error; }
}

function openDirectory(path, label, expectedIdentity) {
  assert(typeof path === 'string' && path.startsWith('/'), `${label} absolute directory`);
  const fd = openSync(path, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
  try {
    const stat = fstatSync(fd);
    assert(stat.isDirectory(), `${label} directory`);
    if (expectedIdentity)
      assert.deepEqual(identity(stat), expectedIdentity, `${label} opened descriptor identity`);
    return { fd, identity: identity(stat) };
  } catch (error) { closeSync(fd); throw error; }
}

function childPath(childFd) { return `/proc/self/fd/${childFd}`; }

export function withFdBoundLaunch(launch, bindings, callback) {
  assert(launch?.schema === 'ruflo.repair-isolation-launch/v2' && launch.shell === false,
    'reviewed shell-free launch required');
  assert.equal(launch.candidateExecutionEnabled, false);
  assert.equal(typeof callback, 'function');
  assert(bindings?.engine && Array.isArray(bindings.runtimeMounts) && bindings.runtimeMounts.length === 2,
    'complete descriptor bindings required');
  assert.equal(bindings.engine.nativeBindFdSemanticsVerified, true,
    'reviewed Bubblewrap native bind-fd semantics required');
  assert(bindings.candidate?.target === '/workspace/probe.mjs', 'fixed probe target required');
  assert(bindings.output?.target === '/output', 'fixed output target required');

  const opened = [];
  const addFile = (value, label) => { const item = openFile(value, label); opened.push({ ...item, label }); return item; };
  const addDirectory = (path, label, expected) => { const item = openDirectory(path, label, expected); opened.push({ ...item, label }); return item; };
  try {
    const engine = addFile(bindings.engine, 'engine');
    const runtime = bindings.runtimeMounts.map((mount, index) => ({
      ...mount, opened: addDirectory(mount.source, `runtime mount ${index}`, mount.descriptorIdentity),
    }));
    const candidate = addFile(bindings.candidate, 'fixed probe');
    const output = addDirectory(bindings.output.path, 'output', bindings.output.descriptorIdentity);
    const childFds = opened.map((_, index) => 3 + index);
    const args = [...launch.args];

    runtime.forEach((mount, index) => {
      const at = exactOccurrence(args, '--ro-bind', mount.source, mount.target, `runtime mount ${index}`);
      args.splice(at, 3, '--ro-bind-fd', String(childFds[1 + index]), mount.target);
    });
    const candidateAt = exactOccurrence(args, '--ro-bind', bindings.candidate.directory,
      '/workspace', 'candidate mount');
    args.splice(candidateAt, 3, '--dir', '/workspace', '--ro-bind-data',
      String(childFds[3]), bindings.candidate.target);
    const outputAt = exactOccurrence(args, '--bind', bindings.output.path, bindings.output.target, 'output mount');
    args.splice(outputAt, 3, '--bind-fd', String(childFds[4]), bindings.output.target);

    opened.forEach(item => assertIdentity(item.fd, item.identity, item.label));
    const stdio = ['ignore', 'pipe', 'pipe', ...opened.map(item => item.fd)];
    const descriptorBindings = opened.map((item, index) => ({
      role: item.label, childFd: childFds[index], identity: item.identity,
    }));
    const bound = { ...launch, command: childPath(childFds[0]), args,
      descriptorBound: true, descriptorBindings,
      pathnameReplacementExcluded: true, sameUidContentMutationExcluded: false,
      candidateExecutionEnabled: false };
    return callback(bound, { stdio, parentFds: opened.map(item => item.fd) });
  } finally {
    for (const item of opened.reverse()) closeSync(item.fd);
  }
}
