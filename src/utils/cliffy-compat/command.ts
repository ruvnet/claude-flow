/**
 * Compatibility layer for @cliffy/command
 * Maps to commander for Node.js compatibility
 */

import { Command as CommanderCommand } from 'commander';

export interface CommandOptions {
  name?: string;
  version?: string;
  description?: string;
  hidden?: boolean;
  stopEarly?: boolean;
}

export interface OptionOptions {
  default?: any;
  required?: boolean;
  global?: boolean;
  hidden?: boolean;
  conflicts?: string[];
  depends?: string[];
  collect?: boolean;
  value?: (value: any, previous?: any) => any;
}

export interface ArgumentOptions {
  optional?: boolean;
  variadic?: boolean;
  optionalValue?: boolean;
}

type ActionHandler = (options: any, ...args: any[]) => void | Promise<void>;

export class Command {
  private commander: CommanderCommand;
  private optionConfigs: Map<string, OptionOptions> = new Map();

  constructor(name?: string) {
    this.commander = new CommanderCommand(name);
  }

  // Getter to access underlying commander instance
  getCommander(): CommanderCommand {
    return this.commander;
  }

  name(name: string): this {
    this.commander.name(name);
    return this;
  }

  version(version: string): this {
    this.commander.version(version);
    return this;
  }

  description(desc: string): this {
    this.commander.description(desc);
    return this;
  }

  alias(alias: string): this {
    this.commander.alias(alias);
    return this;
  }

  hidden(hidden: boolean = true): this {
    // Commander doesn't have a direct hidden property
    // This would need to be handled in help generation
    return this;
  }

  option(flags: string, description: string, options?: OptionOptions): this {
    let commanderOption = this.commander.option(flags, description);
    
    if (options) {
      if (options.default !== undefined) {
        commanderOption = this.commander.option(flags, description, options.default);
      }
      this.optionConfigs.set(flags, options);
    }
    
    return this;
  }

  arguments(args: string): this {
    this.commander.arguments(args);
    return this;
  }

  action(handler: ActionHandler): this {
    this.commander.action(async (...args) => {
      // In cliffy, options come first, then arguments
      // In commander, arguments come first, then options
      const options = args[args.length - 1];
      const cmdArgs = args.slice(0, -1);
      await handler(options, ...cmdArgs);
    });
    return this;
  }

  command(name: string, CommandClass?: typeof Command): Command {
    const subCommand = new (CommandClass || Command)(name);
    this.commander.addCommand(subCommand.commander);
    return subCommand;
  }

  stopEarly(stop: boolean = true): this {
    // Commander doesn't have direct stopEarly, would need custom handling
    return this;
  }

  parse(argv?: string[]): this {
    this.commander.parse(argv || process.argv);
    return this;
  }

  async parseAsync(argv?: string[]): Promise<this> {
    await this.commander.parseAsync(argv || process.argv);
    return this;
  }

  help(): string {
    return this.commander.helpInformation();
  }

  showHelp(): void {
    this.commander.outputHelp();
  }

  error(message: string, exit: boolean = true): void {
    if (exit) {
      this.commander.error(message, { exitCode: 1 });
    } else {
      this.commander.error(message, {});
    }
  }

  // Additional cliffy-specific methods
  globalOption(flags: string, description: string, options?: OptionOptions): this {
    return this.option(flags, description, { ...options, global: true });
  }

  env(key: string, description: string, options?: OptionOptions): this {
    // Would need custom implementation for environment variable support
    return this;
  }

  example(example: string, description: string): this {
    // Would need custom implementation for examples
    return this;
  }

  default(name: string): this {
    // Would need custom implementation for default commands
    return this;
  }

  type(name: string, handler: (value: string) => any): this {
    // Would need custom implementation for custom types
    return this;
  }

  complete(name: string, handler: () => string[] | Promise<string[]>): this {
    // Would need custom implementation for completions
    return this;
  }
}

// Additional cliffy command utilities
export class HelpCommand extends Command {
  constructor() {
    super('help');
    this.description('Show this help');
    this.action(() => {
      this.showHelp();
    });
  }
}

export class CompletionsCommand extends Command {
  constructor() {
    super('completions');
    this.description('Generate shell completions');
    this.action(() => {
      console.log('Shell completions not implemented in compatibility layer');
    });
  }
}