/**
 * Regression coverage for #2629: `memory init` must use the same path
 * precedence as every other memory command.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import {
  _resetMemoryRootCache,
  initializeMemoryDatabase,
} from '../src/memory/memory-initializer.js';

let testDir: string;
let originalDbPath: string | undefined;
let originalMemoryPath: string | undefined;

beforeEach(() => {
  testDir = mkdtempSync(join(tmpdir(), 'memory-init-path-2629-'));
  originalDbPath = process.env.CLAUDE_FLOW_DB_PATH;
  originalMemoryPath = process.env.CLAUDE_FLOW_MEMORY_PATH;
  delete process.env.CLAUDE_FLOW_DB_PATH;
  delete process.env.CLAUDE_FLOW_MEMORY_PATH;
  _resetMemoryRootCache();
});

afterEach(() => {
  if (originalDbPath === undefined) delete process.env.CLAUDE_FLOW_DB_PATH;
  else process.env.CLAUDE_FLOW_DB_PATH = originalDbPath;
  if (originalMemoryPath === undefined) delete process.env.CLAUDE_FLOW_MEMORY_PATH;
  else process.env.CLAUDE_FLOW_MEMORY_PATH = originalMemoryPath;
  _resetMemoryRootCache();
  rmSync(testDir, { recursive: true, force: true });
});

describe('memory init database path precedence (#2629)', () => {
  it('initializes at CLAUDE_FLOW_DB_PATH when --path is absent', async () => {
    const customPath = join(testDir, 'isolated', 'custom.db');
    const unusedDefaultRoot = join(testDir, 'default-root');
    process.env.CLAUDE_FLOW_DB_PATH = customPath;
    process.env.CLAUDE_FLOW_MEMORY_PATH = unusedDefaultRoot;

    const result = await initializeMemoryDatabase({
      backend: 'sqlite',
      force: true,
      migrate: false,
    });

    expect(result.success).toBe(true);
    expect(result.dbPath).toBe(resolve(customPath));
    expect(existsSync(customPath)).toBe(true);
    expect(existsSync(join(unusedDefaultRoot, 'memory.db'))).toBe(false);
  });

  it('keeps the explicit --path equivalent above CLAUDE_FLOW_DB_PATH', async () => {
    const envPath = join(testDir, 'env.db');
    const explicitPath = join(testDir, 'explicit.db');
    process.env.CLAUDE_FLOW_DB_PATH = envPath;

    const result = await initializeMemoryDatabase({
      backend: 'sqlite',
      dbPath: explicitPath,
      force: true,
      migrate: false,
    });

    expect(result.success).toBe(true);
    expect(result.dbPath).toBe(resolve(explicitPath));
    expect(existsSync(explicitPath)).toBe(true);
    expect(existsSync(envPath)).toBe(false);
  });
});
