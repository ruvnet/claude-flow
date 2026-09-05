#!/usr/bin/env node
/**
 * Regression guard for ruvnet/ruflo#2021.
 *
 * #2021 happened because a dep bump (`@claude-flow/memory` alpha.14 → 16)
 * silently invalidated witness marker `#1825`, whose marker string was
 * the literal pinned-version line in `v3/@claude-flow/cli/package.json`.
 * The change landed on main without going through a PR, so the full
 * `witness-verify` job (cross-platform, builds dist, slow) didn't gate
 * it. The scheduled 12-hour cron then filed a HIGH-severity issue.
 *
 * This smoke is a fast, build-free pre-flight that runs on EVERY push
 * and catches the same drift class:
 *
 *   - For each fix in verification/<os>/manifest.md.json
 *     (any OS — markers are OS-agnostic):
 *     - If the cited file exists on disk AND the marker string is NOT
 *       a substring of the file content, that's a marker drift.
 *     - If the cited file doesn't exist, skip (dist-not-built — that's
 *       #1880's territory, handled by witness-verify-precondition-smoke).
 *
 * Distinct from the full `witness-verify` job:
 *   - No build step (catches drift faster, fails PRs earlier).
 *   - No cryptographic signature check (drift is a markers-vs-source
 *     gap, not an integrity gap — separate concern).
 *   - Same JS, no native deps, runs in seconds on any runner.
 *
 * Fails CI if any cited+existing file is missing its marker. Exits
 * with code 1 (real failure), not 2 (precondition).
 */

import { readFileSync, existsSync } from 'node:fs';
import { resolve, join } from 'node:path';

const REPO_ROOT = resolve(process.cwd());

// Markers are platform-agnostic — verify any one of the three OS
// manifests. macOS by convention (smallest cron-skew likely, but
// any would do — the fix entries themselves are identical).
const MANIFEST_CANDIDATES = [
  'verification/macos/manifest.md.json',
  'verification/linux/manifest.md.json',
  'verification/windows/manifest.md.json',
];

let manifestPath = null;
for (const cand of MANIFEST_CANDIDATES) {
  const abs = resolve(REPO_ROOT, cand);
  if (existsSync(abs)) { manifestPath = abs; break; }
}
if (!manifestPath) {
  console.error('smoke-witness-marker-drift: no manifest found in any of:');
  for (const c of MANIFEST_CANDIDATES) console.error(`  ${c}`);
  process.exit(1);
}

const witness = JSON.parse(readFileSync(manifestPath, 'utf8'));
const fixes = witness?.manifest?.fixes ?? [];
if (fixes.length === 0) {
  console.error(`smoke-witness-marker-drift: 0 fixes in ${manifestPath} — manifest empty?`);
  process.exit(1);
}

console.log(`smoke-witness-marker-drift: scanning ${fixes.length} markers via ${manifestPath.replace(REPO_ROOT + '/', '')}\n`);

const drift = [];
const missingFile = [];
const ok = [];

for (const fix of fixes) {
  const abs = join(REPO_ROOT, fix.file);
  if (!existsSync(abs)) {
    missingFile.push(fix);
    continue;
  }
  const content = readFileSync(abs, 'utf8');
  if (!content.includes(fix.marker)) {
    drift.push(fix);
  } else {
    ok.push(fix);
  }
}

console.log(`  pass:      ${ok.length}`);
console.log(`  drifted:   ${drift.length}`);
console.log(`  file-missing (skipped — see #1880): ${missingFile.length}`);

if (drift.length > 0) {
  console.error('\nDrifted markers (cited file exists but marker string is gone):\n');
  for (const f of drift) {
    console.error(`  ${f.id}  ${f.file}`);
    console.error(`         marker: ${JSON.stringify(f.marker)}`);
    console.error(`         desc:   ${f.desc.slice(0, 100)}${f.desc.length > 100 ? '…' : ''}`);
  }
  console.error(
    `\nFix path: either restore the marker string in the cited file,\n` +
    `or update verification/<os>/manifest.md.json (edit the 'marker'\n` +
    `field for the drifted id, then run:\n\n` +
    `  node plugins/ruflo-core/scripts/witness/regen.mjs \\\n` +
    `    --manifest verification/<os>/manifest.md.json \\\n` +
    `    --history  verification/<os>/history.jsonl\n\n` +
    `…for each of macos, linux, windows. The regen re-signs the\n` +
    `manifest with the new marker. See #2021 for the full pattern.`,
  );
  process.exit(1);
}

console.log('\nsmoke-witness-marker-drift: all markers present in cited files');
