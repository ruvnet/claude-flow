#!/usr/bin/env -S deno run --allow-all
/**
 * Claude-Flow CLI entry point - Remote execution friendly version
 * This version can be run directly from GitHub
 */

import { VERSION } from '../core/version.js';

// Simple color functions
const chalk = {
  red: (text: string) => `\x1b[31m${text}\x1b[0m`,
  green: (text: string) => `\x1b[32m${text}\x1b[0m`,
  yellow: (text: string) => `\x1b[33m${text}\x1b[0m`,
  blue: (text: string) => `\x1b[34m${text}\x1b[0m`,
  gray: (text: string) => `\x1b[90m${text}\x1b[0m`,
  bold: (text: string) => `\x1b[1m${text}\x1b[0m`,
};

function printHelp() {
  console.log(`
🧠 Claude-Flow v${VERSION} - Advanced AI Agent Orchestration System

USAGE:
  claude-flow [COMMAND] [OPTIONS]

COMMANDS:
  init                  Initialize Claude Code integration files
  start                 Start the orchestration system
  agent                 Manage agents (spawn, list, terminate, info)
  task                  Manage tasks (create, list, status, cancel, workflow)
  memory               Manage memory (query, export, import, stats, cleanup)
  mcp                  Manage MCP server (status, tools, start, stop)
  config               Manage configuration (show, get, set, init, validate)
  status               Show system status
  monitor              Monitor system in real-time
  session              Manage terminal sessions
  workflow             Execute workflow files
  claude               Spawn Claude instances with specific configurations
  version              Show version information
  help                 Show this help message

OPTIONS:
  -c, --config <path>   Path to configuration file
  -v, --verbose         Enable verbose logging
  --help                Show help for any command

EXAMPLES:
  claude-flow init                    # Initialize Claude Code integration
  claude-flow start                   # Start orchestration system
  claude-flow agent spawn researcher  # Spawn a research agent
  claude-flow task create research "Analyze authentication patterns"
  claude-flow memory store key "value"
  claude-flow status                  # Check system status

For more info: https://github.com/ruvnet/claude-code-flow
`);
}

function printSuccess(message: string) {
  console.log(chalk.green('✅ ' + message));
}

function printError(message: string) {
  console.log(chalk.red('❌ ' + message));
}

function printWarning(message: string) {
  console.log(chalk.yellow('⚠️  ' + message));
}

async function main() {
  const args = Deno.args;
  const command = args[0] || 'help';
  const subArgs = args.slice(1);

  switch (command) {
    case '--help':
    case '-h':
    case 'help':
      printHelp();
      break;

    case '--version':
    case '-v':
    case 'version':
      console.log(`Claude-Flow v${VERSION}`);
      break;

    case 'init':
      printSuccess('Initializing Claude Code integration files...');
      console.log('📝 This command would create:');
      console.log('   - CLAUDE.md (Claude Code configuration)');
      console.log('   - memory-bank.md (Memory system documentation)');
      console.log('   - coordination.md (Agent coordination documentation)');
      console.log('   - Memory folder structure');
      console.log('\n💡 To run locally, clone the repo and use:');
      console.log('   git clone https://github.com/ruvnet/claude-code-flow.git');
      console.log('   cd claude-code-flow');
      console.log('   npm install -g claude-flow');
      console.log('   claude-flow init');
      break;

    case 'install':
      console.log(chalk.blue('📦 Installing Claude-Flow...'));
      console.log('\nRun these commands to install:');
      console.log(chalk.gray('  # Using npm (recommended)'));
      console.log('  npm install -g claude-flow');
      console.log('');
      console.log(chalk.gray('  # Or using Deno'));
      console.log('  deno install --allow-all --name claude-flow \\');
      console.log(
        '    https://raw.githubusercontent.com/ruvnet/claude-code-flow/main/src/cli/index.ts',
      );
      console.log('');
      console.log(chalk.gray('  # Or clone and build from source'));
      console.log('  git clone https://github.com/ruvnet/claude-code-flow.git');
      console.log('  cd claude-code-flow');
      console.log('  deno task build');
      break;

    default:
      printWarning(`Command '${command}' requires local installation.`);
      console.log('\n📥 To use all features, install Claude-Flow:');
      console.log('   npm install -g claude-flow');
      console.log('\n🌐 Or run directly with Deno:');
      console.log('   deno install --allow-all --name claude-flow \\');
      console.log(
        '     https://raw.githubusercontent.com/ruvnet/claude-code-flow/main/src/cli/index.ts',
      );
      console.log('\n📚 Documentation: https://github.com/ruvnet/claude-code-flow');
      console.log('💬 Issues: https://github.com/ruvnet/claude-code-flow/issues');
      break;
  }
}

if (import.meta.url === `file://${Deno.execPath()}`) {
  main().catch((error) => {
    printError(`Error: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  });
}
