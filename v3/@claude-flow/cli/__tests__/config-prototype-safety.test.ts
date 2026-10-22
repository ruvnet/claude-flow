import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { ConfigFileManager } from '../src/services/config-file-manager.js';

let cwd: string;
let file: string;
beforeEach(() => {
  cwd = mkdtempSync(join(tmpdir(), 'config-prototype-'));
  file = join(cwd, 'claude-flow.config.json');
  writeFileSync(file, '{"custom":{"keep":true}}');
  vi.stubEnv('CLAUDE_FLOW_CONFIG', '');
});
afterEach(() => {
  delete (Object.prototype as any).configPolluted;
  vi.unstubAllEnvs();
  rmSync(cwd, { recursive: true, force: true });
});

describe('configuration property traversal', () => {
  it.each(['__proto__.configPolluted', 'custom.__proto__.configPolluted', 'constructor.prototype.configPolluted', 'custom.constructor.prototype.configPolluted', 'custom.prototype.configPolluted', '__proto__'])('rejects unsafe key %s before mutating memory or disk', (key) => {
    const manager = new ConfigFileManager();
    manager.load(cwd);
    const before = readFileSync(file, 'utf8');
    let error: unknown;
    try { manager.set(cwd, key, 'tainted'); } catch (caught) { error = caught; }
    expect(({} as any).configPolluted).toBeUndefined();
    expect(error).toBeInstanceOf(Error);
    expect(String(error)).toMatch(/unsafe.*key/i);
    expect(readFileSync(file, 'utf8')).toBe(before);
    expect(manager.get(cwd, 'custom.keep')).toBe(true);
  });

  it('does not read inherited properties as configuration values', () => {
    const manager = new ConfigFileManager();
    expect(manager.get(cwd, 'toString')).toBeUndefined();
    expect(manager.get(cwd, 'custom.constructor')).toBeUndefined();
    expect(manager.get(cwd, 'custom.__proto__')).toBeUndefined();
  });

  it('continues to write ordinary nested own properties', () => {
    const manager = new ConfigFileManager();
    manager.set(cwd, 'custom.enabled', false);
    manager.set(cwd, 'custom.count', 0);
    expect(JSON.parse(readFileSync(file, 'utf8'))).toEqual({ custom: { keep: true, enabled: false, count: 0 } });
  });
});
