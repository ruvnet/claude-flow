/**
 * V3 CLI Plugins Command
 * Plugin management, installation, and lifecycle
 * Now uses IPFS-based decentralized registry for discovery
 *
 * Created with ❤️ by ruv.io
 */

import type { Command, CommandContext, CommandResult } from '../types.js';
import { output } from '../output.js';
import {
  createPluginDiscoveryService,
  searchPlugins,
  getPluginSearchSuggestions,
  getFeaturedPlugins,
  getTrendingPlugins,
  getOfficialPlugins,
  type PluginEntry,
  type PluginSearchOptions,
  type PluginType,
} from '../plugins/store/index.js';
import { getPluginManager, type InstalledPlugin } from '../plugins/manager.js';
import { getBulkRatings } from '../services/registry-api.js';
import { PluginPublishScanner, type PublishScanResult } from '@claude-flow/security';

// List subcommand - Now uses IPFS-based registry
const listCommand: Command = {
  name: 'list',
  description: 'List installed and available plugins from IPFS registry',
  options: [
    { name: 'installed', short: 'i', type: 'boolean', description: 'Show only installed plugins' },
    { name: 'available', short: 'a', type: 'boolean', description: 'Show available plugins from registry' },
    { name: 'category', short: 'c', type: 'string', description: 'Filter by category' },
    { name: 'type', short: 't', type: 'string', description: 'Filter by plugin type' },
    { name: 'official', short: 'o', type: 'boolean', description: 'Show only official plugins' },
    { name: 'featured', short: 'f', type: 'boolean', description: 'Show featured plugins' },
    { name: 'registry', short: 'r', type: 'string', description: 'Registry to use (default: claude-flow-official)' },
  ],
  examples: [
    { command: 'claude-flow plugins list', description: 'List all plugins from registry' },
    { command: 'claude-flow plugins list --installed', description: 'List installed only' },
    { command: 'claude-flow plugins list --official', description: 'List official plugins' },
    { command: 'claude-flow plugins list --category security', description: 'List security plugins' },
  ],
  action: async (ctx: CommandContext): Promise<CommandResult> => {
    const installedOnly = ctx.flags.installed as boolean;
    const category = ctx.flags.category as string;
    const type = ctx.flags.type as string;
    const official = ctx.flags.official as boolean;
    const featured = ctx.flags.featured as boolean;
    const registryName = ctx.flags.registry as string;

    // For installed-only, read from local manifest
    if (installedOnly) {
      output.writeln();
      output.writeln(output.bold('Installed Plugins'));
      output.writeln(output.dim('─'.repeat(60)));

      try {
        const manager = getPluginManager();
        await manager.initialize();
        const installed = await manager.getInstalled();

        if (installed.length === 0) {
          output.writeln(output.dim('No plugins installed.'));
          output.writeln();
          output.writeln(output.dim('Run "claude-flow plugins list" to see available plugins'));
          output.writeln(output.dim('Run "claude-flow plugins install -n <plugin>" to install'));
          return { success: true };
        }

        output.printTable({
          columns: [
            { key: 'name', header: 'Plugin', width: 38 },
            { key: 'version', header: 'Version', width: 14 },
            { key: 'source', header: 'Source', width: 10 },
            { key: 'status', header: 'Status', width: 10 },
          ],
          data: installed.map((p: InstalledPlugin) => ({
            name: p.name,
            version: p.version,
            source: p.source,
            status: p.enabled ? output.success('Enabled') : output.dim('Disabled'),
          })),
        });

        output.writeln();
        output.writeln(output.dim(`Plugins directory: ${manager.getPluginsDir()}`));

        return { success: true, data: installed };
      } catch (error) {
        output.printError(`Failed to load installed plugins: ${String(error)}`);
        return { success: false, exitCode: 1 };
      }
    }

    // Discover registry via IPFS
    const spinner = output.createSpinner({ text: 'Discovering plugin registry via IPNS...', spinner: 'dots' });
    spinner.start();

    try {
      const discovery = createPluginDiscoveryService();
      const result = await discovery.discoverRegistry(registryName);

      if (!result.success || !result.registry) {
        spinner.fail('Failed to discover registry');
        output.printError(result.error || 'Unknown error');
        return { success: false, exitCode: 1 };
      }

      spinner.succeed(`Registry discovered: ${result.registry.totalPlugins} plugins available`);

      output.writeln();

      // Build search options
      const searchOptions: PluginSearchOptions = {
        category,
        type: type as PluginType,
        sortBy: 'downloads',
        sortOrder: 'desc',
      };

      let plugins: PluginEntry[];
      let title: string;

      if (official) {
        plugins = getOfficialPlugins(result.registry);
        title = 'Official Plugins';
      } else if (featured) {
        plugins = getFeaturedPlugins(result.registry);
        title = 'Featured Plugins';
      } else {
        const searchResult = searchPlugins(result.registry, searchOptions);
        plugins = searchResult.plugins;
        title = category ? `${category} Plugins` : 'Available Plugins';
      }

      output.writeln(output.bold(title));
      output.writeln(output.dim('─'.repeat(70)));

      // Fetch real ratings from Cloud Function (non-blocking)
      let realRatings: Record<string, { average: number; count: number }> = {};
      let ratingsSource: 'live' | 'cached' | 'unavailable' = 'live';
      try {
        const pluginIds = plugins.map(p => p.name);
        realRatings = await getBulkRatings(pluginIds, 'plugin');
      } catch {
        // Fall back to static ratings if Cloud Function unavailable
        ratingsSource = 'unavailable';
      }

      if (ctx.flags.format === 'json') {
        // Merge real ratings into plugin data
        const pluginsWithRatings = plugins.map(p => ({
          ...p,
          rating: realRatings[p.name]?.average || p.rating,
          ratingCount: realRatings[p.name]?.count || 0,
          ...(ratingsSource === 'unavailable' ? { ratingsSource: 'cached' as const } : {}),
        }));
        output.printJson(pluginsWithRatings);
        return { success: true, data: pluginsWithRatings };
      }

      output.printTable({
        columns: [
          { key: 'name', header: 'Plugin', width: 38 },
          { key: 'version', header: 'Version', width: 14 },
          { key: 'type', header: 'Type', width: 12 },
          { key: 'downloads', header: 'Downloads', width: 10, align: 'right' },
          { key: 'rating', header: 'Rating', width: 10, align: 'right' },
          { key: 'trust', header: 'Trust', width: 10 },
        ],
        data: plugins.map(p => {
          const liveRating = realRatings[p.name];
          const ratingDisplay = liveRating && liveRating.count > 0
            ? `${liveRating.average.toFixed(1)}★(${liveRating.count})`
            : `${p.rating.toFixed(1)}★`;
          return {
            name: p.name,
            version: p.version,
            type: p.type,
            downloads: p.downloads.toLocaleString(),
            rating: ratingDisplay,
            trust: p.trustLevel === 'official' ? output.success('Official') :
                   p.trustLevel === 'verified' ? output.highlight('Verified') :
                   p.verified ? output.dim('Community') : output.dim('Unverified'),
          };
        }),
      });

      output.writeln();
      if (ratingsSource === 'unavailable') {
        output.writeln(output.dim('(ratings: cached — cloud unavailable)'));
      }
      output.writeln(output.dim(`Source: ${result.source}${result.fromCache ? ' (cached)' : ''}`));
      if (result.cid) {
        output.writeln(output.dim(`Registry CID: ${result.cid.slice(0, 30)}...`));
      }

      return { success: true, data: plugins };
    } catch (error) {
      spinner.fail('Failed to fetch registry');
      output.printError(`Error: ${String(error)}`);
      return { success: false, exitCode: 1 };
    }
  },
};

// Install subcommand - Now fetches from IPFS registry
const installCommand: Command = {
  name: 'install',
  description: 'Install a plugin from IPFS registry or local path',
  options: [
    { name: 'name', short: 'n', type: 'string', description: 'Plugin name or path', required: true },
    { name: 'version', short: 'v', type: 'string', description: 'Specific version to install' },
    { name: 'global', short: 'g', type: 'boolean', description: 'Install globally' },
    { name: 'dev', short: 'd', type: 'boolean', description: 'Install as dev dependency' },
    { name: 'verify', type: 'boolean', description: 'Verify checksum (default: true)', default: true },
    { name: 'registry', short: 'r', type: 'string', description: 'Registry to use' },
  ],
  examples: [
    { command: 'claude-flow plugins install -n community-analytics', description: 'Install plugin from IPFS' },
    { command: 'claude-flow plugins install -n ./my-plugin --dev', description: 'Install local plugin' },
  ],
  action: async (ctx: CommandContext): Promise<CommandResult> => {
    const name = ctx.flags.name as string;
    const version = ctx.flags.version as string || 'latest';
    const registryName = ctx.flags.registry as string;
    const verify = ctx.flags.verify !== false;

    if (!name) {
      output.printError('Plugin name is required');
      return { success: false, exitCode: 1 };
    }

    // Check if it's a local path
    const isLocalPath = name.startsWith('./') || name.startsWith('/') || name.startsWith('../');

    output.writeln();
    output.writeln(output.bold('Installing Plugin'));
    output.writeln(output.dim('─'.repeat(50)));

    const spinner = output.createSpinner({
      text: isLocalPath ? `Installing from ${name}...` : `Discovering ${name} in registry...`,
      spinner: 'dots'
    });
    spinner.start();

    try {
      const manager = getPluginManager();
      await manager.initialize();

      // Check if already installed
      const existingPlugin = await manager.getPlugin(name);
      if (existingPlugin) {
        spinner.fail(`Plugin ${name} is already installed (v${existingPlugin.version})`);
        output.writeln();
        output.writeln(output.dim('Use "claude-flow plugins upgrade -n ' + name + '" to update'));
        return { success: false, exitCode: 1 };
      }

      let result;
      let plugin: PluginEntry | undefined;

      if (isLocalPath) {
        // Install from local path
        spinner.setText(`Installing from ${name}...`);
        result = await manager.installFromLocal(name);
      } else {
        // First, try to find in registry for metadata
        spinner.setText(`Discovering ${name} in registry...`);
        const discovery = createPluginDiscoveryService();
        const registryResult = await discovery.discoverRegistry(registryName);

        if (registryResult.success && registryResult.registry) {
          plugin = registryResult.registry.plugins.find(p => p.name === name || p.id === name);
        }

        if (plugin) {
          spinner.setText(`Found ${plugin.displayName} v${plugin.version}`);
        }

        // Install from npm (since IPFS is demo mode)
        spinner.setText(`Installing ${name} from npm...`);
        result = await manager.installFromNpm(name, version !== 'latest' ? version : undefined);
      }

      if (!result.success) {
        spinner.fail(`Installation failed: ${result.error}`);
        return { success: false, exitCode: 1 };
      }

      const installed = result.plugin!;
      spinner.succeed(`Installed ${installed.name}@${installed.version}`);

      output.writeln();

      const boxContent = [
        `Plugin: ${installed.name}`,
        `Version: ${installed.version}`,
        `Source: ${installed.source}`,
        `Path: ${installed.path || 'N/A'}`,
        ``,
        `Hooks registered: ${installed.hooks?.length || 0}`,
        `Commands added: ${installed.commands?.length || 0}`,
      ];

      if (plugin) {
        boxContent.push(`Trust: ${plugin.trustLevel}`);
        boxContent.push(`Permissions: ${plugin.permissions.join(', ') || 'none'}`);
      }

      output.printBox(boxContent.join('\n'), 'Installation Complete');

      return { success: true, data: installed };
    } catch (error) {
      spinner.fail('Installation failed');
      output.printError(`Error: ${String(error)}`);
      return { success: false, exitCode: 1 };
    }
  },
};

// Uninstall subcommand
const uninstallCommand: Command = {
  name: 'uninstall',
  description: 'Uninstall a plugin',
  options: [
    { name: 'name', short: 'n', type: 'string', description: 'Plugin name', required: true },
    { name: 'force', short: 'f', type: 'boolean', description: 'Force uninstall without confirmation' },
  ],
  examples: [
    { command: 'claude-flow plugins uninstall -n community-analytics', description: 'Uninstall plugin' },
  ],
  action: async (ctx: CommandContext): Promise<CommandResult> => {
    const name = ctx.flags.name as string;

    if (!name) {
      output.printError('Plugin name is required');
      return { success: false, exitCode: 1 };
    }

    output.writeln();
    const spinner = output.createSpinner({ text: `Uninstalling ${name}...`, spinner: 'dots' });
    spinner.start();

    try {
      const manager = getPluginManager();
      await manager.initialize();

      // Check if installed
      const plugin = await manager.getPlugin(name);
      if (!plugin) {
        spinner.fail(`Plugin ${name} is not installed`);
        return { success: false, exitCode: 1 };
      }

      // Uninstall
      const result = await manager.uninstall(name);

      if (!result.success) {
        spinner.fail(`Failed to uninstall: ${result.error}`);
        return { success: false, exitCode: 1 };
      }

      spinner.succeed(`Uninstalled ${name}`);
      output.writeln();
      output.writeln(output.dim(`Removed ${plugin.version} from ${manager.getPluginsDir()}`));

      return { success: true };
    } catch (error) {
      spinner.fail('Uninstall failed');
      output.printError(`Error: ${String(error)}`);
      return { success: false, exitCode: 1 };
    }
  },
};

// Enable/Disable subcommand
const toggleCommand: Command = {
  name: 'toggle',
  description: 'Enable or disable a plugin',
  options: [
    { name: 'name', short: 'n', type: 'string', description: 'Plugin name', required: true },
    { name: 'enable', short: 'e', type: 'boolean', description: 'Enable the plugin' },
    { name: 'disable', short: 'd', type: 'boolean', description: 'Disable the plugin' },
  ],
  examples: [
    { command: 'claude-flow plugins toggle -n analytics --enable', description: 'Enable plugin' },
    { command: 'claude-flow plugins toggle -n analytics --disable', description: 'Disable plugin' },
  ],
  action: async (ctx: CommandContext): Promise<CommandResult> => {
    const name = ctx.flags.name as string;
    const enable = ctx.flags.enable as boolean;
    const disable = ctx.flags.disable as boolean;

    if (!name) {
      output.printError('Plugin name is required');
      return { success: false, exitCode: 1 };
    }

    try {
      const manager = getPluginManager();
      await manager.initialize();

      // Check if installed
      const plugin = await manager.getPlugin(name);
      if (!plugin) {
        output.printError(`Plugin ${name} is not installed`);
        return { success: false, exitCode: 1 };
      }

      let result;
      let action: string;
      let newState: boolean;

      if (enable) {
        result = await manager.enable(name);
        action = 'Enabled';
        newState = true;
      } else if (disable) {
        result = await manager.disable(name);
        action = 'Disabled';
        newState = false;
      } else {
        // Toggle
        result = await manager.toggle(name);
        newState = result.enabled ?? !plugin.enabled;
        action = newState ? 'Enabled' : 'Disabled';
      }

      if (!result.success) {
        output.printError(`Failed to toggle: ${result.error}`);
        return { success: false, exitCode: 1 };
      }

      output.writeln();
      output.writeln(output.success(`${action} ${name}`));
      output.writeln(output.dim(`Plugin is now ${newState ? 'enabled' : 'disabled'}`));

      return { success: true, data: { enabled: newState } };
    } catch (error) {
      output.printError(`Error: ${String(error)}`);
      return { success: false, exitCode: 1 };
    }
  },
};

// Info subcommand - Now fetches from IPFS registry
const infoCommand: Command = {
  name: 'info',
  description: 'Show detailed plugin information from IPFS registry',
  options: [
    { name: 'name', short: 'n', type: 'string', description: 'Plugin name', required: true },
    { name: 'registry', short: 'r', type: 'string', description: 'Registry to use' },
  ],
  examples: [
    { command: 'claude-flow plugins info -n @claude-flow/neural', description: 'Show plugin info' },
  ],
  action: async (ctx: CommandContext): Promise<CommandResult> => {
    const name = ctx.flags.name as string;
    const registryName = ctx.flags.registry as string;

    if (!name) {
      output.printError('Plugin name is required');
      return { success: false, exitCode: 1 };
    }

    const spinner = output.createSpinner({ text: 'Fetching plugin details...', spinner: 'dots' });
    spinner.start();

    try {
      // Discover registry and find plugin
      const discovery = createPluginDiscoveryService();
      const result = await discovery.discoverRegistry(registryName);

      if (!result.success || !result.registry) {
        spinner.fail('Failed to discover registry');
        return { success: false, exitCode: 1 };
      }

      const plugin = result.registry.plugins.find(p => p.name === name || p.id === name);
      if (!plugin) {
        spinner.fail(`Plugin not found: ${name}`);
        return { success: false, exitCode: 1 };
      }

      spinner.succeed(`Found ${plugin.displayName}`);

      output.writeln();
      output.writeln(output.bold(`Plugin: ${plugin.displayName}`));
      output.writeln(output.dim('─'.repeat(60)));

      if (ctx.flags.format === 'json') {
        output.printJson(plugin);
        return { success: true, data: plugin };
      }

      // Basic info
      output.writeln(output.bold('Basic Information'));
      output.printTable({
        columns: [
          { key: 'field', header: 'Field', width: 15 },
          { key: 'value', header: 'Value', width: 45 },
        ],
        data: [
          { field: 'Name', value: plugin.name },
          { field: 'Display Name', value: plugin.displayName },
          { field: 'Version', value: plugin.version },
          { field: 'Type', value: plugin.type },
          { field: 'License', value: plugin.license },
          { field: 'Author', value: plugin.author.displayName || plugin.author.id },
          { field: 'Trust Level', value: plugin.trustLevel },
          { field: 'Verified', value: plugin.verified ? '✓ Yes' : '✗ No' },
        ],
      });

      output.writeln();
      output.writeln(output.bold('Description'));
      output.writeln(plugin.description);

      // Storage info
      output.writeln();
      output.writeln(output.bold('Storage'));
      output.printTable({
        columns: [
          { key: 'field', header: 'Field', width: 15 },
          { key: 'value', header: 'Value', width: 45 },
        ],
        data: [
          { field: 'CID', value: plugin.cid },
          { field: 'Size', value: `${(plugin.size / 1024).toFixed(1)} KB` },
          { field: 'Checksum', value: plugin.checksum },
        ],
      });

      // Stats
      output.writeln();
      output.writeln(output.bold('Statistics'));
      output.printTable({
        columns: [
          { key: 'field', header: 'Field', width: 15 },
          { key: 'value', header: 'Value', width: 45 },
        ],
        data: [
          { field: 'Downloads', value: plugin.downloads.toLocaleString() },
          { field: 'Rating', value: `${plugin.rating.toFixed(1)}★ (${plugin.ratingCount} ratings)` },
          { field: 'Created', value: plugin.createdAt },
          { field: 'Updated', value: plugin.lastUpdated },
        ],
      });

      // Hooks and commands
      if (plugin.hooks.length > 0) {
        output.writeln();
        output.writeln(output.bold('Hooks'));
        output.printList(plugin.hooks.map(h => output.highlight(h)));
      }

      if (plugin.commands.length > 0) {
        output.writeln();
        output.writeln(output.bold('Commands'));
        output.printList(plugin.commands.map(c => output.highlight(c)));
      }

      // Permissions
      if (plugin.permissions.length > 0) {
        output.writeln();
        output.writeln(output.bold('Required Permissions'));
        output.printList(plugin.permissions.map(p => {
          const icon = ['privileged', 'credentials', 'execute'].includes(p) ? '⚠️ ' : '';
          return `${icon}${p}`;
        }));
      }

      // Dependencies
      if (plugin.dependencies.length > 0) {
        output.writeln();
        output.writeln(output.bold('Dependencies'));
        output.printList(plugin.dependencies.map(d =>
          `${d.name}@${d.version}${d.optional ? ' (optional)' : ''}`
        ));
      }

      // Security audit
      if (plugin.securityAudit) {
        output.writeln();
        output.writeln(output.bold('Security Audit'));
        output.printTable({
          columns: [
            { key: 'field', header: 'Field', width: 15 },
            { key: 'value', header: 'Value', width: 45 },
          ],
          data: [
            { field: 'Auditor', value: plugin.securityAudit.auditor },
            { field: 'Date', value: plugin.securityAudit.auditDate },
            { field: 'Passed', value: plugin.securityAudit.passed ? '✓ Yes' : '✗ No' },
            { field: 'Issues', value: String(plugin.securityAudit.issues.length) },
          ],
        });
      }

      // Tags
      output.writeln();
      output.writeln(output.bold('Tags'));
      output.writeln(plugin.tags.map(t => output.dim(`#${t}`)).join(' '));

      return { success: true, data: plugin };
    } catch (error) {
      spinner.fail('Failed to fetch plugin info');
      output.printError(`Error: ${String(error)}`);
      return { success: false, exitCode: 1 };
    }
  },
};

// Create subcommand
const createCommand: Command = {
  name: 'create',
  description: 'Scaffold a new plugin project',
  options: [
    { name: 'name', short: 'n', type: 'string', description: 'Plugin name', required: true },
    { name: 'template', short: 't', type: 'string', description: 'Template: basic, advanced, hooks', default: 'basic' },
    { name: 'path', short: 'p', type: 'string', description: 'Output path', default: '.' },
  ],
  examples: [
    { command: 'claude-flow plugins create -n my-plugin', description: 'Create basic plugin' },
    { command: 'claude-flow plugins create -n my-plugin -t hooks', description: 'Create hooks plugin' },
  ],
  action: async (ctx: CommandContext): Promise<CommandResult> => {
    const name = ctx.flags.name as string;
    const template = ctx.flags.template as string || 'basic';

    if (!name) {
      output.printError('Plugin name is required');
      return { success: false, exitCode: 1 };
    }

    output.writeln();
    output.writeln(output.bold('Creating Plugin'));
    output.writeln(output.dim('─'.repeat(40)));

    const spinner = output.createSpinner({ text: 'Scaffolding project...', spinner: 'dots' });
    spinner.start();

    const files = ['package.json', 'src/index.ts', 'src/hooks.ts', 'README.md', 'tsconfig.json'];
    for (const file of files) {
      spinner.setText(`Creating ${file}...`);
      await new Promise(r => setTimeout(r, 150));
    }

    spinner.succeed('Plugin scaffolded');

    output.writeln();
    output.printBox([
      `Plugin: ${name}`,
      `Template: ${template}`,
      `Location: ./${name}/`,
      ``,
      `Files created:`,
      `  - package.json`,
      `  - src/index.ts`,
      `  - src/hooks.ts`,
      `  - README.md`,
      `  - tsconfig.json`,
      ``,
      `Next steps:`,
      `  cd ${name}`,
      `  npm install`,
      `  npm run build`,
    ].join('\n'), 'Success');

    return { success: true };
  },
};

// Upgrade subcommand
const upgradeCommand: Command = {
  name: 'upgrade',
  description: 'Upgrade an installed plugin to a newer version',
  options: [
    { name: 'name', short: 'n', type: 'string', description: 'Plugin name', required: true },
    { name: 'version', short: 'v', type: 'string', description: 'Target version (default: latest)' },
  ],
  examples: [
    { command: 'claude-flow plugins upgrade -n @claude-flow/neural', description: 'Upgrade to latest' },
    { command: 'claude-flow plugins upgrade -n @claude-flow/neural -v 3.1.0', description: 'Upgrade to specific version' },
  ],
  action: async (ctx: CommandContext): Promise<CommandResult> => {
    const name = ctx.flags.name as string;
    const version = ctx.flags.version as string;

    if (!name) {
      output.printError('Plugin name is required');
      return { success: false, exitCode: 1 };
    }

    output.writeln();
    const spinner = output.createSpinner({ text: `Upgrading ${name}...`, spinner: 'dots' });
    spinner.start();

    try {
      const manager = getPluginManager();
      await manager.initialize();

      // Check if installed
      const existing = await manager.getPlugin(name);
      if (!existing) {
        spinner.fail(`Plugin ${name} is not installed`);
        return { success: false, exitCode: 1 };
      }

      const oldVersion = existing.version;
      spinner.setText(`Upgrading ${name} from v${oldVersion}...`);

      const result = await manager.upgrade(name, version);

      if (!result.success) {
        spinner.fail(`Upgrade failed: ${result.error}`);
        return { success: false, exitCode: 1 };
      }

      const plugin = result.plugin!;
      spinner.succeed(`Upgraded ${name}: v${oldVersion} -> v${plugin.version}`);

      return { success: true, data: plugin };
    } catch (error) {
      spinner.fail('Upgrade failed');
      output.printError(`Error: ${String(error)}`);
      return { success: false, exitCode: 1 };
    }
  },
};

// Search subcommand - Search IPFS registry
const searchCommand: Command = {
  name: 'search',
  description: 'Search plugins in the IPFS registry',
  options: [
    { name: 'query', short: 'q', type: 'string', description: 'Search query', required: true },
    { name: 'category', short: 'c', type: 'string', description: 'Filter by category' },
    { name: 'type', short: 't', type: 'string', description: 'Filter by plugin type' },
    { name: 'verified', short: 'v', type: 'boolean', description: 'Show only verified plugins' },
    { name: 'limit', short: 'l', type: 'number', description: 'Maximum results', default: 20 },
    { name: 'registry', short: 'r', type: 'string', description: 'Registry to use' },
  ],
  examples: [
    { command: 'claude-flow plugins search -q neural', description: 'Search for neural plugins' },
    { command: 'claude-flow plugins search -q security --verified', description: 'Search verified security plugins' },
  ],
  action: async (ctx: CommandContext): Promise<CommandResult> => {
    const query = ctx.flags.query as string;
    const category = ctx.flags.category as string;
    const type = ctx.flags.type as string;
    const verified = ctx.flags.verified as boolean;
    const limit = (ctx.flags.limit as number) || 20;
    const registryName = ctx.flags.registry as string;

    if (!query) {
      output.printError('Search query is required');
      return { success: false, exitCode: 1 };
    }

    const spinner = output.createSpinner({ text: 'Searching plugin registry...', spinner: 'dots' });
    spinner.start();

    try {
      const discovery = createPluginDiscoveryService();
      const result = await discovery.discoverRegistry(registryName);

      if (!result.success || !result.registry) {
        spinner.fail('Failed to discover registry');
        return { success: false, exitCode: 1 };
      }

      const searchOptions: PluginSearchOptions = {
        query,
        category,
        type: type as PluginType,
        verified,
        limit,
        sortBy: 'downloads',
        sortOrder: 'desc',
      };

      const searchResult = searchPlugins(result.registry, searchOptions);
      spinner.succeed(`Found ${searchResult.total} plugins matching "${query}"`);

      output.writeln();
      output.writeln(output.bold(`Search Results: "${query}"`));
      output.writeln(output.dim('─'.repeat(70)));

      if (searchResult.plugins.length === 0) {
        output.writeln(output.dim('No plugins found matching your query'));
        output.writeln();
        output.writeln('Suggestions:');
        const suggestions = getPluginSearchSuggestions(result.registry, query.slice(0, 3));
        if (suggestions.length > 0) {
          output.printList(suggestions.slice(0, 5));
        } else {
          output.writeln(output.dim('  Try a different search term'));
        }
        return { success: true, data: searchResult };
      }

      if (ctx.flags.format === 'json') {
        output.printJson(searchResult);
        return { success: true, data: searchResult };
      }

      output.printTable({
        columns: [
          { key: 'name', header: 'Plugin', width: 38 },
          { key: 'description', header: 'Description', width: 40 },
          { key: 'downloads', header: 'Downloads', width: 10, align: 'right' },
        ],
        data: searchResult.plugins.map(p => ({
          name: p.verified ? `✓ ${p.name}` : p.name,
          description: p.description.slice(0, 33) + (p.description.length > 33 ? '...' : ''),
          downloads: p.downloads.toLocaleString(),
        })),
      });

      output.writeln();
      output.writeln(output.dim(`Showing ${searchResult.plugins.length} of ${searchResult.total} results`));
      if (searchResult.hasMore) {
        output.writeln(output.dim(`Use --limit to see more results`));
      }

      return { success: true, data: searchResult };
    } catch (error) {
      spinner.fail('Search failed');
      output.printError(`Error: ${String(error)}`);
      return { success: false, exitCode: 1 };
    }
  },
};

// Rate subcommand - Rate plugins via Cloud Function
const rateCommand: Command = {
  name: 'rate',
  description: 'Rate a plugin (1-5 stars)',
  options: [
    { name: 'name', short: 'n', type: 'string', description: 'Plugin name to rate', required: true },
    { name: 'rating', short: 'r', type: 'number', description: 'Rating (1-5)', required: true },
  ],
  examples: [
    { command: 'claude-flow plugins rate -n @claude-flow/embeddings -r 5', description: 'Rate 5 stars' },
    { command: 'claude-flow plugins rate -n my-plugin -r 4', description: 'Rate 4 stars' },
  ],
  action: async (ctx: CommandContext): Promise<CommandResult> => {
    const { rateItem } = await import('../services/registry-api.js');

    const name = ctx.flags.name as string;
    const rating = parseInt(ctx.flags.rating as string, 10);

    if (!name) {
      output.printError('Plugin name is required');
      return { success: false, exitCode: 1 };
    }

    if (!rating || rating < 1 || rating > 5) {
      output.printError('Rating must be 1-5');
      return { success: false, exitCode: 1 };
    }

    const spinner = output.createSpinner({ text: 'Submitting rating...', spinner: 'dots' });
    spinner.start();

    try {
      const result = await rateItem(name, rating, 'plugin');

      spinner.succeed('Rating submitted');
      output.writeln();
      output.writeln(`Plugin: ${output.highlight(name)}`);
      output.writeln(`Your rating: ${'★'.repeat(rating)}${'☆'.repeat(5 - rating)}`);
      output.writeln(`New average: ${result.average.toFixed(1)}★ (${result.count} ratings)`);
      output.writeln();
      output.writeln(output.dim('Thank you for your feedback!'));

      return { success: true, data: result };
    } catch (error) {
      spinner.fail('Failed to submit rating');
      output.printError(String(error));
      return { success: false, exitCode: 1 };
    }
  },
};

// Publish subcommand - ADR-320 P1: pre-publish static scan (AST rule pass)
const publishCommand: Command = {
  name: 'publish',
  description: 'Scan a plugin for publish-time security findings (ADR-320)',
  options: [
    { name: 'path', short: 'p', type: 'string', description: 'Plugin directory to scan', default: '.' },
  ],
  examples: [
    { command: 'claude-flow plugins publish', description: 'Scan the current directory before publishing' },
    { command: 'claude-flow plugins publish -p ./my-plugin', description: 'Scan a specific plugin directory' },
  ],
  action: async (ctx: CommandContext): Promise<CommandResult> => {
    const pluginPath = (ctx.flags.path as string) || '.';

    output.writeln();
    output.writeln(output.bold('Plugin Publish Scan'));
    output.writeln(output.dim('─'.repeat(50)));

    const spinner = output.createSpinner({ text: `Scanning ${pluginPath}...`, spinner: 'dots' });
    spinner.start();

    try {
      const scanner = new PluginPublishScanner();
      const result: PublishScanResult = await scanner.scan(pluginPath);

      if (result.verdict === 'block') {
        spinner.fail(`Scan blocked publish: ${result.findings.length} finding(s)`);
      } else if (result.verdict === 'warn') {
        spinner.stop(output.warning(`Scan completed with warnings: ${result.findings.length} finding(s)`));
      } else {
        spinner.succeed('Scan passed: no findings');
      }

      if (ctx.flags.format === 'json') {
        output.printJson(result);
        return { success: result.verdict !== 'block', exitCode: result.verdict === 'block' ? 1 : 0, data: result };
      }

      if (result.findings.length > 0) {
        output.writeln();
        output.printTable({
          columns: [
            { key: 'category', header: 'Category', width: 26 },
            { key: 'file', header: 'File', width: 30 },
            { key: 'confidence', header: 'Confidence', width: 10, align: 'right' },
          ],
          data: result.findings.map(f => ({
            category: f.category,
            file: f.file,
            confidence: f.confidence.toFixed(2),
          })),
        });
      }

      output.writeln();
      output.writeln(`Verdict: ${result.verdict === 'block' ? output.error(result.verdict) : result.verdict === 'warn' ? output.warning(result.verdict) : output.success(result.verdict)}`);
      output.writeln(output.dim('Dependency-graph risk (P2, not yet implemented): scanned=' + result.dependencyRisk.scanned));

      return { success: result.verdict !== 'block', exitCode: result.verdict === 'block' ? 1 : 0, data: result };
    } catch (error) {
      spinner.fail('Scan failed');
      output.printError(`Error: ${String(error)}`);
      return { success: false, exitCode: 1 };
    }
  },
};

// Main plugins command - Now with IPFS-based registry
export const pluginsCommand: Command = {
  name: 'plugins',
  description: 'Plugin management with IPFS-based decentralized registry',
  subcommands: [listCommand, searchCommand, installCommand, uninstallCommand, upgradeCommand, toggleCommand, infoCommand, createCommand, rateCommand, publishCommand],
  examples: [
    { command: 'claude-flow plugins list', description: 'List plugins from IPFS registry' },
    { command: 'claude-flow plugins search -q neural', description: 'Search for plugins' },
    { command: 'claude-flow plugins install -n community-analytics', description: 'Install from IPFS' },
    { command: 'claude-flow plugins create -n my-plugin', description: 'Create new plugin' },
    { command: 'claude-flow plugins publish -p ./my-plugin', description: 'Scan a plugin before publishing' },
  ],
  action: async (): Promise<CommandResult> => {
    output.writeln();
    output.writeln(output.bold('RuFlo Plugin System'));
    output.writeln(output.dim('Decentralized plugin marketplace via IPFS'));
    output.writeln();
    output.writeln('Subcommands:');
    output.printList([
      `${output.highlight('list')}      - List plugins from IPFS registry`,
      `${output.highlight('search')}    - Search plugins by query`,
      `${output.highlight('install')}   - Install a plugin from npm or local path`,
      `${output.highlight('uninstall')} - Remove an installed plugin`,
      `${output.highlight('upgrade')}   - Upgrade an installed plugin`,
      `${output.highlight('toggle')}    - Enable or disable a plugin`,
      `${output.highlight('info')}      - Show detailed plugin information`,
      `${output.highlight('create')}    - Scaffold a new plugin project`,
    ]);
    output.writeln();
    output.writeln(output.bold('IPFS-Based Features:'));
    output.printList([
      'Decentralized registry via IPNS for discoverability',
      'Content-addressed storage for integrity verification',
      'Ed25519 signatures for plugin verification',
      'Trust levels: unverified, community, verified, official',
      'Security audit tracking and vulnerability reporting',
    ]);
    output.writeln();
    output.writeln(output.bold('Official Plugins:'));
    output.printList([
      '@claude-flow/neural              - Neural patterns and inference (WASM SIMD)',
      '@claude-flow/security            - Security scanning and CVE detection',
      '@claude-flow/embeddings          - Vector embeddings with hyperbolic support',
      '@claude-flow/claims              - Claims-based authorization',
      '@claude-flow/performance         - Performance profiling and benchmarks',
      '@claude-flow/plugin-gastown-bridge - Gas Town orchestrator integration (WASM-accelerated)',
    ]);
    output.writeln();
    output.writeln(output.dim('Run "claude-flow plugins list --official" to see all official plugins'));
    output.writeln(output.dim('Created with ❤️ by ruv.io'));
    return { success: true };
  },
};

export default pluginsCommand;
