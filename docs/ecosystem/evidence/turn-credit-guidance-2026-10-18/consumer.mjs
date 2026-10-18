import assert from 'node:assert/strict';
import fs from 'node:fs';
const [consumer,phase]=process.argv.slice(1);
const api=await import('@metaharness/turn-credit');
const {dispatch}=await import('@metaharness/turn-credit/cli');
const input={prior:0.3,success:true,turns:[{turn:1,label:'route:cheap',scoreWith:0.7,scoreWithout:0.5},{turn:2,label:'tool:edit',scoreWith:0.9,scoreWithout:0.2},{turn:3,label:'retry',scoreWith:0.3,scoreWithout:0.6}]};
const file=`${consumer}/credit.json`;
if(phase==='write'){
  fs.writeFileSync(`${consumer}/input.json`,JSON.stringify(input));
  const processed=await dispatch('process',[`${consumer}/input.json`,'--out',file,'--governed']);
  assert.equal(processed.code,0);assert.match(processed.lines.join('\n'),/PROXY/);
  const credit=JSON.parse(fs.readFileSync(file));
  assert.equal(credit.proxy,true);assert.equal(credit.boundPct,0.1);
  for(const c of credit.credits)assert.ok(c.multiplier>=0.9&&c.multiplier<=1.1);
  for(const success of [false,true]){
    const c=api.processTrajectory({evidence:api.evidenceFromScorePairs(input.turns),mode:'verifier-delta-proxy',prior:0.3,success,config:api.GOVERNED_DEFAULTS});
    assert.equal(c.outcomeSign,success?1:-1);
    for(const x of c.credits)assert.equal(Math.sign(api.reshapedAdvantage(c.advantage,x)),c.outcomeSign);
    const feedback=api.toMemoryFeedback(c,new Map([[1,['skill-a']],[2,['skill-b']]]));
    assert.equal(feedback.length,2);assert.ok(feedback.every(x=>x.resolved===success&&x.weight>=0.9&&x.weight<=1.1));
    assert.ok(api.toQualityLabels(c).every(x=>x.quality>=0&&x.quality<=1));
  }
  const neutral=api.processTrajectory({evidence:[{turn:1,evidence:0.5}],mode:'logprob-gap',prior:0.3,advantage:0,config:api.GOVERNED_DEFAULTS});
  assert.equal(neutral.outcomeSign,0);assert.ok(neutral.credits.every(x=>x.credit===0));
  assert.throws(()=>api.evidenceFromLogProbs([{turn:1,withContext:[-0.1],withoutContext:[]}]),/token counts differ/);
  const receipt=api.buildCreditReceiptPayload({credit,verifierVersion:'fixture@1',retrievedEvidence:{id:'skill-a'},trajectory:input});
  assert.equal(receipt.proxy,true);assert.equal(receipt.creditDigest,api.digest(credit));
  fs.writeFileSync(`${consumer}/receipt.json`,JSON.stringify(receipt));
  console.log(JSON.stringify({phase,passed:true,pid:process.pid,creditDigest:api.digest(credit),receiptDigest:api.digest(receipt)}));
}else{
  const report=await dispatch('report',[file]);assert.equal(report.code,0);assert.match(report.lines.join('\n'),/tool:edit/);assert.match(report.lines.join('\n'),/PROXY/);
  const saved=JSON.parse(fs.readFileSync(file));const receipt=JSON.parse(fs.readFileSync(`${consumer}/receipt.json`));
  const replay=api.processTrajectory({evidence:api.evidenceFromScorePairs(input.turns),mode:'verifier-delta-proxy',prior:0.3,success:true,config:api.GOVERNED_DEFAULTS});
  assert.equal(api.digest(replay),api.digest(saved));assert.equal(api.digest(saved),receipt.creditDigest);
  assert.equal((await dispatch('unknown',[])).code,2);
  assert.equal((await dispatch('report',[`${consumer}/missing.json`])).code,1);
  console.log(JSON.stringify({phase,passed:true,pid:process.pid,creditDigest:api.digest(saved),receiptDigest:api.digest(receipt)}));
}
