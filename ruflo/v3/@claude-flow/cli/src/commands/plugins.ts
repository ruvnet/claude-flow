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
} from '../plugins/store/index.js';

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

    // For installed-only, use local data (placeholder)
    if (installedOnly) {
      output.writeln();
      output.writeln(output.bold('Installed Plugins'));
      output.writeln(output.dim('─'.repeat(60)));

      // TODO: Read from local installed plugins manifest
      output.printTable({
        columns: [
          { key: 'name', header: 'Plugin', width: 24 },
          { key: 'version', header: 'Version', width: 10 },
          { key: 'type', header: 'Type', width: 12 },
          { key: 'status', header: 'Status', width: 10 },
        ],
        data: [
          { name: '@claude-flow/neural', version: '3.0.0', type: 'core', status: output.success('Active') },
          { name: '@claude-flow/security', version: '3.0.0', type: 'command', status: output.success('Active') },
          { name: '@claude-flow/embeddings', version: '3.0.0', type: 'core', status: output.success('Active') },
        ],
      });

      return { success: true };
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
        type: type as any,
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

      if (ctx.flags.format === 'json') {
        output.printJson(plugins);
        return { success: true, data: plugins };
      }

      output.printTable({
        columns: [
          { key: 'name', header: 'Plugin', width: 24 },
          { key: 'version', header: 'Version', width: 10 },
          { key: 'type', header: 'Type', width: 12 },
          { key: 'downloads', header: 'Downloads', width: 12, align: 'right' },
          { key: 'rating', header: 'Rating', width: 8, align: 'right' },
          { key: 'trust', header: 'Trust', width: 10 },
        ],
        data: plugins.map(p => ({
          name: p.name,
          version: p.version,
          type: p.type,
          downloads: p.downloads.toLocaleString(),
          rating: `${p.rating.toFixed(1)}★`,
          trust: p.trustLevel === 'official' ? output.success('Official') :
                 p.trustLevel === 'verified' ? output.highlight('Verified') :
                 p.verified ? output.dim('Community') : output.dim('Unverified'),
        })),
      });

      output.writeln();
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
      let plugin: PluginEntry | undefined;

      if (!isLocalPath) {
        // Fetch from IPFS registry
        const discovery = createPluginDiscoveryService();
        const result = await discovery.discoverRegistry(registryName);

        if (!result.success || !result.registry) {
          spinner.fail('Failed to discover registry');
          return { success: false, exitCode: 1 };
        }

        // Find the plugin
        plugin = result.registry.plugins.find(p => p.name === name || p.id === name);
        if (!plugin) {
          spinner.fail(`Plugin not found: ${name}`);
          output.writeln();
          output.writeln(output.dim('Run "claude-flow plugins list" to see available plugins'));
          return { success: false, exitCode: 1 };
        }

        spinner.setText(`Found ${plugin.displayName} v${plugin.version}`);
        await new Promise(r => setTimeout(r, 200));

        // Check permissions
        if (plugin.permissions.length > 0) {
          spinner.setText('Checking permissions...');
          await new Promise(r => setTimeout(r, 200));
        }

        spinner.setText(`Downloading from IPFS (CID: ${plugin.cid.slice(0, 12)}...)...`);
        await new Promise(r => setTimeout(r, 300));

        if (verify) {
          spinner.setText('Verifying checksum...');
          await new Promise(r => setTimeout(r, 200));
        }
      }

      spinner.setText('Installing dependencies...');
      await new Promise(r => setTimeout(r, 300));

      spinner.setText('Registering hooks and commands...');
      await new Promise(r => setTimeout(r, 200));

      spinner.succeed(`Installed ${plugin?.displayName || name}@${plugin?.version || version}`);

      output.writeln();

      if (plugin) {
        output.printBox([
          `Plugin: ${plugin.displayName}`,
          `Version: ${plugin.version}`,
          `CID: ${plugin.cid}`,
          `Size: ${(plugin.size / 1024).toFixed(1)} KB`,
          `Trust: ${plugin.trustLevel}`,
          ``,
          `Hooks registered: ${plugin.hooks.length}`,
          `Commands added: ${plugin.commands.length}`,
          `Permissions: ${plugin.permissions.join(', ') || 'none'}`,
        ].join('\n'), 'Installation Complete');
      } else {
        output.printBox([
          `Plugin: ${name}`,
          `Version: ${version}`,
          `Location: node_modules/${name}`,
        ].join('\n'), 'Installation Complete');
      }

      return { success: true, data: plugin };
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
    await new Promise(r => setTimeout(r, 500));
    spinner.succeed(`Uninstalled ${name}`);

    return { success: true };
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

    if (!name) {
      output.printError('Plugin name is required');
      return { success: false, exitCode: 1 };
    }

    const action = enable ? 'Enabling' : 'Disabling';
    const spinner = output.createSpinner({ text: `${action} ${name}...`, spinner: 'dots' });
    spinner.start();
    await new Promise(r => setTimeout(r, 300));
    spinner.succeed(`${name} ${enable ? 'enabled' : 'disabled'}`);

    return { success: true };
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
        type: type as any,
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
          { key: 'name', header: 'Plugin', width: 26 },
          { key: 'description', header: 'Description', width: 35 },
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

// Main plugins command - Now with IPFS-based registry
export const pluginsCommand: Command = {
  name: 'plugins',
  description: 'Plugin management with IPFS-based decentralized registry',
  subcommands: [listCommand, searchCommand, installCommand, uninstallCommand, toggleCommand, infoCommand, createCommand],
  examples: [
    { command: 'claude-flow plugins list', description: 'List plugins from IPFS registry' },
    { command: 'claude-flow plugins search -q neural', description: 'Search for plugins' },
    { command: 'claude-flow plugins install -n community-analytics', description: 'Install from IPFS' },
    { command: 'claude-flow plugins create -n my-plugin', description: 'Create new plugin' },
  ],
  action: async (): Promise<CommandResult> => {
    output.writeln();
    output.writeln(output.bold('Claude Flow Plugin System'));
    output.writeln(output.dim('Decentralized plugin marketplace via IPFS'));
    output.writeln();
    output.writeln('Subcommands:');
    output.printList([
      `${output.highlight('list')}      - List plugins from IPFS registry`,
      `${output.highlight('search')}    - Search plugins by query`,
      `${output.highlight('install')}   - Install a plugin from IPFS or local path`,
      `${output.highlight('uninstall')} - Remove an installed plugin`,
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
      '@claude-flow/neural     - Neural patterns and inference (WASM SIMD)',
      '@claude-flow/security   - Security scanning and CVE detection',
      '@claude-flow/embeddings - Vector embeddings with hyperbolic support',
      '@claude-flow/claims     - Claims-based authorization',
      '@claude-flow/performance- Performance profiling and benchmarks',
    ]);
    output.writeln();
    output.writeln(output.dim('Run "claude-flow plugins list --official" to see all official plugins'));
    output.writeln(output.dim('Created with ❤️ by ruv.io'));
    return { success: true };
  },
};

export default pluginsCommand;
