import test from 'node:test';
import assert from 'node:assert/strict';
import { TenantVectorMemory } from '../src/vector-memory.mjs';
test('a pending index build cannot restore invalidated memory', async () => {
 let release; let calls = 0;
 const old = { id: 'old', text: 'alpha' }, fresh = { id: 'fresh', text: 'alpha updated' };
 const store = { listMemories: async () => { if (++calls === 1) return new Promise(resolve => { release = () => resolve([old]); }); return [fresh]; } };
 const memory = new TenantVectorMemory(store);
 const pending = memory.search('tenant', { query: 'alpha' });
 memory.invalidate('tenant'); release(); await pending;
 const result = await memory.search('tenant', { query: 'alpha' });
 assert.equal(result.results[0].memory.id, 'fresh');
 assert.equal(calls, 2);
 await memory.search('tenant', { query: 'alpha' }); assert.equal(calls, 2);
});
