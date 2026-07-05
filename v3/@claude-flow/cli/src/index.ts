/**
 * V3 CLI Main Entry Point
 * Modernized CLI for RuFlo V3
 *
 * Created with ❤️ by ruv.io
 */

// MUST be the first import — installs console filter for the cosmetic
// "[AgentDB Patch] Controller index not found" warning before any
// agentic-flow / agentdb code can load. ES module imports are evaluated
// in source order, so this file runs its side effects before any other
// import in this module's import graph (including transitive imports of
// agentic-flow via commands/index.js).
import './log-filters.js';

import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import type { Command, CommandContext, CommandResult, V3Config, CLIError } from './types.js';
import { CommandParser, commandParser } from './parser.js';
import { OutputFormatter, output } from './output.js';
import { commands, commandsByCategory, getCommandsByCategory, commandRegistry, getCommand, getCommandAsync, getCommandNames, getLazyCommandNames, hasCommand } from './commands/index.js';
import { suggestCommand } from './suggest.js';
import { runStartupUpdateCheck } from './update/index.js';

// Read version from package.json at runtime
function getPackageVersion(): string {
  try {
    const __filename = fileURLToPath(import.meta.url);
    const __dirname = dirname(__filename);
    // Navigate from dist/src to package root
    const pkgPath = join(__dirname, '..', '..', 'package.json');
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'));
    return pkg.version || '3.0.0';
  } catch {
    return '3.0.0';
  }
}

export const VERSION = getPackageVersion();

export interface CLIOptions {
  name?: string;
  description?: string;
  version?: string;
  interactive?: boolean;
}

/**
 * V3 CLI Application
 */
export class CLI {
  private name: string;
  private description: string;
  private version: string;
  private parser: CommandParser;
  private output: OutputFormatter;
  private interactive: boolean;

  constructor(options: CLIOptions = {}) {
    this.name = options.name || 'ruflo';
    this.description = options.description || 'RuFlo V3 - AI Agent Orchestration Platform';
    this.version = options.version || VERSION;
    this.parser = commandParser;
    this.output = output;
    this.interactive = options.interactive ?? process.stdin.isTTY ?? false;

    // Register all core (synchronously loaded) commands with full definitions
    for (const cmd of commands) {
      this.parser.registerCommand(cmd);
    }

    // Register lazy command names so the parser can recognize them during
    // argument resolution without importing their modules. Fix for #1596:
    // prevents `daemon start` from being mis-routed to the `start` command.
    for (const name of getLazyCommandNames()) {
      this.parser.registerLazyCommandName(name);
    }
  }

  /**
   * Run the CLI with given arguments
   */
  async run(args: string[] = process.argv.slice(2)): Promise<void> {
    try {
      // #1791.2 — If the user invoked a lazy command (e.g. `hive-mind task`),
      // pre-load it BEFORE parsing so the parser can build scoped flag
      // aliases for its subcommands. Without this, short flags defined on
      // the lazy command's subcommand options (`-d` for description, etc.)
      // never get into the alias map and silently fall through to global
      // resolution — the user sees `[ERROR] Task description is required`
      // even though they passed `-d "smoke"`.
      for (const arg of args) {
        if (arg.startsWith('-')) continue;
        if (this.parser.isLazyOnly(arg)) {
          const cmd = await getCommandAsync(arg);
          if (cmd) this.parser.registerCommand(cmd);
        }
        break; // only the first non-flag positional is the command name
      }

      // Parse arguments
      const parseResult = this.parser.parse(args);
      const { command: commandPath, flags, positional } = parseResult;

      // Handle global flags
      if (flags.version || flags.V) {
        this.showVersion();
        return;
      }

      if (flags.noColor) {
        this.output.setColorEnabled(false);
      }

      // Set verbosity level based on flags
      if (flags.quiet) {
        this.output.setVerbosity('quiet');
      } else if (flags.verbose) {
        this.output.setVerbosity(process.env.DEBUG ? 'debug' : 'verbose');
      }

      // Verbose mode: show parsed arguments
      if (this.output.isVerbose()) {
        this.output.printDebug(`Command: ${commandPath.join(' ') || '(none)'}`);
        this.output.printDebug(`Positional: [${positional.join(', ')}]`);
        this.output.printDebug(`Flags: ${JSON.stringify(Object.fromEntries(Object.entries(flags).filter(([k]) => k !== '_')))}`);
        this.output.printDebug(`CWD: ${process.cwd()}`);
      }

      // Run startup update check (non-blocking, silent on skip)
      if (!flags.noUpdate && commandPath[0] !== 'update') {
        this.checkForUpdatesOnStartup().catch(() => {/* silent */});
      }

      // Version-stamped helper auto-refresh — propagate hook fixes to an already
      // initialized project without a manual re-init. Skip for init/upgrade
      // (they refresh explicitly). AWAITED (not fire-and-forget) so a fast
      // command can't exit before the copy lands; the fast path is a single
      // stamp read + string compare (sub-ms), and the copy runs at most once per
      // version bump. Best-effort + silent — never blocks or fails a command.
      if (commandPath[0] !== 'init' && commandPath[0] !== 'update') {
        try {
          const { autoRefreshHelpersIfStale } = await import('./init/helper-refresh.js');
          const r = await autoRefreshHelpersIfStale(process.cwd());
          if (r.blocked) {
            // Integrity failure = potential on-disk tampering of hook code. Warn
            // loudly (not silent) — the existing project helpers were left intact.
            this.output.printWarning(`Skipped helper auto-refresh — ${r.blocked}. Reinstall @claude-flow/cli from a trusted source.`);
          } else if (r.refreshed && this.output.isVerbose()) {
            this.output.printDebug(`Refreshed .claude/helpers (${r.from} → ${r.to})`);
          }
        } catch { /* silent */ }

        // ADR-177: adopt a signed proven-configuration champion if the package
        // ships one newer than this project's stamp AND it is authentic +
        // suitable for this environment. Sibling of the helper channel above —
        // its own stamp + trust root; additive no-op when no champion ships.
        try {
          const { autoAdoptProvenConfigIfStale } = await import('./config/proven-config-refresh.js');
          const a = await autoAdoptProvenConfigIfStale(process.cwd());
          if (a.adopted && this.output.isVerbose()) {
            this.output.printDebug(`Adopted proven config (${a.from} → ${a.to})`);
          }
          // Close the loop (ADR-176 phase 9): promote the adopted champion to the
          // ACTIVE policy that consumers (neural_patterns retrieval, …) read. A
          // no-op if nothing is adopted or it is already active; reversible.
          const { applyChampion } = await import('./config/harness-feedback-applier.js');
          const ap = applyChampion(process.cwd());
          if (ap.applied && this.output.isVerbose()) {
            this.output.printDebug(`Applied proven config to active policy (${ap.from ?? '(none)'} → ${ap.to})`);
          }
        } catch { /* silent */ }

        // Self-running daemon: ensure the background workers (distillation,
        // backup, …) are actually firing without a manual `daemon start`.
        // Single-instance (only spawns when none is alive; the spawned daemon
        // re-checks its own lock), bounded (TTL/idle self-shutdown), opt-out via
        // RUFLO_DAEMON_AUTOSTART=0. Skipped for `daemon` (no recursion). Detached
        // + fire-and-forget, so it never blocks the command.
        if (commandPath[0] !== 'daemon') {
          try {
            const { ensureDaemonRunning } = await import('./services/daemon-autostart.js');
            const d = ensureDaemonRunning(process.cwd());
            if (d.started && this.output.isVerbose()) this.output.printDebug('Started background daemon (auto)');
          } catch { /* silent */ }
        }
      }

      // Handle lazy-loaded commands that weren't recognized by the parser
      // If commandPath is empty but positional has a command name, check if it's lazy-loadable
      if (commandPath.length === 0 && positional.length > 0 && !positional[0].startsWith('-')) {
        const potentialCommand = positional[0];
        if (hasCommand(potentialCommand)) {
          // This is a lazy-loaded command, treat it as the command
          commandPath.push(potentialCommand);
          positional.shift();
        }
      }

      // No command - show help or suggest correction
      if (commandPath.length === 0 || flags.help || flags.h) {
        if (commandPath.length > 0) {
          // #1791.4 — pass the FULL command path so subcommands like
          // `hive-mind spawn --help` render spawn's own options/examples
          // instead of falling back to the parent's SUBCOMMANDS list.
          await this.showCommandHelp(commandPath);
        } else if (positional.length > 0 && !positional[0].startsWith('-')) {
          // First positional looks like an attempted command - suggest correction
          const attemptedCommand = positional[0];
          this.output.printError(`Unknown command: ${attemptedCommand}`);
          const availableCommands = Array.from(new Set([...commands.map(c => c.name), ...getCommandNames()]));
          const { message } = suggestCommand(attemptedCommand, availableCommands);
          this.output.writeln(this.output.dim(`  ${message}`));
          process.exit(1);
        } else {
          await this.showHelp();
        }
        return;
      }

      // Find and execute command
      const commandName = commandPath[0];
      // First check the parser's registry (for dynamically registered commands)
      // Then fall back to the static registry, then try lazy loading
      let command = this.parser.getCommand(commandName) || getCommand(commandName);

      // If not found in sync registry, try lazy loading
      if (!command && hasCommand(commandName)) {
        command = await getCommandAsync(commandName);
      }

      if (!command) {
        this.output.printError(`Unknown command: ${commandName}`);
        // Smart suggestions - include lazy-loadable commands in suggestions
        const availableCommands = Array.from(new Set([...commands.map(c => c.name), ...getCommandNames()]));
        const { message } = suggestCommand(commandName, availableCommands);
        this.output.writeln(this.output.dim(`  ${message}`));
        process.exit(1);
      }

      // Handle subcommand (supports nested subcommands)
      let targetCommand = command;
      let subcommandArgs = positional;

      // Process command path (e.g., ['hooks', 'worker', 'list'])
      // Note: When parser includes subcommand in commandPath, positional already excludes it
      if (commandPath.length > 1 && command.subcommands) {
        const subcommandName = commandPath[1];
        const subcommand = command.subcommands.find(
          sc => sc.name === subcommandName || sc.aliases?.includes(subcommandName)
        );

        if (subcommand) {
          targetCommand = subcommand;
          // Parser already extracted subcommand from positional, so use as-is
          subcommandArgs = positional;

          // Check for nested subcommand (level 2)
          if (commandPath.length > 2 && subcommand.subcommands) {
            const nestedName = commandPath[2];
            const nestedSubcommand = subcommand.subcommands.find(
              sc => sc.name === nestedName || sc.aliases?.includes(nestedName)
            );
            if (nestedSubcommand) {
              targetCommand = nestedSubcommand;
              // Parser already extracted nested subcommand too
              subcommandArgs = positional;
            }
          }
        }
      } else if (positional.length > 0 && command.subcommands) {
        // Check if first positional is a subcommand
        const subcommandName = positional[0];
        const subcommand = command.subcommands.find(
          sc => sc.name === subcommandName || sc.aliases?.includes(subcommandName)
        );

        if (subcommand) {
          targetCommand = subcommand;
          subcommandArgs = positional.slice(1);

          // Check for nested subcommand (level 2 from positional)
          if (subcommandArgs.length > 0 && subcommand.subcommands) {
            const nestedName = subcommandArgs[0];
            const nestedSubcommand = subcommand.subcommands.find(
              sc => sc.name === nestedName || sc.aliases?.includes(nestedName)
            );
            if (nestedSubcommand) {
              targetCommand = nestedSubcommand;
              subcommandArgs = subcommandArgs.slice(1);
            }
          }
        }
      }

      // Validate flags
      const validationErrors = this.parser.validateFlags(flags, targetCommand);
      if (validationErrors.length > 0) {
        for (const error of validationErrors) {
          this.output.printError(error);
        }
        process.exit(1);
      }

      // Build context
      const ctx: CommandContext = {
        args: subcommandArgs,
        flags,
        config: await this.loadConfig(flags.config as string),
        cwd: process.cwd(),
        interactive: this.interactive && !flags.quiet
      };

      // Execute command
      if (targetCommand.action) {
        if (this.output.isVerbose()) {
          this.output.printDebug(`Executing: ${targetCommand.name}`);
        }

        const startTime = Date.now();
        const result = await targetCommand.action(ctx);

        if (this.output.isVerbose()) {
          this.output.printDebug(`Completed in ${Date.now() - startTime}ms`);
        }

        if (result && !result.success) {
          process.exit(result.exitCode || 1);
        }
      } else {
        // No action - show command help (full path so nested subcommands work)
        await this.showCommandHelp(commandPath);
      }
    } catch (error) {
      // Don't re-handle if this is a process.exit error (from mocked tests)
      const errorMessage = (error as Error).message;
      if (errorMessage && errorMessage.startsWith('process.exit:')) {
        throw error; // Re-throw so tests can capture the exit code
      }
      this.handleError(error as Error);
    }
  }

  /**
   * Show main help
   */
  private async showHelp(): Promise<void> {
    this.output.writeln();
    this.output.writeln(this.output.bold(`${this.name} v${this.version}`));
    this.output.writeln(this.output.dim(this.description));
    this.output.writeln();

    this.output.writeln(this.output.bold('USAGE:'));
    this.output.writeln(`  ${this.name} <command> [subcommand] [options]`);
    this.output.writeln();

    // PERF-03: Load all commands by category (lazy-loaded on demand)
    const categories = await getCommandsByCategory();

    // Primary Commands
    this.output.writeln(this.output.bold('PRIMARY COMMANDS:'));
    for (const cmd of categories.primary) {
      if (cmd.hidden) continue;
      const name = cmd.name.padEnd(12);
      this.output.writeln(`  ${this.output.highlight(name)} ${cmd.description}`);
    }
    this.output.writeln();

    // Advanced Commands
    if (categories.advanced.length > 0) {
      this.output.writeln(this.output.bold('ADVANCED COMMANDS:'));
      for (const cmd of categories.advanced) {
        if (cmd.hidden) continue;
        const name = cmd.name.padEnd(12);
        this.output.writeln(`  ${this.output.highlight(name)} ${cmd.description}`);
      }
      this.output.writeln();
    }

    // Utility Commands
    if (categories.utility.length > 0) {
      this.output.writeln(this.output.bold('UTILITY COMMANDS:'));
      for (const cmd of categories.utility) {
        if (cmd.hidden) continue;
        const name = cmd.name.padEnd(12);
        this.output.writeln(`  ${this.output.highlight(name)} ${cmd.description}`);
      }
      this.output.writeln();
    }

    // Analysis Commands
    if (categories.analysis.length > 0) {
      this.output.writeln(this.output.bold('ANALYSIS COMMANDS:'));
      for (const cmd of categories.analysis) {
        if (cmd.hidden) continue;
        const name = cmd.name.padEnd(12);
        this.output.writeln(`  ${this.output.highlight(name)} ${cmd.description}`);
      }
      this.output.writeln();
    }

    // Management Commands
    if (categories.management.length > 0) {
      this.output.writeln(this.output.bold('MANAGEMENT COMMANDS:'));
      for (const cmd of categories.management) {
        if (cmd.hidden) continue;
        const name = cmd.name.padEnd(12);
        this.output.writeln(`  ${this.output.highlight(name)} ${cmd.description}`);
      }
      this.output.writeln();
    }

    this.output.writeln(this.output.bold('GLOBAL OPTIONS:'));
    for (const opt of this.parser.getGlobalOptions()) {
      const flags = opt.short ? `-${opt.short}, --${opt.name}` : `    --${opt.name}`;
      this.output.writeln(`  ${flags.padEnd(25)} ${opt.description}`);
    }
    this.output.writeln();

    this.output.writeln(this.output.bold('V3 FEATURES:'));
    this.output.printList([
      '15-agent hierarchical mesh coordination',
      'AgentDB with HNSW indexing (150x-12,500x faster)',
      'Flash Attention (2.49x-7.47x speedup)',
      'Unified SwarmCoordinator engine',
      'Event-sourced state management',
      'Domain-Driven Design architecture'
    ]);
    this.output.writeln();

    this.output.writeln(this.output.bold('EXAMPLES:'));
    this.output.writeln(`  ${this.name} agent spawn -t coder              # Spawn a coder agent`);
    this.output.writeln(`  ${this.name} swarm init --v3-mode              # Initialize V3 swarm`);
    this.output.writeln(`  ${this.name} memory search -q "auth patterns"  # Semantic search`);
    this.output.writeln(`  ${this.name} mcp start                         # Start MCP server`);
    this.output.writeln();

    this.output.writeln(this.output.dim(`Run "${this.name} <command> --help" for command help`));
    this.output.writeln();
    this.output.writeln(this.output.dim('Created with ❤️ by ruv.io'));
    this.output.writeln();
  }

  /**
   * Show command-specific help.
   *
   * #1791.4 — accepts a FULL command path (e.g. ['hive-mind', 'spawn']) and
   * walks subcommands so nested invocations show the leaf's own options /
   * examples instead of always rendering the parent's SUBCOMMANDS list.
   */
  private async showCommandHelp(commandPathOrName: string | string[]): Promise<void> {
    const commandPath = Array.isArray(commandPathOrName) ? commandPathOrName : [commandPathOrName];
    if (commandPath.length === 0) {
      await this.showHelp();
      return;
    }

    const rootName = commandPath[0];

    // Try sync first, then lazy load
    let command: Command | undefined = getCommand(rootName);
    if (!command && hasCommand(rootName)) {
      command = await getCommandAsync(rootName);
    }

    if (!command) {
      this.output.printError(`Unknown command: ${rootName}`);
      return;
    }

    // Walk into subcommands following the path so `hive-mind spawn --help`
    // renders spawn's help, not hive-mind's parent help. We use a non-null
    // local (`current`) instead of reassigning the optional `command` so
    // TS can prove the value is defined for the rest of the function.
    let current: Command = command;
    const titleParts: string[] = [current.name];
    for (let i = 1; i < commandPath.length; i++) {
      const subName = commandPath[i];
      const sub = current.subcommands?.find(sc => sc.name === subName || sc.aliases?.includes(subName));
      if (!sub) break; // unknown leaf — fall back to last known
      current = sub;
      titleParts.push(sub.name);
    }

    this.output.writeln();
    this.output.writeln(this.output.bold(`${this.name} ${titleParts.join(' ')}`));
    this.output.writeln(current.description);
    this.output.writeln();

    // Subcommands
    if (current.subcommands && current.subcommands.length > 0) {
      this.output.writeln(this.output.bold('SUBCOMMANDS:'));
      for (const sub of current.subcommands) {
        if (sub.hidden) continue;
        const name = sub.name.padEnd(15);
        const aliases = sub.aliases ? this.output.dim(` (${sub.aliases.join(', ')})`) : '';
        this.output.writeln(`  ${this.output.highlight(name)} ${sub.description}${aliases}`);
      }
      this.output.writeln();
    }

    // Options
    if (current.options && current.options.length > 0) {
      this.output.writeln(this.output.bold('OPTIONS:'));
      for (const opt of current.options) {
        const flags = opt.short ? `-${opt.short}, --${opt.name}` : `    --${opt.name}`;
        const required = opt.required ? this.output.error(' (required)') : '';
        const defaultVal = opt.default !== undefined ? this.output.dim(` [default: ${opt.default}]`) : '';
        this.output.writeln(`  ${flags.padEnd(25)} ${opt.description}${required}${defaultVal}`);
      }
      this.output.writeln();
    }

    // Examples
    if (current.examples && current.examples.length > 0) {
      this.output.writeln(this.output.bold('EXAMPLES:'));
      for (const example of current.examples) {
        this.output.writeln(`  ${this.output.dim('$')} ${example.command}`);
        this.output.writeln(`    ${this.output.dim(example.description)}`);
      }
      this.output.writeln();
    }
  }

  /**
   * Show version
   */
  private showVersion(): void {
    this.output.writeln(`${this.name} v${this.version}`);
  }

  /**
   * Check for updates on startup (non-blocking)
   * Shows notification if updates are available
   */
  private async checkForUpdatesOnStartup(): Promise<void> {
    try {
      const result = await runStartupUpdateCheck({ autoUpdate: true });

      // Show notifications for available updates that weren't auto-applied
      if (result.checked && result.updatesAvailable.length > 0) {
        const nonAutoUpdates = result.updatesAvailable.filter(u => !u.shouldAutoUpdate);

        if (result.updatesApplied.length > 0) {
          this.output.writeln(
            this.output.dim(`Auto-updated: ${result.updatesApplied.join(', ')}`)
          );
        }

        if (nonAutoUpdates.length > 0) {
          this.output.writeln(
            this.output.dim(`Updates available: ${nonAutoUpdates.map(u => `${u.package}@${u.latestVersion}`).join(', ')}`)
          );
          this.output.writeln(
            this.output.dim(`Run '${this.name} update check' for details`)
          );
        }
      }
    } catch {
      // Silently fail - don't interrupt CLI usage
    }
  }

  /**
   * Load configuration file
   */
  private async loadConfig(configPath?: string): Promise<V3Config | undefined> {
    try {
      // Import config utilities
      const { loadConfig: loadSystemConfig } = await import('@claude-flow/shared');
      const { systemConfigToV3Config } = await import('./config-adapter.js');

      // Load configuration
      const loaded = await loadSystemConfig({
        file: configPath,
        paths: configPath ? undefined : [process.cwd()],
      });

      // Convert to V3Config format
      const v3Config = systemConfigToV3Config(loaded.config);

      // Log warnings if any
      if (loaded.warnings && loaded.warnings.length > 0) {
        for (const warning of loaded.warnings) {
          this.output.printWarning(warning);
        }
      }

      return v3Config;
    } catch (error) {
      // Config loading is optional - don't fail if it doesn't exist
      if (process.env.DEBUG) {
        this.output.writeln(
          this.output.dim(`Config loading failed: ${(error as Error).message}`)
        );
      }
      return undefined;
    }
  }

  /**
   * Handle errors
   */
  private handleError(error: Error): void {
    if ('code' in error) {
      // CLIError
      const cliError = error as CLIError;
      this.output.printError(cliError.message);

      if (cliError.details) {
        this.output.writeln(this.output.dim(JSON.stringify(cliError.details, null, 2)));
      }

      process.exit(cliError.exitCode);
    } else {
      // Generic error
      this.output.printError(error.message);

      if (process.env.DEBUG) {
        this.output.writeln();
        this.output.writeln(this.output.dim(error.stack || ''));
      }

      process.exit(1);
    }
  }
}

// =============================================================================
// Module Exports
// =============================================================================

// Types
export * from './types.js';

// Parser
export { CommandParser, commandParser } from './parser.js';

// Output
export { OutputFormatter, output, Progress, Spinner, type VerbosityLevel } from './output.js';

// Prompt
export * from './prompt.js';

// Commands (internal use)
export * from './commands/index.js';

// MCP Server management
export {
  MCPServerManager,
  createMCPServerManager,
  getServerManager,
  startMCPServer,
  stopMCPServer,
  getMCPServerStatus,
  type MCPServerOptions,
  type MCPServerStatus,
} from './mcp-server.js';

// Memory & Intelligence (V3 Performance Features)
export {
  initializeMemoryDatabase,
  repairVectorIndexes,
  recoverMemoryDatabase,
  generateEmbedding,
  generateBatchEmbeddings,
  storeEntry,
  searchEntries,
  getHNSWIndex,
  addToHNSWIndex,
  searchHNSWIndex,
  getHNSWStatus,
  clearHNSWIndex,
  quantizeInt8,
  dequantizeInt8,
  quantizedCosineSim,
  getQuantizationStats,
  // Flash Attention-style batch operations
  batchCosineSim,
  softmaxAttention,
  topKIndices,
  flashAttentionSearch,
  type MemoryInitResult,
} from './memory/memory-initializer.js';

export {
  initializeIntelligence,
  recordStep,
  recordTrajectory,
  findSimilarPatterns,
  getIntelligenceStats,
  getSonaCoordinator,
  getReasoningBank,
  clearIntelligence,
  benchmarkAdaptation,
  // RL loop API
  endTrajectoryWithVerdict,
  distillLearning,
  // Pattern persistence API
  getAllPatterns,
  getPatternsByType,
  flushPatterns,
  deletePattern,
  clearAllPatterns,
  getNeuralDataDir,
  getPersistenceStatus,
  type SonaConfig,
  type TrajectoryStep,
  type Pattern,
  type IntelligenceStats,
} from './memory/intelligence.js';

// EWC++ Consolidation (Prevents Catastrophic Forgetting)
export {
  EWCConsolidator,
  getEWCConsolidator,
  resetEWCConsolidator,
  consolidatePatterns,
  recordPatternOutcome,
  getEWCStats,
  type PatternWeights,
  type EWCConfig,
  type ConsolidationResult,
  type EWCStats,
} from './memory/ewc-consolidation.js';

// SONA Optimizer (Adaptive Routing via Trajectory Learning)
export {
  SONAOptimizer,
  getSONAOptimizer,
  resetSONAOptimizer,
  processTrajectory,
  getSuggestion,
  getSONAStats,
  type TrajectoryOutcome,
  type LearnedPattern,
  type RoutingSuggestion,
  type SONAStats,
} from './memory/sona-optimizer.js';

// Production Hardening
export {
  ErrorHandler,
  withErrorHandling,
} from './production/error-handler.js';
export type {
  ErrorContext,
  ErrorHandlerConfig,
} from './production/error-handler.js';

export {
  RateLimiter,
  createRateLimiter,
} from './production/rate-limiter.js';
export type {
  RateLimiterConfig,
  RateLimitResult,
} from './production/rate-limiter.js';

export {
  withRetry,
  makeRetryable,
} from './production/retry.js';
export type {
  RetryConfig,
  RetryResult,
  RetryStrategy,
} from './production/retry.js';

export {
  CircuitBreaker,
  getCircuitBreaker,
  getAllCircuitStats,
  resetAllCircuits,
} from './production/circuit-breaker.js';
export type {
  CircuitBreakerConfig,
  CircuitState,
} from './production/circuit-breaker.js';

export {
  MonitoringHooks,
  createMonitor,
  getMonitor,
} from './production/monitoring.js';
export type {
  MonitorConfig,
  MetricEvent,
  HealthStatus,
  PerformanceMetrics,
} from './production/monitoring.js';

// Default export
export default CLI;
