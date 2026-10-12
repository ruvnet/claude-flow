import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as fs from 'fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { ConfigFileManager } from '../src/services/config-file-manager.js';

vi.mock('fs', async (importOriginal) => ({
  ...await importOriginal<typeof import('fs')>(),
  readFileSync: vi.fn((await importOriginal<typeof import('fs')>()).readFileSync),
}));
let cwd: string;
let file: string;
beforeEach(() => {
  cwd = fs.mkdtempSync(join(tmpdir(), 'config-preserve-'));
  file = join(cwd, 'claude-flow.config.json');
  vi.stubEnv('CLAUDE_FLOW_CONFIG', '');
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  fs.rmSync(cwd, { recursive: true, force: true });
});

describe('config writes preserve unreadable or invalid input', () => {
  it.each(['{"memory":', 'null', '[1,2]', '42', '"config"'])('rejects %s without replacing the file', (contents) => {
    fs.writeFileSync(file, contents);
    expect(() => new ConfigFileManager().set(cwd, 'swarm.maxAgents', 3)).toThrow(/config/i);
    expect(fs.readFileSync(file, 'utf8')).toBe(contents);
    expect(fs.existsSync(file + '.tmp')).toBe(false);
  });

  it('propagates permission failures instead of returning writable defaults', () => {
    fs.writeFileSync(file, '{"private":"keep"}');
    vi.mocked(fs.readFileSync).mockImplementationOnce(() => {
      throw Object.assign(new Error('permission denied'), { code: 'EACCES' });
    });
    expect(() => new ConfigFileManager().set(cwd, 'swarm.maxAgents', 3)).toThrow(/permission denied/);
    expect(fs.readFileSync(file, 'utf8')).toBe('{"private":"keep"}');
  });

  it('treats a file removed between discovery and read as missing', () => {
    const manager = new ConfigFileManager();
    vi.spyOn(manager, 'findConfig').mockReturnValue(file);
    expect(manager.load(cwd)).toBeNull();
    expect(manager.getConfigPath()).toBeNull();
  });

  it('still creates a missing config and preserves unrelated fields in a valid one', () => {
    new ConfigFileManager().set(cwd, 'swarm.maxAgents', 3);
    expect(JSON.parse(fs.readFileSync(file, 'utf8')).swarm.maxAgents).toBe(3);
    fs.writeFileSync(file, '{"custom":{"enabled":false},"swarm":{"maxAgents":8}}');
    new ConfigFileManager().set(cwd, 'swarm.maxAgents', 4);
    expect(JSON.parse(fs.readFileSync(file, 'utf8'))).toEqual({ custom: { enabled: false }, swarm: { maxAgents: 4 } });
  });
});
