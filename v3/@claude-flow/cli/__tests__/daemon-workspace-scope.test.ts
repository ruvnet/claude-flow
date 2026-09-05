/**
 * Regression guard for ruvnet/ruflo#1914 — `killStaleDaemons` must only ever
 * reap daemons belonging to the current workspace (ADR-014: per-workspace
 * daemon scope). Before this fix it SIGTERM'd every process whose command line
 * contained `daemon start --foreground`, so `daemon start` in workspace B
 * killed workspace A's daemon.
 *
 * The fix stamps `--workspace <root>` into the forked daemon's argv and filters
 * on it. These tests pin the two pure helpers that implement the filter.
 */
import { describe, it, expect } from 'vitest';
import {
  resolveWorkspaceFlag,
  daemonCommandLineBelongsToWorkspace,
  extractWorkspaceFromDaemonLine,
} from '../src/commands/daemon.js';

const psLine = (root: string, pid = 4242, extra = '') =>
  `${pid} node /usr/local/lib/node_modules/@claude-flow/cli/bin/cli.js daemon start --foreground --quiet${extra} --workspace ${root}`;

describe('#1914 — daemon workspace scoping', () => {
  describe('daemonCommandLineBelongsToWorkspace', () => {
    it('matches a daemon line stamped with this workspace', () => {
      expect(daemonCommandLineBelongsToWorkspace(psLine('/Users/me/proj-a'), '/Users/me/proj-a')).toBe(true);
    });

    it('does NOT match a daemon belonging to a different workspace', () => {
      // This is the #1914 bug: workspace A start must not reap workspace B's daemon.
      expect(daemonCommandLineBelongsToWorkspace(psLine('/Users/me/proj-b'), '/Users/me/proj-a')).toBe(false);
    });

    it('does NOT match a path-prefix sibling workspace', () => {
      // `/a/proj` must not reap `/a/proj-other`'s daemon.
      expect(daemonCommandLineBelongsToWorkspace(psLine('/a/proj-other'), '/a/proj')).toBe(false);
      expect(daemonCommandLineBelongsToWorkspace(psLine('/a/proj'), '/a/proj-other')).toBe(false);
    });

    it('does NOT match a pre-#1914 daemon line (no --workspace stamp)', () => {
      const legacy = '4242 node /usr/local/lib/node_modules/@claude-flow/cli/bin/cli.js daemon start --foreground --quiet';
      expect(daemonCommandLineBelongsToWorkspace(legacy, '/Users/me/proj-a')).toBe(false);
    });

    it('still matches when extra flags precede --workspace (kept last)', () => {
      expect(daemonCommandLineBelongsToWorkspace(psLine('/Users/me/proj-a', 7, ' --max-cpu-load 4.0'), '/Users/me/proj-a')).toBe(true);
    });

    it('matches when --workspace is followed by trailing whitespace', () => {
      expect(daemonCommandLineBelongsToWorkspace(`${psLine('/Users/me/proj-a')}   `, '/Users/me/proj-a')).toBe(true);
    });

    it('matches a Windows tasklist Window-Title row (quoted, --workspace last)', () => {
      const titleField = `node C:\\cli.js daemon start --foreground --quiet --workspace C:\\Users\\me\\proj-a`;
      const row = `"node.exe","12345","Console","1","50,000 K","Running","DESKTOP\\u","0:00:01","${titleField}"`;
      expect(daemonCommandLineBelongsToWorkspace(row, 'C:\\Users\\me\\proj-a')).toBe(true);
      expect(daemonCommandLineBelongsToWorkspace(row, 'C:\\Users\\me\\proj-b')).toBe(false);
    });

    it('handles workspace paths containing spaces', () => {
      const root = '/Users/some user/My Project';
      expect(daemonCommandLineBelongsToWorkspace(psLine(root), root)).toBe(true);
      expect(daemonCommandLineBelongsToWorkspace(psLine('/Users/some user/My Project Two'), root)).toBe(false);
    });
  });

  // #2356 — the inverse helper that powers `daemon status --all`: pull the
  // workspace root back out of a daemon process command line so leaked daemons
  // in other workspaces can be enumerated and aged.
  describe('extractWorkspaceFromDaemonLine', () => {
    it('extracts the workspace stamped last in the argv', () => {
      expect(extractWorkspaceFromDaemonLine(psLine('/Users/me/proj-a'))).toBe('/Users/me/proj-a');
    });

    it('extracts a workspace path containing spaces', () => {
      const root = '/Users/some user/My Project';
      expect(extractWorkspaceFromDaemonLine(psLine(root))).toBe(root);
    });

    it('extracts even when extra flags precede --workspace', () => {
      expect(extractWorkspaceFromDaemonLine(psLine('/Users/me/proj-a', 7, ' --max-cpu-load 4.0'))).toBe('/Users/me/proj-a');
    });

    it('tolerates trailing whitespace after the workspace', () => {
      expect(extractWorkspaceFromDaemonLine(`${psLine('/Users/me/proj-a')}   `)).toBe('/Users/me/proj-a');
    });

    it('returns null for a pre-#1914 daemon line with no --workspace stamp', () => {
      const legacy = '4242 node /usr/local/lib/node_modules/@claude-flow/cli/bin/cli.js daemon start --foreground --quiet';
      expect(extractWorkspaceFromDaemonLine(legacy)).toBeNull();
    });

    it('round-trips with daemonCommandLineBelongsToWorkspace', () => {
      const root = '/Users/me/proj-a';
      const line = psLine(root);
      const extracted = extractWorkspaceFromDaemonLine(line);
      expect(extracted).toBe(root);
      expect(daemonCommandLineBelongsToWorkspace(line, extracted as string)).toBe(true);
    });
  });

  describe('resolveWorkspaceFlag', () => {
    it('returns null when the flag is absent / not a string', () => {
      expect(resolveWorkspaceFlag(undefined)).toBeNull();
      expect(resolveWorkspaceFlag(true)).toBeNull();
      expect(resolveWorkspaceFlag(123)).toBeNull();
      expect(resolveWorkspaceFlag('')).toBeNull();
      expect(resolveWorkspaceFlag('   ')).toBeNull();
    });

    it('resolves a relative path to an absolute path', () => {
      const r = resolveWorkspaceFlag('.');
      expect(r).toBe(process.cwd());
    });

    it('passes an absolute path through unchanged', () => {
      expect(resolveWorkspaceFlag('/Users/me/proj-a')).toBe('/Users/me/proj-a');
    });

    it('rejects values with shell metacharacters or null bytes (defence-in-depth)', () => {
      expect(resolveWorkspaceFlag('/tmp/$(rm -rf ~)')).toBeNull();
      expect(resolveWorkspaceFlag('/tmp/a;b')).toBeNull();
      expect(resolveWorkspaceFlag('/tmp/a`b`')).toBeNull();
      expect(resolveWorkspaceFlag('/tmp/a\0b')).toBeNull();
    });
  });
});
