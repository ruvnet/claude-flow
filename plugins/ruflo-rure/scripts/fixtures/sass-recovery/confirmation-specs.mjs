// Independently authored before any SASS candidate output. This file is for the
// evaluator and native-artifact preparer, never an input to recoverSass.
import { createHash } from 'node:crypto';
export const hash = x => createHash('sha256').update(x).digest('hex');
const u32=x=>BigInt.asUintN(32,x),u64=x=>BigInt.asUintN(64,x);
export const sizes=[0,1,3,17,32,67];
const scalars=[0n,1n,0xffffffffffffffffn,0x8000000000000000n,0x12345n,0xffffffffn];
const edge32=[0n,1n,0xffffffffn,0x80000000n,0x7fffffffn,0xffff0000n,0x10000n,19n,0xff00ff00n,0x10101010n,0x80000001n,0xabcdef03n,127n];
const edge64=[0n,1n,0xffffffffffffffffn,0x8000000000000000n,0x7fffffffffffffffn,0xffffffff00000000n,0x100000000n,19n,0xff00ff00ff00ff00n,0x1010101010101010n,0x8000000000000001n,0xabcdef0312345679n,127n];
export const kernels=[
  {id:'confirm_a71',inputBits:32,outputBits:32,body:'z[i] = x[i] * uint32_t(19) + y[i] + uint32_t(scalar);',oracle:(a,b,i,s)=>u32(a*19n+b+u32(s))},
  {id:'confirm_b83',inputBits:32,outputBits:32,body:'z[i] = x[i] * y[i] + i;',oracle:(a,b,i)=>u32(a*b+BigInt(i))},
  {id:'confirm_c97',inputBits:32,outputBits:64,body:'z[i] = uint64_t(x[i]) * uint64_t(y[i]) + scalar;',oracle:(a,b,i,s)=>u64(a*b+s)},
  {id:'confirm_d29',inputBits:32,outputBits:32,body:'z[i] = x[i * 2u] + y[i];',oracle:(a,b,i,s,input)=>u32(input[i*2]+b)},
  {id:'confirm_e43',inputBits:32,outputBits:64,body:'z[i] = uint64_t(uint32_t(x[i] + y[i])) * uint64_t(13) + scalar;',oracle:(a,b,i,s)=>u64(u32(a+b)*13n+s)},
  {id:'confirm_f61',inputBits:64,outputBits:64,body:'z[i] = x[i] * x[i] + y[i] * scalar;',oracle:(a,b,i,s)=>u64(a*a+b*s)},
];
export function sourceFor(k){return `#include <stdint.h>\nextern "C" __global__ void ${k.id}(uint64_t input, uint64_t aux, uint64_t output, uint32_t count, uint64_t scalar) {\n  uint32_t i = blockIdx.x * blockDim.x + threadIdx.x;\n  if (i >= count) return;\n  const uint${k.inputBits}_t* x = reinterpret_cast<const uint${k.inputBits}_t*>(input);\n  const uint${k.inputBits}_t* y = reinterpret_cast<const uint${k.inputBits}_t*>(aux);\n  uint${k.outputBits}_t* z = reinterpret_cast<uint${k.outputBits}_t*>(output);\n  ${k.body}\n}\n`;}
export function vectors(k,n){
  const index=sizes.indexOf(n);if(index<0)throw Error('unfrozen size');
  const scalar=scalars[index],edge=k.inputBits===32?edge32:edge64;
  const input=Array.from({length:2*n+8},(_,i)=>edge[(i*3+index)%edge.length]);
  const aux=Array.from({length:2*n+8},(_,i)=>edge[(i*7+5+index)%edge.length]);
  const sentinel=k.outputBits===32?0xa5a5a5a5n:0xa5a5a5a5a5a5a5a5n;
  const expected=Array.from({length:n+8},(_,i)=>i<n?k.oracle(input[i],aux[i],i,scalar,input):sentinel);
  return {count:n,scalar:scalar.toString(),input:input.map(String),aux:aux.map(String),expected:expected.map(String),sentinel:sentinel.toString()};
}
export function plan(){return {
  schemaVersion:1,scope:'six fresh hand-authored small integer CUDA programs; synthetic confirmation, not SOTA coverage',
  independence:'Authored by independent evaluator before candidate outputs. Source and oracle withheld from translator; shared filesystem is not a secret boundary.',
  nativeArtifacts:'CUDA source and exact oracle frozen first; native cubin/SASS/ELF hashes must be frozen before candidate evaluation. Generated textual mutations do not count as native artifacts.',
  compile:{language:'cuda-cpp',flags:['-std=c++17','-cubin'],architecture:'selected authorized GPU architecture; bind exact before compilation'},
  acceptance:{translationInput:['sass','elf'],forbidTranslatorInput:['cudaSource','ptx','oracle','expectedOutputs'],requiredNumericalEquality:'all emitted outputs and sentinel tails exactly match',unsupported:'count as unsupported, never as a correct recovery',cpu:'compile generated C++ with UBSan and independent BigInt references',gpu:'load exact retained original.cubin and newly compiled recovered.cubin via cuModuleLoad; bind both byte hashes',mutation:'deliberately incorrect recovered arithmetic or output must fail the independent oracle',sotaClaim:false},
  launch:{blockX:8,extraBlocks:1},
  kernels:kernels.map(k=>({id:k.id,inputBits:k.inputBits,outputBits:k.outputBits,sourceSha256:hash(sourceFor(k)),cases:sizes.map(n=>({count:n,oracleSha256:hash(JSON.stringify(vectors(k,n)))}))})),
};}
