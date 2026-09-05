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
 */
import { describe, it, expect } from 'vitest';
import { execFileSync } from 'child_process';
import { existsSync, mkdtempSync, readdirSync, rmSync } from 'fs';
import { fileURLToPath } from 'url';
import { join } from 'path';
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

describe.skipIf(!CLI_BUILT)('#2952 init reads the parser\'s actual (camelCase) flag keys', () => {
  it('--all-agents installs strictly more agents than the curated default', () => {
    const defaultCwd = mkdtempSync(join(tmpdir(), 'ruflo-2952-default-'));
    const allAgentsCwd = mkdtempSync(join(tmpdir(), 'ruflo-2952-all-'));
    try {
      execFileSync(process.execPath, [CLI_BIN, 'init', '--force'], {
        cwd: defaultCwd,
        timeout: 30_000,
        stdio: 'pipe',
      });
      execFileSync(process.execPath, [CLI_BIN, 'init', '--force', '--all-agents'], {
        cwd: allAgentsCwd,
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
    }
  }, 60_000);
});
