/**
 * `security scan` used to fail open on an unrecognised --depth, --type or
 * --target.
 *
 * An unknown --type matched none of the three phase guards, so no phase ran at
 * all and the command still printed "No security issues found!" and exited 0.
 * An unknown --depth fell through the chained ternaries to the shallowest
 * traversal, so `--depth full` scanned *less* than the default `standard` — and
 * because it dropped the HIGH-severity finding, it also flipped the
 * critical/high exit-code gate from 1 to 0. A non-existent --target read
 * nothing, and the swallowed dir-read catches turned that into a clean banner,
 * exit 0, and a PERSISTED clean report. A typo was indistinguishable from a
 * clean bill of health.
 *
 * `full` is a special case: the CLI itself emitted that string (statusline
 * insight, announcement, generated CLAUDE.md, shipped agent defs), so it is
 * normalised to `deep` with a warning rather than hard-rejected.
 *
 * Black-box against the real built CLI binary, matching the convention in
 * security-scan-persistence.test.ts (no test in this repo reconstructs a
 * CommandContext by hand). NOTE: bin/cli.js runs dist/, so `npx tsc` must have
 * run for these to exercise the current source.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { spawnSync } from 'child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, existsSync, readdirSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { fileURLToPath } from 'url';

const CLI_BIN = fileURLToPath(new URL('../bin/cli.js', import.meta.url));

let scanTarget: string;

/**
 * Run `security scan` against the fixture. stdout and stderr are kept separate:
 * diagnostics go to stderr, and a caller redirecting stdout to a file must not
 * silently receive an empty document with no explanation.
 */
function scan(...args: string[]) {
  const res = spawnSync(process.execPath, [CLI_BIN, 'security', 'scan', '--target', scanTarget, ...args], {
    encoding: 'utf-8',
    timeout: 60_000,
  });
  const stdout = res.stdout ?? '';
  const stderr = res.stderr ?? '';
  return { code: res.status, stdout, stderr, out: `${stdout}${stderr}` };
}

beforeEach(() => {
  scanTarget = mkdtempSync(join(tmpdir(), 'security-scan-enum-'));
  writeFileSync(
    join(scanTarget, 'package.json'),
    JSON.stringify({ name: 'security-scan-enum-fixture', version: '1.0.0' }),
  );
  // MEDIUM at the root. Found by the code-pattern phase, gated on depth !== 'quick'.
  writeFileSync(join(scanTarget, 'root-eval.ts'), 'export const r = (x: string) => eval(x);\n');
  // HIGH at the root, reachable by the secret phase at every depth — so `quick`
  // is demonstrably a shallow scan rather than a no-op.
  writeFileSync(join(scanTarget, 'root-secret.ts'), 'export const k = "AKIAIOSFODNN7EXAMPLE";\n');
  // HIGH at nesting level 3: inside standard's budget (5), outside quick's (3).
  mkdirSync(join(scanTarget, 'l1', 'l2', 'l3'), { recursive: true });
  writeFileSync(
    join(scanTarget, 'l1', 'l2', 'l3', 'deep-secret.ts'),
    'export const key = "AKIAIOSFODNN7EXAMPLE";\n',
  );
  // HIGH at nesting level 6: inside deep's budget (10), outside standard's (5).
  // Without this, no test distinguishes deep from standard and the deepest scan
  // mode could be gutted while the suite stayed green.
  mkdirSync(join(scanTarget, 'l1', 'l2', 'l3', 'l4', 'l5', 'l6'), { recursive: true });
  writeFileSync(
    join(scanTarget, 'l1', 'l2', 'l3', 'l4', 'l5', 'l6', 'deepest-secret.ts'),
    'export const key = "AKIAIOSFODNN7EXAMPLE";\n',
  );
});

afterEach(() => {
  rmSync(scanTarget, { recursive: true, force: true });
});

describe('security scan — enum flag validation (fails closed)', () => {
  it('still scans normally when both flags are valid', () => {
    const { code, out } = scan('--depth', 'deep', '--type', 'code');
    // Three secrets plus the eval().
    expect(out).toContain('Total Issues: 4');
    // A HIGH finding must keep failing the critical/high gate.
    expect(code).toBe(1);
  });

  it('rejects an unrecognised --depth instead of scanning shallower', () => {
    const { code, out } = scan('--depth', 'bogus-value', '--type', 'all');
    expect(out).toContain("Invalid --depth 'bogus-value'");
    expect(out).toContain('quick, standard, deep');
    expect(code).toBe(1);
  });

  it('rejects an unrecognised --type instead of skipping every phase', () => {
    const { code, out } = scan('--depth', 'deep', '--type', 'bogus-type');
    expect(out).toContain("Invalid --type 'bogus-type'");
    expect(out).toContain('code, deps, all');
    expect(code).toBe(1);
  });

  it('rejects a case-variant --type, since the phase guards are case-sensitive', () => {
    const { code, out } = scan('--depth', 'deep', '--type', 'CODE');
    expect(out).toContain("Invalid --type 'CODE'");
    expect(code).toBe(1);
  });

  it("rejects --type 'container' as unimplemented rather than reporting clean", () => {
    const { code, out } = scan('--depth', 'deep', '--type', 'container');
    expect(out).toContain("--type 'container' is not implemented yet");
    expect(code).toBe(1);
  });

  it('tells a case-variant container it is unimplemented, not misspelled', () => {
    const { code, out } = scan('--depth', 'deep', '--type', 'Container');
    expect(out).toContain('is not implemented yet');
    expect(code).toBe(1);
  });

  it('never prints the clean-result banner for a rejected flag', () => {
    for (const args of [
      ['--depth', 'bogus-value'],
      ['--type', 'bogus-type'],
      ['--type', 'container'],
    ]) {
      const { out } = scan(...args);
      expect(out).not.toContain('No security issues found!');
    }
  });

  it('sends rejection diagnostics to stderr, so a stdout redirect is not silently empty', () => {
    // A shipped agent invocation redirects stdout to a .json file. If the
    // diagnostic went to stdout it would be swallowed by that redirect; if it
    // went nowhere the agent would get an empty file and no explanation.
    const { stdout, stderr } = scan('--type', 'bogus-type');
    expect(stderr).toContain("Invalid --type 'bogus-type'");
    expect(stdout).not.toContain('Invalid --type');
  });

  it('persists no scan report when a flag is rejected', () => {
    scan('--depth', 'deep', '--type', 'bogus-type');
    expect(existsSync(join(scanTarget, '.claude', 'security-scans'))).toBe(false);
  });

  it('cannot write outside .claude/security-scans via a traversing --type', () => {
    // The report path is built as scan-${scanType}-${depth}.json, so an
    // unvalidated --type could shape it. Against the unpatched command this
    // payload wrote <target>/.claude/escaped-deep.json (measured).
    const { code } = scan('--type', '../../../escaped', '--depth', 'deep');
    expect(code).toBe(1);
    const claudeDir = join(scanTarget, '.claude');
    const stray = existsSync(claudeDir)
      ? readdirSync(claudeDir).filter((f) => f.includes('escaped'))
      : [];
    expect(stray).toEqual([]);
  });

  it('treats an empty --depth as absent and uses the documented default', () => {
    const { out } = scan('--depth', '', '--type', 'code');
    expect(out).toContain('Depth: standard');
    expect(out).not.toContain('Invalid --depth');
  });
});

describe("security scan — `--depth full` is a deprecated alias, not a hard failure", () => {
  // The CLI itself printed `--depth full` in its statusline insight,
  // announcement, generated CLAUDE.md and two shipped agent definitions.
  // Rejecting it would break the invocations we told users to run.
  it('accepts full and still scans', () => {
    const { code, stdout } = scan('--depth', 'full', '--type', 'code');
    expect(stdout).toContain('Total Issues: 4');
    expect(code).toBe(1);
  });

  it('warns on stderr that full is deprecated, naming what it was treated as', () => {
    const { stderr } = scan('--depth', 'full', '--type', 'code');
    expect(stderr).toContain("--depth 'full' is deprecated");
    expect(stderr).toContain("treated as 'deep'");
  });

  it('gives full the deep budget, not the shallowest one it used to fall through to', () => {
    // The original bug: 'full' mapped to 3, shallower than the default 5.
    const { stdout } = scan('--depth', 'full', '--type', 'code');
    expect(stdout).toContain('Depth: deep');
  });
});

describe('security scan — --target fails closed', () => {
  it('rejects a target that does not exist instead of reporting it clean', () => {
    const missing = join(scanTarget, 'no', 'such', 'dir');
    const res = spawnSync(process.execPath, [CLI_BIN, 'security', 'scan', '--target', missing], {
      encoding: 'utf-8',
      timeout: 60_000,
    });
    expect(`${res.stdout}${res.stderr}`).toContain('Target does not exist');
    expect(`${res.stdout}${res.stderr}`).not.toContain('No security issues found!');
    expect(res.status).toBe(1);
  });

  it('fabricates no persisted CLEAN report for a non-existent target', () => {
    // The persisted report is the input to getSecurityStatus, which reports
    // CLEAN on total === 0. A typo used to manufacture that signal, and
    // mkdirSync(recursive) even created the directory tree to hold it.
    const missing = join(scanTarget, 'typo-target');
    spawnSync(process.execPath, [CLI_BIN, 'security', 'scan', '--target', missing], {
      encoding: 'utf-8',
      timeout: 60_000,
    });
    expect(existsSync(missing)).toBe(false);
  });

  it('rejects a target that is a file rather than a directory', () => {
    const file = join(scanTarget, 'root-eval.ts');
    const res = spawnSync(process.execPath, [CLI_BIN, 'security', 'scan', '--target', file], {
      encoding: 'utf-8',
      timeout: 60_000,
    });
    expect(`${res.stdout}${res.stderr}`).toContain('Target is not a directory');
    expect(res.status).toBe(1);
  });
});

describe('security scan — depth maps preserve the documented traversal budgets', () => {
  it('deep reaches deeper than standard', () => {
    // Level-6 secret is inside deep's budget (10) only. Without this assertion
    // deep could be cut to 4 and every other test would still pass.
    const { stdout } = scan('--depth', 'deep', '--type', 'code');
    expect(stdout).toContain('Total Issues: 4');
  });

  it('standard stops short of the level-6 secret', () => {
    const { stdout } = scan('--depth', 'standard', '--type', 'code');
    expect(stdout).toContain('Total Issues: 3');
  });

  it('quick stays shallow — the root secret only, not the nested ones', () => {
    // quick's secret budget (3) excludes l1/l2/l3, and the code-pattern phase is
    // skipped entirely at this depth. Still a real scan reporting a real
    // finding, unlike the silent no-op an unrecognised --type used to produce.
    const { code, stdout } = scan('--depth', 'quick', '--type', 'code');
    expect(stdout).toContain('Total Issues: 1');
    expect(code).toBe(1);
  });
});
