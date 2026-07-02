#!/usr/bin/env node
// Sync the npm `overrides` blocks of /package.json and /ruflo/package.json
// from the single source of truth in /config/overrides.json (ADR-171).
//
//   node scripts/sync-overrides.mjs          # write both blocks
//   node scripts/sync-overrides.mjs --check  # exit 1 if either block drifts
//
// Reminder: overrides only apply to the root package of an install, so these
// blocks govern development installs inside this repo — consumer-facing CVE
// floors must be real dependency-range bumps in the owning packages.
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const sourcePath = join(repoRoot, 'config', 'overrides.json');
const targets = [
  join(repoRoot, 'package.json'),
  join(repoRoot, 'ruflo', 'package.json'),
];

const { overrides } = JSON.parse(readFileSync(sourcePath, 'utf-8'));
if (!overrides || typeof overrides !== 'object') {
  console.error(`No "overrides" object in ${sourcePath}`);
  process.exit(2);
}

const checkOnly = process.argv.includes('--check');
let drifted = 0;

for (const target of targets) {
  const raw = readFileSync(target, 'utf-8');
  const pkg = JSON.parse(raw);
  const current = JSON.stringify(pkg.overrides ?? {});
  const wanted = JSON.stringify(overrides);
  if (current === wanted) continue;
  drifted++;
  if (checkOnly) {
    const cur = pkg.overrides ?? {};
    const keys = new Set([...Object.keys(cur), ...Object.keys(overrides)]);
    for (const k of keys) {
      if (cur[k] !== overrides[k]) {
        console.error(`  ${target}: "${k}": ${JSON.stringify(cur[k])} -> ${JSON.stringify(overrides[k])}`);
      }
    }
  } else {
    pkg.overrides = overrides;
    const trailingNewline = raw.endsWith('\n') ? '\n' : '';
    writeFileSync(target, JSON.stringify(pkg, null, 2) + trailingNewline);
    console.log(`synced ${target}`);
  }
}

if (checkOnly && drifted) {
  console.error(`overrides drift in ${drifted} file(s) — run: node scripts/sync-overrides.mjs`);
  process.exit(1);
}
console.log(checkOnly ? 'overrides in sync' : `done (${drifted} file(s) updated)`);
