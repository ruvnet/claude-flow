#!/usr/bin/env node
// Compiles the emitter's CUDA C++ as actual C++ under CPU CUDA builtins stubs.
// Expected values come from a separately authored BigInt oracle. This does not
// establish GPU concurrency, floating-point correctness, readability, or SOTA.
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdirSync, mkdtempSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, resolve, join, extname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { stripTypeScriptTypes } from 'node:module';
import { spawnSync } from 'node:child_process';
import { performance } from 'node:perf_hooks';
import { kernels, sizes, vectors, ptxFor, rejectionCases, corpusManifest, hash } from './fixtures/ptx-recovery/corpus.mjs';

const ROOT=resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const FIXTURES=resolve(dirname(fileURLToPath(import.meta.url)), 'fixtures/ptx-recovery');
const quoted=n=>`UINT64_C(${n})`;
const array=(name,bits,values)=>`uint${bits}_t ${name}[${values.length}] = {${values.map(x=>bits===32?`UINT32_C(${x})`:quoted(x)).join(',')}};`;

function invoke(command,args,timeout=30000) {
  const p=spawnSync(command,args,{encoding:'utf8',timeout,maxBuffer:4*1024*1024,env:{PATH:process.env.PATH,LANG:'C',LC_ALL:'C'}});
  return {status:p.status,signal:p.signal,error:p.error?.message??null,stdout:p.stdout??'',stderr:p.stderr??''};
}

export async function loadRecovery(modulePath, directory) {
  const absolute=resolve(modulePath), source=readFileSync(absolute,'utf8');
  const provenance={modulePath:absolute,moduleSha256:hash(source),dependencies:[]};
  if(extname(absolute)!=='.ts') {
    const parser=join(dirname(absolute),'ptx-decompile.js');
    assert.ok(existsSync(parser),'compiled backend requires adjacent parser artifact for provenance');
    provenance.dependencies.push({name:'ptx-decompile',artifactSha256:hash(readFileSync(parser))});
    return {...await import(pathToFileURL(absolute).href),provenance};
  }
  // Node's official type stripper preserves runtime statements. Import rewriting
  // is unnecessary: adjacent .js is generated from the pinned parser .ts.
  const stage=join(directory,'module');mkdirSync(stage);
  writeFileSync(join(stage,'package.json'),'{"type":"module"}\n');
  for(const name of ['ptx-decompile','ptx-recover']) {
    const file=name==='ptx-recover'?absolute:join(dirname(absolute),`${name}.ts`);
    const input=readFileSync(file,'utf8');
    const output=stripTypeScriptTypes(input,{mode:'transform',sourceUrl:file});
    writeFileSync(join(stage,`${name}.js`),output);
    provenance.dependencies.push({name,sourceSha256:hash(input),transformedSha256:hash(output)});
  }
  provenance.loader='node:module stripTypeScriptTypes(mode=transform); adjacent parser staged; no runtime source transformation';
  return {...await import(pathToFileURL(join(stage,'ptx-recover.js')).href),provenance};
}

function checkedEmission(recoverPtx,ptx) {
  const r=recoverPtx(ptx);
  assert.equal(r.sourceSha256,hash(ptx),'emission must bind exact input');
  assert.equal(r.proofStatus,'not-proven','tests must not claim proof');
  assert.equal(r.status,'emitted',JSON.stringify(r.diagnostics));
  assert.equal(typeof r.code,'string');
  assert.ok(r.code.length>0&&r.code.length<=4*1024*1024,'bounded nonempty output');
  assert.ok(!/\b(?:asm|__asm|__asm__)\b/.test(r.code),'no PTX passthrough or inline assembly');
  assert.equal(r.functions.length,1);
  const fn=r.functions[0];
  const symbol=fn.emittedName??fn.name;
  assert.match(symbol,/^[A-Za-z_][A-Za-z_0-9]*$/);
  assert.deepEqual(fn.parameters.map(p=>p.type),['uint64_t','uint64_t','uint64_t','uint32_t','uint64_t']);
  return {...r,symbol};
}

function cpuTranslationUnit(emission,k) {
  const setup=`#include <stdint.h>\n#include <stdio.h>\n#define __global__\n#define __device__\n#define __host__\n#define __forceinline__ inline\nstruct dim3 { uint32_t x,y,z; };\nstatic dim3 threadIdx{0,0,0},blockIdx{0,0,0},blockDim{8,1,1},gridDim{1,1,1};\n`;
  const checks=sizes.map(n=>{
    const v=vectors(k,n),cap=n+8;
    return `{\n${array('input',k.bits,v.input)}\n${array('aux',k.bits,v.aux)}\n${array('expected',k.outBits,v.expected)}\nuint${k.outBits}_t output[${cap}];\nfor(unsigned j=0;j<${cap};j++) output[j]=${quoted(v.sentinel)};\ngridDim.x=${Math.ceil(n/8)+1};\nfor(blockIdx.x=0;blockIdx.x<gridDim.x;blockIdx.x++) for(threadIdx.x=0;threadIdx.x<8;threadIdx.x++) ${emission.symbol}((uint64_t)(uintptr_t)input,(uint64_t)(uintptr_t)aux,(uint64_t)(uintptr_t)output,${n},UINT64_C(0));\nfor(unsigned j=0;j<${cap};j++){ if(output[j]!=expected[j]){fprintf(stderr,"mismatch ${k.id} count=${n} index=%u expected=%llu actual=%llu\\n",j,(unsigned long long)expected[j],(unsigned long long)output[j]);return 1;} comparisons++; }\ncases++;\n}`;
  }).join('\n');
  return `${setup}\n${emission.code}\nint main(){unsigned cases=0,comparisons=0;\n${checks}\nprintf("{\\"status\\":\\"pass\\",\\"cases\\":%u,\\"elementComparisons\\":%u}\\n",cases,comparisons);return 0;}\n`;
}

function runCompiled(emission,k,dir,compiler) {
  const code=cpuTranslationUnit(emission,k),file=join(dir,`${k.id}.cpp`),binary=join(dir,k.id);
  writeFileSync(file,code);
  const started=performance.now();
  // UBSan checks supported undefined operations such as signed overflow and
  // misalignment. It does not catch every indirect memory error; the output
  // oracle and sentinels add finite coverage, not a memory-safety proof.
  const build=invoke(compiler,['-std=c++17','-O2','-Wall','-Wextra','-Werror=return-type','-fsanitize=undefined','-fno-sanitize-recover=all',file,'-o',binary]);
  const compileMs=performance.now()-started;
  if(build.status!==0) return {status:'compile-failed',codeSha256:hash(code),compileMs,build};
  const runStart=performance.now(),run=invoke(binary,[],10000),executeMs=performance.now()-runStart;
  if(run.status!==0) return {status:'execution-failed',codeSha256:hash(code),compileMs,executeMs,run};
  const raw=JSON.parse(run.stdout);
  assert.equal(raw.status,'pass');
  assert.equal(raw.cases,sizes.length);
  assert.equal(raw.elementComparisons,sizes.reduce((a,n)=>a+n+8,0));
  return {status:'pass',codeSha256:hash(code),compileMs,executeMs,...raw};
}

function writeWords(file,values,bits) {
  const buf=Buffer.alloc(values.length*bits/8);
  values.forEach((v,i)=>bits===32?buf.writeUInt32LE(Number(v),i*4):buf.writeBigUInt64LE(v,i*8));
  writeFileSync(file,buf);return hash(buf);
}

// A GPU operator compiles these emitted C++ files with nvcc and invokes the
// separately authored Driver API harness. No GPU work is silently inferred here.
export function exportGpuBundle(selected,emissions,destination) {
  assert.equal(emissions.size,selected.length,'all selected programs require an emission');
  for(const k of selected) {
    const e=emissions.get(k.id);
    assert.ok(e&&e.status==='emitted'&&typeof e.code==='string'&&e.code.length>0,'no partial GPU bundle');
    assert.equal(e.sourceSha256,hash(ptxFor(k)),'GPU source binding');
    assert.match(e.symbol,/^[A-Za-z_][A-Za-z_0-9]*$/);
  }
  mkdirSync(destination,{recursive:false});
  const manifest=[];
  for(const k of selected) {
    const emission=emissions.get(k.id);
    const dir=join(destination,k.id);mkdirSync(dir);
    writeFileSync(join(dir,'original.ptx'),ptxFor(k));
    writeFileSync(join(dir,'recovered.cu'),emission.code);
    const cases=[];
    for(const n of sizes) {
      const v=vectors(k,n),prefix=`n${n}`;
      cases.push({n,capacity:n+8,inputSha256:writeWords(join(dir,`${prefix}.input.bin`),v.input,k.bits),auxSha256:writeWords(join(dir,`${prefix}.aux.bin`),v.aux,k.bits),expectedSha256:writeWords(join(dir,`${prefix}.expected.bin`),v.expected,k.outBits)});
    }
    const line=`${k.id} ${emission.symbol} ${k.bits} ${k.outBits}`;
    manifest.push({id:k.id,symbol:emission.symbol,inputBits:k.bits,outputBits:k.outBits,originalSha256:hash(ptxFor(k)),recoveredSha256:hash(emission.code),cases});
    writeFileSync(join(dir,'case.txt'),`${line}\n${sizes.join(' ')}\n`);
  }
  writeFileSync(join(destination,'kernels.txt'),manifest.map(k=>k.id).join('\n')+'\n');
  writeFileSync(join(destination,'manifest.json'),JSON.stringify({schemaVersion:1,claim:'synthetic integer C++ recovery validation; not SOTA',kernels:manifest},null,2)+'\n');
  return {directory:destination,kernels:manifest.length,manifestSha256:hash(readFileSync(join(destination,'manifest.json')))};
}

export async function validateRecovery({modulePath,split='development',outputDirectory,compiler='g++',gpuBundle}={}) {
  assert.ok(['development','confirmation','all'].includes(split));
  const dir=outputDirectory?resolve(outputDirectory):mkdtempSync(join(tmpdir(),'rure-recovery-e2e-'));
  if(outputDirectory) {assert.ok(!existsSync(dir),'output directory must be new; preserve prior receipts');mkdirSync(dir);}
  const manifest=JSON.parse(readFileSync(join(FIXTURES,'manifest.json'),'utf8'));
  assert.deepEqual(corpusManifest(),manifest,'frozen corpus or oracle changed');
  const module=await loadRecovery(modulePath??resolve(ROOT,'v3/@claude-flow/cli/src/rure/ptx-recover.ts'),dir);
  assert.equal(typeof module.recoverPtx,'function');
  const compilerVersion=invoke(compiler,['--version']);assert.equal(compilerVersion.status,0,'C++ compiler required, never silently skipped');
  const selected=kernels.filter(k=>split==='all'||k.split===split),emissions=new Map(),results=[];
  for(const k of selected) {
    try {
      const t=performance.now(),emission=checkedEmission(module.recoverPtx,ptxFor(k)),recoveryMs=performance.now()-t;
      emissions.set(k.id,emission);
      results.push({id:k.id,split:k.split,sourceSha256:hash(ptxFor(k)),emittedSha256:hash(emission.code),recoveryMs,...runCompiled(emission,k,dir,compiler)});
    } catch(e) {results.push({id:k.id,split:k.split,status:'emission-failed',error:e.message});}
  }
  const rejections=rejectionCases.map(([id,ptx])=>{
    try {const r=module.recoverPtx(ptx);return {id,status:r.status!=='emitted'&&r.code===null?'pass':'fail',observedStatus:r.status,codeAbsent:r.code===null};}
    catch(e){return {id,status:'fail',error:`API threw instead of typed rejection: ${e.message}`};}
  });
  // Deliberately change arithmetic in candidate input but retain the original
  // independent oracle. The observable value must be wrong, not just a hash.
  const control=kernels.find(k=>k.id==='add7_wrap32');
  let negativeControl;
  try {
    const mutated=ptxFor(control).replace('add.u32 %r4, %r2, 7;','add.u32 %r4, %r2, 8;');
    const emission=checkedEmission(module.recoverPtx,mutated);
    const controlDir=join(dir,'mutation-control');mkdirSync(controlDir);
    const result=runCompiled(emission,control,controlDir,compiler);
    negativeControl={expected:'wrong arithmetic rejected by output oracle',mutatedSourceSha256:hash(mutated),...result};
    // Keep gate status distinct from the expected candidate execution failure.
    negativeControl.gateStatus=negativeControl.status==='execution-failed'&&result.run?.status===1&&/mismatch/.test(result.run.stderr)?'pass':'fail';
  } catch(e){negativeControl={gateStatus:'fail',error:e.message};}
  const pass=results.every(r=>r.status==='pass')&&rejections.every(r=>r.status==='pass')&&negativeControl.gateStatus==='pass';
  const receipt={schemaVersion:1,status:pass?'pass':'fail',claim:'CPU-compiled CUDA C++ recovery on frozen synthetic integer programs',sotaClaim:false,semanticProof:false,split,recordedAt:new Date().toISOString(),node:process.version,platform:process.platform,arch:process.arch,compiler:compilerVersion.stdout.split('\n')[0],compilerFlags:['-std=c++17','-O2','-fsanitize=undefined','-fno-sanitize-recover=all'],manifestSha256:hash(readFileSync(join(FIXTURES,'manifest.json'))),corpusSha256:hash(readFileSync(join(FIXTURES,'corpus.mjs'))),evaluatorSha256:hash(readFileSync(fileURLToPath(import.meta.url))),candidate:module.provenance,kernelCount:selected.length,passedKernels:results.filter(r=>r.status==='pass').length,cases:results.reduce((a,r)=>a+(r.cases??0),0),elementComparisons:results.reduce((a,r)=>a+(r.elementComparisons??0),0),rejectionCases:rejections,negativeControl,results,limitations:['Synthetic integer programs only; no external competitor reproduced.','CPU builtins stubs do not establish GPU scheduling or concurrency.','Finite test evidence is not a semantic equivalence proof.','Compile and execution times include process overhead and are not kernel latency.','Confirmation is independent-context once-only evaluation, not inaccessible secret storage.'],rawDirectory:dir};
  if(gpuBundle) receipt.gpuBundle=pass?exportGpuBundle(selected,emissions,resolve(gpuBundle)):{status:'not-exported',reason:'validation-failed'};
  writeFileSync(join(dir,'receipt.json'),JSON.stringify(receipt,null,2)+'\n');
  return receipt;
}

if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  const args=process.argv.slice(2),opts={};
  const names={'--module':'modulePath','--split':'split','--output':'outputDirectory','--compiler':'compiler','--gpu-bundle':'gpuBundle'};
  for(let i=0;i<args.length;i++) {
    if(args[i]==='--help'){console.log('node ptx-recovery-e2e.mjs [--module file.ts|file.js] [--split development|confirmation|all] [--output new-directory] [--compiler g++] [--gpu-bundle new-directory]');process.exit(0);}
    assert.ok(names[args[i]],`unknown option ${args[i]}`);assert.ok(args[i+1],`missing value for ${args[i]}`);opts[names[args[i]]]=args[++i];
  }
  const receipt=await validateRecovery(opts);console.log(JSON.stringify(receipt,null,2));
  if(receipt.status!=='pass')process.exitCode=1;
}
