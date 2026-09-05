#!/usr/bin/env node
/**
 * Static guard for ruvnet/ruflo#2151 — enforce three-way version lockstep
 * across the umbrella packages that ship together:
 *
 *   - @claude-flow/cli  (v3/@claude-flow/cli/package.json)
 *   - claude-flow       (root package.json — umbrella)
 *   - ruflo             (ruflo/package.json — thin user-facing wrapper)
 *
 * Why: when these drift (e.g. ruflo@3.10.2 but cli@3.10.1, observed in
 * #2151), `npx ruflo --version` prints the bundled CLI's version (3.10.1),
 * not the wrapper's package.json version (3.10.2). Users see the "wrong"
 * version and reasonably assume the install is broken.
 *
 * The Publishing Rules in CLAUDE.md require all three to ship at the same
 * version. This audit enforces that locally so a drift can't reach a
 * release. Wired into v3-ci.yml as `umbrella-version-lockstep-audit`.
 *
 * Also asserts ruflo's @claude-flow/cli dep range INCLUDES the cli's
 * actual version (overlap with audit-wrapper-dep-ranges.mjs is intentional;
 * this audit is about identity, that one is about inclusion).
 *
 * Exit codes:
 *   0 — versions identical and dep range covers cli
 *   1 — drift detected; remediation hints printed
 */

import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import semver from 'semver';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..');

const TARGETS = [
  { label: '@claude-flow/cli', path: 'v3/@claude-flow/cli/package.json' },
  { label: 'claude-flow',       path: 'package.json' },
  { label: 'ruflo',             path: 'ruflo/package.json' },
];

function readPkg(rel) {
  const p = join(REPO_ROOT, rel);
  if (!existsSync(p)) return null;
  try { return JSON.parse(readFileSync(p, 'utf8')); }
  catch { return null; }
}

const versions = {};
const violations = [];

for (const { label, path } of TARGETS) {
  const pkg = readPkg(path);
  if (!pkg) {
    violations.push(`${label} (${path}) not found`);
    continue;
  }
  versions[label] = pkg.version;
}

console.log('umbrella-version-lockstep audit — three-package identity check');
for (const { label } of TARGETS) {
  console.log(`  ${label.padEnd(20)} ${versions[label] ?? '(missing)'}`);
}

const unique = new Set(Object.values(versions));
if (unique.size > 1) {
  violations.push(
    `version drift across umbrella packages: ${[...unique].join(' / ')}.\n` +
    `    Bump all three to the same version per CLAUDE.md "Publishing Rules" before shipping:\n` +
    `      v3/@claude-flow/cli/package.json   ← ${versions['@claude-flow/cli'] ?? '?'}\n` +
    `      package.json (claude-flow)         ← ${versions['claude-flow'] ?? '?'}\n` +
    `      ruflo/package.json                 ← ${versions['ruflo'] ?? '?'}`
  );
}

// Cross-check: ruflo's dep range must include cli's actual version.
const rufloPkg = readPkg('ruflo/package.json');
const cliVersion = versions['@claude-flow/cli'];
if (rufloPkg && cliVersion) {
  const range = rufloPkg.dependencies?.['@claude-flow/cli'];
  if (range) {
    if (!semver.satisfies(cliVersion, range, { includePrerelease: true })) {
      violations.push(
        `ruflo "@claude-flow/cli": "${range}" does NOT include cli's actual version ${cliVersion}.\n` +
        `    Update ruflo/package.json dependencies to "^${cliVersion}".`
      );
    } else {
      console.log(`  ruflo dep "@claude-flow/cli": "${range}" covers ${cliVersion} ✓`);
    }
  }
}

if (violations.length === 0) {
  console.log('\n  ok: all three umbrella packages at identical version, ruflo dep covers cli');
  process.exit(0);
}

console.error('\nviolations:');
for (const v of violations) console.error(`  ✗ ${v}`);
console.error(`\n${violations.length} violation(s).`);
console.error('Reference: ruvnet/ruflo#2151 (version mismatch — ruflo@3.10.2 + cli@3.10.1).');
process.exit(1);
