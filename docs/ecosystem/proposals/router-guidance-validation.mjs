import { readFileSync, writeFileSync, mkdirSync, mkdtempSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import assert from 'node:assert/strict';

const { values } = parseArgs({ options: {
  'artifact-root': { type: 'string' }, 'source-root': { type: 'string' },
  'output-root': { type: 'string' }
} });
for (const key of ['artifact-root', 'source-root', 'output-root'])
  assert(values[key], `Required argument: --${key}`);
const artifacts = resolve(values['artifact-root']);
const source = resolve(values['source-root']);
const output = resolve(values['output-root']);
assert.equal(JSON.parse(readFileSync(join(source, 'packages/router/package.json'))).version, '0.4.0');
mkdirSync(output, { recursive:true, mode:0o700 });
const root = mkdtempSync(join(output, 'consumer-'));
const hash = b => createHash('sha256').update(b).digest('hex');
function run(cmd, args, cwd, label) {
  const r = spawnSync(cmd, args, { cwd, encoding: 'utf8', timeout: 180000, env: { ...process.env, NODE_TEST_CONTEXT: undefined } });
  writeFileSync(join(root, `${label}.log`), `${r.stdout || ''}${r.stderr || ''}`);
  assert.equal(r.status, 0, `${label} failed: ${r.stderr} ${r.stdout}`);
  return r.stdout;
}
const fixture = `
import assert from 'node:assert/strict';
import { writeFileSync, readFileSync } from 'node:fs';
import * as api from '@metaharness/router';
const rows=[{embedding:[1,0],scores:{cheap:.9,strong:.6}},{embedding:[.95,.05],scores:{cheap:.88,strong:.62}},{embedding:[.9,.1],scores:{cheap:.86,strong:.6}},{embedding:[0,1],scores:{cheap:.5,strong:.92}},{embedding:[.05,.95],scores:{cheap:.52,strong:.9}},{embedding:[.1,.9],scores:{cheap:.55,strong:.9}}];
const prices={cheap:3,strong:45};
const candidates=Object.keys(prices).map(id=>({id,costPerMTok:prices[id],examples:rows.map(row=>({embedding:row.embedding,quality:row.scores[id]}))}));
const knn=new api.Router({candidates,k:1,qualityBar:.8});
assert.equal(knn.route([1,0]).id,'cheap'); assert.equal(knn.route([0,1]).id,'strong');
const trained=api.trainRouter(rows,prices); assert(trained.lambda>0); assert(trained.looQuality>.7);
assert.equal(trained.router.route([1,0]).id,'cheap'); assert.equal(trained.router.route([0,1]).id,'strong');
writeFileSync('trained.json',JSON.stringify(trained.router.toJSON()));
assert.equal(api.brierScore([{predicted:1,realized:1}]),0);
assert.equal(await api.isNativeRouterAvailable(),false); assert.equal(await api.resolveRouterBackend('auto'),'js');
await assert.rejects(api.resolveRouterBackend('native'),/not installed/);
await assert.rejects(api.trainNativeRouter([],prices,{outputPath:'absent.safetensors'}),/not installed/);
await assert.rejects(api.NativeRouter.load({modelPath:'absent.safetensors'}),/not installed/);
assert.equal(JSON.parse(readFileSync('node_modules/@metaharness/router/package.json','utf8')).version,'0.4.0');
console.log(JSON.stringify({exports:Object.keys(api).sort(),knn:[knn.route([1,0]),knn.route([0,1])],trained:trained.router.toJSON(),nativeAbsent:true}));
`;
const reload = `import assert from 'node:assert/strict'; import {readFileSync} from 'node:fs'; import {TrainedRouter} from '@metaharness/router';const r=TrainedRouter.fromJSON(JSON.parse(readFileSync('trained.json','utf8')));assert.equal(r.route([1,0]).id,'cheap');assert.equal(r.route([0,1]).id,'strong');console.log('fresh-process KRR reload passed');`;
const nativeTrain = `import assert from 'node:assert/strict'; import {statSync,readFileSync} from 'node:fs'; import {isNativeRouterAvailable,nativeRouterVersion,resolveRouterBackend,trainNativeRouter} from '@metaharness/router';assert.equal(await isNativeRouterAvailable(),true);assert.equal(await resolveRouterBackend('auto'),'native');const packageVersion=JSON.parse(readFileSync('node_modules/@ruvector/tiny-dancer/package.json','utf8')).version;assert.equal(packageVersion,'0.1.21');const nativeVersion=await nativeRouterVersion();assert.equal(nativeVersion,'2.2.3');const rows=Array.from({length:24},(_,i)=>({embedding:Array.from({length:5},(_,j)=>j===0?(i%2===0?1:0):j===1?(i%2===0?0:1):((i*7+j)%5)/50),scores:i%2===0?{cheap:.9,strong:.92}:{cheap:.45,strong:.95}}));const r=await trainNativeRouter(rows,{cheap:1,strong:15},{outputPath:'router.safetensors',epochs:30});assert(r.epochsRun>0);assert(r.modelBytes>0);assert.equal(statSync('router.safetensors').size,r.modelBytes);console.log(JSON.stringify({...r,packageVersion,nativeVersion}));`;
const nativeRoute = `import assert from 'node:assert/strict';import {NativeRouter} from '@metaharness/router';const r=await NativeRouter.load({modelPath:'router.safetensors'});const d=await r.route([1,0,0,0,0],[{id:'cheap',embedding:[1,0,0,0,0],costPerMTok:1},{id:'strong',embedding:[0,1,0,0,0],costPerMTok:15}]);assert(['cheap','strong'].includes(d.id));assert(d.confidence>=0&&d.confidence<=1);assert.equal(typeof d.useLightweight,'boolean');assert(d.inferenceTimeUs>=0);console.log(JSON.stringify(d));`;
const receipts = {};
for (const variant of ['baseline','candidate']) {
 const cwd=join(root,`${variant}-consumer`);mkdirSync(cwd,{recursive:true});writeFileSync(join(cwd,'package.json'),JSON.stringify({private:true,type:'module'}));
 const archive=join(artifacts,`${variant}-pack/metaharness-router-0.4.0.tgz`);
 run('npm',['install','--ignore-scripts','--no-audit','--no-fund','--cache',join(root,`${variant}-cache`),archive],cwd,`${variant}-install`);
 receipts[variant]={archiveSha256:hash(readFileSync(archive)),js:JSON.parse(run('node',['--input-type=module','-e',fixture],cwd,`${variant}-consumer-js`).trim())};
 run('node',['--input-type=module','-e',reload],cwd,`${variant}-consumer-reload`);
 if(variant==='candidate')assert.equal(readFileSync(join(cwd,'node_modules/@metaharness/router/AGENTS.md'),'utf8'),readFileSync(join(source,'packages/router/AGENTS.md'),'utf8'));
 run('npm',['install','--ignore-scripts','--no-audit','--no-fund','--cache',join(root,`${variant}-native-cache`),'--save-exact','@ruvector/tiny-dancer@0.1.21'],cwd,`${variant}-native-install`);
 run('node',['--input-type=module','-e',nativeTrain],cwd,`${variant}-native-train`);
 run('node',['--input-type=module','-e',nativeRoute],cwd,`${variant}-native-restart-route`);
}
assert.deepEqual(receipts.baseline.js,receipts.candidate.js);
writeFileSync(join(root,'consumer-validation.json'),JSON.stringify({schemaVersion:1,platform:process.platform,arch:process.arch,node:process.version,policy:'fresh per-consumer npm cache; ignore-scripts; no audit/fund; separately pinned optional native peer',receipts},null,2)+'\n');
console.log('baseline and candidate fresh JS, absent-native, native train/restart/route passed; JS outputs identical');
console.log(JSON.stringify({outputDirectory:root}));
