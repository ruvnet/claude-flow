#!/usr/bin/env node
// Simple wrapper for pkg compilation
const { execSync } = require('child_process');
const path = require('path');

// Path to simple-cli.ts
const simpleCli = path.join(__dirname, '..', 'src', 'cli', 'simple-cli.ts');

// Run the CLI with tsx
execSync(`npx tsx ${simpleCli} ${process.argv.slice(2).join(' ')}`, {
  stdio: 'inherit'
});