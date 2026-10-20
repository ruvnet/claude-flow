import { describe, expect, it } from 'vitest';
import {
  evaluateAgainstBaseline,
  findDanglingRefs,
  readBaseline,
  registeredToolNames,
  shippedSkillFiles,
  skillToolRefs,
} from '../audit-skill-mcp-tools.mjs';

describe('skill ↔ MCP tool reference audit', () => {
  it('extracts ruflo tool references from both the init and the plugin prefix', () => {
    const text = [
      'allowed-tools: mcp__plugin_ruflo-core_ruflo__memory_search Bash',
      'Call `mcp__claude-flow__swarm_init` first.',
    ].join('\n');
    expect(skillToolRefs(text)).toEqual([
      { tool: 'memory_search', line: 1 },
      { tool: 'swarm_init', line: 2 },
    ]);
  });

  it('ignores other MCP servers, wildcards and scaffold placeholders', () => {
    const text = [
      'mcp__github__create_issue',
      'mcp__plugin_ruflo-ai-team_ruflo-ai-team__team_launch',
      'allowed-tools: mcp__claude-flow__*',
      'allowed-tools: mcp__plugin_ruflo-core_ruflo__tool1 mcp__plugin_ruflo-core_ruflo__tool2',
    ].join('\n');
    expect(skillToolRefs(text)).toEqual([]);
  });

  it('passes references that are already in the baseline', () => {
    const dangling = [{ key: 'plugins/a/skills/x/SKILL.md::old_tool' }];
    const result = evaluateAgainstBaseline(dangling, ['plugins/a/skills/x/SKILL.md::old_tool']);
    expect(result.ok).toBe(true);
    expect(result.unexpected).toEqual([]);
  });

  it('fails a new reference even when the total count is unchanged', () => {
    const dangling = [{ key: 'plugins/a/skills/x/SKILL.md::new_tool' }];
    const result = evaluateAgainstBaseline(dangling, ['plugins/a/skills/x/SKILL.md::old_tool']);
    expect(result.ok).toBe(false);
    expect(result.unexpected).toEqual(['plugins/a/skills/x/SKILL.md::new_tool']);
    expect(result.fixed).toEqual(['plugins/a/skills/x/SKILL.md::old_tool']);
  });

  it('reads a non-empty tool registry from mcp-client.ts', () => {
    const registered = registeredToolNames();
    // Spot-check tools that skills commonly reference, including ones whose
    // descriptions use double quotes or template literals.
    for (const name of ['memory_store', 'swarm_init', 'agentdb_pattern-search', 'hooks_pre-task', 'federation_bbs_sync']) {
      expect(registered.has(name)).toBe(true);
    }
  });

  it('scans the shipped skill trees', () => {
    const files = shippedSkillFiles();
    expect(files.some((f) => f.startsWith('v3/@claude-flow/cli/.claude/skills/'))).toBe(true);
    expect(files.some((f) => f.startsWith('plugins/'))).toBe(true);
  });

  it('has no dangling references beyond verification/skill-mcp-tool-baseline.json', () => {
    const result = evaluateAgainstBaseline(findDanglingRefs(), readBaseline());
    expect(result.unexpected).toEqual([]);
  });
});
