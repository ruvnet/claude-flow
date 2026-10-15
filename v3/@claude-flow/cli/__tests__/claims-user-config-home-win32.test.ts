/**
 * `claims check` must find the user-level policy at
 * <home>/.config/claude-flow/claims.json on every platform.
 *
 * The lookup used `resolve(process.env.HOME || '~', ...)`. On Windows HOME is
 * normally unset, so the path became `<cwd>/~/.config/claude-flow/claims.json`
 * — a literal "~" directory under whatever folder the command ran from — and
 * the user's real policy in %USERPROFILE% was silently ignored.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { claimsCommand } from '../src/commands/claims.js';

const SAVED_ENV = { ...process.env };
const SAVED_CWD = process.cwd();

describe('claims user-level config lookup', () => {
  let home: string;
  let project: string;

  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), 'claims-home-'));
    project = mkdtempSync(join(tmpdir(), 'claims-project-'));
    mkdirSync(join(home, '.config', 'claude-flow'), { recursive: true });
    writeFileSync(
      join(home, '.config', 'claude-flow', 'claims.json'),
      JSON.stringify({ users: { alice: { claims: ['admin:delete'] } } }),
    );
    // Point the OS home directory at the fixture. On Windows os.homedir()
    // reads USERPROFILE and HOME is normally absent; elsewhere it reads HOME.
    if (process.platform === 'win32') {
      delete process.env.HOME;
      process.env.USERPROFILE = home;
    } else {
      process.env.HOME = home;
    }
    process.chdir(project);
  });

  afterEach(() => {
    process.chdir(SAVED_CWD);
    process.env = { ...SAVED_ENV };
    rmSync(home, { recursive: true, force: true });
    rmSync(project, { recursive: true, force: true });
  });

  it('grants a claim defined only in the home-directory policy', async () => {
    const check = claimsCommand.subcommands!.find((c) => c.name === 'check')!;
    const result = await check.action!({
      args: [],
      flags: { claim: 'admin:delete', user: 'alice' },
      cwd: project,
      interactive: false,
    } as never);
    expect(result).toMatchObject({ success: true });
  });
});
