/**
 * V3 Progress CLI Command
 *
 * Check and manage V3 implementation progress.
 *
 * @module @claude-flow/cli/commands/progress
 */

import type { Command, CommandContext, CommandResult } from '../types.js';
import { output } from '../output.js';
import { callMCPTool, MCPClientError } from '../mcp-client.js';

function progressBar(percent: number, width: number = 20): string {
  const filled = Math.round((percent / 100) * width);
  const empty = width - filled;
  const bar = output.success('█'.repeat(filled)) + output.dim('░'.repeat(empty));
  return `[${bar}] ${percent}%`;
}

// Check subcommand
const checkCommand: Command = {
  name: 'check',
  description: 'Check current progress (default)',
  options: [
    {
      name: 'detailed',
      short: 'd',
      description: 'Show detailed breakdown',
      type: 'boolean',
      default: false,
    },
  ],
  action: async (ctx: CommandContext): Promise<CommandResult> => {
    const detailed = ctx.flags.detailed as boolean;
    const spinner = output.createSpinner({ text: 'Checking V3 progress...' });

    try {
      spinner.start();
      const result = await callMCPTool<{
        progress?: number;
        overall?: number;
        breakdown?: Record<string, string>;
        cli?: { progress: number; commands: number; target: number };
        mcp?: { progress: number; tools: number; target: number };
        hooks?: { progress: number; subcommands: number; target: number };
        packages?: { progress: number; total: number; target: number; withDDD: number };
        ddd?: { progress: number };
        codebase?: { totalFiles: number; totalLines: number };
        lastUpdated?: string;
      }>('progress/check', { detailed });
      spinner.stop();

      if (ctx.flags.format === 'json') {
        output.printJson(result);
        return { success: true, data: result };
      }

      const progressValue = result.overall ?? result.progress ?? 0;

      output.writeln();
      output.writeln(output.bold('V3 Implementation Progress'));
      output.writeln();
      output.writeln(progressBar(progressValue, 30));
      output.writeln();

      if (detailed && result.cli) {
        output.writeln(output.highlight('CLI Commands:') + `     ${result.cli.progress}% (${result.cli.commands}/${result.cli.target})`);
        output.writeln(output.highlight('MCP Tools:') + `        ${result.mcp?.progress ?? 0}% (${result.mcp?.tools ?? 0}/${result.mcp?.target ?? 0})`);
        output.writeln(output.highlight('Hooks:') + `            ${result.hooks?.progress ?? 0}% (${result.hooks?.subcommands ?? 0}/${result.hooks?.target ?? 0})`);
        output.writeln(output.highlight('Packages:') + `         ${result.packages?.progress ?? 0}% (${result.packages?.total ?? 0}/${result.packages?.target ?? 0})`);
        output.writeln(output.highlight('DDD Structure:') + `    ${result.ddd?.progress ?? 0}% (${result.packages?.withDDD ?? 0}/${result.packages?.total ?? 0})`);
        output.writeln();
        if (result.codebase) {
          output.writeln(output.dim(`Codebase: ${result.codebase.totalFiles} files, ${result.codebase.totalLines.toLocaleString()} lines`));
        }
      } else if (result.breakdown) {
        output.writeln('Breakdown:');
        for (const [category, value] of Object.entries(result.breakdown)) {
          output.writeln(`  ${output.highlight(category)}: ${value}`);
        }
      }

      if (result.lastUpdated) {
        output.writeln(output.dim(`Last updated: ${result.lastUpdated}`));
      }

      return { success: true, data: result };
    } catch (error) {
      spinner.fail('Progress check failed');
      if (error instanceof MCPClientError) {
        output.printError(`Error: ${error.message}`);
      } else {
        output.printError(`Unexpected error: ${String(error)}`);
      }
      return { success: false, exitCode: 1 };
    }
  },
};

// Sync subcommand
const syncCommand: Command = {
  name: 'sync',
  description: 'Calculate and persist progress',
  action: async (ctx: CommandContext): Promise<CommandResult> => {
    const spinner = output.createSpinner({ text: 'Syncing progress...' });

    try {
      spinner.start();
      const result = await callMCPTool<{
        progress: number;
        message: string;
        persisted: boolean;
        lastUpdated: string;
      }>('progress/sync', {});
      spinner.stop();

      if (ctx.flags.format === 'json') {
        output.printJson(result);
        return { success: true, data: result };
      }

      output.writeln();
      output.printSuccess(`Progress synced: ${result.progress}%`);
      output.writeln(output.dim(`  Persisted to .claude-flow/metrics/v3-progress.json`));
      output.writeln(output.dim(`  Last updated: ${result.lastUpdated}`));

      return { success: true, data: result };
    } catch (error) {
      spinner.fail('Progress sync failed');
      if (error instanceof MCPClientError) {
        output.printError(`Error: ${error.message}`);
      } else {
        output.printError(`Unexpected error: ${String(error)}`);
      }
      return { success: false, exitCode: 1 };
    }
  },
};

// Summary subcommand
const summaryCommand: Command = {
  name: 'summary',
  description: 'Show human-readable summary',
  action: async (ctx: CommandContext): Promise<CommandResult> => {
    const spinner = output.createSpinner({ text: 'Getting progress summary...' });

    try {
      spinner.start();
      const result = await callMCPTool<{ summary: string }>('progress/summary', {});
      spinner.stop();

      if (ctx.flags.format === 'json') {
        output.printJson(result);
        return { success: true, data: result };
      }

      output.writeln();
      output.writeln(result.summary);

      return { success: true, data: result };
    } catch (error) {
      spinner.fail('Summary fetch failed');
      if (error instanceof MCPClientError) {
        output.printError(`Error: ${error.message}`);
      } else {
        output.printError(`Unexpected error: ${String(error)}`);
      }
      return { success: false, exitCode: 1 };
    }
  },
};

// Watch subcommand
const watchCommand: Command = {
  name: 'watch',
  description: 'Watch for progress changes',
  options: [
    {
      name: 'interval',
      short: 'i',
      description: 'Update interval in milliseconds',
      type: 'number',
      default: 5000,
    },
  ],
  action: async (ctx: CommandContext): Promise<CommandResult> => {
    const interval = (ctx.flags.interval as number) || 5000;

    output.writeln(output.highlight(`Watching progress (interval: ${interval}ms). Press Ctrl+C to stop.`));
    output.writeln();

    let lastProgress = 0;

    const check = async () => {
      try {
        const result = await callMCPTool<{ progress?: number; overall?: number }>('progress/check', {});
        const currentProgress = result.overall ?? result.progress ?? 0;

        if (currentProgress !== lastProgress) {
          output.writeln(`${output.warning('→')} Progress changed: ${lastProgress}% → ${output.success(currentProgress + '%')}`);
          lastProgress = currentProgress;
        } else {
          process.stdout.write(`\r${progressBar(currentProgress, 20)} ${output.dim(new Date().toLocaleTimeString())}`);
        }
      } catch (error) {
        output.printError(`Check failed: ${error instanceof Error ? error.message : String(error)}`);
      }
    };

    await check();
    const timer = setInterval(check, interval);

    // Handle Ctrl+C
    process.on('SIGINT', () => {
      clearInterval(timer);
      output.writeln();
      output.writeln(output.dim('Stopped watching.'));
      process.exit(0);
    });

    // Keep running
    return new Promise(() => {});
  },
};

// Main progress command
export const progressCommand: Command = {
  name: 'progress',
  description: 'Check V3 implementation progress',
  aliases: ['prog'],
  subcommands: [
    checkCommand,
    syncCommand,
    summaryCommand,
    watchCommand,
  ],
  options: [
    {
      name: 'detailed',
      short: 'd',
      description: 'Show detailed breakdown',
      type: 'boolean',
      default: false,
    },
    {
      name: 'sync',
      short: 's',
      description: 'Sync and persist progress',
      type: 'boolean',
      default: false,
    },
    {
      name: 'watch',
      short: 'w',
      description: 'Watch for changes',
      type: 'boolean',
      default: false,
    },
  ],
  examples: [
    {
      command: 'claude-flow progress',
      description: 'Check current progress',
    },
    {
      command: 'claude-flow progress --detailed',
      description: 'Show detailed breakdown',
    },
    {
      command: 'claude-flow progress sync',
      description: 'Sync and persist progress',
    },
    {
      command: 'claude-flow progress watch',
      description: 'Watch for changes',
    },
    {
      command: 'claude-flow progress --json',
      description: 'Output as JSON',
    },
  ],
  action: async (ctx: CommandContext): Promise<CommandResult> => {
    // Handle --sync flag
    if (ctx.flags.sync) {
      return (await syncCommand.action!(ctx)) as CommandResult;
    }

    // Handle --watch flag
    if (ctx.flags.watch) {
      return (await watchCommand.action!(ctx)) as CommandResult;
    }

    // Default to check
    return (await checkCommand.action!(ctx)) as CommandResult;
  },
};

export default progressCommand;
