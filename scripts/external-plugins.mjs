// external-plugins — the checks and the sandboxing smoke-all-plugins applies to an external marketplace entry (ADR-484):
// a plugin listed by a git-subdir source pinned to a commit, maintained in another repository. Its smoke.sh is third-party
// code, so it runs with a scrubbed environment, a temporary HOME, and a working directory that holds only its own checkout.
// This is not a sandbox: the script can still read absolute paths. The workflow therefore also drops the job token's write
// scopes and keeps no credentials in the workspace (permissions: contents: read, persist-credentials: false).
//
// Tested by tests/external-plugins.test.mjs (node --test).

import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, sep } from 'node:path';

/** github.com repositories only: owner and repo are plain names; `.` and `..` are not names. */
const GITHUB_REPO_URL = /^https:\/\/github\.com\/([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)$/;

/** True for `https://github.com/<owner>/<repo>` with an optional `.git`, nothing before or after it. */
export function isAllowedRepoUrl(url) {
  const match = typeof url === 'string' ? GITHUB_REPO_URL.exec(url) : null;
  if (match === null) return false;
  const repo = match[2].replace(/\.git$/, '');
  return ![match[1], repo].some((part) => part === '' || part === '.' || part === '..');
}

/** Why an external marketplace source is refused, or null when it is a pinned github git-subdir. */
export function externalSourceProblem(source) {
  const s = source ?? {};
  if (s.source !== 'git-subdir') return 'source is not a git-subdir';
  if (!isAllowedRepoUrl(s.url)) return 'url is not https://github.com/<owner>/<repo>';
  if (typeof s.path !== 'string' || s.path === '' || s.path.startsWith('/') || s.path.split('/').some((part) => part === '..' || part === '.')) {
    return 'path is not a relative folder without . or ..';
  }
  if (typeof s.sha !== 'string' || !/^[0-9a-f]{40}$/.test(s.sha)) return 'source does not pin a full 40-character commit sha';
  return null;
}

const SECRET_NAME = /(^GITHUB_TOKEN$|^ACTIONS_|_TOKEN$|_KEY$|SECRET)/i;
const KEPT = ['PATH', 'LANG', 'TERM', 'CI'];

/** The environment an external smoke runs with: PATH, LANG, TERM and CI from `base`, HOME set to `home`, nothing else. */
export function scrubbedEnv(home, base = process.env) {
  const env = { HOME: home };
  for (const key of KEPT) if (typeof base[key] === 'string' && !SECRET_NAME.test(key)) env[key] = base[key];
  return env;
}

/** `inner` resolved through links, when it stays inside `outer` (also resolved); null when it is missing or escapes. */
export function realpathInside(outer, inner) {
  let root;
  let target;
  try {
    root = realpathSync(outer);
    target = realpathSync(inner);
  } catch {
    return null;
  }
  return target === root || target.startsWith(root + sep) ? target : null;
}

/** A fresh work area outside the repository: `checkout/` for the plugin's repository and `home/` for its HOME. */
export function makeWorkArea(parent = tmpdir()) {
  const dir = mkdtempSync(join(parent, 'smoke-external-'));
  const checkout = join(dir, 'checkout');
  const home = join(dir, 'home');
  mkdirSync(checkout);
  mkdirSync(home);
  return { dir, checkout, home };
}

/** Fetches `sha` of `url` into `checkout` (shallow, blobless) with the scrubbed env; null on success, else why it failed. */
export function checkoutAt(url, sha, checkout, home, timeoutMs) {
  const env = { ...scrubbedEnv(home), GIT_TERMINAL_PROMPT: '0', GIT_CONFIG_NOSYSTEM: '1' };
  for (const args of [['init', '-q'], ['remote', 'add', 'origin', url], ['fetch', '-q', '--depth', '1', '--filter=blob:none', 'origin', sha], ['checkout', '-q', 'FETCH_HEAD']]) {
    const r = spawnSync('git', ['-C', checkout, ...args], { encoding: 'utf8', timeout: timeoutMs, env });
    if (r.status !== 0) return `git ${args[0]} failed: ${(r.stderr || r.error?.message || '').trim().slice(0, 200)}`;
  }
  return null;
}

/**
 * How to run the plugin's smoke inside a checkout: its manifest must carry `name`, the plugin folder and smoke.sh must stay
 * inside the checkout after links are resolved. Returns { problem } or { smoke: null } (no smoke.sh) or { smoke, cwd, env }, the env
 * scrubbed from `base` (the caller's environment).
 */
export function externalSmokePlan(checkout, home, path, name, base = process.env) {
  const root = realpathInside(checkout, join(checkout, path));
  if (root === null) return { problem: `${path} is missing or resolves outside the checkout` };
  const manifestPath = realpathInside(checkout, join(root, '.claude-plugin', 'plugin.json'));
  let manifest = null;
  try {
    if (manifestPath !== null && statSync(manifestPath).size <= 1_000_000) manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  } catch { /* reported below */ }
  if (manifest?.name !== name) return { problem: `plugin.json at ${path} does not name ${name}` };
  const smokePath = join(root, 'scripts', 'smoke.sh');
  if (!existsSync(smokePath)) return { smoke: null };
  const smoke = realpathInside(checkout, smokePath);
  if (smoke === null) return { problem: 'scripts/smoke.sh resolves outside the checkout' };
  return { smoke, cwd: realpathSync(checkout), env: scrubbedEnv(home, base) };
}
