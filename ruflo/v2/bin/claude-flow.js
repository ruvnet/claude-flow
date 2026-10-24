#!/usr/bin/env node

/**
 * Claude-Flow Cross-Platform Dispatcher
 * Detects and uses the best available runtime
 */

import { fileURLToPath } from 'url';
import { dirname, join, resolve } from 'path';
import { existsSync, readFileSync } from 'fs';
import { spawn } from 'child_process';
import process from 'process';

// Read version from package.json
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const packageJson = JSON.parse(readFileSync(join(__dirname, '../package.json'), 'utf-8'));
const VERSION = packageJson.version;

// Get root directory
const ROOT_DIR = resolve(__dirname, '..');

// Show help if no arguments provided
const args = process.argv.slice(2);
if (args.length === 0) {
  args.push('--help');
}

// Quick version check
for (const arg of args) {
  if (arg === '--version' || arg === '-v') {
    console.log(`v${VERSION}`);
    process.exit(0);
  }
}

// Try to find the best runtime and execute
async function main() {
  try {
    // Try JavaScript version first (most reliable)
    const jsFile = join(ROOT_DIR, 'src', 'cli', 'simple-cli.js');
    if (existsSync(jsFile)) {
      const child = spawn('node', [jsFile, ...args], {
        stdio: 'inherit',
        shell: false,
        detached: false  // Prevent orphaned processes
      });
      
      // Enhanced process cleanup for all platforms
      const cleanup = () => {
        if (!child.killed) {
          child.kill('SIGTERM');
          setTimeout(() => {
            if (!child.killed) {
              child.kill('SIGKILL');
            }
          }, 5000);
        }
      };
      
      process.on('SIGTERM', cleanup);
      process.on('SIGINT', cleanup);
      process.on('exit', cleanup);
      
      child.on('error', (error) => {
        console.error('❌ Node.js execution failed:', error.message);
        cleanup();
        process.exit(1);
      });
      
      child.on('exit', (code) => {
        process.exit(code || 0);
      });
      
      return;
    }
    
    // Fallback to TypeScript version with tsx
    const tsFile = join(ROOT_DIR, 'src', 'cli', 'simple-cli.ts');
    if (existsSync(tsFile)) {
      const child = spawn('tsx', [tsFile, ...args], {
        stdio: 'inherit',
        shell: false
      });
      
      child.on('error', (error) => {
        console.error('❌ tsx execution failed:', error.message);
        console.log('\n🔄 Trying npx tsx...');
        
        // Try npx tsx as final fallback
        const npxChild = spawn('npx', ['tsx', tsFile, ...args], {
          stdio: 'inherit',
          shell: false
        });
        
        npxChild.on('error', (npxError) => {
          console.error('❌ npx tsx also failed:', npxError.message);
          showFallbackHelp();
          process.exit(1);
        });
        
        npxChild.on('exit', (code) => {
          process.exit(code || 0);
        });
      });
      
      child.on('exit', (code) => {
        process.exit(code || 0);
      });
      
      return;
    }
    
    // No runtime found
    showFallbackHelp();
    process.exit(1);
    
  } catch (error) {
    console.error('❌ Unexpected error:', error.message);
    showFallbackHelp();
    process.exit(1);
  }
}

function showFallbackHelp() {
  console.log(`🧠 Claude-Flow v${VERSION} - Advanced AI Agent Orchestration System`);
  console.log('');
  console.log('⚠️  No compatible runtime found.');
  console.log('');
  console.log('To install and run:');
  console.log('  1. Install tsx: npm install -g tsx');
  console.log('  2. Run: claude-flow <command>');
  console.log('');
  console.log('Or use directly:');
  console.log('  node src/cli/simple-cli.js <command>');
  console.log('');
  console.log('Documentation: https://github.com/ruvnet/claude-code-flow');
}

main();