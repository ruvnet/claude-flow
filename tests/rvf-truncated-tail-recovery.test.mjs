import * as fs from 'node:fs';
vi.mock('node:fs', async importOriginal => { const actual = await importOriginal(); return { ...actual, truncateSync: vi.fn(actual.truncateSync) }; });
import { test, vi } from 'vitest';
import assert from 'node:assert/strict';
import { mkdtempSync, appendFileSync, rmSync, readFileSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { RvfEventLog } from '../v3/@claude-flow/shared/src/events/rvf-event-log.ts';
for(const tail of [Buffer.from([0,0]),Buffer.from([0,0,0,100,123])]) test(`new events survive reopening after ${tail.length}-byte incomplete tail`,async()=>{
 const dir=mkdtempSync(join(tmpdir(),'rvf-tail-')); const path=join(dir,'events.rvf'); let log=new RvfEventLog({logPath:path});
 const event=id=>({id,aggregateId:'a',aggregateType:'Task',type:'Created',timestamp:Number(id),version:0,payload:{}});
 try{
  await log.initialize();await log.append(event('1'));await log.close();appendFileSync(path,tail);
  log=new RvfEventLog({logPath:path});await log.initialize();await log.append(event('2'));await log.close();
  log=new RvfEventLog({logPath:path});await log.initialize();
  assert.deepEqual((await log.getEvents('a')).map(e=>e.id),['1','2']);
 }finally{await log.close();rmSync(dir,{recursive:true,force:true});}
});

for (const code of ['EACCES', 'EROFS', 'EPERM']) test(`reads an unrepaired ${code} log without permitting appends`, async () => {
 const dir = mkdtempSync(join(tmpdir(), 'rvf-readonly-tail-')); const path = join(dir, 'events.rvf');
 let log = new RvfEventLog({ logPath: path });
 const event = id => ({ id, aggregateId: 'a', aggregateType: 'Task', type: 'Created', timestamp: Number(id), version: 0, payload: {} });
 try {
  await log.initialize(); await log.append(event('1')); await log.close(); appendFileSync(path, Buffer.from([0, 0]));
  const original = readFileSync(path);
  vi.mocked(fs.truncateSync).mockImplementationOnce(() => { throw Object.assign(new Error('read-only fixture'), { code }); });
  log = new RvfEventLog({ logPath: path });
  await log.initialize();
  assert.deepEqual((await log.getEvents('a')).map(e => e.id), ['1']);
  await assert.rejects(log.append(event('2')), /read-only.*unrepaired/i);
  assert.deepEqual(readFileSync(path), original);
  assert.deepEqual((await log.getEvents('a')).map(e => e.id), ['1']);
 } finally { await log.close(); vi.mocked(fs.truncateSync).mockReset(); const actual = await vi.importActual('node:fs'); vi.mocked(fs.truncateSync).mockImplementation(actual.truncateSync); rmSync(dir, { recursive: true, force: true }); }
});

test('native read-only damaged log retains readable history and refuses new events', async () => {
 const dir = mkdtempSync(join(tmpdir(), 'rvf-native-readonly-')); const path = join(dir, 'events.rvf');
 let log = new RvfEventLog({ logPath: path });
 const event = id => ({ id, aggregateId: 'a', aggregateType: 'Task', type: 'Created', timestamp: Number(id), version: 0, payload: {} });
 try {
  await log.initialize(); await log.append(event('1')); await log.close(); appendFileSync(path, Buffer.from([0, 0]));
  const original = readFileSync(path); chmodSync(path, 0o400);
  const actual = await vi.importActual('node:fs');
  assert.throws(() => actual.truncateSync(path, original.length - 2), error => error.code === 'EACCES' || error.code === 'EPERM');
  log = new RvfEventLog({ logPath: path }); await log.initialize();
  assert.deepEqual((await log.getEvents('a')).map(e => e.id), ['1']);
  await assert.rejects(log.append(event('2')), /read-only.*unrepaired/i);
  assert.deepEqual(readFileSync(path), original);
  assert.deepEqual((await log.getEvents('a')).map(e => e.id), ['1']);
 } finally { await log.close(); chmodSync(path, 0o600); rmSync(dir, { recursive: true, force: true }); }
});
