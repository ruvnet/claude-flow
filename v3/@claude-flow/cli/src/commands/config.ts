/**
 * V3 CLI Config Command
 * Configuration management
 */

import type { Command, CommandContext, CommandResult } from '../types.js';
import { output } from '../output.js';
import { select, input } from '../prompt.js';
import { configManager, parseConfigValue } from '../services/config-file-manager.js';
import * as path from 'path';

// Init configuration
const initCommand: Command = {
  name: 'init',
  description: 'Initialize configuration',
  options: [
    {
      name: 'force',
      short: 'f',
      description: 'Overwrite existing configuration',
      type: 'boolean',
      default: false
    },
    {
      name: 'sparc',
      description: 'Initialize with SPARC methodology',
      type: 'boolean',
      default: false
    },
    {
      name: 'v3',
      description: 'Initialize V3 configuration',
      type: 'boolean',
      default: true
    }
  ],
  action: async (ctx: CommandContext): Promise<CommandResult> => {
    try {
      const configPath = configManager.create(ctx.cwd, undefined, ctx.flags.force as boolean);
      output.writeln();
      output.writeln(output.success(`Configuration created: ${configPath}`));
      output.writeln();
      const defaults = configManager.getDefaults();
      output.writeln(output.bold('Key defaults:'));
      output.writeln(`  swarm.topology     = ${(defaults.swarm as Record<string, unknown>).topology}`);
      output.writeln(`  swarm.maxAgents    = ${(defaults.swarm as Record<string, unknown>).maxAgents}`);
      output.writeln(`  memory.backend     = ${(defaults.memory as Record<string, unknown>).backend}`);
      output.writeln(`  mcp.transportType  = ${(defaults.mcp as Record<string, unknown>).transportType}`);
      return { success: true };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      output.printError(message);
      return { success: false, exitCode: 1 };
    }
  }
};

// Get configuration
const getCommand: Command = {
  name: 'get',
  description: 'Get configuration value',
  options: [
    {
      name: 'key',
      short: 'k',
      description: 'Configuration key (dot notation)',
      type: 'string'
    }
  ],
  examples: [
    { command: 'claude-flow config get swarm.topology', description: 'Get swarm topology' },
    { command: 'claude-flow config get -k memory.backend', description: 'Get memory backend' }
  ],
  action: async (ctx: CommandContext): Promise<CommandResult> => {
    const key = ctx.flags.key as string || ctx.args[0];

    if (!key) {
      // Show all config from actual config file (fall back to defaults)
      const config = configManager.getConfig(ctx.cwd);
      const flatEntries: Record<string, unknown> = {};
      const flatten = (obj: Record<string, unknown>, prefix = '') => {
        for (const [k, v] of Object.entries(obj)) {
          const fullKey = prefix ? `${prefix}.${k}` : k;
          if (v !== null && typeof v === 'object' && !Array.isArray(v)) {
            flatten(v as Record<string, unknown>, fullKey);
          } else {
            flatEntries[fullKey] = v;
          }
        }
      };
      flatten(config);

      if (ctx.flags.format === 'json') {
        output.printJson(flatEntries);
        return { success: true, data: flatEntries };
      }

      output.writeln();
      output.writeln(output.bold('Current Configuration'));
      output.writeln();

      output.printTable({
        columns: [
          { key: 'key', header: 'Key', width: 25 },
          { key: 'value', header: 'Value', width: 30 }
        ],
        data: Object.entries(flatEntries).map(([k, v]) => ({ key: k, value: String(v) }))
      });

      return { success: true, data: flatEntries };
    }

    const value = configManager.get(ctx.cwd, key);

    if (value === undefined) {
      output.printError(`Configuration key not found: ${key}`);
      return { success: false, exitCode: 1 };
    }

    if (ctx.flags.format === 'json') {
      output.printJson({ key, value });
    } else {
      output.writeln(`${key} = ${value}`);
    }

    return { success: true, data: { key, value } };
  }
};

// Set configuration
const setCommand: Command = {
  name: 'set',
  description: 'Set configuration value',
  options: [
    {
      name: 'key',
      short: 'k',
      description: 'Configuration key',
      type: 'string'
    },
    {
      name: 'value',
      short: 'v',
      description: 'Configuration value',
      type: 'string'
    }
  ],
  examples: [
    { command: 'claude-flow config set swarm.maxAgents 20', description: 'Set max agents' },
    { command: 'claude-flow config set -k memory.backend -v agentdb', description: 'Set memory backend' }
  ],
  action: async (ctx: CommandContext): Promise<CommandResult> => {
    const key = (ctx.flags.key ?? ctx.args[0]) as string | undefined;
    const value = ctx.flags.value ?? ctx.args[1];

    if (!key || value === undefined) {
      output.printError('Both key and value are required');
      return { success: false, exitCode: 1 };
    }

    try {
      const parsedValue = parseConfigValue(String(value));
      configManager.set(ctx.cwd, key, parsedValue);
      output.writeln(`Set ${key} = ${value}`);
      return { success: true };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      output.printError(message);
      return { success: false, exitCode: 1 };
    }
  }
};

// List providers
const providersCommand: Command = {
  name: 'providers',
  description: 'Manage AI providers',
  options: [
    {
      name: 'add',
      short: 'a',
      description: 'Add provider',
      type: 'string'
    },
    {
      name: 'remove',
      short: 'r',
      description: 'Remove provider',
      type: 'string'
    },
    {
      name: 'enable',
      description: 'Enable provider',
      type: 'string'
    },
    {
      name: 'disable',
      description: 'Disable provider',
      type: 'string'
    }
  ],
  action: async (ctx: CommandContext): Promise<CommandResult> => {
    const defaultProviders = [
      { name: 'anthropic', model: 'claude-3-5-sonnet-20241022', priority: 1, enabled: true, status: 'Active' },
      { name: 'openrouter', model: 'claude-3.5-sonnet', priority: 2, enabled: false, status: 'Disabled' },
      { name: 'ollama', model: 'llama3.2', priority: 3, enabled: false, status: 'Disabled' },
      { name: 'gemini', model: 'gemini-2.0-flash', priority: 4, enabled: false, status: 'Disabled' }
    ];

    // Handle mutation flags
    const addProvider = ctx.flags.add as string | undefined;
    const removeProvider = ctx.flags.remove as string | undefined;
    const enableProvider = ctx.flags.enable as string | undefined;
    const disableProvider = ctx.flags.disable as string | undefined;

    if (addProvider || removeProvider || enableProvider || disableProvider) {
      // Read current providers from config
      let currentProviders = (configManager.get(ctx.cwd, 'providers') as Array<Record<string, unknown>>) || [];
      if (!Array.isArray(currentProviders)) currentProviders = [];

      if (addProvider) {
        const exists = currentProviders.some((p) => p.name === addProvider);
        if (exists) {
          output.printError(`Provider '${addProvider}' already exists`);
          return { success: false, exitCode: 1 };
        }
        currentProviders.push({ name: addProvider, enabled: true, priority: currentProviders.length + 1 });
        output.writeln(output.success(`Added provider: ${addProvider}`));
      }
      if (removeProvider) {
        const before = currentProviders.length;
        currentProviders = currentProviders.filter((p) => p.name !== removeProvider);
        if (currentProviders.length === before) {
          output.printError(`Provider '${removeProvider}' not found`);
          return { success: false, exitCode: 1 };
        }
        output.writeln(output.success(`Removed provider: ${removeProvider}`));
      }
      if (enableProvider) {
        const p = currentProviders.find((p) => p.name === enableProvider);
        if (p) { p.enabled = true; output.writeln(output.success(`Enabled provider: ${enableProvider}`)); }
        else { output.printError(`Provider '${enableProvider}' not found`); return { success: false, exitCode: 1 }; }
      }
      if (disableProvider) {
        const p = currentProviders.find((p) => p.name === disableProvider);
        if (p) { p.enabled = false; output.writeln(output.success(`Disabled provider: ${disableProvider}`)); }
        else { output.printError(`Provider '${disableProvider}' not found`); return { success: false, exitCode: 1 }; }
      }

      try {
        configManager.set(ctx.cwd, 'providers', currentProviders);
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        output.printError(`Failed to save providers: ${message}`);
        return { success: false, exitCode: 1 };
      }
      return { success: true, data: currentProviders };
    }

    // Read providers from config, fall back to defaults
    const configuredProviders = configManager.get(ctx.cwd, 'providers') as Array<Record<string, unknown>> | undefined;
    const providers = (Array.isArray(configuredProviders) && configuredProviders.length > 0)
      ? configuredProviders.map((p, i) => ({
          name: String(p.name || ''),
          model: String(p.model || ''),
          priority: Number(p.priority || i + 1),
          enabled: p.enabled !== false,
          status: p.enabled !== false ? 'Active' : 'Disabled',
        }))
      : defaultProviders;

    if (ctx.flags.format === 'json') {
      output.printJson(providers);
      return { success: true, data: providers };
    }

    output.writeln();
    output.writeln(output.bold('AI Providers'));
    output.writeln();

    output.printTable({
      columns: [
        { key: 'name', header: 'Provider', width: 12 },
        { key: 'model', header: 'Model', width: 25 },
        { key: 'priority', header: 'Priority', width: 10, align: 'right' },
        { key: 'status', header: 'Status', width: 10, format: (v) => {
          if (v === 'Active') return output.success(String(v));
          return output.dim(String(v));
        }}
      ],
      data: providers
    });

    output.writeln();
    output.writeln(output.dim('Use --add, --remove, --enable, --disable to manage providers'));

    return { success: true, data: providers };
  }
};

// Reset configuration
const resetCommand: Command = {
  name: 'reset',
  description: 'Reset configuration to defaults',
  options: [
    {
      name: 'force',
      short: 'f',
      description: 'Skip confirmation',
      type: 'boolean',
      default: false
    },
    {
      name: 'section',
      description: 'Reset specific section only',
      type: 'string',
      choices: ['agents', 'swarm', 'memory', 'mcp', 'providers', 'all']
    }
  ],
  action: async (ctx: CommandContext): Promise<CommandResult> => {
    try {
      const configPath = configManager.reset(ctx.cwd, ctx.flags.section as string | undefined);
      output.writeln(`Configuration reset to defaults: ${configPath}`);
      return { success: true };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      output.printError(message);
      return { success: false, exitCode: 1 };
    }
  }
};

// Export configuration
const exportCommand: Command = {
  name: 'export',
  description: 'Export configuration',
  options: [
    {
      name: 'output',
      short: 'o',
      description: 'Output file path',
      type: 'string'
    },
    {
      name: 'format',
      short: 'f',
      description: 'Export format (json, yaml)',
      type: 'string',
      default: 'json',
      choices: ['json', 'yaml']
    }
  ],
  action: async (ctx: CommandContext): Promise<CommandResult> => {
    try {
      const exportPath = (ctx.flags.output as string) || ctx.args[0] || 'claude-flow.config.export.json';
      configManager.exportTo(ctx.cwd, exportPath);
      const resolved = path.resolve(ctx.cwd, exportPath);
      output.writeln(`Configuration exported to: ${resolved}`);
      return { success: true };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      output.printError(message);
      return { success: false, exitCode: 1 };
    }
  }
};

// Import configuration
const importCommand: Command = {
  name: 'import',
  description: 'Import configuration',
  options: [
    {
      name: 'file',
      short: 'f',
      description: 'Configuration file path',
      type: 'string',
      required: true
    },
    {
      name: 'merge',
      description: 'Merge with existing configuration',
      type: 'boolean',
      default: false
    }
  ],
  action: async (ctx: CommandContext): Promise<CommandResult> => {
    const file = ctx.flags.file as string || ctx.args[0];

    if (!file) {
      output.printError('File path is required');
      return { success: false, exitCode: 1 };
    }

    try {
      configManager.importFrom(ctx.cwd, file);
      output.writeln(`Configuration imported from: ${path.resolve(ctx.cwd, file)}`);
      return { success: true };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      output.printError(message);
      return { success: false, exitCode: 1 };
    }
  }
};

// Main config command
export const configCommand: Command = {
  name: 'config',
  description: 'Configuration management',
  subcommands: [initCommand, getCommand, setCommand, providersCommand, resetCommand, exportCommand, importCommand],
  options: [],
  examples: [
    { command: 'claude-flow config init --v3', description: 'Initialize V3 config' },
    { command: 'claude-flow config get swarm.topology', description: 'Get config value' },
    { command: 'claude-flow config set swarm.maxAgents 20', description: 'Set config value' }
  ],
  action: async (ctx: CommandContext): Promise<CommandResult> => {
    output.writeln();
    output.writeln(output.bold('Configuration Management'));
    output.writeln();
    output.writeln('Usage: claude-flow config <subcommand> [options]');
    output.writeln();
    output.writeln('Subcommands:');
    output.printList([
      `${output.highlight('init')}       - Initialize configuration`,
      `${output.highlight('get')}        - Get configuration value`,
      `${output.highlight('set')}        - Set configuration value`,
      `${output.highlight('providers')}  - Manage AI providers`,
      `${output.highlight('reset')}      - Reset to defaults`,
      `${output.highlight('export')}     - Export configuration`,
      `${output.highlight('import')}     - Import configuration`
    ]);

    return { success: true };
  }
};

export default configCommand;
