#!/usr/bin/env node
// audit-plugin-version-bump — a PR that changes a plugin's shipped files must raise that plugin's version.
//
// `/plugin marketplace update` compares the `version` in plugins/<name>/.claude-plugin/plugin.json with
// the installed copy. A fix merged without a bump (#4436 on ruflo-console, left at 0.45.1) is invisible to
// everyone who already installed that version until some later PR happens to bump it.
//
// USAGE
//   node scripts/audit-plugin-version-bump.mjs --base origin/main
//
// A plugin counts as changed when the diff `<base>...HEAD` touches a file under plugins/<name>/ that is not
// a test, a dev-only script (scripts/smoke*, scripts/test-*, scripts/bench*) or a README, CHANGELOG or docs/ file. Skills, commands
// and agents are markdown too, and they do ship, so SKILL.md and friends count. For each changed plugin that exists at both refs, the plugin.json
// version at HEAD must be greater than at base. A plugin new in this PR has nothing to compare and passes.
//
// EXIT CODES
//   0  every changed plugin raised its version
//   1  at least one changed plugin did not
//   2  usage or git error

import { execFileSync } from 'node:child_process';

const baseIdx = process.argv.indexOf('--base');
const base = baseIdx > -1 ? process.argv[baseIdx + 1] : undefined;
if (!base) {
  console.error('usage: audit-plugin-version-bump.mjs --base <git-ref>');
  process.exit(2);
}

const git = (...args) => execFileSync('git', args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });

// Paths (relative to the plugin folder) that do not reach an installed plugin's behaviour. A smoke script that hardcodes the
// expected version, or a test that pins it, is edited together with the bump and is not a reason to require one by itself.
const NON_SHIPPED = [
  /(^|\/)(tests?|docs?|__tests__)\//,
  /(^|\/)(README|CHANGELOG)[^/]*\.md$/i,
  /\.(spec|test)\.[cm]?[jt]s$/,
  /^scripts\/(smoke|test-|bench)[^/]*$/,
];

let changed;
try {
  changed = git('diff', '--name-only', `${base}...HEAD`, '--', 'plugins/').split('\n').filter(Boolean);
} catch (e) {
  console.error(`git diff against ${base} failed: ${e.message}`);
  process.exit(2);
}

const touched = new Map();
for (const file of changed) {
  const [, name, ...rest] = file.split('/');
  if (!name || rest.length === 0) continue;
  if (NON_SHIPPED.some((re) => re.test(rest.join('/')))) continue;
  if (!touched.has(name)) touched.set(name, []);
  touched.get(name).push(file);
}

const versionAt = (ref, name) => {
  try {
    return JSON.parse(git('show', `${ref}:plugins/${name}/.claude-plugin/plugin.json`)).version ?? null;
  } catch {
    return null;
  }
};

const parse = (v) => (/^(\d+)\.(\d+)\.(\d+)/.exec(v ?? '') ?? []).slice(1, 4).map(Number);
const greater = (a, b) => {
  const [x, y] = [parse(a), parse(b)];
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] > y[i];
  return false;
};

const failures = [];
for (const [name, files] of [...touched].sort()) {
  const before = versionAt(base, name);
  if (before === null) continue; // new plugin, or no manifest at base
  const after = versionAt('HEAD', name);
  if (after !== null && greater(after, before)) {
    console.log(`  OK   ${name} ${before} -> ${after}`);
  } else {
    failures.push({ name, before, after, files });
  }
}

if (failures.length === 0) {
  console.log(`audit-plugin-version-bump: ${touched.size} changed plugin(s), all raised their version`);
  process.exit(0);
}

for (const f of failures) {
  console.error(`  FAIL ${f.name}: version is ${f.after ?? 'missing'} (base ${f.before}); changed ${f.files.length} shipped file(s), e.g. ${f.files[0]}`);
}
console.error(
  '\nA changed plugin must raise "version" in its .claude-plugin/plugin.json, or installed copies never see the change.\n' +
    'Bump the patch for a fix, the minor for a feature. If this PR really ships nothing, add the label skip-plugin-version-check.'
);
process.exit(1);
