import { spawnSync, execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { lstat, readdir, readFile, writeFile } from 'node:fs/promises';
import { join, relative, resolve } from 'node:path';

const RECEIPT = 'release-preparation.receipt.json';
const cliPath = root => join(root, 'v3', '@claude-flow', 'cli');
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const ARTIFACTS = ['bin', 'dist', '.claude', 'plugins', 'package.json', 'README.md', 'catalog-manifest.json',
  ...['security', 'codex', 'mcp', 'plugin-agent-federation'].map(name => `node_modules/@claude-flow/${name}`)];

async function sourceSnapshot(root) {
  // Includes dirty tracked files and relevant untracked source. HEAD alone
  // cannot establish that the prepared artifact belongs to the current tree.
  const paths = execFileSync('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard', '--',
    'package.json', 'README.md', 'package-lock.json', 'scripts', 'v3', 'plugins', '.claude', '.claude-plugin'],
  { cwd: root, encoding: 'utf8' }).split('\0').filter(Boolean);
  const sources = {};
  for (const path of [...new Set(paths)].sort()) {
    if (/(^|\/)(node_modules|dist|coverage|\.git)(\/|$)/.test(path) || path.endsWith(RECEIPT)) continue;
    const info = await lstat(join(root, path));
    if (info.isSymbolicLink()) throw new Error(`Release source symlink is unsupported: ${path}`);
    if (info.isFile()) sources[path] = digest(await readFile(join(root, path)));
  }
  return sources;
}

async function artifactSnapshot(cli) {
  const artifacts = {};
  async function visit(path) {
    const info = await lstat(path);
    const key = relative(cli, path).split('\\').join('/');
    if (info.isSymbolicLink()) throw new Error(`Prepared artifact symlink is unsupported: ${path}`);
    if (info.isDirectory()) {
      const names = (await readdir(path)).sort();
      if (!names.length) artifacts[key] = 'directory';
      for (const name of names) await visit(join(path, name));
    } else if (info.isFile()) artifacts[key] = digest(await readFile(path));
  }
  for (const path of ARTIFACTS) await visit(join(cli, path));
  for (const required of ['plugins/ruflo-console/dist/tui.mjs', 'plugins/ruflo-metaharness/scripts/score.mjs', '.claude/helpers/helpers.manifest.json']) {
    if (!artifacts[required]) throw new Error(`Missing prepared capability: ${required}`);
  }
  return artifacts;
}

function assertSame(actual, expected, label) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`Scoped CLI ${label} changed since preparation; run its canonical prepublish gate again`);
  }
}

/** Called only after the canonical CLI signing AND verification gates pass. */
export async function writePreparedCliReceipt(repoRoot) {
  const root = resolve(repoRoot);
  const cli = cliPath(root);
  const receipt = { format: 1, source: await sourceSnapshot(root), artifacts: await artifactSnapshot(cli) };
  await writeFile(join(cli, RECEIPT), `${JSON.stringify(receipt, null, 2)}\n`);
}

/** Root publication reuses the signed preparation without obtaining a key. */
export async function verifyPreparedCli(repoRoot) {
  const root = resolve(repoRoot);
  const cli = cliPath(root);
  const receipt = JSON.parse(await readFile(join(cli, RECEIPT), 'utf8'));
  if (receipt.format !== 1 || !receipt.source || !receipt.artifacts) throw new Error('Invalid scoped CLI preparation receipt');
  assertSame(await sourceSnapshot(root), receipt.source, 'source');
  assertSame(await artifactSnapshot(cli), receipt.artifacts, 'artifacts');
  const result = spawnSync(process.execPath, [join(cli, 'scripts', 'verify-helpers.mjs')], { cwd: cli, stdio: 'inherit' });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`Scoped CLI helper verification failed with exit code ${result.status ?? 'unknown'}`);
}
