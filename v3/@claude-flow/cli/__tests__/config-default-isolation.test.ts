import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

let root: string;
let Manager: typeof import('../src/services/config-file-manager.js').ConfigFileManager;
beforeEach(async () => {
  // Reset the source module so each pre-fix failure cannot contaminate another test.
  vi.resetModules();
  ({ ConfigFileManager: Manager } = await import('../src/services/config-file-manager.js'));
  vi.stubEnv('CLAUDE_FLOW_CONFIG', '');
  root = mkdtempSync(join(tmpdir(), 'config-default-isolation-'));
});
afterEach(() => { vi.unstubAllEnvs(); rmSync(root, { recursive: true, force: true }); });
function project(name: string): string { const dir = join(root, name); mkdirSync(dir); return dir; }
function disk(dir: string): any { return JSON.parse(readFileSync(join(dir, 'claude-flow.config.json'), 'utf8')); }

describe('default configuration ownership', () => {
  it('creates independent project files after a different manager changes a nested default', () => {
    const a = project('a'), b = project('b');
    const first = new Manager(); first.create(a);
    first.set(a, 'memory.persistPath', './a-only-memory');
    const second = new Manager(); second.create(b);
    expect(disk(a).memory.persistPath).toBe('./a-only-memory');
    expect(disk(b).memory.persistPath).toBe('./data/memory');
    expect(second.getDefaults().memory).toHaveProperty('persistPath', './data/memory');
  });

  it('returns independent nested objects and arrays from getDefaults', () => {
    const first = new Manager().getDefaults() as any;
    first.memory.persistPath = './changed'; first.agents.providers.push('custom'); first.mcp.tools.push('tool');
    const second = new Manager().getDefaults() as any;
    expect(second.memory.persistPath).toBe('./data/memory');
    expect(second.agents.providers).toEqual([]); expect(second.mcp.tools).toEqual([]);
  });

  it('does not expose the template through missing-file getConfig fallbacks', () => {
    const a = project('a'), b = project('b'); const manager = new Manager();
    const fallback = manager.getConfig(a) as any;
    fallback.memory.persistPath = './fallback-only'; fallback.hooks.hooks.push('custom');
    expect((manager.getConfig(a) as any).memory.persistPath).toBe('./data/memory');
    expect((new Manager().getConfig(b) as any).hooks.hooks).toEqual([]);
    expect(existsSync(join(a, 'claude-flow.config.json'))).toBe(false);
  });

  it('resets a changed project to the original defaults on disk and in memory', () => {
    const a = project('a'); const manager = new Manager(); manager.create(a);
    manager.set(a, 'memory.persistPath', './custom'); manager.set(a, 'agents.maxConcurrent', 0);
    manager.reset(a);
    expect(disk(a).memory.persistPath).toBe('./data/memory');
    expect(disk(a).agents.maxConcurrent).toBe(8);
    expect(manager.get(a, 'memory.persistPath')).toBe('./data/memory');
  });

  it('keeps reset-derived cached arrays isolated from later new projects', () => {
    const a = project('a'), b = project('b'); const first = new Manager(); first.reset(a);
    (first.getConfig(a) as any).agents.providers.push('reset-only');
    new Manager().create(b);
    expect(disk(b).agents.providers).toEqual([]);
    expect((new Manager().getDefaults() as any).agents.providers).toEqual([]);
  });

  it('keeps create-derived cached arrays isolated from later new projects', () => {
    const a = project('a'), b = project('b'); const first = new Manager(); first.create(a);
    (first.getConfig(a) as any).hooks.hooks.push('project-only');
    new Manager().create(b);
    expect(disk(b).hooks.hooks).toEqual([]);
  });

  it('preserves shallow override semantics and arbitrary caller-owned values', () => {
    const a = project('a'); const custom = { run: () => 'caller function', name: 'keep' };
    const memory = { persistPath: './override-only' }; const manager = new Manager();
    manager.create(a, { memory, custom });
    expect(manager.getConfig(a).memory).toBe(memory);
    expect(manager.getConfig(a).custom).toBe(custom);
    expect(disk(a).memory).toEqual({ persistPath: './override-only' });
    expect(disk(a).custom).toEqual({ name: 'keep' });
    expect((new Manager().getDefaults() as any).memory.persistPath).toBe('./data/memory');
  });
});
