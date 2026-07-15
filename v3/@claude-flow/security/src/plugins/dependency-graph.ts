/**
 * Dependency-graph traversal + OSV cross-reference (ADR-320 Part A, Stage 2 / P2).
 *
 * Split from publish-scanner.ts to keep both files under the repo's 500-line
 * limit (v3/CLAUDE.md). Called by `PluginPublishScanner.scan()` to populate
 * the real `dependencyRisk` field (P1 shipped a permanent stub here).
 *
 * What this does
 * --------------
 * 1. Walks the plugin's full `package.json` dependency tree — direct
 *    `dependencies`/`devDependencies`/`peerDependencies`, then recurses into
 *    `<pluginDir>/node_modules/<pkg>/package.json` when present. If no
 *    `node_modules` tree exists alongside the plugin, degrades to the
 *    shallow direct-deps-only pass rather than throwing (same degrade
 *    posture as `agentdb-adapter.ts`'s `semanticSearch` — try the deep
 *    approach, fall back to the shallow one, never throw).
 * 2. Flags unpinned version specifiers (`^`, `~`, `*`, `latest`, git/url
 *    specs, ranges) — anything that isn't an exact `x.y.z` pin.
 * 3. Cross-references discovered packages against OSV.dev's public API
 *    (`POST /v1/query`, npm ecosystem). Network calls are bounded by a 5s
 *    `AbortController` timeout each and MUST degrade gracefully: if every
 *    query fails (OSV unreachable), `scanned: false` is returned with
 *    whatever locally-computed findings (unpinned/excess-capability) still
 *    apply — the OSV outage never throws and never blocks `plugins publish`.
 * 4. Flags transitive dependencies whose own `package.json['claude-flow']`
 *    metadata requests filesystem/network capabilities the plugin's own
 *    manifest does not declare. Most ordinary npm packages have no such
 *    field, so this is a no-op for the common case; it is a proxy for the
 *    not-yet-built Part B `PluginPermissionManifest` schema (P3/P4), not
 *    that schema itself.
 *
 * Scope note: known-vulnerable findings are NOT wired into
 * `PublishScanResult.verdict` in this change — P1's `computeVerdict` (which
 * operates on AST `ScanFinding[]`) is left untouched per ADR-320's P1
 * contract. See the P5 TODO below for where that fusion belongs once the
 * strict-mode-default flip lands.
 *
 * Reference: ADR-320 Part A "Dependency-graph traversal", arXiv:2607.01136
 * (dependency-chain risk), arXiv:2601.10338 (2.12x executable-script risk).
 */

// P5: strict-mode-default flip in v4.0, see ADR-320 §Integration plan

import * as fs from 'node:fs';
import * as path from 'node:path';

export type DependencyFindingIssue = 'unpinned-version' | 'known-vulnerable' | 'excess-capability';

export interface DependencyFinding {
  readonly package: string;
  readonly version: string;
  readonly issue: DependencyFindingIssue;
  readonly detail: string;
  /** Only populated for `known-vulnerable`, sourced from OSV's advisory data. */
  readonly severity?: 'low' | 'medium' | 'high' | 'critical';
}

export interface DependencyGraphReport {
  /** True when the OSV cross-reference actually ran (even if 0 vulns found). False only when OSV was wholly unreachable. */
  readonly scanned: boolean;
  readonly findings: ReadonlyArray<DependencyFinding>;
}

export interface DependencyGraphConfig {
  /** Per-request OSV timeout, ms. Default 5000. */
  readonly osvTimeoutMs?: number;
  /** Injectable fetch for tests; defaults to the global `fetch`. */
  readonly fetchImpl?: typeof fetch;
}

interface PackageJsonShape {
  readonly version?: string;
  readonly dependencies?: Record<string, string>;
  readonly devDependencies?: Record<string, string>;
  readonly peerDependencies?: Record<string, string>;
  readonly 'claude-flow'?: { readonly capabilities?: { readonly filesystem?: boolean; readonly network?: boolean } };
}

interface PluginCapabilities {
  readonly filesystem: boolean;
  readonly network: boolean;
}

interface ResolvedPackage {
  readonly name: string;
  readonly specifier: string;
  readonly resolvedVersion?: string;
  readonly ownCapabilities?: PluginCapabilities;
}

const DEFAULT_OSV_TIMEOUT_MS = 5000;
const MAX_PACKAGES = 500;
const MAX_DEPTH = 12;
const MAX_OSV_QUERIES = 100;
const OSV_QUERY_URL = 'https://api.osv.dev/v1/query';
const EXACT_SEMVER_RE = /^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?(\+[0-9A-Za-z.-]+)?$/;

/**
 * Entry point called by `PluginPublishScanner.scan()`. Never throws —
 * every stage degrades to an empty/partial result on failure.
 */
export async function analyzeDependencyGraph(
  pluginDir: string,
  config: DependencyGraphConfig = {},
): Promise<DependencyGraphReport> {
  const pkg = readPluginPackageJson(pluginDir);
  if (!pkg) return { scanned: false, findings: [] };

  const ownCapabilities = readOwnCapabilities(pkg);
  const resolved = resolveDependencyTree(pluginDir, pkg);

  const localFindings: DependencyFinding[] = [
    ...unpinnedFindings(resolved),
    ...excessCapabilityFindings(resolved, ownCapabilities),
  ];

  const fetchImpl = config.fetchImpl ?? globalThis.fetch;
  if (typeof fetchImpl !== 'function') {
    return { scanned: false, findings: localFindings };
  }

  const timeoutMs = config.osvTimeoutMs ?? DEFAULT_OSV_TIMEOUT_MS;
  const osv = await crossReferenceOsv(uniqueQueryablePackages(resolved), timeoutMs, fetchImpl);
  return { scanned: osv.scanned, findings: [...localFindings, ...osv.findings] };
}

// ─── package.json reading ───────────────────────────────────────────────

function readPluginPackageJson(pluginDir: string): PackageJsonShape | undefined {
  try {
    const pkgPath = path.join(pluginDir, 'package.json');
    if (!fs.existsSync(pkgPath)) return undefined;
    return JSON.parse(fs.readFileSync(pkgPath, 'utf-8')) as PackageJsonShape;
  } catch {
    return undefined;
  }
}

function tryReadNodeModulesPackageJson(pluginDir: string, name: string): PackageJsonShape | undefined {
  try {
    const pkgPath = path.join(pluginDir, 'node_modules', name, 'package.json');
    if (!fs.existsSync(pkgPath)) return undefined;
    return JSON.parse(fs.readFileSync(pkgPath, 'utf-8')) as PackageJsonShape;
  } catch {
    return undefined;
  }
}

/** Reasonable proxy for Part B's not-yet-built `PluginPermissionManifest` (P3/P4): absent field == no elevated capability declared. */
function readOwnCapabilities(pkg: PackageJsonShape): PluginCapabilities {
  const caps = pkg['claude-flow']?.capabilities;
  return { filesystem: caps?.filesystem === true, network: caps?.network === true };
}

function combinedDirectSpecs(pkg: PackageJsonShape): Record<string, string> {
  return { ...pkg.peerDependencies, ...pkg.devDependencies, ...pkg.dependencies };
}

// ─── tree walk ──────────────────────────────────────────────────────────

interface QueueItem {
  readonly name: string;
  readonly specifier: string;
  readonly depth: number;
}

/**
 * Full transitive walk when `node_modules` is present; degrades to the
 * direct-deps-only frontier (depth 0) when it is not — the loop below never
 * throws, it simply stops recursing once `tryReadNodeModulesPackageJson`
 * returns `undefined`.
 */
function resolveDependencyTree(pluginDir: string, pkg: PackageJsonShape): ResolvedPackage[] {
  const out: ResolvedPackage[] = [];
  const visited = new Set<string>();
  const queue: QueueItem[] = Object.entries(combinedDirectSpecs(pkg)).map(([name, specifier]) => ({
    name,
    specifier,
    depth: 0,
  }));

  while (queue.length > 0 && out.length < MAX_PACKAGES) {
    const item = queue.shift() as QueueItem;
    if (visited.has(item.name)) continue;
    visited.add(item.name);

    const depPkg = tryReadNodeModulesPackageJson(pluginDir, item.name);
    out.push({
      name: item.name,
      specifier: item.specifier,
      resolvedVersion: depPkg?.version,
      ownCapabilities: depPkg ? readOwnCapabilities(depPkg) : undefined,
    });

    if (depPkg && item.depth < MAX_DEPTH) {
      for (const [childName, childSpec] of Object.entries(depPkg.dependencies ?? {})) {
        if (!visited.has(childName)) queue.push({ name: childName, specifier: childSpec, depth: item.depth + 1 });
      }
    }
  }
  return out;
}

// ─── unpinned-version ───────────────────────────────────────────────────

function isUnpinnedSpec(spec: string): boolean {
  const trimmed = spec.trim();
  if (trimmed === '') return false;
  return !EXACT_SEMVER_RE.test(trimmed);
}

function unpinnedFindings(resolved: ReadonlyArray<ResolvedPackage>): DependencyFinding[] {
  const out: DependencyFinding[] = [];
  for (const pkg of resolved) {
    if (isUnpinnedSpec(pkg.specifier)) {
      out.push({
        package: pkg.name,
        version: pkg.specifier,
        issue: 'unpinned-version',
        detail: `Declared version spec "${pkg.specifier}" is not pinned to an exact version.`,
      });
    }
  }
  return out;
}

// ─── excess-capability ──────────────────────────────────────────────────

function excessCapabilityFindings(
  resolved: ReadonlyArray<ResolvedPackage>,
  ownCapabilities: PluginCapabilities,
): DependencyFinding[] {
  const out: DependencyFinding[] = [];
  for (const pkg of resolved) {
    if (!pkg.ownCapabilities) continue;
    const excessFs = pkg.ownCapabilities.filesystem && !ownCapabilities.filesystem;
    const excessNet = pkg.ownCapabilities.network && !ownCapabilities.network;
    if (!excessFs && !excessNet) continue;

    const kinds = [excessFs ? 'filesystem' : null, excessNet ? 'network' : null].filter(Boolean).join(' and ');
    out.push({
      package: pkg.name,
      version: pkg.resolvedVersion ?? pkg.specifier,
      issue: 'excess-capability',
      detail: `Transitive dependency declares ${kinds} capability beyond the plugin's own manifest.`,
    });
  }
  return out;
}

// ─── OSV cross-reference ───────────────────────────────────────────────

/** Strips a leading `^`/`~` and returns the version if it looks queryable; `undefined` for ranges/git/url/`*`/`latest` we can't resolve to a concrete version. */
function cleanVersionForQuery(spec: string): string | undefined {
  const trimmed = spec.trim();
  if (EXACT_SEMVER_RE.test(trimmed)) return trimmed;
  const stripped = trimmed.replace(/^[\^~]/, '');
  return EXACT_SEMVER_RE.test(stripped) ? stripped : undefined;
}

function uniqueQueryablePackages(resolved: ReadonlyArray<ResolvedPackage>): Array<{ name: string; version: string }> {
  const seen = new Set<string>();
  const out: Array<{ name: string; version: string }> = [];
  for (const pkg of resolved) {
    const version = pkg.resolvedVersion ?? cleanVersionForQuery(pkg.specifier);
    if (!version) continue;
    const key = `${pkg.name}@${version}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ name: pkg.name, version });
    if (out.length >= MAX_OSV_QUERIES) break;
  }
  return out;
}

interface OsvRawVuln {
  readonly id: string;
  readonly severity?: ReadonlyArray<{ readonly type?: string; readonly score?: string }>;
  readonly database_specific?: { readonly severity?: string };
}

function severityFromOsvVuln(v: OsvRawVuln): DependencyFinding['severity'] {
  switch (v.database_specific?.severity?.toUpperCase()) {
    case 'LOW':
      return 'low';
    case 'MODERATE':
    case 'MEDIUM':
      return 'medium';
    case 'HIGH':
      return 'high';
    case 'CRITICAL':
      return 'critical';
    default:
      return undefined;
  }
}

async function queryOsvSingle(
  pkg: { name: string; version: string },
  timeoutMs: number,
  fetchImpl: typeof fetch,
): Promise<OsvRawVuln[]> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(OSV_QUERY_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ package: { name: pkg.name, ecosystem: 'npm' }, version: pkg.version }),
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`OSV query failed: HTTP ${response.status}`);
    const data = (await response.json()) as { vulns?: OsvRawVuln[] };
    return data.vulns ?? [];
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Queries OSV for every candidate package in parallel. `scanned: false` is
 * returned only when *every* query failed (OSV wholly unreachable) — a
 * partial outage still yields `scanned: true` with whatever data came back,
 * per ADR-320's "must degrade gracefully (warn, don't block)" requirement.
 */
async function crossReferenceOsv(
  packages: ReadonlyArray<{ name: string; version: string }>,
  timeoutMs: number,
  fetchImpl: typeof fetch,
): Promise<{ scanned: boolean; findings: DependencyFinding[] }> {
  if (packages.length === 0) return { scanned: true, findings: [] };

  const settled = await Promise.allSettled(packages.map(p => queryOsvSingle(p, timeoutMs, fetchImpl)));
  const allFailed = settled.every(r => r.status === 'rejected');
  if (allFailed) {
    console.warn('[PluginPublishScanner] OSV cross-reference unreachable; dependencyRisk.scanned=false for this run.');
    return { scanned: false, findings: [] };
  }

  const findings: DependencyFinding[] = [];
  settled.forEach((result, i) => {
    if (result.status !== 'fulfilled' || result.value.length === 0) return;
    const pkg = packages[i];
    for (const vuln of result.value) {
      findings.push({
        package: pkg.name,
        version: pkg.version,
        issue: 'known-vulnerable',
        detail: `OSV advisory ${vuln.id} affects ${pkg.name}@${pkg.version}.`,
        severity: severityFromOsvVuln(vuln),
      });
    }
  });
  return { scanned: true, findings };
}
