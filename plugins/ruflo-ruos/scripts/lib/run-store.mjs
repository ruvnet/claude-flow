// @ts-check
/** Durable local recovery journal. It records identity and output cursors, never prompts or credentials. */
import { createHash, randomUUID } from 'node:crypto';
import { closeSync, existsSync, fsyncSync, fstatSync, lstatSync, mkdirSync, openSync, readFileSync, readdirSync, renameSync, unlinkSync, writeSync, ftruncateSync } from 'node:fs';
import { join } from 'node:path';
import { assertRunId, RUN_ID_RE } from './validate.mjs';
import { RuosError } from './types.mjs';

export const RUN_CONTRACT = 'ruflo.ruos-run/1';
export const OBSERVATION_CONTRACT = 'ruflo.ruos-observation/1';
const STATES = new Set(['starting', 'running', 'unknown', 'stopping', 'completed', 'failed', 'stopped']);
const CONNECTIONS = new Set(['healthy', 'disconnected', 'unknown']);
const MAX_RECORD_BYTES = 32 * 1024;
import { constants } from 'node:fs';
const nofollow = constants.O_NOFOLLOW ?? 0;

/** @typedef {{ missionId?: string, missionRevision?: number, worktree?: string, workspace?: string, commit?: string, sourceDigest?: string }} RunBinding */
/**
 * @typedef {object} RunRecord
 * @property {typeof RUN_CONTRACT} contract
 * @property {1} schemaVersion
 * @property {number} revision
 * @property {string} runId
 * @property {string} agentId
 * @property {string} agentType
 * @property {string} desktopId
 * @property {'jobs-api'|'exec-poll'} jobs
 * @property {'fleet-mcp'|'ssh'} transport
 * @property {string|null} jobId
 * @property {string} state
 * @property {'healthy'|'disconnected'|'unknown'} connection
 * @property {number} nextOffset
 * @property {number} localBytes
 * @property {string} startedAt
 * @property {string} updatedAt
 * @property {string} commandSha256
 * @property {number|null} exitCode
 * @property {number} timeoutSecs
 * @property {string|null} stopAt
 * @property {RunBinding} binding
 * @property {string} bindingDigest
 * @property {string=} error
 */

/** @param {unknown} input @returns {RunBinding} */
export function validateBinding(input = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new RuosError('invalid-input', 'binding must be an object');
  const raw = /** @type {Record<string, unknown>} */ (input);
  /** @type {Record<string, string|number>} */ const out = {};
  for (const [key, value] of Object.entries(raw)) {
    if (!['missionId', 'missionRevision', 'worktree', 'workspace', 'commit', 'sourceDigest'].includes(key)) throw new RuosError('invalid-input', `unsupported binding field ${key}`);
    if (key === 'missionRevision') {
      if (!Number.isSafeInteger(value) || Number(value) < 1) throw new RuosError('invalid-input', 'missionRevision must be positive');
      out[key] = Number(value);
    } else {
      if (typeof value !== 'string' || !value || value.length > 512 || /[\x00-\x1f\x7f-\x9f\u202a-\u202e\u2066-\u2069]/.test(value)) throw new RuosError('invalid-input', `invalid binding ${key}`);
      if (key === 'missionId' && !/^msn_[a-f0-9]{24}$/.test(value)) throw new RuosError('invalid-input', 'invalid missionId');
      if (key === 'commit' && !/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(value)) throw new RuosError('invalid-input', 'commit must be a full Git object id');
      if (key === 'sourceDigest' && !/^sha256:[a-f0-9]{64}$/.test(value)) throw new RuosError('invalid-input', 'sourceDigest must be sha256');
      out[key] = value;
    }
  }
  if (out.missionRevision !== undefined && out.missionId === undefined) throw new RuosError('invalid-input', 'missionRevision needs missionId');
  return out;
}

/** @param {RunBinding} binding */
export function bindingDigest(binding) {
  return `sha256:${createHash('sha256').update(JSON.stringify(Object.fromEntries(Object.entries(binding).sort(([a], [b]) => a.localeCompare(b))))).digest('hex')}`;
}

/** @param {unknown} input @returns {RunRecord} */
function validateRecord(input) {
  const r = /** @type {RunRecord} */ (input);
  if (!r || r.contract !== RUN_CONTRACT || r.schemaVersion !== 1) throw new RuosError('invalid-input', 'invalid persisted run contract');
  assertRunId(r.runId);
  if (!Number.isSafeInteger(r.revision) || r.revision < 1 || !Number.isSafeInteger(r.nextOffset) || r.nextOffset < 0 || !Number.isSafeInteger(r.localBytes) || r.localBytes < 0) throw new RuosError('invalid-input', 'invalid run revision or cursor');
  if (!STATES.has(r.state) || !CONNECTIONS.has(r.connection) || !['jobs-api', 'exec-poll'].includes(r.jobs) || !['fleet-mcp', 'ssh'].includes(r.transport)) throw new RuosError('invalid-input', 'invalid run state or transport');
  for (const id of [r.agentId, r.agentType, r.desktopId]) if (typeof id !== 'string' || !/^[A-Za-z0-9._:-]{1,128}$/.test(id)) throw new RuosError('invalid-input', 'invalid persisted run identity');
  if (r.jobId !== null && (typeof r.jobId !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(r.jobId))) throw new RuosError('invalid-input', 'invalid persisted job id');
  if (!Number.isSafeInteger(r.timeoutSecs) || r.timeoutSecs < 1 || !Number.isFinite(Date.parse(r.startedAt)) || !Number.isFinite(Date.parse(r.updatedAt))) throw new RuosError('invalid-input', 'invalid persisted run time');
  if (r.exitCode !== null && !Number.isSafeInteger(r.exitCode)) throw new RuosError('invalid-input', 'invalid persisted exit code');
  if (typeof r.commandSha256 !== 'string' || (r.commandSha256 !== '' && !/^[a-f0-9]{64}$/.test(r.commandSha256))) throw new RuosError('invalid-input', 'invalid command digest');
  const binding = validateBinding(r.binding);
  if (r.bindingDigest !== bindingDigest(binding)) throw new RuosError('invalid-input', 'run binding digest mismatch');
  return { ...r, binding };
}

/** @param {string} file @param {string} text */
function atomic(file, text) {
  const tmp = `${file}.${randomUUID()}.tmp`;
  const fd = openSync(tmp, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | nofollow, 0o600);
  try { const b = Buffer.from(text); let n = 0; while (n < b.length) n += writeSync(fd, b, n, b.length - n); fsyncSync(fd); }
  finally { closeSync(fd); }
  renameSync(tmp, file);
}

/** @param {number} pid */
function processIdentity(pid) {
  try {
    const stat = readFileSync(`/proc/${pid}/stat`, 'utf8');
    return `${readFileSync('/proc/sys/kernel/random/boot_id', 'utf8').trim()}:${stat.slice(stat.lastIndexOf(')') + 2).split(' ')[19]}`;
  } catch { return null; }
}

export class RunStore {
  /** @param {string} cwd @param {() => Date=} now */
  constructor(cwd, now = () => new Date()) {
    this.dir = join(cwd, '.claude-flow', 'ruos');
    this.runsDir = join(this.dir, 'runs');
    this.now = now;
  }

  ensure() {
    for (const dir of [join(this.dir, '..'), this.dir, this.runsDir]) {
      try { mkdirSync(dir, { mode: 0o700 }); } catch (e) { if (e.code !== 'EEXIST') throw e; }
      const stat = lstatSync(dir);
      if (stat.isSymbolicLink() || !stat.isDirectory()) throw new RuosError('invalid-input', 'run store directories must be real directories');
    }
  }

  /** One short synchronous critical section covers journal, output and aggregate observation. No remote calls under this lock. @template T @param {() => T} fn @returns {T} */
  locked(fn) {
    this.ensure();
    const lock = join(this.dir, 'runs.lock');
    let fd;
    for (let attempt = 0; ; attempt++) {
      try { fd = openSync(lock, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | nofollow, 0o600); break; }
      catch (err) {
        if (/** @type {NodeJS.ErrnoException} */ (err).code !== 'EEXIST' || attempt > 1) throw new RuosError('run-busy', 'run journal has another writer; retry after it finishes');
        // Serialize stale-owner reclamation separately. Without this fence two reclaimers could unlink a new writer's lock.
        const recovery = join(this.dir, 'runs.recovery.lock');
        let guard;
        try { guard = openSync(recovery, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | nofollow, 0o600); }
        catch { throw new RuosError('run-busy', 'run journal recovery is busy; retry or reconcile its lock'); }
        try {
          if (!existsSync(lock)) continue;
          let owner;
          try { owner = JSON.parse(this.readRegular(lock)); } catch { throw new RuosError('run-busy', 'run journal lock needs operator reconciliation'); }
          if (!Number.isSafeInteger(owner.pid) || owner.pid < 1) throw new RuosError('run-busy', 'run journal lock has invalid ownership');
          let dead = false;
          try { process.kill(owner.pid, 0); } catch (e) { dead = /** @type {NodeJS.ErrnoException} */ (e).code === 'ESRCH'; }
          const identity = processIdentity(owner.pid);
          if (!dead && (!identity || !owner.identity || identity === owner.identity)) throw new RuosError('run-busy', 'run journal has another writer; retry after it finishes');
          unlinkSync(lock);
        } finally { closeSync(guard); unlinkSync(recovery); }
      }
    }
    try {
      writeSync(fd, JSON.stringify({ pid: process.pid, identity: processIdentity(process.pid) })); fsyncSync(fd);
      return fn();
    } finally { closeSync(fd); unlinkSync(lock); }
  }

  /** @param {string} path */
  readRegular(path) {
    const fd = openSync(path, constants.O_RDONLY | nofollow);
    try { const stat = fstatSync(fd); if (!stat.isFile() || stat.size > MAX_RECORD_BYTES) throw new RuosError('invalid-input', 'invalid run journal file'); return readFileSync(fd, 'utf8'); }
    finally { closeSync(fd); }
  }

  /** @param {string} runId @returns {RunRecord|null} */
  read(runId) {
    this.ensure();
    const file = join(this.runsDir, `${assertRunId(runId)}.json`);
    if (!existsSync(file)) return null;
    return validateRecord(JSON.parse(this.readRegular(file)));
  }

  /** @returns {RunRecord[]} */
  list() {
    this.ensure();
    return readdirSync(this.runsDir).filter(n => n.endsWith('.json') && RUN_ID_RE.test(n.slice(0, -5))).flatMap(n => { const r = this.read(n.slice(0, -5)); return r ? [r] : []; }).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  /** @param {Omit<RunRecord, 'contract'|'schemaVersion'|'revision'|'nextOffset'|'localBytes'|'updatedAt'|'bindingDigest'>} input */
  reserve(input) {
    return this.locked(() => {
      if (this.read(input.runId)) throw new RuosError('run-exists', 'run id already exists; attach to reconcile it, never launch it again');
      const r = validateRecord({ ...input, contract: RUN_CONTRACT, schemaVersion: 1, revision: 1, nextOffset: 0, localBytes: 0, updatedAt: this.now().toISOString(), bindingDigest: bindingDigest(input.binding) });
      this.write(r); return r;
    });
  }

  /** @param {string} runId @param {Partial<Pick<RunRecord,'jobId'|'state'|'connection'|'commandSha256'|'exitCode'|'error'>>} patch @param {number=} expectedRevision */
  update(runId, patch, expectedRevision) {
    return this.locked(() => {
      const r = this.required(runId);
      if (expectedRevision !== undefined && expectedRevision !== r.revision) throw new RuosError('revision-conflict', 'run changed; refresh before acting');
      // A terminal identity is immutable; late polling must not revive it.
      if (['completed', 'failed', 'stopped'].includes(r.state)) return r;
      if (r.jobId !== null && patch.jobId !== undefined && patch.jobId !== r.jobId) throw new RuosError('binding-mismatch', 'job identity cannot change');
      const next = validateRecord({ ...r, ...patch, revision: r.revision + 1, updatedAt: this.now().toISOString() });
      this.write(next); return next;
    });
  }

  /** Persist bytes first, then cursor. A crash between them leaves a suffix that the next checkpoint truncates before replaying. @param {string} runId @param {{expectedOffset:number,nextOffset:number,chunk:Buffer}} input */
  checkpoint(runId, input) {
    return this.locked(() => {
      const r = this.required(runId);
      if (r.nextOffset !== input.expectedOffset) throw new RuosError('revision-conflict', 'another observer advanced this cursor; reload before polling');
      if (!Number.isSafeInteger(input.nextOffset) || input.nextOffset < r.nextOffset + input.chunk.length) throw new RuosError('invalid-input', 'remote output cursor regressed');
      const path = join(this.runsDir, `${r.runId}.log`);
      const fd = openSync(path, constants.O_CREAT | constants.O_RDWR | nofollow, 0o600);
      try {
        const stat = fstatSync(fd);
        if (!stat.isFile() || stat.size < r.localBytes) throw new RuosError('output-corrupt', 'local output is shorter than its committed cursor');
        ftruncateSync(fd, r.localBytes);
        let done = 0;
        while (done < input.chunk.length) done += writeSync(fd, input.chunk, done, input.chunk.length - done, r.localBytes + done);
        fsyncSync(fd);
      } finally { closeSync(fd); }
      const next = validateRecord({ ...r, nextOffset: input.nextOffset, localBytes: r.localBytes + input.chunk.length, revision: r.revision + 1, updatedAt: this.now().toISOString() });
      this.write(next); return next;
    });
  }

  /** Atomically consume a stop approval against the exact current record. @param {string} runId @param {number|undefined} revision @param {string|undefined} digest */
  requestStop(runId, revision, digest) {
    return this.locked(() => {
      const r = this.required(runId);
      if (revision !== r.revision || digest !== r.bindingDigest) throw new RuosError('revision-conflict', 'stale stop approval; refresh the run revision and binding digest');
      if (['completed', 'failed', 'stopped'].includes(r.state)) throw new RuosError('invalid-input', `run is ${r.state}`);
      const next = validateRecord({ ...r, state: 'stopping', revision: r.revision + 1, updatedAt: this.now().toISOString() });
      this.write(next); return next;
    });
  }

  /** @param {string} runId */
  required(runId) { const r = this.read(runId); if (!r) throw new RuosError('run-not-found', 'no durable run record; cannot infer remote identity'); return r; }

  /** @param {RunRecord} r */
  write(r) {
    atomic(join(this.runsDir, `${r.runId}.json`), `${JSON.stringify(r)}\n`);
    const runs = this.list();
    // No prompt, output, credential, raw error, or claim of remote worktree verification.
    const publicRuns = runs.slice(0, 50).map(({ runId, agentId, desktopId, jobId, jobs, state, connection, revision, nextOffset, startedAt, updatedAt, binding, bindingDigest, exitCode }) => ({ runId, agentId, desktopId, jobId, jobs, state, connection, revision, nextOffset, startedAt, updatedAt, binding, bindingDigest, exitCode }));
    let text;
    do {
      text = `${JSON.stringify({ contract: OBSERVATION_CONTRACT, schemaVersion: 1, observedAt: runs[0]?.updatedAt ?? null, truncated: runs.length > publicRuns.length, runs: publicRuns })}\n`;
      if (Buffer.byteLength(text) <= 128_000) break;
      publicRuns.pop();
    } while (publicRuns.length);
    // The fixed envelope alone is always below the cap.
    atomic(join(this.dir, 'observation.json'), text);
    for (const dir of [this.runsDir, this.dir]) {
      try { const fd = openSync(dir, constants.O_RDONLY); try { fsyncSync(fd); } finally { closeSync(fd); } } catch { /* platform lacks directory fsync */ }
    }
  }
}
