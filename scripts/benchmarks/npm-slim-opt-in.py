#!/usr/bin/env python3
"""Compare identical published umbrella bytes with baseline/candidate declarations.
Lifecycle scripts disabled; payload counts unique registry tarballs, not wire bytes.
"""
import argparse,hashlib,io,json,os,pathlib,platform,signal,subprocess,tarfile,time
p=argparse.ArgumentParser();p.add_argument('--archive',required=True);p.add_argument('--baseline-manifest',required=True);p.add_argument('--output',required=True);a=p.parse_args()
root=pathlib.Path(__file__).resolve().parents[2];out=pathlib.Path(a.output).resolve();out.mkdir(exist_ok=False)
archive=pathlib.Path(a.archive).resolve();baseline=pathlib.Path(a.baseline_manifest).resolve()
def digest(b):return hashlib.sha256(b).hexdigest()
def run(cmd,cwd,log,timeout=240):
 start=time.monotonic()
 with log.open('w') as f:
  proc=subprocess.Popen(cmd,cwd=cwd,stdout=f,stderr=subprocess.STDOUT,start_new_session=True)
  try:code=proc.wait(timeout=timeout)
  except subprocess.TimeoutExpired:os.killpg(proc.pid,signal.SIGKILL);proc.wait();code=124
 return code,round(time.monotonic()-start,3)
def tarballs(cache):
 found={}
 for f in (cache/'_cacache/index-v5').rglob('*'):
  if not f.is_file():continue
  for line in f.read_text(errors='replace').splitlines():
   try:x=json.loads(line.split('\t',1)[1])
   except (ValueError,IndexError):continue
   if 'https://registry.npmjs.org/' in x.get('key','') and '.tgz' in x['key'] and x.get('integrity'):
    found[x['integrity']]={k:x.get(k) for k in ['key','integrity','size']}
 return sorted(found.values(),key=lambda x:x['key'])
r={'schema':'ruflo-slim-opt-in-benchmark/v1','startedAt':time.strftime('%Y-%m-%dT%H:%M:%SZ',time.gmtime()),'sourceBase':subprocess.check_output(['git','rev-parse','HEAD'],cwd=root,text=True).strip(),'node':subprocess.check_output(['node','--version'],text=True).strip(),'npm':subprocess.check_output(['npm','--version'],text=True).strip(),'platform':platform.platform(),'archiveSha256':digest(archive.read_bytes()),'baselineManifestSha256':digest(baseline.read_bytes()),'candidateManifestSha256':digest((root/'package.json').read_bytes()),'lifecycleScripts':False,'runs':[]}
for label,manifest in [('baseline',json.loads(baseline.read_text())),('candidate',json.loads((root/'package.json').read_text()))]:
 dest=out/label;dest.mkdir();fixture=dest/'fixture.tgz';unchanged=[]
 with tarfile.open(archive,'r:gz') as src,tarfile.open(fixture,'w:gz') as target:
  for info in src:
   data=src.extractfile(info).read() if info.isfile() else None
   if info.name=='package/package.json':
    m=json.loads(data)
    for key in ['dependencies','optionalDependencies','peerDependencies','peerDependenciesMeta']:
     if key in manifest:m[key]=manifest[key]
     else:m.pop(key,None)
    data=json.dumps(m,sort_keys=True).encode();info.size=len(data)
   elif data is not None:unchanged.append([info.name,digest(data)])
   target.addfile(info,io.BytesIO(data) if data is not None else None)
 with tarfile.open(fixture) as f:
  observed=[[i.name,digest(f.extractfile(i).read())] for i in f if i.isfile() and i.name!='package/package.json']
 assert unchanged==observed
 (dest/'package.json').write_text(json.dumps({'name':'slim-opt-in-consumer','version':'0.0.0','private':True}))
 code,seconds=run(['npm','install',str(fixture),'--ignore-scripts','--no-audit','--no-fund','--cache',str(dest/'cache'),'--loglevel','http'],dest,dest/'install.log')
 entries=tarballs(dest/'cache');(dest/'tarballs.json').write_text(json.dumps(entries,indent=2)+'\n')
 lockpath=dest/'package-lock.json';lock=json.loads(lockpath.read_text()) if lockpath.exists() else {}
 result={'variant':label,'exitCode':code,'seconds':seconds,'cachedTarballBytes':sum(x['size'] for x in entries),'tarballCount':len(entries),'fixtureSha256':digest(fixture.read_bytes()),'unchangedFiles':len(unchanged),'nonmanifestDigest':digest(json.dumps(unchanged).encode()),'lockSha256':digest(lockpath.read_bytes()) if lockpath.exists() else None,'slimPackages':[k for k in lock.get('packages',{}) if k.startswith('node_modules/@agntcy/')],'tarballs':entries}
 r['runs'].append(result);(out/'results.json').write_text(json.dumps(r,indent=2)+'\n');print(json.dumps({k:v for k,v in result.items() if k!='tarballs'}),flush=True)
 if code:raise SystemExit(code)
b,c=r['runs'];old={x['integrity']:x for x in b['tarballs']};new={x['integrity']:x for x in c['tarballs']}
r['comparison']={'savedBytes':b['cachedTarballBytes']-c['cachedTarballBytes'],'reductionPercent':100*(b['cachedTarballBytes']-c['cachedTarballBytes'])/b['cachedTarballBytes'],'removedTarballs':[x for k,x in old.items() if k not in new],'addedTarballs':[x for k,x in new.items() if k not in old],'timingAttribution':'One sequential observation per variant; CDN and metadata caches uncontrolled. No latency improvement claim.'}
(out/'results.json').write_text(json.dumps(r,indent=2)+'\n');print(json.dumps(r['comparison']),flush=True)
