/**
 * Regression coverage for #420: `init --force` blindly overwrote the whole
 * `.mcp.json`, destroying any unrelated MCP server entries a user had
 * registered alongside ruflo's own (claude-flow/ruv-swarm/flow-nexus).
 *
 * Fix: when `--force` targets an existing `.mcp.json`, merge the generated
 * servers into the existing file instead of replacing it outright.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { executeInit } from '../src/init/executor.js';
import { DEFAULT_INIT_OPTIONS } from '../src/init/types.js';
import type { InitOptions } from '../src/init/types.js';

let testDir: string;

beforeEach(() => {
  testDir = mkdtempSync(join(tmpdir(), 'ruflo-420-mcp-force-'));
});

afterEach(() => {
  rmSync(testDir, { recursive: true, force: true });
});

function baseOptions(overrides: Partial<InitOptions> = {}): InitOptions {
  return {
    ...DEFAULT_INIT_OPTIONS,
    targetDir: testDir,
    interactive: false,
    components: {
      ...DEFAULT_INIT_OPTIONS.components,
      settings: false,
      skills: false,
      commands: false,
      agents: false,
      helpers: false,
      statusline: false,
      runtime: false,
      claudeMd: false,
      mcp: true,
    },
    ...overrides,
  };
}

describe('.mcp.json --force preserves unrelated MCP servers (#420)', () => {
  it('merges the generated servers into an existing file instead of overwriting it', async () => {
    mkdirSync(testDir, { recursive: true });
    const mcpPath = join(testDir, '.mcp.json');
    const existingConfig = {
      mcpServers: {
        'my-custom-server': {
          command: 'node',
          args: ['custom-server.js'],
          env: { CUSTOM_VAR: 'keep-me' },
        },
      },
    };
    writeFileSync(mcpPath, JSON.stringify(existingConfig, null, 2), 'utf-8');

    const result = await executeInit(baseOptions({ force: true }));

    expect(result.errors).toEqual([]);
    expect(existsSync(mcpPath)).toBe(true);

    const written = JSON.parse(readFileSync(mcpPath, 'utf-8'));
    // Pre-fix: the unrelated server was wiped out by a blind overwrite —
    // this is exactly the assertion the bug made false.
    expect(written.mcpServers['my-custom-server']).toEqual(existingConfig.mcpServers['my-custom-server']);
    // Our own server registration should still be written.
    expect(written.mcpServers['claude-flow']).toBeDefined();
  });

  it('still writes a fresh file when none exists', async () => {
    mkdirSync(testDir, { recursive: true });
    const mcpPath = join(testDir, '.mcp.json');

    const result = await executeInit(baseOptions({ force: true }));

    expect(result.errors).toEqual([]);
    const written = JSON.parse(readFileSync(mcpPath, 'utf-8'));
    expect(written.mcpServers['claude-flow']).toBeDefined();
  });

  it('falls back to overwrite when the existing file is not valid JSON', async () => {
    mkdirSync(testDir, { recursive: true });
    const mcpPath = join(testDir, '.mcp.json');
    writeFileSync(mcpPath, '{ not valid json', 'utf-8');

    const result = await executeInit(baseOptions({ force: true }));

    expect(result.errors).toEqual([]);
    const written = JSON.parse(readFileSync(mcpPath, 'utf-8'));
    expect(written.mcpServers['claude-flow']).toBeDefined();
  });
});
