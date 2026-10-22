import test from 'node:test';
import assert from 'node:assert/strict';
import { setTimeout } from 'node:timers/promises';
import { InMemoryStore } from '../src/store.mjs';

test('updating a memory key preserves its original creation timestamp', async () => {
  const store = new InMemoryStore();
  const input = {teamId:'team', key:'note', text:'first'};
  const first = await store.remember('a', input);
  await setTimeout(10);
  const next = await store.remember('a', {...input,text:'updated'});
  assert.equal(next.createdAt, first.createdAt);
  assert.notEqual(next.updatedAt, first.updatedAt);
  assert.equal(next.text, 'updated');
  assert.equal((await store.listMemories('a')).length, 1);
});
