import { afterEach, expect, it, vi } from 'vitest';
import Database from 'better-sqlite3';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
vi.mock('../src/memory/intelligence.js', () => ({ initializeIntelligence: async () => ({}), recordSignalProcessed() {} }));
vi.mock('../src/memory/memory-initializer.js', () => ({ addToHNSWIndex: async () => {} }));
const bridge = await import('../src/memory/memory-bridge.js');
const root = mkdtempSync(join(tmpdir(), 'ruflo-native-lifecycle-'));
afterEach(async () => { await bridge.shutdownBridge(); bridge._resetRegistryCacheForTest(); rmSync(root, {recursive:true,force:true}); });
it('drains native SQLite writes and nested fallback work before one close, then reopens durably', async () => {
  let unblock!: () => void;
  const gate = new Promise<void>(r => {unblock=r});
  let entered!: () => void;
  const started = new Promise<void>(r=>{entered=r});
  let db: Database.Database;
  let closes=0;
  bridge.__setMemoryBridgeRegistryFactoryForTests(() => ({
    async initialize({dbPath}: {dbPath:string}) { db=new Database(dbPath); db.pragma('journal_mode=WAL'); },
    get() { return null; },
    getAgentDB() { return {database:db, embedder:{pipeline:{}, embed:async () => {entered();await gate;return [1,0,0];}}}; },
    async shutdown(){closes++; db.close();},
  }));
  const path=join(root,'memory.db');
  const pending=bridge.bridgeStorePattern({pattern:'survives shutdown',type:'test',confidence:0.9,dbPath:path});
  await started;
  let retired=false;
  const shutdown=bridge.shutdownBridge().then(()=>{retired=true});
  const second=bridge.shutdownBridge();
  await new Promise(r=>setTimeout(r,0));
  const retiredBeforeRelease=retired; const closesBeforeRelease=closes;
  unblock();
  const result=await pending;await Promise.all([shutdown,second]);
  expect(retiredBeforeRelease).toBe(false); expect(closesBeforeRelease).toBe(0);
  expect(result).toMatchObject({success:true,controller:'bridge-fallback'});
  expect(closes).toBe(1);
  const reopened=new Database(path);
  try { expect(reopened.prepare('SELECT content FROM memory_entries').get()).toMatchObject({content:expect.stringContaining('survives shutdown')}); }finally{reopened.close();}
});
