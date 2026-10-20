#!/usr/bin/env node
/**
 * Live-registry guard for ruvnet/ruflo#4303.
 *
 * audit-wrapper-dep-ranges.mjs and audit-leaf-package-publish.mjs both check
 * INTERNAL consistency: does the CLI's pinned range for a non-bundled
 * @claude-flow/* leaf cover that leaf's own workspace package.json version?
 * Neither ever asks npm whether the version they agree on was actually
 * published.
 *
 * #4279 bumped @claude-flow/memory to 3.0.6 in the workspace and pinned the
 * CLI to 3.0.6 to match — both audits above passed, because workspace and
 * pin agreed with each other. Nobody ran `npm publish` for the memory leaf.
 * @claude-flow/cli@3.57.2 shipped depending on a version of memory that did
 * not exist on the registry, so every fresh `npm install` of that line
 * failed with ETARGET (#4303).
 *
 * This asserts, against the live npm registry, that the exact version (or,
 * for a range, at least one satisfying version) each non-bundled leaf
 * resolves to is actually published.
 *
 * Usage: node scripts/audit-leaf-versions-published.mjs
 * Exit codes: 0 ok / 1 violations, a registry query failure, or the guard
 * inspected nothing. A query failure is NOT treated as a pass — "couldn't
 * prove it's safe" must block the same as "proved it's broken".
 */

import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import https from 'node:https';
import semver from 'semver';

import { INTERNAL_RUNTIME_PACKAGES } from './stage-internal-runtime-bundles.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..');
const CLI_PKG = 'v3/@claude-flow/cli/package.json';

function readJson(rel) {
  const p = join(REPO_ROOT, rel);
  return existsSync(p) ? JSON.parse(readFileSync(p, 'utf8')) : null;
}

export function fetchJson(url, { timeoutMs = 15000 } = {}) {
  return new Promise((resolvePromise, reject) => {
    const req = https.get(url, { headers: { accept: 'application/json' } }, (res) => {
      let data = '';
      res.on('data', (c) => { data += c; });
      res.on('end', () => {
        if (res.statusCode === 404) return resolvePromise({ notFound: true });
        if (res.statusCode && res.statusCode >= 400) {
          return reject(new Error(`HTTP ${res.statusCode} for ${url}`));
        }
        try {
          resolvePromise(JSON.parse(data));
        } catch (err) {
          reject(new Error(`unparseable response from ${url}: ${err.message}`));
        }
      });
    });
    req.on('error', reject);
    req.setTimeout(timeoutMs, () => req.destroy(new Error(`timeout fetching ${url}`)));
  });
}

export async function fetchPublishedVersions(name, fetchImpl = fetchJson) {
  // encodeURIComponent, not a string .replace('@', ...): replace() only
  // touches the FIRST match, which happens to be harmless for a leading
  // scope char but is the wrong tool for escaping a URL path segment.
  const url = `https://registry.npmjs.org/${encodeURIComponent(name)}`;
  const body = await fetchImpl(url);
  if (body.notFound) return null;
  return Object.keys(body.versions ?? {});
}

/**
 * Pure decision logic, kept separate from the network call so it can be unit
 * tested with fixture data instead of hitting the real registry.
 *
 * @param {{name: string, range: string}} leaf
 * @param {string[]|null} publishedVersions - null means the package itself
 *   was not found on the registry at all.
 * @returns {{ok: boolean, resolvedVersion: string|null, violation: string|null, note: string|null}}
 */
export function evaluateLeaf(leaf, publishedVersions) {
  if (publishedVersions === null) {
    return {
      ok: false,
      resolvedVersion: null,
      violation: `${leaf.name}: package does not exist on the npm registry at all.`,
      note: null,
    };
  }

  const exact = /^\d+\.\d+\.\d+/.test(leaf.range) ? leaf.range : null;

  if (exact) {
    const ok = publishedVersions.includes(exact);
    const latest = publishedVersions.slice().sort(semver.compare).at(-1) ?? 'none';
    return {
      ok,
      resolvedVersion: ok ? exact : null,
      violation: ok
        ? null
        : `${leaf.name}: the CLI pins the exact version "${exact}", but that version is NOT on the ` +
          `npm registry (latest published: ${latest}). A fresh \`npm install\` of @claude-flow/cli ` +
          `will fail with ETARGET (ruvnet/ruflo#4303). Publish ${leaf.name}@${exact} before releasing, ` +
          `or pin back to a version that is already published.`,
      note: null,
    };
  }

  const satisfying = publishedVersions.filter((v) =>
    semver.satisfies(v, leaf.range, { includePrerelease: true }),
  );
  const ok = satisfying.length > 0;
  const resolvedVersion = ok ? satisfying.slice().sort(semver.compare).at(-1) : null;
  return {
    ok,
    resolvedVersion,
    violation: ok
      ? null
      : `${leaf.name}: no published version on the npm registry satisfies the CLI's range ` +
        `"${leaf.range}". A fresh \`npm install\` will fail to resolve this dependency.`,
    note: null,
  };
}

export function collectLeaves(cliPkg, bundled, readWorkspacePkg) {
  const declared = { ...(cliPkg.dependencies ?? {}), ...(cliPkg.optionalDependencies ?? {}) };
  const leaves = [];
  for (const [name, range] of Object.entries(declared)) {
    if (!name.startsWith('@claude-flow/')) continue;
    if (bundled.has(name)) continue;
    const pkg = readWorkspacePkg(name);
    if (!pkg) continue; // not a workspace package — nothing in this repo to ship
    leaves.push({ name, range, workspaceVersion: pkg.version });
  }
  return leaves;
}

async function main() {
  const bundled = new Set(INTERNAL_RUNTIME_PACKAGES.map((p) => p.name));
  if (bundled.size === 0) {
    console.error('✗ INTERNAL_RUNTIME_PACKAGES is empty — cannot classify deps. Guard aborted.');
    process.exit(1);
  }

  const cliPkg = readJson(CLI_PKG);
  if (!cliPkg) {
    console.error(`✗ ${CLI_PKG} not found — guard aborted.`);
    process.exit(1);
  }

  const leaves = collectLeaves(cliPkg, bundled, (name) => readJson(`v3/${name}/package.json`));

  console.log('leaf-versions-published audit — live npm registry check');
  console.log(`  bundled (ship with the train, skipped): ${[...bundled].join(', ')}`);

  if (leaves.length === 0) {
    console.error('✗ inspected 0 non-bundled leaves — the classifier is broken, not the repo.');
    console.error('  Refusing to report a clean result. Check CLI deps and INTERNAL_RUNTIME_PACKAGES.');
    process.exit(1);
  }

  const violations = [];
  let checked = 0;

  for (const leaf of leaves) {
    let versions;
    try {
      versions = await fetchPublishedVersions(leaf.name);
    } catch (err) {
      violations.push(
        `${leaf.name}: could not query the npm registry (${err.message}). Treating this as ` +
        `unverified, not as a pass — a release must not go out on an unproven leaf.`,
      );
      continue;
    }
    checked++;
    const result = evaluateLeaf(leaf, versions);
    console.log(
      `  ${leaf.name.padEnd(36)} cli pins ${leaf.range.padEnd(22)} resolves to: ` +
      `${result.resolvedVersion ?? 'NONE'} ${result.ok ? '✓' : '✗'}`,
    );
    if (!result.ok) violations.push(result.violation);

    if (versions && !versions.includes(leaf.workspaceVersion)) {
      console.log(
        `  NOTE: ${leaf.name} workspace version ${leaf.workspaceVersion} is not yet published ` +
        `(this is fine mid-development; it only matters at release time).`,
      );
    }
  }

  console.log(`  checked ${checked}/${leaves.length} non-bundled leaf package(s) against the live registry`);

  if (violations.length === 0) {
    console.log('  ok: every non-bundled leaf dependency the CLI declares is actually published');
    process.exit(0);
  }

  console.error('\nviolations:');
  for (const v of violations) console.error(`  ✗ ${v}`);
  console.error(`\n${violations.length} violation(s) — releasing/installing now would reproduce ruvnet/ruflo#4303.`);
  process.exit(1);
}

// Only run as a script, not when imported by the test file.
if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
