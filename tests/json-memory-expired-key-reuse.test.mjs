import { test } from 'vitest';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { JsonMemoryBackend } from '../v3/@claude-flow/cli-core/src/memory/json-backend.ts';
test('expired keys can be reused without a preceding read or upsert',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'memory-ttl-'));const backend=new JsonMemoryBackend({path:join(dir,'memory.json')});const now=Date.now;
 try{
  await backend.store('key','old',{ttl:1});
  const stored=await backend.list();const boundary=new Date(stored[0].storedAt).getTime()+1000;
  Date.now=()=>boundary;
  assert.deepEqual(await backend.list(),[]);
  await backend.store('key','new');assert.equal((await backend.retrieve('key')).value,'new');
  await assert.rejects(backend.store('key','duplicate'),/UNIQUE/);
 }finally{Date.now=now;rmSync(dir,{recursive:true,force:true});}
});
