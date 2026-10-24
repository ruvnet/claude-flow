import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, resolve } from 'node:path';
const SOURCE_SHA='99bd0ec252ef57bdd3985212f683c7ba22151ad6961f26a5de1c669c07c7b4b0';
const MODULE_SHA='d85b93f70711d17c5c44f97a93d4a04ac08549cc253c70c88ab84294757287c3';
const args={};for(let i=2;i<process.argv.length;i+=2)args[process.argv[i].replace(/^--/,'')]=process.argv[i+1];
for(const key of ['module','source','sm86-dir','sm89-dir','output'])if(!args[key])throw Error('required --'+key);
const digest=x=>createHash('sha256').update(x).digest('hex');
const moduleBytes=readFileSync(resolve(args.module));
if(digest(moduleBytes)!==MODULE_SHA||digest(readFileSync(resolve(args.source)))!==SOURCE_SHA)throw Error('reviewed source/module hash mismatch');
const {recoverSass}=await import('data:text/javascript;base64,'+moduleBytes.toString('base64'));
const sm86=resolve(args['sm86-dir']),sm89=resolve(args['sm89-dir']),outputDir=resolve(args.output);
if(existsSync(outputDir))throw Error('refusing output overwrite');mkdirSync(outputDir,{recursive:true});mkdirSync(join(outputDir,'cpu'));
function readExport(dir,name,ext){const flat=join(dir,name+'.'+ext);return readFileSync(existsSync(flat)?flat:join(dir,name,'original.'+ext),'utf8');}
const s=readExport(sm86,'copy32','sass'),e=readExport(sm86,'copy32','elf'),s89=readExport(sm89,'copy32','sass'),e89=readExport(sm89,'copy32','elf');
const CPU_TESTED_CODE_SHA={"copy32": "20aa71d5afc0d1440cfdea2b9dec02543934ef257d87bc8d3198bba063a3cff0", "add7_wrap32": "a98b111f24c032849db370f6ebbace4a91a77cc650dadcfb43ed59678d260fd4", "multiply_low64": "cd4dabe331dad3205fae96e995c93205675d1efd203273a11c54e4f4002737e0", "wide_signed": "369d67576dba6e53c55c025935c233dd01742d20ff7422a915fadd82c5c933f0"};
const positive=[];
for(const arch of ['sm86','sm89'])for(const name of ['copy32','add7_wrap32','multiply_low64','wide_signed']){
 const dir=arch==='sm86'?sm86:sm89; const sass=readExport(dir,name,'sass'),elf=readExport(dir,name,'elf');
 const r=recoverSass(sass,elf);
 positive.push({arch,name,status:r.status,diagnostics:r.diagnostics,sassSha256:digest(sass),elfSha256:digest(elf),sameCodeAsCpuTestedSm86:r.code!==null&&digest(r.code)===CPU_TESTED_CODE_SHA[name],codeSha256:r.code?digest(r.code):null});
}
const cases=[
 ['stale_r1',s.replace('MOV R1, c[0x0][0x28]','MOV R1, 0x9').replace('S2R R3, SR_TID.X','MOV R1, c[0x0][0x28]').replace('IMAD R4, R4, c[0x0][0x0], R3','IMAD R4, R4, c[0x0][0x0], R1'),e],
 ['initial_r1',s.replace('S2R R3, SR_TID.X','MOV R3, R1'),e],
 ['implicit_r1',s.replace('IMAD.WIDE.U32 R2, R4, R5, c[0x0][0x160]','IMAD.WIDE.U32 R2, R4, R5, R0'),e],
 ['missing_descriptor',s.replace('ULDC.64 UR4, c[0x0][0x118]','NOP'),e],
 ['predicated_descriptor',s.replace('ULDC.64 UR4, c[0x0][0x118]','@P0 ULDC.64 UR4, c[0x0][0x118]'),e],
 ['descriptor_clobber',s.replace('IMAD.WIDE.U32 R2, R4, R5, c[0x0][0x160]','MOV UR5, 0x0'),e],
 ['wrong_descriptor',s.replace('LDG.E R3, [R2.64]','LDG.E R3, desc[UR6][R2.64]'),e],
 ['explicit_descriptor',s.replace('LDG.E R3, [R2.64]','LDG.E R3, desc[UR4][R2.64]'),e],
 ['modifier',s.replace('LDG.E R3, [R2.64]','LDG.E.STRONG.SYS R3, [R2.64]'),e],
 ['predicated_only_definition',s.replace('S2R R3, SR_TID.X','@PT S2R R3, SR_TID.X'),e],
 ['branch_skips_descriptor',s.replace('MOV R5, 0x4','BRA 0x80'),e],
 ['undefined_predicate',s.replace('@P0 EXIT','@P1 EXIT'),e],
 ['padding_read',s.replace('MOV R5, 0x4','MOV R5, c[0x0][0x17c]'),e],
 ['crossing_param',s.replace('IMAD.WIDE.U32 R2, R4, R5, c[0x0][0x160]','IMAD.WIDE.U32 R2, R4, R5, c[0x0][0x164]'),e],
 ['arbitrary_const',s.replace('MOV R5, 0x4','MOV R5, c[0x0][0x4]'),e],
 ['name_injection',s.replace('Function : copy32','Function : x){}'),e],
 ['unreachable_opcode',s.replace('/*00e0*/                   NOP','/*00e0*/                   ATOM'),e],
 ['trailing_content',s+'\nMOV R1,0x4;\n',e],
 ['bad_branch',s.replace('BRA 0xd0','BRA 0xd1'),e],
 ['register_overflow',s.replace('MOV R5, 0x4','MOV R255, 0x4'),e],
 ['odd_pair',s.replace('[R2.64]','[R3.64]'),e],
 ['wrong_words',s,e.replace('0x00017a02','0x00017a03')],
 ['wrong_architecture',s,e.replace('sm=86','sm=89')],
 ['wrong_abi',s,e.replace('abi=7','abi=8')],
 ['wrong_toolkit',s,e.replace('toolkit=128','toolkit=129')],
 ['wrong_api',s,e.replace('Value:\t0x80','Value:\t0x82')],
 ['wrong_bank_size',s,e.replace('0x280160','0x240160')],
 ['wrong_bank_symbol',s,e.replace('0x2 0x280160','0x1 0x280160')],
 ['wrong_param_gap',s,e.replace('Ordinal : 0x1\tOffset  : 0x8','Ordinal : 0x1\tOffset  : 0x10')],
 ['wrong_param_size',s,e.replace('Ordinal : 0x0\tOffset  : 0x0\tSize    : 0x8','Ordinal : 0x0\tOffset  : 0x0\tSize    : 0x4')],
 ['duplicate_param_ordinal',s,e.replace('Ordinal : 0x1','Ordinal : 0x0')],
 ['short_constant_section',s,e.replace('418    188','418    180')],
 ['short_text_section',s,e.replace('600    180','600    170')],
 ['wrong_merc_version',s89,e89.replace('Value:\t0.0','Value:\t1.0')],
 ['wrong_target',s89.replace(/\.target\s+sm_89/,'.target sm_86'),e89],
 ['dialect_mismatch',s,e89],
 ['oversize_sass',' '.repeat(262145),e],
 ['oversize_elf',s,' '.repeat(262145)],
 ['nonascii',s+'\u00e9',e],
 ['text_relocation_section',s,e+'\n.section .rel.text.copy32\n0x0 R_CUDA_32I_32 copy32\n'],
 ['invalid_size_token',s,e.replace('418    188','418    188garbage')],
 ['nonsection_bank_symbol',s,e.replace('0x2               0               0      0x3','0x2               0               0      0x1')],
 ['offset_bank_symbol',s,e.replace('0x2               0               0      0x3','0x2             0x8               0      0x3')],
 ['ambiguous_64bit_immediate',s.replace('IMAD.WIDE.U32 R2, R4, R5, c[0x0][0x160]','IMAD.WIDE.U32 R2, R4, R5, 0xffffffff'),e],
 ['overlong_line',s+' '.repeat(2049)+'\n',e],
];
const negative=cases.map(([name,sass,elf])=>{const r=recoverSass(sass,elf);return {name,status:r.status,codeNull:r.code===null,diagnostics:r.diagnostics};});
const cpuSources=[];
for (const name of ['copy32','add7_wrap32','multiply_low64','wide_signed']) {
 const r = recoverSass(readExport(sm86,name,'sass'),readExport(sm86,name,'elf'));
 if(r.status!=='emitted'||!r.code)throw Error(name+':'+r.diagnostics);
 const input = name==='multiply_low64'?'uint64_t':'uint32_t';
 const output = name==='multiply_low64'||name==='wide_signed'?'uint64_t':'uint32_t';
 const expected = name==='copy32'?'a[i]':name==='add7_wrap32'?'static_cast<uint32_t>(a[i]+7U)':name==='multiply_low64'?'a[i]*b[i]':'static_cast<uint64_t>(s32(a[i])*s32(b[i]))';
 const harness = `
#include <stdio.h>
#include <stdlib.h>
#include <array>
static int64_t s32(uint32_t x) { return int64_t(x)-int64_t(x>>31)*4294967296LL; }
int main() {
 const std::array<uint64_t,14> edges = {0,1,2,3,0x7fffffffULL,0x80000000ULL,0xffffffffULL,0x100000000ULL,0x7fffffffffffffffULL,0x8000000000000000ULL,0xffffffffffffffffULL,0xffffffff00000001ULL,0x5555555555555555ULL,0xaaaaaaaaaaaaaaaaULL};
 std::array<${input},300> a{}, b{}; std::array<${output},300> out{};
 uint64_t state=0xd07f929b92341ULL; size_t comparisons=0;
 for(unsigned i=0;i<300;i++) { state^=state<<13;state^=state>>7;state^=state<<17; a[i]=${input}(i<edges.size()?edges[i]:state); b[i]=${input}(i<edges.size()?edges[edges.size()-1-i]:~state); }
 for(uint32_t n : {0U,1U,31U,32U,33U,257U}) for(uint32_t threads : {1U,17U,64U}) {
  out.fill(${output}(0xa5a5a5a5a5a5a5a5ULL)); blockDim={threads,1,1};
  const uint32_t blocks=(n+threads-1)/threads+1;
  for(uint32_t block=0;block<blocks;block++)for(uint32_t tid=0;tid<threads;tid++) {
   blockIdx={block,0,0};threadIdx={tid,0,0};
   rure_sass_kernel_0(uint64_t(reinterpret_cast<uintptr_t>(a.data())),uint64_t(reinterpret_cast<uintptr_t>(b.data())),uint64_t(reinterpret_cast<uintptr_t>(out.data())),n,0);
  }
  for(uint32_t i=0;i<300;i++) { const ${output} want=i<n?${output}(${expected}):${output}(0xa5a5a5a5a5a5a5a5ULL); if(out[i]!=want){fprintf(stderr,"${name} n=%u threads=%u i=%u got=%llx expected=%llx\\n",n,threads,i,(unsigned long long)out[i],(unsigned long long)want);return 1;} comparisons++; }
 }
 printf("${name}: %zu comparisons passed\\n",comparisons); return 0;
}
`;
 const cpuPath=join(outputDir,'cpu',name+'.cpp');writeFileSync(cpuPath,'#define __device__\n#define __global__\nstruct Dim { unsigned x,y,z; }; static Dim threadIdx,blockIdx,blockDim;\n'+r.code+harness);cpuSources.push({name,file:"cpu/"+name+".cpp",sha256:digest(readFileSync(cpuPath)),expectedComparisons:5400});
}
const report={schemaVersion:1,sourceSha256:SOURCE_SHA,moduleSha256:MODULE_SHA,scope:"development only; no confirmation or GPU execution",positive,negative,cpuSources};
writeFileSync(join(outputDir,"probe-results.json"),JSON.stringify(report,null,2)+"\n");
const passed=positive.every(x=>x.status==="emitted"&&x.sameCodeAsCpuTestedSm86)&&negative.every(x=>x.codeNull);console.log(JSON.stringify({status:passed?"pass":"fail",positives:positive.length,negatives:negative.length,cpuPrograms:cpuSources.length}));process.exitCode=passed?0:1;
