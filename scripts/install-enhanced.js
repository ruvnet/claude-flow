#!/usr/bin/env node

const os = require('os');
const path = require('path');
const fs = require('fs');
const https = require('https');
const { spawn, execSync } = require('child_process');

console.log('🌊 Installing Claude-Flow...\n');

// Detect platform and architecture
function getPlatformBinary() {
  const platform = os.platform();
  const arch = os.arch();
  
  if (platform === 'darwin') {
    return arch === 'arm64' ? 'claude-flow-darwin-arm64' : 'claude-flow-darwin-x64';
  } else if (platform === 'linux') {
    return 'claude-flow-linux-x64';
  } else if (platform === 'win32') {
    return 'claude-flow-win-x64.exe';
  }
  
  throw new Error(`Unsupported platform: ${platform} ${arch}`);
}

// Check if pre-compiled binary exists
function checkBinary() {
  try {
    const binaryName = getPlatformBinary();
    const binaryPath = path.join(__dirname, '..', 'bin', binaryName);
    
    if (fs.existsSync(binaryPath)) {
      console.log(`✅ Found pre-compiled binary: ${binaryName}`);
      
      // Create symlink or copy to claude-flow
      const targetPath = path.join(__dirname, '..', 'bin', 'claude-flow');
      
      // Remove existing symlink/file
      if (fs.existsSync(targetPath)) {
        fs.unlinkSync(targetPath);
      }
      
      // Create symlink on Unix-like systems, copy on Windows
      if (os.platform() === 'win32') {
        fs.copyFileSync(binaryPath, targetPath);
      } else {
        fs.symlinkSync(binaryName, targetPath);
        fs.chmodSync(targetPath, '755');
      }
      
      return true;
    }
    
    return false;
  } catch (error) {
    console.log(`⚠️  No pre-compiled binary found: ${error.message}`);
    return false;
  }
}

// Check if Deno is available
function checkDeno() {
  try {
    execSync('deno --version', { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

// Create wrapper script for Deno
function createDenoWrapper() {
  const wrapperContent = `#!/usr/bin/env node

const { spawn } = require('child_process');
const path = require('path');

// Get the directory where this script is located
const scriptDir = path.dirname(__filename);
const projectRoot = path.dirname(scriptDir);

// Check if deno is available
try {
  require('child_process').execSync('deno --version', { stdio: 'ignore' });
} catch {
  console.error('Error: Deno is not installed.');
  console.error('Please install Deno from https://deno.land/');
  process.exit(1);
}

// Run the CLI with Deno
const args = [
  'run',
  '--allow-all',
  '--no-check',
  '--unstable-sloppy-imports',
  path.join(projectRoot, 'src', 'cli', 'main.ts'),
  ...process.argv.slice(2)
];

const deno = spawn('deno', args, {
  stdio: 'inherit',
  env: { ...process.env }
});

deno.on('exit', (code) => {
  process.exit(code);
});

deno.on('error', (err) => {
  console.error('Failed to start Claude-Flow:', err);
  process.exit(1);
});
`;

  const wrapperPath = path.join(__dirname, '..', 'bin', 'claude-flow');
  fs.writeFileSync(wrapperPath, wrapperContent);
  fs.chmodSync(wrapperPath, '755');
  
  console.log('✅ Created Deno wrapper script');
}

// Install Deno if not available
async function installDeno() {
  console.log('📦 Deno not found. Installing Deno...\n');
  
  const platform = os.platform();
  
  if (platform === 'win32') {
    console.log('Please install Deno manually from https://deno.land/');
    console.log('Run: irm https://deno.land/install.ps1 | iex');
    return false;
  }
  
  try {
    execSync('curl -fsSL https://deno.land/x/install/install.sh | sh', {
      stdio: 'inherit',
      shell: true
    });
    
    // Add deno to PATH for current session
    const homeDir = os.homedir();
    const denoBin = path.join(homeDir, '.deno', 'bin');
    process.env.PATH = `${denoBin}:${process.env.PATH}`;
    
    console.log('\n✅ Deno installed successfully!');
    console.log(`ℹ️  Add ${denoBin} to your PATH if not already added\n`);
    
    return true;
  } catch (error) {
    console.error('❌ Failed to install Deno:', error.message);
    return false;
  }
}

// Main installation process
async function main() {
  try {
    console.log(`Platform: ${os.platform()} ${os.arch()}\n`);
    
    // First, try to use pre-compiled binary
    if (checkBinary()) {
      console.log('\n🎉 Claude-Flow installed successfully!');
      console.log('You can now use: npx claude-flow or claude-flow\n');
      return;
    }
    
    // Fallback to Deno
    console.log('ℹ️  Pre-compiled binary not found, falling back to Deno runtime\n');
    
    const denoAvailable = checkDeno();
    
    if (!denoAvailable) {
      const installed = await installDeno();
      if (!installed) {
        console.log('\n⚠️  Please install Deno manually and run npm install again');
        process.exit(1);
      }
    }
    
    // Create wrapper script
    createDenoWrapper();
    
    console.log('\n🎉 Claude-Flow installed successfully!');
    console.log('You can now use: npx claude-flow or claude-flow\n');
    
  } catch (error) {
    console.error('❌ Installation failed:', error.message);
    console.log('\nPlease try:');
    console.log('1. Install Deno manually from https://deno.land/');
    console.log('2. Run npm install again\n');
    process.exit(1);
  }
}

main();