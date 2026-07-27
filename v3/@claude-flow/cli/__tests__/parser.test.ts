/**
 * CommandParser Standalone Tests
 *
 * Tests the parser module in isolation, covering:
 *   - Flag parsing: long, short, combined, equals, negation, boolean, value
 *   - Value coercion: "true"/"false"/number/string
 *   - Command + subcommand resolution (including nested 3-level)
 *   - End-of-flags marker (--)
 *   - Alias resolution from global + command options
 *   - Default application
 *   - Flag validation: required, choices, custom validator, unknown
 *   - getAllCommands deduplication
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { CommandParser } from '../src/parser.js';
import type { Command } from '../src/types.js';

describe('CommandParser', () => {
  let parser: CommandParser;

  beforeEach(() => {
    parser = new CommandParser({ allowUnknownFlags: true });
  });

  // -------------------------------------------------------------------------
  // Basic flag parsing
  // -------------------------------------------------------------------------
  describe('flag parsing', () => {
    it('should parse long boolean flag', () => {
      const result = parser.parse(['--verbose']);
      expect(result.flags.verbose).toBe(true);
    });

    it('should parse --flag=value syntax', () => {
      const result = parser.parse(['--output=file.txt']);
      expect(result.flags.output).toBe('file.txt');
    });

    it('should parse --flag value syntax (non-boolean)', () => {
      // Register a command so the positional "hello" doesn't get treated as command
      const result = parser.parse(['--name', 'hello']);
      expect(result.flags.name).toBe('hello');
    });

    it('should parse --no-flag as boolean false', () => {
      const result = parser.parse(['--no-color']);
      expect(result.flags.color).toBe(false);
    });

    it('should parse short flag -V via global alias', () => {
      const result = parser.parse(['-V']);
      expect(result.flags.version).toBe(true);
    });

    it('should parse combined short flags like -abc', () => {
      const result = parser.parse(['-abc']);
      expect(result.flags.a).toBe(true);
      expect(result.flags.b).toBe(true);
      // Note: 'c' is aliased to 'config' by global options, so the key is 'config'
      expect(result.flags.config).toBe(true);
    });

    it('should stop parsing flags after "--"', () => {
      const result = parser.parse(['--verbose', '--', '--not-a-flag']);
      expect(result.flags.verbose).toBe(true);
      expect(result.flags.notAFlag).toBeUndefined();
      expect(result.positional).toContain('--not-a-flag');
    });
  });

  // -------------------------------------------------------------------------
  // Value coercion via parseValue
  // -------------------------------------------------------------------------
  describe('value coercion', () => {
    it('should coerce "true" to boolean true', () => {
      const result = parser.parse(['--flag=true']);
      expect(result.flags.flag).toBe(true);
    });

    it('should coerce "false" to boolean false', () => {
      const result = parser.parse(['--flag=false']);
      expect(result.flags.flag).toBe(false);
    });

    it('should coerce numeric strings to numbers', () => {
      const result = parser.parse(['--count=42']);
      expect(result.flags.count).toBe(42);
    });

    it('should coerce decimal strings to numbers', () => {
      const result = parser.parse(['--ratio=3.14']);
      expect(result.flags.ratio).toBe(3.14);
    });

    it('should keep non-numeric strings as strings', () => {
      const result = parser.parse(['--label=hello']);
      expect(result.flags.label).toBe('hello');
    });

    it('should coerce "TRUE" case-insensitively', () => {
      const result = parser.parse(['--flag=TRUE']);
      expect(result.flags.flag).toBe(true);
    });

    it('should coerce "FALSE" case-insensitively', () => {
      const result = parser.parse(['--flag=FALSE']);
      expect(result.flags.flag).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // normalizeKey (kebab-case to camelCase)
  // -------------------------------------------------------------------------
  describe('key normalization', () => {
    it('should convert kebab-case keys to camelCase', () => {
      const result = parser.parse(['--some-long-flag=yes']);
      expect(result.flags.someLongFlag).toBe('yes');
    });

    it('should leave simple keys unchanged', () => {
      const result = parser.parse(['--simple=val']);
      expect(result.flags.simple).toBe('val');
    });
  });

  // -------------------------------------------------------------------------
  // Command & subcommand resolution
  // -------------------------------------------------------------------------
  describe('command resolution', () => {
    it('should detect registered command', () => {
      const cmd: Command = { name: 'agent', description: 'Agent mgmt' };
      parser.registerCommand(cmd);

      const result = parser.parse(['agent']);
      expect(result.command).toEqual(['agent']);
    });

    it('should detect subcommand', () => {
      const sub: Command = { name: 'spawn', description: 'Spawn agent' };
      const cmd: Command = { name: 'agent', description: 'Agent mgmt', subcommands: [sub] };
      parser.registerCommand(cmd);

      const result = parser.parse(['agent', 'spawn']);
      expect(result.command).toEqual(['agent', 'spawn']);
    });

    it('should detect nested subcommand (3 levels)', () => {
      const deep: Command = { name: 'run', description: 'Run it' };
      const mid: Command = { name: 'worker', description: 'Worker', subcommands: [deep] };
      const top: Command = { name: 'hooks', description: 'Hooks', subcommands: [mid] };
      parser.registerCommand(top);

      const result = parser.parse(['hooks', 'worker', 'run']);
      expect(result.command).toEqual(['hooks', 'worker', 'run']);
    });

    it('should resolve subcommand by alias', () => {
      const sub: Command = { name: 'list', aliases: ['ls'], description: 'List items' };
      const cmd: Command = { name: 'agent', description: 'Agent mgmt', subcommands: [sub] };
      parser.registerCommand(cmd);

      const result = parser.parse(['agent', 'ls']);
      expect(result.command).toEqual(['agent', 'ls']);
    });

    it('should treat unregistered words as positional args', () => {
      const result = parser.parse(['unknown', 'thing']);
      expect(result.command).toEqual([]);
      expect(result.positional).toEqual(['unknown', 'thing']);
    });

    it('should register command aliases', () => {
      const cmd: Command = { name: 'config', aliases: ['cfg'], description: 'Config' };
      parser.registerCommand(cmd);

      const result = parser.parse(['cfg']);
      expect(result.command).toEqual(['cfg']);
    });
  });

  // -------------------------------------------------------------------------
  // Positional arguments
  // -------------------------------------------------------------------------
  describe('positional arguments', () => {
    it('should collect positional args after command', () => {
      const cmd: Command = { name: 'task', description: 'Task mgmt' };
      parser.registerCommand(cmd);

      const result = parser.parse(['task', 'arg1', 'arg2']);
      expect(result.positional).toEqual(['arg1', 'arg2']);
      expect(result.flags._).toEqual(['arg1', 'arg2']);
    });

    it('should collect args after "--" as positional', () => {
      const result = parser.parse(['--', 'a', 'b']);
      expect(result.positional).toEqual(['a', 'b']);
    });
  });

  // -------------------------------------------------------------------------
  // Defaults
  // -------------------------------------------------------------------------
  describe('defaults', () => {
    it('should apply global option defaults', () => {
      const result = parser.parse([]);
      // Global defaults from initializeGlobalOptions
      expect(result.flags.help).toBe(false);
      expect(result.flags.version).toBe(false);
      expect(result.flags.verbose).toBe(false);
      expect(result.flags.format).toBe('text');
      expect(result.flags.interactive).toBe(true);
    });

    it('should not overwrite explicitly set flags with defaults', () => {
      const result = parser.parse(['--verbose']);
      expect(result.flags.verbose).toBe(true);
    });

    it('should apply custom defaults from options', () => {
      const p = new CommandParser({
        allowUnknownFlags: true,
        defaults: { myFlag: 'default-value' },
      });
      const result = p.parse([]);
      expect(result.flags.myFlag).toBe('default-value');
    });

    // #2775 regression: applyDefaults previously only walked globalOptions,
    // so command-level and subcommand-level `default:` values silently
    // dropped and the action handler saw them as `undefined`. The immediate
    // victim was `memory store --upsert` — every subcommand with a per-flag
    // default was affected.
    it('applies command-level option defaults (#2775 regression)', () => {
      const cmd: Command = {
        name: 'cmd',
        description: 'Test',
        options: [
          { name: 'upsert', type: 'boolean', description: 'Upsert', default: true },
        ],
      };
      const p = new CommandParser({ allowUnknownFlags: true });
      p.registerCommand(cmd);
      const result = p.parse(['cmd']);
      expect(result.flags.upsert).toBe(true);
    });

    it('applies subcommand-level option defaults (#2775 regression)', () => {
      const cmd: Command = {
        name: 'memory',
        description: 'Memory command',
        subcommands: [
          {
            name: 'store',
            description: 'Store',
            options: [
              { name: 'upsert', type: 'boolean', description: 'Upsert', default: true },
            ],
          },
        ],
      };
      const p = new CommandParser({ allowUnknownFlags: true });
      p.registerCommand(cmd);
      const result = p.parse(['memory', 'store']);
      expect(result.flags.upsert).toBe(true);
    });

    it('does not overwrite explicit subcommand flags with the default', () => {
      const cmd: Command = {
        name: 'memory',
        description: 'Memory command',
        subcommands: [
          {
            name: 'store',
            description: 'Store',
            options: [
              { name: 'upsert', type: 'boolean', description: 'Upsert', default: true },
            ],
          },
        ],
      };
      const p = new CommandParser({ allowUnknownFlags: true });
      p.registerCommand(cmd);
      // --no-upsert should defeat the default:true
      const result = p.parse(['memory', 'store', '--no-upsert']);
      expect(result.flags.upsert).toBe(false);
    });

    // #2778 follow-up: getScopedBooleanFlags previously walked EVERY
    // registered command's options and marked any boolean-typed flag as
    // boolean everywhere. That broke a numeric --parallel on `hooks route`
    // because `swarm start --parallel` (boolean) polluted the global set.
    // Narrowest-scope wins: subcommand's non-boolean declaration overrides.
    it('subcommand non-boolean flag overrides a boolean declaration on another command', () => {
      const swarmCmd: Command = {
        name: 'swarm',
        description: 'Swarm',
        subcommands: [
          {
            name: 'start',
            description: 'Start swarm',
            options: [
              { name: 'parallel', type: 'boolean', description: 'Enable parallel execution' },
            ],
          },
        ],
      };
      const hooksCmd: Command = {
        name: 'hooks',
        description: 'Hooks',
        subcommands: [
          {
            name: 'route',
            description: 'Route',
            options: [
              { name: 'parallel', type: 'number', description: 'Fanout width' },
            ],
          },
        ],
      };
      const p = new CommandParser({ allowUnknownFlags: true });
      p.registerCommand(swarmCmd);
      p.registerCommand(hooksCmd);

      // On hooks route, `--parallel 7` must reach as the NUMBER 7 — not the
      // boolean `true` that the polluted global set would have produced.
      const result = p.parse(['hooks', 'route', '--parallel', '7']);
      expect(result.flags.parallel).toBe(7);

      // And on swarm start, `--parallel` still parses as boolean.
      const swarmResult = p.parse(['swarm', 'start', '--parallel']);
      expect(swarmResult.flags.parallel).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  // Alias resolution from command options
  // -------------------------------------------------------------------------
  describe('alias resolution', () => {
    it('should resolve short flags from command options', () => {
      const cmd: Command = {
        name: 'test',
        description: 'Test',
        options: [{ name: 'debug', short: 'd', type: 'boolean', description: 'Debug' }],
      };
      parser.registerCommand(cmd);

      const result = parser.parse(['test', '-d']);
      expect(result.flags.debug).toBe(true);
    });

    it('should resolve short flags from subcommand options', () => {
      const sub: Command = {
        name: 'run',
        description: 'Run',
        options: [{ name: 'timeout', short: 't', type: 'string', description: 'Timeout' }],
      };
      const cmd: Command = { name: 'task', description: 'Task', subcommands: [sub] };
      parser.registerCommand(cmd);

      const result = parser.parse(['task', 'run', '-t', '5000']);
      expect(result.flags.timeout).toBe(5000);
    });
  });

  // -------------------------------------------------------------------------
  // validateFlags
  // -------------------------------------------------------------------------
  describe('validateFlags', () => {
    it('should return empty array for valid flags', () => {
      const cmd: Command = {
        name: 'test',
        description: 'Test',
        options: [{ name: 'name', type: 'string', description: 'Name' }],
      };
      const errors = parser.validateFlags({ _: [], name: 'hello' }, cmd);
      expect(errors).toEqual([]);
    });

    it('should report missing required flags', () => {
      const cmd: Command = {
        name: 'test',
        description: 'Test',
        options: [
          { name: 'name', type: 'string', required: true, description: 'Name' },
        ],
      };
      const errors = parser.validateFlags({ _: [] }, cmd);
      expect(errors.length).toBe(1);
      expect(errors[0]).toContain('Required option missing');
      expect(errors[0]).toContain('--name');
    });

    it('should report invalid choice values', () => {
      const cmd: Command = {
        name: 'test',
        description: 'Test',
        options: [
          { name: 'output-mode', type: 'string', choices: ['json', 'text'], description: 'Output mode' },
        ],
      };
      const errors = parser.validateFlags({ _: [], outputMode: 'xml' }, cmd);
      expect(errors.length).toBe(1);
      expect(errors[0]).toContain('Invalid value');
      expect(errors[0]).toContain('xml');
    });

    it('should accept valid choice values', () => {
      const cmd: Command = {
        name: 'test',
        description: 'Test',
        options: [
          { name: 'output-mode', type: 'string', choices: ['json', 'text'], description: 'Output mode' },
        ],
      };
      const errors = parser.validateFlags({ _: [], outputMode: 'json' }, cmd);
      expect(errors).toEqual([]);
    });

    it('should run custom validator returning string error', () => {
      const cmd: Command = {
        name: 'test',
        description: 'Test',
        options: [
          {
            name: 'port',
            type: 'string',
            description: 'Port',
            validate: (v) => (Number(v) > 0 ? true : 'Port must be positive'),
          },
        ],
      };
      const errors = parser.validateFlags({ _: [], port: -1 }, cmd);
      expect(errors.length).toBe(1);
      expect(errors[0]).toBe('Port must be positive');
    });

    it('should run custom validator returning false', () => {
      const cmd: Command = {
        name: 'test',
        description: 'Test',
        options: [
          {
            name: 'count',
            type: 'string',
            description: 'Count',
            validate: () => false,
          },
        ],
      };
      const errors = parser.validateFlags({ _: [], count: 'x' }, cmd);
      expect(errors.length).toBe(1);
      expect(errors[0]).toContain('Invalid value for --count');
    });

    it('should report unknown flags when allowUnknownFlags is false', () => {
      const strictParser = new CommandParser({ allowUnknownFlags: false });
      const errors = strictParser.validateFlags({ _: [], unknown: true });
      expect(errors.length).toBeGreaterThan(0);
      expect(errors.some(e => e.includes('Unknown option'))).toBe(true);
    });

    it('should not report unknown flags when allowUnknownFlags is true', () => {
      // Default parser allows unknown flags
      const errors = parser.validateFlags({ _: [], unknown: true });
      expect(errors).toEqual([]);
    });
  });

  // -------------------------------------------------------------------------
  // getAllCommands
  // -------------------------------------------------------------------------
  describe('getAllCommands', () => {
    it('should return unique commands (no duplicates from aliases)', () => {
      const cmd: Command = { name: 'config', aliases: ['cfg', 'conf'], description: 'Config' };
      parser.registerCommand(cmd);

      const all = parser.getAllCommands();
      const configCmds = all.filter(c => c.name === 'config');
      expect(configCmds.length).toBe(1);
    });

    it('should return all registered commands', () => {
      parser.registerCommand({ name: 'agent', description: 'Agent' });
      parser.registerCommand({ name: 'swarm', description: 'Swarm' });
      parser.registerCommand({ name: 'memory', description: 'Memory' });

      const all = parser.getAllCommands();
      expect(all.length).toBe(3);
    });
  });

  // -------------------------------------------------------------------------
  // getCommand
  // -------------------------------------------------------------------------
  describe('getCommand', () => {
    it('should return command by name', () => {
      const cmd: Command = { name: 'agent', description: 'Agent' };
      parser.registerCommand(cmd);

      expect(parser.getCommand('agent')).toBe(cmd);
    });

    it('should return command by alias', () => {
      const cmd: Command = { name: 'config', aliases: ['cfg'], description: 'Config' };
      parser.registerCommand(cmd);

      expect(parser.getCommand('cfg')).toBe(cmd);
    });

    it('should return undefined for unregistered command', () => {
      expect(parser.getCommand('nonexistent')).toBeUndefined();
    });
  });

  // -------------------------------------------------------------------------
  // getGlobalOptions
  // -------------------------------------------------------------------------
  describe('getGlobalOptions', () => {
    it('should return a copy of global options', () => {
      const opts = parser.getGlobalOptions();
      expect(opts.length).toBeGreaterThan(0);
      expect(opts.some(o => o.name === 'help')).toBe(true);
      expect(opts.some(o => o.name === 'version')).toBe(true);
      expect(opts.some(o => o.name === 'verbose')).toBe(true);
      expect(opts.some(o => o.name === 'format')).toBe(true);

      // Should be a copy, not the same reference
      opts.push({ name: 'extra', type: 'string', description: 'Extra' });
      expect(parser.getGlobalOptions().length).toBe(opts.length - 1);
    });
  });

  // -------------------------------------------------------------------------
  // raw preservation
  // -------------------------------------------------------------------------
  describe('raw args', () => {
    it('should preserve the original args array in raw', () => {
      const args = ['agent', 'spawn', '--type', 'coder', '--verbose'];
      const result = parser.parse(args);
      expect(result.raw).toEqual(args);
    });
  });

  // -------------------------------------------------------------------------
  // Boolean flag from registered command
  // -------------------------------------------------------------------------
  describe('boolean flag from command options', () => {
    it('should recognize command-level boolean flags', () => {
      const cmd: Command = {
        name: 'run',
        description: 'Run',
        options: [{ name: 'force', type: 'boolean', description: 'Force' }],
      };
      parser.registerCommand(cmd);

      const result = parser.parse(['run', '--force']);
      expect(result.flags.force).toBe(true);
    });

    it('should recognize boolean flags from subcommand options', () => {
      const sub: Command = {
        name: 'stop',
        description: 'Stop',
        options: [{ name: 'graceful', type: 'boolean', description: 'Graceful' }],
      };
      const cmd: Command = { name: 'agent', description: 'Agent', subcommands: [sub] };
      parser.registerCommand(cmd);

      const result = parser.parse(['agent', 'stop', '--graceful']);
      expect(result.flags.graceful).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  // booleanFlags from constructor options
  // -------------------------------------------------------------------------
  describe('booleanFlags option', () => {
    it('should recognize custom boolean flags passed via constructor', () => {
      const p = new CommandParser({
        allowUnknownFlags: true,
        booleanFlags: ['my-custom-flag'],
      });
      const result = p.parse(['--my-custom-flag']);
      expect(result.flags.myCustomFlag).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  // #1596: lazy command routing — `daemon start` must not be mis-routed to
  // the core `start` command when `daemon` is a lazy-loaded command.
  // -------------------------------------------------------------------------
  describe('lazy command routing (#1596)', () => {
    it('should not mis-route "daemon start" to the sync "start" command', () => {
      const p = new CommandParser({ allowUnknownFlags: true });
      // Sync command "start" is registered with full definition
      p.registerCommand({ name: 'start', description: 'Top-level start', handler: async () => ({ success: true }) } as Command);
      // "daemon" is lazy — only its name is registered
      p.registerLazyCommandName('daemon');

      const result = p.parse(['daemon', 'start', '--foreground']);
      expect(result.command[0]).toBe('daemon');
      expect(result.positional[0]).toBe('start');
      expect(result.flags.foreground).toBe(true);
    });

    it('should still recognize bare "start" as the sync start command', () => {
      const p = new CommandParser({ allowUnknownFlags: true });
      p.registerCommand({ name: 'start', description: 'Top-level start', handler: async () => ({ success: true }) } as Command);
      p.registerLazyCommandName('daemon');

      const result = p.parse(['start']);
      expect(result.command[0]).toBe('start');
      expect(result.positional).toHaveLength(0);
    });

    it('should route lazy command even when a global flag comes first', () => {
      const p = new CommandParser({ allowUnknownFlags: true });
      p.registerCommand({ name: 'start', description: '', handler: async () => ({}) } as Command);
      p.registerLazyCommandName('daemon');

      const result = p.parse(['-v', 'daemon', 'start', '--foreground']);
      expect(result.command[0]).toBe('daemon');
      expect(result.positional[0]).toBe('start');
      expect(result.flags.verbose).toBe(true);
    });

    it('should resolve bare lazy command (e.g. "doctor")', () => {
      const p = new CommandParser({ allowUnknownFlags: true });
      p.registerLazyCommandName('doctor');

      const result = p.parse(['doctor']);
      expect(result.command[0]).toBe('doctor');
    });
  });

  // -------------------------------------------------------------------------
  // Edge: short flag with value
  // -------------------------------------------------------------------------
  describe('short flag with value', () => {
    it('should parse single short non-boolean flag followed by value', () => {
      const cmd: Command = {
        name: 'test',
        description: 'Test',
        options: [{ name: 'type', short: 't', type: 'string', description: 'Type' }],
      };
      parser.registerCommand(cmd);

      const result = parser.parse(['test', '-t', 'coder']);
      expect(result.flags.type).toBe('coder');
    });
  });
});
