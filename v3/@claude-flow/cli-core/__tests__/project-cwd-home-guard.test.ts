/**
 * getProjectCwd() home/root guard (MCP split-brain fix).
 *
 * CLAUDE_FLOW_CWD pointing at the home directory or a filesystem root means
 * "no project" and must fall back to process.cwd(). The previous guard only
 * compared against '/' and process.env.HOME — HOME is normally unset on
 * Windows (USERPROFILE is used) and 'C:\' is not '/', so both checks were
 * no-ops there and MCP tools wrote project state under the user's home.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join, parse, sep } from 'node:path';
import { getProjectCwd } from '../src/mcp-tools/types.js';

const SAVED = { ...process.env };

describe('getProjectCwd home/root guard', () => {
  let project: string;

  beforeEach(() => {
    project = mkdtempSync(join(tmpdir(), 'project-cwd-'));
  });

  afterEach(() => {
    process.env = { ...SAVED };
    rmSync(project, { recursive: true, force: true });
  });

  it('honours CLAUDE_FLOW_CWD when it names a real project directory', () => {
    process.env.CLAUDE_FLOW_CWD = project;
    expect(getProjectCwd()).toBe(project);
  });

  it('ignores CLAUDE_FLOW_CWD equal to os.homedir() even when $HOME is unset (Windows)', () => {
    const home = homedir();
    delete process.env.HOME;
    process.env.CLAUDE_FLOW_CWD = home;
    expect(getProjectCwd()).toBe(process.cwd());
  });

  it('ignores home spelled with a trailing separator, or different case on win32', () => {
    const home = homedir();
    delete process.env.HOME;
    process.env.CLAUDE_FLOW_CWD = (process.platform === 'win32' ? home.toUpperCase() : home) + sep;
    expect(getProjectCwd()).toBe(process.cwd());
  });

  it('ignores a filesystem root on every platform (C:\\ as well as /)', () => {
    process.env.CLAUDE_FLOW_CWD = parse(project).root;
    expect(getProjectCwd()).toBe(process.cwd());
  });

  it('falls back to process.cwd() when CLAUDE_FLOW_CWD is unset', () => {
    delete process.env.CLAUDE_FLOW_CWD;
    expect(getProjectCwd()).toBe(process.cwd());
  });
});
