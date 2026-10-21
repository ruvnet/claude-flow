/**
 * ADR-389 / #3401 — the keyword router helper must be refreshed on upgrade.
 *
 * `hook-handler.cjs` loads `router.cjs` from the same helpers dir to label each
 * prompt with a suggested agent. The April-era router matched keywords as
 * SUBSTRINGS ("la*test*" → tester). The word-boundary fix shipped in the
 * package (PR #3402) but never reached existing installs, because `router.cjs`
 * was not in CRITICAL_HELPERS and `init` skips files that already exist.
 *
 * Like helper-refresh.test.ts, the copy path is exercised against a
 * throwaway-keypair-signed fixture so this suite does not depend on the real
 * manifest being re-signed. The fixture's router.cjs IS the real package copy,
 * so the test also proves the package ships the fixed router.
 */
import { describe, it, expect } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { generateKeyPairSync, sign as edSign } from 'node:crypto';

import {
  autoRefreshHelpersIfStale,
  getInstalledCliVersion,
  CRITICAL_HELPERS,
  HELPERS_STAMP_FILE,
} from '../src/init/helper-refresh.js';
import { canonicalManifestBytes, sha256Hex } from '../src/init/helper-signing.js';
import { generateAgentRouter } from '../src/init/helpers-generator.js';

const PKG_HELPERS_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', '.claude', 'helpers');
const PROMPT = 'sync and review latest issues';

// The pre-#2257 router as installed on real machines (dated 2026-04-15):
// plain substring alternations compiled with new RegExp(pattern, 'i').
const STALE_APRIL_ROUTER = `#!/usr/bin/env node
const TASK_PATTERNS = {
  'implement|create|build|add|write code': 'coder',
  'test|spec|coverage|unit test|integration': 'tester',
  'review|audit|check|validate|security': 'reviewer',
  'research|find|search|documentation|explore': 'researcher',
  'design|architect|structure|plan': 'architect',
  'api|endpoint|server|backend|database': 'backend-dev',
  'ui|frontend|component|react|css|style': 'frontend-dev',
  'deploy|docker|ci|cd|pipeline|infrastructure': 'devops',
};
function routeTask(task) {
  const taskLower = task.toLowerCase();
  for (const [pattern, agent] of Object.entries(TASK_PATTERNS)) {
    const regex = new RegExp(pattern, 'i');
    if (regex.test(taskLower)) {
      return { agent, confidence: 0.8, reason: 'Matched pattern: ' + pattern };
    }
  }
  return { agent: 'coder', confidence: 0.5, reason: 'Default routing - no specific pattern matched' };
}
module.exports = { routeTask, TASK_PATTERNS };
`;

/** Load a CommonJS router.cjs fresh (no require cache reuse between loads). */
function loadRouter(file: string): { routeTask: (t: string) => { agent: string; confidence: number } } {
  const req = createRequire(file);
  delete req.cache[req.resolve(file)];
  return req(file);
}

/** Signed source fixture: the real package hook-handler.cjs + router.cjs. */
function makeSignedSource(version: string): { sourceDir: string; pubkeyPem: string } {
  const sourceDir = mkdtempSync(join(tmpdir(), 'adr389-source-'));
  const files: Record<string, string> = {};
  for (const name of ['hook-handler.cjs', 'router.cjs']) {
    const content = readFileSync(join(PKG_HELPERS_DIR, name));
    writeFileSync(join(sourceDir, name), content);
    files[name] = sha256Hex(content);
  }
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  const manifest = { version, files };
  const signature = edSign(null, canonicalManifestBytes(manifest), privateKey).toString('base64');
  writeFileSync(
    join(sourceDir, 'helpers.manifest.json'),
    JSON.stringify({ manifest, signature, algorithm: 'ed25519' }),
  );
  return { sourceDir, pubkeyPem: publicKey.export({ type: 'spki', format: 'pem' }).toString() };
}

describe('ADR-389 — router.cjs is a refreshed critical helper', () => {
  it('CRITICAL_HELPERS includes router.cjs', () => {
    expect(CRITICAL_HELPERS).toContain('router.cjs');
  });

  it('the stale April router really does misroute the prompt (fixture sanity)', () => {
    const dir = mkdtempSync(join(tmpdir(), 'adr389-stale-'));
    writeFileSync(join(dir, 'router.cjs'), STALE_APRIL_ROUTER);
    const r = loadRouter(join(dir, 'router.cjs')).routeTask(PROMPT);
    expect(r.agent).toBe('tester');
    expect(r.confidence).toBe(0.8);
  });

  it('refresh replaces a stale substring router.cjs with the package copy', async () => {
    const version = getInstalledCliVersion();
    const cwd = mkdtempSync(join(tmpdir(), 'adr389-project-'));
    const helpersDir = join(cwd, '.claude', 'helpers');
    mkdirSync(helpersDir, { recursive: true });
    writeFileSync(join(helpersDir, 'hook-handler.cjs'), '// old hook-handler\n');
    writeFileSync(join(helpersDir, 'router.cjs'), STALE_APRIL_ROUTER);
    writeFileSync(join(helpersDir, HELPERS_STAMP_FILE), '0.0.1-old');
    const { sourceDir, pubkeyPem } = makeSignedSource(version);

    const res = await autoRefreshHelpersIfStale(cwd, { sourceDirOverride: sourceDir, pubkeyPemOverride: pubkeyPem });
    expect(res.blocked).toBeUndefined();
    expect(res.refreshed).toBe(true);

    const installed = readFileSync(join(helpersDir, 'router.cjs'));
    expect(sha256Hex(installed)).toBe(sha256Hex(readFileSync(join(PKG_HELPERS_DIR, 'router.cjs'))));

    const r = loadRouter(join(helpersDir, 'router.cjs')).routeTask(PROMPT);
    expect(r.agent).not.toBe('tester');
    expect(r.agent).toBe('reviewer');
  });

  it('the generator fallback router (unresolvable package source) is also word-boundary', () => {
    const dir = mkdtempSync(join(tmpdir(), 'adr389-gen-'));
    writeFileSync(join(dir, 'router.cjs'), generateAgentRouter());
    expect(loadRouter(join(dir, 'router.cjs')).routeTask(PROMPT).agent).not.toBe('tester');
  });
});
