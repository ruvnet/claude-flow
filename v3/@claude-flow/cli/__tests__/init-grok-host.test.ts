/**
 * #3372: `ruflo init` on a machine with the Grok Build CLI on PATH said nothing
 * about Grok, and no code path in the repo knew the string `grok`.
 *
 * Grok Build 1.0.34 already reads three of the artifacts a plain `ruflo init`
 * writes — the project `.mcp.json`, `.agents/skills/**\/SKILL.md`, and
 * `AGENTS.md`/`CLAUDE.md` — so the fix is a notice, not an installer:
 * `maybeAutoDetectGrok` (commands/init.ts), mirroring `maybeAutoDetectCodex`
 * (ADR-080) minus the package.
 *
 * Two of the assertions below are the load-bearing ones, and they are
 * constraints rather than features:
 *
 *   1. ruflo must never invoke `grok` for anything but detection. The fake
 *      `grok` on PATH logs its argv, and the test asserts the log holds
 *      exactly one line: `--version`. Any `grok mcp add` / `--trust` would
 *      show up here.
 *   2. ruflo must never grant folder trust on the user's behalf. Grok gates
 *      repo-local MCP servers, hooks, project instructions and project skills
 *      on a per-folder decision the *user* records in
 *      `~/.grok/trusted_folders.toml`. The test asserts the throwaway HOME
 *      gains no trust store, and the project gains no `.grok/`.
 *
 * Black-box against the real built CLI, same pattern as
 * init-kebab-flags-2952: the behaviour under test is what a user sees on
 * stdout plus what does *not* appear on disk, neither of which a unit test
 * against the function alone would catch.
 */
import { describe, it, expect } from 'vitest';
import { execFileSync } from 'child_process';
import {
  chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync,
} from 'fs';
import { fileURLToPath } from 'url';
import { delimiter, join } from 'path';
import { tmpdir } from 'os';

const CLI_BIN = fileURLToPath(new URL('../bin/cli.js', import.meta.url));
const CLI_BUILT = existsSync(CLI_BIN);

interface Sandbox {
  cwd: string;
  home: string;
  grokLog: string;
  env: NodeJS.ProcessEnv;
  cleanup: () => void;
}

/**
 * A throwaway HOME plus a fake `grok` that shadows any real install.
 *
 * `init` writes user-level state: it appends a "Ruflo Integration" block to
 * $HOME/.claude/CLAUDE.md, and with the Codex CLI on PATH it registers an
 * `npx ruflo@latest` MCP server and clones the ruflo marketplace into
 * ~/.codex. Without a throwaway HOME, running this suite edits the
 * developer's own global config. USERPROFILE covers Windows, where
 * os.homedir() reads it. CODEX_HOME points inside a regular file so it can
 * never exist or be created — every Codex subcommand that needs its home
 * fails at once, and init treats those as best-effort warnings.
 *
 * PATH is rebuilt rather than prepended to: any directory that already holds
 * a `grok` is dropped, so the fake is the only `grok` reachable and the
 * developer's real Grok CLI is never executed.
 */
function makeSandbox(opts: { withGrok?: boolean } = {}): Sandbox {
  const withGrok = opts.withGrok ?? true;
  const home = mkdtempSync(join(tmpdir(), 'ruflo-grok-home-'));
  const cwd = mkdtempSync(join(tmpdir(), 'ruflo-grok-proj-'));
  const binDir = mkdtempSync(join(tmpdir(), 'ruflo-grok-bin-'));
  const grokLog = join(binDir, 'grok-invocations.log');

  if (withGrok) {
    const fakeGrok = join(binDir, 'grok');
    writeFileSync(
      fakeGrok,
      `#!/bin/sh\nprintf '%s\\n' "$*" >> ${JSON.stringify(grokLog)}\necho "grok 1.0.34 (fake)"\nexit 0\n`,
    );
    chmodSync(fakeGrok, 0o755);
  }

  const sanitizedPath = (process.env.PATH ?? '')
    .split(delimiter)
    .filter(dir => dir && !existsSync(join(dir, 'grok')))
    .join(delimiter);

  const codexHomeBlocker = join(home, 'codex-home-is-a-file');
  writeFileSync(codexHomeBlocker, '');

  return {
    cwd,
    home,
    grokLog,
    env: {
      ...process.env,
      HOME: home,
      USERPROFILE: home,
      CODEX_HOME: join(codexHomeBlocker, '.codex'),
      PATH: [binDir, sanitizedPath].filter(Boolean).join(delimiter),
    },
    cleanup: () => {
      for (const dir of [home, cwd, binDir]) rmSync(dir, { recursive: true, force: true });
    },
  };
}

function runInit(sandbox: Sandbox, extraArgs: string[] = []): string {
  return execFileSync(process.execPath, [CLI_BIN, 'init', '--force', ...extraArgs], {
    cwd: sandbox.cwd,
    env: sandbox.env,
    timeout: 60_000,
    stdio: 'pipe',
    encoding: 'utf-8',
  });
}

describe.skipIf(!CLI_BUILT || process.platform === 'win32')(
  '#3372 init reports Grok Build when grok is on PATH',
  () => {
    it('prints the Grok box, invokes grok only for --version, and grants no trust', () => {
      const sandbox = makeSandbox();
      try {
        const stdout = runInit(sandbox);

        // Pre-fix: no code path anywhere in the repo knew the string `grok`,
        // so none of this appeared.
        expect(stdout).toContain('Grok Build detected');
        // Grok reads .mcp.json directly — that is the whole reason no adapter
        // package is needed.
        expect(stdout).toContain('.mcp.json');
        // The one Grok-specific step, and the one ruflo refuses to take for
        // the user.
        expect(stdout).toContain('/hooks-trust');
        expect(stdout).toContain('does not grant that for you');

        // Constraint 1 — detection only. `commandExists()` runs
        // `grok --version` once; nothing else may ever reach the binary.
        const invocations = readFileSync(sandbox.grokLog, 'utf-8')
          .split('\n')
          .filter(Boolean);
        expect(invocations).toEqual(['--version']);

        // Constraint 2 — ruflo never records a folder-trust decision, and
        // never writes Grok config of any kind.
        expect(existsSync(join(sandbox.home, '.grok', 'trusted_folders.toml'))).toBe(false);
        expect(existsSync(join(sandbox.home, '.grok', 'config.toml'))).toBe(false);
        expect(existsSync(join(sandbox.cwd, '.grok'))).toBe(false);
      } finally {
        sandbox.cleanup();
      }
    }, 90_000);

    it('--no-grok-detect suppresses it (both flag forms are read, as in the #3167 fix)', () => {
      const sandbox = makeSandbox();
      try {
        const stdout = runInit(sandbox, ['--no-grok-detect']);
        expect(stdout).not.toContain('Grok Build detected');
        // Opting out means the probe never runs either.
        expect(existsSync(sandbox.grokLog)).toBe(false);
      } finally {
        sandbox.cleanup();
      }
    }, 90_000);

    it('stays silent under --format json so scripted output stays pure', () => {
      const sandbox = makeSandbox();
      try {
        const stdout = runInit(sandbox, ['--format', 'json']);
        expect(stdout).not.toContain('Grok Build detected');
      } finally {
        sandbox.cleanup();
      }
    }, 90_000);

    // ADR-080's guarantee for the Codex path, restated for Grok: on a machine
    // without the CLI, init behaves exactly as before — this is the assertion
    // that the `commandExists('grok')` gate is load-bearing.
    it('says nothing when grok is not on PATH', () => {
      const sandbox = makeSandbox({ withGrok: false });
      try {
        const stdout = runInit(sandbox);
        expect(stdout).not.toContain('Grok Build detected');
        expect(stdout).not.toContain('/hooks-trust');
      } finally {
        sandbox.cleanup();
      }
    }, 90_000);
  },
);
