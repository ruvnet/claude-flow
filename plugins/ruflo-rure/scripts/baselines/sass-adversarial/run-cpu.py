#!/usr/bin/env python3
"""Compile inspected replay sources with UBSan; retain JSON results, no binaries."""
import argparse, hashlib, json, os, signal, subprocess, tempfile
from pathlib import Path
p=argparse.ArgumentParser(description=__doc__)
p.add_argument('--input',type=Path,required=True)
p.add_argument('--output',type=Path,required=True)
p.add_argument('--compiler',default='g++')
a=p.parse_args()
assert not a.output.exists(),'preserve prior results'
raw=(a.input/'probe-results.json').read_bytes();m=json.loads(raw)
assert m['sourceSha256']=='99bd0ec252ef57bdd3985212f683c7ba22151ad6961f26a5de1c669c07c7b4b0'
assert m['moduleSha256']=='d85b93f70711d17c5c44f97a93d4a04ac08549cc253c70c88ab84294757287c3'
assert [r['name']for r in m['cpuSources']]==['copy32','add7_wrap32','multiply_low64','wide_signed']
def run(argv,timeout):
    child=subprocess.Popen(argv,stdout=subprocess.PIPE,stderr=subprocess.PIPE,start_new_session=True,
        env={'PATH':os.environ.get('PATH','/usr/bin:/bin'),'LANG':'C','LC_ALL':'C','UBSAN_OPTIONS':'halt_on_error=1'})
    try:
        out,err=child.communicate(timeout=timeout)
        return {'exitCode':child.returncode,'stdout':out.decode(),'stderr':err.decode()}
    finally:
        try:os.killpg(child.pid,signal.SIGKILL)
        except ProcessLookupError:pass
        child.wait()
r={'schemaVersion':1,'scope':'CPU shim only; no GPU or confirmation evidence','sourceSha256':m['sourceSha256'],
   'moduleSha256':m['moduleSha256'],'probeManifestSha256':hashlib.sha256(raw).hexdigest(),
   'compiler':run([a.compiler,'--version'],10),'flags':['-std=c++17','-O2','-fsanitize=undefined','-fno-sanitize-recover=all'],'cases':[]}
with tempfile.TemporaryDirectory(prefix='sass-cpu-replay-')as temporary:
    for row in m['cpuSources']:
        assert row['file']=='cpu/'+row['name']+'.cpp'
        source=a.input/row['file'];assert hashlib.sha256(source.read_bytes()).hexdigest()==row['sha256']
        binary=str(Path(temporary)/row['name'])
        compiled=run([a.compiler,*r['flags'],str(source),'-o',binary],30)
        executed=run([binary],10)if compiled['exitCode']==0 else None
        r['cases'].append({'name':row['name'],'sourceSha256':row['sha256'],'compile':compiled,'execute':executed,'comparisons':5400})
        assert compiled['exitCode']==0 and executed['exitCode']==0,(row['name'],compiled,executed)
        assert executed['stdout']==row['name']+': 5400 comparisons passed\n'
r['status']='pass';r['comparisons']=sum(x['comparisons']for x in r['cases'])
a.output.parent.mkdir(parents=True,exist_ok=True)
with a.output.open('x')as stream:json.dump(r,stream,indent=2);stream.write('\n')
print(json.dumps({'status':r['status'],'programs':len(r['cases']),'comparisons':r['comparisons']}))
