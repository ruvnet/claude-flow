import { test } from 'vitest';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { JsonMemoryBackend } from '../v3/@claude-flow/cli-core/src/memory/json-backend.ts';
test('substring searches omit unrelated records at the default threshold',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'memory-search-'));const backend=new JsonMemoryBackend({path:join(dir,'memory.json')});
 try{
  await backend.store('alpha',{text:'First'});await backend.store('beta',{text:'Second'});
  assert.deepEqual(await backend.search('absent'),[]);
  assert.deepEqual((await backend.search('FIRST')).map(e=>e.key),['alpha']);
  assert.deepEqual((await backend.search('beta',{threshold:0})).map(e=>e.key),['beta']);
  assert.equal((await backend.search('',{limit:1})).length,1);
 }finally{rmSync(dir,{recursive:true,force:true});}
});
