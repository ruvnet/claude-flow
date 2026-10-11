import { test } from 'vitest';
import assert from 'node:assert/strict';
import { CircuitBreaker } from '../v3/@claude-flow/shared/src/resilience/circuit-breaker.ts';
test('statistics dates cannot alter failure, success or recovery timestamps',async()=>{
 const breaker=new CircuitBreaker({name:'dates',failureThreshold:1,volumeThreshold:1,successThreshold:1,timeout:60000,rollingWindow:60000});
 try{
  await breaker.execute(async()=>true);
  await assert.rejects(breaker.execute(async()=>{throw new Error('offline');}));
  const before=breaker.getStats();const original=[before.lastFailure.getTime(),before.lastSuccess.getTime(),before.openSince.getTime()];
  before.lastFailure.setTime(0);before.lastSuccess.setTime(0);before.openSince.setTime(0);
  assert.equal(breaker.getState(),'OPEN');
  const after=breaker.getStats();assert.deepEqual([after.lastFailure.getTime(),after.lastSuccess.getTime(),after.openSince.getTime()],original);
 }finally{breaker.reset();}
});
