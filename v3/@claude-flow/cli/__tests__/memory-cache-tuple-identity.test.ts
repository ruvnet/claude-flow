import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import Database from 'better-sqlite3';
vi.mock('../src/memory/intelligence.js', () => ({ recordSignalProcessed() {} }));
import * as bridge from '../src/memory/memory-bridge.js';
let db: Database.Database;
beforeEach(() => {
  db=new Database(':memory:'); const cache=new Map();
  bridge.__setMemoryBridgeRegistryForTests({getAgentDB:()=>({database:db}),get:(name:string)=>name==='tieredCache'?cache:null});
});
afterEach(()=>{bridge._resetRegistryCacheForTest();db.close();});
const put=(namespace:string,key:string,value:string)=>bridge.bridgeStoreEntry({namespace,key,value,generateEmbeddingFlag:false,upsert:true});
const get=(namespace:string,key:string)=>bridge.bridgeGetEntry({namespace,key});
it.each([
  ['a:b','a_b','key','key'],
  ['default','default','x:y','x_y'],
  ['a:b','a','c','b:c'],
])('keeps cache identities distinct for %s / %s',async(ns1,ns2,key1,key2)=>{
  expect(await put(ns1,key1,'first')).toMatchObject({success:true});
  expect(await put(ns2,key2,'second')).toMatchObject({success:true});
  expect(await get(ns1,key1)).toMatchObject({entry:{content:'first'}});
  expect(await get(ns2,key2)).toMatchObject({entry:{content:'second'}});
  expect(await get(ns1,key1)).toMatchObject({entry:{content:'first'}});
  await put(ns2,key2,'updated');
  expect(await get(ns1,key1)).toMatchObject({entry:{content:'first'}});
  expect(await get(ns2,key2)).toMatchObject({entry:{content:'updated'}});
  await bridge.bridgeDeleteEntry({namespace:ns1,key:key1});
  expect(await get(ns1,key1)).toMatchObject({found:false});
  expect(await get(ns2,key2)).toMatchObject({entry:{content:'updated'}});
});
