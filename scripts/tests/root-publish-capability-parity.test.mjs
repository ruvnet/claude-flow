import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash, generateKeyPairSync, sign } from 'node:crypto';
import { cp, mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { writePreparedCliReceipt, verifyPreparedCli } from '../lib/prepare-scoped-cli.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'root publish parity '));
  t.after(() => rm(root, { recursive: true, force: true }));
  execFileSync('git', ['init', '--quiet'], { cwd: root });
  const cli = join(root, 'v3', '@claude-flow', 'cli');
  async function put(path, content) {
    await mkdir(dirname(join(root, path)), { recursive: true });
    await writeFile(join(root, path), content);
  }
  const prefix = 'v3/@claude-flow/cli/';
  for (const [path, content] of [
    ['package.json', '{"version":"1.0.0"}'], ['README.md', 'Fixture'],
    [prefix + 'package.json', '{"type":"module","version":"1.0.0"}'],
    [prefix + 'README.md', 'Fixture'], [prefix + 'catalog-manifest.json', '{"generation":1}'],
    [prefix + 'bin/cli.js', 'console.log("fixture")'],
    [prefix + 'src/index.ts', 'export const version = 1;'],
    [prefix + 'plugins/ruflo-metaharness/scripts/score.mjs', 'export const score = 1;'],
    [prefix + 'plugins/ruflo-console/dist/tui.mjs', 'export const tui = true;'],
  ]) await put(path, content);
  for (const name of ['security', 'codex', 'mcp', 'plugin-agent-federation']) {
    await put(prefix + `node_modules/@claude-flow/${name}/package.json`, JSON.stringify({ name: `@claude-flow/${name}` }));
  }
  // The only signer is local to fixture setup. Verification uses the real
  // production verifier and compiled trusted public-key surface.
  const keys = generateKeyPairSync('ed25519');
  const publicPem = keys.publicKey.export({ type: 'spki', format: 'pem' });
  await put(prefix + 'dist/src/init/helper-signing.js', `export const RUFLO_HELPERS_PUBKEY = ${JSON.stringify(publicPem)};`);
  const files = {};
  for (const name of ['auto-memory-hook.mjs', 'hook-handler.cjs', 'intelligence.cjs', 'statusline.cjs', 'router.cjs']) {
    const content = `// fixture ${name}\n`;
    await put(prefix + '.claude/helpers/' + name, content);
    files[name] = createHash('sha256').update(content).digest('hex');
  }
  const sorted = Object.fromEntries(Object.entries(files).sort(([a], [b]) => a.localeCompare(b)));
  const manifest = { version: '1.0.0', files: sorted };
  const signature = sign(null, Buffer.from(JSON.stringify(manifest)), keys.privateKey).toString('base64');
  await put(prefix + '.claude/helpers/helpers.manifest.json', JSON.stringify({ algorithm: 'ed25519', signature, manifest }));
  await mkdir(join(cli, 'scripts'), { recursive: true });
  await cp(join(HERE, '../../v3/@claude-flow/cli/scripts/verify-helpers.mjs'), join(cli, 'scripts/verify-helpers.mjs'));
  await writePreparedCliReceipt(root);
  return { root, cli, put, prefix };
}

test('root verifies prepared plugins, catalog, runtime bundles and real signed helpers without a signer', async t => {
  const { root, cli } = await fixture(t);
  await verifyPreparedCli(root);
  await assert.rejects(readFile(join(cli, 'scripts/sign-helpers.mjs')), { code: 'ENOENT' });
});

test('root refuses source drift, including untracked source without a HEAD commit', async t => {
  const { root, put, prefix } = await fixture(t);
  await put(prefix + 'src/new.ts', 'export const changed = true;');
  await assert.rejects(verifyPreparedCli(root), /source changed/);
});

test('root also refuses dirty tracked source while the git index stays unchanged', async t => {
  const { root, put, prefix } = await fixture(t);
  execFileSync('git', ['add', prefix + 'src/index.ts'], { cwd: root });
  await writePreparedCliReceipt(root);
  await put(prefix + 'src/index.ts', 'export const version = 2;');
  await assert.rejects(verifyPreparedCli(root), /source changed/);
});

test('root refuses staged TUI, MetaHarness and catalog tampering', async t => {
  for (const path of ['plugins/ruflo-console/dist/tui.mjs', 'plugins/ruflo-metaharness/scripts/score.mjs', 'catalog-manifest.json']) {
    const { root, put, prefix } = await fixture(t);
    await put(prefix + path, 'tampered');
    await assert.rejects(verifyPreparedCli(root), /changed since preparation/);
  }
});

test('a rewritten receipt cannot bypass actual signed helper verification', async t => {
  const { root, put, prefix } = await fixture(t);
  await put(prefix + '.claude/helpers/router.cjs', 'tampered');
  await writePreparedCliReceipt(root);
  await assert.rejects(verifyPreparedCli(root), /helper verification failed/);
});

test('missing preparation receipt fails closed', async t => {
  const { root, cli } = await fixture(t);
  await rm(join(cli, 'release-preparation.receipt.json'));
  await assert.rejects(verifyPreparedCli(root), { code: 'ENOENT' });
});

test('missing staged capability cannot receive a preparation receipt', async t => {
  const { root, cli } = await fixture(t);
  await rm(join(cli, 'plugins/ruflo-console/dist/tui.mjs'));
  await assert.rejects(writePreparedCliReceipt(root), /Missing prepared capability/);
});

test('stale embedded runtime bytes are rejected even though node_modules is excluded from source', async t => {
  const { root, put, prefix } = await fixture(t);
  await put(prefix + 'node_modules/@claude-flow/security/package.json', '{"name":"tampered"}');
  await assert.rejects(verifyPreparedCli(root), /artifacts changed/);
});

test('root only verifies; canonical CLI writes its receipt after signing and verification', async () => {
  const root = await readFile(join(HERE, '../prepare-root-publish.mjs'), 'utf8');
  const cli = await readFile(join(HERE, '../../v3/@claude-flow/cli/scripts/prepare-publish.mjs'), 'utf8');
  assert.equal(root.match(/verifyPreparedCli\(repoRoot\)/g)?.length, 1);
  assert.doesNotMatch(root, /prepareScopedCli\(|sign-helpers/);
  assert.ok(cli.lastIndexOf('await writePreparedCliReceipt(repoRoot)') > cli.indexOf("'verify-helpers.mjs'"));
});
