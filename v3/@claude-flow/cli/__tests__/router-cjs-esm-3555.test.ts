/**
 * #3555 — the keyword router helper is CommonJS, so it must ship as `.cjs`.
 *
 * Shipped as `router.js`, Node treats it as ESM in any project whose
 * package.json declares `"type":"module"`. `require` is then undefined, the
 * helper throws on load, and `hook-handler.cjs` silently prints
 * "Router not available, using default routing" — disabling ADR-389's fix in
 * exactly the projects most new Node code uses.
 */
import { describe, it, expect } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, cpSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { generateKeyPairSync, sign as edSign } from 'node:crypto';

import {
  CRITICAL_HELPERS, HELPERS_STAMP_FILE, autoRefreshHelpersIfStale, getInstalledCliVersion,
} from '../src/init/helper-refresh.js';
import { canonicalManifestBytes, sha256Hex } from '../src/init/helper-signing.js';
import { generateHelpers, generateHookHandler } from '../src/init/helpers-generator.js';

const PKG_HELPERS_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', '.claude', 'helpers');
const PROMPT = 'sync and review latest issues';

/** A throwaway project whose package.json makes every `.js` file ESM. */
function esmProject(): { cwd: string; helpersDir: string } {
  const cwd = mkdtempSync(join(tmpdir(), 'router-esm-3555-'));
  writeFileSync(join(cwd, 'package.json'), JSON.stringify({ name: 'esm-probe', type: 'module' }));
  const helpersDir = join(cwd, '.claude', 'helpers');
  mkdirSync(helpersDir, { recursive: true });
  return { cwd, helpersDir };
}

function node(cwd: string, args: string[], env: Record<string, string> = {}) {
  return spawnSync(process.execPath, args, {
    cwd,
    input: '',
    encoding: 'utf-8',
    timeout: 20_000,
    env: { ...process.env, ...env },
  });
}

describe('#3555 — router helper loads in "type":"module" projects', () => {
  it('the package ships router.cjs and lists it as a critical helper', () => {
    expect(CRITICAL_HELPERS).toContain('router.cjs');
    expect(CRITICAL_HELPERS).not.toContain('router.js');
    expect(() => readFileSync(join(PKG_HELPERS_DIR, 'router.cjs'))).not.toThrow();
  });

  it('the generators emit router.cjs and a hook-handler that requires it', () => {
    const helpers = generateHelpers({ components: { helpers: true } } as never);
    expect(Object.keys(helpers)).toContain('router.cjs');
    expect(Object.keys(helpers)).not.toContain('router.js');
    expect(generateHookHandler()).toContain("path.join(helpersDir, 'router.cjs')");
    expect(generateHookHandler()).not.toContain("path.join(helpersDir, 'router.js')");
  });

  it('control: a .js copy of the same router throws in an ESM project (the reported failure)', () => {
    const { cwd, helpersDir } = esmProject();
    writeFileSync(join(helpersDir, 'router.js'), readFileSync(join(PKG_HELPERS_DIR, 'router.cjs')));
    const r = node(cwd, ['.claude/helpers/router.js', PROMPT]);
    expect(r.status).not.toBe(0);
    expect(r.stderr).toMatch(/require is not defined/);
  });

  it('router.cjs routes the prompt to reviewer when run directly in an ESM project', () => {
    const { cwd, helpersDir } = esmProject();
    writeFileSync(join(helpersDir, 'router.cjs'), readFileSync(join(PKG_HELPERS_DIR, 'router.cjs')));
    const r = node(cwd, ['.claude/helpers/router.cjs', PROMPT]);
    expect(r.status).toBe(0);
    expect(JSON.parse(r.stdout).agent).toBe('reviewer');
  });

  it('the generators emit session.cjs / memory.cjs and a hook-handler that requires them', () => {
    const helpers = generateHelpers({ components: { helpers: true } } as never);
    for (const name of ['session', 'memory']) {
      expect(Object.keys(helpers)).toContain(`${name}.cjs`);
      expect(Object.keys(helpers)).not.toContain(`${name}.js`);
      expect(generateHookHandler()).toContain(`path.join(helpersDir, '${name}.cjs')`);
    }
  });

  it('a fresh install of the packaged helpers loads every sibling helper in an ESM project', () => {
    const { cwd, helpersDir } = esmProject();
    cpSync(PKG_HELPERS_DIR, helpersDir, { recursive: true });
    const r = node(cwd, [
      '--input-type=commonjs', '-e',
      "console.log(JSON.stringify(require('./.claude/helpers/hook-handler.cjs').loadedHelpers))",
    ]);
    expect(r.stderr).not.toMatch(/require is not defined/);
    expect(JSON.parse(r.stdout.trim().split('\n').pop() ?? 'null'))
      .toEqual({ router: true, session: true, memory: true, intelligence: true });
  });

  it('hook-handler session-restore / session-end drive the session helper in an ESM project', () => {
    const { cwd, helpersDir } = esmProject();
    cpSync(PKG_HELPERS_DIR, helpersDir, { recursive: true });
    const current = join(cwd, '.claude-flow', 'sessions', 'current.json');

    const restore = node(cwd, ['.claude/helpers/hook-handler.cjs', 'session-restore'], { RUFLO_NO_AUTO_ENABLE: '1' });
    // The no-helper fallback prints a placeholder and writes nothing.
    expect(restore.stdout).not.toContain('%SESSION_ID%');
    expect(existsSync(current)).toBe(true);
    const id = JSON.parse(readFileSync(current, 'utf-8')).id as string;

    const end = node(cwd, ['.claude/helpers/hook-handler.cjs', 'session-end'], { RUFLO_NO_AUTO_ENABLE: '1' });
    expect(end.stdout).toContain(`Session ended: ${id}`);
    expect(existsSync(current)).toBe(false);
    expect(existsSync(join(cwd, '.claude-flow', 'sessions', `${id}.json`))).toBe(true);
  });

  it('refreshing a pre-rename install adds the .cjs companions and ignores the stale .js copies', async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'router-esm-3555-refresh-'));
    const helpersDir = join(cwd, '.claude', 'helpers');
    mkdirSync(helpersDir, { recursive: true });
    writeFileSync(join(helpersDir, 'hook-handler.cjs'), '// old hook-handler\n');
    writeFileSync(join(helpersDir, 'session.js'), '// stale session.js\n');
    writeFileSync(join(helpersDir, 'memory.js'), '// stale memory.js\n');
    writeFileSync(join(helpersDir, HELPERS_STAMP_FILE), '0.0.1-old');

    const sourceDir = mkdtempSync(join(tmpdir(), 'router-esm-3555-source-'));
    const files: Record<string, string> = {};
    for (const name of ['hook-handler.cjs', 'router.cjs']) {
      const content = readFileSync(join(PKG_HELPERS_DIR, name));
      writeFileSync(join(sourceDir, name), content);
      files[name] = sha256Hex(content);
    }
    const { publicKey, privateKey } = generateKeyPairSync('ed25519');
    const manifest = { version: getInstalledCliVersion(), files };
    const signature = edSign(null, canonicalManifestBytes(manifest), privateKey).toString('base64');
    writeFileSync(join(sourceDir, 'helpers.manifest.json'), JSON.stringify({ manifest, signature, algorithm: 'ed25519' }));

    const res = await autoRefreshHelpersIfStale(cwd, {
      sourceDirOverride: sourceDir,
      pubkeyPemOverride: publicKey.export({ type: 'spki', format: 'pem' }).toString(),
    });
    expect(res.refreshed).toBe(true);
    expect(existsSync(join(helpersDir, 'session.cjs'))).toBe(true);
    expect(existsSync(join(helpersDir, 'memory.cjs'))).toBe(true);
    expect(readFileSync(join(helpersDir, 'session.js'), 'utf-8')).toBe('// stale session.js\n');
  });

  it('the packaged hook-handler routes through router.cjs in an ESM project', () => {
    const { cwd, helpersDir } = esmProject();
    for (const name of ['hook-handler.cjs', 'router.cjs']) {
      writeFileSync(join(helpersDir, name), readFileSync(join(PKG_HELPERS_DIR, name)));
    }
    const r = node(cwd, ['.claude/helpers/hook-handler.cjs', 'route'], { PROMPT });
    expect(r.stdout).not.toContain('Router not available');
    expect(r.stdout).toContain('Primary Recommendation');
    expect(r.stdout).toMatch(/Agent: reviewer/);
  });
});
