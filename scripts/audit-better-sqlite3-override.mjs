#!/usr/bin/env node
/**
 * Static guard for ruvnet/ruflo#2219 — keep the `better-sqlite3` override
 * pinned to a version that ships Node 24/25/26 prebuilds.
 *
 * Why: `agentdb` declares `better-sqlite3` as an OPTIONAL dependency at
 * `^11.8.1`. better-sqlite3 11.8.1 has no prebuilt binary for Node 24/25/26,
 * so on those runtimes the optional native build fails *silently* (optional
 * deps never error) and AgentDB falls back to a non-persistent backend —
 * users on Node 24/26 saw stores succeed but never persist (silent write
 * loss). better-sqlite3 >=12.8.0 ships prebuilds for Node 20–26.
 *
 * Per the #2112 lesson, root overrides do NOT propagate to the published
 * `ruflo` wrapper — the override MUST be present in BOTH the root umbrella
 * (`package.json`) and the wrapper (`ruflo/package.json`). This guard asserts
 * both carry `better-sqlite3 >= 12.8.0`. Wired into v3-ci.yml.
 *
 * Exit codes:
 *   0 — both overrides present and satisfy >=12.8.0
 *   1 — missing override, or a range that admits a Node-24/26-broken version
 */

import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import semver from 'semver';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..');

// The floor that has Node 24/25/26 prebuilds. Any override that could resolve
// below this re-opens the silent-write-loss on new Node majors.
const MIN_SAFE = '12.8.0';

const TARGETS = [
  { label: 'claude-flow (root umbrella)', path: 'package.json' },
  { label: 'ruflo (published wrapper)', path: 'ruflo/package.json' },
];

let failed = false;

for (const { label, path: rel } of TARGETS) {
  const p = join(REPO_ROOT, rel);
  if (!existsSync(p)) {
    console.error(`✗ ${label}: ${rel} not found`);
    failed = true;
    continue;
  }
  let pkg;
  try {
    pkg = JSON.parse(readFileSync(p, 'utf8'));
  } catch (e) {
    console.error(`✗ ${label}: ${rel} is not valid JSON — ${e.message}`);
    failed = true;
    continue;
  }

  const range = pkg.overrides?.['better-sqlite3'];
  if (!range) {
    console.error(
      `✗ ${label}: missing overrides["better-sqlite3"]. ` +
        `Add "better-sqlite3": ">=${MIN_SAFE}" so agentdb's optional native ` +
        `dep resolves to a version with Node 24/25/26 prebuilds (#2219).`,
    );
    failed = true;
    continue;
  }

  // The minimum version the range can resolve to must be >= MIN_SAFE, so the
  // override can never drop back to a Node-24/26-broken better-sqlite3.
  const minOfRange = semver.minVersion(range);
  if (!minOfRange || semver.lt(minOfRange, MIN_SAFE)) {
    console.error(
      `✗ ${label}: overrides["better-sqlite3"] = "${range}" can resolve below ` +
        `${MIN_SAFE} (min ${minOfRange ?? 'unparseable'}). Node 24/25/26 need ` +
        `>=${MIN_SAFE} prebuilds (#2219).`,
    );
    failed = true;
    continue;
  }

  console.log(`✓ ${label}: better-sqlite3 override "${range}" (min ${minOfRange}) ≥ ${MIN_SAFE}`);
}

if (failed) {
  console.error('\nbetter-sqlite3 override guard FAILED (#2219). See messages above.');
  process.exit(1);
}
console.log('\n✓ better-sqlite3 override guard passed — Node 24/25/26 persistence protected.');
process.exit(0);
