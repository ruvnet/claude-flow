import { test } from 'vitest';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { RvfEventLog } from '../v3/@claude-flow/shared/src/events/rvf-event-log.ts';
for (const mode of ['input', 'reader', 'listener']) test(`events own their persisted payload across ${mode} mutations`, async () => {
 const dir=mkdtempSync(join(tmpdir(),'rvf-owned-')); const log=new RvfEventLog({logPath:join(dir,'events.rvf')});
 try {
  await log.initialize();
  const event={id:'one',aggregateId:'a',aggregateType:'Task',type:'Created',timestamp:1,version:0,payload:{label:'original', omitted:()=> 'not serialized'}};
  if(mode==='listener') log.on('event:appended',e=>e.payload.label='changed');
  await log.append(event);
  if(mode==='input') event.payload.label='changed';
  if(mode==='reader') (await log.getAllEvents())[0].payload.label='changed';
  assert.equal((await log.getEvents('a'))[0].payload.label,'original');
  (await log.getEvents('a'))[0].payload.label='other';
  assert.equal((await log.getAllEvents())[0].payload.label,'original');
 } finally {await log.close();rmSync(dir,{recursive:true,force:true});}
});
for(const mode of ['input','reader','listener']) test(`snapshots own persisted state across ${mode} mutations`,async()=>{
 const dir=mkdtempSync(join(tmpdir(),'rvf-snapshot-'));const log=new RvfEventLog({logPath:join(dir,'events.rvf')});
 try {
  await log.initialize();const snapshot={aggregateId:'a',aggregateType:'Task',version:1,timestamp:1,state:{label:'original'}};
  if(mode==='listener') log.on('snapshot:saved',s=>s.state.label='changed');
  await log.saveSnapshot(snapshot);
  if(mode==='input') snapshot.state.label='changed';
  if(mode==='reader') (await log.getSnapshot('a')).state.label='changed';
  assert.equal((await log.getSnapshot('a')).state.label,'original');
 }finally{await log.close();rmSync(dir,{recursive:true,force:true});}
});
