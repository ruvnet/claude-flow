/**
 * Regression guard for #2790 — two independent defects the reporter
 * (markt-heximal) found in memory/embeddings search:
 *
 *   1. --type keyword|hybrid silently ignored (only semantic ran)
 *   2. --threshold 0 silently replaced by fallback (non-monotonic:
 *      threshold 0 returned FEWER results than threshold 0.01)
 *
 * Both are exercised via real execFileSync against bin/cli.js in a
 * temp cwd — the wire is the actual regression surface, not the
 * pure logic.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const CLI = join(__dirname, '..', 'bin', 'cli.js');

function run(args: string[], cwd: string): { stdout: string; exit: number } {
  try {
    const stdout = execFileSync('node', [CLI, ...args], { cwd, encoding: 'utf-8', stdio: ['ignore', 'pipe', 'pipe'] });
    return { stdout, exit: 0 };
  } catch (err) {
    const e = err as { status?: number; stdout?: Buffer; stderr?: Buffer };
    return {
      stdout: (e.stdout?.toString() ?? '') + (e.stderr?.toString() ?? ''),
      exit: e.status ?? -1,
    };
  }
}

describe('#2790 memory search wiring bugs', () => {
  let workdir: string;
  const NAMESPACE = 'e2e-2790';
  const KEY = 'notes';
  const VALUE = 'Deployment notes for the storage subsystem: replication factor, shard rebalancing, snapshot retention policy, and quorum configuration for the cluster.';

  beforeAll(() => {
    workdir = mkdtempSync(join(tmpdir(), 'ruflo-2790-'));
    run(['memory', 'init'], workdir);
    run(['memory', 'store', '--namespace', NAMESPACE, '--key', KEY, '--value', VALUE], workdir);
  }, 60_000);

  afterAll(() => {
    try { rmSync(workdir, { recursive: true, force: true }); } catch { /* ignore */ }
  });

  it('--type keyword returns entries whose content contains the query substring', () => {
    // "rebalancing" is a literal substring of the stored value and is
    // unlikely to score high under semantic — before #2790 this returned 0.
    const { stdout } = run(['memory', 'search', '-q', 'rebalancing', '--namespace', NAMESPACE, '--type', 'keyword'], workdir);
    expect(stdout).toMatch(/notes/);
    expect(stdout).toMatch(/Found \d+ result/i);
  }, 60_000);

  it('--type keyword returns 0 hits for a genuinely absent substring', () => {
    const { stdout } = run(['memory', 'search', '-q', 'this-string-is-not-present-anywhere', '--namespace', NAMESPACE, '--type', 'keyword'], workdir);
    expect(stdout).toMatch(/Found 0 result/i);
  }, 60_000);

  it('--type hybrid returns at least the semantic result set', () => {
    const semantic = run(['memory', 'search', '-q', 'storage', '--namespace', NAMESPACE, '--type', 'semantic', '--format', 'json'], workdir);
    const hybrid = run(['memory', 'search', '-q', 'storage', '--namespace', NAMESPACE, '--type', 'hybrid', '--format', 'json'], workdir);
    const semanticJson = JSON.parse(semantic.stdout.slice(semantic.stdout.indexOf('{')));
    const hybridJson = JSON.parse(hybrid.stdout.slice(hybrid.stdout.indexOf('{')));
    expect(hybridJson.results.length).toBeGreaterThanOrEqual(semanticJson.results.length);
  }, 60_000);

  it('--threshold 0 returns at least as many results as --threshold 0.01 (monotonic)', () => {
    const zero = run(['memory', 'search', '-q', 'snapshot', '--namespace', NAMESPACE, '--threshold', '0', '--format', 'json'], workdir);
    const nonzero = run(['memory', 'search', '-q', 'snapshot', '--namespace', NAMESPACE, '--threshold', '0.01', '--format', 'json'], workdir);
    const zeroJson = JSON.parse(zero.stdout.slice(zero.stdout.indexOf('{')));
    const nonzeroJson = JSON.parse(nonzero.stdout.slice(nonzero.stdout.indexOf('{')));
    // The reporter's diagnostic invariant: lower threshold must not return
    // FEWER results. If it does, the flag was ignored.
    expect(zeroJson.results.length).toBeGreaterThanOrEqual(nonzeroJson.results.length);
  }, 60_000);
});
