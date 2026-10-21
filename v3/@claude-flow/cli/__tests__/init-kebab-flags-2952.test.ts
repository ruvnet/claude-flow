/**
 * #2952: `init --all-agents`, `--skip-claude`, `--only-claude`, `--cloud-mcp`
 * were silent no-ops.
 *
 * Root cause: every long-flag write path in the parser goes through
 * `normalizeKey()` (parser.ts), which converts kebab-case to camelCase
 * before storing — `--all-agents` lands as `flags.allAgents`, never as the
 * literal `flags['all-agents']`. `initClaudeAction` (commands/init.ts) read
 * the literal kebab-case keys, so all four reads were always `undefined`.
 * Same bug class the code already fixed for `--no-global` (#2098A) five
 * lines above — that fix was never applied to these sibling flags.
 *
 * `--all-agents` is the most observable of the four: it switches the
 * installed agent set from the ~17-agent curated default to the full
 * ~89-agent catalog (ADR-128 Phase 3, `options.agents.all = true`). Black-box
 * against the real built CLI — same pattern as mcp-http-foreground-2984 —
 * because the bug is in how the parser's actual output key and the command's
 * read key disagree, which a unit test against either side alone wouldn't
 * catch.
 *
 * #3370: the spawned CLI must not touch the developer's real home. `init`
 * writes `~/.claude/CLAUDE.md` and `~/.codex/config.toml`, and shells out to
 * `codex plugin marketplace add` (a network clone that outlives the 20 s
 * timeout as an orphan). So every spawn gets a throwaway HOME/CODEX_HOME and a
 * stub `codex` first on PATH that fails fast, which init treats as a non-fatal
 * skip.
 */
import { describe, it, expect } from 'vitest';
import { execFileSync } from 'child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { delimiter, join } from 'path';
import { tmpdir } from 'os';

const CLI_BIN = fileURLToPath(new URL('../bin/cli.js', import.meta.url));
const CLI_BUILT = existsSync(CLI_BIN);

function countAgentFiles(cwd: string): number {
  const dir = join(cwd, '.claude', 'agents');
  if (!existsSync(dir)) return 0;
  let count = 0;
  const walk = (d: string) => {
    for (const entry of readdirSync(d, { withFileTypes: true })) {
      const p = join(d, entry.name);
      if (entry.isDirectory()) walk(p);
      else if (entry.name.endsWith('.md')) count++;
    }
  };
  walk(dir);
  return count;
}

/** Throwaway home + fail-fast `codex` stub; the spawned CLI sees only these. */
function makeIsolatedHome(): { home: string; env: NodeJS.ProcessEnv } {
  const home = mkdtempSync(join(tmpdir(), 'ruflo-2952-home-'));
  const bin = join(home, 'bin');
  mkdirSync(bin, { recursive: true });
  const stub = join(bin, 'codex');
  writeFileSync(stub, '#!/bin/sh\nexit 1\n');
  chmodSync(stub, 0o755);
  return {
    home,
    env: {
      ...process.env,
      HOME: home,
      USERPROFILE: home,
      CODEX_HOME: join(home, '.codex'),
      PATH: `${bin}${delimiter}${process.env.PATH ?? ''}`,
    },
  };
}

describe.skipIf(!CLI_BUILT)('#2952 init reads the parser\'s actual (camelCase) flag keys', () => {
  it('--all-agents installs strictly more agents than the curated default', () => {
    const defaultCwd = mkdtempSync(join(tmpdir(), 'ruflo-2952-default-'));
    const allAgentsCwd = mkdtempSync(join(tmpdir(), 'ruflo-2952-all-'));
    const { home, env } = makeIsolatedHome();
    try {
      execFileSync(process.execPath, [CLI_BIN, 'init', '--force'], {
        cwd: defaultCwd,
        env,
        timeout: 30_000,
        stdio: 'pipe',
      });
      execFileSync(process.execPath, [CLI_BIN, 'init', '--force', '--all-agents'], {
        cwd: allAgentsCwd,
        env,
        timeout: 30_000,
        stdio: 'pipe',
      });

      const defaultCount = countAgentFiles(defaultCwd);
      const allAgentsCount = countAgentFiles(allAgentsCwd);

      // Pre-fix: `ctx.flags['all-agents']` was always undefined, so both
      // runs installed the same curated default set — this assertion is
      // exactly what the bug made false.
      expect(allAgentsCount).toBeGreaterThan(defaultCount);
    } finally {
      rmSync(defaultCwd, { recursive: true, force: true });
      rmSync(allAgentsCwd, { recursive: true, force: true });
      rmSync(home, { recursive: true, force: true });
    }
  }, 60_000);
});
