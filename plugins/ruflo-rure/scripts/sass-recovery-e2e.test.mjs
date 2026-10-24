import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, appendFileSync, symlinkSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cppDriver, arithmeticMutation, oracleSet, evaluateCpu, packageGpu } from './sass-recovery-e2e.mjs';
import { bounded } from './sass-recovery-translate.mjs';
const HERE=dirname(fileURLToPath(import.meta.url));
const sha=b=>createHash('sha256').update(b).digest('hex');

test('frozen oracle counts separate kernels, cases, and comparisons',async()=>{
  const dev=await oracleSet('development'),confirmation=await oracleSet('confirmation');
  assert.equal(dev.kernels.length,4);assert.equal(confirmation.kernels.length,6);
  assert.equal(dev.kernels.reduce((s,k)=>s+k.cases.length,0),28);
  assert.equal(confirmation.kernels.reduce((s,k)=>s+k.cases.length,0),36);
  assert.equal(dev.kernels.flatMap(k=>k.cases).reduce((s,v)=>s+v.expected.length,0),780);
  assert.equal(confirmation.kernels.flatMap(k=>k.cases).reduce((s,v)=>s+v.expected.length,0),1008);
});

test('compiled semantic mutation and output corruption fail unchanged independent oracle',()=>{
  const dir=mkdtempSync(join(tmpdir(),'sass-evaluator-negative-'));
  try{
    const oracle={id:'fixture',inputBits:32,outputBits:32,cases:[{count:1,scalar:'0',input:['4294967295','0','0','0','0','0','0','0','0'],aux:Array(9).fill('0'),expected:['6',...Array(8).fill('2779096485')],sentinel:'2779096485'}]};
    const result={functions:[{emittedName:'recovered'}],code:'extern "C" __global__ void recovered(uint64_t x,uint64_t,uint64_t z,uint32_t n,uint64_t){uint32_t i=blockIdx.x*blockDim.x+threadIdx.x;if(i<n)reinterpret_cast<uint32_t*>(z)[i]=reinterpret_cast<uint32_t*>(x)[i]+0x7ULL;}'};
    for(const kind of ['correct','arithmetic','output']){
      const r=kind==='arithmetic'?{...result,code:arithmeticMutation(result.code)}:result;
      const source=join(dir,kind+'.cpp'),binary=join(dir,kind);
      writeFileSync(source,cppDriver(oracle,r,kind==='output'));
      const compile=spawnSync('g++',['-std=c++17','-O2','-fsanitize=undefined','-fno-sanitize-recover=all',source,'-o',binary],{encoding:'utf8',timeout:30000});
      assert.equal(compile.status,0,compile.stderr);
      const run=spawnSync(binary,[],{encoding:'utf8',timeout:3000});
      assert.equal(run.status,kind==='correct'?0:1,run.stderr);
      if(kind!=='correct')assert.match(run.stdout,/mismatch/);
    }
    assert.throws(()=>arithmeticMutation('no constant seven'),/anchor/);
    assert.throws(()=>arithmeticMutation('0x7ULL + 0x7ULL'),/anchor/);
  }finally{rmSync(dir,{recursive:true,force:true});}
});

test('input-only adapter refuses tampered inputs, optimistic proof, and output overwrite',()=>{
  const dir=mkdtempSync(join(tmpdir(),'sass-adapter-negative-'));
  try{
    const input=join(dir,'input');mkdirSync(input);mkdirSync(join(input,'fixture'));
    writeFileSync(join(input,'fixture','original.sass'),'synthetic sass');writeFileSync(join(input,'fixture','original.elf'),'synthetic elf');
    const manifest={schemaVersion:1,kernels:[{id:'fixture',sassSha256:sha('synthetic sass'),elfSha256:sha('synthetic elf')}]};
    const manifestBytes=JSON.stringify(manifest);writeFileSync(join(input,'translation-input.json'),manifestBytes);
    const module=join(dir,'candidate.mjs');
    const code=proof=>`import{createHash}from'node:crypto';if(!import.meta.url.startsWith('data:'))throw Error('candidate reopened from path');const h=s=>createHash('sha256').update(s).digest('hex');export function recoverSass(s,e){return{schemaVersion:1,status:'unsupported',sourceSha256:h(s),elfSha256:h(e),proofStatus:'${proof}',language:'cuda-cpp',code:null,functions:[],diagnostics:[]}}`;
    const invoke=(output,source=code('not-proven'))=>{writeFileSync(module,source);return spawnSync(process.execPath,[join(HERE,'sass-recovery-translate.mjs'),'--module',module,'--module-sha256',sha(source),'--input',input,'--manifest-sha256',sha(manifestBytes),'--output',output],{encoding:'utf8',timeout:5000});};
    const output=join(dir,'valid');assert.equal(invoke(output).status,0);
    const receipt=JSON.parse(readFileSync(join(output,'translation-result.json')));assert.deepEqual(receipt.coverage,{total:1,emitted:0,unsupported:1,invalid:0});
    assert.equal(invoke(output).status,1);
    assert.equal(invoke(join(dir,'optimistic'),code('proven')).status,1);
    writeFileSync(join(input,'fixture','original.sass'),'mutated');
    const tampered=invoke(join(dir,'tampered'));assert.equal(tampered.status,1);assert.match(tampered.stderr,/digest mismatch/);
  }finally{rmSync(dir,{recursive:true,force:true});}
});

test('translator descriptor reads reject FIFOs, symlinks, large and growing files',async()=>{
  const dir=mkdtempSync(join(tmpdir(),'sass-descriptor-'));
  try{
    const regular=join(dir,'regular');writeFileSync(regular,'exact');
    assert.equal((await bounded(regular,8)).toString(),'exact');
    symlinkSync(regular,join(dir,'link'));await assert.rejects(bounded(join(dir,'link'),8));
    assert.equal(spawnSync('mkfifo',[join(dir,'pipe')]).status,0);
    await assert.rejects(bounded(join(dir,'pipe'),8),/unsafe/);
    writeFileSync(regular,Buffer.alloc(1025));await assert.rejects(bounded(regular,1024),/oversized/);
    writeFileSync(regular,Buffer.alloc(1024));
    const pending=bounded(regular,32768);appendFileSync(regular,Buffer.alloc(65536));
    try{const value=await pending;assert.ok(value.length<=32768);}catch(error){assert.match(error.message,/oversized/);}
  }finally{rmSync(dir,{recursive:true,force:true});}
});

test('partial GPU package preserves denominator and requires all admitted negative controls',async()=>{
  const dir=mkdtempSync(join(tmpdir(),'sass-partial-package-'));
  try{
    const native=join(dir,'native');
    const prep=spawnSync('python3',[join(HERE,'sass-recovery-prepare-native.py'),'--retained-development',join(HERE,'../docs/evidence/recovery-20261024/gpu-attempt3/baseline-inputs.tar.gz'),'--output',native],{encoding:'utf8',timeout:5000});
    assert.equal(prep.status,0,prep.stderr);
    const inputs=join(native,'translation-input'),input=JSON.parse(readFileSync(join(inputs,'translation-input.json')));
    const translations=join(dir,'translations');mkdirSync(translations);
    const receipt={status:'translated',inputManifestSha256:sha(readFileSync(join(inputs,'translation-input.json'))),moduleSha256:'synthetic-test-only',kernels:[]};
    for(const k of input.kernels){
      const emitted=k.id==='copy32',code=emitted?'extern "C" __global__ void recovered(uint64_t x,uint64_t,uint64_t z,uint32_t n,uint64_t){uint32_t i=blockIdx.x*blockDim.x+threadIdx.x;if(i<n)reinterpret_cast<uint32_t*>(z)[i]=reinterpret_cast<uint32_t*>(x)[i];}':null;
      const result={schemaVersion:1,status:emitted?'emitted':'unsupported',sourceSha256:k.sassSha256,elfSha256:k.elfSha256,proofStatus:'not-proven',language:'cuda-cpp',code,functions:emitted?[{name:k.id,emittedName:'recovered',parameters:[8,8,8,4,8].map((size,ordinal)=>({ordinal,size,type:ordinal===3?'uint32_t':'uint64_t'}))}]:[]};
      const recovery=JSON.stringify(result);mkdirSync(join(translations,k.id));writeFileSync(join(translations,k.id,'recovery.json'),recovery);if(emitted)writeFileSync(join(translations,k.id,'recovered.cu'),code);
      receipt.kernels.push({id:k.id,status:result.status,sourceSha256:k.sassSha256,elfSha256:k.elfSha256,recoverySha256:sha(recovery),codeSha256:code===null?null:sha(code)});
    }
    writeFileSync(join(translations,'translation-result.json'),JSON.stringify(receipt));
    const cpu=join(dir,'cpu');const result=await evaluateCpu({split:'development',inputs,native,translations,output:cpu});
    assert.equal(result.status,'coverage-incomplete');assert.equal(result.coverage.correct,1);
    const args={split:'development',inputs,native,translations,cpu};
    await assert.rejects(packageGpu({...args,output:join(dir,'no-subset')}),/CPU evidence/);
    const gpu=await packageGpu({...args,'allow-subset':'true',output:join(dir,'subset')});
    assert.equal(gpu.coverage.status,'partial-incomplete');assert.equal(gpu.coverage.frozenKernelCount,4);assert.equal(gpu.coverage.admittedKernelCount,1);assert.equal(gpu.coverage.excluded.length,3);assert.equal(gpu.expected.cases,7);assert.equal(gpu.expected.elementComparisonsBothVariants,390);
    result.kernels[0].negativeControl.execute.exitCode=0;writeFileSync(join(cpu,'cpu-receipt.json'),JSON.stringify(result));
    await assert.rejects(packageGpu({...args,'allow-subset':'true',output:join(dir,'bad-negative')}),/negative-control/);
  }finally{rmSync(dir,{recursive:true,force:true});}
});

test('GPU driver rejects renamed PTX bytes before module loading (CPU API stub)',()=>{
  const dir=mkdtempSync(join(tmpdir(),'sass-driver-admission-'));
  try{
    const cuda=`#pragma once
#include <stdint.h>
#include <stddef.h>
#define CUDA_VERSION 13000
#define CUDA_SUCCESS 0
using CUresult=int;using CUdevice=int;using CUcontext=void*;using CUmodule=void*;using CUfunction=void*;using CUdeviceptr=uint64_t;struct CUctxCreateParams{};
inline int cuGetErrorName(int,const char**p){*p="stub";return 0;}
inline int cuInit(unsigned){return 0;}inline int cuDeviceGet(int*p,int){*p=0;return 0;}
inline int cuCtxCreate(void**p,CUctxCreateParams*,unsigned,int){*p=nullptr;return 0;}
inline int cuDeviceGetName(char*p,int,int){p[0]=0;return 0;}inline int cuDriverGetVersion(int*p){*p=0;return 0;}
inline int cuModuleLoadData(void**p,const void*){*p=nullptr;return 0;}
inline int cuModuleGetFunction(void**p,void*,const char*){*p=nullptr;return 0;}
inline int cuMemAlloc(uint64_t*p,size_t){*p=0;return 0;}inline int cuMemcpyHtoD(uint64_t,const void*,size_t){return 0;}
inline int cuMemcpyDtoH(void*,uint64_t,size_t){return 0;}inline int cuMemFree(uint64_t){return 0;}
inline int cuModuleUnload(void*){return 0;}inline int cuCtxDestroy(void*){return 0;}inline int cuCtxSynchronize(){return 0;}
inline int cuLaunchKernel(void*,unsigned,unsigned,unsigned,unsigned,unsigned,unsigned,unsigned,void*,void**,void**){return 0;}
`;
    writeFileSync(join(dir,'cuda.h'),cuda);const binary=join(dir,'driver');
    const compile=spawnSync('g++',['-std=c++17','-x','c++','-I',dir,join(HERE,'sass-recovery-gpu.cu'),'-o',binary],{encoding:'utf8',timeout:30000});
    assert.equal(compile.status,0,compile.stderr);
    mkdirSync(join(dir,'fixture'));writeFileSync(join(dir,'kernels.txt'),'fixture\n');
    writeFileSync(join(dir,'fixture','case.txt'),'fixture recovered 32 32\n1 0 9 9 1\n');
    writeFileSync(join(dir,'fixture','original.cubin'),'.version 7.0\n.target sm_86\n');
    const run=spawnSync(binary,[dir],{encoding:'utf8',timeout:3000});
    assert.equal(run.status,2);assert.match(run.stderr,/not an ELF cubin/);assert.doesNotMatch(run.stderr,/cuModuleLoadData/);
    writeFileSync(join(dir,'fixture','original.cubin'),Buffer.alloc(4*1024*1024+1));
    const oversized=spawnSync(binary,[dir],{encoding:'utf8',timeout:3000});
    assert.equal(oversized.status,2);assert.match(oversized.stderr,/invalid bounded input size/);
    for(const file of ['original.cubin','recovered.cubin'])writeFileSync(join(dir,'fixture',file),Buffer.from([127,69,76,70]));
    for(const field of ['input','aux','expected'])writeFileSync(join(dir,'fixture',`n0.${field}.bin`),Buffer.alloc(32));
    writeFileSync(join(dir,'fixture','case.txt'),'fixture recovered 32 32\n0 0 8 8 1\n1 0');
    const truncated=spawnSync(binary,[dir],{encoding:'utf8',timeout:3000});
    assert.equal(truncated.status,2,'truncated final case must not disappear as EOF');
    writeFileSync(join(dir,'kernels.txt'),'a'.repeat(16385));
    const oversizedList=spawnSync(binary,[dir],{encoding:'utf8',timeout:3000});
    assert.equal(oversizedList.status,2);assert.match(oversizedList.stderr,/invalid bounded input size/);
  }finally{rmSync(dir,{recursive:true,force:true});}
});
