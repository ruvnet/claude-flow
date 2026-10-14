import { test } from 'vitest';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { RvfEventLog } from '../v3/@claude-flow/shared/src/events/rvf-event-log.ts';
test('retry initialization after repairing snapshot header does not duplicate events', async () => {
 const dir=mkdtempSync(join(tmpdir(),'rvf-retry-')); const path=join(dir,'events.rvf');
 const first=new RvfEventLog({logPath:path}); const retried=new RvfEventLog({logPath:path});
 try {
  await first.initialize();
  await first.append({id:'one',aggregateId:'a',aggregateType:'Task',type:'Created',timestamp:1,version:0,payload:{}});
  await first.close();
  writeFileSync(join(dir,'events.snap.rvf'),'invalid');
  await assert.rejects(retried.initialize(), /Invalid file header/);
  writeFileSync(join(dir,'events.snap.rvf'),'RVFL');
  await retried.initialize();
  assert.deepEqual((await retried.getAllEvents()).map(e=>e.id),['one']);
  await retried.append({id:'two',aggregateId:'a',aggregateType:'Task',type:'Updated',timestamp:2,version:0,payload:{}});
  assert.deepEqual((await retried.getEvents('a')).map(e=>e.version),[1,2]);
 } finally { await first.close(); await retried.close(); rmSync(dir,{recursive:true,force:true}); }
});
