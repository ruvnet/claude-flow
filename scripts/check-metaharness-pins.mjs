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
// Checked pins (single source of truth = v3/@claude-flow/cli/package.json).
// Each pin is looked up across dependencies, optionalDependencies, AND
// peerDependencies — an earlier revision searched only the first two, so pins
// moved to (optional) peerDependencies silently vanished from the watcher
// ('undeclared' was not treated as drift). Both failure modes are now fatal:
//   - undeclared: the pin is missing from every dependency block
//   - peer-only for an installable pin: darwin / flywheel / radio are
//     advertised integration surfaces and MUST live in optionalDependencies so
//     a clean `npm install` actually materializes them; an optional PEER
//     dependency is never auto-installed, which is how a fresh ruflo install
//     shipped with zero MetaHarness packages on disk.
//   - metaharness              — the umbrella / MCP subprocess CLI (npx path; peer ok)
//   - @metaharness/router      — neural-router.ts dynamic import (peer ok — triple-gated)
//   - @metaharness/darwin      — Darwin evolve / GEPA subprocess (must be installable)
//   - @metaharness/flywheel    — receipt/gate interop (must be installable)
//   - @metaharness/radio       — coordination-policy optimizer (must be installable)
//   - @metaharness/turn-credit — recursive turn-level credit assignment, ADR-248 (must be installable)
// Plus a lock-step check: the MH_DARWIN_PIN constant in distill-oracle.ts (used
// for the Tier-1 oracle's `npx @metaharness/darwin@<pin>` calls) must satisfy
// the declared @metaharness/darwin range, so the two can't drift apart.
//
// Plus the ruflo-metaharness PLUGIN helper pins (#3366). The metaharness_* MCP
// tools never read package.json: each helper in plugins/ruflo-metaharness/
// scripts/ carries its own tilde range, and that range alone decides which
// INSTALLED copy the helper accepts (_invoke.findLocalPackageDir) and what it
// npm-installs at tool-call time when no copy qualifies (ensureCachedInstall).
// This watcher used to compare only the CLI's declared ranges, so the helper
// pins drifted unseen (_harness.mjs ~0.3.0 vs declared ^0.4.1; _darwin.mjs
// ~0.8.0 vs declared ~0.10.2) and every tool call re-downloaded an older
// release while the one ruflo shipped sat unused on disk. Rules:
//   - the helper pin must be `~X.Y.Z` — _invoke.satisfiesTildeRange(), the
//     predicate the helpers actually apply, parses nothing else, so a `^` or
//     exact pin rejects every installed copy even though covers() below would
//     call it green
//   - package declared by the CLI  → the helper range must COVER the declared
//     range (accept every version a clean install can put on disk); offline-safe
//   - package not declared (redblue) → the helper range must admit npm latest
//   - constant not found in the helper → fatal (the watcher cannot protect a
//     pin it cannot read — same stance as UNDECLARED above)
//
// USAGE
//   node scripts/check-metaharness-pins.mjs                 # exits 1 if any pin is stale
//   node scripts/check-metaharness-pins.mjs --format json   # CI/issue-body consumable
//   node scripts/check-metaharness-pins.mjs --offline       # skip npm, only lock-step check
//
// EXIT CODES
//   0  every pin's range admits npm latest (and the darwin constant is in range,
//      and every plugin helper pin covers its declared range)
//   1  at least one pin is behind (range excludes latest) OR constant out of range
//      OR a plugin helper pin no longer covers its declared range / is not a
//      tilde range / is unreadable
//   2  unexpected error (network flake surfaces as a warning, NOT a false drift)

import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, '..');
const CLI_PKG = join(REPO, 'v3', '@claude-flow', 'cli', 'package.json');
const DISTILL = join(REPO, 'v3', '@claude-flow', 'cli', 'src', 'services', 'distill-oracle.ts');
const PLUGIN_SCRIPTS = join(REPO, 'plugins', 'ruflo-metaharness', 'scripts');
// The plugin helper constants that pick what the metaharness_* tools run.
const PLUGIN_PINS = [
  { name: 'metaharness', file: '_harness.mjs', constant: 'METAHARNESS_PIN_VERSION' },
  { name: '@metaharness/darwin', file: '_darwin.mjs', constant: 'DARWIN_PIN_VERSION' },
  { name: '@metaharness/redblue', file: '_redblue.mjs', constant: 'REDBLUE_PIN_VERSION' },
];

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

/** Half-open [lo, hi) bounds of the caret/tilde/exact forms ruflo uses; null if unparseable. */
function bounds(range) {
  const op = range[0] === '^' || range[0] === '~' ? range[0] : '=';
  const lo = parseVer(op === '=' ? range : range.slice(1));
  if (!lo) return null;
  // Upper bound: caret locks the left-most non-zero component; tilde locks minor.
  let hi;
  if (op === '=') hi = [lo[0], lo[1], lo[2] + 1];
  else if (op === '^') hi = lo[0] > 0 ? [lo[0] + 1, 0, 0] : lo[1] > 0 ? [0, lo[1] + 1, 0] : [0, 0, lo[2] + 1];
  else hi = [lo[0], lo[1] + 1, 0]; // ~
  return { lo, hi };
}

/** Does `latest` satisfy `range`? Supports the caret/tilde/exact forms ruflo uses. */
function satisfies(range, latest) {
  const lv = parseVer(latest);
  const b = bounds(range);
  if (!lv || !b) return null;
  return cmp(lv, b.lo) >= 0 && cmp(lv, b.hi) < 0;
}

/** Does `outer` admit every version `inner` admits? (plugin helper pin vs declared range) */
function covers(outer, inner) {
  const o = bounds(outer);
  const i = bounds(inner);
  if (!o || !i) return null;
  return cmp(o.lo, i.lo) <= 0 && cmp(i.hi, o.hi) <= 0;
}
function cmp(a, b) { for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] - b[i]; return 0; }

function npmLatest(pkg) {
  const out = execFileSync('npm', ['view', pkg, 'version'], { encoding: 'utf-8', stdio: ['ignore', 'pipe', 'ignore'] });
  return out.trim();
}

/** Find a package's declared range across every dependency block, in priority order. */
function declaredRange(pkg, name) {
  for (const where of ['dependencies', 'optionalDependencies', 'peerDependencies']) {
    const range = pkg[where]?.[name];
    if (range) return { range, where };
  }
  return { range: undefined, where: null };
}

async function main() {
  const pkg = JSON.parse(readFileSync(CLI_PKG, 'utf-8'));
  // installable: true ⇒ the package must be declared in `dependencies` or
  // `optionalDependencies` (something npm actually installs); a peer-only
  // declaration is a contract break, because optional peers never materialize
  // on a clean install.
  const WATCHED = [
    { name: 'metaharness', installable: false },
    { name: '@metaharness/router', installable: false },
    { name: '@metaharness/darwin', installable: true },
    { name: '@metaharness/flywheel', installable: true },
    { name: '@metaharness/radio', installable: true },
    { name: '@metaharness/turn-credit', installable: true },
  ];
  const pins = WATCHED.map((w) => ({ ...w, ...declaredRange(pkg, w.name) }));

  const rows = [];
  for (const p of pins) {
    if (!p.range) { rows.push({ ...p, status: 'UNDECLARED', latest: null, note: 'pin not found in any dependency block — the watcher cannot protect an undeclared pin' }); continue; }
    if (p.installable && p.where === 'peerDependencies') {
      rows.push({ ...p, status: 'PEER-ONLY', latest: null, note: 'declared only as a peer — never installed by a clean `npm install`; move to optionalDependencies' });
      continue;
    }
    if (ARGS.offline) { rows.push({ ...p, status: 'skipped', latest: null, note: 'offline mode' }); continue; }
    let latest;
    try { latest = npmLatest(p.name); }
    catch { rows.push({ ...p, status: 'unknown', latest: null, note: 'npm view failed (network?) — not treated as drift' }); continue; }
    const ok = satisfies(p.range, latest);
    rows.push({ ...p, latest, status: ok === false ? 'STALE' : ok === true ? 'current' : 'unparseable' });
  }

  // Lock-step: MH_DARWIN_PIN constant must satisfy the declared darwin range.
  let constRow = { name: 'MH_DARWIN_PIN (distill-oracle.ts)', pin: null, declared: declaredRange(pkg, '@metaharness/darwin').range ?? null, status: 'UNREADABLE' };
  try {
    const m = readFileSync(DISTILL, 'utf-8').match(/MH_DARWIN_PIN\s*=\s*['"]([^'"]+)['"]/);
    const declared = declaredRange(pkg, '@metaharness/darwin').range;
    if (m && declared) {
      const inRange = satisfies(declared, m[1]);
      constRow = { name: 'MH_DARWIN_PIN (distill-oracle.ts)', pin: m[1], declared, status: inRange === false ? 'OUT-OF-RANGE' : inRange === true ? 'in-range' : 'unparseable' };
    }
  } catch { /* non-fatal */ }

  // Plugin helper pins (#3366): what the metaharness_* tools actually resolve
  // and install. Declared by the CLI → must cover the declared range (no
  // network needed); otherwise → must admit npm latest, like the rows above.
  const pluginRows = [];
  for (const p of PLUGIN_PINS) {
    const row = { name: `${p.constant} (plugins/ruflo-metaharness/scripts/${p.file})`, package: p.name, pin: null, declared: null };
    try {
      const m = readFileSync(join(PLUGIN_SCRIPTS, p.file), 'utf-8').match(new RegExp(`${p.constant}\\s*=\\s*['"]([^'"]+)['"]`));
      if (m) row.pin = m[1];
    } catch { /* unreadable — reported below */ }
    if (!row.pin) { pluginRows.push({ ...row, status: 'UNREADABLE', note: `${p.constant} not found in ${p.file} — the watcher cannot protect a pin it cannot read` }); continue; }
    // The helpers match installed copies with _invoke.satisfiesTildeRange(),
    // which parses ONLY `~X.Y.Z` and returns false for everything else. A
    // `^`/exact/`latest` pin would therefore reject every installed copy and
    // npm-install on each call, while covers()/satisfies() below — which do
    // understand those forms — reported the row green. Fail closed instead.
    if (!/^~\d+\.\d+\.\d+$/.test(row.pin)) {
      pluginRows.push({ ...row, status: 'NOT-TILDE', note: `${row.pin} is not \`~X.Y.Z\`; _invoke.satisfiesTildeRange() accepts no other form, so every installed copy would be rejected` });
      continue;
    }
    row.declared = declaredRange(pkg, p.name).range ?? null;
    if (row.declared) {
      const ok = covers(row.pin, row.declared);
      pluginRows.push({ ...row, status: ok === false ? 'NOT-COVERED' : ok === true ? 'covers' : 'unparseable' });
      continue;
    }
    if (ARGS.offline) { pluginRows.push({ ...row, status: 'skipped', note: 'not declared by the CLI; offline mode' }); continue; }
    let latest;
    try { latest = npmLatest(p.name); }
    catch { pluginRows.push({ ...row, status: 'unknown', note: 'npm view failed (network?) — not treated as drift' }); continue; }
    const ok = satisfies(row.pin, latest);
    pluginRows.push({ ...row, latest, status: ok === false ? 'STALE' : ok === true ? 'current' : 'unparseable' });
  }
  const pluginBad = pluginRows.filter((r) => ['NOT-COVERED', 'NOT-TILDE', 'UNREADABLE', 'STALE', 'unparseable'].includes(r.status));

  const stale = rows.filter((r) => r.status === 'STALE' || r.status === 'UNDECLARED' || r.status === 'PEER-ONLY');
  const constBad = constRow.status !== 'in-range';
  const apiErrors = [];
  if (ARGS.requireInstalled) {
    const cliDir = dirname(CLI_PKG);
    // Advertised symbol contract per package — verified against the real
    // published artifacts (darwin 0.9.0 / flywheel 0.1.10 / radio 0.1.0 / turn-credit 0.1.0).
    const API_CONTRACT = {
      '@metaharness/darwin': ['evolve', 'RefineMutator', 'summarizeFailedTraces'],
      '@metaharness/flywheel': ['runFlywheelGenerations', 'meetsPromotionRule', 'makeSigner', 'verifyReplayBundle', 'sequentialEvidence', 'withSequentialEvidence'],
      '@metaharness/radio': ['RadioBus', 'runProtocol', 'runSim'],
      // PAPER_DEFAULTS/GOVERNED_DEFAULTS are exported consts, not functions —
      // excluded here since this contract only asserts `typeof === 'function'`.
      '@metaharness/turn-credit': ['processTrajectory', 'creditByLabel', 'evidenceFromLogProbs', 'buildCreditReceiptPayload'],
    };
    for (const [pkgName, symbols] of Object.entries(API_CONTRACT)) {
      try {
        const mod = await import(pathToFileURL(join(cliDir, 'node_modules', pkgName, 'dist/index.js')).href);
        for (const symbol of symbols) {
          if (typeof mod[symbol] !== 'function') apiErrors.push(`${pkgName} must export ${symbol}`);
        }
      } catch (error) {
        apiErrors.push(`${pkgName} import failed: ${error.message}`);
      }
    }
  }
  const drift = stale.length > 0 || constBad || pluginBad.length > 0 || apiErrors.length > 0;
  const payload = {
    generatedAt: new Date().toISOString(),
    drift,
    pins: rows,
    constCheck: constRow,
    pluginPins: pluginRows,
    installedApiChecked: ARGS.requireInstalled,
    apiErrors,
  };

  if (ARGS.format === 'json') {
    console.log(JSON.stringify(payload, null, 2));
  } else {
    console.log('# check-metaharness-pins\n');
    console.log('| Package | Declared | Where | npm latest | Status |');
    console.log('|---|---|---|---|---|');
    for (const r of rows) console.log(`| ${r.name} | ${r.range ?? '—'} | ${r.where ?? '—'} | ${r.latest ?? '—'} | ${r.status} |`);
    if (constRow) console.log(`| ${constRow.name} | =${constRow.pin} (vs ${constRow.declared}) | — | — | ${constRow.status} |`);
    for (const r of pluginRows) console.log(`| ${r.name} | ${r.pin ?? '—'}${r.declared ? ` (vs ${r.declared})` : ''} | plugin | ${r.latest ?? '—'} | ${r.status} |`);
    if (ARGS.requireInstalled) console.log(`\nInstalled API check: ${apiErrors.length ? `FAIL — ${apiErrors.join('; ')}` : 'PASS'}`);
    console.log('');
    if (drift) {
      console.log('⚠ **Pin drift detected.** A metaharness pin is stale, undeclared, declared peer-only, or a plugin helper pin no longer covers it (or is not a `~X.Y.Z` range).');
      console.log('Fix the declaration in v3/@claude-flow/cli/package.json (installable pins belong in optionalDependencies;');
      console.log('bump MH_DARWIN_PIN if darwin moved, and the *_PIN_VERSION constants in plugins/ruflo-metaharness/scripts/), then re-run.');
    } else {
      console.log('✓ All metaharness pins are declared installably and admit the current npm `latest`; plugin helper pins cover them.');
    }
  }
  process.exit(drift ? 1 : 0);
}

main().catch((e) => { console.error('check-metaharness-pins crashed:', e?.message || e); process.exit(2); });
