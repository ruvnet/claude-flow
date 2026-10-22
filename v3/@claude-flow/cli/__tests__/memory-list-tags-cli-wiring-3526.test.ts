/**
 * Regression guard for a PR #3526 review finding: the CLI's `memory list
 * --tags` flag was parsed (declared as an option, described in --help) but
 * never read from `ctx.flags.tags` or threaded through to `listEntries()`
 * — so it silently returned every row in the namespace regardless of the
 * `--tags` value given. Only `memory_list` (the MCP tool) actually filtered
 * by tags. This drives the real built CLI exactly like a user would (the
 * bug is in wiring at the command-action layer, not in `listEntries`
 * itself, so a unit-level call to `listEntries` wouldn't have caught it).
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const CLI = join(HERE, '..', 'bin', 'cli.js');
const CLI_BUILT = existsSync(CLI);

function run(args: string[], cwd: string): { stdout: string; exit: number | null } {
  try {
    const stdout = execFileSync('node', [CLI, ...args], {
      cwd,
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 60_000,
    });
    return { stdout, exit: 0 };
  } catch (err) {
    const e = err as { status?: number | null; stdout?: Buffer; stderr?: Buffer };
    return {
      stdout: (e.stdout?.toString() ?? '') + (e.stderr?.toString() ?? ''),
      exit: e.status ?? null,
    };
  }
}

function listJson(cwd: string, extraArgs: string[] = []): Array<{ key: string }> {
  const { stdout } = run(['memory', 'list', '-n', 'tagwire3526', '--format', 'json', ...extraArgs], cwd);
  const start = stdout.indexOf('[');
  expect(start).toBeGreaterThanOrEqual(0);
  return JSON.parse(stdout.slice(start)) as Array<{ key: string }>;
}

describe.skipIf(!CLI_BUILT)('memory list --tags CLI wiring (#3526 review)', () => {
  let workdir: string;

  beforeAll(() => {
    workdir = mkdtempSync(join(tmpdir(), 'ruflo-tagwire3526-'));
    run(['memory', 'init'], workdir);
    run(['memory', 'store', '-k', 'a', '-n', 'tagwire3526', '--value', 'has prod tag', '--tags', 'prod'], workdir);
    run(['memory', 'store', '-k', 'b', '-n', 'tagwire3526', '--value', 'has staging tag', '--tags', 'staging'], workdir);
    run(['memory', 'store', '-k', 'c', '-n', 'tagwire3526', '--value', 'no tags at all'], workdir);
  }, 60_000);

  afterAll(() => {
    try { rmSync(workdir, { recursive: true, force: true }); } catch { /* ignore */ }
  });

  it('memory list with no --tags returns every entry in the namespace', () => {
    const entries = listJson(workdir);
    expect(entries.map(e => e.key).sort()).toEqual(['a', 'b', 'c']);
  });

  it('memory list --tags prod filters down to only the matching entry, not every row', () => {
    const entries = listJson(workdir, ['--tags', 'prod']);
    expect(entries.map(e => e.key)).toEqual(['a']);
  });

  it('memory list --tags staging filters to the other matching entry', () => {
    const entries = listJson(workdir, ['--tags', 'staging']);
    expect(entries.map(e => e.key)).toEqual(['b']);
  });

  it('memory list --tags nonexistent returns zero entries, not every row', () => {
    const entries = listJson(workdir, ['--tags', 'nonexistent']);
    expect(entries).toEqual([]);
  });
});
