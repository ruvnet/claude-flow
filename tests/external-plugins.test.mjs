// node --test tests/external-plugins.test.mjs
// The external-plugin checks (ADR-484): the github-only source allowlist in scripts/external-plugins.mjs and in
// validate-marketplace.yml's inline validator, the realpath containment of the plugin folder, and the environment and working
// directory an external smoke.sh runs with.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, sep } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { externalSmokePlan, externalSourceProblem, isAllowedRepoUrl, makeWorkArea, realpathInside, scrubbedEnv } from '../scripts/external-plugins.mjs';

const REPO = fileURLToPath(new URL('..', import.meta.url));
const SHA = '9db36edfaf85c467c7a91cac1791d660b74a9762';
const source = (over) => ({ source: 'git-subdir', url: 'https://github.com/proffesor-for-testing/agentic-qe.git', path: 'plugins/agentic-qe-fleet', ref: 'v3.15.2', sha: SHA, ...over });

const REFUSED_URLS = [
  'https://github.com.evil.io/owner/repo',
  'https://evil.io/github.com/owner/repo',
  'https://gitlab.com/owner/repo',
  'http://github.com/owner/repo',
  'https://user@github.com/owner/repo',
  'https://github.com/owner/repo/extra',
  'https://github.com/owner',
  'https://github.com/../repo',
  'https://github.com/owner/..',
  'https://github.com/owner/repo?x=1',
  'https://github.com/own er/repo',
  'git@github.com:owner/repo.git',
  '--upload-pack=x',
];

// Paths the plugin folder may not take: encoded or backslashed climbs, empty or trailing segments, absolute, . and .. segments.
const BAD_PATHS = ['%2e%2e', 'plugins/%2e%2e/x', 'a\\..\\b', 'a//b', 'plugins/p/', '/etc', '.', '..', 'a/./b', 'a/../b', '', 'a b', 'a/b?c'];

test('the allowlist takes https://github.com/<owner>/<repo>, with or without .git', () => {
  assert.equal(isAllowedRepoUrl('https://github.com/proffesor-for-testing/agentic-qe.git'), true);
  assert.equal(isAllowedRepoUrl('https://github.com/ruvnet/ruflo'), true);
});

test('the allowlist refuses other hosts, lookalikes and anything around the owner/repo pair', () => {
  for (const url of REFUSED_URLS) assert.equal(isAllowedRepoUrl(url), false, url);
});

test('externalSourceProblem refuses a non-github host, a lookalike, a climbing path and a short sha', () => {
  assert.equal(externalSourceProblem(source()), null);
  assert.match(externalSourceProblem(source({ url: 'https://gitlab.com/owner/repo.git' })), /github/);
  assert.match(externalSourceProblem(source({ url: 'https://github.com.evil.io/owner/repo' })), /github/);
  assert.match(externalSourceProblem(source({ url: 'https://evil.io/github.com/owner/repo' })), /github/);
  assert.match(externalSourceProblem(source({ path: 'plugins/../..' })), /path/);
  assert.match(externalSourceProblem(source({ path: '/etc' })), /path/);
  for (const path of BAD_PATHS) assert.match(externalSourceProblem(source({ path })) ?? 'accepted', /path/, path);
  assert.equal(externalSourceProblem(source({ path: 'plugins/agentic-qe-fleet' })), null);
  assert.equal(externalSourceProblem(source({ path: 'a.b/c_d-e' })), null);
  assert.match(externalSourceProblem(source({ sha: SHA.slice(0, 12) })), /sha/);
  assert.match(externalSourceProblem(source({ source: 'url' })), /git-subdir/);
});

/** Runs validate-marketplace.yml's inline validator (the `node -e "..."` block, through bash as CI does) on one entry. */
function runWorkflowValidator(entrySource) {
  const yml = readFileSync(join(REPO, '.github', 'workflows', 'validate-marketplace.yml'), 'utf8');
  const start = yml.indexOf('node -e "');
  const end = yml.indexOf('\n          "', start);
  assert.ok(start > 0 && end > start, 'found the inline validator');
  const dir = mkdtempSync(join(tmpdir(), 'validate-marketplace-'));
  try {
    mkdirSync(join(dir, '.claude-plugin'));
    const entry = { name: 'ext', source: entrySource, description: 'an external plugin' };
    writeFileSync(join(dir, '.claude-plugin', 'marketplace.json'), JSON.stringify({ name: 't', plugins: [entry] }));
    return spawnSync('bash', ['-c', yml.slice(start, end + 12)], { cwd: dir, encoding: 'utf8' });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test('validate-marketplace.yml accepts a pinned github git-subdir and refuses other hosts and lookalikes', () => {
  assert.equal(runWorkflowValidator(source()).status, 0);
  for (const url of ['https://gitlab.com/owner/repo.git', 'https://github.com.evil.io/owner/repo', 'https://evil.io/github.com/owner/repo', 'https://github.com/../repo']) {
    const r = runWorkflowValidator(source({ url }));
    assert.notEqual(r.status, 0, url);
    assert.match(r.stderr, /github\.com/, url);
  }
  for (const path of [...BAD_PATHS, 'plugins/../x']) assert.notEqual(runWorkflowValidator(source({ path })).status, 0, path);
  assert.equal(runWorkflowValidator(source({ path: 'a.b/c_d-e' })).status, 0);
  assert.notEqual(runWorkflowValidator(source({ sha: 'abc' })).status, 0);
});

/** A fake external checkout: plugins/p with a manifest and a smoke.sh that records its env and cwd under $HOME. */
function fakeCheckout(area) {
  const plugin = join(area.checkout, 'plugins', 'p');
  mkdirSync(join(plugin, '.claude-plugin'), { recursive: true });
  mkdirSync(join(plugin, 'scripts'));
  writeFileSync(join(plugin, '.claude-plugin', 'plugin.json'), JSON.stringify({ name: 'p' }));
  writeFileSync(join(plugin, 'scripts', 'smoke.sh'), 'env > "$HOME/env.txt"\npwd -P > "$HOME/cwd.txt"\nls -A > "$HOME/ls.txt"\n');
  return plugin;
}

test('an external smoke runs with a scrubbed env (no GITHUB_TOKEN, no *_TOKEN/*_KEY/*SECRET*/ACTIONS_*) and its checkout as cwd, outside the workspace', () => {
  const area = makeWorkArea();
  try {
    fakeCheckout(area);
    const parent = { PATH: process.env.PATH, LANG: 'C.UTF-8', TERM: 'xterm', CI: 'true', GITHUB_TOKEN: 'ghs_x', ACTIONS_RUNTIME_TOKEN: 'y', NPM_TOKEN: 'z', ANTHROPIC_API_KEY: 'k', MY_SECRET_VALUE: 's', GITHUB_WORKSPACE: REPO, HOME: '/root' };
    const plan = externalSmokePlan(area.checkout, area.home, 'plugins/p', 'p', parent);
    assert.ok(plan.smoke, JSON.stringify(plan));
    // Run it the way smoke-all-plugins' runSmoke does: bash <smoke> with exactly the plan's cwd and env.
    const r = spawnSync('bash', [plan.smoke], { cwd: plan.cwd, env: plan.env, encoding: 'utf8' });
    assert.equal(r.status, 0, r.stderr);
    const seen = readFileSync(join(area.home, 'env.txt'), 'utf8');
    for (const name of ['GITHUB_TOKEN', 'ACTIONS_RUNTIME_TOKEN', 'NPM_TOKEN', 'ANTHROPIC_API_KEY', 'MY_SECRET_VALUE', 'GITHUB_WORKSPACE']) {
      assert.doesNotMatch(seen, new RegExp(`^${name}=`, 'm'), name);
    }
    assert.match(seen, new RegExp(`^HOME=${area.home.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'm'));
    const cwd = readFileSync(join(area.home, 'cwd.txt'), 'utf8').trim();
    assert.equal(cwd, plan.cwd);
    assert.ok(!(cwd + sep).startsWith(REPO), `cwd ${cwd} is outside the workspace ${REPO}`);
    assert.deepEqual(readFileSync(join(area.home, 'ls.txt'), 'utf8').trim().split('\n'), ['plugins'], 'the cwd holds only the checkout');
    assert.deepEqual(Object.keys(plan.env).sort(), ['CI', 'HOME', 'LANG', 'PATH', 'TERM']);
  } finally {
    rmSync(area.dir, { recursive: true, force: true });
  }
});

test('a plugin folder that is a symlink out of the checkout is refused, and so is a smoke.sh that links out', () => {
  const area = makeWorkArea();
  const outside = mkdtempSync(join(tmpdir(), 'outside-'));
  try {
    mkdirSync(join(outside, '.claude-plugin'));
    writeFileSync(join(outside, '.claude-plugin', 'plugin.json'), JSON.stringify({ name: 'p' }));
    mkdirSync(join(area.checkout, 'plugins'));
    symlinkSync(outside, join(area.checkout, 'plugins', 'p'));
    assert.equal(realpathInside(area.checkout, join(area.checkout, 'plugins', 'p')), null);
    assert.match(externalSmokePlan(area.checkout, area.home, 'plugins/p', 'p').problem, /outside the checkout/);

    rmSync(join(area.checkout, 'plugins'), { recursive: true, force: true });
    const plugin = fakeCheckout(area);
    rmSync(join(plugin, 'scripts', 'smoke.sh'));
    writeFileSync(join(outside, 'evil.sh'), 'exit 0\n');
    symlinkSync(join(outside, 'evil.sh'), join(plugin, 'scripts', 'smoke.sh'));
    assert.match(externalSmokePlan(area.checkout, area.home, 'plugins/p', 'p').problem, /smoke\.sh resolves outside/);
  } finally {
    rmSync(area.dir, { recursive: true, force: true });
    rmSync(outside, { recursive: true, force: true });
  }
});

test('a manifest that does not carry the listed name is refused', () => {
  const area = makeWorkArea();
  try {
    fakeCheckout(area);
    assert.match(externalSmokePlan(area.checkout, area.home, 'plugins/p', 'other').problem, /does not name other/);
  } finally {
    rmSync(area.dir, { recursive: true, force: true });
  }
});
