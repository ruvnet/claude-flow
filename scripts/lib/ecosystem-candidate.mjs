import { readFile, writeFile, readlink, realpath, mkdir, mkdtemp, lstat, unlink } from 'node:fs/promises';
import { join, resolve, dirname, relative, sep } from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { createRsiPlan, evaluateRsiPlan } from './ecosystem-rsi.mjs';

const hash = value => createHash('sha256').update(value).digest('hex');
const executorBinding = async () => ({ candidate: hash(await readFile(new URL(import.meta.url))), evaluator: hash(await readFile(new URL('./ecosystem-rsi.mjs', import.meta.url))) });
export const defaultInputs = { registryPath: 'data/ecosystem-capabilities.json', graphPath: 'data/npm-dependencies.latest.json', runtimePath: 'data/npm-runtime-relationships.latest.json', benchmarkPath: 'data/npm-download-benchmark.latest.json' };
export const proposalId = finding => hash(JSON.stringify(finding));
const cleanEnv = () => Object.fromEntries(Object.entries(process.env).filter(([key]) => ['PATH', 'SystemRoot', 'TEMP', 'TMP', 'TMPDIR', 'LANG'].includes(key) || /^RUFLO_(MEMORY|RUVECTOR|WEIGHT_EFT)_(REQUIRED|RESOLVE_FROM)$/.test(key)));
function git(root, args, { index, input } = {}) {
  return execFileSync('git', ['-c', 'core.hooksPath=/dev/null', '-c', 'core.fsmonitor=false', '-c', 'core.fileMode=true', '-C', root, ...args], {
    input, encoding: 'utf8', timeout: 20000, maxBuffer: 4 * 1024 * 1024,
    env: { ...cleanEnv(), GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null', ...(index ? { GIT_INDEX_FILE: index } : {}) },
    stdio: ['pipe', 'pipe', 'pipe'],
  });
}
const split = output => output.split('\0').filter(Boolean);
// Never trust index stat caches, assume-unchanged or skip-worktree for the
// executed source. Hash actual disk bytes against the immutable Git tree.
async function diskChanges(root, tree) {
  const tracked = split(git(root, ['ls-files', '-v', '-z']));
  if (tracked.some(entry => !entry.startsWith('H '))) throw new Error('Unsupported index flags or conflicts');
  const entries = split(git(root, ['ls-tree', '-r', '-z', tree]));
  const baselinePaths = new Set(entries.map(entry => entry.slice(entry.indexOf('\t') + 1)));
  const paths = new Set(split(git(root, ['ls-files', '--others', '--exclude-standard', '-z'])));
  for (const entry of tracked) if (!baselinePaths.has(entry.slice(2))) paths.add(entry.slice(2));
  for (const entry of entries) {
    const [header, path] = entry.split('\t'), [mode, type, oid] = header.split(' ');
    if (type !== 'blob') throw new Error('Submodule candidates unsupported');
    const parts = path.split('/');
    let missing = false;
    for (let i = 1; i < parts.length; i++) {
      try { if (!(await lstat(join(root, ...parts.slice(0, i)))).isDirectory()) { paths.add(parts.slice(0, i).join('/')); missing = true; break; } }
      catch (error) { if (error.code !== 'ENOENT') throw error; missing = true; break; }
    }
    if (missing) { paths.add(path); continue; }
    let info;
    try { info = await lstat(join(root, path)); } catch (error) { if (error.code !== 'ENOENT') throw error; }
    if (!info) { paths.add(path); continue; }
    if (!info.isFile() && !info.isSymbolicLink()) { paths.add(path); continue; }
    const bytes = info.isSymbolicLink() ? await readlink(join(root, path), { encoding: 'buffer' }) : await readFile(join(root, path));
    const actualMode = info.isSymbolicLink() ? '120000' : info.mode & 0o111 ? '100755' : '100644';
    const actualOid = createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex');
    if (actualMode !== mode || actualOid !== oid) paths.add(path);
  }
  return [...paths].sort();
}
async function cleanBaseline(base, message) {
  if (git(base.repoRoot, ['status', '--porcelain', '--untracked-files=all']).trim() || (await diskChanges(base.repoRoot, base.tree)).length) throw new Error(message);
}
async function guarded(leasePath, action) {
  const guard = leasePath + '.guard';
  await writeFile(guard, 'coordination guard', { flag: 'wx', mode: 0o600 });
  try { return await action(); } finally { await unlink(guard); }
}
function safePath(path) {
  if (typeof path !== 'string' || !/^[a-zA-Z0-9@_][a-zA-Z0-9@_./-]*$/.test(path) || path.split('/').some(p => !p || p === '.' || p === '..' || p.toLowerCase() === '.git')) throw new Error('Unsafe exact file path');
  if (/^(scripts|\.github)\//.test(path) || /(^|\/)(AGENTS\.md|\.gitattributes|\.gitmodules)$/.test(path)) throw new Error('Protected control or guidance path');
  return path;
}
async function identity(root) {
  const repoRoot = await realpath(root);
  if (git(repoRoot, ['rev-parse', '--show-toplevel']).trim() !== repoRoot) throw new Error('Repository root required');
  return { repoRoot, head: git(repoRoot, ['rev-parse', 'HEAD']).trim(), tree: git(repoRoot, ['rev-parse', 'HEAD^{tree}']).trim(), common: await realpath(resolve(repoRoot, git(repoRoot, ['rev-parse', '--git-common-dir']).trim())) };
}
export async function listCandidateProposals({ repoRoot, inputs = defaultInputs }) {
  const plan = await createRsiPlan({ repoRoot, ...inputs, maxChecks: 64 });
  return { inputHash: plan.inputHash, proposals: plan.findings.map(finding => ({ id: proposalId(finding), ...finding })) };
}
export async function prepareCandidate({ repoRoot, expectedHead, proposal, allowedPaths, destinationRoot, inputs = defaultInputs, leaseMs = 45 * 60000 }) {
  const base = await identity(repoRoot);
  if (!/^[a-f0-9]{40}$/.test(expectedHead ?? '') || base.head !== expectedHead) throw new Error('Expected base HEAD mismatch');
  await cleanBaseline(base, 'Clean baseline required');
  if (!Number.isInteger(leaseMs) || leaseMs < 1000 || leaseMs > 45 * 60000) throw new Error('Invalid lease budget');
  if (!Array.isArray(allowedPaths) || !allowedPaths.length || allowedPaths.length > 20) throw new Error('Expected 1..20 exact allowed files');
  allowedPaths = [...new Set(allowedPaths.map(safePath))].sort();
  const plan = await createRsiPlan({ repoRoot: base.repoRoot, ...inputs, maxChecks: 64 });
  const finding = plan.findings.find(f => proposalId(f) === proposal);
  if (!finding) throw new Error('Unknown current proposal');
  const protectedPaths = [inputs.registryPath, inputs.graphPath, inputs.runtimePath, inputs.benchmarkPath].filter(Boolean);
  if (allowedPaths.some(p => protectedPaths.includes(p))) throw new Error('Protected evaluation input');
  const parent = await realpath(destinationRoot);
  if (parent === base.repoRoot || parent.startsWith(base.repoRoot + sep) || parent === base.common || parent.startsWith(base.common + sep)) throw new Error('Candidate destination must be outside repository and Git metadata');
  const leaseRoot = join(base.common, 'ecosystem-candidate-leases');
  await mkdir(leaseRoot, { recursive: true });
  const leaseKey = hash(base.head + proposal), leasePath = join(leaseRoot, leaseKey + '.json');
  // Existing leases, even expired, are never stolen. Inspect and explicitly release
  // the old owner before a retry. wx is the atomic concurrency boundary.
  const owner = randomUUID(), expiresAt = Date.now() + leaseMs;
  await guarded(leasePath, () => writeFile(leasePath, JSON.stringify({ owner, expiresAt, preparing: true }), { flag: 'wx', mode: 0o600 }));
  let bundle;
  try {
    bundle = await mkdtemp(join(parent, 'ecosystem-candidate-'));
    const worktree = join(bundle, 'worktree');
    git(base.repoRoot, ['worktree', 'add', '--detach', worktree, base.head]);
    const spec = { schema: 'ruflo-ecosystem-candidate/v1', ...base, bundle, worktree, leaseKey, owner, expiresAt, proposalId: proposal, finding, allowedPaths, inputs, baselinePlanHash: plan.inputHash, baselineSourceHash: plan.sourceBinding.sha256 };
    const encoded = JSON.stringify(spec, null, 2) + '\n';
    await writeFile(join(bundle, 'candidate.json'), encoded, { flag: 'wx', mode: 0o600 });
    await writeFile(leasePath, JSON.stringify({ owner, expiresAt, bundle, specSha256: hash(encoded) }));
    return { bundle, worktree, proposalId: proposal, baseHead: base.head, expiresAt, instructions: 'Explicit executor edits only. Evaluate before manual PR handoff; no automatic merge or release.' };
  } catch (error) {
    // Preserve any created worktree for inspection; do not recursively delete work.
    const lease = JSON.parse(await readFile(leasePath));
    if (lease.owner === owner) await unlink(leasePath);
    throw new Error(`Candidate preparation failed; preserved bundle: ${bundle ?? 'none'}`, { cause: error });
  }
}
async function loadCandidate(repoRoot, bundle, { allowExpired = false, ownershipOnly = false } = {}) {
  const base = await identity(repoRoot), actual = await realpath(bundle);
  const bytes = await readFile(join(actual, 'candidate.json'));
  const spec = JSON.parse(bytes);
  if (spec.schema !== 'ruflo-ecosystem-candidate/v1' || !/^[a-f0-9]{64}$/.test(spec.leaseKey ?? '')) throw new Error('Invalid candidate state');
  const leasePath = join(base.common, 'ecosystem-candidate-leases', spec.leaseKey + '.json');
  const lease = JSON.parse(await readFile(leasePath));
  if (lease.specSha256 !== hash(bytes) || lease.owner !== spec.owner || lease.bundle !== actual || spec.bundle !== actual || spec.repoRoot !== base.repoRoot || spec.common !== base.common) throw new Error('Lease/state identity mismatch');
  if (ownershipOnly) return { spec, leasePath };
  if (!allowExpired && Date.now() >= lease.expiresAt) throw new Error('Candidate lease expired; inspect and explicitly release, never steal');
  if (base.head !== spec.head) throw new Error('Baseline changed after preparation');
  await cleanBaseline(base, 'Baseline changed after preparation');
  const candidate = await identity(spec.worktree);
  if (spec.worktree !== join(actual, 'worktree') || candidate.head !== spec.head || candidate.common !== base.common || git(spec.worktree, ['rev-parse', '--abbrev-ref', 'HEAD']).trim() !== 'HEAD') throw new Error('Detached worktree identity changed');
  const plan = await createRsiPlan({ repoRoot: base.repoRoot, ...spec.inputs, maxChecks: 64 });
  if (plan.inputHash !== spec.baselinePlanHash || !plan.findings.some(f => proposalId(f) === spec.proposalId)) throw new Error('Stale proposal source');
  return { spec, leasePath, plan };
}
async function snapshot(spec, index) {
  const root = spec.worktree;
  if (git(root, ['ls-files', '--others', '--ignored', '--exclude-standard']).trim()) throw new Error('Unexpected ignored files in candidate');
  const paths = await diskChanges(root, spec.tree);
  if (!paths.length) throw new Error('No candidate changes');
  if (paths.some(p => !spec.allowedPaths.includes(p))) throw new Error('Out-of-scope candidate changes');
  git(root, ['read-tree', spec.tree], { index });
  let bytes = 0;
  for (const path of paths) {
    safePath(path);
    const segments = path.split('/');
    for (let i = 1; i <= segments.length; i++) {
      try { if ((await lstat(join(root, ...segments.slice(0, i)))).isSymbolicLink()) throw new Error('Candidate symbolic links forbidden'); }
      catch (error) { if (error.code !== 'ENOENT') throw error; }
    }
    let info;
    try { info = await lstat(join(root, path)); } catch (error) { if (error.code !== 'ENOENT') throw error; }
    if (!info) { git(root, ['update-index', '--force-remove', '--', path], { index }); continue; }
    if (!info.isFile()) throw new Error('Candidate regular files only');
    bytes += info.size;
    if (bytes > 1024 * 1024) throw new Error('Candidate exceeds 1 MiB changed-file budget');
    const content = await readFile(join(root, path));
    const object = git(root, ['hash-object', '--no-filters', '-w', '--stdin'], { input: content }).trim();
    const mode = info.mode & 0o111 ? '100755' : '100644';
    git(root, ['update-index', '--add', '--cacheinfo', mode, object, path], { index });
  }
  const tree = git(root, ['write-tree'], { index }).trim();
  if (tree === spec.tree) throw new Error('No candidate changes');
  return { tree, paths, bytes };
}
export async function evaluateCandidate({ repoRoot, bundle, maxDurationMs = 60000 }) {
  if (!Number.isInteger(maxDurationMs) || maxDurationMs < 100 || maxDurationMs > 300000) throw new Error('Invalid candidate evaluation budget');
  const initial = await loadCandidate(repoRoot, bundle);
  const { leasePath } = initial;
  const busy = leasePath + '.evaluating';
  const { spec, plan } = await guarded(leasePath, async () => {
    const current = await loadCandidate(repoRoot, bundle);
    try { await lstat(join(current.spec.bundle, 'review.json')); throw new Error('Candidate already evaluated; preserve evidence and prepare a new attempt'); } catch (error) { if (error.code !== 'ENOENT') throw error; }
    await writeFile(busy, current.spec.owner, { flag: 'wx', mode: 0o600 });
    return current;
  });
  const started = performance.now(), index = join(spec.bundle, `index-${randomUUID()}`);
  try {
    const executor = await executorBinding();
    const before = await snapshot(spec, index);
    const environment = cleanEnv();
    const baseline = await evaluateRsiPlan(plan, { repoRoot: spec.repoRoot, maxDurationMs: Math.max(1, Math.floor(maxDurationMs / 2)), environment });
    const remaining = Math.floor(maxDurationMs - (performance.now() - started));
    if (remaining < 1) throw new Error('Candidate evaluation budget exhausted');
    const candidatePlan = await createRsiPlan({ repoRoot: spec.worktree, ...spec.inputs, maxChecks: 64 });
    if (JSON.stringify(candidatePlan.selectedChecks) !== JSON.stringify(plan.selectedChecks)) throw new Error('Candidate changed baseline check selection');
    const candidate = await evaluateRsiPlan(candidatePlan, { repoRoot: spec.worktree, maxDurationMs: remaining, environment });
    await loadCandidate(repoRoot, bundle);
    const after = await snapshot(spec, index);
    if (before.tree !== after.tree) throw new Error('Candidate changed during evaluation');
    if (JSON.stringify(await executorBinding()) !== JSON.stringify(executor)) throw new Error('Evaluator source changed during execution');
    const patch = git(spec.repoRoot, ['diff', '--no-ext-diff', '--no-textconv', '--binary', spec.tree, before.tree]);
    git(spec.repoRoot, ['read-tree', before.tree], { index });
    git(spec.repoRoot, ['apply', '--cached', '--reverse', '--whitespace=nowarn', '-'], { index, input: patch });
    const rollbackTree = git(spec.repoRoot, ['write-tree'], { index }).trim();
    if (rollbackTree !== spec.tree) throw new Error('Rollback tree mismatch');
    const result = { schema: 'ruflo-ecosystem-candidate-review/v1', executorBinding: executor, proposalId: spec.proposalId, finding: spec.finding, baselineHead: spec.head, baselineTree: spec.tree, candidateTree: before.tree, changedPaths: before.paths, changedBytes: before.bytes, patchSha256: hash(patch), baseline, candidate, rollback: { method: 'reverse patch in isolated Git index', tree: rollbackTree, exactBaselineRestored: true }, status: candidate.checksPassed && candidate.sourceUnchanged ? 'checks-passed-review-required' : 'checks-failed', promotionAllowed: false, improvementEstablished: false, totalDurationMs: performance.now() - started, executionBoundary: 'Trusted local executor only; worktree and timeout are not a hostile-code sandbox. Unrelated environment variables are excluded; OS file/network access remains.' };
    await writeFile(join(spec.bundle, 'candidate.patch'), patch, { flag: 'wx', mode: 0o600 });
    await writeFile(join(spec.bundle, 'review.json'), JSON.stringify(result, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
    await writeFile(join(spec.bundle, 'PR.md'), `# Candidate review\n\nProposal: ${spec.proposalId} (${spec.finding.kind})\n\nBase: ${spec.head}\nCandidate tree: ${before.tree}\nPatch SHA256: ${result.patchSha256}\n\nStatus: ${result.status}. Changed files: ${before.paths.join(', ')}.\n\nBaseline checks passed: ${baseline.checksPassed}; candidate: ${candidate.checksPassed}. Uncovered packages: ${candidate.plan.uncoveredPackages.length}.\n\nRollback reconstructed exact base tree: ${rollbackTree}. This is source rollback, not runtime state rollback.\n\nNo measured improvement or release authorization is inferred. Review the patch and measurements independently; compare current remote SHA before any manual branch update. No install, push, PR creation, merge or publish is performed by this tool.\n`, { flag: 'wx', mode: 0o600 });
    return result;
  } finally {
    await unlink(index).catch(e => { if (e.code !== 'ENOENT') throw e; });
    if ((await readFile(busy, 'utf8')) === spec.owner) await unlink(busy);
  }
}
export async function releaseCandidate({ repoRoot, bundle }) {
  const { leasePath } = await loadCandidate(repoRoot, bundle, { allowExpired: true, ownershipOnly: true });
  return guarded(leasePath, async () => {
    const { spec } = await loadCandidate(repoRoot, bundle, { allowExpired: true, ownershipOnly: true });
    try { await lstat(leasePath + '.evaluating'); throw new Error('Candidate evaluation is active'); } catch (error) { if (error.code !== 'ENOENT') throw error; }
    await unlink(leasePath);
    return { released: true, preservedWorktree: spec.worktree, preservedBundle: spec.bundle };
  });
}
