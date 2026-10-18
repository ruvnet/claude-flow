import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import assert from 'node:assert/strict';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
const { values } = parseArgs({ options: {
  'artifact-root': { type: 'string' }, 'source-root': { type: 'string' },
  'output-root': { type: 'string' }
} });
for (const key of ['artifact-root', 'source-root', 'output-root'])
  assert(values[key], `Required argument: --${key}`);
const root=resolve(values['artifact-root']);
const source=resolve(values['source-root']);
const outputRoot=resolve(values['output-root']);
mkdirSync(outputRoot,{recursive:true,mode:0o700});
const sha=b=>createHash('sha256').update(b).digest('hex');
const archive=k=>`${root}/${k}-pack/metaharness-router-0.4.0.tgz`;
const files=k=>execFileSync('tar',['-tzf',archive(k)],{encoding:'utf8'}).trim().split('\n').sort();
const bytes=(k,p)=>execFileSync('tar',['-xOzf',archive(k),p]);
assert.deepEqual(readFileSync(archive('baseline')),readFileSync(archive('registry')));
const before=files('baseline'),after=files('candidate');
assert.deepEqual(after.filter(x=>!before.includes(x)),['package/AGENTS.md']);
assert.deepEqual(before.filter(x=>!after.includes(x)),[]);
const retained=before.filter(x=>x!=='package/package.json');
for(const p of retained)assert.deepEqual(bytes('baseline',p),bytes('candidate',p));
const oldManifest=JSON.parse(bytes('baseline','package/package.json'));
const newManifest=JSON.parse(bytes('candidate','package/package.json'));
assert.deepEqual(newManifest.files,oldManifest.files.toSpliced(1,0,'AGENTS.md'));
newManifest.files=oldManifest.files;assert.deepEqual(newManifest,oldManifest);
assert.deepEqual(bytes('candidate','package/AGENTS.md'),readFileSync(join(source,'packages/router/AGENTS.md')));
const output={sourceCommit:'e0dfd44da72b7adfb7c57fdd42d124be58ed7086',baselineRegistryByteIdentical:true,addedFiles:['package/AGENTS.md'],deletedFiles:[],identicalNonManifestFiles:retained.length,baselineBytes:readFileSync(archive('baseline')).length,candidateBytes:readFileSync(archive('candidate')).length,archives:Object.fromEntries(['baseline','candidate','registry'].map(k=>[k,sha(readFileSync(archive(k)))])),retainedFiles:retained.map(p=>({path:p,sha256:sha(bytes('baseline',p))}))};
writeFileSync(join(outputRoot,'pack-comparison.json'),JSON.stringify(output,null,2)+'\n',{flag:'wx'});console.log(JSON.stringify(output));
