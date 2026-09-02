/**
 * V3 CLI Command Parser
 * Advanced argument parsing with validation and type coercion
 */

import { getCommandAsync } from './index.js';
import type { Command, CommandOption, ParsedFlags, CommandContext, V3Config } from './types.js';

export interface ParseResult {
  command: string[];
  flags: ParsedFlags;
  positional: string[];
  raw: string[];
}

export interface ParserOptions {
  stopAtFirstNonFlag?: boolean;
  allowUnknownFlags?: boolean;
  booleanFlags?: string[];
  stringFlags?: string[];
  arrayFlags?: string[];
  aliases?: Record<string, string>;
  defaults?: Record<string, unknown>;
}

export class CommandParser {
  private options: ParserOptions;
  private commands: Map<string, Command> = new Map();
  private lazyCommandNames: Set<string> = new Set();
  private globalOptions: CommandOption[] = [];

  constructor(options: ParserOptions = {}) {
    this.options = {
      stopAtFirstNonFlag: false,
      allowUnknownFlags: false,
      ...options
    };

    this.initializeGlobalOptions();
  }

  private initializeGlobalOptions(): void {
    this.globalOptions = [
      {
        name: 'help',
        short: 'h',
        description: 'Show help information',
        type: 'boolean',
        default: false
      },
      {
        name: 'version',
        short: 'V',
        description: 'Show version number',
        type: 'boolean',
        default: false
      },
      {
        name: 'verbose',
        short: 'v',
        description: 'Enable verbose output',
        type: 'boolean',
        default: false
      },
      {
        name: 'quiet',
        short: 'Q',
        description: 'Suppress non-essential output',
        type: 'boolean',
        default: false
      },
      {
        name: 'config',
        short: 'c',
        description: 'Path to configuration file',
        type: 'string'
      },
      {
        name: 'format',
        // Note: removed global short flag 'f' — it collides with 50+ subcommand
        // flags (force, follow, file, feature, full) causing unpredictable behavior
        // depending on parser resolution order (#1425). Use --format instead.
        description: 'Output format (text, json, table)',
        type: 'string',
        default: 'text',
        choices: ['text', 'json', 'table']
      },
      {
        name: 'no-color',
        description: 'Disable colored output',
        type: 'boolean',
        default: false
      },
      {
        name: 'interactive',
        short: 'i',
        description: 'Enable interactive mode',
        type: 'boolean',
        default: true
      }
    ];
  }

  registerCommand(command: Command): void {
    this.commands.set(command.name, command);
    if (command.aliases) {
      for (const alias of command.aliases) {
        this.commands.set(alias, command);
      }
    }
  }

  /**
   * Register a lazy-loaded command's name so Pass 1/Pass 2 can recognize it as
   * a command position even though its full definition hasn't been loaded yet.
   * Fix for #1596: without this, lazy commands like `daemon start` were
   * mis-routed because Pass 1 walked past `daemon` and greedy-matched `start`.
   */
  registerLazyCommandName(name: string): void {
    this.lazyCommandNames.add(name);
  }

  /**
   * #1791.2 — true when `name` is a lazy command that hasn't been promoted
   * to a fully registered Command yet. The CLI uses this to eagerly load
   * the module before parsing so its subcommand flags (e.g. `-d` for
   * `hive-mind task --description`) are scoped into the alias map. Without
   * this, lazy commands' short flags silently fall through to global
   * resolution and the action handler sees an empty `flags.description`.
   */
  isLazyOnly(name: string): boolean {
    return this.lazyCommandNames.has(name) && !this.commands.has(name);
  }

  private isKnownCommandName(name: string): boolean {
    return this.commands.has(name) || this.lazyCommandNames.has(name);
  }

  getCommand(name: string): Command | undefined {
    return this.commands.get(name);
  }

  getAllCommands(): Command[] {
    // Return unique commands (filter out aliases)
    const seen = new Set<Command>();
    return Array.from(this.commands.values()).filter(cmd => {
      if (seen.has(cmd)) return false;
      seen.add(cmd);
      return true;
    });
  }

  async parse(args: string[]): Promise<ParseResult> {
    const result: ParseResult = {
      command: [],
      flags: { _: [] },
      positional: [],
      raw: [...args]
    };

    // Pass 1: Identify command and subcommand (skip flags).
    // Fix for #1596: the first non-flag positional is ALWAYS the command slot.
    // If it's a known command (sync or lazy) we resolve it; otherwise we stop
    // searching — we MUST NOT walk past it and greedy-match a later arg as the
    // command, because that's what caused `daemon start` to resolve as `start`
    // with `daemon` left as a positional.
    let resolvedCmd: Command | undefined;
    let resolvedSub: Command | undefined;
    let sawFirstPositional = false;
    for (const arg of args) {
      if (arg.startsWith('-')) continue;
      if (!sawFirstPositional) {
        sawFirstPositional = true;
        if (this.commands.has(arg)) {
          resolvedCmd = this.commands.get(arg);
          continue;
        }
        // Lazy command: we know its name but not its subcommands. Stop the
        // walk here — we'll rely on Pass 2 to push it onto commandPath.
        if (this.lazyCommandNames.has(arg)) {
            resolvedCmd = await getCommandAsync(arg);
            break;
        }
        // Unknown first positional — not a command. Stop walking.
        break;
      }
      if (resolvedCmd && !resolvedSub && resolvedCmd.subcommands) {
        resolvedSub = resolvedCmd.subcommands.find(sc => sc.name === arg || sc.aliases?.includes(arg));
      }
    }

    // Pass 2: Build aliases scoped to the resolved subcommand
    // Subcommand-specific aliases take priority over global ones
    const aliases = this.buildScopedAliases(resolvedSub || resolvedCmd);
    const booleanFlags = this.getScopedBooleanFlags(resolvedSub || resolvedCmd);

    let i = 0;
    let parsingFlags = true;

    while (i < args.length) {
      const arg = args[i];

      // Check for end of flags marker
      if (arg === '--') {
        parsingFlags = false;
        i++;
        continue;
      }

      // Handle flags
      if (parsingFlags && arg.startsWith('-')) {
        const parseResult = this.parseFlag(args, i, aliases, booleanFlags);

        // Apply to result flags
        Object.assign(result.flags, parseResult.flags);
        i = parseResult.nextIndex;
        continue;
      }

      // Handle positional arguments.
      // Fix for #1596: treat lazy command names as commands here too so that
      // downstream dispatch sees `commandPath = ['daemon', 'start']` instead of
      // `commandPath = ['start'], positional = ['daemon']`.
      if (result.command.length === 0 && this.isKnownCommandName(arg)) {
        // This is a command
        result.command.push(arg);

        // Check for subcommand (level 1) — only possible for sync commands
        // whose subcommand definitions are already loaded.
        const cmd = this.commands.get(arg);
        if (cmd?.subcommands && i + 1 < args.length) {
          const nextArg = args[i + 1];
          const subCmd = cmd.subcommands.find(sc => sc.name === nextArg || sc.aliases?.includes(nextArg));
          if (subCmd) {
            result.command.push(nextArg);
            i++;

            // Check for nested subcommand (level 2)
            if (subCmd.subcommands && i + 1 < args.length) {
              const nestedArg = args[i + 1];
              const nestedCmd = subCmd.subcommands.find(sc => sc.name === nestedArg || sc.aliases?.includes(nestedArg));
              if (nestedCmd) {
                result.command.push(nestedArg);
                i++;

                // Check for deeply nested subcommand (level 3)
                if (nestedCmd.subcommands && i + 1 < args.length) {
                  const deepArg = args[i + 1];
                  const deepCmd = nestedCmd.subcommands.find(sc => sc.name === deepArg || sc.aliases?.includes(deepArg));
                  if (deepCmd) {
                    result.command.push(deepArg);
                    i++;
                  }
                }
              }
            }
          }
        }
      } else {
        // Positional argument
        result.positional.push(arg);
        result.flags._.push(arg);
      }

      i++;
    }

    // Apply defaults (globals + resolved command/subcommand — #2775 follow-up).
    // Previously only globals were walked, so any subcommand-declared
    // `default: true` silently dropped and reached the action handler as
    // `undefined`. That trapped `memory store --upsert` and every other
    // subcommand that leaned on a per-flag default.
    this.applyDefaults(result.flags, resolvedCmd, resolvedSub);

    return result;
  }

  private parseFlag(
    args: string[],
    index: number,
    aliases: Record<string, string>,
    booleanFlags: Set<string>
  ): { flags: ParsedFlags; nextIndex: number } {
    const flags: ParsedFlags = { _: [] };
    const arg = args[index];
    let nextIndex = index + 1;

    if (arg.startsWith('--')) {
      // Long flag
      const equalIndex = arg.indexOf('=');

      if (equalIndex !== -1) {
        // --flag=value
        const key = arg.slice(2, equalIndex);
        const value = arg.slice(equalIndex + 1);
        flags[this.normalizeKey(key)] = this.parseValue(value);
      } else if (arg.startsWith('--no-')) {
        // --no-flag (boolean negation)
        const key = arg.slice(5);
        flags[this.normalizeKey(key)] = false;
      } else {
        const key = arg.slice(2);
        const normalizedKey = this.normalizeKey(key);

        if (booleanFlags.has(normalizedKey)) {
          // #explore-flag: allow an explicit boolean value (`--explore false`,
          // `--explore true`). Without this, a default-true boolean could never
          // be disabled via the space form — the value was dropped and the flag
          // forced to true. The `=` form already worked via parseValue.
          if (nextIndex < args.length && this.isBooleanLiteral(args[nextIndex])) {
            flags[normalizedKey] = args[nextIndex].toLowerCase() === 'true';
            nextIndex++;
          } else {
            flags[normalizedKey] = true;
          }
        } else if (nextIndex < args.length && this.isFlagValue(args[nextIndex])) {
          flags[normalizedKey] = this.parseValue(args[nextIndex]);
          nextIndex++;
        } else {
          flags[normalizedKey] = true;
        }
      }
    } else if (arg.startsWith('-')) {
      // Short flag(s)
      const chars = arg.slice(1);

      if (chars.length === 1) {
        // Single short flag
        const key = aliases[chars] || chars;
        const normalizedKey = this.normalizeKey(key);

        if (booleanFlags.has(normalizedKey)) {
          // #explore-flag: short boolean flags also accept an explicit value
          // (`-e false`) so a default-true boolean can be turned off.
          if (nextIndex < args.length && this.isBooleanLiteral(args[nextIndex])) {
            flags[normalizedKey] = args[nextIndex].toLowerCase() === 'true';
            nextIndex++;
          } else {
            flags[normalizedKey] = true;
          }
        } else if (nextIndex < args.length && this.isFlagValue(args[nextIndex])) {
          flags[normalizedKey] = this.parseValue(args[nextIndex]);
          nextIndex++;
        } else {
          flags[normalizedKey] = true;
        }
      } else {
        // Multiple short flags combined (e.g., -abc)
        for (const char of chars) {
          const key = aliases[char] || char;
          flags[this.normalizeKey(key)] = true;
        }
      }
    }

    return { flags, nextIndex };
  }

  /**
   * Decide whether `arg` should be consumed as the VALUE of the preceding flag,
   * rather than treated as the next flag.
   *
   * Bug fix (audit #1, follow-up to #2222): a negative numeric value such as
   * `-1.0` starts with '-', so the old `!arg.startsWith('-')` test rejected it
   * as a value and parsed it as a (bogus) short flag. For `route feedback
   * -r -1.0` this silently dropped the value and coerced reward to `true` → 1.0,
   * so NEGATIVE feedback REINFORCED the agent. Only `--reward=-1.0` worked.
   *
   * Anything not starting with '-' is a value (unchanged). Anything that starts
   * with '-' is a value ONLY if it is a pure negative number (e.g. `-1`, `-1.0`,
   * `-3.14`, `-1e3`). Real flags like `-r`, `--reward`, `-abc` are never numeric
   * after the leading dash, so they are still correctly treated as flags.
   */
  private isFlagValue(arg: string): boolean {
    if (!arg.startsWith('-')) return true;
    // Negative number: '-' followed by a parseable numeric literal.
    return /^-\d*\.?\d+(?:[eE][+-]?\d+)?$/.test(arg);
  }

  /** True for the literal tokens `true`/`false` (case-insensitive). Used so a
   * boolean flag can take an explicit value in the space form, e.g.
   * `--explore false` / `-e true`. */
  private isBooleanLiteral(arg: string): boolean {
    const a = arg.toLowerCase();
    return a === 'true' || a === 'false';
  }

  private parseValue(value: string): string | number | boolean {
    // Boolean
    if (value.toLowerCase() === 'true') return true;
    if (value.toLowerCase() === 'false') return false;

    // Number
    const num = Number(value);
    if (!isNaN(num) && value.trim() !== '') return num;

    // String
    return value;
  }

  private normalizeKey(key: string): string {
    // Convert kebab-case to camelCase
    return key.replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
  }

  private buildAliases(): Record<string, string> {
    const aliases: Record<string, string> = {};

    for (const opt of this.globalOptions) {
      if (opt.short) {
        aliases[opt.short] = opt.name;
      }
    }

    // Add aliases from all commands and subcommands
    for (const cmd of this.commands.values()) {
      if (cmd.options) {
        for (const opt of cmd.options) {
          if (opt.short) {
            aliases[opt.short] = opt.name;
          }
        }
      }
      // Also include subcommands' options
      if (cmd.subcommands) {
        for (const sub of cmd.subcommands) {
          if (sub.options) {
            for (const opt of sub.options) {
              if (opt.short) {
                aliases[opt.short] = opt.name;
              }
            }
          }
        }
      }
    }

    return { ...aliases, ...this.options.aliases };
  }

  /**
   * Build aliases scoped to a specific command/subcommand.
   * The resolved command's short flags take priority over global ones,
   * fixing collisions where multiple subcommands use the same short flag (e.g. -t).
   */
  private buildScopedAliases(resolvedCmd?: Command): Record<string, string> {
    // Start with global aliases as base
    const aliases = this.buildAliases();

    // Override with the resolved command's own options (these take priority)
    if (resolvedCmd?.options) {
      for (const opt of resolvedCmd.options) {
        if (opt.short) {
          aliases[opt.short] = opt.name;
        }
      }
    }

    return aliases;
  }

  /**
   * Get boolean flags scoped to a specific command/subcommand.
   *
   * `getBooleanFlags()` walks EVERY command + subcommand in the registry
   * and adds their boolean options into one flat set. That's convenient
   * for the common case but causes cross-subcommand pollution: if `swarm
   * start --parallel` is boolean AND `hooks route --parallel` is numeric,
   * the flat set marks `parallel` as boolean, and `hooks route --parallel 7`
   * drops the `7` as a positional (parseFlag treats booleanFlags-hit as
   * "consume no value"). This is the exact bug that forced the
   * --moa-parallel rename in the 2026-07-26 dream-cycle #2778 fix.
   *
   * Fix: if the resolved subcommand declares the flag as a non-boolean
   * type, REMOVE it from the boolean set. Narrowest scope wins.
   * (Documented via in-tree comment in commands/hooks.ts and the #2778
   * commit message.)
   */
  private getScopedBooleanFlags(resolvedCmd?: Command): Set<string> {
    const flags = this.getBooleanFlags();

    if (resolvedCmd?.options) {
      for (const opt of resolvedCmd.options) {
        const key = this.normalizeKey(opt.name);
        if (opt.type === 'boolean') {
          flags.add(key);
        } else if (opt.type) {
          // Subcommand explicitly re-declares this flag as a non-boolean
          // type (string/number/array) — narrowest scope wins, so drop
          // it from the boolean set to override any global pollution.
          flags.delete(key);
        }
      }
    }

    return flags;
  }

  private getBooleanFlags(): Set<string> {
    const flags = new Set<string>();

    for (const opt of this.globalOptions) {
      if (opt.type === 'boolean') {
        flags.add(this.normalizeKey(opt.name));
      }
    }

    // Add boolean flags from all commands and subcommands
    for (const cmd of this.commands.values()) {
      if (cmd.options) {
        for (const opt of cmd.options) {
          if (opt.type === 'boolean') {
            flags.add(this.normalizeKey(opt.name));
          }
        }
      }
      // Also include subcommands' boolean flags
      if (cmd.subcommands) {
        for (const sub of cmd.subcommands) {
          if (sub.options) {
            for (const opt of sub.options) {
              if (opt.type === 'boolean') {
                flags.add(this.normalizeKey(opt.name));
              }
            }
          }
        }
      }
    }

    if (this.options.booleanFlags) {
      for (const flag of this.options.booleanFlags) {
        flags.add(this.normalizeKey(flag));
      }
    }

    return flags;
  }

  private applyDefaults(flags: ParsedFlags, command?: Command, subcommand?: Command): void {
    // #2775: apply defaults from globals AND the resolved command/subcommand.
    // Subcommand > command > global (later writes lose to earlier — because
    // we only set when `undefined`, so the FIRST option definition that
    // supplies a default wins; walk narrow-to-broad so subcommand options
    // apply before broader ones do).
    const layers: CommandOption[][] = [];
    if (subcommand?.options) layers.push(subcommand.options);
    if (command?.options) layers.push(command.options);
    layers.push(this.globalOptions);

    for (const layer of layers) {
      for (const opt of layer) {
        const key = this.normalizeKey(opt.name);
        if (flags[key] === undefined && opt.default !== undefined) {
          flags[key] = opt.default as string | boolean | number | string[];
        }
      }
    }

    // Apply custom defaults (lowest precedence)
    if (this.options.defaults) {
      for (const [key, value] of Object.entries(this.options.defaults)) {
        const normalizedKey = this.normalizeKey(key);
        if (flags[normalizedKey] === undefined) {
          flags[normalizedKey] = value as string | boolean | number | string[];
        }
      }
    }
  }

  validateFlags(flags: ParsedFlags, command?: Command): string[] {
    const errors: string[] = [];
    const allOptions = [...this.globalOptions];

    if (command?.options) {
      allOptions.push(...command.options);
    }

    // Check required flags
    for (const opt of allOptions) {
      const key = this.normalizeKey(opt.name);

      if (opt.required && (flags[key] === undefined || flags[key] === '')) {
        errors.push(`Required option missing: --${opt.name}`);
      }

      // Check choices
      if (opt.choices && flags[key] !== undefined) {
        const value = String(flags[key]);
        if (!opt.choices.includes(value)) {
          errors.push(`Invalid value for --${opt.name}: ${value}. Must be one of: ${opt.choices.join(', ')}`);
        }
      }

      // Run custom validator
      if (opt.validate && flags[key] !== undefined) {
        const result = opt.validate(flags[key]);
        if (result !== true) {
          errors.push(typeof result === 'string' ? result : `Invalid value for --${opt.name}`);
        }
      }
    }

    // Check for unknown flags if not allowed
    if (!this.options.allowUnknownFlags) {
      const knownFlags = new Set(allOptions.map(opt => this.normalizeKey(opt.name)));
      knownFlags.add('_'); // Positional args

      for (const key of Object.keys(flags)) {
        if (!knownFlags.has(key) && key !== '_') {
          errors.push(`Unknown option: --${key}`);
        }
      }
    }

    return errors;
  }

  getGlobalOptions(): CommandOption[] {
    return [...this.globalOptions];
  }
}

// Export singleton parser instance
export const commandParser = new CommandParser({ allowUnknownFlags: true });
