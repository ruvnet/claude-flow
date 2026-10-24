#!/usr/bin/env python3
"""Four development programs only; cross-information-level evidence, never SOTA."""
import argparse, hashlib, json, pathlib, shutil, subprocess, sys, time
HERE=pathlib.Path(__file__).resolve().parent
CORPUS_SHA='f5e79f69211d5d57ab24fb3170278643e07282d9c4f9fe7359e099eeffe1b50c'
SOURCE_MANIFEST_SHA='0bf6cfe997e8cef489102a0b7aa9dedbff40db05b500e3f29fae01e3dbc3ac9d'
INPUT_MANIFEST_SHA='60a59e193d2c509b2e37046f45c94f55b3beca33bb0a944bd06c69288f9791fe'
IDS=['copy32','add7_wrap32','multiply_low64','wide_signed']
sha=lambda p:hashlib.sha256(p.read_bytes()).hexdigest()
def main():
    ap=argparse.ArgumentParser();ap.add_argument('--source',required=True,type=pathlib.Path);ap.add_argument('--inputs',required=True,type=pathlib.Path);ap.add_argument('--corpus',required=True,type=pathlib.Path);ap.add_argument('--output',required=True,type=pathlib.Path);a=ap.parse_args()
    source=a.source.resolve(strict=True); inputs=a.inputs.resolve(strict=True); corpus=a.corpus.resolve(strict=True); output=a.output.resolve()
    if sha(corpus)!=CORPUS_SHA:raise ValueError('frozen corpus changed')
    output.mkdir(parents=True,exist_ok=False)
    manifest_path=HERE/'upstream-files.json'
    if not manifest_path.is_file():manifest_path=HERE.parent/'bundle/upstream-files.json'
    if sha(manifest_path)!=SOURCE_MANIFEST_SHA:raise ValueError('pinned source manifest changed')
    manifest=json.loads(manifest_path.read_text())
    if sha(inputs/'manifest.json')!=INPUT_MANIFEST_SHA:raise ValueError('pinned input manifest changed')
    input_manifest=json.loads((inputs/'manifest.json').read_text())
    if input_manifest.get('architecture')!='sm_86':raise ValueError('expected sm_86 artifact manifest')
    bindings={}
    for item in input_manifest['artifacts']:
        if item['id'] not in IDS:continue
        if item['id'] in bindings:raise ValueError('duplicate input binding')
        for suffix in ['sass','elf']:
            if sha(inputs/(item['id']+'.'+suffix))!=item[suffix+'Sha256']:raise ValueError('input digest mismatch')
        bindings[item['id']]=item
    if set(bindings)!=set(IDS):raise ValueError('missing designated development inputs')
    snap=output/'source'
    for item in manifest['files']:
        relative=pathlib.PurePosixPath(item['path'])
        if relative.is_absolute() or '..' in relative.parts:raise ValueError('invalid source path')
        p=source.joinpath(*relative.parts)
        if p.is_symlink() or sha(p)!=item['sha256']:raise ValueError('source hash differs '+item['path'])
        target=snap.joinpath(*relative.parts);target.parent.mkdir(parents=True,exist_ok=True);shutil.copyfile(p,target)
    env={'PATH':'/usr/bin:/bin','HOME':str(output),'PYTHONHASHSEED':'0'}
    rows=[]
    def run(label,argv):
        start=time.perf_counter()
        try:r=subprocess.run(argv,cwd=output,env=env,text=True,capture_output=True,timeout=60);code=r.returncode;out=r.stdout;err=r.stderr
        except subprocess.TimeoutExpired as e:code=None;out='';err='timeout'
        (output/(label+'.stdout')).write_text(out);(output/(label+'.stderr')).write_text(err)
        row={'label':label,'argv':argv,'exitCode':code,'seconds':time.perf_counter()-start};rows.append(row);return code,out,err
    native_compiler='/usr/bin/g++'
    code,compiler_version,_=run('native-compiler-version',[native_compiler,'--version'])
    if code!=0:raise RuntimeError('native compiler version query failed; see logs')
    code,_,_=run('abi',[sys.executable,str(HERE/'inspect-crosspath-abi.py'),str(snap),str(inputs),str(output)])
    if code!=0:raise RuntimeError('ABI admission failed; see logs')
    node=shutil.which('node')
    if not node:raise RuntimeError('node unavailable')
    code,_,_=run('drivers',[node,str(HERE/'generate-crosspath.mjs'),str(corpus),str(output/'parameter-offsets.json'),str(output)])
    if code!=0:raise RuntimeError('independent driver generation failed')
    drivers=json.loads((output/'crosspath-drivers.json').read_text())
    for item in drivers['kernels']:
        if item['sourceSha256']!=bindings[item['id']]['originalPtxSha256']:
            raise ValueError('compiled input does not match frozen PTX')
    results=[]
    for name in IDS:
        stem=output/name
        stages=[('lift',[sys.executable,str(snap/'main.py'),'-i',str(inputs/(name+'.sass')),str(inputs/(name+'.elf')),'-o',str(stem),'-name',name,'--lifter','x86']),
                ('object',[sys.executable,str(HERE/'emit-object.py'),str(stem)+'.ll',str(stem)+'.o']),
                ('link',[native_compiler,'-std=c++20','-O2',str(output/(name+'-independent.cpp')),str(stem)+'.o','-o',str(stem)]),
                ('execute',[str(stem)])]
        result={'kernel':name,'state':'not_run','cases':None,'comparisons':None}
        for stage,argv in stages:
            code,out,err=run(name+'-'+stage,argv)
            if code!=0:
                result.update({'state':'inconclusive' if code is None else stage+'_failed','failedStage':stage,'exitCode':code})
                if stage=='lift' and 'UnsupportedInstructionException' in err:result['state']='unsupported_instruction'
                break
            if stage=='execute':
                try: observed=json.loads(out)
                except ValueError:result['state']='invalid_result';break
                if observed!={'status':'pass','kernel':name,'cases':7,'comparisons':195}:result['state']='invalid_result';break
                result.update({'state':'passed','cases':7,'comparisons':195})
        results.append(result)
    from llvmlite import binding as llvm
    receipt={'schemaVersion':1,'claim':'Cross-information-level capability evidence only: RuRE PTX input versus CuLifter SASS+ELF input. No SOTA claim.',
             'sourceCommit':manifest['commit'],'corpusSha256':CORPUS_SHA,'sourceManifestSha256':sha(manifest_path),
             'inputManifestSha256':sha(inputs/'manifest.json'),'inputBindings':bindings,
             'inputCompiler':{k:v for k,v in input_manifest.items() if k!='artifacts'},
             'abi':json.loads((output/'abi-inspection.json').read_text()),'drivers':json.loads((output/'crosspath-drivers.json').read_text()),
             'environment':{'python':sys.version.split()[0],'llvm':list(llvm.llvm_version_info),
                            'nativeCompiler':compiler_version.rstrip('\n'),'nativeCompilerPath':native_compiler,
                            'nativeCompilerVersionSha256':sha(output/'native-compiler-version.stdout')},
             'selectedDevelopmentKernels':IDS,'results':results,'caseCount':sum(r['cases'] or 0 for r in results),'comparisonCount':sum(r['comparisons'] or 0 for r in results),
             'gpuExecutedByThisProbe':False,'costUSD':None,'promotionVerdict':'INCONCLUSIVE','runs':rows,
             'evaluatorHashes':{p:sha(HERE/p) for p in ['run-crosspath.py','inspect-crosspath-abi.py','generate-crosspath.mjs','emit-object.py']},
             'artifactHashes':{p.name:sha(p) for p in output.iterdir() if p.is_file()}}
    (output/'crosspath-result.json').write_text(json.dumps(receipt,indent=2)+'\n')
    print(json.dumps({'results':results,'receipt':str(output/'crosspath-result.json')}))
    return 0 if all(result['state']=='passed' for result in results) else 1
if __name__=='__main__':sys.exit(main())
