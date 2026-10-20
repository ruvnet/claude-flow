#!/usr/bin/env node
/**
 * Static guard for ruvnet/ruflo#3335 and #3390 (#3327 Finding A).
 *
 * The release train is exactly three packages — `@claude-flow/cli`,
 * `claude-flow`, `ruflo`. Four internal components ride along INSIDE those
 * tarballs (`INTERNAL_RUNTIME_PACKAGES` in stage-internal-runtime-bundles.mjs:
 * security, codex, mcp, plugin-agent-federation), so a source change in them
 * ships with the train.
 *
 * Every OTHER `@claude-flow/*` dependency of the CLI — currently cli-core,
 * neural, shared, memory — is resolved from the REGISTRY at the version
 * `v3/@claude-flow/cli/package.json` declares. A merged source change in one of
 * those does NOT ship with the train: the release silently carries the last
 * *published* copy of that leaf.
 *
 * This has now bitten twice:
 *
 *   #3335 (2026-09-16) — PR #3334 fixed RUFLO_INTELLIGENCE_MODE in
 *   @claude-flow/memory. v3.42.1 shipped cli/claude-flow/ruflo only; memory was
 *   last published 2026-08-22, so a fresh consumer install had ZERO references
 *   to the fix.
 *
 *   #3390 (2026-09-21) — the reasoningBank activation fix spanned
 *   cli/src/memory/memory-bridge.ts AND memory/src/controller-registry.ts.
 *   Publishing only the train would have shipped the bridge half and left the
 *   embedder half unreachable, leaving reasoningBank just as inert as before.
 *   Caught by hand; memory@3.0.0-alpha.25 was published alongside v3.42.5.
 *
 * The trap is that CI goes GREEN on such a change: the leaf's own package tests
 * run against workspace source, so the fix looks verified while being unshippable.
 *
 * Asserts:
 *
 *   1. For every non-bundled `@claude-flow/*` dep of the CLI that exists as a
 *      workspace package, the CLI's declared range must be satisfied by the
 *      workspace's own version. A miss means the release resolves to something
 *      OLDER than the source in this repo.
 *
 *   2. (diff mode — needs a base ref) If a leaf's publishable source changed
 *      relative to the base ref but its package.json `version` did NOT, the
 *      release cannot ship that change. Bump the leaf and publish it.
 *
 * Diff mode is skipped, loudly, when no base ref is available — "not exercised"
 * is reported distinctly from "clean" so a skip can never read as a pass.
 *
 * Usage:  node scripts/audit-leaf-package-publish.mjs [--base <ref>]
 *         GITHUB_BASE_REF is used automatically in PR CI.
 *
 * Exit codes: 0 ok / 1 violations (or the guard inspected nothing).
 */

import { readFileSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import semver from 'semver';

import { INTERNAL_RUNTIME_PACKAGES } from './stage-internal-runtime-bundles.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..');
const CLI_PKG = 'v3/@claude-flow/cli/package.json';

// Files that actually end up in a published leaf tarball. A change to tests or
// fixtures cannot alter what consumers receive, so it must not trip the guard.
const PUBLISHABLE = /\/(src|bin|scripts)\/|\/package\.json$/;
const NOT_PUBLISHABLE = /(\.test\.|\.spec\.|__tests__\/|\/tests?\/|\/fixtures?\/|\.md$)/;

function readJson(rel) {
  const p = join(REPO_ROOT, rel);
  return existsSync(p) ? JSON.parse(readFileSync(p, 'utf8')) : null;
}

function git(args) {
  return execFileSync('git', args, { cwd: REPO_ROOT, encoding: 'utf8' }).trim();
}

// Time-boxed accepted findings. NOT a mute button: an expired entry is refused
// and fails the guard, so debt has to be revisited rather than quietly inherited.
const ACCEPTED = [];

const today = new Date().toISOString().slice(0, 10);
function acceptedFor(pkg, check) {
  const hit = ACCEPTED.find((a) => a.package === pkg && a.check === check);
  if (!hit) return null;
  if (hit.expires < today) return { ...hit, expired: true };
  return hit;
}

const violations = [];
const notes = [];

// ── 0. resolve the bundled set from its single source of truth ───────────────
// Imported, never re-typed: a hardcoded copy here would silently go stale the
// moment someone adds a package to the staging script, and this guard would
// then wave through exactly the class of bug it exists to catch.
const bundled = new Set(INTERNAL_RUNTIME_PACKAGES.map((p) => p.name));
if (bundled.size === 0) {
  console.error('✗ INTERNAL_RUNTIME_PACKAGES is empty — cannot classify deps. Guard aborted.');
  process.exit(1);
}

// ── 1. enumerate the non-bundled leaves ──────────────────────────────────────
const cliPkg = readJson(CLI_PKG);
if (!cliPkg) {
  console.error(`✗ ${CLI_PKG} not found — guard aborted.`);
  process.exit(1);
}

const declared = { ...(cliPkg.dependencies ?? {}), ...(cliPkg.optionalDependencies ?? {}) };
const leaves = [];
for (const [name, range] of Object.entries(declared)) {
  if (!name.startsWith('@claude-flow/')) continue;
  if (bundled.has(name)) continue;
  const dir = `v3/${name}`;
  const pkg = readJson(`${dir}/package.json`);
  if (!pkg) continue; // not a workspace package — nothing in this repo to ship
  leaves.push({ name, range, dir, version: pkg.version });
}

console.log('leaf-package-publish audit — non-bundled @claude-flow/* deps of the CLI');
console.log(`  bundled (ship with the train): ${[...bundled].join(', ')}`);

// A guard that inspects nothing must never report success.
if (leaves.length === 0) {
  console.error('✗ inspected 0 non-bundled leaves — the classifier is broken, not the repo.');
  console.error('  Refusing to report a clean result. Check CLI deps and INTERNAL_RUNTIME_PACKAGES.');
  process.exit(1);
}

// ── 2. range must cover the workspace version ────────────────────────────────
for (const leaf of leaves) {
  const covered = semver.satisfies(leaf.version, leaf.range, { includePrerelease: true });
  console.log(`  ${leaf.name.padEnd(36)} cli pins ${leaf.range.padEnd(22)} source ${leaf.version} ${covered ? '✓' : '✗'}`);
  if (!covered) {
    const waiver = acceptedFor(leaf.name, 'range-coverage');
    if (waiver && !waiver.expired) {
      notes.push(`ACCEPTED until ${waiver.expires} — ${leaf.name}: ${waiver.reason}`);
      continue;
    }
    if (waiver?.expired) {
      violations.push(
        `${leaf.name}: accepted-finding EXPIRED ${waiver.expires} and is no longer honoured. ` +
        `Resolve it or renew the entry with a fresh justification. (${waiver.reason})`
      );
      continue;
    }
    violations.push(
      `${leaf.name}: the CLI pins "${leaf.range}", which does NOT cover the workspace version ` +
      `${leaf.version}. The release would resolve to an OLDER published copy than the source ` +
      `in this repo. Either publish ${leaf.name}@${leaf.version} and widen/raise the range in ` +
      `${CLI_PKG}, or correct the workspace version.`
    );
  }
}

// ── 3. changed source must come with a version bump ──────────────────────────
const baseArg = process.argv.indexOf('--base');
const base = baseArg !== -1 ? process.argv[baseArg + 1]
  : process.env.GITHUB_BASE_REF ? `origin/${process.env.GITHUB_BASE_REF}`
  : null;

if (!base) {
  notes.push(
    'diff check NOT EXERCISED — no base ref (pass --base <ref> or set GITHUB_BASE_REF). ' +
    'Range coverage above was still checked; this is a skip, not a pass.'
  );
} else {
  // Three-dot is the correct question for a PR ("what did this branch introduce"),
  // but it needs a merge base, which a shallow CI clone may not have — that is
  // exactly how this check silently sat out its first real run. Fall back to
  // two-dot, which needs no common ancestor and still answers "does this tree
  // differ from base", and say which mode actually ran.
  let changed = [];
  let mode = null;
  for (const [spec, label] of [[`${base}...HEAD`, 'three-dot'], [`${base}`, 'two-dot']]) {
    try {
      changed = git(['diff', '--name-only', spec, ...(label === 'two-dot' ? ['HEAD'] : [])])
        .split('\n').filter(Boolean);
      mode = label;
      break;
    } catch { /* try the next spec */ }
  }
  if (!mode) {
    notes.push(`diff check NOT EXERCISED — could not diff against '${base}' by any spec.`);
  } else {
    notes.push(`diff check ran (${mode} vs ${base}, ${changed.length} file(s) changed).`);
  }

  if (changed.length > 0) {
    for (const leaf of leaves) {
      const touched = changed.filter(
        (f) => f.startsWith(`${leaf.dir}/`) && PUBLISHABLE.test(f) && !NOT_PUBLISHABLE.test(f),
      );
      if (touched.length === 0) continue;

      let baseVersion = null;
      try {
        baseVersion = JSON.parse(git(['show', `${base}:${leaf.dir}/package.json`])).version;
      } catch {
        continue; // new package in this PR — nothing published to go stale
      }

      if (baseVersion === leaf.version) {
        violations.push(
          `${leaf.name}: publishable source changed but the version is still ${leaf.version}.\n` +
          `      changed: ${touched.slice(0, 5).join(', ')}${touched.length > 5 ? `, +${touched.length - 5} more` : ''}\n` +
          `      ${leaf.name} is NOT bundled into the release tarballs — it resolves from the\n` +
          `      registry — so publishing the three train packages will ship the OLD copy and\n` +
          `      this change will reach nobody. Bump ${leaf.dir}/package.json and publish the\n` +
          `      leaf alongside the release. See CLAUDE.md "Publishing Rules".`
        );
      } else {
        console.log(`  ${leaf.name}: source changed AND version bumped ${baseVersion} -> ${leaf.version} ✓`);
      }
    }
  }
}

// ── 4. report ────────────────────────────────────────────────────────────────
console.log(`  inspected ${leaves.length} non-bundled leaf package(s)`);
for (const n of notes) console.log(`  NOTE: ${n}`);

if (violations.length === 0) {
  console.log('  ok: every non-bundled leaf is covered by the CLI range and carries a bump if changed');
  process.exit(0);
}

console.error('\nviolations:');
for (const v of violations) console.error(`  ✗ ${v}`);
console.error(`\n${violations.length} violation(s) — a release now would ship an incomplete fix.`);
console.error('Reference: ruvnet/ruflo#3335, #3390 (#3327 Finding A).');
process.exit(1);
