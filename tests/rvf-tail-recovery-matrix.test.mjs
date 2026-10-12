import { test } from 'vitest';
import assert from 'node:assert/strict';
import { mkdtempSync, appendFileSync, rmSync, readFileSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { RvfEventLog } from '../v3/@claude-flow/shared/src/events/rvf-event-log.ts';

const event = id => ({ id, aggregateId: 'a', aggregateType: 'Task', type: 'Created', timestamp: Number(id), version: 0, payload: {} });
const ids = async log => (await log.getEvents('a')).map(e => e.id);

async function withLog(fn, config = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'rvf-matrix-'));
  const path = join(dir, 'events.rvf');
  try { await fn(path, () => new RvfEventLog({ logPath: path, ...config })); } finally { rmSync(dir, { recursive: true, force: true }); }
}

// Repairable tails: every shape that is a torn write must lose nothing but the torn bytes, across repeated reopen→append cycles.
const repairable = {
  'one byte of a length prefix': Buffer.from([0]),
  'a partial length prefix': Buffer.from([0, 0]),
  'three bytes of a length prefix': Buffer.from([0, 0, 0]),
  'a length prefix with no payload': Buffer.from([0, 0, 0, 100]),
  'a partial payload': Buffer.from([0, 0, 0, 100, 123]),
};
for (const [name, tail] of Object.entries(repairable)) {
  test(`keeps every append across two reopen cycles after ${name}`, () => withLog(async (path, open) => {
    let log = open();
    await log.initialize(); await log.append(event('1')); await log.close();
    appendFileSync(path, tail);
    for (const id of ['2', '3']) { log = open(); await log.initialize(); await log.append(event(id)); await log.close(); }
    log = open(); await log.initialize();
    assert.deepEqual(await ids(log), ['1', '2', '3']);
    await log.close();
  }));
}

test('an oversized length prefix is never accepted silently: append rejects and the bytes are kept', () => withLog(async (path, open) => {
  let log = open();
  await log.initialize(); await log.append(event('1')); await log.close();
  appendFileSync(path, Buffer.from('garbage')); // prefix decodes to ~1.7 GB, over the limit
  const before = readFileSync(path);
  log = open(); await log.initialize();
  assert.deepEqual(await ids(log), ['1']);
  await assert.rejects(log.append(event('2')), /unrepaired tail.*safety limit/i);
  assert.deepEqual(readFileSync(path), before, 'file untouched');
  assert.deepEqual(await ids(log), ['1'], 'rejected event is not indexed');
  await log.close();
}));

test('repairOversizedTail truncates at the bad prefix so later appends are readable', () => withLog(async (path, open) => {
  let log = open();
  await log.initialize(); await log.append(event('1')); await log.close();
  const good = statSync(path).size;
  appendFileSync(path, Buffer.from('garbage'));
  for (const id of ['2', '3']) { log = open(); await log.initialize(); await log.append(event(id)); await log.close(); }
  log = open(); await log.initialize();
  assert.deepEqual(await ids(log), ['1', '2', '3']);
  assert.ok(statSync(path).size > good);
  await log.close();
}, { repairOversizedTail: true }));

test('a complete record with a non-JSON payload and a zero-filled tail stay readable and appendable', () => withLog(async (path, open) => {
  let log = open();
  await log.initialize(); await log.append(event('1')); await log.close();
  appendFileSync(path, Buffer.from([0, 0, 0, 3, 0x61, 0x62, 0x63])); // complete record, not JSON: skipped on replay
  log = open(); await log.initialize(); await log.append(event('2')); await log.close();
  log = open(); await log.initialize();
  assert.deepEqual(await ids(log), ['1', '2']);
  await log.close();
}));

test('a damaged snapshot file tail does not lose later snapshots', () => withLog(async (path, open) => {
  let log = open();
  await log.initialize(); await log.append(event('1'));
  await log.saveSnapshot({ aggregateId: 'a', version: 1, state: { n: 1 }, timestamp: 1 });
  await log.close();
  appendFileSync(path.replace(/\.rvf$/, '.snap.rvf'), Buffer.from([0, 0]));
  log = open(); await log.initialize();
  await log.saveSnapshot({ aggregateId: 'a', version: 2, state: { n: 2 }, timestamp: 2 });
  await log.close();
  log = open(); await log.initialize();
  assert.equal((await log.getSnapshot('a')).version, 2);
  await log.close();
}));

test('a record larger than the replay limit is refused at append instead of being written unreadable', () => withLog(async (path, open) => {
  const log = open();
  await log.initialize(); await log.append(event('1'));
  const before = readFileSync(path);
  const huge = { ...event('2'), payload: { blob: 'x'.repeat(101 * 1024 * 1024) } };
  await assert.rejects(log.append(huge), /exceeds the \d+ byte limit/);
  assert.deepEqual(readFileSync(path), before);
  await log.append(event('3'));
  await log.close();
  const again = open(); await again.initialize();
  assert.deepEqual(await ids(again), ['1', '3']);
  await again.close();
}));
