/**
 * #4424: github_pr_manage merge/close and github_issue_track update/close
 * reported success when nothing happened on GitHub:
 *   - a failed `gh` call fell through to the local JSON store and returned
 *     { success: true, source: 'local-store' };
 *   - the local fallback matched with `key.includes(String(n))` against
 *     `pr-<Date.now()>` keys and returned success whether or not it matched;
 *   - github_pr_manage never passed owner/repo to `gh` (fixed for issues in #2963).
 *
 * Mocks `node:child_process` like github-issue-track-repo-flag-2963.test.ts so
 * the exact `gh` argv and failures can be controlled; the local store lives in
 * a temp CLAUDE_FLOW_CWD.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const execFileSyncMock = vi.fn();
const execSyncMock = vi.fn();

vi.mock('node:child_process', () => ({
  execFileSync: (...args: unknown[]) => execFileSyncMock(...args),
  execSync: (...args: unknown[]) => execSyncMock(...args),
}));

const originalProjectCwd = process.env.CLAUDE_FLOW_CWD;
let storePath: string;

function seedStore(prs: Record<string, object>, issues: Record<string, object>) {
  writeFileSync(storePath, JSON.stringify({ repos: {}, prs, issues, version: '3.0.0' }));
}
const readStore = () => JSON.parse(readFileSync(storePath, 'utf-8'));
// execFileSync throws with the child's stderr attached; that text must reach the caller.
const GH_STDERR = 'X Pull request #12 is not mergeable: the merge commit cannot be cleanly created.';
const ghFails = () => execFileSyncMock.mockImplementation(() => { throw Object.assign(new Error('Command failed: gh'), { stderr: `${GH_STDERR}\n` }); });

async function tool(name: string) {
  const { githubTools } = await import('../src/mcp-tools/github-tools.js');
  const t = githubTools.find((c) => c.name === name)!;
  return (input: Record<string, unknown>) => t.handler(input) as Promise<Record<string, unknown>>;
}

beforeEach(() => {
  execFileSyncMock.mockReset();
  execSyncMock.mockReset();
  const scratch = mkdtempSync(join(tmpdir(), 'ruflo-4424-'));
  process.env.CLAUDE_FLOW_CWD = scratch;
  mkdirSync(join(scratch, '.claude-flow', 'github'), { recursive: true });
  storePath = join(scratch, '.claude-flow', 'github', 'store.json');
  // Local record whose timestamp id contains "12": the old includes() lookup matched prNumber 12.
  seedStore(
    { 'pr-1786319612345': { id: 'pr-1786319612345', title: 'local', status: 'open', branch: 'b', createdAt: 'x' } },
    { 'issue-1786319612345': { id: 'issue-1786319612345', title: 'local', status: 'open', labels: [], createdAt: 'x' } },
  );
});

afterEach(() => {
  if (originalProjectCwd === undefined) delete process.env.CLAUDE_FLOW_CWD;
  else process.env.CLAUDE_FLOW_CWD = originalProjectCwd;
});

describe('with gh installed (#4424)', () => {
  beforeEach(() => { execSyncMock.mockReturnValue('gh version 2.0.0'); });

  it.each([
    ['github_pr_manage', { action: 'merge', prNumber: 12 }],
    ['github_pr_manage', { action: 'close', prNumber: 12 }],
    ['github_issue_track', { action: 'close', issueNumber: 12 }],
    ['github_issue_track', { action: 'update', issueNumber: 12, title: 'renamed' }],
  ])('%s %o fails when gh fails, and leaves the local store alone', async (name, input) => {
    ghFails();
    const r = await (await tool(name))(input);
    // Baseline: { success: true, source: 'local-store' } and the pr-…12… record mutated.
    expect(r.success).toBe(false);
    expect(r.source).toBe('gh-cli');
    expect(String(r.error)).toMatch(/failed: /);
    expect(String(r.error)).toContain(GH_STDERR);
    expect(readStore().prs['pr-1786319612345'].status).toBe('open');
    expect(readStore().issues['issue-1786319612345']).toMatchObject({ status: 'open', title: 'local' });
  });

  it.each(['merge', 'close'])('pr %s passes --repo owner/repo to gh (as #2963 does for issues)', async (action) => {
    execFileSyncMock.mockReturnValue('');
    const r = await (await tool('github_pr_manage'))({ action, prNumber: 7, owner: 'acme', repo: 'widgets' });
    expect(r.success).toBe(true);
    const [file, argv] = execFileSyncMock.mock.calls[0] as [string, string[]];
    expect(file).toBe('gh');
    expect(argv.slice(0, 3)).toEqual(['pr', action, '7']);
    expect(argv[argv.indexOf('--repo') + 1]).toBe('acme/widgets');
  });

  it('a successful gh merge is still reported as merged (control)', async () => {
    execFileSyncMock.mockReturnValue('');
    const r = await (await tool('github_pr_manage'))({ action: 'merge', prNumber: 7 });
    expect(r).toMatchObject({ success: true, _real: true, action: 'merged', prNumber: 7 });
    expect(r.mergedAt).toEqual(expect.any(String));
  });
});

describe('without gh, local-store mode (#4424)', () => {
  beforeEach(() => { execSyncMock.mockImplementation(() => { throw new Error('gh: command not found'); }); });

  it.each([
    ['github_pr_manage', { action: 'merge', prNumber: 12 }],
    ['github_issue_track', { action: 'close', issueNumber: 12 }],
  ])('%s %o fails when no local record has that exact id', async (name, input) => {
    const r = await (await tool(name))(input);
    expect(r.success).toBe(false);
    expect(r.source).toBe('local-store');
    expect(readStore().prs['pr-1786319612345'].status).toBe('open');
    expect(readStore().issues['issue-1786319612345'].status).toBe('open');
  });

  it('updates the local record whose id matches exactly (control)', async () => {
    seedStore({ 'pr-5': { id: 'pr-5', title: 'local', status: 'open', branch: 'b', createdAt: 'x' } }, {});
    const merged = await (await tool('github_pr_manage'))({ action: 'merge', prNumber: 5 });
    expect(merged).toMatchObject({ success: true, source: 'local-store', action: 'merged', prNumber: 5 });
    expect(readStore().prs['pr-5'].status).toBe('merged');
  });
});
