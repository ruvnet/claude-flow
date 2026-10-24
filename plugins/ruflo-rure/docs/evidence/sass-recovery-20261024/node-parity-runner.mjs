import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';
const hash = b => createHash('sha256').update(b).digest('hex');
const module = resolve(process.argv[2]), input = resolve(process.argv[3]);
if (hash(readFileSync(module)) !== 'd85b93f70711d17c5c44f97a93d4a04ac08549cc253c70c88ab84294757287c3') throw Error('module hash');
const manifest = JSON.parse(readFileSync(join(input,'manifest.json')));
if (manifest.kernels.length !== 4) throw Error('development input count');
const inputs = manifest.kernels.map(k => {
  if (!/^[a-z0-9_]+$/.test(k.id)) throw Error('unsafe development ID');
  const sass=readFileSync(join(input,k.id+'.sass')),elf=readFileSync(join(input,k.id+'.elf'));
  if(hash(sass)!==k.sassSha256||hash(elf)!==k.elfSha256) throw Error('input hash');
  return {id:k.id,sass:sass.toString(),elf:elf.toString()};
});
const {recoverSass}=await import(pathToFileURL(module));
const results=inputs.map(k=>{const r=recoverSass(k.sass,k.elf);return {id:k.id,status:r.status,codeSha256:r.code===null?null:hash(r.code),resultSha256:hash(JSON.stringify(r))};});
console.log(JSON.stringify({node:process.version,moduleSha256:hash(readFileSync(module)),results}));
if(results.some(r=>r.status!=='emitted'))process.exitCode=1;
