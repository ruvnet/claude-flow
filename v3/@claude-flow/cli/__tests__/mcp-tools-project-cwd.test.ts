/**
 * Unit tests for getProjectCwd() — Windows MCP System32 guard (issue #1577)
 *
 * These tests cannot reproduce the original Windows failure on macOS/Linux,
 * so they mock process.cwd() and process.env to exercise every branch of the
 * resolver. The goal is to verify:
 *
 *   1. System32 cwd is rejected and something safer is returned
 *   2. The agent-agnostic env var chain is honored in priority order
 *   3. Env vars pointing at system dirs are themselves rejected
 *   4. '/' and '' and undefined are all treated as system dirs
 *   5. Results are memoized across calls
 *   6. Normal macOS/Linux cwd passes through unchanged (regression guard)
 *
 * Reset the cache between tests via the exported _resetProjectCwdCache helper.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { homedir } from 'node:os';
import { _resetProjectCwdCache, getProjectCwd } from '../src/mcp-tools/types.js';

const PROJECT_DIR_ENV_VARS = [
  'CLAUDE_FLOW_PROJECT_DIR',
  'CLAUDE_PROJECT_DIR',
  'INIT_CWD',
  'CLAUDE_FLOW_CWD',
];

describe('getProjectCwd (issue #1577 Windows guard)', () => {
  let savedEnv: Record<string, string | undefined>;
  let cwdSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    // Snapshot and clear the env vars we touch, so host env can't leak in.
    savedEnv = {};
    for (const key of PROJECT_DIR_ENV_VARS) {
      savedEnv[key] = process.env[key];
      delete process.env[key];
    }
    _resetProjectCwdCache();
    cwdSpy = vi.spyOn(process, 'cwd');
  });

  afterEach(() => {
    // Restore env vars
    for (const key of PROJECT_DIR_ENV_VARS) {
      if (savedEnv[key] === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = savedEnv[key];
      }
    }
    _resetProjectCwdCache();
    cwdSpy.mockRestore();
  });

  // ── Regression guard: normal platforms ────────────────────────────

  it('returns process.cwd() unchanged on a normal macOS/Linux path', () => {
    cwdSpy.mockReturnValue('/Users/alice/project');
    expect(getProjectCwd()).toBe('/Users/alice/project');
  });

  it('returns process.cwd() unchanged on a normal Windows path', () => {
    cwdSpy.mockReturnValue('C:\\Users\\alice\\project');
    expect(getProjectCwd()).toBe('C:\\Users\\alice\\project');
  });

  // ── System32 rejection (the actual bug) ───────────────────────────

  it('rejects C:\\Windows\\System32 as cwd and falls back to home', () => {
    cwdSpy.mockReturnValue('C:\\Windows\\System32');
    expect(getProjectCwd()).toBe(homedir());
  });

  it('rejects C:\\WINDOWS\\system32 (case-insensitive match)', () => {
    cwdSpy.mockReturnValue('C:\\WINDOWS\\system32');
    expect(getProjectCwd()).toBe(homedir());
  });

  it('rejects forward-slash C:/Windows/System32 form', () => {
    cwdSpy.mockReturnValue('C:/Windows/System32');
    expect(getProjectCwd()).toBe(homedir());
  });

  it('rejects C:\\Windows\\SysWOW64 (still under C:\\Windows)', () => {
    cwdSpy.mockReturnValue('C:\\Windows\\SysWOW64');
    expect(getProjectCwd()).toBe(homedir());
  });

  it("rejects bare '/' from old global/npx installs", () => {
    cwdSpy.mockReturnValue('/');
    expect(getProjectCwd()).toBe(homedir());
  });

  // ── Env var chain priority ────────────────────────────────────────

  it('honors CLAUDE_FLOW_PROJECT_DIR over process.cwd()', () => {
    cwdSpy.mockReturnValue('/Users/alice/project');
    process.env.CLAUDE_FLOW_PROJECT_DIR = '/opt/my-project';
    expect(getProjectCwd()).toBe('/opt/my-project');
  });

  it('honors CLAUDE_FLOW_PROJECT_DIR even when cwd would be System32', () => {
    cwdSpy.mockReturnValue('C:\\Windows\\System32');
    process.env.CLAUDE_FLOW_PROJECT_DIR = 'D:\\work\\my-project';
    expect(getProjectCwd()).toBe('D:\\work\\my-project');
  });

  it('falls through to CLAUDE_PROJECT_DIR when CLAUDE_FLOW_PROJECT_DIR is unset', () => {
    cwdSpy.mockReturnValue('C:\\Windows\\System32');
    process.env.CLAUDE_PROJECT_DIR = 'D:\\work\\claude-project';
    expect(getProjectCwd()).toBe('D:\\work\\claude-project');
  });

  it('falls through to INIT_CWD when higher-priority vars are unset', () => {
    cwdSpy.mockReturnValue('C:\\Windows\\System32');
    process.env.INIT_CWD = 'D:\\work\\init-cwd';
    expect(getProjectCwd()).toBe('D:\\work\\init-cwd');
  });

  it('honors legacy CLAUDE_FLOW_CWD as the lowest-priority env var', () => {
    cwdSpy.mockReturnValue('C:\\Windows\\System32');
    process.env.CLAUDE_FLOW_CWD = 'D:\\legacy\\project';
    expect(getProjectCwd()).toBe('D:\\legacy\\project');
  });

  it('priority order: FLOW_PROJECT_DIR > CLAUDE_PROJECT_DIR > INIT_CWD > FLOW_CWD', () => {
    cwdSpy.mockReturnValue('/Users/alice/project');
    process.env.CLAUDE_FLOW_PROJECT_DIR = '/first';
    process.env.CLAUDE_PROJECT_DIR = '/second';
    process.env.INIT_CWD = '/third';
    process.env.CLAUDE_FLOW_CWD = '/fourth';
    expect(getProjectCwd()).toBe('/first');
  });

  // ── Env vars pointing at system dirs must be skipped ──────────────

  it('skips CLAUDE_FLOW_PROJECT_DIR when it itself points at System32', () => {
    cwdSpy.mockReturnValue('/Users/alice/project');
    process.env.CLAUDE_FLOW_PROJECT_DIR = 'C:\\Windows\\System32';
    expect(getProjectCwd()).toBe('/Users/alice/project');
  });

  it('skips every env var when all point at system dirs, returns cwd', () => {
    cwdSpy.mockReturnValue('/Users/alice/project');
    process.env.CLAUDE_FLOW_PROJECT_DIR = 'C:\\Windows\\System32';
    process.env.CLAUDE_PROJECT_DIR = 'C:/Windows/System32';
    process.env.INIT_CWD = 'C:\\Windows';
    process.env.CLAUDE_FLOW_CWD = '/';
    expect(getProjectCwd()).toBe('/Users/alice/project');
  });

  it('skips env vars and cwd when all point at system dirs, falls back to home', () => {
    cwdSpy.mockReturnValue('C:\\Windows\\System32');
    process.env.CLAUDE_FLOW_PROJECT_DIR = 'C:\\Windows';
    process.env.CLAUDE_PROJECT_DIR = '/';
    expect(getProjectCwd()).toBe(homedir());
  });

  it('ignores empty-string env vars (treats them as unset)', () => {
    cwdSpy.mockReturnValue('/Users/alice/project');
    process.env.CLAUDE_FLOW_PROJECT_DIR = '';
    expect(getProjectCwd()).toBe('/Users/alice/project');
  });

  // ── Memoization ───────────────────────────────────────────────────

  it('memoizes the result and does not re-probe cwd on subsequent calls', () => {
    cwdSpy.mockReturnValue('/Users/alice/project');
    expect(getProjectCwd()).toBe('/Users/alice/project');

    // After the first call, changing cwd and env must not affect output
    cwdSpy.mockReturnValue('/Users/alice/other');
    process.env.CLAUDE_FLOW_PROJECT_DIR = '/somewhere/else';
    expect(getProjectCwd()).toBe('/Users/alice/project');
  });

  it('memoizes even when the first resolution fell back to home', () => {
    cwdSpy.mockReturnValue('C:\\Windows\\System32');
    const first = getProjectCwd();
    expect(first).toBe(homedir());

    // After falling back to home, subsequent calls must return home
    // regardless of what cwd/env look like
    cwdSpy.mockReturnValue('/Users/alice/recovered');
    expect(getProjectCwd()).toBe(first);
  });

  it('_resetProjectCwdCache clears memoization so tests stay isolated', () => {
    cwdSpy.mockReturnValue('/a');
    expect(getProjectCwd()).toBe('/a');

    _resetProjectCwdCache();
    cwdSpy.mockReturnValue('/b');
    expect(getProjectCwd()).toBe('/b');
  });

  // ── Defensive: process.cwd() throwing ─────────────────────────────

  it('survives process.cwd() throwing (e.g. ENOENT on a deleted dir) by falling back to home', () => {
    cwdSpy.mockImplementation(() => {
      throw new Error('ENOENT: no such file or directory, uv_cwd');
    });
    expect(getProjectCwd()).toBe(homedir());
  });

  it('survives process.cwd() throwing and still honors env vars', () => {
    cwdSpy.mockImplementation(() => {
      throw new Error('ENOENT');
    });
    process.env.CLAUDE_FLOW_PROJECT_DIR = '/env/override';
    expect(getProjectCwd()).toBe('/env/override');
  });
});
