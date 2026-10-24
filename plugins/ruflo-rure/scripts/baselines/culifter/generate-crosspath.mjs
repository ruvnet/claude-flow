import {writeFileSync,mkdirSync,readFileSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
const [corpusFile,metadataFile,outDir]=process.argv.slice(2);
if(!corpusFile||!metadataFile||!outDir)throw Error('usage: node generate-crosspath.mjs <corpus.mjs> <parameter-offsets.json> <output-dir>');
const corpus=await import(pathToFileURL(resolve(corpusFile)));
const metadata=JSON.parse(readFileSync(metadataFile,'utf8'));
const ids=['copy32','add7_wrap32','multiply_low64','wide_signed'];
mkdirSync(outDir,{recursive:true});
const srcHash=createHash('sha256').update(readFileSync(corpusFile)).digest('hex');
const results=[];
for(const k of corpus.kernels.filter(k=>ids.includes(k.id)&&k.split==='development')){
  const args=metadata[k.id];
  if(!Array.isArray(args)||args.length!==5||args.map(a=>a.size).join(',')!=='8,8,8,4,8')throw Error('bad ABI '+k.id);
  for(const a of args)if(!Number.isInteger(a.offset)||a.offset<0||a.offset+a.size>4096)throw Error('bad offset');
  const inputType=k.bits===32?'uint32_t':'uint64_t', outputType=k.outBits===32?'uint32_t':'uint64_t';
  let text=`#include <stdint.h>\n#include <stdio.h>\n#include <string.h>\nextern "C" {\nalignas(8) thread_local uint8_t const_mem[5][4096] = {};\nalignas(16) thread_local uint8_t local_mem[32768] = {};\nalignas(16) uint8_t shared_mem[32768] = {};\nvoid ${k.id}();\n}\ntemplate<class T> static void set(unsigned o,T v){memcpy(&const_mem[0][o],&v,sizeof(v));}\nint main(){uint64_t comparisons=0;\n`;
  for(const n of corpus.sizes){
    const v=corpus.vectors(k,n), lit=a=>a.map(x=>`${x}ULL`).join(',');
    text+=`{${inputType} input[]={${lit(v.input)}};${inputType} aux[]={${lit(v.aux)}};${outputType} output[${n+8}], expected[]={${lit(v.expected)}};\nfor(auto &x:output)x=${v.sentinel}ULL;\n`;
    text+=`set(${args[0].offset},uint64_t(uintptr_t(input)));set(${args[1].offset},uint64_t(uintptr_t(aux)));set(${args[2].offset},uint64_t(uintptr_t(output)));set(${args[3].offset},uint32_t(${n}));set(${args[4].offset},uint64_t(0));set(0,uint32_t(8));\nfor(uint32_t block=0;block<${Math.ceil(n/8)+1};++block){set(32,block);for(uint32_t thread=0;thread<8;++thread){set(44,thread);${k.id}();}}\nfor(unsigned i=0;i<${n+8};++i){++comparisons;if(output[i]!=expected[i]){printf("FAIL ${k.id} n=${n} i=%u expected=%llu actual=%llu\\n",i,(unsigned long long)expected[i],(unsigned long long)output[i]);return 1;}}}\n`;
  }
  text+=`printf("{\\\"status\\\":\\\"pass\\\",\\\"kernel\\\":\\\"${k.id}\\\",\\\"cases\\\":7,\\\"comparisons\\\":%llu}\\n",(unsigned long long)comparisons);return 0;}\n`;
  // C++ printf should emit JSON quotes, not backslashes.
  text=text.replaceAll('\\\\\\"','\\"');
  const file=join(outDir,k.id+'-independent.cpp');writeFileSync(file,text);
  results.push({id:k.id,sourceSha256:createHash('sha256').update(corpus.ptxFor(k)).digest('hex'),driverSha256:createHash('sha256').update(text).digest('hex')});
}
if(results.length!==4)throw Error('missing selected development kernel');
writeFileSync(join(outDir,'crosspath-drivers.json'),JSON.stringify({corpusSha256:srcHash,kernels:results},null,2)+'\n');
console.log(JSON.stringify({drivers:results.length,corpusSha256:srcHash}));
