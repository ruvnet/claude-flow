import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CodexInitializer } from '../src/initializer.js';
import { BUILT_IN_SKILL_NAMES } from '../src/generators/skill-md.js';

let projectPath: string;
let originalPath: string | undefined;

beforeEach(() => {
  projectPath = mkdtempSync(join(tmpdir(), 'codex-full-init-2634-'));
  originalPath = process.env.PATH;
  // Prevent tests from registering MCP servers or plugins in user config.
  process.env.PATH = '';
});

afterEach(() => {
  if (originalPath === undefined) delete process.env.PATH;
  else process.env.PATH = originalPath;
  rmSync(projectPath, { recursive: true, force: true });
});

describe('Codex full template canonical skills (#2634)', () => {
  it('omits catalog-only capabilities instead of generating placeholder skills', async () => {
    const result = await new CodexInitializer().initialize({
      projectPath,
      template: 'full',
    });

    expect(result.success).toBe(true);
    expect(result.skillsGenerated.sort()).toEqual([...BUILT_IN_SKILL_NAMES].sort());
    expect(result.warnings).toContain(
      'Omitted 103 catalog skills without canonical packaged assets. ' +
      'Install additional capabilities from the Ruflo plugin catalog.',
    );

    const installed = readdirSync(join(projectPath, '.agents', 'skills')).sort();
    expect(installed).toEqual([...BUILT_IN_SKILL_NAMES].sort());

    for (const skillName of installed) {
      const content = readFileSync(
        join(projectPath, '.agents', 'skills', skillName, 'SKILL.md'),
        'utf8',
      );
      expect(content).not.toContain('Custom skill:');
      expect(content).not.toContain('Define when to trigger this skill');
    }

    const config = readFileSync(join(projectPath, '.agents', 'config.toml'), 'utf8');
    expect(config).not.toContain('.agents/skills/agentdb-advanced');
  });

  it('preserves explicitly requested custom-skill scaffolding', async () => {
    const result = await new CodexInitializer().initialize({
      projectPath,
      template: 'full',
      skills: ['my-project-skill'],
    });

    expect(result.success).toBe(true);
    expect(result.skillsGenerated).toContain('my-project-skill');
    const content = readFileSync(
      join(projectPath, '.agents', 'skills', 'my-project-skill', 'SKILL.md'),
      'utf8',
    );
    expect(content).toContain('Custom skill: my-project-skill');
  });

  it('adds Codex ignores without duplicating shared Claude init entries', async () => {
    const gitignorePath = join(projectPath, '.gitignore');
    writeFileSync(
      gitignorePath,
      '# Ruflo local secrets and runtime data\n.env\n.claude-flow/data/\n',
      'utf8',
    );

    const result = await new CodexInitializer().initialize({
      projectPath,
      template: 'minimal',
    });

    expect(result.success).toBe(true);
    const gitignore = readFileSync(gitignorePath, 'utf8');
    expect(gitignore.match(/^\.env$/gm)).toHaveLength(1);
    expect(gitignore.match(/^\.claude-flow\/data\/$/gm)).toHaveLength(1);
    expect(gitignore).toContain('.codex/');
  });
});
