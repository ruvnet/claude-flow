/**
 * #2963: `github_issue_track`'s `create`/`update`/`close`/`list` actions
 * validated the caller-supplied `owner`/`repo` but never passed them to
 * `gh` — every invocation silently resolved the target repository from
 * the current working directory's git remote instead of the repository
 * the caller actually asked for.
 *
 * Fixed by appending `--repo <owner>/<repo>` to the `gh` argv whenever
 * both are supplied.
 *
 * Mocks `node:child_process` directly (not the shared mocks in
 * mcp-tools-deep.test.ts, which stub `execSync` generically but not
 * `execFileSync`) so this test can assert the exact argv `runArgv`
 * passes to `gh`, matching the pattern in github-tools-injection.test.ts
 * for the same file.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const execFileSyncMock = vi.fn();
const execSyncMock = vi.fn();

vi.mock('node:child_process', () => ({
  execFileSync: (...args: unknown[]) => execFileSyncMock(...args),
  execSync: (...args: unknown[]) => execSyncMock(...args),
}));

describe('#2963 github_issue_track passes --repo to gh', () => {
  beforeEach(() => {
    execFileSyncMock.mockReset();
    execSyncMock.mockReset();
    // hasGhCli() calls run('gh --version') -> execSync — must succeed so
    // the tool takes the real-gh-cli branch instead of falling to
    // local-store, where this bug doesn't manifest.
    execSyncMock.mockReturnValue('gh version 2.0.0');
  });

  it('create appends --repo owner/repo when both are supplied', async () => {
    const { githubTools } = await import('../src/mcp-tools/github-tools.js');
    const tool = githubTools.find((t) => t.name === 'github_issue_track')!;

    execFileSyncMock.mockReturnValue('https://github.com/acme/widgets/issues/42');

    await tool.handler({
      action: 'create',
      owner: 'acme',
      repo: 'widgets',
      title: 'Test issue',
      body: 'Body',
    });

    expect(execFileSyncMock).toHaveBeenCalled();
    const [, argv] = execFileSyncMock.mock.calls[0] as [string, string[]];
    expect(argv).toContain('--repo');
    expect(argv[argv.indexOf('--repo') + 1]).toBe('acme/widgets');
  });

  it('create omits --repo when owner/repo are not supplied (falls back to cwd remote)', async () => {
    const { githubTools } = await import('../src/mcp-tools/github-tools.js');
    const tool = githubTools.find((t) => t.name === 'github_issue_track')!;

    execFileSyncMock.mockReturnValue('https://github.com/whatever/here/issues/1');

    await tool.handler({ action: 'create', title: 'Test issue', body: 'Body' });

    const [, argv] = execFileSyncMock.mock.calls[0] as [string, string[]];
    expect(argv).not.toContain('--repo');
  });

  it('close appends --repo owner/repo when both are supplied', async () => {
    const { githubTools } = await import('../src/mcp-tools/github-tools.js');
    const tool = githubTools.find((t) => t.name === 'github_issue_track')!;

    execFileSyncMock.mockReturnValue('');

    await tool.handler({ action: 'close', owner: 'acme', repo: 'widgets', issueNumber: 42 });

    const [, argv] = execFileSyncMock.mock.calls[0] as [string, string[]];
    expect(argv).toContain('--repo');
    expect(argv[argv.indexOf('--repo') + 1]).toBe('acme/widgets');
  });
});
