#!/usr/bin/env node
// Independent evaluator. This process owns oracles; the separate translator
// receives only SASS + ELF, never this script, these vectors, or CUDA source.
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, mkdirSync, copyFileSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';

const HERE = dirname(fileURLToPath(import.meta.url));
const PLAN_SHA = '2274fd56eb38d830c195e4be9d454731c1be2527c04d2d67d56bd377140fb1f3';
const CORPUS_SHA = 'f5e79f69211d5d57ab24fb3170278643e07282d9c4f9fe7359e099eeffe1b50c';
const DEVELOPMENT_SHA = '60a59e193d2c509b2e37046f45c94f55b3beca33bb0a944bd06c69288f9791fe';
const DEV_IDS = ['copy32', 'add7_wrap32', 'multiply_low64', 'wide_signed'];
const hash = b => createHash('sha256').update(b).digest('hex');
const read = p => readFileSync(p);
const sha = p => hash(read(p));
const json = p => JSON.parse(read(p));
const write = (p, value) => writeFileSync(p, JSON.stringify(value, null, 2) + '\n');
const check = (x, message) => { if (!x) throw Error(message); };
const safe = s => typeof s === 'string' && /^[A-Za-z_][A-Za-z0-9_]{0,99}$/.test(s);

export async function oracleSet(split) {
  if (split === 'development') {
    const file = join(HERE, 'fixtures/ptx-recovery/corpus.mjs');
    check(sha(file) === CORPUS_SHA, 'development oracle source changed');
    const corpus = await import(pathToFileURL(file));
    return { sourceSha256: CORPUS_SHA, scope: 'four previously exposed development regressions',
      kernels: DEV_IDS.map(id => {
        const k = corpus.kernels.find(k => k.id === id);
        return { id, inputBits: k.bits, outputBits: k.outBits, cases: corpus.sizes.map(count => {
          const v = corpus.vectors(k, count);
          return { count, scalar: '0', input: v.input.map(String), aux: v.aux.map(String), expected: v.expected.map(String), sentinel: String(v.sentinel) };
        }) };
      }) };
  }
  check(split === 'confirmation', 'split must be development or confirmation');
  const root = join(HERE, 'fixtures/sass-recovery');
  check(sha(join(root, 'confirmation-plan.json')) === PLAN_SHA, 'confirmation plan changed');
  const plan = json(join(root, 'confirmation-plan.json'));
  return { sourceSha256: PLAN_SHA, scope: 'six frozen new synthetic confirmation kernels; not SOTA coverage',
    kernels: plan.kernels.map(k => {
      check(sha(join(root, `${k.id}.cu`)) === k.sourceSha256, 'confirmation source changed');
      const oracle = json(join(root, `${k.id}.oracle.json`));
      check(oracle.id === k.id && oracle.inputBits === k.inputBits && oracle.outputBits === k.outputBits && oracle.cases.length === k.cases.length, 'oracle shape mismatch');
      oracle.cases.forEach((v, i) => check(v.count === k.cases[i].count && hash(JSON.stringify(v)) === k.cases[i].oracleSha256, 'confirmation oracle changed'));
      return oracle;
    }) };
}

function newDirectory(path) { check(!existsSync(path), 'refusing to overwrite evidence directory'); mkdirSync(path, { recursive: true }); }

export function prepareDevelopment(output) {
  const source = join(HERE, 'baselines/culifter/crosspath-inputs');
  check(sha(join(source, 'manifest.json')) === DEVELOPMENT_SHA, 'development native manifest changed');
  const originals = json(join(source, 'manifest.json'));
  newDirectory(output);
  const manifest = { schemaVersion: 1, architecture: 'sm_86', kernels: [] };
  for (const id of DEV_IDS) {
    const k = originals.artifacts.find(k => k.id === id);
    const directory = join(output, id); mkdirSync(directory);
    for (const type of ['sass', 'elf']) {
      const file = join(source, `${id}.${type}`);
      check(sha(file) === k[`${type}Sha256`], 'development input digest mismatch');
      copyFileSync(file, join(directory, `original.${type}`));
    }
    manifest.kernels.push({ id, sassSha256: k.sassSha256, elfSha256: k.elfSha256 });
  }
  write(join(output, 'translation-input.json'), manifest);
  return { manifestSha256: sha(join(output, 'translation-input.json')), kernels: 4 };
}

function verifyNative(root, input, split) {
  const manifest = json(join(root, 'native-manifest.json'));
  check(manifest.status === 'prepared-not-evaluated' && ['sm_86', 'sm_89'].includes(manifest.architecture), 'native preparation incomplete');
  if (split === 'confirmation') check(manifest.planSha256 === PLAN_SHA && Number.isFinite(manifest.nativeArtifactsFrozenAt), 'native confirmation freeze missing');
  check(manifest.kernels.length === input.kernels.length, 'native coverage mismatch');
  for (const k of input.kernels) {
    const native = manifest.kernels.find(n => n.id === k.id);
    check(native && native.sassSha256 === k.sassSha256 && native.elfSha256 === k.elfSha256, 'native inputs differ');
    for (const [type, field] of [['sass','sassSha256'], ['elf','elfSha256'], ['cubin','cubinSha256']]) check(sha(join(root, k.id, `original.${type}`)) === native[field], 'native byte digest mismatch');
    check(read(join(root, k.id, 'original.cubin')).subarray(0, 4).equals(Buffer.from([127,69,76,70])), 'original artifact is not ELF cubin');
  }
  return manifest;
}

function translations(root, inputRoot, oracles, nativeRoot, split) {
  const receipt = json(join(root, 'translation-result.json'));
  const input = json(join(inputRoot, 'translation-input.json'));
  check(receipt.status === 'translated' && receipt.inputManifestSha256 === sha(join(inputRoot, 'translation-input.json')), 'translation receipt mismatch');
  check(receipt.kernels.length === oracles.kernels.length && input.kernels.length === oracles.kernels.length, 'translation coverage mismatch');
  check(new Set(receipt.kernels.map(k => k.id)).size === receipt.kernels.length && new Set(input.kernels.map(k => k.id)).size === input.kernels.length, 'duplicate kernel IDs');
  const native = nativeRoot ? verifyNative(nativeRoot, input, split) : null;
  if (split === 'confirmation') {
    check(native, 'confirmation requires exact frozen native artifacts');
    check(Date.parse(receipt.startedAt) / 1000 >= native.nativeArtifactsFrozenAt, 'candidate invoked before native freeze');
  }
  const results = oracles.kernels.map(oracle => {
    const entry = receipt.kernels.find(k => k.id === oracle.id), src = input.kernels.find(k => k.id === oracle.id);
    check(entry && src && entry.sourceSha256 === src.sassSha256 && entry.elfSha256 === src.elfSha256, 'translation source binding mismatch');
    for (const type of ['sass', 'elf']) check(sha(join(inputRoot, oracle.id, `original.${type}`)) === src[`${type}Sha256`], 'translation input changed');
    const file = join(root, oracle.id, 'recovery.json');
    check(sha(file) === entry.recoverySha256, 'recovery JSON changed');
    const result = json(file);
    check(result.status === entry.status && result.proofStatus === 'not-proven' && result.sourceSha256 === src.sassSha256 && result.elfSha256 === src.elfSha256, 'recovery contract mismatch');
    if (result.status === 'emitted') {
      check(result.functions?.length === 1 && result.functions[0].name === oracle.id && safe(result.functions[0].emittedName), 'symbol mismatch');
      check(result.functions[0].parameters?.length === 5 && result.functions[0].parameters.every((p,i) => p.ordinal === i && p.size === [8,8,8,4,8][i] && p.type === (i===3?'uint32_t':'uint64_t')), 'ABI mismatch');
      check(hash(result.code) === entry.codeSha256 && sha(join(root, oracle.id, 'recovered.cu')) === entry.codeSha256, 'emitted source changed');
      check(!/\b(?:asm|__asm__)\s*\(/.test(result.code), 'assembly passthrough');
    } else check(['unsupported', 'invalid'].includes(result.status) && result.code === null, 'refusal contract mismatch');
    return { oracle, entry, result };
  });
  return { receipt, input, native, results };
}

export function cppDriver(oracle, result, corrupt = false) {
  const lit = values => values.map(v => { check(/^\d+$/.test(v), 'nondecimal oracle literal'); return `${v}ULL`; }).join(',');
  const name = result.functions[0].emittedName;
  check(safe(name), 'unsafe emitted name');
  let source = `#include <stdint.h>\n#include <cstdio>\n#include <cstring>\n#define __global__\n#define __device__\n#define __host__\n#define __forceinline__ inline\nstruct dim3 {uint32_t x=0,y=0,z=0;};\nstatic dim3 threadIdx,blockIdx,blockDim,gridDim;\n${result.code}\nint main(){uint64_t comparisons=0;\n`;
  for (const v of oracle.cases) {
    check(Number.isInteger(v.count) && v.count >= 0 && v.count <= 4096, 'invalid case count');
    source += `{uint${oracle.inputBits}_t x[]={${lit(v.input)}},y[]={${lit(v.aux)}}; uint${oracle.outputBits}_t z[${v.expected.length}],expected[]={${lit(v.expected)}};\nfor(auto &v:z)v=${v.sentinel}ULL; blockDim={8,1,1};gridDim={${Math.ceil(v.count/8)+1},1,1};\nfor(uint32_t b=0;b<gridDim.x;b++){blockIdx={b,0,0};for(uint32_t t=0;t<8;t++){threadIdx={t,0,0};${name}(uint64_t(uintptr_t(x)),uint64_t(uintptr_t(y)),uint64_t(uintptr_t(z)),uint32_t(${v.count}),uint64_t(${v.scalar}ULL));}}\n`;
    if (corrupt && v.count > 0) source += 'z[0]^=1; // intentional output-corruption negative control\n';
    source += `for(unsigned i=0;i<${v.expected.length};i++){comparisons++;if(z[i]!=expected[i]){std::printf("mismatch kernel=${oracle.id} count=${v.count} i=%u expected=%llu actual=%llu\\n",i,(unsigned long long)expected[i],(unsigned long long)z[i]);return 1;}}\n`;
    source += `uint${oracle.inputBits}_t originalX[]={${lit(v.input)}},originalY[]={${lit(v.aux)}}; if(memcmp(x,originalX,sizeof(x))||memcmp(y,originalY,sizeof(y))){std::puts("input modified");return 1;}}\n`;
  }
  return source + `std::printf("{\\\"status\\\":\\\"pass\\\",\\\"comparisons\\\":%llu}\\n",(unsigned long long)comparisons);return 0;}\n`.replaceAll('\\\\\\"','\\"');
}

function run(argv, timeout = 30000) {
  const started = performance.now();
  const result = spawnSync(argv[0], argv.slice(1), { encoding: 'utf8', timeout, maxBuffer: 1024 * 1024, env: { PATH: process.env.PATH, LANG: 'C', LC_ALL: 'C', UBSAN_OPTIONS: 'halt_on_error=1:print_stacktrace=1' } });
  return { argv, exitCode: result.status, signal: result.signal, error: result.error?.message ?? null, stdout: result.stdout, stderr: result.stderr, elapsedMs: performance.now() - started };
}

// Development-only semantic mutation: the sole constant seven in the emitted
// add-seven kernel becomes eight. This changes compiled code, not its oracle.
export function arithmeticMutation(code) {
  check((code.match(/0x7ULL/g) ?? []).length === 1, 'development mutation anchor changed');
  return code.replace('0x7ULL','0x8ULL');
}

export async function evaluateCpu(args) {
  const oracles = await oracleSet(args.split);
  const verified = translations(args.translations, args.inputs, oracles, args.native, args.split);
  newDirectory(args.output);
  const receipt = { schemaVersion: 1, startedAt: new Date().toISOString(), status: 'incomplete', split: args.split,
    scope: oracles.scope, evaluatorSha256: sha(fileURLToPath(import.meta.url)), oracleSha256: oracles.sourceSha256,
    translationReceiptSha256: sha(join(args.translations,'translation-result.json')), moduleSha256: verified.receipt.moduleSha256,
    nativeManifestSha256: args.native ? sha(join(args.native,'native-manifest.json')) : null,
    compiler: run(['g++','--version']), cases: 0, elementComparisons: 0, kernels: [], proofStatus: 'not-proven', sotaClaim: false };
  try {
    for (const { oracle, result, entry } of verified.results) {
      const row = { id: oracle.id, status: result.status, recoverySha256: entry.recoverySha256, codeSha256: entry.codeSha256 };
      receipt.kernels.push(row);
      if (result.status !== 'emitted') continue;
      const directory = join(args.output, oracle.id); mkdirSync(directory);
      for (const mutation of [false, true]) {
        const source = join(directory, mutation ? 'negative.cpp' : 'independent.cpp'), binary = source.slice(0,-4);
        writeFileSync(source, cppDriver(oracle, result, mutation));
        const compile = run(['g++','-std=c++17','-O2','-fsanitize=undefined','-fno-sanitize-recover=all',source,'-o',binary]);
        const execute = compile.exitCode === 0 ? run([binary],5000) : null;
        const evidence = { sourceSha256: sha(source), compile, execute };
        if (mutation) {
          row.negativeControl = evidence;
          check(execute?.exitCode === 1 && execute.stdout.includes('mismatch'), 'negative output corruption was not detected');
        } else {
          row.execution = evidence;
          check(execute?.exitCode === 0, `independent CPU comparison failed: ${oracle.id}`);
          const measured = JSON.parse(execute.stdout.trim());
          const comparisons = oracle.cases.reduce((sum,v) => sum+v.expected.length,0);
          check(measured.status === 'pass' && measured.comparisons === comparisons, 'incorrect CPU comparison count');
          receipt.cases += oracle.cases.length; receipt.elementComparisons += comparisons; row.status = 'pass';
        }
      }
      if(oracle.id==='add7_wrap32'){
        const mutated={...result,code:arithmeticMutation(result.code)};
        const source=join(directory,'semantic-mutation.cpp'),binary=source.slice(0,-4);
        writeFileSync(source,cppDriver(oracle,mutated));
        const compile=run(['g++','-std=c++17','-O2','-fsanitize=undefined','-fno-sanitize-recover=all',source,'-o',binary]);
        const execute=compile.exitCode===0?run([binary],5000):null;
        row.semanticMutation={kind:'compiled emitted arithmetic constant 7 to 8',codeSha256:hash(mutated.code),sourceSha256:sha(source),compile,execute};
        check(execute?.exitCode===1 && execute.stdout.includes('mismatch'),'compiled arithmetic mutation was not rejected');
      }
    }
    receipt.status = receipt.kernels.every(k=>k.status==='pass') ? 'pass' : 'coverage-incomplete';
  } catch (error) { receipt.status='failed'; receipt.error=error.message; }
  receipt.completedAt=new Date().toISOString();
  receipt.coverage={total:oracles.kernels.length,correct:receipt.kernels.filter(k=>k.status==='pass').length,unsupported:receipt.kernels.filter(k=>k.status==='unsupported').length,invalid:receipt.kernels.filter(k=>k.status==='invalid').length};
  write(join(args.output,'cpu-receipt.json'),receipt);
  return receipt;
}

function bytes(values,bits) { const out=Buffer.alloc(values.length*(bits/8)); values.forEach((v,i)=>bits===32?out.writeUInt32LE(Number(BigInt(v)),i*4):out.writeBigUInt64LE(BigInt(v),i*8)); return out; }

export async function packageGpu(args) {
  const oracles=await oracleSet(args.split), verified=translations(args.translations,args.inputs,oracles,args.native,args.split);
  check(args.native,'native byte artifacts required');
  const cpu=json(join(args.cpu,'cpu-receipt.json'));
  const allowSubset=args['allow-subset']==='true';
  check((cpu.status==='pass' || (allowSubset && cpu.status==='coverage-incomplete')) && cpu.translationReceiptSha256===sha(join(args.translations,'translation-result.json')) && cpu.oracleSha256===oracles.sourceSha256,'matching CPU evidence without failures required');
  const admitted=verified.results.filter(k=>k.result.status==='emitted');
  check(admitted.length>0 && (allowSubset || admitted.length===verified.results.length),'complete emitted coverage required unless explicit --allow-subset true');
  for(const {oracle,entry} of admitted){
    const row=cpu.kernels.find(k=>k.id===oracle.id);
    check(row?.status==='pass' && row.codeSha256===entry.codeSha256 && row.recoverySha256===entry.recoverySha256 && row.execution?.compile?.exitCode===0 && row.execution?.execute?.exitCode===0 && row.negativeControl?.compile?.exitCode===0 && row.negativeControl?.execute?.exitCode===1 && row.negativeControl?.execute?.stdout?.includes('mismatch'),'admitted kernel requires independent CPU and negative-control pass');
  }
  newDirectory(args.output);
  const manifest={schemaVersion:1,split:args.split,scope:oracles.scope,oracleSha256:oracles.sourceSha256,translationReceiptSha256:sha(join(args.translations,'translation-result.json')),nativeManifestSha256:sha(join(args.native,'native-manifest.json')),cpuReceiptSha256:sha(join(args.cpu,'cpu-receipt.json')),moduleSha256:verified.receipt.moduleSha256,architecture:verified.native.architecture,execution:'exact ELF original.cubin and newly compiled recovered.cubin; no PTX JIT input',timing:{warmups:10,samples:100,pairedOrder:'alternating',minimumGeometricMedianSpeedup:1.10,maximumPerKernelRegression:0.02},kernels:[]};
  manifest.coverage={status:admitted.length===verified.results.length?'complete':'partial-incomplete',frozenKernelCount:oracles.kernels.length,admittedKernelCount:admitted.length,frozenCaseCount:oracles.kernels.reduce((s,k)=>s+k.cases.length,0),excluded:verified.results.filter(k=>k.result.status!=='emitted').map(k=>({id:k.oracle.id,status:k.result.status,recoverySha256:k.entry.recoverySha256})),promotionEligible:false,sotaClaim:false};
  for(const {oracle,result,entry} of admitted){
    const dir=join(args.output,oracle.id);mkdirSync(dir);
    copyFileSync(join(args.native,oracle.id,'original.cubin'),join(dir,'original.cubin'));
    check(sha(join(dir,'original.cubin'))===verified.native.kernels.find(k=>k.id===oracle.id).cubinSha256,'copied original cubin differs from frozen native artifact');
    writeFileSync(join(dir,'recovered.cu'),result.code);
    if(oracle.id==='add7_wrap32'){
      const evidence=cpu.kernels.find(k=>k.id===oracle.id)?.semanticMutation;
      const mutant=arithmeticMutation(result.code);
      check(evidence?.codeSha256===hash(mutant) && evidence.execute?.exitCode===1,'CPU arithmetic mutation evidence missing');
      writeFileSync(join(dir,'mutated.cu'),mutant);
      manifest.semanticMutation={id:oracle.id,kind:'compiled emitted arithmetic constant 7 to 8',cudaSha256:hash(mutant),expectedExitCode:1};
    }
    const files={};
    let cases=`${oracle.id} ${result.functions[0].emittedName} ${oracle.inputBits} ${oracle.outputBits}\n`;
    for(const v of oracle.cases){
      cases+=`${v.count} ${v.scalar} ${v.input.length} ${v.expected.length} ${v.count===oracle.cases.at(-1).count?1:0}\n`;
      for(const kind of ['input','aux','expected']){const file=`n${v.count}.${kind}.bin`;writeFileSync(join(dir,file),bytes(v[kind],kind==='expected'?oracle.outputBits:oracle.inputBits));files[file]=sha(join(dir,file));}
    }
    writeFileSync(join(dir,'case.txt'),cases);
    manifest.kernels.push({id:oracle.id,originalCubinSha256:sha(join(dir,'original.cubin')),recoveredCudaSha256:entry.codeSha256,caseSha256:hash(cases),files});
  }
  writeFileSync(join(args.output,'kernels.txt'),admitted.map(k=>k.oracle.id).join('\n')+'\n');
  copyFileSync(join(HERE,'sass-recovery-gpu.cu'),join(args.output,'sass-recovery-gpu.cu'));
  manifest.driverSha256=sha(join(args.output,'sass-recovery-gpu.cu'));
  manifest.expected={kernels:admitted.length,cases:admitted.reduce((s,k)=>s+k.oracle.cases.length,0),elementComparisonsBothVariants:2*admitted.reduce((s,k)=>s+k.oracle.cases.reduce((n,v)=>n+v.expected.length,0),0)};
  write(join(args.output,'gpu-manifest.json'),manifest);return manifest;
}

if(process.argv[1] && resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const args={};for(let i=2;i<process.argv.length;i+=2)args[process.argv[i].replace(/^--/,'')]=process.argv[i+1];
  try{let result;if(args.mode==='prepare-development')result=prepareDevelopment(resolve(args.output));else if(args.mode==='cpu')result=await evaluateCpu(args);else if(args.mode==='package-gpu')result=await packageGpu(args);else throw Error('use --mode prepare-development|cpu|package-gpu with required paths');console.log(JSON.stringify(result));if(['failed','coverage-incomplete'].includes(result.status))process.exitCode=1;}catch(error){console.error(error.message);process.exitCode=1;}
}
