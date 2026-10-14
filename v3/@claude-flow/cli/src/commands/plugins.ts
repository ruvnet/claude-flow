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
import { DEFAULT_PLUGIN_PERMISSIONS, isStrictPluginMode } from '../plugins/trust-policy.js';
import { getBulkRatings } from '../services/registry-api.js';

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

      if (result.demo) {
        // The signed registry was unavailable or failed verification (see ruvnet/ruflo#3211):
        // say so instead of reporting a successful discovery over the built-in list.
        spinner.stop(
          output.warning(
            `Signed plugin registry unavailable or unverified; showing the built-in list ` +
              `(${result.registry.totalPlugins} plugins)`,
          ),
        );
      } else if (result.verified !== true) {
        spinner.stop(
          output.warning(`Registry discovered but not verified: ${result.registry.totalPlugins} plugins available`),
        );
      } else {
        spinner.succeed(`Registry discovered: ${result.registry.totalPlugins} plugins available`);
      }

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
        if (result.verified !== true) {
          output.writeln(output.warning('No plugin is shown as official: only a verified registry can say which are.'));
        }
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
      if (result.demo) {
        output.writeln(
          output.warning(
            'Not from the signed registry: download counts and ratings are the ' +
              "CLI's built-in defaults, not verified registry data.",
          ),
        );
      }
      if (result.verified !== true) {
        output.writeln(
          output.warning(
            `Registry not verified (${result.unverifiedReason ?? 'unknown reason'}): every entry is ` +
              'shown as Unverified and installs get no registry trust.',
          ),
        );
      }
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
    {
      name: 'verify',
      type: 'boolean',
      description:
        'Verify before registering (default: true). Registry installs must match the registry sha256 checksum. ' +
        'Hooks and commands are withheld from a plugin that declares trustLevel "untrusted"/"unverified" or ' +
        `permissions beyond the default set (${DEFAULT_PLUGIN_PERMISSIONS.join(', ')}) unless --trust is given. ` +
        '--no-verify skips all of this.',
      default: true,
    },
    { name: 'trust', type: 'boolean', description: 'Register hooks and commands even if the plugin is untrusted or declares elevated permissions', default: false },
    {
      name: 'allow-unverified',
      type: 'boolean',
      description:
        'With CLAUDE_FLOW_STRICT_PLUGINS=true, install from npm even though the plugin registry is not verified. ' +
        'The plugin still gets no registry trust. Strict mode gates on the registry, not the package: while the ' +
        'registry is unverified every npm install is refused, listed or not; once it verifies, a package it does ' +
        'not list installs without this flag, but also without registry trust.',
      default: false,
    },
    { name: 'registry', short: 'r', type: 'string', description: 'Registry to use' },
  ],
  examples: [
    { command: 'claude-flow plugins install -n community-analytics', description: 'Install plugin from IPFS' },
    { command: 'claude-flow plugins install -n ./my-plugin --dev', description: 'Install local plugin' },
    { command: 'claude-flow plugins install -n ./my-plugin --trust', description: 'Install a local plugin that declares elevated permissions, registering its hooks' },
  ],
  action: async (ctx: CommandContext): Promise<CommandResult> => {
    const name = ctx.flags.name as string;
    const version = ctx.flags.version as string || 'latest';
    const registryName = ctx.flags.registry as string;
    const verify = ctx.flags.verify !== false;
    const trust = ctx.flags.trust === true;
    const allowUnverified = ctx.flags.allowUnverified === true || ctx.flags['allow-unverified'] === true;

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
      const registryWarnings: string[] = [];

      if (isLocalPath) {
        // Install from local path
        spinner.setText(`Installing from ${name}...`);
        result = await manager.installFromLocal(name, { verify, trust });
      } else {
        // First, try to find in registry for metadata
        spinner.setText(`Discovering ${name} in registry...`);
        const discovery = createPluginDiscoveryService();
        const registryResult = await discovery.discoverRegistry(registryName);

        if (registryResult.success && registryResult.registry) {
          plugin = registryResult.registry.plugins.find(p => p.name === name || p.id === name);
        }

        // Only a verified registry may vouch for a plugin (trust level, permissions, checksum).
        // An unverified or built-in list is just a claim, so its entries install like any npm
        // package: no install scripts and no permission vouching without --trust.
        const registryVerified = registryResult.success && registryResult.verified === true;
        if (!registryVerified) {
          const reason = registryResult.unverifiedReason ?? registryResult.error ?? 'registry not verified';
          if (isStrictPluginMode() && !allowUnverified) {
            spinner.fail(`Refusing to install ${name}: plugin registry is not verified (${reason})`);
            output.writeln();
            output.writeln(output.dim(
              'CLAUDE_FLOW_STRICT_PLUGINS=true requires a verified registry. Pass --allow-unverified to install it ' +
              'from npm anyway, without registry trust.',
            ));
            return { success: false, exitCode: 1 };
          }
          if (plugin) {
            registryWarnings.push(
              `${name} is listed only in an unverified registry (${reason}); it was installed without registry trust.`,
            );
          }
        }

        if (plugin) {
          spinner.setText(`Found ${plugin.displayName} v${plugin.version}`);
        }

        spinner.setText(`Installing ${name} from npm...`);
        result = await manager.installFromNpm(name, version !== 'latest' ? version : undefined, {
          verify,
          trust,
          ...(registryVerified && plugin
            ? {
                expectedChecksum: plugin.checksum,
                registryTrustLevel: plugin.trustLevel,
                registryPermissions: plugin.permissions,
              }
            : {}),
        });
      }

      if (!result.success) {
        spinner.fail(`Installation failed: ${result.error}`);
        return { success: false, exitCode: 1 };
      }

      const installed = result.plugin!;
      spinner.succeed(`Installed ${installed.name}@${installed.version}`);

      output.writeln();

      if (result.decision?.verificationSkipped) {
        output.printWarning('Verification skipped (--no-verify): hooks and commands were registered without a trust or checksum check.');
      }
      for (const warning of [...registryWarnings, ...(result.warnings ?? [])]) {
        output.printWarning(warning);
      }

      const boxContent = [
        `Plugin: ${installed.name}`,
        `Version: ${installed.version}`,
        `Source: ${installed.source}`,
        `Path: ${installed.path || 'N/A'}`,
        ``,
        `Trust: ${installed.trustLevel ?? 'not declared'}`,
        `Permissions: ${installed.permissions?.join(', ') || 'none declared'}`,
        `Verification: ${installed.verification ?? 'n/a'}`,
        `Install scripts: ${installed.source === 'local' ? 'n/a (local link)' : installed.scriptsRun ? 'ran' : 'skipped (use --trust to run)'}`,
        ``,
        `Hooks registered: ${installed.hooks?.length || 0}`,
        `Commands added: ${installed.commands?.length || 0}`,
      ];

      output.printBox(boxContent.join('\n'), 'Installation Complete');

      if (installed.withheld) {
        output.writeln();
        output.printWarning(
          `Withheld ${installed.withheld.hooks.length} hook(s) and ${installed.withheld.commands.length} command(s) ` +
          `from ${installed.name} because it ${installed.withheld.reasons.join('; ')}.`,
        );
        if (installed.withheld.hooks.length > 0) {
          output.writeln(output.dim(`  Hooks not registered: ${installed.withheld.hooks.join(', ')}`));
        }
        if (installed.withheld.commands.length > 0) {
          output.writeln(output.dim(`  Commands not added: ${installed.withheld.commands.join(', ')}`));
        }
        output.writeln(output.dim(`  To register them, uninstall and reinstall with --trust.`));
      }

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
        if (result.error) output.printError(result.error);
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
          { field: 'Registry', value: result.verified === true ? 'verified' : `unverified (${result.unverifiedReason ?? 'unknown reason'})` },
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
    {
      name: 'verify',
      type: 'boolean',
      description:
        'Re-apply the install trust policy to the new version (default: true). Its hooks and commands are withheld ' +
        `if it declares trustLevel "untrusted"/"unverified" or permissions beyond the default set (${DEFAULT_PLUGIN_PERMISSIONS.join(', ')}) ` +
        'unless --trust is given. --no-verify skips this.',
      default: true,
    },
    {
      name: 'trust',
      type: 'boolean',
      description:
        "Run the new version's install scripts and register its hooks and commands even if it is untrusted or " +
        'declares elevated permissions. Not carried over from the original install.',
      default: false,
    },
  ],
  examples: [
    { command: 'claude-flow plugins upgrade -n @claude-flow/neural', description: 'Upgrade to latest' },
    { command: 'claude-flow plugins upgrade -n @claude-flow/neural -v 3.1.0', description: 'Upgrade to specific version' },
  ],
  action: async (ctx: CommandContext): Promise<CommandResult> => {
    const name = ctx.flags.name as string;
    const version = ctx.flags.version as string;
    const verify = ctx.flags.verify !== false;
    const trust = ctx.flags.trust === true;

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

      const result = await manager.upgrade(name, version, { verify, trust });

      if (!result.success) {
        spinner.fail(`Upgrade failed: ${result.error}`);
        return { success: false, exitCode: 1 };
      }

      const plugin = result.plugin!;
      spinner.succeed(`Upgraded ${name}: v${oldVersion} -> v${plugin.version}`);

      if (result.decision?.verificationSkipped) {
        output.printWarning('Verification skipped (--no-verify): hooks and commands were registered without a trust check.');
      }
      for (const warning of result.warnings ?? []) {
        output.printWarning(warning);
      }
      if (plugin.withheld) {
        output.printWarning(
          `Withheld ${plugin.withheld.hooks.length} hook(s) and ${plugin.withheld.commands.length} command(s) ` +
          `from ${plugin.name} because it ${plugin.withheld.reasons.join('; ')}. Upgrade with --trust to register them.`,
        );
      }

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
        if (result.error) output.printError(result.error);
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

// Main plugins command - Now with IPFS-based registry
export const pluginsCommand: Command = {
  name: 'plugins',
  description: 'Plugin management with IPFS-based decentralized registry',
  subcommands: [listCommand, searchCommand, installCommand, uninstallCommand, upgradeCommand, toggleCommand, infoCommand, createCommand, rateCommand],
  examples: [
    { command: 'claude-flow plugins list', description: 'List plugins from IPFS registry' },
    { command: 'claude-flow plugins search -q neural', description: 'Search for plugins' },
    { command: 'claude-flow plugins install -n community-analytics', description: 'Install from IPFS' },
    { command: 'claude-flow plugins create -n my-plugin', description: 'Create new plugin' },
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
