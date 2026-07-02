#!/usr/bin/env node
/**
 * @claude-flow/cli postinstall — agentdb compatibility patches.
 *
 * Two patches applied to the user's installed agentdb tree:
 *
 * 1. Sibling directory copy (#1721 fix): agentic-flow's runtime patch
 *    expects agentdb's controllers + utils + core + services + types
 *    at `dist/<name>/` (legacy v1.x layout). agentdb v3 ships at
 *    `dist/src/<name>/`. Copy each `dist/src/<name>/` subdir to
 *    `dist/<name>/` so the legacy import paths resolve. Skip dirs that
 *    already exist so this is idempotent.
 *
 * 2. Exports-field augmentation (ADR-095 G7): six controller files
 *    exist in agentdb's dist but are not declared in its package.json
 *    `exports` field — `AttestationLog`, `MutationGuard`,
 *    `GuardedVectorBackend`, `GNNService`, `RVFOptimizer`,
 *    `GraphAdapter`. Without these declared, Node's strict exports
 *    enforcement blocks subpath imports even when the file is on disk.
 *    We add the missing entries (only if the file actually exists)
 *    so consumers can reach them via `agentdb/controllers/...`.
 *
 * Both patches are best-effort — failure to apply does not break
 * install (try/catch wraps each phase). Re-running is safe.
 */

'use strict';

const fs = require('node:fs');
const path = require('node:path');

function findAgentdbBase() {
  try {
    const r = require.resolve('agentdb');
    if (r.includes('dist/src')) return path.join(path.dirname(r), '..', '..');
    if (r.includes('dist')) return path.join(path.dirname(r), '..');
    return path.dirname(r);
  } catch { return null; }
}

/**
 * Find every agentdb installation reachable in the install's node_modules
 * tree. Necessary because pnpm/npm hoisting can place multiple copies of
 * agentdb (different versions) at different levels. Only patching the
 * resolved one leaves consumer code that imports through a different
 * resolution path with stale exports.
 *
 * Strategy: walk up from the postinstall script's directory, collect any
 * `node_modules/agentdb` we find along the way + the .pnpm cached copies
 * directly under the same node_modules/.pnpm/ root.
 */
function findAllAgentdbBases() {
  const found = new Set();
  let dir = __dirname;
  for (let i = 0; i < 12; i++) {
    const candidate = path.join(dir, 'node_modules', 'agentdb');
    if (fs.existsSync(path.join(candidate, 'package.json'))) {
      try { found.add(fs.realpathSync(candidate)); } catch { found.add(candidate); }
    }
    // Also check for .pnpm cache adjacent to this node_modules
    const pnpmDir = path.join(dir, 'node_modules', '.pnpm');
    if (fs.existsSync(pnpmDir)) {
      try {
        for (const e of fs.readdirSync(pnpmDir)) {
          if (e.startsWith('agentdb@')) {
            const adb = path.join(pnpmDir, e, 'node_modules', 'agentdb');
            if (fs.existsSync(path.join(adb, 'package.json'))) {
              try { found.add(fs.realpathSync(adb)); } catch { found.add(adb); }
            }
          }
        }
      } catch { /* ignore */ }
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return Array.from(found);
}

function copySiblings(base) {
  const srcDist = path.join(base, 'dist', 'src');
  if (!fs.existsSync(srcDist)) return;
  for (const entry of fs.readdirSync(srcDist)) {
    const src = path.join(srcDist, entry);
    const target = path.join(base, 'dist', entry);
    try {
      if (fs.statSync(src).isDirectory() && !fs.existsSync(target)) {
        fs.cpSync(src, target, { recursive: true });
      }
    } catch { /* best-effort */ }
  }
}

function augmentExports(base) {
  const pkgPath = path.join(base, 'package.json');
  if (!fs.existsSync(pkgPath)) return;
  let pkg;
  try { pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8')); }
  catch { return; }
  if (!pkg.exports || typeof pkg.exports !== 'object') return;

  // Subpath → relative file path (only added if both: (a) file exists, (b) export not already declared)
  const additions = {
    './controllers/AttestationLog': './dist/src/security/AttestationLog.js',
    './controllers/MutationGuard': './dist/src/security/MutationGuard.js',
    './controllers/GuardedVectorBackend': './dist/src/backends/ruvector/GuardedVectorBackend.js',
    // GNNService and RVFOptimizer live outside dist/src/controllers/ in
    // current agentdb. Map to the actual paths so the export points at a
    // real file. Future agentdb versions may move them — the file-exists
    // guard below will skip cleanly if these paths drift.
    './controllers/GNNService': './dist/src/services/GNNService.js',
    './controllers/RVFOptimizer': './dist/src/optimizations/RVFOptimizer.js',
    // GraphAdapter location varies; try the graph-node backend path. If
    // missing, the file-exists guard skips it without error.
    './controllers/GraphAdapter': './dist/src/backends/graph-node/GraphAdapter.js',
    // Also expose the security index so consumers can import the security namespace.
    './security/controllers': './dist/src/security/index.js',
  };

  let changed = false;
  for (const [subpath, target] of Object.entries(additions)) {
    if (pkg.exports[subpath]) continue;
    const abs = path.join(base, target);
    if (!fs.existsSync(abs)) continue;
    pkg.exports[subpath] = target;
    changed = true;
  }

  if (changed) {
    try {
      fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n', 'utf-8');
    } catch { /* best-effort */ }
  }
}

function main() {
  // Patch every reachable agentdb instance, not just the first resolution
  // result. pnpm/npm hoisting can leave multiple agentdb copies in the
  // install tree, and consumers may import through any of them.
  const bases = findAllAgentdbBases();
  if (bases.length === 0) {
    // Fall back to the single-base path so we still attempt something
    // when the directory walk didn't find anything (e.g. unusual installs).
    const base = findAgentdbBase();
    if (base) bases.push(base);
  }
  for (const base of bases) {
    try { copySiblings(base); } catch { /* phase 1 best-effort */ }
    // ADR-095 G7 / ADR-170 Phase 1.2: augmentExports was defined but never
    // called, leaving agentdb subpath imports (AttestationLog, MutationGuard,
    // …) blocked by Node's strict exports enforcement. Best-effort like
    // phase 1 — a failure must never break install.
    try { augmentExports(base); } catch { /* phase 2 best-effort */ }
  }
}

main();
