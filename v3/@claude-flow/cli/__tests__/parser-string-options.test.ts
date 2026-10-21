import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { CommandParser } from '../src/parser.js';
import type { Command } from '../src/types.js';

const scratch: string[] = [];
afterEach(() => { for (const dir of scratch.splice(0)) rmSync(dir, { recursive: true, force: true }); });

function memoryParser(): CommandParser {
  const parser = new CommandParser({ allowUnknownFlags: true });
  // These are the real memory command's declared string names/types; no storage
  // or model backend is needed to exercise the public parser's type contract.
  const memory: Command = {
    name: 'memory', description: 'Memory options',
    options: [{ name: 'namespace', type: 'string', short: 'n', description: 'Namespace' }],
    subcommands: [{ name: 'store', description: 'Store', options: [
      { name: 'key', short: 'k', type: 'string', description: 'Storage key' },
      { name: 'value', type: 'string', description: 'Value' },
      { name: 'path', type: 'string', description: 'Database path' },
      { name: 'ttl', type: 'number', description: 'TTL' },
      { name: 'upsert', type: 'boolean', description: 'Upsert' },
    ] }],
  };
  parser.registerCommand(memory);
  return parser;
}

describe('declared string option values', () => {
  it.each(['001', '0', 'false', 'true', '1e3', '9007199254740993', '-001'])('preserves %s in separated and equal forms', (value) => {
    const parser = memoryParser();
    for (const argv of [
      ['memory', 'store', '--key', value, '--value', value, '--path', value],
      ['memory', 'store', `--key=${value}`, `--value=${value}`, `--path=${value}`],
      ['memory', 'store', '-k', value, '-n', value],
    ]) {
      const parsed = parser.parse(argv);
      expect(parsed.flags.key).toBe(value);
      if (parsed.flags.value !== undefined) expect(parsed.flags.value).toBe(value);
      if (parsed.flags.path !== undefined) expect(parsed.flags.path).toBe(value);
      if (parsed.flags.namespace !== undefined) expect(parsed.flags.namespace).toBe(value);
    }
  });

  it('opens the exact numeric-looking config filename via the actual global option', () => {
    const dir = mkdtempSync(join(tmpdir(), 'parser-string-file-')); scratch.push(dir);
    writeFileSync(join(dir, '001'), 'requested config');
    const parser = new CommandParser();
    expect(parser.getGlobalOptions().find(option => option.name === 'config')?.type).toBe('string');
    for (const argv of [['--config', '001'], ['--config=001'], ['-c', '001']]) {
      const value = parser.parse(argv).flags.config;
      expect(typeof value).toBe('string');
      expect(readFileSync(join(dir, value as string), 'utf8')).toBe('requested config');
    }
  });

  it('finds the selected command after a separated global option value', () => {
    for (const config of ['001', 'memory']) {
      const parsed = memoryParser().parse(['--config', config, 'memory', 'store', '--key', '002', '--value', 'false']);
      expect(parsed.command).toEqual(['memory', 'store']);
      expect(parsed.flags.config).toBe(config);
      expect(parsed.flags.key).toBe('002');
      expect(parsed.flags.value).toBe('false');
    }
  });

  it('honors explicitly configured stringFlags without a registered command', () => {
    const parser = new CommandParser({ stringFlags: ['record-id'], aliases: { r: 'record-id' } });
    for (const argv of [['--record-id', '001'], ['--record-id=false'], ['-r', '001']]) {
      const value = parser.parse(argv).flags.recordId;
      expect(value).toBe(argv[0].includes('=') ? 'false' : '001');
    }
  });

  it('retains explicit aliases that replace global short names', () => {
    const parser = new CommandParser({ stringFlags: ['record-id'], aliases: { c: 'record-id' } });
    expect(parser.parse(['-c', '001']).flags.recordId).toBe('001');
  });

  it('uses the selected nested command type while preserving numeric and boolean controls', () => {
    const parser = memoryParser();
    parser.registerCommand({ name: 'other', description: 'Unrelated', options: [
      { name: 'key', type: 'boolean', description: 'Unrelated boolean' },
    ] });
    const parsed = parser.parse(['memory', 'store', '--key', 'false', '--ttl', '-2', '--upsert', 'false', '--unknown=42']);
    expect(parsed.flags.key).toBe('false');
    expect(parsed.flags.ttl).toBe(-2);
    expect(parsed.flags.upsert).toBe(false);
    expect(parsed.flags.unknown).toBe(42);
    expect(parsed.positional).toEqual([]);
  });

  it('preserves declared strings at the supported nested subcommand depth', () => {
    const parser = new CommandParser();
    parser.registerCommand({ name: 'project', description: 'Project', subcommands: [{
      name: 'record', description: 'Record', subcommands: [{ name: 'read', description: 'Read', options: [
        { name: 'id', short: 'r', type: 'string', description: 'ID' },
      ] }],
    }] });
    expect(parser.parse(['project', 'record', 'read', '--id=001']).flags.id).toBe('001');
    expect(parser.parse(['project', 'record', 'read', '-r', 'false']).flags.id).toBe('false');
  });

  it.each([
    ['project', '--config', 'x', 'record'],
    ['project', 'input', 'record'],
  ])('does not borrow child options outside the returned command path: %j', (...prefix) => {
    const parser = new CommandParser();
    parser.registerCommand({ name: 'project', description: 'Project', options: [
      { name: 'id', type: 'number', description: 'Root ID' },
      { name: 'probe', type: 'number', description: 'Root count' },
      { name: 'rating', short: 'r', type: 'number', description: 'Root rating' },
    ], subcommands: [{ name: 'record', description: 'Record', options: [
      { name: 'id', type: 'string', description: 'Child ID' },
      { name: 'probe', type: 'boolean', description: 'Child switch' },
      { name: 'code', short: 'r', type: 'string', description: 'Child code' },
    ] }] });
    const parsed = parser.parse([...prefix, '--id', '001', '--probe', '0', '-r', '2']);
    expect(parsed.command).toEqual(['project']);
    expect(parsed.flags.id).toBe(1);
    expect(parsed.flags.probe).toBe(0);
    expect(parsed.flags.rating).toBe(2);
    expect(parsed.flags.code).toBeUndefined();
    expect(parsed.positional).toEqual(prefix[1] === 'input' ? ['input', 'record'] : ['record']);
  });

  it('keeps string types and aliases at the contiguous three-subcommand depth', () => {
    const parser = new CommandParser();
    parser.registerCommand({ name: 'project', description: 'Project', subcommands: [{
      name: 'record', description: 'Record', subcommands: [{
        name: 'read', description: 'Read', subcommands: [{ name: 'detail', description: 'Detail', options: [
          { name: 'id', type: 'string', description: 'ID' },
          { name: 'code', short: 'r', type: 'string', description: 'Code' },
          { name: 'probe', type: 'boolean', description: 'Switch' },
        ] }],
      }],
    }] });
    const parsed = parser.parse(['project', 'record', 'read', 'detail', '--id', '001', '-r', 'false', '--probe', 'false']);
    expect(parsed.command).toEqual(['project', 'record', 'read', 'detail']);
    expect(parsed.flags.id).toBe('001');
    expect(parsed.flags.code).toBe('false');
    expect(parsed.flags.probe).toBe(false);
    expect(parsed.positional).toEqual([]);
  });

  it('lets an explicitly numeric command option override a global string option', () => {
    const parser = new CommandParser();
    parser.registerCommand({ name: 'numeric', description: 'Numeric control', options: [
      { name: 'config', type: 'number', description: 'Numeric option' },
    ] });
    expect(parser.parse(['numeric', '--config', '001']).flags.config).toBe(1);
  });

  it('retains literal positionals after the end-of-flags marker', () => {
    const parsed = memoryParser().parse(['memory', 'store', '--key=001', '--', '--key', 'false', '001']);
    expect(parsed.flags.key).toBe('001');
    expect(parsed.positional).toEqual(['--key', 'false', '001']);
  });
});
