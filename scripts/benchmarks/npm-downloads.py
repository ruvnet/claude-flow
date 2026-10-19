#!/usr/bin/env python3
import subprocess,time,json,pathlib,tempfile,os,signal,hashlib,platform,argparse,tarfile,io,shutil
parser=argparse.ArgumentParser(description='Cold npm pack and dependency manifest installation benchmark; lifecycle scripts disabled.')
parser.add_argument('--output', required=True)
args=parser.parse_args()
ROOT=pathlib.Path(__file__).resolve().parents[2]
OUT=pathlib.Path(args.output).resolve();OUT.mkdir(exist_ok=False)
packages=[('ruflo','ruflo/package.json'),('@claude-flow/cli','v3/@claude-flow/cli/package.json'),('claude-flow','package.json')]
report={'schema':'ruflo-npm-download-benchmark/v1','startedAt':time.strftime('%Y-%m-%dT%H:%M:%SZ',time.gmtime()),'node':subprocess.check_output(['node','--version'],text=True).strip(),'npm':subprocess.check_output(['npm','--version'],text=True).strip(),'platform':platform.platform(),'commit':subprocess.check_output(['git','rev-parse','HEAD'],cwd=ROOT,text=True).strip(),'runs':[],'manifests':{}}
def save(): (OUT/'results.json').write_text(json.dumps(report,indent=2)+'\n')
def run(cmd,cwd,log,timeout=180):
 start=time.monotonic()
 with open(log,'w') as f:
  p=subprocess.Popen(cmd,cwd=cwd,stdout=f,stderr=subprocess.STDOUT,start_new_session=True)
  try: code=p.wait(timeout=timeout)
  except subprocess.TimeoutExpired: os.killpg(p.pid,signal.SIGKILL);p.wait();code=124
 return code,round(time.monotonic()-start,3)
def cache_stats(cache):
 objects={}
 for p in (cache/'_cacache/index-v5').rglob('*'):
  if not p.is_file():continue
  for line in p.read_text(errors='replace').splitlines():
   try:
    x=json.loads(line.split('\t',1)[1]);key=x.get('key','')
    if 'https://registry.npmjs.org/' in key and '.tgz' in key and x.get('integrity'):objects[x['integrity']]=x.get('size',0)
   except (ValueError,IndexError):pass
 return {'cachedTarballCount':len(objects),'cachedTarballBytes':sum(objects.values())}
def preserve_evidence_and_cleanup(dest):
 entries={}
 for p in (dest/'cache/_cacache/index-v5').rglob('*'):
  if not p.is_file():continue
  for line in p.read_text(errors='replace').splitlines():
   try:
    item=json.loads(line.split('\t',1)[1]);key=item.get('key','')
    if 'https://registry.npmjs.org/' in key and '.tgz' in key and item.get('integrity'):
     entries[item['integrity']]={k:item.get(k) for k in ['key','integrity','size']}
   except (ValueError,IndexError):pass
 (dest/'tarballs.json').write_text(json.dumps(list(entries.values()),indent=2))
 for temporary in [dest/'node_modules',dest/'cache']:shutil.rmtree(temporary,ignore_errors=True)
for name,relative in packages:
 slug=name.replace('@','').replace('/','_')
 manifest=json.loads(subprocess.check_output(['npm','view',name+'@3.57.0','--json'],text=True))
 candidate=json.loads((ROOT/relative).read_text())
 report['manifests'][name]={'published':manifest,'candidate':candidate}
 for attempt in range(1,4):
  dest=OUT/(slug+'-tarball-'+str(attempt));dest.mkdir(exist_ok=True);cache=dest/'cache'
  code,seconds=run(['npm','pack',name+'@3.57.0','--ignore-scripts','--json','--cache',str(cache)],dest,dest/'log.txt')
  result={'package':name,'version':'3.57.0','kind':'package-tarball','attempt':attempt,'exitCode':code,'seconds':seconds,'tarballBytes':sum(p.stat().st_size for p in dest.glob('*.tgz')),**cache_stats(cache)}
  report['runs'].append(result);save();print(json.dumps(result),flush=True);preserve_evidence_and_cleanup(dest)
 # Compare installable dependency manifests, excluding package's own tarball and all lifecycle scripts.
 for attempt in range(1,3):
  for label,m in ([('published',manifest),('candidate',candidate)] if attempt==1 else [('candidate',candidate),('published',manifest)]):
   dest=OUT/(slug+'-'+label+'-'+str(attempt));dest.mkdir(exist_ok=True);cache=dest/'cache'
   fields=['dependencies','optionalDependencies','peerDependencies','peerDependenciesMeta','overrides','engines']
   install={'name':'ruflo-download-measurement','version':'0.0.0','private':True,**{k:m[k] for k in fields if k in m}}
   (dest/'package.json').write_text(json.dumps(install,indent=2))
   code,seconds=run(['npm','install','--ignore-scripts','--no-audit','--no-fund','--package-lock','--cache',str(cache),'--loglevel','http'],dest,dest/'log.txt',180)
   lock=json.loads((dest/'package-lock.json').read_text()) if (dest/'package-lock.json').exists() else {}
   result={'package':name,'kind':'dependency-install','variant':label,'attempt':attempt,'exitCode':code,'seconds':seconds,'manifestSha256':hashlib.sha256((dest/'package.json').read_bytes()).hexdigest(),'lockPackageCount':max(0,len(lock.get('packages',{}))-1),**cache_stats(cache)}
   report['runs'].append(result);save();print(json.dumps(result),flush=True);preserve_evidence_and_cleanup(dest)
save()

report['consumerRuns']=[]
for name,_ in packages:
 dest=OUT/(name.replace('@','').replace('/','_')+'-consumer');dest.mkdir();cache=dest/'cache'
 (dest/'package.json').write_text(json.dumps({'name':'download-consumer','version':'0.0.0','private':True}))
 code,seconds=run(['npm','install',name+'@3.57.0','--ignore-scripts','--no-audit','--no-fund','--save-exact','--cache',str(cache),'--loglevel','http'],dest,dest/'log.txt',180)
 result={'package':name,'version':'3.57.0','kind':'published-consumer-install','exitCode':code,'seconds':seconds,**cache_stats(cache)}
 report['consumerRuns'].append(result);save();print(json.dumps(result),flush=True);preserve_evidence_and_cleanup(dest)


r=report;report['bundledRuns']=[];results=report['bundledRuns']
for name in ['@claude-flow/cli','claude-flow']:
 slug=name.replace('@','').replace('/','_');published=next((OUT/(slug+'-tarball-1')).glob('*.tgz'))
 for label in ['published','candidate']:
  dest=OUT/(slug+'-bundled-'+label);dest.mkdir();cache=dest/'cache';archive=dest/'fixture.tgz'
  with tarfile.open(published,'r:gz') as source,tarfile.open(archive,'w:gz') as target:
   for info in source:
    payload=source.extractfile(info).read() if info.isfile() else None
    if info.name=='package/package.json' and label=='candidate':
     manifest=json.loads(payload);candidate=r['manifests'][name]['candidate']
     for key in ['dependencies','optionalDependencies','peerDependencies','peerDependenciesMeta']:
      if key in candidate:manifest[key]=candidate[key]
      else:manifest.pop(key,None)
     payload=json.dumps(manifest,sort_keys=True).encode();info.size=len(payload)
    target.addfile(info,io.BytesIO(payload) if payload is not None else None)
  (dest/'package.json').write_text(json.dumps({'name':'download-consumer','version':'0.0.0','private':True}))
  code,seconds=run(['npm','install',str(archive),'--ignore-scripts','--no-audit','--no-fund','--cache',str(cache),'--loglevel','http'],dest,dest/'log.txt',180)
  result={'package':name,'variant':label,'kind':'bundled-dependency-comparison','exitCode':code,'seconds':seconds,'fixtureSha256':hashlib.sha256(archive.read_bytes()).hexdigest(),'baselineArchiveSha256':hashlib.sha256(published.read_bytes()).hexdigest(),**cache_stats(cache)}
  results.append(result);save();print(json.dumps(result),flush=True);preserve_evidence_and_cleanup(dest)
