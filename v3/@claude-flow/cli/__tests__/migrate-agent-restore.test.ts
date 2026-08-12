/**
 * #2985 — `ruflo migrate fix --agents` restore path.
 *
 * Same isolation discipline as migrate-agent-detection.test.ts: every test
 * gets a temp project and temp home, and the GitHub fallback is exercised
 * through an injected fetchImpl — no test touches the network or depends on
 * what is installed on the machine running the suite.
 */
import { describe, it, expect, vi } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { restoreRemovedAgents } from '../src/commands/migrate-agent-restore.js';
import type { RemovedAgentGap } from '../src/commands/migrate-agent-detection.js';

const CODER_GAP: RemovedAgentGap = {
  agent: 'coder.md',
  plugin: 'ruflo-core',
  installCommand: '/plugin install ruflo-core@ruflo',
};

const GOAL_GAP: RemovedAgentGap = {
  agent: 'goal-planner.md',
  plugin: 'ruflo-goals',
  installCommand: '/plugin install ruflo-goals@ruflo',
};

const PLUGIN_AGENT_CONTENT = [
  '---',
  'name: coder',
  'description: Implementation specialist',
  '---',
  'Use mcp__plugin_ruflo-core_ruflo__memory_store to persist decisions.',
  '',
].join('\n');

function project(): string {
  return mkdtempSync(join(tmpdir(), 'migrate-agent-restore-'));
}

function emptyHome(): string {
  return mkdtempSync(join(tmpdir(), 'migrate-agent-restore-home-'));
}

function homeWithMarketplaceClone(plugin: string, basename: string, content: string): string {
  const home = emptyHome();
  const agentsDir = join(home, '.claude', 'plugins', 'marketplaces', 'ruflo', 'plugins', plugin, 'agents');
  mkdirSync(agentsDir, { recursive: true });
  writeFileSync(join(agentsDir, basename), content);
  return home;
}

function failingFetch(): typeof fetch {
  return vi.fn(async () => ({ ok: false, status: 404, text: async () => '' })) as unknown as typeof fetch;
}

describe('restoreRemovedAgents', () => {
  it('restores from the marketplace clone, rewrites the namespace, and records provenance', async () => {
    const cwd = project();
    const homeDir = homeWithMarketplaceClone('ruflo-core', 'coder.md', PLUGIN_AGENT_CONTENT);

    const results = await restoreRemovedAgents(cwd, [CODER_GAP], { homeDir, fetchImpl: failingFetch() });

    expect(results).toEqual([
      expect.objectContaining({ agent: 'coder.md', status: 'restored', source: 'marketplace-clone' }),
    ]);
    const written = readFileSync(join(cwd, '.claude', 'agents', 'core', 'coder.md'), 'utf-8');
    expect(written).toContain('mcp__claude-flow__memory_store');
    expect(written).not.toContain('mcp__plugin_ruflo-core_ruflo__');
    expect(written).toContain('restored by `ruflo migrate fix --agents`');
    // Provenance lands after the frontmatter block, not before it.
    expect(written.startsWith('---\n')).toBe(true);
  });

  it('falls back to the GitHub tag URL, then main, when no local source exists', async () => {
    const cwd = project();
    const homeDir = emptyHome();
    const urls: string[] = [];
    const fetchImpl = vi.fn(async (url: string) => {
      urls.push(url);
      if (url.includes('/v9.9.9/')) return { ok: false, status: 404, text: async () => '' };
      return { ok: true, status: 200, text: async () => PLUGIN_AGENT_CONTENT };
    }) as unknown as typeof fetch;

    const results = await restoreRemovedAgents(cwd, [GOAL_GAP], { homeDir, fetchImpl, version: '9.9.9' });

    expect(results[0]).toEqual(
      expect.objectContaining({ agent: 'goal-planner.md', status: 'restored', source: 'github-main' })
    );
    expect(urls[0]).toBe('https://raw.githubusercontent.com/ruvnet/ruflo/v9.9.9/plugins/ruflo-goals/agents/goal-planner.md');
    expect(urls[1]).toBe('https://raw.githubusercontent.com/ruvnet/ruflo/main/plugins/ruflo-goals/agents/goal-planner.md');
    // goal-planner restores to its original init category.
    expect(existsSync(join(cwd, '.claude', 'agents', 'goal', 'goal-planner.md'))).toBe(true);
  });

  it('never overwrites an existing file', async () => {
    const cwd = project();
    const homeDir = homeWithMarketplaceClone('ruflo-core', 'coder.md', PLUGIN_AGENT_CONTENT);
    const dest = join(cwd, '.claude', 'agents', 'core');
    mkdirSync(dest, { recursive: true });
    writeFileSync(join(dest, 'coder.md'), 'hand-authored — do not touch\n');

    const results = await restoreRemovedAgents(cwd, [CODER_GAP], { homeDir, fetchImpl: failingFetch() });

    expect(results[0]).toEqual(expect.objectContaining({ agent: 'coder.md', status: 'skipped' }));
    expect(readFileSync(join(dest, 'coder.md'), 'utf-8')).toBe('hand-authored — do not touch\n');
  });

  it('reports failure with the marketplace-install alternative when offline and no local source', async () => {
    const cwd = project();
    const homeDir = emptyHome();
    const fetchImpl = vi.fn(async () => {
      throw new Error('network unreachable');
    }) as unknown as typeof fetch;

    const results = await restoreRemovedAgents(cwd, [CODER_GAP], { homeDir, fetchImpl });

    expect(results[0].status).toBe('failed');
    expect(results[0].error).toContain('/plugin install ruflo-core@ruflo');
    expect(existsSync(join(cwd, '.claude', 'agents', 'core', 'coder.md'))).toBe(false);
  });

  it('dry-run resolves and reports without writing', async () => {
    const cwd = project();
    const homeDir = homeWithMarketplaceClone('ruflo-core', 'coder.md', PLUGIN_AGENT_CONTENT);

    const results = await restoreRemovedAgents(cwd, [CODER_GAP], { homeDir, fetchImpl: failingFetch(), dryRun: true });

    expect(results[0]).toEqual(expect.objectContaining({ status: 'restored', source: 'marketplace-clone' }));
    expect(existsSync(join(cwd, '.claude', 'agents', 'core', 'coder.md'))).toBe(false);
  });
});
