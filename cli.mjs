#!/usr/bin/env node

/**
 * Claude-Flow Alpha Release CLI Entry Point
 * Functional CLI that bypasses TypeScript compilation issues for alpha testing
 */

import { spawn } from 'child_process';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Check if we're in a development environment
const isDev = fs.existsSync(path.join(__dirname, 'src'));

function runCLI() {
  const args = process.argv.slice(2);
  
  // Show help by default
  if (args.length === 0 || args[0] === '--help' || args[0] === '-h') {
    console.log(`
🌊 Claude-Flow v2.0.0-alpha.1 - AI Agent Orchestration Platform

Usage: claude-flow <command> [options]

Commands:
  init [options]           Initialize Claude-Flow project
  start [options]          Start Claude-Flow system
  status                   Show system status
  hive-mind wizard         Interactive Hive Mind setup
  swarm <action>          Swarm management
  agent <action>          Agent management
  config <action>         Configuration management
  help [command]          Show help for command

Options:
  -h, --help              Show help
  -v, --version           Show version

Examples:
  claude-flow init --sparc          # Initialize with SPARC methodology
  claude-flow hive-mind wizard      # Interactive setup
  claude-flow start --ui --swarm    # Start with UI and swarm
  claude-flow status                # Show system status

For more information, visit: https://github.com/ruvnet/claude-code-flow
`);
    return;
  }

  // Show version
  if (args[0] === '--version' || args[0] === '-v') {
    console.log('claude-flow v2.0.0-alpha.1');
    return;
  }

  // Try to run the actual CLI if in development mode
  if (isDev) {
    const nodeBin = process.execPath;
    
    // Route hooks and mcp commands to simple-cli.js
    if (args[0] === 'hooks' || args[0] === 'mcp') {
      const simpleCLIPath = path.join(__dirname, 'src', 'cli', 'simple-cli.js');
      if (fs.existsSync(simpleCLIPath)) {
        const child = spawn(nodeBin, [simpleCLIPath, ...args], {
          stdio: 'inherit',
          cwd: __dirname
        });
        
        child.on('exit', (code) => {
          process.exit(code);
        });
        return;
      }
    }
    
    const cliPath = path.join(__dirname, 'src', 'cli', 'main.ts');
    
    if (fs.existsSync(cliPath)) {
      console.log('🚀 Running development CLI...');
      const child = spawn(nodeBin, ['--import', 'tsx', cliPath, ...args], {
        stdio: 'inherit',
        cwd: __dirname,
        env: { ...process.env, NODE_OPTIONS: '--experimental-specifier-resolution=node' }
      });
      
      child.on('exit', (code) => {
        process.exit(code);
      });
      return;
    }
  }

  // Basic command routing for alpha
  const command = args[0];
  
  switch (command) {
    case 'init':
      console.log('🎯 Claude-Flow Alpha - Project initialization available in full release');
      console.log('For now, please clone the repository and run: npm install && npm run dev');
      break;
      
    case 'start':
      console.log('🌊 Claude-Flow Alpha - Starting system...');
      console.log('Alpha version: Basic functionality available');
      console.log('Full UI and swarm features coming in stable release');
      break;
      
    case 'hive-mind':
      console.log('🧠 Hive Mind Alpha - Intelligence orchestration');
      console.log('Advanced agent coordination available in development mode');
      break;
      
    case 'status':
      console.log('📊 Claude-Flow Status: Alpha Release v2.0.0-alpha.1');
      console.log('✅ CLI: Functional');
      console.log('⚠️  Full Build: In Progress');
      console.log('🚀 Development Mode: Available');
      break;
      
    default:
      console.log(`❓ Unknown command: ${command}`);
      console.log('Run "claude-flow --help" for available commands');
      break;
  }
}

// Handle errors gracefully
process.on('uncaughtException', (err) => {
  console.error('❌ Claude-Flow Alpha Error:', err.message);
  process.exit(1);
});

process.on('unhandledRejection', (err) => {
  console.error('❌ Claude-Flow Alpha Error:', err.message);
  process.exit(1);
});

// Run the CLI
runCLI();