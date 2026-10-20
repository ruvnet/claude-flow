import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import Database from 'better-sqlite3';
vi.mock('../src/memory/intelligence.js', () => ({ recordSignalProcessed() {} }));
import * as bridge from '../src/memory/memory-bridge.js';
let db: Database.Database;
let cache: Map<string, unknown>;
beforeEach(() => {
  db=new Database(':memory:'); cache=new Map();
  bridge.__setMemoryBridgeRegistryForTests({getAgentDB:()=>({database:db}),get:(name:string)=>name==='tieredCache'?cache:null});
});
afterEach(()=>{bridge._resetRegistryCacheForTest();db.close();});
it('does not serve cached entries after purging their namespace on the same connection',async()=>{
  for(const namespace of ['purged','retained']) {
    await bridge.bridgeStoreEntry({namespace,key:'key',value:namespace,generateEmbeddingFlag:false});
    expect(await bridge.bridgeGetEntry({namespace,key:'key'})).toMatchObject({found:true});
    expect(await bridge.bridgeGetEntry({namespace,key:'key'})).toMatchObject({cacheHit:true});
  }
  expect(await bridge.bridgePurgeNamespace({namespace:'purged'})).toMatchObject({success:true,deletedCount:1});
  expect(db.prepare("SELECT COUNT(*) n FROM memory_entries WHERE namespace = 'purged'").get()).toEqual({n:0});
  expect(await bridge.bridgeGetEntry({namespace:'purged',key:'key'})).toMatchObject({found:false});
  expect(await bridge.bridgeGetEntry({namespace:'retained',key:'key'})).toMatchObject({found:true,entry:{content:'retained'}});
});

it('waits for an asynchronous cache clear before acknowledging purge', async () => {
  await bridge.bridgeStoreEntry({namespace:'purged',key:'key',value:'value',generateEmbeddingFlag:false});
  await bridge.bridgeGetEntry({namespace:'purged',key:'key'});
  let entered!: () => void, release!: () => void;
  const started=new Promise<void>(r=>{entered=r});
  const gate=new Promise<void>(r=>{release=r});
  const clear=cache.clear.bind(cache);
  cache.clear=async () => { entered(); await gate; clear(); };
  let complete=false;
  const purge=bridge.bridgePurgeNamespace({namespace:'purged'}).then(r=>{complete=true;return r});
  await started;await new Promise(r=>setTimeout(r,0));
  const completedBeforeClear=complete;
  release();await purge;
  expect(completedBeforeClear).toBe(false);
  expect(await bridge.bridgeGetEntry({namespace:'purged',key:'key'})).toMatchObject({found:false});
});
