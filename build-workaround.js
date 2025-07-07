#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

console.log('🚀 Claude Flow Alpha Build Workaround');

// Copy essential JavaScript files to dist
const distDir = path.join(__dirname, 'dist');
const srcDir = path.join(__dirname, 'src');

// Ensure dist directory exists
if (!fs.existsSync(distDir)) {
  fs.mkdirSync(distDir, { recursive: true });
}

// Copy essential files
const essentialFiles = [
  'cli/simple-cli.js',
  'cli/command-registry.js', 
  'cli/help-text.js',
  'cli/node-compat.js',
  'cli/utils.js',
  'cli/runtime-detector.js',
  'cli/simple-commands/hive-mind.js',
  'cli/simple-commands/swarm.js',
  'cli/simple-commands/web-server.js',
  'utils/error-handler.js'
];

console.log('📦 Copying essential JavaScript files...');

essentialFiles.forEach(file => {
  const srcPath = path.join(srcDir, file);
  const distPath = path.join(distDir, file);
  
  if (fs.existsSync(srcPath)) {
    // Ensure directory exists
    const dir = path.dirname(distPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    
    fs.copyFileSync(srcPath, distPath);
    console.log(`✓ Copied ${file}`);
  } else {
    console.log(`⚠️  Missing ${file}`);
  }
});

// Copy package.json
fs.copyFileSync('package.json', path.join(distDir, 'package.json'));

// Copy bin files
const binDir = path.join(distDir, 'bin');
if (!fs.existsSync(binDir)) {
  fs.mkdirSync(binDir);
}

if (fs.existsSync('claude-flow')) {
  fs.copyFileSync('claude-flow', path.join(binDir, 'claude-flow'));
}

if (fs.existsSync('cli.mjs')) {
  fs.copyFileSync('cli.mjs', path.join(distDir, 'cli.mjs'));
}

console.log('✅ Alpha build workaround complete!');
console.log('📁 Files copied to dist/');
console.log('🎯 Ready for alpha publishing');