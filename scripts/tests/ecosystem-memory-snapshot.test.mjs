import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm, stat, symlink, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { withMemorySnapshot } from '../lib/ecosystem-memory-snapshot.mjs';

const bytes = text => Buffer.from('SQLite format 3\0' + text);
async function fixture(t) {
  const folder = await mkdtemp(join(tmpdir(), 'memory-snapshot-test-'));
  t.after(() => rm(folder, { recursive: true, force: true }));
  const databasePath = join(folder, 'db.sqlite'); await writeFile(databasePath, bytes('baseline'));
  return { folder, databasePath };
}
test('reader snapshot is private and discards backend persistence', async t => {
  const { databasePath } = await fixture(t);
  await withMemorySnapshot({ databasePath, write: false }, async path => { assert.notEqual(path,databasePath); await writeFile(path,bytes('reader mutation')); });
  assert.deepEqual(await readFile(databasePath),bytes('baseline'));
});
test('required existing writer state is not synthesized on a missing path', async t => {
  const { folder } = await fixture(t), databasePath = join(folder, 'missing.sqlite');
  let called = false;
  await assert.rejects(withMemorySnapshot({ databasePath, write: true, requireExisting: true }, () => { called = true; }), { code: 'ENOENT' });
  assert.equal(called, false);
  await assert.rejects(stat(databasePath), { code: 'ENOENT' });
  await assert.rejects(stat(databasePath + '.writer.lock'), { code: 'ENOENT' });
});
test('writer atomically replaces complete content, restricts permissions and releases ownership', async t => {
  const { databasePath, folder } = await fixture(t);
  const r = await withMemorySnapshot({ databasePath, write: true }, async path => { await writeFile(path,bytes('new')); return { ok:true }; });
  assert.equal(r.persistence.committed,true); assert.equal(r.persistence.directorySynced,true);
  assert.deepEqual(await readFile(databasePath),bytes('new')); assert.equal((await stat(databasePath)).mode & 0o777,0o600);
  assert.deepEqual(await readdir(folder),['db.sqlite']);
});
test('operation and pre-publication failures preserve original bytes and release lock', async t => {
  const { databasePath, folder } = await fixture(t);
  await assert.rejects(withMemorySnapshot({ databasePath, write:true }, async path => { await writeFile(path,bytes('partial')); throw Error('operation rejected'); }),/operation rejected/);
  await assert.rejects(withMemorySnapshot({ databasePath, write:true, checkpoint:phase=>{if(phase==='before-publish')throw Error('injected');} },path=>writeFile(path,bytes('new'))),/injected/);
  assert.deepEqual(await readFile(databasePath),bytes('baseline')); assert.deepEqual(await readdir(folder),['db.sqlite']);
});
test('concurrent and expired writer leases are not stolen', async t => {
  const { databasePath } = await fixture(t);
  await withMemorySnapshot({databasePath,write:true},async path=>{
    await assert.rejects(withMemorySnapshot({databasePath,write:true},()=>{}),{code:'EEXIST'});
    const ownerPath=databasePath+'.writer.lock/owner.json', state=JSON.parse(await readFile(ownerPath));
    await writeFile(ownerPath,JSON.stringify({...state,expiresAt:0}));
    await assert.rejects(withMemorySnapshot({databasePath,write:true},()=>{}),{code:'EEXIST'});
    await writeFile(ownerPath,JSON.stringify(state));
    await writeFile(path,bytes('new'));
  });
});
test('post-publication and cleanup errors disclose committed state', async t => {
  for(const phase of ['after-publish','cleanup']) {
    const {databasePath}=await fixture(t);
    const checkpoint=async point=>{if(point!=='after-publish')return;if(phase==='after-publish')throw Error('after rename');await writeFile(databasePath+'.writer.lock/owner.json',JSON.stringify({owner:'not-our-owner'}));};
    await assert.rejects(withMemorySnapshot({databasePath,write:true,checkpoint},p=>writeFile(p,bytes('new'))),error=>error.committed===true&&error.durabilityConfirmed===false&&/committed/.test(error.message));
    assert.deepEqual(await readFile(databasePath),bytes('new'));
  }
});
test('symlinks, FIFOs, corrupt sources and invalid final exports fail closed', async t => {
  const {databasePath,folder}=await fixture(t), alias=join(folder,'alias.sqlite');
  await symlink(databasePath,alias);
  await assert.rejects(withMemorySnapshot({databasePath:alias,write:true},()=>{}),{code:'ELOOP'});
  const fifo=join(folder,'fifo'); execFileSync('mkfifo',[fifo]);
  await assert.rejects(withMemorySnapshot({databasePath:fifo,write:false},()=>{}),/regular file/);
  await assert.rejects(withMemorySnapshot({databasePath,write:true},p=>writeFile(p,'corrupt')),/Invalid SQLite/);
  assert.deepEqual(await readFile(databasePath),bytes('baseline'));
  await writeFile(databasePath,'corrupt'); await assert.rejects(withMemorySnapshot({databasePath,write:true},()=>{}),/Invalid SQLite/);
});
