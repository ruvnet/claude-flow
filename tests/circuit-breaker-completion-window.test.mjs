import { test } from 'vitest';
import assert from 'node:assert/strict';
import { CircuitBreaker } from '../v3/@claude-flow/shared/src/resilience/circuit-breaker.ts';
test('long-running failures expire old requests before evaluating the rolling window',async()=>{
 const breaker=new CircuitBreaker({name:'window',failureThreshold:2,volumeThreshold:2,successThreshold:1,timeout:60000,rollingWindow:1000});const realNow=Date.now;let clock=realNow();
 try{
  Date.now=()=>clock;await assert.rejects(breaker.execute(async()=>{throw new Error('old');}));
  let reject;const pending=breaker.execute(()=>new Promise((_,r)=>reject=r));
  clock+=2000;reject(new Error('recent'));await assert.rejects(pending,/recent/);
  assert.equal(breaker.getState(),'CLOSED');assert.equal(breaker.getStats().failures,1);
  await assert.rejects(breaker.execute(async()=>{throw new Error('next');}));
  assert.equal(breaker.getState(),'OPEN');
 }finally{Date.now=realNow;breaker.reset();}
});
