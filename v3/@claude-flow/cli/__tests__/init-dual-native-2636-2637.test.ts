import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { CommandContext } from '../src/types.js';

const codexMock = vi.hoisted(() => ({
  initialize: vi.fn(),
}));

vi.mock('@claude-flow/codex', () => ({
  CodexInitializer: class {
    initialize = codexMock.initialize;
  },
}));

import { initCommand } from '../src/commands/init.js';
import { executeInit, MINIMAL_INIT_OPTIONS } from '../src/init/index.js';

let projectPath: string;

beforeEach(() => {
  projectPath = mkdtempSync(join(tmpdir(), 'dual-native-2636-'));
  codexMock.initialize.mockImplementation(async (options: Record<string, unknown>) => {
    const target = String(options.projectPath);
    mkdirSync(join(target, '.agents'), { recursive: true });
    writeFileSync(join(target, 'AGENTS.md'), '# Native Codex Instructions\n', 'utf8');
    writeFileSync(join(target, '.agents', 'config.toml'), '# native codex config\n', 'utf8');
    return {
      success: true,
      filesCreated: ['AGENTS.md', '.agents/config.toml'],
      skillsGenerated: [],
    };
  });
});

afterEach(() => {
  vi.clearAllMocks();
  rmSync(projectPath, { recursive: true, force: true });
});

describe('native dual initialization (#2636)', () => {
  it('runs both native initializers and preserves the full Claude scaffold', async () => {
    const ctx: CommandContext = {
      args: [],
      flags: {
        _: [],
        dual: true,
        minimal: true,
        global: false,
        'no-signup': true,
        'no-skills-sh': true,
      },
      cwd: projectPath,
      interactive: false,
    };

    const result = await initCommand.action!(ctx);

    expect(result?.success).toBe(true);
    expect(existsSync(join(projectPath, '.claude', 'settings.json'))).toBe(true);
    expect(existsSync(join(projectPath, '.mcp.json'))).toBe(true);
    expect(existsSync(join(projectPath, '.claude-flow', 'config.yaml'))).toBe(true);
    expect(existsSync(join(projectPath, 'CLAUDE.md'))).toBe(true);
    expect(existsSync(join(projectPath, 'AGENTS.md'))).toBe(true);
    expect(existsSync(join(projectPath, '.agents', 'config.toml'))).toBe(true);
    expect(readFileSync(join(projectPath, 'CLAUDE.md'), 'utf8')).not.toContain(
      'Primary instructions are in `AGENTS.md`',
    );
    expect(codexMock.initialize).toHaveBeenCalledWith(expect.objectContaining({
      projectPath,
      template: 'minimal',
      dual: false,
    }));
  });
});

describe('root secret ignore (#2637)', () => {
  it('appends secret/runtime entries without replacing existing project rules', async () => {
    writeFileSync(join(projectPath, '.gitignore'), 'dist/\n', 'utf8');
    const options = structuredClone(MINIMAL_INIT_OPTIONS);
    options.targetDir = projectPath;
    options.skipGlobalClaudeMd = true;

    const result = await executeInit(options);

    expect(result.success).toBe(true);
    const gitignore = readFileSync(join(projectPath, '.gitignore'), 'utf8');
    expect(gitignore).toContain('dist/\n');
    expect(gitignore).toContain('\n.env\n');
    expect(gitignore).toContain('.env.local');
    expect(gitignore).toContain('.claude-flow/data/');
    expect(result.created.files).toContain('.gitignore (updated)');
  });
});
