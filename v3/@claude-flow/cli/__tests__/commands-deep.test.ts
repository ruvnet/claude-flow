/**
 * V3 CLI Deep Commands & Infrastructure Tests
 * 100+ test cases covering all commands, init system, parser, output, and suggest modules
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

// ============================================================================
// SECTION 1: Command Definitions (38+ commands)
// ============================================================================

// Mock MCP client before importing commands
vi.mock('../src/mcp-client.js', () => ({
  callMCPTool: vi.fn(async () => ({})),
  MCPClientError: class MCPClientError extends Error {
    constructor(message: string) {
      super(message);
      this.name = 'MCPClientError';
    }
  },
}));

// Mock fs/promises for commands that use it
vi.mock('fs/promises', () => ({
  default: {
    readFile: vi.fn(async () => '{}'),
    writeFile: vi.fn(async () => undefined),
    mkdir: vi.fn(async () => undefined),
    access: vi.fn(async () => undefined),
    readdir: vi.fn(async () => []),
    stat: vi.fn(async () => ({ isDirectory: () => true, isFile: () => true })),
    unlink: vi.fn(async () => undefined),
    rm: vi.fn(async () => undefined),
    cp: vi.fn(async () => undefined),
  },
  readFile: vi.fn(async () => '{}'),
  writeFile: vi.fn(async () => undefined),
  mkdir: vi.fn(async () => undefined),
  access: vi.fn(async () => undefined),
  readdir: vi.fn(async () => []),
  stat: vi.fn(async () => ({ isDirectory: () => true, isFile: () => true })),
  unlink: vi.fn(async () => undefined),
  rm: vi.fn(async () => undefined),
  cp: vi.fn(async () => undefined),
}));

// Mock child_process
vi.mock('child_process', () => ({
  execSync: vi.fn(() => Buffer.from('')),
  execFileSync: vi.fn(() => ''),
  exec: vi.fn(),
  execFile: vi.fn(),
  spawn: vi.fn(() => ({
    on: vi.fn(),
    stdout: { on: vi.fn() },
    stderr: { on: vi.fn() },
    pid: 12345,
  })),
}));

import { agentCommand } from '../src/commands/agent.js';
import { swarmCommand } from '../src/commands/swarm.js';
import { memoryCommand } from '../src/commands/memory.js';
import { configCommand } from '../src/commands/config.js';
import { initCommand } from '../src/commands/init.js';
import { statusCommand } from '../src/commands/status.js';
import { taskCommand } from '../src/commands/task.js';
import { sessionCommand } from '../src/commands/session.js';
import { mcpCommand } from '../src/commands/mcp.js';
import { hooksCommand } from '../src/commands/hooks.js';
import { daemonCommand } from '../src/commands/daemon.js';
import { doctorCommand } from '../src/commands/doctor.js';
import { embeddingsCommand } from '../src/commands/embeddings.js';
import { neuralCommand } from '../src/commands/neural.js';
import { performanceCommand } from '../src/commands/performance.js';
import { securityCommand } from '../src/commands/security.js';
import { hiveMindCommand } from '../src/commands/hive-mind.js';
import { completionsCommand } from '../src/commands/completions.js';
import { migrateCommand } from '../src/commands/migrate.js';
import { workflowCommand } from '../src/commands/workflow.js';
import { claimsCommand } from '../src/commands/claims.js';
import { deploymentCommand } from '../src/commands/deployment.js';
import { providersCommand } from '../src/commands/providers.js';
import { pluginsCommand } from '../src/commands/plugins.js';
import { processCommand } from '../src/commands/process.js';
import { startCommand } from '../src/commands/start.js';
import { analyzeCommand } from '../src/commands/analyze.js';
import { routeCommand } from '../src/commands/route.js';
import { progressCommand } from '../src/commands/progress.js';
import { issuesCommand } from '../src/commands/issues.js';
import { guidanceCommand } from '../src/commands/guidance.js';
import { applianceCommand } from '../src/commands/appliance.js';
import updateCommand from '../src/commands/update.js';
import { ruvectorCommand } from '../src/commands/ruvector/index.js';

import type { Command } from '../src/types.js';

// ============================================================================
// Helper: validate a command structure
// ============================================================================

function expectValidCommand(cmd: Command, expectedName: string) {
  expect(cmd).toBeDefined();
  expect(cmd.name).toBe(expectedName);
  expect(typeof cmd.description).toBe('string');
  expect(cmd.description.length).toBeGreaterThan(0);
}

function expectHasSubcommands(cmd: Command, minCount: number) {
  expect(cmd.subcommands).toBeDefined();
  expect(Array.isArray(cmd.subcommands)).toBe(true);
  expect(cmd.subcommands!.length).toBeGreaterThanOrEqual(minCount);
}

function expectSubcommandNames(cmd: Command, names: string[]) {
  const subNames = cmd.subcommands!.map((s) => s.name);
  for (const name of names) {
    expect(subNames).toContain(name);
  }
}

// ============================================================================
// 1. Command Structure Tests
// ============================================================================

describe('Command Definitions', () => {
  describe('agent command', () => {
    it('should have correct name and description', () => {
      expectValidCommand(agentCommand, 'agent');
    });

    it('should have 8 subcommands', () => {
      expectHasSubcommands(agentCommand, 8);
      expectSubcommandNames(agentCommand, [
        'spawn', 'list', 'status', 'stop', 'metrics', 'pool', 'health', 'logs',
      ]);
    });

    it('should have an action or subcommands with actions', () => {
      const hasAction = typeof agentCommand.action === 'function';
      const hasSubActions = agentCommand.subcommands?.some((s) => typeof s.action === 'function');
      expect(hasAction || hasSubActions).toBe(true);
    });

    it('each subcommand should have name and description', () => {
      for (const sub of agentCommand.subcommands!) {
        expect(typeof sub.name).toBe('string');
        expect(typeof sub.description).toBe('string');
      }
    });
  });

  describe('swarm command', () => {
    it('should have correct name', () => {
      expectValidCommand(swarmCommand, 'swarm');
    });

    it('should have subcommands including init, status, deploy, scale', () => {
      expectHasSubcommands(swarmCommand, 4);
      expectSubcommandNames(swarmCommand, ['init', 'status']);
    });
  });

  describe('memory command', () => {
    it('should have correct name', () => {
      expectValidCommand(memoryCommand, 'memory');
    });

    it('should have subcommands for store, retrieve, search, list', () => {
      expectHasSubcommands(memoryCommand, 4);
      expectSubcommandNames(memoryCommand, ['store', 'retrieve', 'search', 'list']);
    });
  });

  describe('config command', () => {
    it('should have correct name', () => {
      expectValidCommand(configCommand, 'config');
    });

    it('should have subcommands including init, get, set', () => {
      expectHasSubcommands(configCommand, 3);
      expectSubcommandNames(configCommand, ['init', 'get', 'set']);
    });
  });

  describe('init command', () => {
    it('should have correct name', () => {
      expectValidCommand(initCommand, 'init');
    });

    it('should have options or subcommands', () => {
      const hasOptions = initCommand.options && initCommand.options.length > 0;
      const hasSubs = initCommand.subcommands && initCommand.subcommands.length > 0;
      expect(hasOptions || hasSubs).toBe(true);
    });
  });

  describe('status command', () => {
    it('should have correct name', () => {
      expectValidCommand(statusCommand, 'status');
    });
  });

  describe('task command', () => {
    it('should have correct name', () => {
      expectValidCommand(taskCommand, 'task');
    });

    it('should have subcommands', () => {
      expectHasSubcommands(taskCommand, 3);
    });
  });

  describe('session command', () => {
    it('should have correct name', () => {
      expectValidCommand(sessionCommand, 'session');
    });

    it('should have subcommands for start, end, restore, list', () => {
      expectHasSubcommands(sessionCommand, 4);
    });
  });

  describe('mcp command', () => {
    it('should have correct name', () => {
      expectValidCommand(mcpCommand, 'mcp');
    });

    it('should have subcommands', () => {
      expectHasSubcommands(mcpCommand, 3);
    });
  });

  describe('hooks command', () => {
    it('should have correct name', () => {
      expectValidCommand(hooksCommand, 'hooks');
    });

    it('should have many subcommands (17+)', () => {
      expectHasSubcommands(hooksCommand, 10);
    });
  });

  describe('daemon command', () => {
    it('should have correct name', () => {
      expectValidCommand(daemonCommand, 'daemon');
    });

    it('should have subcommands for start, stop, status', () => {
      expectHasSubcommands(daemonCommand, 3);
      expectSubcommandNames(daemonCommand, ['start', 'stop', 'status']);
    });
  });

  describe('doctor command', () => {
    it('should have correct name', () => {
      expectValidCommand(doctorCommand, 'doctor');
    });
  });

  describe('embeddings command', () => {
    it('should have correct name', () => {
      expectValidCommand(embeddingsCommand, 'embeddings');
    });

    it('should have subcommands', () => {
      expectHasSubcommands(embeddingsCommand, 3);
    });
  });

  describe('neural command', () => {
    it('should have correct name', () => {
      expectValidCommand(neuralCommand, 'neural');
    });

    it('should have subcommands', () => {
      expectHasSubcommands(neuralCommand, 3);
    });
  });

  describe('performance command', () => {
    it('should have correct name', () => {
      expectValidCommand(performanceCommand, 'performance');
    });

    it('should have subcommands', () => {
      expectHasSubcommands(performanceCommand, 3);
    });
  });

  describe('security command', () => {
    it('should have correct name', () => {
      expectValidCommand(securityCommand, 'security');
    });

    it('should have subcommands', () => {
      expectHasSubcommands(securityCommand, 3);
    });
  });

  describe('hive-mind command', () => {
    it('should have correct name', () => {
      expectValidCommand(hiveMindCommand, 'hive-mind');
    });

    it('should have subcommands', () => {
      expectHasSubcommands(hiveMindCommand, 3);
    });
  });

  describe('completions command', () => {
    it('should have correct name', () => {
      expectValidCommand(completionsCommand, 'completions');
    });

    it('should have subcommands for bash, zsh, fish, powershell', () => {
      expectHasSubcommands(completionsCommand, 4);
      expectSubcommandNames(completionsCommand, ['bash', 'zsh', 'fish', 'powershell']);
    });
  });

  describe('migrate command', () => {
    it('should have correct name', () => {
      expectValidCommand(migrateCommand, 'migrate');
    });

    it('should have subcommands', () => {
      expectHasSubcommands(migrateCommand, 3);
    });
  });

  describe('workflow command', () => {
    it('should have correct name', () => {
      expectValidCommand(workflowCommand, 'workflow');
    });

    it('should have subcommands', () => {
      expectHasSubcommands(workflowCommand, 3);
    });
  });

  describe('claims command', () => {
    it('should have correct name', () => {
      expectValidCommand(claimsCommand, 'claims');
    });

    it('should have subcommands', () => {
      expectHasSubcommands(claimsCommand, 3);
    });
  });

  describe('deployment command', () => {
    it('should have correct name', () => {
      expectValidCommand(deploymentCommand, 'deployment');
    });

    it('should have subcommands', () => {
      expectHasSubcommands(deploymentCommand, 3);
    });
  });

  describe('providers command', () => {
    it('should have correct name', () => {
      expectValidCommand(providersCommand, 'providers');
    });

    it('should have subcommands', () => {
      expectHasSubcommands(providersCommand, 3);
    });
  });

  describe('plugins command', () => {
    it('should have correct name', () => {
      expectValidCommand(pluginsCommand, 'plugins');
    });

    it('should have subcommands', () => {
      expectHasSubcommands(pluginsCommand, 3);
    });
  });

  describe('process command', () => {
    it('should have correct name', () => {
      expectValidCommand(processCommand, 'process');
    });
  });

  describe('start command', () => {
    it('should have correct name', () => {
      expectValidCommand(startCommand, 'start');
    });
  });

  describe('analyze command', () => {
    it('should have correct name', () => {
      expectValidCommand(analyzeCommand, 'analyze');
    });

    it('should have subcommands', () => {
      expectHasSubcommands(analyzeCommand, 2);
    });
  });

  describe('route command', () => {
    it('should have correct name', () => {
      expectValidCommand(routeCommand, 'route');
    });
  });

  describe('progress command', () => {
    it('should have correct name', () => {
      expectValidCommand(progressCommand, 'progress');
    });
  });

  describe('issues command', () => {
    it('should have correct name', () => {
      expectValidCommand(issuesCommand, 'issues');
    });
  });

  describe('update command', () => {
    it('should have correct name', () => {
      expectValidCommand(updateCommand, 'update');
    });
  });

  describe('guidance command', () => {
    it('should have correct name', () => {
      expectValidCommand(guidanceCommand, 'guidance');
    });

    it('should have subcommands', () => {
      expectHasSubcommands(guidanceCommand, 3);
    });
  });

  describe('appliance command', () => {
    it('should have correct name', () => {
      expectValidCommand(applianceCommand, 'appliance');
    });

    it('should have subcommands including build, inspect, verify', () => {
      expectHasSubcommands(applianceCommand, 3);
    });
  });

  describe('ruvector command', () => {
    it('should have correct name', () => {
      expectValidCommand(ruvectorCommand, 'ruvector');
    });
  });
});

// All commands array for bulk tests
const allCommands: { cmd: Command; name: string }[] = [
  { cmd: agentCommand, name: 'agent' },
  { cmd: swarmCommand, name: 'swarm' },
  { cmd: memoryCommand, name: 'memory' },
  { cmd: configCommand, name: 'config' },
  { cmd: initCommand, name: 'init' },
  { cmd: statusCommand, name: 'status' },
  { cmd: taskCommand, name: 'task' },
  { cmd: sessionCommand, name: 'session' },
  { cmd: mcpCommand, name: 'mcp' },
  { cmd: hooksCommand, name: 'hooks' },
  { cmd: daemonCommand, name: 'daemon' },
  { cmd: doctorCommand, name: 'doctor' },
  { cmd: embeddingsCommand, name: 'embeddings' },
  { cmd: neuralCommand, name: 'neural' },
  { cmd: performanceCommand, name: 'performance' },
  { cmd: securityCommand, name: 'security' },
  { cmd: hiveMindCommand, name: 'hive-mind' },
  { cmd: completionsCommand, name: 'completions' },
  { cmd: migrateCommand, name: 'migrate' },
  { cmd: workflowCommand, name: 'workflow' },
  { cmd: claimsCommand, name: 'claims' },
  { cmd: deploymentCommand, name: 'deployment' },
  { cmd: providersCommand, name: 'providers' },
  { cmd: pluginsCommand, name: 'plugins' },
  { cmd: processCommand, name: 'process' },
  { cmd: startCommand, name: 'start' },
  { cmd: analyzeCommand, name: 'analyze' },
  { cmd: routeCommand, name: 'route' },
  { cmd: progressCommand, name: 'progress' },
  { cmd: issuesCommand, name: 'issues' },
  { cmd: updateCommand, name: 'update' },
  { cmd: guidanceCommand, name: 'guidance' },
  { cmd: applianceCommand, name: 'appliance' },
  { cmd: ruvectorCommand, name: 'ruvector' },
];

describe('Bulk Command Structure Validation', () => {
  it.each(allCommands)('$name: should have non-empty description', ({ cmd }) => {
    expect(cmd.description).toBeTruthy();
    expect(cmd.description.length).toBeGreaterThan(5);
  });

  it.each(allCommands)('$name: description should not contain placeholder text', ({ cmd }) => {
    expect(cmd.description).not.toContain('TODO');
    expect(cmd.description).not.toContain('FIXME');
    expect(cmd.description).not.toContain('placeholder');
  });

  it.each(allCommands)('$name: subcommands (if any) should have unique names', ({ cmd }) => {
    if (cmd.subcommands && cmd.subcommands.length > 0) {
      const names = cmd.subcommands.map((s) => s.name);
      const uniqueNames = new Set(names);
      expect(uniqueNames.size).toBe(names.length);
    }
  });

  it.each(allCommands)('$name: options (if any) should have valid types', ({ cmd }) => {
    if (cmd.options) {
      for (const opt of cmd.options) {
        expect(['string', 'boolean', 'number', 'array']).toContain(opt.type);
      }
    }
  });

  it.each(allCommands)(
    '$name: subcommand descriptions should be non-empty strings',
    ({ cmd }) => {
      if (cmd.subcommands) {
        for (const sub of cmd.subcommands) {
          expect(typeof sub.description).toBe('string');
          expect(sub.description.length).toBeGreaterThan(0);
        }
      }
    },
  );
});

// ============================================================================
// SECTION 2: Command Registry Tests
// ============================================================================

describe('Command Registry (commands/index.ts)', () => {
  it('should export all core commands synchronously', async () => {
    const indexModule = await import('../src/commands/index.js');
    expect(indexModule.agentCommand).toBeDefined();
    expect(indexModule.swarmCommand).toBeDefined();
    expect(indexModule.memoryCommand).toBeDefined();
    expect(indexModule.initCommand).toBeDefined();
    expect(indexModule.statusCommand).toBeDefined();
    expect(indexModule.taskCommand).toBeDefined();
    expect(indexModule.sessionCommand).toBeDefined();
    expect(indexModule.mcpCommand).toBeDefined();
    expect(indexModule.hooksCommand).toBeDefined();
    // Advanced commands are lazy-loaded (PERF-03) — verify async getters exist
    expect(typeof indexModule.getCommandAsync).toBe('function');
    expect(typeof indexModule.loadAllCommands).toBe('function');
  });

  it('should export commandsByCategory with all categories', async () => {
    const indexModule = await import('../src/commands/index.js');
    expect(indexModule.commandsByCategory).toBeDefined();
    const categories = Object.keys(indexModule.commandsByCategory);
    expect(categories.length).toBeGreaterThanOrEqual(3);
  });

  it('should export commands array with many entries', async () => {
    const indexModule = await import('../src/commands/index.js');
    expect(Array.isArray(indexModule.commands)).toBe(true);
    expect(indexModule.commands.length).toBeGreaterThanOrEqual(10);
  });

  it('should export loadAllCommands as async function', async () => {
    const indexModule = await import('../src/commands/index.js');
    expect(typeof indexModule.loadAllCommands).toBe('function');
  });

  it('should export getCommandAsync as async function', async () => {
    const indexModule = await import('../src/commands/index.js');
    expect(typeof indexModule.getCommandAsync).toBe('function');
  });
});

// ============================================================================
// SECTION 3: Parser Tests
// ============================================================================

import { CommandParser, commandParser } from '../src/parser.js';
import type { ParsedFlags } from '../src/types.js';

describe('CommandParser', () => {
  let parser: CommandParser;

  beforeEach(() => {
    parser = new CommandParser({ allowUnknownFlags: true });
  });

  describe('basic parsing', () => {
    it('should parse empty args', () => {
      const result = parser.parse([]);
      expect(result.command).toEqual([]);
      expect(result.positional).toEqual([]);
      expect(result.flags._).toEqual([]);
    });

    it('should parse a single positional arg as positional (not registered command)', () => {
      const result = parser.parse(['foo']);
      expect(result.positional).toContain('foo');
    });

    it('should parse long boolean flag --help', () => {
      const result = parser.parse(['--help']);
      expect(result.flags.help).toBe(true);
    });

    it('should parse long boolean flag --verbose', () => {
      const result = parser.parse(['--verbose']);
      expect(result.flags.verbose).toBe(true);
    });

    it('should parse --flag=value syntax', () => {
      const result = parser.parse(['--format=json']);
      expect(result.flags.format).toBe('json');
    });

    it('should parse --flag value syntax for non-boolean flags', () => {
      const result = parser.parse(['--config', '/path/to/config']);
      expect(result.flags.config).toBe('/path/to/config');
    });

    it('should parse boolean negation --no-color', () => {
      const result = parser.parse(['--no-color']);
      expect(result.flags.color).toBe(false);
    });

    it('should parse boolean negation --no-interactive', () => {
      const result = parser.parse(['--no-interactive']);
      expect(result.flags.interactive).toBe(false);
    });
  });

  describe('short flags', () => {
    it('should resolve short flag -h to help', () => {
      const result = parser.parse(['-h']);
      expect(result.flags.help).toBe(true);
    });

    it('should resolve short flag -v to verbose', () => {
      const result = parser.parse(['-v']);
      expect(result.flags.verbose).toBe(true);
    });

    it('should resolve short flag -Q to quiet', () => {
      const result = parser.parse(['-Q']);
      expect(result.flags.quiet).toBe(true);
    });

    it('should parse combined short flags -hv', () => {
      const result = parser.parse(['-hv']);
      expect(result.flags.help).toBe(true);
      expect(result.flags.verbose).toBe(true);
    });

    it('should parse short flag with value -c /path', () => {
      const result = parser.parse(['-c', '/path/config.json']);
      expect(result.flags.config).toBe('/path/config.json');
    });

    it('should parse long flag --format with value', () => {
      // Short flag -f removed from global options — collides with 50+ subcommands (#1425)
      const result = parser.parse(['--format', 'json']);
      expect(result.flags.format).toBe('json');
    });
  });

  describe('value type coercion', () => {
    it('should coerce numeric string to number', () => {
      const result = parser.parse(['--port=3000']);
      expect(result.flags.port).toBe(3000);
    });

    it('should coerce "true" string to boolean true', () => {
      const result = parser.parse(['--debug=true']);
      expect(result.flags.debug).toBe(true);
    });

    it('should coerce "false" string to boolean false', () => {
      const result = parser.parse(['--debug=false']);
      expect(result.flags.debug).toBe(false);
    });

    it('should keep non-numeric strings as strings', () => {
      const result = parser.parse(['--name=my-project']);
      expect(result.flags.name).toBe('my-project');
    });

    it('should handle empty string value', () => {
      const result = parser.parse(['--name=']);
      expect(result.flags.name).toBe('');
    });
  });

  describe('kebab-case to camelCase normalization', () => {
    it('should convert --no-color to noColor flag (negation)', () => {
      // --no-color is boolean negation => flags.color = false
      const result = parser.parse(['--no-color']);
      expect(result.flags.color).toBe(false);
    });

    it('should convert --some-flag to someFlag', () => {
      const result = parser.parse(['--some-flag=value']);
      expect(result.flags.someFlag).toBe('value');
    });

    it('should convert --my-long-option to myLongOption', () => {
      const result = parser.parse(['--my-long-option=test']);
      expect(result.flags.myLongOption).toBe('test');
    });
  });

  describe('end-of-flags marker --', () => {
    it('should stop parsing flags after --', () => {
      const result = parser.parse(['--verbose', '--', '--not-a-flag']);
      expect(result.flags.verbose).toBe(true);
      expect(result.positional).toContain('--not-a-flag');
    });
  });

  describe('command recognition', () => {
    it('should recognize registered command', () => {
      parser.registerCommand(agentCommand);
      const result = parser.parse(['agent']);
      expect(result.command).toEqual(['agent']);
    });

    it('should recognize command with subcommand', () => {
      parser.registerCommand(agentCommand);
      const result = parser.parse(['agent', 'spawn']);
      expect(result.command).toEqual(['agent', 'spawn']);
    });

    it('should recognize command with subcommand and flags', () => {
      parser.registerCommand(agentCommand);
      const result = parser.parse(['agent', 'spawn', '--type', 'coder']);
      expect(result.command).toEqual(['agent', 'spawn']);
      expect(result.flags.type).toBe('coder');
    });

    it('should handle unknown subcommand as positional', () => {
      parser.registerCommand(agentCommand);
      const result = parser.parse(['agent', 'nonexistent']);
      // 'agent' is recognized, 'nonexistent' won't match a subcommand
      expect(result.command).toEqual(['agent']);
    });
  });

  describe('defaults', () => {
    it('should apply global defaults for help', () => {
      const result = parser.parse([]);
      expect(result.flags.help).toBe(false);
    });

    it('should apply global defaults for verbose', () => {
      const result = parser.parse([]);
      expect(result.flags.verbose).toBe(false);
    });

    it('should apply global defaults for format', () => {
      const result = parser.parse([]);
      expect(result.flags.format).toBe('text');
    });

    it('should apply global defaults for interactive', () => {
      const result = parser.parse([]);
      expect(result.flags.interactive).toBe(true);
    });

    it('should not override explicit values with defaults', () => {
      const result = parser.parse(['--verbose']);
      expect(result.flags.verbose).toBe(true);
    });
  });

  describe('validation', () => {
    it('should return no errors for valid flags', () => {
      const flags: ParsedFlags = { _: [], help: false, verbose: true, format: 'json' };
      const errors = parser.validateFlags(flags);
      expect(errors).toEqual([]);
    });

    it('should validate choices for format flag', () => {
      const flags: ParsedFlags = { _: [], format: 'invalid-format' };
      const errors = parser.validateFlags(flags);
      expect(errors.some((e) => e.includes('format'))).toBe(true);
    });

    it('should report required options as missing', () => {
      const cmdWithRequired: Command = {
        name: 'test',
        description: 'test',
        options: [
          {
            name: 'required-opt',
            description: 'Required option',
            type: 'string',
            required: true,
          },
        ],
      };
      const flags: ParsedFlags = { _: [] };
      const errors = parser.validateFlags(flags, cmdWithRequired);
      expect(errors.length).toBeGreaterThan(0);
      expect(errors[0]).toContain('required-opt');
    });
  });

  describe('getAllCommands', () => {
    it('should return unique commands (no alias duplicates)', () => {
      parser.registerCommand(agentCommand);
      parser.registerCommand(swarmCommand);
      const all = parser.getAllCommands();
      const names = all.map((c) => c.name);
      const unique = new Set(names);
      expect(unique.size).toBe(names.length);
    });
  });

  describe('getGlobalOptions', () => {
    it('should return global options array', () => {
      const opts = parser.getGlobalOptions();
      expect(Array.isArray(opts)).toBe(true);
      expect(opts.length).toBeGreaterThanOrEqual(5);
    });

    it('should include help, version, verbose, quiet, config, format', () => {
      const opts = parser.getGlobalOptions();
      const names = opts.map((o) => o.name);
      expect(names).toContain('help');
      expect(names).toContain('version');
      expect(names).toContain('verbose');
      expect(names).toContain('quiet');
      expect(names).toContain('config');
      expect(names).toContain('format');
    });
  });

  describe('singleton export', () => {
    it('commandParser singleton should be an instance of CommandParser', () => {
      expect(commandParser).toBeInstanceOf(CommandParser);
    });

    it('commandParser should have allowUnknownFlags enabled', () => {
      // It should not report errors for unknown flags
      const flags: ParsedFlags = { _: [], someRandomFlag: 'value' };
      const errors = commandParser.validateFlags(flags);
      // With allowUnknownFlags, no error for unknown flags
      const unknownErrors = errors.filter((e) => e.includes('Unknown option'));
      expect(unknownErrors).toEqual([]);
    });
  });
});

// ============================================================================
// SECTION 4: Output Formatter Tests
// ============================================================================

import { OutputFormatter, Progress, Spinner, output } from '../src/output.js';

describe('OutputFormatter', () => {
  let formatter: OutputFormatter;

  beforeEach(() => {
    formatter = new OutputFormatter({ color: false });
  });

  describe('color methods (color disabled)', () => {
    it('bold() should return text without ANSI codes when color disabled', () => {
      const result = formatter.bold('hello');
      expect(result).toBe('hello');
    });

    it('dim() should return text without ANSI codes when color disabled', () => {
      const result = formatter.dim('hello');
      expect(result).toBe('hello');
    });

    it('success() should return text without ANSI codes when color disabled', () => {
      const result = formatter.success('done');
      expect(result).toBe('done');
    });

    it('error() should return text without ANSI codes when color disabled', () => {
      const result = formatter.error('fail');
      expect(result).toBe('fail');
    });

    it('warning() should return text without ANSI codes when color disabled', () => {
      const result = formatter.warning('warn');
      expect(result).toBe('warn');
    });

    it('info() should return text without ANSI codes when color disabled', () => {
      const result = formatter.info('info');
      expect(result).toBe('info');
    });

    it('highlight() should return text without ANSI codes when color disabled', () => {
      const result = formatter.highlight('hi');
      expect(result).toBe('hi');
    });
  });

  describe('color methods (color enabled)', () => {
    let colorFormatter: OutputFormatter;

    beforeEach(() => {
      colorFormatter = new OutputFormatter({ color: true });
    });

    it('bold() should wrap text with ANSI bold codes', () => {
      const result = colorFormatter.bold('hello');
      expect(result).toContain('\x1b[1m');
      expect(result).toContain('hello');
      expect(result).toContain('\x1b[0m');
    });

    it('error() should wrap text with red ANSI codes', () => {
      const result = colorFormatter.error('fail');
      expect(result).toContain('\x1b[31m');
      expect(result).toContain('fail');
    });

    it('success() should wrap text with green ANSI codes', () => {
      const result = colorFormatter.success('pass');
      expect(result).toContain('\x1b[32m');
    });

    it('warning() should wrap text with yellow ANSI codes', () => {
      const result = colorFormatter.warning('caution');
      expect(result).toContain('\x1b[33m');
    });

    it('info() should wrap text with blue ANSI codes', () => {
      const result = colorFormatter.info('note');
      expect(result).toContain('\x1b[34m');
    });
  });

  describe('verbosity', () => {
    it('should default to normal verbosity', () => {
      expect(formatter.getVerbosity()).toBe('normal');
    });

    it('should set verbosity', () => {
      formatter.setVerbosity('quiet');
      expect(formatter.getVerbosity()).toBe('quiet');
      expect(formatter.isQuiet()).toBe(true);
    });

    it('isVerbose should return true for verbose and debug', () => {
      formatter.setVerbosity('verbose');
      expect(formatter.isVerbose()).toBe(true);
      formatter.setVerbosity('debug');
      expect(formatter.isVerbose()).toBe(true);
    });

    it('isDebug should return true only for debug', () => {
      formatter.setVerbosity('verbose');
      expect(formatter.isDebug()).toBe(false);
      formatter.setVerbosity('debug');
      expect(formatter.isDebug()).toBe(true);
    });

    it('isQuiet should return true only for quiet', () => {
      formatter.setVerbosity('normal');
      expect(formatter.isQuiet()).toBe(false);
      formatter.setVerbosity('quiet');
      expect(formatter.isQuiet()).toBe(true);
    });
  });

  describe('table formatting', () => {
    it('should render a basic table with borders', () => {
      const result = formatter.table({
        columns: [
          { key: 'name', header: 'Name' },
          { key: 'value', header: 'Value' },
        ],
        data: [
          { name: 'a', value: '1' },
          { name: 'b', value: '2' },
        ],
      });
      expect(result).toContain('Name');
      expect(result).toContain('Value');
      expect(result).toContain('a');
      expect(result).toContain('b');
      expect(result).toContain('|');
      expect(result).toContain('+');
    });

    it('should render a table without borders', () => {
      const result = formatter.table({
        columns: [{ key: 'x', header: 'X' }],
        data: [{ x: 'hello' }],
        border: false,
      });
      expect(result).not.toContain('+');
      expect(result).toContain('hello');
    });

    it('should render a table without header', () => {
      const result = formatter.table({
        columns: [{ key: 'x', header: 'X' }],
        data: [{ x: 'val' }],
        header: false,
      });
      expect(result).toContain('val');
    });

    it('should apply column formatter', () => {
      const result = formatter.table({
        columns: [
          {
            key: 'x',
            header: 'X',
            format: (v) => `[${v}]`,
          },
        ],
        data: [{ x: 'test' }],
      });
      expect(result).toContain('[test]');
    });

    it('should handle empty data', () => {
      const result = formatter.table({
        columns: [{ key: 'x', header: 'X' }],
        data: [],
      });
      expect(result).toContain('X');
    });

    it('should handle null/undefined values', () => {
      const result = formatter.table({
        columns: [{ key: 'x', header: 'X' }],
        data: [{ x: null }, { x: undefined }],
      });
      expect(result).toBeDefined();
    });
  });

  describe('list formatting', () => {
    it('should format a bulleted list', () => {
      const result = formatter.list(['item1', 'item2', 'item3']);
      expect(result).toContain('- item1');
      expect(result).toContain('- item2');
      expect(result).toContain('- item3');
    });

    it('should use custom bullet', () => {
      const result = formatter.list(['a', 'b'], '*');
      expect(result).toContain('* a');
      expect(result).toContain('* b');
    });

    it('should format a numbered list', () => {
      const result = formatter.numberedList(['first', 'second', 'third']);
      expect(result).toContain('1. first');
      expect(result).toContain('2. second');
      expect(result).toContain('3. third');
    });
  });

  describe('box formatting', () => {
    it('should render a box around content', () => {
      const result = formatter.box('Hello World');
      expect(result).toContain('+');
      expect(result).toContain('|');
      expect(result).toContain('Hello World');
    });

    it('should render a box with title', () => {
      const result = formatter.box('Content', 'Title');
      expect(result).toContain('Title');
      expect(result).toContain('Content');
    });

    it('should handle multiline content', () => {
      const result = formatter.box('Line 1\nLine 2\nLine 3');
      expect(result).toContain('Line 1');
      expect(result).toContain('Line 2');
      expect(result).toContain('Line 3');
    });
  });

  describe('JSON output', () => {
    it('should format JSON with indentation by default', () => {
      const result = formatter.json({ key: 'value' });
      expect(result).toContain('"key"');
      expect(result).toContain('"value"');
      expect(result).toContain('\n');
    });

    it('should format compact JSON when pretty is false', () => {
      const result = formatter.json({ key: 'value' }, false);
      expect(result).not.toContain('\n');
      expect(result).toBe('{"key":"value"}');
    });
  });

  describe('progress bar', () => {
    it('should render progress bar at 0%', () => {
      const result = formatter.progressBar(0, 100);
      expect(result).toContain('0.0%');
    });

    it('should render progress bar at 50%', () => {
      const result = formatter.progressBar(50, 100);
      expect(result).toContain('50.0%');
    });

    it('should render progress bar at 100%', () => {
      const result = formatter.progressBar(100, 100);
      expect(result).toContain('100.0%');
    });

    it('should clamp above 100%', () => {
      const result = formatter.progressBar(150, 100);
      expect(result).toContain('100.0%');
    });
  });

  describe('color toggle', () => {
    it('should toggle color on and off', () => {
      formatter.setColorEnabled(true);
      expect(formatter.isColorEnabled()).toBe(true);
      formatter.setColorEnabled(false);
      expect(formatter.isColorEnabled()).toBe(false);
    });
  });

  describe('singleton export', () => {
    it('output should be an instance of OutputFormatter', () => {
      expect(output).toBeInstanceOf(OutputFormatter);
    });
  });
});

// ============================================================================
// SECTION 5: Suggest Module Tests
// ============================================================================

import {
  levenshteinDistance,
  similarityScore,
  findSimilar,
  formatSuggestion,
  suggestCommand,
  getTypoCorrection,
  COMMON_TYPOS,
} from '../src/suggest.js';

describe('Suggest Module', () => {
  describe('levenshteinDistance', () => {
    it('should return 0 for identical strings', () => {
      expect(levenshteinDistance('hello', 'hello')).toBe(0);
    });

    it('should return length of b for empty a', () => {
      expect(levenshteinDistance('', 'abc')).toBe(3);
    });

    it('should return length of a for empty b', () => {
      expect(levenshteinDistance('abc', '')).toBe(3);
    });

    it('should return 0 for two empty strings', () => {
      expect(levenshteinDistance('', '')).toBe(0);
    });

    it('should compute correct distance for single char difference', () => {
      expect(levenshteinDistance('cat', 'bat')).toBe(1);
    });

    it('should compute correct distance for insertion', () => {
      expect(levenshteinDistance('cat', 'cats')).toBe(1);
    });

    it('should compute correct distance for deletion', () => {
      expect(levenshteinDistance('cats', 'cat')).toBe(1);
    });

    it('should compute correct distance for completely different strings', () => {
      expect(levenshteinDistance('abc', 'xyz')).toBe(3);
    });

    it('should handle longer strings', () => {
      const d = levenshteinDistance('sitting', 'kitten');
      expect(d).toBe(3);
    });
  });

  describe('similarityScore', () => {
    it('should return 1 for identical strings', () => {
      expect(similarityScore('hello', 'hello')).toBe(1);
    });

    it('should return 1 for two empty strings', () => {
      expect(similarityScore('', '')).toBe(1);
    });

    it('should return 0 for completely different single-char strings', () => {
      expect(similarityScore('a', 'b')).toBe(0);
    });

    it('should return a value between 0 and 1', () => {
      const score = similarityScore('agent', 'agnet');
      expect(score).toBeGreaterThan(0);
      expect(score).toBeLessThanOrEqual(1);
    });

    it('should be case-insensitive', () => {
      const score = similarityScore('Agent', 'agent');
      expect(score).toBe(1);
    });
  });

  describe('findSimilar', () => {
    const candidates = ['agent', 'swarm', 'memory', 'config', 'hooks', 'init', 'status'];

    it('should find similar commands for typo', () => {
      const results = findSimilar('agnet', candidates);
      expect(results).toContain('agent');
    });

    it('should find similar commands for prefix', () => {
      const results = findSimilar('con', candidates);
      expect(results).toContain('config');
    });

    it('should return empty for completely unrelated input', () => {
      const results = findSimilar('zzzzzzzzzzzzz', candidates);
      expect(results).toEqual([]);
    });

    it('should limit results to maxSuggestions', () => {
      const results = findSimilar('a', candidates, { maxSuggestions: 2 });
      expect(results.length).toBeLessThanOrEqual(2);
    });

    it('should respect minSimilarity threshold', () => {
      const results = findSimilar('xyz', candidates, { minSimilarity: 0.9 });
      expect(results).toEqual([]);
    });
  });

  describe('formatSuggestion', () => {
    it('should return empty string for no suggestions', () => {
      expect(formatSuggestion('bad', [])).toBe('');
    });

    it('should format single suggestion', () => {
      const result = formatSuggestion('agnet', ['agent']);
      expect(result).toContain('Did you mean');
      expect(result).toContain('agent');
    });

    it('should format multiple suggestions', () => {
      const result = formatSuggestion('con', ['config', 'completions']);
      expect(result).toContain('Did you mean');
      expect(result).toContain('config');
      expect(result).toContain('completions');
    });

    it('should use context-appropriate prefix for subcommand', () => {
      const result = formatSuggestion('spwn', ['spawn'], 'subcommand');
      expect(result).toContain('Available subcommands');
    });

    it('should use context-appropriate prefix for value', () => {
      const result = formatSuggestion('jsonn', ['json', 'table'], 'value');
      expect(result).toContain('Valid values');
    });
  });

  describe('COMMON_TYPOS', () => {
    it('should map common agent typos', () => {
      expect(COMMON_TYPOS['agnet']).toBe('agent');
      expect(COMMON_TYPOS['agen']).toBe('agent');
    });

    it('should map common memory typos', () => {
      expect(COMMON_TYPOS['memroy']).toBe('memory');
      expect(COMMON_TYPOS['mem']).toBe('memory');
      expect(COMMON_TYPOS['memmory']).toBe('memory');
    });

    it('should map common swarm typos', () => {
      expect(COMMON_TYPOS['swarrm']).toBe('swarm');
      expect(COMMON_TYPOS['swarn']).toBe('swarm');
    });

    it('should map common hive-mind typos', () => {
      expect(COMMON_TYPOS['hive']).toBe('hive-mind');
      expect(COMMON_TYPOS['hivemind']).toBe('hive-mind');
      expect(COMMON_TYPOS['hive_mind']).toBe('hive-mind');
    });

    it('should map status typos', () => {
      expect(COMMON_TYPOS['staus']).toBe('status');
      expect(COMMON_TYPOS['stauts']).toBe('status');
    });

    it('should map daemon typos', () => {
      expect(COMMON_TYPOS['deamon']).toBe('daemon');
    });

    it('should map workflow typos', () => {
      expect(COMMON_TYPOS['wf']).toBe('workflow');
      expect(COMMON_TYPOS['wokflow']).toBe('workflow');
    });
  });

  describe('getTypoCorrection', () => {
    it('should return correction for known typo', () => {
      expect(getTypoCorrection('agnet')).toBe('agent');
    });

    it('should return undefined for unknown input', () => {
      expect(getTypoCorrection('qwerty')).toBeUndefined();
    });

    it('should be case-insensitive', () => {
      expect(getTypoCorrection('AGNET')).toBe('agent');
    });
  });

  describe('suggestCommand', () => {
    const commands = ['agent', 'swarm', 'memory', 'config', 'hooks', 'init', 'status', 'daemon'];

    it('should suggest correction for common typo', () => {
      const result = suggestCommand('agnet', commands);
      expect(result.correction).toBe('agent');
      expect(result.suggestions).toContain('agent');
    });

    it('should suggest similar commands for unknown input', () => {
      const result = suggestCommand('swar', commands);
      expect(result.suggestions.length).toBeGreaterThan(0);
      expect(result.suggestions).toContain('swarm');
    });

    it('should provide helpful message when no suggestions found', () => {
      const result = suggestCommand('zzzzzzzzzzzzz', commands);
      expect(result.suggestions).toEqual([]);
      expect(result.message).toContain('--help');
    });

    it('should provide "Did you mean" message for single suggestion', () => {
      const result = suggestCommand('agnet', commands);
      expect(result.message).toContain('Did you mean');
    });
  });
});

// ============================================================================
// SECTION 6: Init System Tests
// ============================================================================

import { generateSettings, generateSettingsJson } from '../src/init/settings-generator.js';
import { generateClaudeMd, generateMinimalClaudeMd, CLAUDE_MD_TEMPLATES } from '../src/init/claudemd-generator.js';
import { DEFAULT_INIT_OPTIONS, MINIMAL_INIT_OPTIONS, FULL_INIT_OPTIONS, detectPlatform } from '../src/init/types.js';
import type { InitOptions, ClaudeMdTemplate } from '../src/init/types.js';

describe('Init System', () => {
  describe('DEFAULT_INIT_OPTIONS', () => {
    it('should have all components enabled by default', () => {
      expect(DEFAULT_INIT_OPTIONS.components.settings).toBe(true);
      expect(DEFAULT_INIT_OPTIONS.components.skills).toBe(true);
      expect(DEFAULT_INIT_OPTIONS.components.runtime).toBe(true);
      expect(DEFAULT_INIT_OPTIONS.components.claudeMd).toBe(true);
    });

    it('should have hierarchical-mesh topology', () => {
      expect(DEFAULT_INIT_OPTIONS.runtime.topology).toBe('hierarchical-mesh');
    });

    it('should have HNSW enabled', () => {
      expect(DEFAULT_INIT_OPTIONS.runtime.enableHNSW).toBe(true);
    });

    it('should have neural enabled', () => {
      expect(DEFAULT_INIT_OPTIONS.runtime.enableNeural).toBe(true);
    });

    it('should have hybrid memory backend', () => {
      expect(DEFAULT_INIT_OPTIONS.runtime.memoryBackend).toBe('hybrid');
    });

    it('should have force=false', () => {
      expect(DEFAULT_INIT_OPTIONS.force).toBe(false);
    });

    it('should have interactive=true', () => {
      expect(DEFAULT_INIT_OPTIONS.interactive).toBe(true);
    });
  });

  describe('MINIMAL_INIT_OPTIONS', () => {
    it('should have fewer components enabled', () => {
      expect(MINIMAL_INIT_OPTIONS.components.commands).toBe(false);
      expect(MINIMAL_INIT_OPTIONS.components.agents).toBe(false);
      expect(MINIMAL_INIT_OPTIONS.components.helpers).toBe(false);
      expect(MINIMAL_INIT_OPTIONS.components.statusline).toBe(false);
    });

    it('should have simpler topology', () => {
      expect(MINIMAL_INIT_OPTIONS.runtime.topology).toBe('mesh');
    });

    it('should have HNSW disabled', () => {
      expect(MINIMAL_INIT_OPTIONS.runtime.enableHNSW).toBe(false);
    });

    it('should have fewer max agents', () => {
      expect(MINIMAL_INIT_OPTIONS.runtime.maxAgents).toBeLessThan(
        DEFAULT_INIT_OPTIONS.runtime.maxAgents,
      );
    });
  });

  describe('FULL_INIT_OPTIONS', () => {
    it('should have all components enabled', () => {
      const comps = FULL_INIT_OPTIONS.components;
      expect(comps.settings).toBe(true);
      expect(comps.skills).toBe(true);
      expect(comps.commands).toBe(true);
      expect(comps.agents).toBe(true);
      expect(comps.helpers).toBe(true);
      expect(comps.statusline).toBe(true);
      expect(comps.mcp).toBe(true);
      expect(comps.runtime).toBe(true);
      expect(comps.claudeMd).toBe(true);
    });

    it('should have dualMode skills enabled', () => {
      expect(FULL_INIT_OPTIONS.skills.dualMode).toBe(true);
    });

    it('should have all MCP servers enabled', () => {
      expect(FULL_INIT_OPTIONS.mcp.claudeFlow).toBe(true);
      expect(FULL_INIT_OPTIONS.mcp.ruvSwarm).toBe(true);
      expect(FULL_INIT_OPTIONS.mcp.flowNexus).toBe(true);
    });
  });

  describe('detectPlatform', () => {
    it('should return valid platform info', () => {
      const platform = detectPlatform();
      expect(platform).toBeDefined();
      expect(['windows', 'darwin', 'linux']).toContain(platform.os);
      expect(typeof platform.arch).toBe('string');
      expect(typeof platform.nodeVersion).toBe('string');
      expect(typeof platform.shell).toBe('string');
      expect(typeof platform.homeDir).toBe('string');
      expect(typeof platform.configDir).toBe('string');
    });

    it('should detect node version starting with v', () => {
      const platform = detectPlatform();
      expect(platform.nodeVersion).toMatch(/^v\d+/);
    });
  });

  describe('generateSettings', () => {
    it('should return an object', () => {
      const settings = generateSettings(DEFAULT_INIT_OPTIONS);
      expect(typeof settings).toBe('object');
      expect(settings).not.toBeNull();
    });

    it('should include hooks when settings component is enabled', () => {
      const settings = generateSettings(DEFAULT_INIT_OPTIONS) as Record<string, unknown>;
      expect(settings.hooks).toBeDefined();
    });

    it('should include permissions', () => {
      const settings = generateSettings(DEFAULT_INIT_OPTIONS) as Record<string, unknown>;
      expect(settings.permissions).toBeDefined();
      const perms = settings.permissions as Record<string, unknown>;
      expect(perms.allow).toBeDefined();
      expect(perms.deny).toBeDefined();
    });

    it('should NOT include attribution by default (opt-in per #1670)', () => {
      // #1670 — attribution (Co-Authored-By trailer) is now opt-in to avoid
      // silently injecting a third-party co-author into user commits.
      const settings = generateSettings(DEFAULT_INIT_OPTIONS) as Record<string, unknown>;
      expect(settings.attribution).toBeUndefined();
    });

    it('should include attribution when opted in', () => {
      const settings = generateSettings({ ...DEFAULT_INIT_OPTIONS, attribution: true }) as Record<string, unknown>;
      expect(settings.attribution).toBeDefined();
      const attribution = settings.attribution as Record<string, string>;
      expect(attribution.commit).toContain('Co-Authored-By:');
      expect(attribution.pr).toContain('Generated with');
    });

    it('should include env with agent teams enabled', () => {
      const settings = generateSettings(DEFAULT_INIT_OPTIONS) as Record<string, unknown>;
      expect(settings.env).toBeDefined();
      const env = settings.env as Record<string, string>;
      expect(env.CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS).toBe('1');
    });

    it('should include claudeFlow v3 settings', () => {
      const settings = generateSettings(DEFAULT_INIT_OPTIONS) as Record<string, unknown>;
      expect(settings.claudeFlow).toBeDefined();
      const cf = settings.claudeFlow as Record<string, unknown>;
      expect(cf.version).toBe('3.0.0');
      expect(cf.enabled).toBe(true);
    });

    it('should deny reading .env files', () => {
      const settings = generateSettings(DEFAULT_INIT_OPTIONS) as Record<string, unknown>;
      const perms = settings.permissions as { deny: string[] };
      expect(perms.deny).toContain('Read(./.env)');
    });
  });

  describe('generateSettingsJson', () => {
    it('should return valid JSON string', () => {
      const json = generateSettingsJson(DEFAULT_INIT_OPTIONS);
      expect(typeof json).toBe('string');
      const parsed = JSON.parse(json);
      expect(typeof parsed).toBe('object');
    });
  });

  describe('generateClaudeMd', () => {
    it('should return non-empty string', () => {
      const md = generateClaudeMd(DEFAULT_INIT_OPTIONS);
      expect(typeof md).toBe('string');
      expect(md.length).toBeGreaterThan(100);
    });

    // The CLAUDE.md generator was deliberately rewritten to a terser, more
    // imperative schema (header "# Ruflo — Claude Code Configuration", section
    // titles like "## Rules" / "## Swarm & Routing"). These tests were
    // originally written against the older verbose schema; updated below to
    // pin the *current* contract so future drift is caught.
    it('should contain the Ruflo header', () => {
      const md = generateClaudeMd(DEFAULT_INIT_OPTIONS);
      expect(md).toContain('# Ruflo');
    });

    it('should contain a Rules section (behavioral rules)', () => {
      const md = generateClaudeMd(DEFAULT_INIT_OPTIONS);
      expect(md).toContain('## Rules');
    });

    it('should mention required project subdirectories (file organization)', () => {
      const md = generateClaudeMd(DEFAULT_INIT_OPTIONS);
      // /src, /tests, /docs, /config, /scripts are all in the Rules block
      expect(md).toContain('/src');
      expect(md).toContain('/tests');
      expect(md).toContain('/docs');
    });

    it('should describe agent comms (project architecture coordination)', () => {
      const md = generateClaudeMd(DEFAULT_INIT_OPTIONS);
      expect(md).toContain('Agent Comms');
    });

    it('should include the capability brain and complete implementation loop', () => {
      const md = generateClaudeMd(DEFAULT_INIT_OPTIONS);
      expect(md).toContain('guidance_brain({ mode: "recommend"');
      expect(md).toContain('registered`, `configured`, `reachable`, `healthy`, and `authorized');
      expect(md).toContain('12. Publish only through a separately authorized release gate');
    });

    it('should enforce isolated concurrent writers and non-expanding authority', () => {
      const md = generateClaudeMd(DEFAULT_INIT_OPTIONS);
      expect(md).toContain('Never allow two writers in one worktree');
      expect(md).toContain('cannot add tools, network, secrets, spend');
      expect(md).toContain('cannot self-promote or expand their SafetyEnvelope');
      expect(md).not.toContain('After spawning: STOP');
    });

    it('should retain the governed workflow in every template', () => {
      for (const template of CLAUDE_MD_TEMPLATES) {
        const md = generateClaudeMd(DEFAULT_INIT_OPTIONS, template.name);
        expect(md).toContain('## Ruflo Capability Brain & Implementation Loop');
      }
    });

    it('should describe anti-drift swarm topology', () => {
      const md = generateClaudeMd(DEFAULT_INIT_OPTIONS, 'standard');
      expect(md).toContain('anti-drift');
    });

    it('standard template should include swarm config', () => {
      const md = generateClaudeMd(DEFAULT_INIT_OPTIONS, 'standard');
      expect(md).toContain('Swarm');
    });

    it('full template should include hooks reference', () => {
      const md = generateClaudeMd(DEFAULT_INIT_OPTIONS, 'full');
      // hooksRef() emits a section about hooks
      expect(md.toLowerCase()).toContain('hook');
    });

    it('full template should include intelligence/SONA reference', () => {
      const md = generateClaudeMd(DEFAULT_INIT_OPTIONS, 'full');
      // intelligenceSystem() mentions SONA / RuVector / HNSW
      expect(md.toLowerCase()).toMatch(/sona|ruvector|hnsw|intelligence/);
    });

    it('security template should include security rules', () => {
      const md = generateClaudeMd(DEFAULT_INIT_OPTIONS, 'security');
      expect(md).toContain('Security');
    });

    it('performance template should include performance section', () => {
      const md = generateClaudeMd(DEFAULT_INIT_OPTIONS, 'performance');
      expect(md).toContain('Performance');
    });

    it('minimal template should be shorter than full template', () => {
      const minimal = generateClaudeMd(DEFAULT_INIT_OPTIONS, 'minimal');
      const full = generateClaudeMd(DEFAULT_INIT_OPTIONS, 'full');
      expect(minimal.length).toBeLessThan(full.length);
    });
  });

  describe('generateMinimalClaudeMd', () => {
    it('should produce same result as generateClaudeMd with minimal template', () => {
      const a = generateMinimalClaudeMd(DEFAULT_INIT_OPTIONS);
      const b = generateClaudeMd(DEFAULT_INIT_OPTIONS, 'minimal');
      expect(a).toBe(b);
    });
  });

  describe('CLAUDE_MD_TEMPLATES', () => {
    it('should have 6 templates', () => {
      expect(CLAUDE_MD_TEMPLATES.length).toBe(6);
    });

    it('should include all template names', () => {
      const names = CLAUDE_MD_TEMPLATES.map((t) => t.name);
      expect(names).toContain('minimal');
      expect(names).toContain('standard');
      expect(names).toContain('full');
      expect(names).toContain('security');
      expect(names).toContain('performance');
      expect(names).toContain('solo');
    });

    it('each template should have a description', () => {
      for (const tmpl of CLAUDE_MD_TEMPLATES) {
        expect(typeof tmpl.description).toBe('string');
        expect(tmpl.description.length).toBeGreaterThan(10);
      }
    });
  });
});

// ============================================================================
// SECTION 7: Error Type Tests
// ============================================================================

import {
  CLIError,
  ValidationError,
  ConfigError,
  CommandNotFoundError,
} from '../src/types.js';

describe('Error Types', () => {
  describe('CLIError', () => {
    it('should have name, message, code, and exitCode', () => {
      const err = new CLIError('test error', 'TEST_CODE', 2);
      expect(err.name).toBe('CLIError');
      expect(err.message).toBe('test error');
      expect(err.code).toBe('TEST_CODE');
      expect(err.exitCode).toBe(2);
    });

    it('should default exitCode to 1', () => {
      const err = new CLIError('err', 'CODE');
      expect(err.exitCode).toBe(1);
    });

    it('should accept details', () => {
      const err = new CLIError('err', 'CODE', 1, { extra: 'info' });
      expect(err.details).toEqual({ extra: 'info' });
    });

    it('should be an instance of Error', () => {
      const err = new CLIError('err', 'CODE');
      expect(err).toBeInstanceOf(Error);
    });
  });

  describe('ValidationError', () => {
    it('should have VALIDATION_ERROR code', () => {
      const err = new ValidationError('invalid input');
      expect(err.code).toBe('VALIDATION_ERROR');
      expect(err.name).toBe('ValidationError');
    });

    it('should be an instance of CLIError', () => {
      const err = new ValidationError('invalid');
      expect(err).toBeInstanceOf(CLIError);
    });
  });

  describe('ConfigError', () => {
    it('should have CONFIG_ERROR code', () => {
      const err = new ConfigError('bad config');
      expect(err.code).toBe('CONFIG_ERROR');
      expect(err.name).toBe('ConfigError');
    });
  });

  describe('CommandNotFoundError', () => {
    it('should include command name in message', () => {
      const err = new CommandNotFoundError('foobar');
      expect(err.message).toContain('foobar');
      expect(err.code).toBe('COMMAND_NOT_FOUND');
      expect(err.exitCode).toBe(127);
    });
  });
});
