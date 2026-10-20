import test from 'node:test';
import assert from 'node:assert/strict';
import { InMemoryStore } from '../src/store.mjs';

test('stored mutable fields are independent from caller-owned inputs', async () => {
  const store = new InMemoryStore();
  const roles = ['researcher'];
  const team = await store.createTeam('a', {name:'A', objective:'goal', roles});
  roles.push('unexpected');
  assert.deepEqual((await store.getTeam('a', team.id)).roles, ['researcher']);
  const patch = {roles:['reviewer']};
  await store.updateTeam('a', team.id, patch);
  patch.roles.push('unexpected');
  assert.deepEqual((await store.getTeam('a', team.id)).roles, ['reviewer']);
  const tags = ['source'];
  const memory = await store.remember('a', {teamId:team.id, text:'note', tags});
  tags.push('unexpected');
  assert.deepEqual((await store.listMemories('a'))[0].tags, ['source']);
  assert.equal(memory.tags.length, 1);
});

test('exported audit records are independent snapshots', async () => {
  const store = new InMemoryStore();
  const team = await store.createTeam('a', {name:'A', objective:'goal', roles:[]});
  const run = await store.createRun('a', {teamId:team.id, objective:'run', budgetUnits:10});
  const evidence = await store.evidence('a', run.id);
  evidence.audit[0].eventType = 'changed';
  assert.equal((await store.evidence('a', run.id)).audit[0].eventType, 'team.created');
});
