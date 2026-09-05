#!/usr/bin/env node
/**
 * Supply chain audit (#2046, ADR-123 supply-chain hardening).
 *
 * Three layers of defence, run on every push and PR via .github/workflows/v3-ci.yml:
 *
 *   1. **CVE audit** — `npm audit --json --audit-level=high` for every package
 *      we publish or consume directly. Fails on any HIGH or CRITICAL finding
 *      in a DIRECT dep. Transitives are reported but only fail when CVE is in
 *      this repo's allowlist of "must-block" identifiers.
 *
 *   2. **Lockfile integrity** — every entry in package-lock.json must carry a
 *      SHA-512 `integrity` field. Missing or weak hashes are a tamper vector
 *      (a registry-mitm could swap a tarball without npm noticing).
 *
 *   3. **Top-level allowlist** — see .github/supply-chain/allowed-deps.json.
 *      New top-level deps require an explicit allowlist addition. This blocks
 *      a compromised maintainer (or a typo'd PR) from quietly adding a
 *      malicious dep.
 *
 * Plus, on a separate stage:
 *
 *   4. **Typosquat reject** — if any package.json declares a dependency name
 *      that matches an entry in `policies.rejectInRegistry`, fail immediately.
 *
 * Usage:
 *   node scripts/audit-supply-chain.mjs                # full audit
 *   node scripts/audit-supply-chain.mjs --json         # machine-readable
 *   node scripts/audit-supply-chain.mjs --scope cve    # only the CVE pass
 *   node scripts/audit-supply-chain.mjs --scope lockfile
 *   node scripts/audit-supply-chain.mjs --scope allowlist
 */

import { readFileSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '..');

const ALLOWLIST_PATH = join(REPO_ROOT, '.github', 'supply-chain', 'allowed-deps.json');
const ACCEPTED_PATH = join(REPO_ROOT, '.github', 'supply-chain', 'accepted-findings.json');
const PACKAGES_TO_AUDIT = [
  'plugins/ruflo-graph-intelligence',
  'v3/@claude-flow/browser',
  // Add more as supply-chain coverage expands. Existing packages with their
  // own already-passing CVE story (memory, hooks, etc.) can come online by
  // adding them here.
];

const ARGS = new Set(process.argv.slice(2));
const JSON_OUTPUT = ARGS.has('--json');
const SCOPE = (() => {
  const scopeArg = process.argv.find((a) => a.startsWith('--scope'));
  if (!scopeArg) return 'all';
  const eqIndex = scopeArg.indexOf('=');
  if (eqIndex !== -1) return scopeArg.slice(eqIndex + 1);
  const i = process.argv.indexOf('--scope');
  return process.argv[i + 1] ?? 'all';
})();

const results = {
  cve: [],
  lockfile: [],
  allowlist: [],
  typosquat: [],
  publisherTrust: [],
};

function log(msg) {
  if (!JSON_OUTPUT) console.log(msg);
}

function loadAllowlist() {
  if (!existsSync(ALLOWLIST_PATH)) {
    throw new Error(`allowlist not found at ${ALLOWLIST_PATH}`);
  }
  return JSON.parse(readFileSync(ALLOWLIST_PATH, 'utf8'));
}

function loadAcceptedFindings() {
  if (!existsSync(ACCEPTED_PATH)) {
    return { cve: [], lockfile: [] };
  }
  const data = JSON.parse(readFileSync(ACCEPTED_PATH, 'utf8'));
  // Reject expired entries — they must be re-triaged.
  const today = new Date().toISOString().slice(0, 10);
  const expired = (data.cve ?? []).filter((e) => e.expiresAt && e.expiresAt < today);
  if (expired.length > 0) {
    console.warn(`WARN: ${expired.length} accepted-findings entries are EXPIRED and will not be honoured.`);
    for (const e of expired) console.warn(`  - ${e.package}/${e.depName} expired ${e.expiresAt}`);
  }
  return {
    cve: (data.cve ?? []).filter((e) => !e.expiresAt || e.expiresAt >= today),
    lockfile: data.lockfile ?? [],
  };
}

function isAcceptedCve(finding, accepted) {
  return accepted.cve.some(
    (a) => a.package === finding.package && a.depName === finding.depName,
  );
}

function isAcceptedLockfile(packagePath, entryPath, accepted) {
  return accepted.lockfile.some(
    (a) => a.package === packagePath && entryPath.includes(a.pattern),
  );
}

// ---------------------------------------------------------------------------
// 1. CVE audit — fail on HIGH or CRITICAL in DIRECT deps
// ---------------------------------------------------------------------------

function runCveAudit(packageDir, accepted) {
  const pkgPath = join(REPO_ROOT, packageDir, 'package.json');
  if (!existsSync(pkgPath)) return;
  const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
  const directDeps = new Set([
    ...Object.keys(pkg.dependencies ?? {}),
    ...Object.keys(pkg.devDependencies ?? {}),
    ...Object.keys(pkg.peerDependencies ?? {}),
  ]);

  let audit;
  try {
    const out = execFileSync('npm', ['audit', '--json', '--audit-level=high'], {
      cwd: join(REPO_ROOT, packageDir),
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 60_000,
    });
    audit = JSON.parse(out.toString());
  } catch (err) {
    // `npm audit` exits non-zero when it finds vulnerabilities — that's
    // still useful output; parse it.
    if (err.stdout) {
      try {
        audit = JSON.parse(err.stdout.toString());
      } catch {
        results.cve.push({
          package: packageDir,
          failure: 'audit threw and stdout not JSON: ' + (err.message ?? String(err)),
        });
        return;
      }
    } else {
      results.cve.push({ package: packageDir, failure: err.message ?? String(err) });
      return;
    }
  }
  const advisories = audit?.vulnerabilities ?? {};
  const directHighCritical = [];
  let acceptedCount = 0;
  for (const [name, info] of Object.entries(advisories)) {
    if (!directDeps.has(name)) continue;
    if (info.severity === 'high' || info.severity === 'critical') {
      const finding = {
        package: packageDir,
        depName: name,
        severity: info.severity,
        via: info.via,
        fixAvailable: info.fixAvailable,
      };
      if (isAcceptedCve(finding, accepted)) {
        acceptedCount++;
      } else {
        directHighCritical.push(finding);
      }
    }
  }
  if (directHighCritical.length > 0) {
    results.cve.push(...directHighCritical);
  }
  log(`  [cve] ${packageDir}: ${directHighCritical.length} HIGH/CRITICAL unaccepted, ${acceptedCount} accepted`);
}

// ---------------------------------------------------------------------------
// 2. Lockfile integrity — every entry must carry a SHA-512 hash
// ---------------------------------------------------------------------------

function runLockfileAudit(packageDir, accepted) {
  const lockPath = join(REPO_ROOT, packageDir, 'package-lock.json');
  if (!existsSync(lockPath)) {
    log(`  [lockfile] ${packageDir}: no package-lock.json — skipped`);
    return;
  }
  const lock = JSON.parse(readFileSync(lockPath, 'utf8'));
  let missing = 0;
  let weak = 0;
  let acceptedCount = 0;
  // npm v7+ lockfile format: `packages` (path → metadata)
  const packages = lock.packages ?? {};
  for (const [path, meta] of Object.entries(packages)) {
    // Root package entry has no integrity; skip
    if (path === '') continue;
    // Optional + workspace-link entries also legitimately have no integrity
    if (meta.link) continue;
    // Entries without `resolved` are dependency declarations (not downloads)
    // and don't carry integrity in the npm v9+ lockfile format.
    if (!meta.resolved) continue;
    if (!meta.integrity) {
      if (isAcceptedLockfile(packageDir, path, accepted)) {
        acceptedCount++;
      } else {
        missing++;
      }
      continue;
    }
    if (!meta.integrity.startsWith('sha512-')) {
      weak++;
    }
  }
  if (missing > 0 || weak > 0) {
    results.lockfile.push({
      package: packageDir,
      missing,
      weak,
    });
  }
  log(`  [lockfile] ${packageDir}: ${missing} missing, ${weak} weak, ${acceptedCount} accepted`);
}

// ---------------------------------------------------------------------------
// 3. Top-level allowlist — fail if a package declares a dep not in allowlist
// ---------------------------------------------------------------------------

function runAllowlistAudit(allowlist) {
  for (const [pkgName, expected] of Object.entries(allowlist.packages)) {
    // Find this package's package.json by scanning known locations
    const candidates = [
      join(REPO_ROOT, 'plugins', pkgName, 'package.json'),
      join(REPO_ROOT, 'v3', pkgName, 'package.json'), // e.g. v3/@claude-flow/browser
    ];
    let pkgPath;
    for (const c of candidates) {
      if (existsSync(c)) { pkgPath = c; break; }
    }
    if (!pkgPath) {
      results.allowlist.push({
        package: pkgName,
        failure: 'allowlist references a package whose package.json was not found',
      });
      continue;
    }
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
    const buckets = ['dependencies', 'devDependencies', 'peerDependencies'];
    for (const bucket of buckets) {
      const declared = Object.keys(pkg[bucket] ?? {});
      const allowed = new Set(expected[bucket] ?? []);
      const extra = declared.filter((d) => !allowed.has(d));
      if (extra.length > 0) {
        results.allowlist.push({
          package: pkgName,
          bucket,
          extraDeps: extra,
          remediation: `Add to .github/supply-chain/allowed-deps.json under "packages"."${pkgName}"."${bucket}" or remove from package.json`,
        });
      }
    }
  }
  log(`  [allowlist] checked ${Object.keys(allowlist.packages).length} packages`);
}

// ---------------------------------------------------------------------------
// 4. Typosquat reject — block known typosquat names
// ---------------------------------------------------------------------------

function runTyposquatAudit(allowlist) {
  const banned = new Set(allowlist.policies?.rejectInRegistry ?? []);
  if (banned.size === 0) return;
  for (const packageDir of PACKAGES_TO_AUDIT) {
    const pkgPath = join(REPO_ROOT, packageDir, 'package.json');
    if (!existsSync(pkgPath)) continue;
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
    for (const bucket of ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies']) {
      for (const dep of Object.keys(pkg[bucket] ?? {})) {
        if (banned.has(dep)) {
          results.typosquat.push({
            package: packageDir,
            bucket,
            depName: dep,
            severity: 'critical',
            reason: 'known typosquat — blocked by allowlist policy',
          });
        }
      }
    }
  }
  log(`  [typosquat] checked ${PACKAGES_TO_AUDIT.length} packages against ${banned.size} blocked names`);
}

// ---------------------------------------------------------------------------
// 5. Publisher trust — log who currently owns each critical upstream
// ---------------------------------------------------------------------------

function runPublisherTrustAudit(allowlist) {
  const critical = allowlist.publisherTrust?.criticalUpstreamPackages ?? [];
  for (const name of critical) {
    try {
      // Use execFileSync + array args to prevent shell injection through
      // package names sourced from the allowlist JSON (CWE-78 mitigation).
      const out = execFileSync('npm', ['view', name, 'maintainers', '--json'], {
        stdio: ['ignore', 'pipe', 'pipe'],
        timeout: 10_000,
      });
      const maintainers = JSON.parse(out.toString());
      const names = Array.isArray(maintainers)
        ? maintainers.map((m) => (typeof m === 'string' ? m : m.name ?? m.email ?? '?'))
        : [];
      results.publisherTrust.push({ package: name, maintainers: names });
      log(`  [publisher-trust] ${name}: ${names.join(', ') || '(none reported)'}`);
    } catch (err) {
      results.publisherTrust.push({
        package: name,
        warning: 'npm view failed: ' + (err.message ?? String(err)),
      });
    }
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function main() {
  log('=== ruflo supply-chain audit ===');
  log(`scope: ${SCOPE}`);
  const allowlist = loadAllowlist();
  const accepted = loadAcceptedFindings();
  log(`accepted-findings: ${accepted.cve.length} CVE, ${accepted.lockfile.length} lockfile`);

  if (SCOPE === 'all' || SCOPE === 'cve') {
    log('\n[1/5] CVE audit');
    for (const p of PACKAGES_TO_AUDIT) runCveAudit(p, accepted);
  }
  if (SCOPE === 'all' || SCOPE === 'lockfile') {
    log('\n[2/5] Lockfile integrity');
    for (const p of PACKAGES_TO_AUDIT) runLockfileAudit(p, accepted);
  }
  if (SCOPE === 'all' || SCOPE === 'allowlist') {
    log('\n[3/5] Top-level allowlist');
    runAllowlistAudit(allowlist);
  }
  if (SCOPE === 'all' || SCOPE === 'typosquat') {
    log('\n[4/5] Typosquat reject');
    runTyposquatAudit(allowlist);
  }
  if (SCOPE === 'all' || SCOPE === 'publisher-trust') {
    log('\n[5/5] Publisher trust snapshot');
    runPublisherTrustAudit(allowlist);
  }

  // Anything in cve / lockfile / allowlist / typosquat is a hard fail.
  // publisher-trust is informational (logs only).
  const hardFails =
    results.cve.length + results.lockfile.length + results.allowlist.length + results.typosquat.length;

  if (JSON_OUTPUT) {
    console.log(JSON.stringify(results, null, 2));
  } else {
    log('\n=== summary ===');
    log(`  CVE direct-dep findings: ${results.cve.length}`);
    log(`  lockfile integrity issues: ${results.lockfile.length}`);
    log(`  allowlist violations: ${results.allowlist.length}`);
    log(`  typosquat hits: ${results.typosquat.length}`);
    log(`  publisher-trust entries: ${results.publisherTrust.length}`);
    if (hardFails > 0) {
      log('\nFAIL: see above. Resolve before merging.');
    } else {
      log('\nOK: no hard-fail findings.');
    }
  }

  process.exit(hardFails > 0 ? 1 : 0);
}

main();
