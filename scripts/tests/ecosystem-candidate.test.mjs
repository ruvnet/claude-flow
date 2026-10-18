import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, rm, symlink, chmod, stat, utimes } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { listCandidateProposals, prepareCandidate, evaluateCandidate, releaseCandidate } from '../lib/ecosystem-candidate.mjs';

function git(root, ...args) { return execFileSync('git', ['-C', root, ...args], { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }).trim(); }
async function fixture(t, source = "test('actual regression',()=>assert.equal(fs.readFileSync('value.txt','utf8'),'2'));", initial = '1') {
  const parent = await mkdtemp(join(tmpdir(), 'candidate-contract-')), repoRoot = join(parent, 'repo');
  t.after(() => rm(parent, { recursive: true, force: true }));
  await mkdir(join(repoRoot, 'scripts/tests'), { recursive: true });
  await mkdir(join(repoRoot, 'scripts/lib'));
  await writeFile(join(repoRoot, 'scripts/lib/fixture.mjs'), '// tracked harness fixture');
  await writeFile(join(repoRoot, 'scripts/ecosystem-rsi.mjs'), '// fixture');
  await writeFile(join(repoRoot, 'scripts/tests/check.test.mjs'), "import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';" + source);
  await writeFile(join(repoRoot, 'value.txt'), initial);
  await writeFile(join(repoRoot, '.gitignore'), 'ignored.txt\n');
  await writeFile(join(repoRoot, 'registry.json'), JSON.stringify({schema:'ruflo-capabilities/v1',capabilities:[{id:'a',kind:'contract',packages:['a'],checks:['check']}],checks:[{id:'check',packages:['a'],testFiles:['scripts/tests/check.test.mjs'],sourceFiles:['value.txt']}]}));
  await writeFile(join(repoRoot, 'graph.json'), JSON.stringify({nodes:[{name:'a',version:'1.0.0',status:'captured'}],edges:[]}));
  git(repoRoot, 'init', '-q'); git(repoRoot, 'config', 'user.name', 'Fixture'); git(repoRoot, 'config', 'user.email', 'fixture@example.invalid');
  git(repoRoot, 'add', '.'); git(repoRoot, 'commit', '-qm', 'fixed baseline');
  const inputs = { registryPath:'registry.json', graphPath:'graph.json' };
  const proposals = await listCandidateProposals({repoRoot,inputs});
  return {repoRoot,destinationRoot:parent,expectedHead:git(repoRoot,'rev-parse','HEAD'),inputs,proposal:proposals.proposals[0].id,allowedPaths:['value.txt']};
}
async function candidate(t, source, initial) { const options=await fixture(t,source,initial); return {...options,...await prepareCandidate(options)}; }

test('real isolated candidate fixes failing baseline check and exact reverse patch restores base tree', async t => {
  const c=await candidate(t); await writeFile(join(c.worktree,'value.txt'),'2');
  const r=await evaluateCandidate(c);
  assert.equal(r.baseline.checksPassed,false); assert.equal(r.candidate.checksPassed,true);
  assert.equal(r.status,'checks-passed-review-required'); assert.equal(r.promotionAllowed,false); assert.equal(r.improvementEstablished,false);
  assert.equal(r.rollback.tree,r.baselineTree); assert.equal(r.rollback.exactBaselineRestored,true);
  assert.equal(await readFile(join(c.repoRoot,'value.txt'),'utf8'),'1');
  assert.equal(git(c.repoRoot,'status','--porcelain'),''); assert.match(await readFile(join(c.bundle,'PR.md'),'utf8'),/No measured improvement/);
  await assert.rejects(evaluateCandidate(c),/already evaluated/);
  await releaseCandidate(c); assert.equal(await readFile(join(c.worktree,'value.txt'),'utf8'),'2');
});
test('rejects stale base, dirty source, unknown proposal, unsafe/control paths and no-op candidates', async t => {
  const o=await fixture(t);
  await assert.rejects(prepareCandidate({...o,expectedHead:'0'.repeat(40)}),/HEAD mismatch/);
  await assert.rejects(prepareCandidate({...o,proposal:'0'.repeat(64)}),/Unknown current proposal/);
  for(const path of ['../escape','scripts/tests/check.test.mjs','registry.json','AGENTS.md']) await assert.rejects(prepareCandidate({...o,allowedPaths:[path]}),/Unsafe|Protected/);
  await assert.rejects(prepareCandidate({...o,allowedPaths:[]}),/exact allowed files/);
  await writeFile(join(o.repoRoot,'value.txt'),'dirty'); await assert.rejects(prepareCandidate(o),/Clean baseline/);
  await writeFile(join(o.repoRoot,'value.txt'),'1'); const c={...o,...await prepareCandidate(o)};
  await assert.rejects(evaluateCandidate(c),/No candidate changes/); await releaseCandidate(c);
});
test('atomic lease blocks duplicate writers and fences a replaced owner', async t => {
  const o=await fixture(t), c={...o,...await prepareCandidate(o)};
  await assert.rejects(prepareCandidate(o),/EEXIST/);
  await releaseCandidate(c); const replacement={...o,...await prepareCandidate(o)};
  await assert.rejects(releaseCandidate(c),/identity mismatch/);
  await assert.rejects(evaluateCandidate(c),/identity mismatch/);
  await releaseCandidate(replacement);
});
test('expired lease cannot evaluate or be silently stolen; owner can explicitly release', async t => {
  const o=await fixture(t), c={...o,...await prepareCandidate({...o,leaseMs:1000})};
  await new Promise(resolve=>setTimeout(resolve,1100));
  await assert.rejects(evaluateCandidate(c),/expired/); await assert.rejects(prepareCandidate(o),/EEXIST/);
  await releaseCandidate(c);
});
test('rejects out-of-scope files, test changes, symbolic links and ignored executable inputs', async t => {
  const c=await candidate(t); await writeFile(join(c.worktree,'value.txt'),'2');
  const outsider=join(c.worktree,'outside.txt'); await writeFile(outsider,'no');
  await assert.rejects(evaluateCandidate(c),/Out-of-scope/); await rm(outsider);
  const check=join(c.worktree,'scripts/tests/check.test.mjs'), original=await readFile(check);
  await writeFile(check,'// weakened'); await assert.rejects(evaluateCandidate(c),/Out-of-scope/); await writeFile(check,original);
  await rm(join(c.worktree,'value.txt')); await symlink(join(c.repoRoot,'value.txt'),join(c.worktree,'value.txt'));
  await assert.rejects(evaluateCandidate(c),/symbolic links/); await rm(join(c.worktree,'value.txt')); await writeFile(join(c.worktree,'value.txt'),'2');
  await writeFile(join(c.worktree,'ignored.txt'),'no'); await assert.rejects(evaluateCandidate(c),/ignored files/);
  await rm(join(c.worktree,'ignored.txt')); await releaseCandidate(c);
});
test('forged state, source movement and candidate commits invalidate evaluation', async t => {
  const c=await candidate(t), path=join(c.bundle,'candidate.json'), bytes=await readFile(path);
  const spec=JSON.parse(bytes); spec.allowedPaths.push('outside.txt'); await writeFile(path,JSON.stringify(spec));
  await assert.rejects(evaluateCandidate(c),/identity mismatch/); await writeFile(path,bytes);
  await writeFile(join(c.repoRoot,'value.txt'),'dirty'); await assert.rejects(evaluateCandidate(c),/Baseline changed/); await writeFile(join(c.repoRoot,'value.txt'),'1');
  await writeFile(join(c.worktree,'value.txt'),'2'); git(c.worktree,'add','value.txt'); git(c.worktree,'commit','-qm','not permitted before evaluation');
  await assert.rejects(evaluateCandidate(c),/worktree identity changed/);
});
test('detects candidate changes outside source binding during execution', async t => {
  const c=await candidate(t,"test('writes unbound file',()=>{if(process.cwd().endsWith('/worktree'))fs.writeFileSync('extra.txt','changed');});");
  await writeFile(join(c.worktree,'value.txt'),'2'); await assert.rejects(evaluateCandidate(c),/Out-of-scope/);
  await releaseCandidate(c);
});
for(const [name,body] of [['failed',"test('fails',()=>assert.fail('no'));"],['skipped',"test.skip('skip',()=>{});"],['timed out',"test('hangs',async()=>{await new Promise(()=>{});});setInterval(()=>{},1000);"]]) {
  test(`${name} checks never become successful review evidence`,async t=>{
    const c=await candidate(t,body); await writeFile(join(c.worktree,'value.txt'),'2');
    const r=await evaluateCandidate({...c,maxDurationMs:name==='timed out'?1000:5000});
    assert.equal(r.status,'checks-failed'); assert.equal(r.candidate.checksPassed,false); assert.equal(r.promotionAllowed,false);
    await releaseCandidate(c);
  });
}
test('test subprocess does not inherit unrelated credential environment', async t => {
  const c=await candidate(t,"test('no unrelated credentials',()=>assert.equal(process.env.RUFLO_TEST_DUMMY_SECRET,undefined));");
  await writeFile(join(c.worktree,'value.txt'),'2'); process.env.RUFLO_TEST_DUMMY_SECRET='fixture-not-a-secret';
  try { assert.equal((await evaluateCandidate(c)).status,'checks-passed-review-required'); } finally { delete process.env.RUFLO_TEST_DUMMY_SECRET; }
  await releaseCandidate(c);
});
for (const flag of ['--assume-unchanged', '--skip-worktree']) {
  test(`hidden protected test with ${flag} is rejected before execution`, async t => {
    const c=await candidate(t); await writeFile(join(c.worktree,'value.txt'),'2');
    git(c.worktree,'update-index',flag,'scripts/tests/check.test.mjs');
    await writeFile(join(c.worktree,'scripts/tests/check.test.mjs'),"import test from 'node:test';test('weakened',()=>{});");
    await assert.rejects(evaluateCandidate(c),/index flags/); await releaseCandidate(c);
  });
}
test('actual bytes and executable modes bind protected source independently of Git stat settings', async t => {
  const c=await candidate(t); await writeFile(join(c.worktree,'value.txt'),'2');
  const check=join(c.worktree,'scripts/tests/check.test.mjs'), original=await readFile(check), info=await stat(check);
  const weakened=Buffer.from(original.toString().replace("'2'","'3'")); assert.equal(weakened.length,original.length);
  await writeFile(check,weakened); await utimes(check,info.atime,info.mtime);
  await assert.rejects(evaluateCandidate(c),/Out-of-scope/); await writeFile(check,original);
  git(c.worktree,'config','core.fileMode','false'); await chmod(check,0o755);
  await assert.rejects(evaluateCandidate(c),/Out-of-scope/); await releaseCandidate(c);
});
test('owner can release after stale source or committed candidate, without discarding work', async t => {
  const c=await candidate(t); await writeFile(join(c.repoRoot,'value.txt'),'dirty');
  await assert.rejects(evaluateCandidate(c),/Baseline changed/); await releaseCandidate(c);
  const other=await candidate(t); await writeFile(join(other.worktree,'value.txt'),'2');
  git(other.worktree,'add','value.txt'); git(other.worktree,'commit','-qm','preserved candidate');
  await assert.rejects(evaluateCandidate(other),/worktree identity changed/); await releaseCandidate(other);
  assert.equal(await readFile(join(other.worktree,'value.txt'),'utf8'),'2');
});
test('precreated review artifact symlinks are not overwritten', async t => {
  const c=await candidate(t); await writeFile(join(c.worktree,'value.txt'),'2');
  await symlink(join(c.repoRoot,'value.txt'),join(c.bundle,'candidate.patch'));
  await assert.rejects(evaluateCandidate(c),/EEXIST/);
  assert.equal(await readFile(join(c.repoRoot,'value.txt'),'utf8'),'1'); await releaseCandidate(c);
});
test('staged additions cannot evade scope and allowed staged additions bind to candidate tree', async t => {
  const c=await candidate(t); await writeFile(join(c.worktree,'value.txt'),'2');
  await writeFile(join(c.worktree,'outside.txt'),'hidden'); git(c.worktree,'add','outside.txt');
  await assert.rejects(evaluateCandidate(c),/Out-of-scope/); await releaseCandidate(c);
  const options=await fixture(t), allowed={...options,allowedPaths:['value.txt','new.txt']};
  const other={...allowed,...await prepareCandidate(allowed)};
  await writeFile(join(other.worktree,'value.txt'),'2'); await writeFile(join(other.worktree,'new.txt'),'tracked new content'); git(other.worktree,'add','new.txt');
  const result=await evaluateCandidate(other); assert.deepEqual(result.changedPaths,['new.txt','value.txt']);
  assert.equal(git(other.repoRoot,'show',result.candidateTree+':new.txt'),'tracked new content');
  await releaseCandidate(other);
});
