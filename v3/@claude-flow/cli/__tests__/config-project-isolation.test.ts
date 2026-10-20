import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { ConfigFileManager } from '../src/services/config-file-manager.js';

let root: string;
let a: string;
let b: string;
const file = (cwd: string) => join(cwd, 'claude-flow.config.json');
const read = (cwd: string) => JSON.parse(readFileSync(file(cwd), 'utf8'));
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'config-project-isolation-'));
  a = join(root, 'a');
  b = join(root, 'b');
  for (const [cwd, name] of [[a, 'a'], [b, 'b']]) {
    mkdirSync(cwd);
    writeFileSync(file(cwd), JSON.stringify({ project: name, custom: { keep: name } }));
  }
  vi.stubEnv('CLAUDE_FLOW_CONFIG', '');
});
afterEach(() => {
  vi.unstubAllEnvs();
  rmSync(root, { recursive: true, force: true });
});

describe('configuration project isolation', () => {
  it('switches reads to the requested project, including switching back', () => {
    const manager = new ConfigFileManager();
    expect(manager.get(a, 'project')).toBe('a');
    expect(manager.get(b, 'project')).toBe('b');
    expect(manager.getConfigPath()).toBe(file(b));
    expect(manager.get(a, 'project')).toBe('a');
    expect(manager.getConfigPath()).toBe(file(a));
  });

  it('updates project B without changing cached project A', () => {
    const manager = new ConfigFileManager();
    const before = readFileSync(file(a), 'utf8');
    manager.load(a);
    manager.set(b, 'custom.enabled', true);
    expect(readFileSync(file(a), 'utf8')).toBe(before);
    expect(read(b)).toEqual({ project: 'b', custom: { keep: 'b', enabled: true } });
  });

  it('does not carry existing values into a missing project configuration', () => {
    rmSync(file(b));
    const manager = new ConfigFileManager();
    manager.load(a);
    manager.set(b, 'custom.enabled', true);
    expect(read(b)).toEqual({ custom: { enabled: true } });
    expect(read(a).project).toBe('a');
  });

  it('exports the requested project even after another was cached', () => {
    const manager = new ConfigFileManager();
    manager.load(a);
    manager.exportTo(b, 'export.json');
    expect(JSON.parse(readFileSync(join(b, 'export.json'), 'utf8')).project).toBe('b');
  });

  it.each(['reset', 'import'] as const)('discovers the current hidden file for %s without loading it first', (operation) => {
    rmSync(file(b));
    mkdirSync(join(b, '.claude-flow'));
    const hidden = join(b, '.claude-flow', 'config.json');
    writeFileSync(hidden, '{"project":"b"}');
    writeFileSync(join(b, 'input.json'), '{"project":"imported"}');
    const manager = new ConfigFileManager();
    if (operation === 'reset') expect(manager.reset(b)).toBe(hidden);
    else manager.importFrom(b, 'input.json');
    expect(manager.getConfigPath()).toBe(hidden);
    expect(existsSync(file(b))).toBe(false);
    expect(JSON.parse(readFileSync(hidden, 'utf8'))).toEqual(operation === 'reset' ? manager.getDefaults() : { project: 'imported' });
  });

  it.each(['reset', 'import'] as const)('targets project B for %s after project A was loaded', (operation) => {
    const before = readFileSync(file(a), 'utf8');
    writeFileSync(join(b, 'input.json'), '{"project":"imported"}');
    const manager = new ConfigFileManager();
    manager.load(a);
    if (operation === 'reset') expect(manager.reset(b)).toBe(file(b));
    else manager.importFrom(b, 'input.json');
    expect(readFileSync(file(a), 'utf8')).toBe(before);
    expect(read(b)).toEqual(operation === 'reset' ? manager.getDefaults() : { project: 'imported' });
  });

  it('preserves malformed project B rather than writing through the project A cache', () => {
    const before = readFileSync(file(a), 'utf8');
    writeFileSync(file(b), '{"incomplete":');
    const manager = new ConfigFileManager();
    manager.load(a);
    expect(() => manager.set(b, 'custom.enabled', true)).toThrow(/Failed to load config/);
    expect(readFileSync(file(a), 'utf8')).toBe(before);
    expect(readFileSync(file(b), 'utf8')).toBe('{"incomplete":');
    expect(existsSync(file(b) + '.tmp')).toBe(false);
  });

  it('binds newly created configuration to its project', () => {
    const manager = new ConfigFileManager();
    manager.create(a, { project: 'created' }, true);
    expect(manager.get(b, 'project')).toBe('b');
    expect(manager.get(a, 'project')).toBe('created');
  });
});
