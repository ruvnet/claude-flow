import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import Database from 'better-sqlite3';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
vi.mock('../src/memory/intelligence.js',()=>({recordSignalProcessed(){}}));
import * as bridge from '../src/memory/memory-bridge.js';
let db:Database.Database,root:string,dbPath:string;
beforeEach(()=>{
 root=mkdtempSync(join(tmpdir(),'ruflo-ttl-'));dbPath=join(root,'memory.db');db=new Database(dbPath);
 const cache=new Map();bridge.__setMemoryBridgeRegistryForTests({getAgentDB:()=>({database:db}),get:(name:string)=>name==='tieredCache'?cache:null});
});
afterEach(()=>{vi.restoreAllMocks();vi.unstubAllEnvs();bridge._resetRegistryCacheForTest();if(db.open)db.close();rmSync(root,{recursive:true,force:true});});
async function seed(){
 const now=Date.now();vi.spyOn(Date,'now').mockReturnValue(now-2000);
 await bridge.bridgeStoreEntry({key:'expired',value:'searchable',ttl:1,generateEmbeddingFlag:false,dbPath});
 vi.restoreAllMocks();
 await bridge.bridgeStoreEntry({key:'retained',value:'searchable',generateEmbeddingFlag:false,dbPath});
 db.prepare('UPDATE memory_entries SET embedding = ?, embedding_dimensions = 3').run('[1,0,0]');
}
it('excludes expired TTL rows from native retrieve, list, lexical search and vector scans',async()=>{
 await seed();
 expect(await bridge.bridgeGetEntry({key:'expired',dbPath})).toMatchObject({found:false});
 const list=await bridge.bridgeListEntries({dbPath});expect(list).toMatchObject({total:1});expect(list!.entries.map(e=>e.key)).toEqual(['retained']);
 const search=await bridge.bridgeSearchEntries({query:'searchable',threshold:0,dbPath});expect(search!.results.map(e=>e.key)).toEqual(['retained']);
 const vectors=await bridge.bridgeGetAllEmbeddings({dimensions:3,dbPath});expect(vectors!.map(e=>e.key)).toEqual(['retained']);
});
it('expires a cached row without requiring another database write',async()=>{
 await bridge.bridgeStoreEntry({key:'short',value:'searchable',ttl:1,generateEmbeddingFlag:false,dbPath});
 expect(await bridge.bridgeGetEntry({key:'short',dbPath})).toMatchObject({found:true});
 vi.spyOn(Date,'now').mockReturnValue(Date.now()+2000);
 expect(await bridge.bridgeGetEntry({key:'short',dbPath})).toMatchObject({found:false});
});
it('applies the same expiration rule to WASM retrieve and list',async()=>{
 await seed();db.close();bridge._resetRegistryCacheForTest();vi.stubEnv('CLAUDE_FLOW_DISABLE_BRIDGE','1');
 const memory=await import('../src/memory/memory-initializer.js');
 expect(await memory.getEntry({key:'expired',dbPath})).toMatchObject({found:false});
 const list=await memory.listEntries({dbPath});expect(list).toMatchObject({total:1});expect(list.entries.map(e=>e.key)).toEqual(['retained']);
});

it.each(['native', 'wasm'])('keeps legacy rows without expires_at readable through %s',async backend=>{
 await seed();db.exec('ALTER TABLE memory_entries DROP COLUMN expires_at');db.close();bridge._resetRegistryCacheForTest();
 if(backend==='native') {
   db=new Database(dbPath);
   bridge.__setMemoryBridgeRegistryForTests({getAgentDB:()=>({database:db}),get:()=>null});
   expect(await bridge.bridgeGetEntry({key:'retained',dbPath})).toMatchObject({found:true});
   expect(await bridge.bridgeListEntries({dbPath})).toMatchObject({total:2});
 } else {
   vi.stubEnv('CLAUDE_FLOW_DISABLE_BRIDGE','1');
   const memory=await import('../src/memory/memory-initializer.js');
   expect(await memory.getEntry({key:'retained',dbPath})).toMatchObject({found:true});
   expect(await memory.listEntries({dbPath})).toMatchObject({total:2});
 }
});
