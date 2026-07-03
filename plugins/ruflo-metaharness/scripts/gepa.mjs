#!/usr/bin/env node
// gepa.mjs — surfaces the `@metaharness/darwin/gepa` LIBRARY exports.
//
// Unlike every other script in this plugin, gepa has no CLI equivalent —
// GEPA (darwin 0.8.0's genetic-evolution prompt-adaptation engine) ships as
// a library entry (`import { ... } from '@metaharness/darwin/gepa'`). This
// script wraps the subprocess-safe subset:
//
//   genome    load + validate a genome (default: the shipped cand-6 — the
//             first holdout-confirmed cheap-tier policy promotion)
//   validate  validateGenome(json) → structural errors[]
//   render    buildSystemFromGenome(genome) → the system prompt a genome
//             compiles to (inspect what a policy actually says)
//   analyze   analyzeTranscript(entries) → failure-class breakdown
//
// NOT SURFACED: `gepaOptimize` — it takes an in-process `evaluate(candidate)`
// callback ("bring your own evaluator") which cannot cross a subprocess
// boundary. Optimization runs belong either in library consumers
// (import '@metaharness/darwin/gepa' directly) or behind the darwin CLI's
// `evolve` verb (scripts/evolve.mjs), which pairs GEPA with its sandbox
// evaluators.
//
// MODULE RESOLUTION (ADR-150 graceful degradation)
// ================================================
// 1. Try bare `import('@metaharness/darwin/gepa')` — free when the optional
//    dep is installed in an ancestor node_modules.
// 2. Fall back to a ruflo-owned versioned cache install
//    (~/.ruflo/darwin-cache-<pin>) — same pattern as _redblue.mjs; the
//    versioned dir means pin bumps invalidate stale caches automatically.
// 3. Both fail → `{degraded: true}` exit 0. Never throws.
//
// EXIT CODES
//   0  op completed (or degraded)
//   1  --alert-on-invalid and validate found errors
//   2  config error (bad op / missing file)

import { readFileSync, existsSync, mkdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

// Bump in lock-step with DARWIN_PIN in _darwin.mjs + optionalDependencies.
const DARWIN_PIN_VERSION = '~0.8.0';
const CACHE_DIR = join(
  homedir(), '.ruflo', `darwin-cache-${DARWIN_PIN_VERSION.replace(/[~^]/g, '')}`,
);
const CACHED_GEPA = join(
  CACHE_DIR, 'node_modules', '@metaharness', 'darwin', 'dist', 'gepa', 'index.js',
);

const ARGS = (() => {
  const a = {
    op: null,
    path: null,        // genome JSON path (genome/validate/render); default cand-6
    transcript: null,  // transcript JSON path (analyze)
    ext: undefined,    // render — target file extension hint
    glob: undefined,   // render — target glob hint
    alertOnInvalid: false,
    format: 'json',
  };
  for (let i = 2; i < process.argv.length; i++) {
    const v = process.argv[i];
    if (v === '--op') a.op = process.argv[++i];
    else if (v === '--path') a.path = process.argv[++i];
    else if (v === '--transcript') a.transcript = process.argv[++i];
    else if (v === '--ext') a.ext = process.argv[++i];
    else if (v === '--glob') a.glob = process.argv[++i];
    else if (v === '--alert-on-invalid') a.alertOnInvalid = true;
    else if (v === '--format') a.format = process.argv[++i];
  }
  return a;
})();

function emitDegradedAndExit(reason) {
  console.log(JSON.stringify({
    degraded: true,
    reason,
    hint: 'Install with `npm i -D @metaharness/darwin@' + DARWIN_PIN_VERSION
      + '` or verify network access — the gepa entry ships inside the darwin package.',
    generatedAt: new Date().toISOString(),
  }, null, 2));
  process.exit(0);  // ADR-150 — ruflo stays operational without MetaHarness
}

async function importGepa() {
  try {
    return await import('@metaharness/darwin/gepa');
  } catch (e) {
    const msg = String(e?.message ?? e);
    // Fall back on absence AND on stale installs: a pre-0.8.0 darwin in an
    // ancestor node_modules has no './gepa' subpath, which throws
    // ERR_PACKAGE_PATH_NOT_EXPORTED rather than MODULE_NOT_FOUND.
    const recoverable = /Cannot find (module|package)|ERR_MODULE_NOT_FOUND|MODULE_NOT_FOUND|ERR_PACKAGE_PATH_NOT_EXPORTED|is not defined by "exports"/i;
    if (!recoverable.test(msg)) throw e;
  }
  // Cached-install fallback.
  if (!existsSync(CACHED_GEPA)) {
    try {
      mkdirSync(CACHE_DIR, { recursive: true });
    } catch {
      return null;
    }
    const r = spawnSync('npm', [
      'install',
      '--no-audit', '--no-fund', '--no-package-lock',
      '--prefix', CACHE_DIR,
      `@metaharness/darwin@${DARWIN_PIN_VERSION}`,
    ], {
      stdio: ['ignore', 'pipe', 'pipe'],
      encoding: 'utf-8',
      timeout: 180_000,
      shell: process.platform === 'win32',
    });
    if (r.status !== 0 || !existsSync(CACHED_GEPA)) return null;
  }
  try {
    return await import(pathToFileURL(CACHED_GEPA).href);
  } catch {
    return null;
  }
}

function readJsonFile(path, label) {
  if (!path || !existsSync(path)) {
    console.error(`gepa: ${label} file not found: ${path}`);
    process.exit(2);
  }
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch (e) {
    console.error(`gepa: ${label} is not valid JSON: ${e?.message ?? e}`);
    process.exit(2);
  }
}

function loadGenomeOrExit(gepa) {
  if (ARGS.path) {
    if (!existsSync(ARGS.path)) {
      console.error(`gepa: --path genome file not found: ${ARGS.path}`);
      process.exit(2);
    }
    // upstream signature: loadGenome(readFileSync, path) — fs injected.
    return { genome: gepa.loadGenome(readFileSync, ARGS.path), source: ARGS.path };
  }
  return { genome: gepa.loadCand6Genome(), source: gepa.CAND6_GENOME_PATH };
}

async function main() {
  const OPS = ['genome', 'validate', 'render', 'analyze'];
  if (!OPS.includes(ARGS.op)) {
    console.error(`gepa: --op must be one of ${OPS.join('|')}`);
    process.exit(2);
  }

  const gepa = await importGepa();
  if (!gepa) emitDegradedAndExit('metaharness-darwin-not-available');

  const start = Date.now();
  let out;

  if (ARGS.op === 'genome') {
    const { genome, source } = loadGenomeOrExit(gepa);
    const errors = gepa.validateGenome(genome);
    out = { op: 'genome', source, valid: errors.length === 0, errors, genome };
  } else if (ARGS.op === 'validate') {
    // validate takes raw JSON (not loadGenome) so structurally-broken files
    // reach validateGenome instead of throwing in the loader.
    const raw = ARGS.path
      ? readJsonFile(ARGS.path, '--path genome')
      : gepa.loadCand6Genome();
    const errors = gepa.validateGenome(raw);
    out = { op: 'validate', source: ARGS.path ?? gepa.CAND6_GENOME_PATH, valid: errors.length === 0, errors };
  } else if (ARGS.op === 'render') {
    const { genome, source } = loadGenomeOrExit(gepa);
    const system = gepa.buildSystemFromGenome(genome, ARGS.ext, ARGS.glob);
    out = { op: 'render', source, chars: system.length, system };
  } else {
    // analyze
    const entries = readJsonFile(ARGS.transcript, '--transcript');
    if (!Array.isArray(entries)) {
      console.error('gepa: --transcript must be a JSON array of transcript entries');
      process.exit(2);
    }
    const analysis = gepa.analyzeTranscript(entries);
    out = { op: 'analyze', source: ARGS.transcript, entries: entries.length, analysis };
  }

  out.durationMs = Date.now() - start;
  console.log(JSON.stringify(out, null, 2));

  if (ARGS.alertOnInvalid && out.valid === false) process.exit(1);
  process.exit(0);
}

main().catch((e) => {
  console.error(`gepa: ${e?.message ?? e}`);
  process.exit(2);
});
