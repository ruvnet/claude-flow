import { afterEach, describe, expect, it } from 'vitest';
import { existsSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DEFAULT_INIT_OPTIONS, FULL_INIT_OPTIONS, type InitOptions } from '../src/init/types.js';
import { executeInit } from '../src/init/executor.js';

const tempDirs: string[] = [];
afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function skillsOnly(base: InitOptions): InitOptions {
  const targetDir = mkdtempSync(join(tmpdir(), 'ruflo-init-skills-v3-'));
  tempDirs.push(targetDir);
  return {
    ...base,
    targetDir,
    force: true,
    skipGlobalClaudeMd: true,
    components: {
      ...base.components,
      settings: false, skills: true, commands: false, agents: false, helpers: false,
      statusline: false, mcp: false, runtime: false, claudeMd: false,
    },
  };
}

function installedSkills(targetDir: string): string[] {
  const dir = join(targetDir, '.claude', 'skills');
  return existsSync(dir) ? readdirSync(dir) : [];
}

describe('v3 implementation skills are opt-in (ADR-128, matches agents.v3)', () => {
  it('default options do not select the v3 skill group', () => {
    expect(DEFAULT_INIT_OPTIONS.skills.v3).toBe(false);
    expect(DEFAULT_INIT_OPTIONS.agents.v3).toBe(false);
  });

  it('--full still selects the v3 skill group', () => {
    expect(FULL_INIT_OPTIONS.skills.v3).toBe(true);
  });

  it('default init installs no v3-* skills', async () => {
    const options = skillsOnly(DEFAULT_INIT_OPTIONS);
    const result = await executeInit(options);
    expect(result.success).toBe(true);
    const skills = installedSkills(options.targetDir!);
    expect(skills.length).toBeGreaterThan(0);
    expect(skills.filter((name) => name.startsWith('v3-'))).toEqual([]);
  });

  it('full init still installs the v3-* skills', async () => {
    const options = skillsOnly(FULL_INIT_OPTIONS);
    const result = await executeInit(options);
    expect(result.success).toBe(true);
    expect(installedSkills(options.targetDir!).filter((name) => name.startsWith('v3-')).length).toBe(9);
  });
});
