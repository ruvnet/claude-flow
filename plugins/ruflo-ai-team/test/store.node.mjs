import test from 'node:test';
import assert from 'node:assert/strict';
import { InMemoryStore } from '../src/store.mjs';
import { TenantVectorMemory } from '../src/vector-memory.mjs';
import { vectorMemoryFromEnv } from '../src/vector-memory.mjs';

test('in-memory store enforces tenant ownership at every repository method', async () => {
  const store=new InMemoryStore();
  const team=await store.createTeam('tenant-a',{name:'A',objective:'A only',roles:['researcher']});
  const run=await store.createRun('tenant-a',{teamId:team.id,objective:'run',budgetUnits:10});
  const task=await store.createTask('tenant-a',{runId:run.id,title:'t',description:'d',assigneeRole:'researcher'});
  assert.equal(await store.getTeam('tenant-b',team.id),null);
  assert.equal(await store.createRun('tenant-b',{teamId:team.id,objective:'x',budgetUnits:1}),null);
  assert.equal(await store.updateTask('tenant-b',task.id,{status:'complete'}),null);
  assert.deepEqual(await store.listTasks('tenant-b',run.id),[]);
  assert.equal(await store.evidence('tenant-b',run.id),null);
});

test('portable vector indexes are separated per tenant', async () => {
  const store=new InMemoryStore(); const vectors=new TenantVectorMemory(store);
  const a=await store.createTeam('a',{name:'A',objective:'',roles:[]});
  const b=await store.createTeam('b',{name:'B',objective:'',roles:[]});
  await store.remember('a',{teamId:a.id,key:'secret-a',text:'alpha private launch code'});
  await store.remember('b',{teamId:b.id,key:'public-b',text:'beta public checklist'});
  const result=await vectors.search('b',{teamId:b.id,query:'alpha private launch',limit:10});
  assert.deepEqual(result.results.map(x=>x.memory.id),['public-b']);
});

test('vector cache is bounded under tenant fan-out', async () => {
  const store=new InMemoryStore(); const vectors=new TenantVectorMemory(store,{maxIndexes:3});
  for(let i=0;i<12;i++){const tenant=`t${i}`;const team=await store.createTeam(tenant,{name:tenant,objective:'',roles:[]});await vectors.search(tenant,{teamId:team.id,query:'x',limit:1});}
  assert.equal(vectors.indexes.size,3);
});

test('native RuVector loader is visible rather than silently mislabeled', async () => {
  const store=new InMemoryStore(); const previous=process.env.RUFLO_AI_TEAM_VECTOR; process.env.RUFLO_AI_TEAM_VECTOR='native';
  try {
    const vectors=await vectorMemoryFromEnv(store); const team=await store.createTeam('native',{name:'N',objective:'',roles:[]});
    await store.remember('native',{teamId:team.id,key:'n1',text:'vector backend probe'});
    const result=await vectors.search('native',{teamId:team.id,query:'vector backend',limit:1});
    assert.ok(['ruvector-native','lexical-degraded'].includes(result.backend));
    assert.equal(result.degraded,result.backend==='lexical-degraded');
  } finally { if(previous===undefined)delete process.env.RUFLO_AI_TEAM_VECTOR; else process.env.RUFLO_AI_TEAM_VECTOR=previous; }
});
