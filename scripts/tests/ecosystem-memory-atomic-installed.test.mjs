import test from 'node:test';
import assert from 'node:assert/strict';
import { fork } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';

const from=process.env.RUFLO_MEMORY_RESOLVE_FROM;
const skip=!from && process.env.RUFLO_MEMORY_REQUIRED!=='1';
const records=key=>({records:[{key,content:'saved '+key,vector:key==='before'?[1,0]:[0,1]}]});
const query={vector:[0,1],k:10};
function worker(mode,database,scenario,input) {
  const child=fork(resolve('scripts/tests/fixtures/ecosystem-memory-worker.mjs'),[mode,database,scenario,JSON.stringify(input)],{silent:true,env:{...process.env,NODE_TEST_CONTEXT:''}});
  let report,readyResolve,readyReject,stderr='';
  child.stderr.on('data',data=>{stderr=(stderr+data).slice(-4096);}); child.stdout.resume();
  const ready=new Promise((a,b)=>{readyResolve=a;readyReject=b;}); ready.catch(()=>{});
  child.on('message',message=>{if(message.type==='checkpoint')readyResolve(message);else report=message;});
  const timer=setTimeout(()=>child.kill('SIGKILL'),15000);
  const done=new Promise(resolve=>child.once('exit',(code,signal)=>{clearTimeout(timer);readyReject(Error('Worker exited before checkpoint: '+stderr));resolve({code,signal,report,stderr});}));
  return {child,ready,done};
}
async function run(mode,database,input) {
  const result=await worker(mode,database,'none',input).done;
  assert.equal(result.code,0,JSON.stringify(result));assert.equal(result.report.type,'result');return result.report.result;
}
async function fixture(t) {
  assert.ok(from,'RUFLO_MEMORY_RESOLVE_FROM required');
  const folder=await mkdtemp(join(tmpdir(),'memory-atomic-consumer-')), database=join(folder,'memory.sqlite');
  t.after(()=>rm(folder,{recursive:true,force:true}));
  await run('write',database,records('before')); return {folder,database};
}
test('separate stale reader cannot overwrite a completed newer writer', {skip}, async t=>{
  const {database}=await fixture(t), before=await readFile(database);
  const reader=worker('retrieve',database,'pause-reader',query);
  t.after(()=>reader.child.kill('SIGKILL'));
  await reader.ready;
  await run('write',database,records('new'));
  const committed=await readFile(database);assert.notDeepEqual(committed,before);
  reader.child.send({resume:true});const old=await reader.done;assert.equal(old.code,0,JSON.stringify(old));
  assert.deepEqual(old.report.result.results.map(x=>x.key),['before']);
  assert.deepEqual(await readFile(database),committed,'reader shutdown must not persist stale state');
  const final=await run('retrieve',database,query);
  assert.deepEqual(final.results.map(x=>x.key),['new','before']);
  assert.deepEqual(await readFile(database),committed,'retrieval must preserve authoritative bytes');
  t.diagnostic(JSON.stringify({readerSnapshot:['before'],retainedAfterWriter:['new','before'],sourceBytesUnchangedByReader:true,versions:final.versions}));
});
for(const phase of ['before-publish','after-publish']) {
  test(`SIGKILL ${phase} retains a complete retrievable database and fences subsequent writers`,{skip},async t=>{
    const {database}=await fixture(t), before=await readFile(database);
    const pending=worker('write',database,phase,records('new'));t.after(()=>pending.child.kill('SIGKILL'));
    await pending.ready;
    const contending=await worker('write',database,'none',records('contender')).done;
    assert.equal(contending.code,1);assert.match(contending.report.message,/EEXIST/);
    pending.child.kill('SIGKILL');const terminated=await pending.done;assert.equal(terminated.signal,'SIGKILL');
    if(phase==='before-publish')assert.deepEqual(await readFile(database),before);
    const result=await run('retrieve',database,query);
    assert.deepEqual(result.results.map(x=>x.key),phase==='before-publish'?['before']:['new','before']);
    const fenced=await worker('write',database,'none',records('later')).done;assert.equal(fenced.code,1);assert.match(fenced.report.message,/EEXIST/);
    const owner=JSON.parse(await readFile(database+'.writer.lock/owner.json'));assert.equal(owner.pid,pending.child.pid);
    // Test-owned lock, after observed child exit. Production recovery is manual.
    await rm(database+'.writer.lock',{recursive:true});
    await run('write',database,records('recovered'));
    assert.ok((await run('retrieve',database,query)).results.some(x=>x.key==='recovered'));
    t.diagnostic(JSON.stringify({phase,signal:terminated.signal,retainedKeys:result.results.map(x=>x.key),competingWriterRejected:true,staleLeaseNotStolen:true,powerLossTested:false}));
  });
}
