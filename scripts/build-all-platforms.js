#!/usr/bin/env node

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

// Platform configurations
const platforms = [
  { target: 'x86_64-unknown-linux-gnu', output: 'claude-flow-linux-x64' },
  { target: 'x86_64-apple-darwin', output: 'claude-flow-darwin-x64' },
  { target: 'aarch64-apple-darwin', output: 'claude-flow-darwin-arm64' },
  { target: 'x86_64-pc-windows-msvc', output: 'claude-flow-win-x64.exe' }
];

console.log('🚀 Building Claude-Flow for all platforms...\n');

// Ensure bin directory exists
const binDir = path.join(__dirname, '..', 'bin');
if (!fs.existsSync(binDir)) {
  fs.mkdirSync(binDir, { recursive: true });
}

// Build for each platform
for (const platform of platforms) {
  console.log(`📦 Building for ${platform.target}...`);
  
  try {
    const outputPath = path.join(binDir, platform.output);
    
    // Remove existing binary if it exists
    if (fs.existsSync(outputPath)) {
      fs.unlinkSync(outputPath);
    }
    
    // Build the binary
    execSync(
      `deno compile --allow-all --no-check --target ${platform.target} --output ${outputPath} src/cli/main.ts`,
      { stdio: 'inherit', cwd: path.join(__dirname, '..') }
    );
    
    console.log(`✅ Successfully built ${platform.output}\n`);
  } catch (error) {
    console.error(`❌ Failed to build for ${platform.target}: ${error.message}\n`);
  }
}

console.log('🎉 Build process completed!');