#!/usr/bin/env node
/**
 * Package dependency overlap audit (regression guard for ruvnet/ruflo#1147 and #2018).
 *
 * Both issues are the same failure shape:
 *   `npm error Invalid Version: ` (empty) thrown by `new SemVer('')` inside
 *   `@npmcli/arborist`'s `PlaceDep.pruneDedupable → Node.canDedupe → semver.eq`.
 *
 * Root cause: a package declares the SAME dependency name in both
 * `optionalDependencies` and `peerDependencies` (typically with
 * `peerDependenciesMeta[name].optional: true`). Newer npm (>=11) trips on
 * this overlap during the dedupe pass when the dep itself has a "-dev." /
 * prerelease tagged transitive (`onnxruntime-web@1.26.0-dev.…`), producing
 * the user-facing empty-version crash.
 *
 * Fix: any name should appear in EITHER `optionalDependencies` OR as an
 * optional peer — never both. This script scans every package.json under
 * `v3/@claude-flow/*` and `v3/plugins/*` and fails on the overlap.
 *
 * Usage:
 *   node scripts/audit-package-dep-overlap.mjs            # exit 1 on any overlap
 *   node scripts/audit-package-dep-overlap.mjs --json     # machine-readable
 */

import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { join } from 'node:path';

const REPO_ROOT = process.cwd();
const SCAN_DIRS = [
  join(REPO_ROOT, 'v3', '@claude-flow'),
  join(REPO_ROOT, 'v3', 'plugins'),
];
const JSON_OUT = process.argv.includes('--json');

const issues = [];
const note = (pkg, code, message) => issues.push({ pkg, code, message });

function listPackages(root) {
  if (!existsSync(root)) return [];
  return readdirSync(root)
    .map((name) => join(root, name))
    .filter((p) => {
      try { return statSync(p).isDirectory() && existsSync(join(p, 'package.json')); }
      catch { return false; }
    });
}

let scanned = 0;
for (const root of SCAN_DIRS) {
  for (const dir of listPackages(root)) {
    const pkgPath = join(dir, 'package.json');
    let pkg;
    try { pkg = JSON.parse(readFileSync(pkgPath, 'utf-8')); }
    catch (e) { note(dir, 'PARSE', `invalid JSON: ${e.message}`); continue; }
    scanned++;
    const label = pkg.name || dir;
    const opt = pkg.optionalDependencies || {};
    const peers = pkg.peerDependencies || {};

    // --- Overlap check: same name in optionalDependencies AND peerDependencies.
    // npm 11.x arborist dedupe pass crashes with "Invalid Version: " on this
    // pattern when any transitive carries a prerelease tag — that's #1147 / #2018.
    for (const name of Object.keys(opt)) {
      if (peers[name] !== undefined) {
        note(label, 'OVERLAP',
          `"${name}" is in BOTH optionalDependencies and peerDependencies — ` +
          `npm 11.x arborist crashes with "Invalid Version: " on dedupe. ` +
          `Remove it from optionalDependencies and keep only the optional peer.`);
      }
    }
  }
}

const report = {
  scanned,
  issueCount: issues.length,
  issues,
};

if (JSON_OUT) {
  console.log(JSON.stringify(report, null, 2));
} else {
  console.log(`package dep-overlap audit — scanned ${scanned} package(s)`);
  if (issues.length === 0) {
    console.log('  ok: no optionalDependencies/peerDependencies overlaps');
  } else {
    for (const i of issues) {
      console.log(`  fail [${i.code}] ${i.pkg}: ${i.message}`);
    }
    console.log(`\n${issues.length} issue(s) — see ruvnet/ruflo#1147 and #2018 for context`);
  }
}

process.exit(issues.length > 0 ? 1 : 0);
