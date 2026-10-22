import './helpers/isolated-policy-trust.js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { appendFileSync, existsSync, mkdtempSync, mkdirSync, readFileSync, realpathSync, rmSync, symlinkSync, unlinkSync, utimesSync, writeFileSync } from 'node:fs';
import { execFileSync, spawn } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { policyTrustRoot } from '../src/services/policy-ledger-anchor.js';
import { acquireLock, autoMigratePolicyStateIfNeeded, evaluatePolicyRequest, verifyPolicyLedger, withPolicyTransaction } from '../src/services/policy-runtime.js';

const io = vi.hoisted(() => ({ events: [] as string[], files: new Map<number, string>(), failSync: false, failState: false, failRenameSuffix: '', failStateDirSync: false, failAnchorStream: false }));
vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>();
  return {
    ...actual,
    openSync: (...args: Parameters<typeof actual.openSync>) => { const fd = actual.openSync(...args); io.files.set(fd, String(args[0])); return fd; },
    closeSync: (fd: number) => { io.files.delete(fd); return actual.closeSync(fd); },
    fsyncSync: (fd: number) => {
      const file = io.files.get(fd) ?? '?'; io.events.push(`sync:${file}`);
      if (io.failStateDirSync && io.events[io.events.length - 2] === `rename:${join(file, 'state.json')}`) throw Object.assign(new Error('injected state parent sync failure'), { code: 'EACCES' });
      if (io.failSync && file.endsWith('receipts.ledger.jsonl')) throw Object.assign(new Error('injected archive sync failure'), { code: 'EIO' });
      return actual.fsyncSync(fd);
    },
    writeSync: (fd: number, ...args: any[]) => {
      const file = io.files.get(fd) ?? '';
      if (io.failAnchorStream && file.includes('ledger-anchors.json.') && file.endsWith('.tmp')) throw new Error('injected anchor stream failure');
      return (actual.writeSync as (...args: any[]) => number)(fd, ...args);
    },
    renameSync: (from: string, to: string) => {
      io.events.push(`rename:${to}`);
      if (io.failRenameSuffix && to.endsWith(io.failRenameSuffix)) throw new Error('injected anchor publication failure');
      if (io.failState && to.endsWith('state.json')) throw Object.assign(new Error('injected state publication failure'), { code: 'EIO' });
      return actual.renameSync(from, to);
    },
  };
});

const roots: string[] = [];
const dir = (root: string) => join(root, '.claude-flow', 'policy');
const archive = (root: string) => join(dir(root), 'receipts.ledger.jsonl');
const state = (root: string) => join(dir(root), 'state.json');
function root() { const result = mkdtempSync(join(tmpdir(), 'ruflo-3892-integrity-')); roots.push(result); mkdirSync(join(result, '.claude-flow')); return result; }
async function decide(project: string, id: number) {
  return evaluatePolicyRequest({ identity: { id: `agent:${id}`, type: 'agent' }, action: { type: 'code.read', resource: `café-${id}` } }, project);
}
async function ledger(signed = false) {
  if (signed) { process.env.CLAUDE_FLOW_POLICY_SIGNING_KEY = 'disposable-regression-key'; process.env.CLAUDE_FLOW_POLICY_KEY_ID = 'original-custom-id'; }
  process.env.CLAUDE_FLOW_POLICY_LEDGER_RETENTION = '2';
  const project = root(); await autoMigratePolicyStateIfNeeded(project);
  for (let i = 0; i < 6; i++) await decide(project, i);
  return project;
}
function records(project: string) { return readFileSync(archive(project), 'utf8').trim().split('\n').map(line => JSON.parse(line)); }
afterEach(() => {
  io.failSync = io.failState = io.failStateDirSync = io.failAnchorStream = false; io.failRenameSuffix = ''; io.events.length = 0;
  for (const project of roots.splice(0)) {
    const id = createHash('sha256').update(realpathSync(project)).digest('hex');
    rmSync(join(policyTrustRoot(), id), { recursive: true, force: true });
    rmSync(project, { recursive: true, force: true });
  }
  delete process.env.CLAUDE_FLOW_POLICY_SIGNING_KEY; delete process.env.CLAUDE_FLOW_POLICY_KEY_ID; delete process.env.CLAUDE_FLOW_POLICY_LEDGER_RETENTION;
});

describe('authenticate every physical archive record before deduplication', () => {
  it('authenticates an unpruned staging archive instead of skipping its physical records', async () => {
    process.env.CLAUDE_FLOW_POLICY_SIGNING_KEY = 'disposable-regression-key'; process.env.CLAUDE_FLOW_POLICY_KEY_ID = 'original-custom-id';
    const project = root(); await autoMigratePolicyStateIfNeeded(project); await decide(project, 0);
    const hot = JSON.parse(readFileSync(state(project), 'utf8')).receipts[0];
    writeFileSync(archive(project), `${JSON.stringify(hot)}\n${JSON.stringify({ ...hot, signature: 'bad' })}\n`);
    expect(await verifyPolicyLedger(project, { full: true })).toMatchObject({ valid: false, error: 'policy-ledger-archive-conflict' });
    writeFileSync(archive(project), 'null\n');
    expect(await verifyPolicyLedger(project, { full: true })).toMatchObject({ valid: false, error: 'policy-ledger-archive-conflict' });
    writeFileSync(archive(project), '{"pending":');
    expect(await verifyPolicyLedger(project, { full: true })).toMatchObject({ valid: false, error: 'policy-ledger-archive-parse-error' });
  });
  it.skipIf(process.platform === 'win32')('an unpruned FIFO snapshot cannot block full verification', async () => {
    const project = root(); await autoMigratePolicyStateIfNeeded(project); await decide(project, 0);
    execFileSync('mkfifo', [archive(project)]);
    // A regressed blocking read is released by a child so the test remains
    // bounded even though JavaScript timers cannot interrupt readFileSync.
    const writer = spawn('sh', ['-c', 'sleep 2; printf null > "$1"', 'sh', archive(project)], { stdio: 'ignore' });
    try {
      const started = Date.now(); expect(await verifyPolicyLedger(project, { full: true })).toMatchObject({ valid: false, error: 'policy-ledger-archive-not-regular' });
      expect(Date.now() - started).toBeLessThan(1_000);
    } finally { writer.kill('SIGKILL'); }
  });
  it.each(['valid-first', 'invalid-first'])('rejects a corrupted signature in either duplicate order (%s)', async order => {
    const project = await ledger(true); const lines = records(project); const damaged = { ...lines[0], signature: 'bad' };
    if (order === 'valid-first') appendFileSync(archive(project), `${JSON.stringify(damaged)}\n`);
    else writeFileSync(archive(project), `${[damaged, ...lines].map(record => JSON.stringify(record)).join('\n')}\n`);
    expect(await verifyPolicyLedger(project, { full: true })).toMatchObject({ valid: false, error: 'policy-ledger-archive-conflict' });
  });
  it('rejects same-key wrong-ID duplicates and passes matching custom-ID history', async () => {
    const project = await ledger(true); expect(await verifyPolicyLedger(project, { full: true })).toMatchObject({ valid: true });
    appendFileSync(archive(project), `${JSON.stringify({ ...records(project)[0], keyId: 'other-id' })}\n`);
    expect(await verifyPolicyLedger(project, { full: true })).toMatchObject({ valid: false });
  });
  it('rejects a forged overlap with the retained hot tail', async () => {
    const project = await ledger(true); const hot = JSON.parse(readFileSync(state(project), 'utf8')).receipts[0];
    appendFileSync(archive(project), `${JSON.stringify({ ...hot, signature: 'bad' })}\n`);
    expect(await verifyPolicyLedger(project, { full: true })).toMatchObject({ valid: false });
  });
  it.each([null, {}, { payload: null }, { payload: { sequence: '0' } }])('reports malformed JSON record cleanly (%j)', async record => {
    const project = await ledger(); appendFileSync(archive(project), `${JSON.stringify(record)}\n`);
    expect(await verifyPolicyLedger(project, { full: true })).toMatchObject({ valid: false, error: 'policy-ledger-archive-conflict' });
  });
});

describe('state-backed torn append recovery', () => {
  it.each(['ascii', 'split-utf8'])('recovers exact retry receipt prefix (%s)', async mode => {
    const project = await ledger(true); const hot = JSON.parse(readFileSync(state(project), 'utf8')).receipts[0];
    const bytes = Buffer.from(JSON.stringify(hot));
    const cut = mode === 'ascii' ? 40 : bytes.indexOf(Buffer.from('é')) + 1;
    expect(cut).toBeGreaterThan(0); appendFileSync(archive(project), bytes.subarray(0, cut));
    await decide(project, 6);
    expect(await verifyPolicyLedger(project, { full: true })).toMatchObject({ valid: true, length: 7 });
  });
  it.each(['{"unknown":', 'null', '{}', '{"payload":null}', '{"payload":{"sequence":"bad"}}'])('preserves unknown/complete malformed trailing bytes (%s)', async suffix => {
    const project = await ledger(); appendFileSync(archive(project), suffix);
    const before = readFileSync(archive(project)); const stateBefore = readFileSync(state(project));
    await expect(decide(project, 6)).rejects.toThrow(/policy-ledger-archive/);
    expect(readFileSync(archive(project))).toEqual(before); expect(readFileSync(state(project))).toEqual(stateBefore);
  });
  it('preserves a valid complete final receipt without a newline', async () => {
    const project = await ledger(); const hot = JSON.parse(readFileSync(state(project), 'utf8')).receipts[0];
    appendFileSync(archive(project), JSON.stringify(hot)); const before = readFileSync(archive(project));
    await expect(decide(project, 6)).rejects.toThrow('policy-ledger-archive-unterminated-record');
    expect(readFileSync(archive(project))).toEqual(before);
  });
  it('does not recover an interior malformed record', async () => {
    const project = await ledger(); appendFileSync(archive(project), '{"bad":\n');
    const before = readFileSync(archive(project)); await expect(decide(project, 6)).rejects.toThrow('policy-ledger-archive-parse-error');
    expect(readFileSync(archive(project))).toEqual(before);
  });
  it('does not truncate a symlink target', async () => {
    const project = await ledger(); const outside = join(project, 'outside-ledger');
    writeFileSync(outside, readFileSync(archive(project))); appendFileSync(outside, '{"unknown":');
    unlinkSync(archive(project)); symlinkSync(outside, archive(project)); const before = readFileSync(outside);
    await expect(decide(project, 6)).rejects.toThrow(); expect(readFileSync(outside)).toEqual(before);
  });
});

describe('durable publication and retry', () => {
  it('syncs archive before state publication and syncs renamed state and anchor parents', async () => {
    const project = await ledger(); io.events.length = 0; await decide(project, 6);
    const archiveSync = io.events.indexOf(`sync:${archive(project)}`); const stateRename = io.events.indexOf(`rename:${state(project)}`);
    expect(archiveSync).toBeGreaterThanOrEqual(0); expect(stateRename).toBeGreaterThan(archiveSync);
    expect(io.events.slice(0, stateRename).some(event => event.startsWith(`sync:${state(project)}.`))).toBe(true);
    expect(io.events[stateRename + 1]).toBe(`sync:${dir(project)}`);
    const anchorRename = io.events.indexOf(`rename:${join(dir(project), 'ledger-anchors.json')}`);
    expect(anchorRename).toBeGreaterThan(stateRename); expect(io.events[anchorRename + 1]).toBe(`sync:${dir(project)}`);
    const mirrorRename = io.events.findIndex(event => event.endsWith('/ledger-anchor-head.json') && event.startsWith('rename:'));
    expect(mirrorRename).toBeGreaterThan(anchorRename);
    expect(io.events[mirrorRename + 1]).toBe(`sync:${io.events[mirrorRename].slice(7).replace(/\/ledger-anchor-head.json$/, '')}`);
  });
  it.each(['complete', 'missing-extension'])('a lagging mirror requires the entire newly archived extension (%s)', async mode => {
    const project = await ledger(); io.failRenameSuffix = 'ledger-anchor-head.json';
    const warning = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    try {
      await withPolicyTransaction(project, engine => {
        for (let i = 6; i < 12; i++) engine.evaluate({ identity: { id: `agent:${i}`, type: 'agent' }, action: { type: 'code.read', resource: `f-${i}` } });
      });
      await decide(project, 12); io.failRenameSuffix = '';
      if (mode === 'missing-extension') {
        const lines = records(project).filter(record => record.payload.sequence !== 7);
        writeFileSync(archive(project), `${lines.map(record => JSON.stringify(record)).join('\n')}\n`);
        const log = readFileSync(join(dir(project), 'ledger-anchors.json'));
        expect(await verifyPolicyLedger(project)).toMatchObject({ valid: false });
        expect(readFileSync(join(dir(project), 'ledger-anchors.json'))).toEqual(log);
      } else expect(await verifyPolicyLedger(project, { full: true })).toMatchObject({ valid: true, length: 13 });
    } finally { warning.mockRestore(); }
  });
  it.each(['zero-retention', 'large-batch'])('archives only committed bytes before a failed first publication (%s)', async mode => {
    const project = await ledger(); const acknowledged = records(project);
    if (mode === 'zero-retention') process.env.CLAUDE_FLOW_POLICY_LEDGER_RETENTION = '0';
    io.failState = true;
    const batch = () => withPolicyTransaction(project, engine => {
      for (let i = 6; i < (mode === 'large-batch' ? 12 : 7); i++) engine.evaluate({ identity: { id: `retry-agent:${i}`, type: 'agent' }, action: { type: 'code.read', resource: `retry-${i}` } });
    });
    await expect(batch()).rejects.toThrow('injected');
    expect(records(project).every(record => record.payload.sequence < 6)).toBe(true);
    io.failState = false;
    // A later retry creates fresh timestamps; no uncommitted physical record
    // from the failed operation can collide with its same sequence.
    await new Promise(resolve => setTimeout(resolve, 5)); await batch();
    expect(await verifyPolicyLedger(project, { full: true })).toMatchObject({ valid: true, length: mode === 'large-batch' ? 12 : 7 });
    expect(records(project).slice(0, acknowledged.length)).toEqual(acknowledged);
    expect(JSON.parse(readFileSync(state(project), 'utf8')).receipts).toHaveLength(mode === 'large-batch' ? 6 : 1);
  });
  it.each(['state-parent-sync', 'anchor-log-rename'])('state-ahead %s failure preserves historical receipts and catches up on verify', async failure => {
    const project = await ledger(); const old = records(project);
    io.failStateDirSync = failure === 'state-parent-sync';
    io.failRenameSuffix = failure === 'anchor-log-rename' ? 'ledger-anchors.json' : '';
    await expect(decide(project, 6)).rejects.toThrow('injected');
    // Publication may precede failure; an API failure does not imply rollback.
    expect(JSON.parse(readFileSync(state(project), 'utf8')).ledgerLength).toBe(7);
    io.failStateDirSync = false; io.failRenameSuffix = '';
    expect(await verifyPolicyLedger(project, { full: true })).toMatchObject({ valid: true, length: 7 });
    expect(records(project).slice(0, old.length)).toEqual(old);
  });
  it('an anchor serialization callback failure preserves the old log and supports state-ahead recovery', async () => {
    const project = await ledger(); const file = join(dir(project), 'ledger-anchors.json'); const old = readFileSync(file);
    io.failAnchorStream = true; await expect(decide(project, 6)).rejects.toThrow('injected anchor stream failure');
    expect(readFileSync(file)).toEqual(old); io.failAnchorStream = false;
    expect(await verifyPolicyLedger(project, { full: true })).toMatchObject({ valid: true, length: 7 });
  });
  it('a mirror failure at the first prune keeps its authentic prearchive checkpoint usable', async () => {
    process.env.CLAUDE_FLOW_POLICY_LEDGER_RETENTION = '2';
    const project = root(); await autoMigratePolicyStateIfNeeded(project); await decide(project, 0); await decide(project, 1);
    io.failRenameSuffix = 'ledger-anchor-head.json';
    const warning = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    try {
      await decide(project, 2); expect(warning).toHaveBeenCalled(); io.failRenameSuffix = '';
      expect(await verifyPolicyLedger(project, { full: true })).toMatchObject({ valid: true, length: 3 });
      await decide(project, 3);
      expect(await verifyPolicyLedger(project, { full: true })).toMatchObject({ valid: true, length: 4 });
    } finally { warning.mockRestore(); }
  });
  it('a best-effort mirror publication failure preserves a usable durable log and catches up later', async () => {
    const project = await ledger(); io.failRenameSuffix = 'ledger-anchor-head.json';
    const warning = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    try {
      await decide(project, 6); // mirror is explicitly best effort in ADR-475
      expect(warning).toHaveBeenCalled(); io.failRenameSuffix = '';
      expect(await verifyPolicyLedger(project, { full: true })).toMatchObject({ valid: true, length: 7 });
      await decide(project, 7);
      expect(await verifyPolicyLedger(project, { full: true })).toMatchObject({ valid: true, length: 8 });
    } finally { warning.mockRestore(); }
  });
  it.each(['archive-sync', 'state-rename'])('keeps acknowledged state on %s failure and permits exact duplicate retry', async failure => {
    const project = await ledger(); const before = readFileSync(state(project));
    io.failSync = failure === 'archive-sync'; io.failState = failure === 'state-rename';
    await expect(decide(project, 6)).rejects.toThrow('injected'); expect(readFileSync(state(project))).toEqual(before);
    io.failSync = io.failState = false; await decide(project, 6);
    expect(await verifyPolicyLedger(project, { full: true })).toMatchObject({ valid: true, length: 7 });
  });
});

describe('existing lock safety defect', () => {
  it('does not reclaim an aged live owner', async () => {
    const project = root(); const lock = join(project, 'lock'); const release = await acquireLock(lock);
    utimesSync(lock, new Date(0), new Date(0));
    await expect(acquireLock(lock)).rejects.toThrow('policy-state-lock-timeout'); expect(existsSync(lock)).toBe(true); release();
  }, 10_000);
  it('an old release does not remove a replacement owner lock', async () => {
    const project = root(); const lock = join(project, 'lock'); const release = await acquireLock(lock);
    unlinkSync(lock); const newerRelease = await acquireLock(lock); const newer = readFileSync(lock);
    release(); expect(readFileSync(lock)).toEqual(newer); newerRelease();
  });
  it('serializes concurrent owners', async () => {
    const project = root(); const lock = join(project, 'lock'); let active = 0; let max = 0;
    await Promise.all(Array.from({ length: 8 }, async () => { const release = await acquireLock(lock); active++; max = Math.max(active, max); await new Promise(resolve => setTimeout(resolve, 10)); active--; release(); }));
    expect(max).toBe(1);
  });
});
