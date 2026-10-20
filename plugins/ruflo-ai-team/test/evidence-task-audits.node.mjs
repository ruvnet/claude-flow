import test from 'node:test';
import assert from 'node:assert/strict';
import { InMemoryStore } from '../src/store.mjs';

test('run evidence includes audit events for its tasks only', async () => {
  const store = new InMemoryStore();
  const team = await store.createTeam('a', {name:'A', objective:'goal', roles:[]});
  const run = await store.createRun('a', {teamId:team.id, objective:'run', budgetUnits:10});
  const other = await store.createRun('a', {teamId:team.id, objective:'other', budgetUnits:10});
  const task = await store.createTask('a', {runId:run.id, title:'work', description:'description', assigneeRole:'researcher'});
  await store.createTask('a', {runId:other.id, title:'other', description:'description', assigneeRole:'researcher'});
  await store.updateTask('a', task.id, {status:'complete', result:'done'});
  const evidence = await store.evidence('a', run.id);
  assert.deepEqual(evidence.audit.filter(x => x.targetId === task.id).map(x => x.eventType), ['task.created','task.updated']);
  assert.equal(evidence.audit.filter(x => x.eventType.startsWith('task.')).length, 2);
});
