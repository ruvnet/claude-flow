/**
 * V3 CLI Command Parser
 * Advanced argument parsing with validation and type coercion
 */

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
        short: 'f',
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

  parse(args: string[]): ParseResult {
    const result: ParseResult = {
      command: [],
      flags: { _: [] },
      positional: [],
      raw: [...args]
    };

    // Build flag configuration from global options
    const aliases = this.buildAliases();
    const booleanFlags = this.getBooleanFlags();

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

      // Handle positional arguments
      if (result.command.length === 0 && this.commands.has(arg)) {
        // This is a command
        result.command.push(arg);

        // Check for subcommand (level 1)
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

    // Apply defaults
    this.applyDefaults(result.flags);

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
          flags[normalizedKey] = true;
        } else if (nextIndex < args.length && !args[nextIndex].startsWith('-')) {
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
          flags[normalizedKey] = true;
        } else if (nextIndex < args.length && !args[nextIndex].startsWith('-')) {
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

  private applyDefaults(flags: ParsedFlags): void {
    // Apply global option defaults
    for (const opt of this.globalOptions) {
      const key = this.normalizeKey(opt.name);
      if (flags[key] === undefined && opt.default !== undefined) {
        flags[key] = opt.default as string | boolean | number | string[];
      }
    }

    // Apply custom defaults
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
