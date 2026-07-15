/**
 * Tests for analyzeDependencyGraph (ADR-320 P2 / Part A Stage 2, ruvnet/ruflo#2630).
 *
 * London-style: the OSV feed is an injected collaborator (`config.fetchImpl`),
 * mocked here so no test touches the real network. Covers the ADR-320 P2
 * behaviors: unpinned-version detection, OSV known-vulnerable cross-reference,
 * excess-capability on transitive deps, and the "degrade gracefully — never
 * throw, scanned:false only when OSV is WHOLLY unreachable" contract.
 */

import { describe, it, expect, afterAll, vi } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  analyzeDependencyGraph,
  type DependencyFinding,
} from '../src/plugins/dependency-graph.js';

const createdDirs: string[] = [];
function makeDir(files: Record<string, string>): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'depgraph-'));
  createdDirs.push(dir);
  for (const [rel, contents] of Object.entries(files)) {
    const full = path.join(dir, rel);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, contents, 'utf-8');
  }
  return dir;
}
afterAll(() => {
  for (const d of createdDirs) { try { fs.rmSync(d, { recursive: true, force: true }); } catch { /* noop */ } }
});

/** Minimal Response-like object for the mocked fetch. */
function osvResponse(vulns: unknown[]): any {
  return { ok: true, status: 200, json: async () => ({ vulns }) };
}

/** A fetch mock that returns `vulns` for packages whose name is in `vulnerable`, empty otherwise. */
function fetchReturningVulnsFor(vulnerable: Record<string, unknown[]>) {
  return vi.fn(async (_url: string, opts: any) => {
    const body = JSON.parse(opts.body);
    const name = body.package.name as string;
    return osvResponse(vulnerable[name] ?? []);
  });
}

const issues = (findings: ReadonlyArray<DependencyFinding>) => findings.map(f => f.issue);

describe('analyzeDependencyGraph — unpinned-version', () => {
  it('flags non-exact specifiers but not exact pins', async () => {
    const dir = makeDir({
      'package.json': JSON.stringify({
        name: 'p', version: '1.0.0',
        dependencies: { 'pkg-caret': '^1.0.0', 'pkg-star': '*', 'pkg-exact': '1.2.3' },
      }),
    });
    const fetchImpl = fetchReturningVulnsFor({});
    const report = await analyzeDependencyGraph(dir, { fetchImpl });

    const unpinned = report.findings.filter(f => f.issue === 'unpinned-version').map(f => f.package);
    expect(unpinned).toContain('pkg-caret');
    expect(unpinned).toContain('pkg-star');
    expect(unpinned).not.toContain('pkg-exact');
    expect(report.scanned).toBe(true);
  });
});

describe('analyzeDependencyGraph — OSV known-vulnerable', () => {
  it('maps an OSV advisory to a known-vulnerable finding with severity', async () => {
    const dir = makeDir({
      'package.json': JSON.stringify({
        name: 'p', version: '1.0.0',
        dependencies: { 'evil-pkg': '1.0.0', 'safe-pkg': '2.0.0' },
      }),
    });
    const fetchImpl = fetchReturningVulnsFor({
      'evil-pkg': [{ id: 'GHSA-xxxx', database_specific: { severity: 'CRITICAL' } }],
    });
    const report = await analyzeDependencyGraph(dir, { fetchImpl });

    expect(report.scanned).toBe(true);
    const vuln = report.findings.find(f => f.issue === 'known-vulnerable');
    expect(vuln).toBeDefined();
    expect(vuln!.package).toBe('evil-pkg');
    expect(vuln!.severity).toBe('critical');
    expect(vuln!.detail).toContain('GHSA-xxxx');
  });
});

describe('analyzeDependencyGraph — graceful degradation', () => {
  it('returns scanned:false with local findings when EVERY OSV query fails', async () => {
    const dir = makeDir({
      'package.json': JSON.stringify({
        name: 'p', version: '1.0.0',
        dependencies: { 'pkg-caret': '^1.0.0' }, // queryable AND unpinned
      }),
    });
    const fetchImpl = vi.fn(async () => { throw new Error('OSV unreachable'); });
    const report = await analyzeDependencyGraph(dir, { fetchImpl });

    expect(report.scanned).toBe(false);
    // Local (non-network) findings survive the OSV outage.
    expect(issues(report.findings)).toContain('unpinned-version');
  });

  it('returns scanned:true on a PARTIAL outage (some queries succeed)', async () => {
    const dir = makeDir({
      'package.json': JSON.stringify({
        name: 'p', version: '1.0.0',
        dependencies: { 'flaky-pkg': '1.0.0', 'evil-pkg': '2.0.0' },
      }),
    });
    const fetchImpl = vi.fn(async (_url: string, opts: any) => {
      const name = JSON.parse(opts.body).package.name;
      if (name === 'flaky-pkg') throw new Error('timeout');
      return osvResponse([{ id: 'OSV-1', database_specific: { severity: 'HIGH' } }]);
    });
    const report = await analyzeDependencyGraph(dir, { fetchImpl });

    expect(report.scanned).toBe(true);
    expect(report.findings.some(f => f.issue === 'known-vulnerable' && f.package === 'evil-pkg')).toBe(true);
  });

  it('returns scanned:false with no findings when there is no package.json', async () => {
    const dir = makeDir({ 'index.js': 'export const x = 1;\n' });
    const report = await analyzeDependencyGraph(dir, { fetchImpl: fetchReturningVulnsFor({}) });
    expect(report).toEqual({ scanned: false, findings: [] });
  });
});

describe('analyzeDependencyGraph — excess-capability (transitive)', () => {
  it('flags a transitive dep declaring a capability beyond the plugin manifest', async () => {
    const dir = makeDir({
      'package.json': JSON.stringify({
        name: 'p', version: '1.0.0',
        dependencies: { 'greedy-dep': '1.0.0' },
        // plugin itself declares NO network capability
      }),
      'node_modules/greedy-dep/package.json': JSON.stringify({
        name: 'greedy-dep', version: '1.0.0',
        'claude-flow': { capabilities: { network: true } },
      }),
    });
    const report = await analyzeDependencyGraph(dir, { fetchImpl: fetchReturningVulnsFor({}) });

    const excess = report.findings.find(f => f.issue === 'excess-capability');
    expect(excess).toBeDefined();
    expect(excess!.package).toBe('greedy-dep');
    expect(excess!.detail).toContain('network');
  });

  it('does NOT flag a transitive dep whose capability the plugin also declares', async () => {
    const dir = makeDir({
      'package.json': JSON.stringify({
        name: 'p', version: '1.0.0',
        dependencies: { 'net-dep': '1.0.0' },
        'claude-flow': { capabilities: { network: true } }, // plugin declares network too
      }),
      'node_modules/net-dep/package.json': JSON.stringify({
        name: 'net-dep', version: '1.0.0',
        'claude-flow': { capabilities: { network: true } },
      }),
    });
    const report = await analyzeDependencyGraph(dir, { fetchImpl: fetchReturningVulnsFor({}) });
    expect(issues(report.findings)).not.toContain('excess-capability');
  });
});
