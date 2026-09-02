/**
 * V3 CLI Update Command
 * Auto-update system for @claude-flow packages (ADR-025)
 */

import type { Command, CommandContext, CommandResult } from '../types.js';
import { output } from '../output.js';
import {
  checkForUpdates,
  checkSinglePackage,
  getInstalledVersion,
  DEFAULT_CONFIG,
} from '../update/checker.js';
import type { UpdateCheckResult } from '../update/checker.js';
import {
  executeUpdate,
  executeMultipleUpdates,
  rollbackUpdate,
  getUpdateHistory,
  clearHistory,
} from '../update/executor.js';
import { clearCache } from '../update/rate-limiter.js';

// Helper functions
function formatUpdateType(type: string): string {
  switch (type) {
    case 'major':
      return output.error('MAJOR');
    case 'minor':
      return output.warning('minor');
    case 'patch':
      return output.success('patch');
    default:
      return type;
  }
}

function formatPriority(priority: string): string {
  switch (priority) {
    case 'critical':
      return output.error('CRITICAL');
    case 'high':
      return output.warning('high');
    case 'normal':
      return output.info('normal');
    case 'low':
      return output.dim('low');
    default:
      return priority;
  }
}

// Subcommand: check
const checkCommand: Command = {
  name: 'check',
  description: 'Check for available @claude-flow package updates',
  options: [
    { name: 'force', description: 'Force check (ignore rate limit)', type: 'boolean' },
    { name: 'json', description: 'Output as JSON', type: 'boolean' },
  ],
  async action(ctx: CommandContext): Promise<CommandResult> {
    const { flags } = ctx;

    if (flags.force) {
      process.env.CLAUDE_FLOW_FORCE_UPDATE = 'true';
    }

    try {
      const { results, skipped, reason } = await checkForUpdates(DEFAULT_CONFIG);

      if (skipped) {
        output.printInfo(`Update check skipped: ${reason}`);
        output.writeln('Use --force to check anyway');
        return { success: true };
      }

      if (flags.json) {
        console.log(JSON.stringify(results, null, 2));
        return { success: true };
      }

      if (results.length === 0) {
        output.printSuccess('All @claude-flow packages are up to date!');
        return { success: true };
      }

      output.writeln();
      output.writeln(output.highlight('═══ Available Updates ═══'));
      output.writeln();

      output.printTable({
        columns: [
          { key: 'package', header: 'Package' },
          { key: 'current', header: 'Current' },
          { key: 'latest', header: 'Latest' },
          { key: 'type', header: 'Type' },
          { key: 'priority', header: 'Priority' },
          { key: 'auto', header: 'Auto' },
        ],
        data: results.map((r) => ({
          package: r.package,
          current: r.currentVersion,
          latest: output.highlight(r.latestVersion),
          type: formatUpdateType(r.updateType),
          priority: formatPriority(r.priority),
          auto: r.shouldAutoUpdate ? output.success('yes') : output.dim('no'),
        })),
      });

      output.writeln();
      const autoUpdates = results.filter((r) => r.shouldAutoUpdate);
      const manualUpdates = results.filter((r) => !r.shouldAutoUpdate);

      if (autoUpdates.length > 0) {
        output.printInfo(
          `${autoUpdates.length} update(s) will be applied automatically on next startup`
        );
      }

      if (manualUpdates.length > 0) {
        output.writeln();
        output.printInfo('To update manually, run:');
        output.writeln('  claude-flow update all');
      }

      return { success: true };
    } finally {
      delete process.env.CLAUDE_FLOW_FORCE_UPDATE;
    }
  },
};

// Subcommand: all
const allCommand: Command = {
  name: 'all',
  description: 'Update all @claude-flow packages',
  options: [
    { name: 'dry-run', description: 'Show what would be updated', type: 'boolean' },
    { name: 'include-major', description: 'Include major version updates', type: 'boolean' },
  ],
  async action(ctx: CommandContext): Promise<CommandResult> {
    const { flags } = ctx;
    process.env.CLAUDE_FLOW_FORCE_UPDATE = 'true';

    try {
      output.printInfo('Checking for updates...');

      const config = {
        ...DEFAULT_CONFIG,
        autoUpdate: {
          patch: true,
          minor: true,
          major: flags['include-major'] as boolean || false,
        },
      };

      const { results } = await checkForUpdates(config);

      if (results.length === 0) {
        output.printSuccess('All packages are up to date!');
        return { success: true };
      }

      // Get installed packages
      const installedPackages: Record<string, string> = {};
      for (const update of results) {
        const version = getInstalledVersion(update.package);
        if (version) {
          installedPackages[update.package] = version;
        }
      }

      output.printInfo(`Updating ${results.length} package(s)...`);

      const updateResults = await executeMultipleUpdates(
        results,
        installedPackages,
        flags['dry-run'] as boolean
      );

      const successful = updateResults.filter((r) => r.success);
      const failed = updateResults.filter((r) => !r.success);

      output.writeln();
      output.writeln(output.highlight(flags['dry-run'] ? '═══ Dry Run - Would Update ═══' : '═══ Update Results ═══'));
      output.writeln();

      if (successful.length > 0) {
        output.printSuccess(
          `${successful.length} package(s) ${flags['dry-run'] ? 'would be ' : ''}updated:`
        );
        for (const r of successful) {
          output.writeln(`  ${output.success('✓')} ${r.package}@${r.version}`);
        }
      }

      if (failed.length > 0) {
        output.writeln();
        output.printError(`${failed.length} package(s) failed:`);
        for (const r of failed) {
          output.writeln(`  ${output.error('✗')} ${r.package}: ${r.error}`);
        }
      }

      return { success: failed.length === 0 };
    } finally {
      delete process.env.CLAUDE_FLOW_FORCE_UPDATE;
    }
  },
};

// Subcommand: history
const historyCommand: Command = {
  name: 'history',
  description: 'View update history',
  options: [
    { name: 'limit', short: 'n', description: 'Number of entries', type: 'string', default: '20' },
    { name: 'json', description: 'Output as JSON', type: 'boolean' },
    { name: 'clear', description: 'Clear history', type: 'boolean' },
  ],
  async action(ctx: CommandContext): Promise<CommandResult> {
    const { flags } = ctx;

    if (flags.clear) {
      clearHistory();
      output.printSuccess('Update history cleared');
      return { success: true };
    }

    const limit = parseInt(flags.limit as string || '20', 10);
    const history = getUpdateHistory(limit);

    if (history.length === 0) {
      output.printInfo('No update history available');
      return { success: true };
    }

    if (flags.json) {
      console.log(JSON.stringify(history, null, 2));
      return { success: true };
    }

    output.writeln();
    output.writeln(output.highlight('═══ Update History ═══'));
    output.writeln();

    output.printTable({
      columns: [
        { key: 'time', header: 'Time' },
        { key: 'package', header: 'Package' },
        { key: 'from', header: 'From' },
        { key: 'to', header: 'To' },
        { key: 'status', header: 'Status' },
      ],
      data: history.map((h) => ({
        time: new Date(h.timestamp).toLocaleString(),
        package: h.package,
        from: h.fromVersion,
        to: h.toVersion,
        status: h.success ? output.success('success') : output.error('failed'),
      })),
    });

    return { success: true };
  },
};

// Subcommand: rollback
const rollbackCommand: Command = {
  name: 'rollback',
  description: 'Rollback last update',
  options: [
    { name: 'package', short: 'p', description: 'Specific package to rollback', type: 'string' },
  ],
  async action(ctx: CommandContext): Promise<CommandResult> {
    const { flags } = ctx;
    const packageName = flags.package as string | undefined;

    output.printInfo(
      packageName ? `Rolling back ${packageName}...` : 'Rolling back last update...'
    );

    const result = await rollbackUpdate(packageName);

    if (result.success) {
      output.printSuccess(result.message);
    } else {
      output.printError(result.message);
    }

    return { success: result.success };
  },
};

// Subcommand: clear-cache
const clearCacheCommand: Command = {
  name: 'clear-cache',
  description: 'Clear update check cache',
  async action(): Promise<CommandResult> {
    clearCache();
    output.printSuccess('Update cache cleared');
    output.printInfo('Next startup will check for updates');
    return { success: true };
  },
};

// Main update command
const updateCommand: Command = {
  name: 'update',
  description: 'Manage @claude-flow package updates (ADR-025)',
  subcommands: [checkCommand, allCommand, historyCommand, rollbackCommand, clearCacheCommand],
  async action(): Promise<CommandResult> {
    // Show help if no subcommand
    output.writeln();
    output.writeln(output.highlight('═══ Update Command ═══'));
    output.writeln();
    output.writeln('Manage @claude-flow package updates with auto-update support.');
    output.writeln();
    output.writeln('Subcommands:');
    output.printList([
      `${output.highlight('check')}       - Check for available updates`,
      `${output.highlight('all')}         - Update all packages`,
      `${output.highlight('history')}     - View update history`,
      `${output.highlight('rollback')}    - Rollback last update`,
      `${output.highlight('clear-cache')} - Clear update check cache`,
    ]);
    output.writeln();
    output.writeln('Environment Variables:');
    output.printList([
      `${output.dim('CLAUDE_FLOW_AUTO_UPDATE=false')}  - Disable auto-update`,
      `${output.dim('CLAUDE_FLOW_FORCE_UPDATE=true')} - Force update check`,
    ]);
    output.writeln();
    output.writeln('Run "claude-flow update <subcommand> --help" for subcommand help');

    return { success: true };
  },
};

export default updateCommand;
