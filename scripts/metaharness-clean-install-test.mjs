#!/usr/bin/env node
// metaharness-clean-install-test — the dependency-contract acceptance gate.
//
// WHY: the MetaHarness packages were once declared only as OPTIONAL PEER
// dependencies, which npm never auto-installs — so a clean `npm install` of
// ruflo shipped with zero MetaHarness packages on disk while every advertised
// surface (`ruflo metaharness …`) assumed they might be there. The pin watcher
// missed it because it never looked at peerDependencies. This script closes
// the loop end-to-end: it installs the EXACT ranges v3/@claude-flow/cli
// declares into a pristine temp project (no repo node_modules in scope), then
// imports each package and asserts the advertised symbol contract.
//
// USAGE
//   node scripts/metaharness-clean-install-test.mjs            # human output
//   node scripts/metaharness-clean-install-test.mjs --format json
//
// EXIT CODES
//   0  every declared installable pin installs cleanly and exports its contract
//   1  a pin is missing from optionalDependencies, fails to install, or is
//      missing an advertised export
//   2  unexpected error (temp-dir creation, package.json unreadable, …)

import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const CLI_PKG = join(HERE, '..', 'v3', '@claude-flow', 'cli', 'package.json');
const FORMAT = process.argv.includes('--format') && process.argv[process.argv.indexOf('--format') + 1] === 'json' ? 'json' : 'table';

// Advertised symbol contract per package — verified against the real published
// artifacts (darwin 0.9.0 / flywheel 0.1.10 / radio 0.1.0 / turn-credit 0.1.0).
// Keep in sync with the --require-installed check in check-metaharness-pins.mjs.
const API_CONTRACT = {
  '@metaharness/darwin': ['evolve', 'RefineMutator', 'summarizeFailedTraces'],
  '@metaharness/flywheel': ['runFlywheelGenerations', 'meetsPromotionRule', 'makeSigner', 'verifyReplayBundle', 'sequentialEvidence', 'withSequentialEvidence'],
  '@metaharness/radio': ['RadioBus', 'runProtocol', 'runSim'],
  '@metaharness/turn-credit': ['processTrajectory', 'creditByLabel', 'evidenceFromLogProbs', 'buildCreditReceiptPayload'],
};

async function main() {
  const pkg = JSON.parse(readFileSync(CLI_PKG, 'utf-8'));
  const results = [];
  let failed = false;

  const specs = [];
  for (const name of Object.keys(API_CONTRACT)) {
    const range = pkg.optionalDependencies?.[name];
    if (!range) {
      results.push({ name, status: 'FAIL', note: 'not declared in optionalDependencies — a clean install never materializes it' });
      failed = true;
      continue;
    }
    specs.push({ name, range });
  }

  let workDir = null;
  if (specs.length) {
    workDir = mkdtempSync(join(tmpdir(), 'ruflo-mh-clean-install-'));
    writeFileSync(join(workDir, 'package.json'), JSON.stringify({ name: 'mh-clean-install-probe', private: true, type: 'module' }, null, 2));
    try {
      execFileSync('npm', [
        'install', '--no-audit', '--no-fund', '--no-save',
        ...specs.map((s) => `${s.name}@${s.range}`),
      ], { cwd: workDir, stdio: 'pipe', timeout: 300_000 });
    } catch (error) {
      for (const s of specs) results.push({ name: s.name, range: s.range, status: 'FAIL', note: `npm install failed: ${String(error.message).slice(0, 200)}` });
      failed = true;
      specs.length = 0;
    }
  }

  for (const s of specs) {
    try {
      const mod = await import(pathToFileURL(join(workDir, 'node_modules', s.name, 'dist', 'index.js')).href);
      const missing = API_CONTRACT[s.name].filter((sym) => typeof mod[sym] !== 'function');
      if (missing.length) {
        results.push({ name: s.name, range: s.range, status: 'FAIL', note: `missing exports: ${missing.join(', ')}` });
        failed = true;
      } else {
        results.push({ name: s.name, range: s.range, status: 'PASS', note: `${API_CONTRACT[s.name].length} advertised exports present` });
      }
    } catch (error) {
      results.push({ name: s.name, range: s.range, status: 'FAIL', note: `import failed: ${String(error.message).slice(0, 200)}` });
      failed = true;
    }
  }

  if (workDir) { try { rmSync(workDir, { recursive: true, force: true }); } catch { /* best-effort */ } }

  if (FORMAT === 'json') {
    console.log(JSON.stringify({ generatedAt: new Date().toISOString(), pass: !failed, results }, null, 2));
  } else {
    console.log('# metaharness-clean-install-test\n');
    console.log('| Package | Declared range | Status | Note |');
    console.log('|---|---|---|---|');
    for (const r of results) console.log(`| ${r.name} | ${r.range ?? '—'} | ${r.status} | ${r.note} |`);
    console.log('');
    console.log(failed
      ? '✗ Clean-install contract BROKEN — an advertised MetaHarness surface would degrade on a fresh install.'
      : '✓ Every advertised MetaHarness package installs from a clean directory and exports its contract.');
  }
  process.exit(failed ? 1 : 0);
}

main().catch((e) => { console.error('metaharness-clean-install-test crashed:', e?.message || e); process.exit(2); });
