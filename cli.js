#!/usr/bin/env node

// Node.js entry point for npx compatibility
// This file allows claude-flow to work with: npx claude-flow@latest <command>

import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { existsSync } from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Check if we have the compiled version - Phase 2 Unified CLI
const compiledPath = join(__dirname, 'dist', 'cli', 'main.js');
const sourcePath = join(__dirname, 'src', 'cli', 'main.ts');

// Check which version exists
if (existsSync(compiledPath)) {
  // Use the compiled JavaScript version
  const cliProcess = spawn('node', [compiledPath, ...process.argv.slice(2)], {
    stdio: 'inherit'
  });
  
  cliProcess.on('error', (error) => {
    console.error('❌ Failed to run claude-flow:', error.message);
    process.exit(1);
  });
  
  cliProcess.on('exit', (code) => {
    process.exit(code || 0);
  });
} else if (existsSync(sourcePath)) {
  // Run TypeScript version with tsx
  console.log('📦 Running TypeScript version...');
  
  const tsxProcess = spawn('npx', ['tsx', sourcePath, ...process.argv.slice(2)], {
    stdio: 'inherit',
    shell: true
  });
  
  tsxProcess.on('error', (error) => {
    console.error('❌ Failed to run claude-flow:', error.message);
    console.log('\n💡 Try installing globally: npm install -g claude-flow');
    process.exit(1);
  });
  
  tsxProcess.on('exit', (code) => {
    process.exit(code || 0);
  });
} else {
  console.error('❌ Error: Could not find claude-flow implementation files');
  console.error('Expected either:');
  console.error(`  - ${compiledPath}`);
  console.error(`  - ${sourcePath}`);
  process.exit(1);
}