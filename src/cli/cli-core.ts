#!/usr/bin/env node
/**
 * Claude-Flow CLI - Core implementation using Node.js
 */

import chalk from "chalk";
import fs from "fs-extra";
import path from "path";

export const VERSION = "1.0.43";

interface CommandContext {
  args: string[];
  flags: Record<string, unknown>;
  config?: Record<string, unknown> | undefined;
}

interface Command {
  name: string;
  description: string;
  aliases?: string[];
  subcommands?: Command[];
  action?: (ctx: CommandContext) => Promise<void> | void;
  options?: Option[];
}

interface Option {
  name: string;
  short?: string;
  description: string;
  type?: "string" | "boolean" | "number";
  default?: unknown;
  required?: boolean;
}

class CLI {
  private commands: Map<string, Command> = new Map();
  private globalOptions: Option[] = [
    {
      name: "help",
      short: "h",
      description: "Show help",
      type: "boolean",
    },
    {
      name: "version",
      short: "v",
      description: "Show version",
      type: "boolean",
    },
    {
      name: "config",
      short: "c",
      description: "Path to configuration file",
      type: "string",
    },
    {
      name: "verbose",
      description: "Enable verbose logging",
      type: "boolean",
    },
    {
      name: "log-level",
      description: "Set log level (debug, info, warn, error)",
      type: "string",
      default: "info",
    },
  ];

  constructor(private name: string, private description: string) {}

  command(cmd: Command): this {
    this.commands.set(cmd.name, cmd);
    if (cmd.aliases) {
      for (const alias of cmd.aliases) {
        this.commands.set(alias, cmd);
      }
    }
    return this;
  }

  async run(args = process.argv.slice(2)): Promise<void> {
    // Parse arguments manually since we're replacing the Deno parse function
    const flags = this.parseArgs(args);

    if (flags.version || flags.v) {
      console.log(`${this.name} v${VERSION}`);
      return;
    }

    const commandName = flags._[0]?.toString() || "";
    
    if (!commandName || flags.help || flags.h) {
      this.showHelp();
      return;
    }

    const command = this.commands.get(commandName);
    if (!command) {
      console.error(chalk.red(`Unknown command: ${commandName}`));
      console.log(`Run "${this.name} help" for available commands`);
      process.exit(1);
    }

    const ctx: CommandContext = {
      args: flags._.slice(1).map(String),
      flags: flags as Record<string, unknown>,
      config: await this.loadConfig(flags.config as string),
    };

    try {
      if (command.action) {
        await command.action(ctx);
      } else {
        console.log(chalk.yellow(`Command '${commandName}' has no action defined`));
      }
    } catch (error) {
      console.error(chalk.red(`Error executing command '${commandName}':`), (error as Error).message);
      if (flags.verbose) {
        console.error(error);
      }
      process.exit(1);
    }
  }

  private parseArgs(args: string[]): Record<string, any> {
    const result: Record<string, any> = { _: [] };
    let i = 0;

    while (i < args.length) {
      const arg = args[i];
      
      if (arg.startsWith('--')) {
        const key = arg.slice(2);
        if (i + 1 < args.length && !args[i + 1].startsWith('-')) {
          result[key] = args[i + 1];
          i += 2;
        } else {
          result[key] = true;
          i++;
        }
      } else if (arg.startsWith('-')) {
        const key = arg.slice(1);
        if (i + 1 < args.length && !args[i + 1].startsWith('-')) {
          result[key] = args[i + 1];
          i += 2;
        } else {
          result[key] = true;
          i++;
        }
      } else {
        result._.push(arg);
        i++;
      }
    }

    return result;
  }

  private async loadConfig(configPath?: string): Promise<Record<string, unknown> | undefined> {
    const configFile = configPath || "claude-flow.config.json";
    try {
      const content = await fs.readFile(configFile, 'utf8');
      return JSON.parse(content);
    } catch {
      return undefined;
    }
  }

  private getBooleanFlags(): string[] {
    const flags: string[] = [];
    for (const opt of [...this.globalOptions, ...this.getAllOptions()]) {
      if (opt.type === "boolean") {
        flags.push(opt.name);
        if (opt.short) flags.push(opt.short);
      }
    }
    return flags;
  }

  private getStringFlags(): string[] {
    const flags: string[] = [];
    for (const opt of [...this.globalOptions, ...this.getAllOptions()]) {
      if (opt.type === "string" || opt.type === "number") {
        flags.push(opt.name);
        if (opt.short) flags.push(opt.short);
      }
    }
    return flags;
  }

  private getAliases(): Record<string, string> {
    const aliases: Record<string, string> = {};
    for (const opt of [...this.globalOptions, ...this.getAllOptions()]) {
      if (opt.short) {
        aliases[opt.short] = opt.name;
      }
    }
    return aliases;
  }

  private getDefaults(): Record<string, unknown> {
    const defaults: Record<string, unknown> = {};
    for (const opt of [...this.globalOptions, ...this.getAllOptions()]) {
      if (opt.default !== undefined) {
        defaults[opt.name] = opt.default;
      }
    }
    return defaults;
  }

  private getAllOptions(): Option[] {
    const options: Option[] = [];
    for (const cmd of this.commands.values()) {
      if (cmd.options) {
        options.push(...cmd.options);
      }
    }
    return options;
  }

  private showHelp(): void {
    console.log(`
${chalk.bold(chalk.blue(`🧠 ${this.name} v${VERSION}`))} - ${this.description}

${chalk.bold("USAGE:")}
  ${this.name} [COMMAND] [OPTIONS]

${chalk.bold("COMMANDS:")}
${this.formatCommands()}

${chalk.bold("GLOBAL OPTIONS:")}
${this.formatOptions(this.globalOptions)}

${chalk.bold("EXAMPLES:")}
  ${this.name} start                                    # Start orchestrator
  ${this.name} agent spawn researcher --name "Bot"     # Spawn research agent
  ${this.name} task create research "Analyze data"     # Create task
  ${this.name} config init                             # Initialize config
  ${this.name} status                                  # Show system status

For more detailed help on specific commands, use:
  ${this.name} [COMMAND] --help

Documentation: https://github.com/ruvnet/claude-code-flow
Issues: https://github.com/ruvnet/claude-code-flow/issues

Created by rUv - Built with ❤️ for the Claude community
`);
  }

  private formatCommands(): string {
    const commands = Array.from(new Set(this.commands.values()));
    return commands
      .map(cmd => `  ${cmd.name.padEnd(20)} ${cmd.description}`)
      .join("\n");
  }

  private formatOptions(options: Option[]): string {
    return options
      .map(opt => {
        const flags = opt.short ? `-${opt.short}, --${opt.name}` : `    --${opt.name}`;
        return `  ${flags.padEnd(25)} ${opt.description}`;
      })
      .join("\n");
  }
}

// Helper functions
function success(message: string): void {
  console.log(chalk.green(`✅ ${message}`));
}

function error(message: string): void {
  console.error(chalk.red(`❌ ${message}`));
}

function warning(message: string): void {
  console.warn(chalk.yellow(`⚠️  ${message}`));
}

function info(message: string): void {
  console.log(chalk.blue(`ℹ️  ${message}`));
}

// Export for use in other modules
export { CLI, success, error, warning, info };
export type { Command, CommandContext, Option };

// Main CLI setup if running directly
async function main() {
  if (process.argv[1] && (process.argv[1].endsWith('cli-core.js') || process.argv[1].endsWith('cli-core.ts'))) {
    const cli = new CLI("claude-flow", "Advanced AI Agent Orchestration System");

    // Import and register all commands
    const { setupCommands } = await import("./commands/index.js");
    setupCommands(cli);

    // Run the CLI
    await cli.run();
  }
}

// Execute main if this is the entry point
main().catch(console.error);