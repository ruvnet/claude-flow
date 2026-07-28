#!/usr/bin/env node
// check-metaharness-pins — pin-drift watcher for ruflo's metaharness deps.
//
// WHY: a version pin that was correct at publish time silently rots when the
// upstream ships a new release the pin's range excludes. This is the failure
// mode reported upstream in agent-harness-generator#142 (`@metaharness/darwin`
// caret-locked to 0.2.x, three majors behind) and #149 (META_PROXY_VERSION
// pinned, three releases behind, with no watcher). Ruflo pins three metaharness
// packages; this script diffs each declared range against npm `latest` and
// flags any pin whose range no longer admits the current release.
//
// Checked pins (single source of truth = v3/@claude-flow/cli/package.json):
//   - metaharness            (dependencies)          — the umbrella / MCP subprocess CLI
//   - @metaharness/router    (dependencies)          — neural-router.ts dynamic import
//   - @metaharness/darwin    (optionalDependencies)  — Darwin evolve / GEPA subprocess
// Plus a lock-step check: the MH_DARWIN_PIN constant in distill-oracle.ts (used
// for the Tier-1 oracle's `npx @metaharness/darwin@<pin>` calls) must satisfy
// the declared @metaharness/darwin range, so the two can't drift apart.
//
// USAGE
//   node scripts/check-metaharness-pins.mjs                 # exits 1 if any pin is stale
//   node scripts/check-metaharness-pins.mjs --format json   # CI/issue-body consumable
//   node scripts/check-metaharness-pins.mjs --offline       # skip npm, only lock-step check
//
// EXIT CODES
//   0  every pin's range admits npm latest (and the darwin constant is in range)
//   1  at least one pin is behind (range excludes latest) OR constant out of range
//   2  unexpected error (network flake surfaces as a warning, NOT a false drift)

import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, '..');
const CLI_PKG = join(REPO, 'v3', '@claude-flow', 'cli', 'package.json');
const DISTILL = join(REPO, 'v3', '@claude-flow', 'cli', 'src', 'services', 'distill-oracle.ts');

const ARGS = { format: 'table', offline: false, requireInstalled: false };
for (let i = 2; i < process.argv.length; i++) {
  if (process.argv[i] === '--format') ARGS.format = process.argv[++i];
  else if (process.argv[i] === '--offline') ARGS.offline = true;
  else if (process.argv[i] === '--require-installed') ARGS.requireInstalled = true;
}

/** Parse "1.2.3" → [1,2,3]; tolerant of pre-release/build suffixes. */
function parseVer(v) {
  const m = String(v).trim().replace(/^v/, '').match(/^(\d+)\.(\d+)\.(\d+)/);
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
}

/** Does `latest` satisfy `range`? Supports the caret/tilde/exact forms ruflo uses. */
function satisfies(range, latest) {
  const lv = parseVer(latest);
  if (!lv) return null;
  const op = range[0] === '^' || range[0] === '~' ? range[0] : '=';
  const bv = parseVer(op === '=' ? range : range.slice(1));
  if (!bv) return null;
  const gte = cmp(lv, bv) >= 0;
  if (!gte) return false;
  if (op === '=') return cmp(lv, bv) === 0;
  // Upper bound: caret locks the left-most non-zero component; tilde locks minor.
  let hi;
  if (op === '^') hi = bv[0] > 0 ? [bv[0] + 1, 0, 0] : bv[1] > 0 ? [0, bv[1] + 1, 0] : [0, 0, bv[2] + 1];
  else hi = [bv[0], bv[1] + 1, 0]; // ~
  return cmp(lv, hi) < 0;
}
function cmp(a, b) { for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] - b[i]; return 0; }

function npmLatest(pkg) {
  const out = execFileSync('npm', ['view', pkg, 'version'], { encoding: 'utf-8', stdio: ['ignore', 'pipe', 'ignore'] });
  return out.trim();
}

async function main() {
  const pkg = JSON.parse(readFileSync(CLI_PKG, 'utf-8'));
  const pins = [
    { name: 'metaharness', range: pkg.dependencies?.metaharness, where: 'dependencies' },
    { name: '@metaharness/router', range: pkg.dependencies?.['@metaharness/router'], where: 'dependencies' },
    { name: '@metaharness/darwin', range: pkg.optionalDependencies?.['@metaharness/darwin'], where: 'optionalDependencies' },
    { name: '@metaharness/flywheel', range: pkg.optionalDependencies?.['@metaharness/flywheel'], where: 'optionalDependencies' },
  ];

  const rows = [];
  for (const p of pins) {
    if (!p.range) { rows.push({ ...p, status: 'undeclared', latest: null, note: 'pin not found in package.json' }); continue; }
    if (ARGS.offline) { rows.push({ ...p, status: 'skipped', latest: null, note: 'offline mode' }); continue; }
    let latest;
    try { latest = npmLatest(p.name); }
    catch { rows.push({ ...p, status: 'unknown', latest: null, note: 'npm view failed (network?) — not treated as drift' }); continue; }
    const ok = satisfies(p.range, latest);
    rows.push({ ...p, latest, status: ok === false ? 'STALE' : ok === true ? 'current' : 'unparseable' });
  }

  // Lock-step: MH_DARWIN_PIN constant must satisfy the declared darwin range.
  let constRow = null;
  try {
    const m = readFileSync(DISTILL, 'utf-8').match(/MH_DARWIN_PIN\s*=\s*['"]([^'"]+)['"]/);
    const declared = pkg.optionalDependencies?.['@metaharness/darwin'];
    if (m && declared) {
      const inRange = satisfies(declared, m[1]);
      constRow = { name: 'MH_DARWIN_PIN (distill-oracle.ts)', pin: m[1], declared, status: inRange === false ? 'OUT-OF-RANGE' : 'in-range' };
    }
  } catch { /* non-fatal */ }

  const stale = rows.filter((r) => r.status === 'STALE');
  const constBad = constRow && constRow.status === 'OUT-OF-RANGE';
  const apiErrors = [];
  if (ARGS.requireInstalled) {
    const cliDir = dirname(CLI_PKG);
    try {
      const darwin = await import(pathToFileURL(join(cliDir, 'node_modules/@metaharness/darwin/dist/index.js')).href);
      if (typeof darwin.evolve !== 'function') apiErrors.push('@metaharness/darwin must export evolve');
    } catch (error) {
      apiErrors.push(`@metaharness/darwin import failed: ${error.message}`);
    }
    try {
      const flywheel = await import(pathToFileURL(join(cliDir, 'node_modules/@metaharness/flywheel/dist/index.js')).href);
      for (const symbol of ['runFlywheelGenerations', 'meetsPromotionRule', 'makeSigner', 'verifyReplayBundle']) {
        if (typeof flywheel[symbol] !== 'function') apiErrors.push(`@metaharness/flywheel must export ${symbol}`);
      }
    } catch (error) {
      apiErrors.push(`@metaharness/flywheel import failed: ${error.message}`);
    }
  }
  const drift = stale.length > 0 || constBad || apiErrors.length > 0;
  const payload = {
    generatedAt: new Date().toISOString(),
    drift,
    pins: rows,
    constCheck: constRow,
    installedApiChecked: ARGS.requireInstalled,
    apiErrors,
  };

  if (ARGS.format === 'json') {
    console.log(JSON.stringify(payload, null, 2));
  } else {
    console.log('# check-metaharness-pins\n');
    console.log('| Package | Declared | npm latest | Status |');
    console.log('|---|---|---|---|');
    for (const r of rows) console.log(`| ${r.name} | ${r.range ?? '—'} | ${r.latest ?? '—'} | ${r.status} |`);
    if (constRow) console.log(`| ${constRow.name} | =${constRow.pin} (vs ${constRow.declared}) | — | ${constRow.status} |`);
    if (ARGS.requireInstalled) console.log(`\nInstalled API check: ${apiErrors.length ? `FAIL — ${apiErrors.join('; ')}` : 'PASS'}`);
    console.log('');
    if (drift) {
      console.log('⚠ **Pin drift detected.** One or more metaharness pins no longer admit the current npm release.');
      console.log('Bump the range in v3/@claude-flow/cli/package.json (and MH_DARWIN_PIN if darwin moved), then re-run.');
    } else {
      console.log('✓ All metaharness pins admit the current npm `latest`.');
    }
  }
  process.exit(drift ? 1 : 0);
}

main().catch((e) => { console.error('check-metaharness-pins crashed:', e?.message || e); process.exit(2); });
