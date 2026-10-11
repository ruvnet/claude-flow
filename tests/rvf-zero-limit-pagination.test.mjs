import { test } from 'vitest';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { RvfEventLog } from '../v3/@claude-flow/shared/src/events/rvf-event-log.ts';
test('zero limit returns an empty page, including with an offset', async () => {
 const dir = mkdtempSync(join(tmpdir(), 'rvf-page-'));
 const log = new RvfEventLog({logPath: join(dir, 'events.rvf')});
 try {
  await log.initialize();
  for (let i = 0; i < 3; i++) await log.append({id:String(i), aggregateId:'a', aggregateType:'Task', type:'Created', timestamp:i, version:0, payload:{}});
  assert.equal((await log.getAllEvents({limit:0})).length,0);
  assert.equal((await log.getAllEvents({offset:1,limit:0})).length,0);
  assert.deepEqual((await log.getAllEvents({offset:1,limit:1})).map(e=>e.id),['1']);
  assert.equal((await log.getAllEvents({})).length,3);
 } finally { await log.close(); rmSync(dir,{recursive:true,force:true}); }
});
