import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
const root='/dev/shm/turn-credit-cycle9.aAzq6X',out=`${root}/evidence`;
const hash=b=>crypto.createHash('sha256').update(b).digest('hex');
const records=[];
function run(label,cmd,args,cwd){label=`validated-${label}`;const start=performance.now();const r=spawnSync(cmd,args,{cwd,encoding:'utf8',timeout:180000,maxBuffer:20e6,env:{...process.env,NODE_TEST_CONTEXT:undefined,TMPDIR:`${root}/tmp`,npm_config_cache:`${root}/npm-cache`}});const record={label,cmd:[cmd,...args],cwd,code:r.status,elapsedMs:Math.round(performance.now()-start),stdout:r.stdout,stderr:r.stderr};fs.writeFileSync(`${out}/${label}.json`,JSON.stringify(record,null,2));records.push({...record,stdout:undefined,stderr:undefined,logSha256:hash(JSON.stringify(record,null,2))});assert.equal(r.status,0,`${label}: ${r.stderr}\n${r.stdout}`);return r.stdout;}
const receipt={schema:'metaharness-guidance/v1',package:'@metaharness/turn-credit',version:'0.1.0',sourceBaseCommit:'e0dfd44da72b7adfb7c57fdd42d124be58ed7086',repository:'https://github.com/ruvnet/metaharness',packagePath:'packages/turn-credit',platform:{node:process.version,platform:process.platform,arch:process.arch},variants:{},commands:records,initialAttempts:'Both package-local test invocations failed before tests because ancestor vitest.config.ts could not resolve vitest; root tool symlinks then explicit repository root/selected test were used. Build/lint had passed. No source tests changed.',limits:['Guidance-only; no new runtime coverage, model training or quality claim','Unsigned packs, no publish, full native/security/release gates still required','Shared policy source-only, AGENTS included in pack']};
for(const variant of ['baseline','candidate']){
 const repo=`${root}/${variant}`,pkg=`${repo}/packages/turn-credit`,dir=`${out}/validated/${variant}`;fs.mkdirSync(dir,{recursive:true});
 run(`${variant}-build`,'npm',['run','build'],pkg);run(`${variant}-lint`,'npm',['run','lint'],pkg);run(`${variant}-test`,'npm',['test','--','--root','../..','packages/turn-credit/__tests__/turn-credit.test.ts','--maxWorkers=1','--minWorkers=1','--no-cache'],pkg);
 const pack=JSON.parse(run(`${variant}-pack`,'npm',['pack','--ignore-scripts','--json','--pack-destination',dir],pkg))[0];const tar=`${dir}/${pack.filename}`;
 const consumer=`${dir}/consumer`;fs.mkdirSync(consumer,{recursive:true});fs.writeFileSync(`${consumer}/package.json`,JSON.stringify({private:true,type:'module'}));
 run(`${variant}-install`,'npm',['install','--ignore-scripts','--no-audit','--no-fund','--cache',`${dir}/empty-cache`,tar],consumer);
 const code=fs.readFileSync(`${out}/consumer.mjs`,'utf8');const write=JSON.parse(run(`${variant}-consumer-write`,'node',['--input-type=module','--eval',code,consumer,'write'],consumer));const read=JSON.parse(run(`${variant}-consumer-restart`,'node',['--input-type=module','--eval',code,consumer,'restart'],consumer));assert.notEqual(write.pid,read.pid);assert.equal(write.creditDigest,read.creditDigest);
 const unpack=`${dir}/unpacked`;fs.mkdirSync(unpack,{recursive:true});run(`${variant}-unpack`,'tar',['-xzf',tar,'-C',unpack],dir);
 receipt.variants[variant]={pack,tarballSha256:hash(fs.readFileSync(tar)),consumer:{write,read},manifestSha256:hash(fs.readFileSync(`${pkg}/package.json`))};
}
const b=receipt.variants.baseline,c=receipt.variants.candidate;let same=0;
for(const f of b.pack.files){if(f.path==='package.json')continue;const old=fs.readFileSync(`${out}/validated/baseline/unpacked/package/${f.path}`);const next=fs.readFileSync(`${out}/validated/candidate/unpacked/package/${f.path}`);assert.deepEqual(next,old);same++;}
assert.ok(!b.pack.files.some(x=>x.path==='AGENTS.md'));assert.ok(c.pack.files.some(x=>x.path==='AGENTS.md'));
assert.equal(c.pack.files.length,b.pack.files.length+1);assert.equal(b.consumer.write.creditDigest,c.consumer.write.creditDigest);
receipt.comparison={bytesDelta:c.pack.size-b.pack.size,existingNonmanifestFilesIdentical:same,addedFiles:['AGENTS.md'],runtimeOutputIdentical:true};
const registry=JSON.parse(run('registry-mapping','npm',['view','@metaharness/turn-credit@0.1.0','version','repository','dist','--json','--registry=https://registry.npmjs.org'],out));receipt.registry=registry;receipt.baselineMatchesPublishedIntegrity=b.pack.integrity===registry.dist.integrity;
receipt.initialAttempts+=' Filesystem exhaustion interrupted the corrected first rerun before consumer validation. Original filesystem remained unchanged; complete validation ran in /dev/shm with explicit caches and TMPDIR. First fresh consumer probe incorrectly used require.resolve against an ESM-import-only export and failed before workflow. Preserved baseline-consumer-write.json; corrected test fixture uses actual ESM imports in new fresh consumers and new empty caches.';
fs.writeFileSync(`${out}/results.json`,JSON.stringify(receipt,null,2)+'\n');console.log(JSON.stringify({comparison:receipt.comparison,baselineMatchesPublishedIntegrity:receipt.baselineMatchesPublishedIntegrity,base:b.pack.size,candidate:c.pack.size}));
