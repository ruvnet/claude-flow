#!/usr/bin/env node

import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import https from 'node:https';
import { spawn } from 'node:child_process';

console.log('Installing Claude-Flow...');

// Check if Deno is available
function checkDeno() {
  return new Promise((resolve) => {
    const deno = spawn('deno', ['--version'], { stdio: 'pipe' });
    deno.on('close', (code) => {
      resolve(code === 0);
    });
    deno.on('error', () => {
      resolve(false);
    });
  });
}

// Install Deno if not available
async function installDeno() {
  console.log('Deno not found. Installing Deno...');
  
  const platform = os.platform();
  const arch = os.arch();
  
  if (platform === 'win32') {
    console.log('Please install Deno manually from https://deno.land/');
    process.exit(1);
  }
  
  return new Promise((resolve, reject) => {
    const installScript = spawn('curl', ['-fsSL', 'https://deno.land/x/install/install.sh'], { stdio: 'pipe' });
    const sh = spawn('sh', [], { stdio: ['pipe', 'inherit', 'inherit'] });
    
    installScript.stdout.pipe(sh.stdin);
    
    sh.on('close', (code) => {
      if (code === 0) {
        console.log('Deno installed successfully!');
        resolve();
      } else {
        reject(new Error('Failed to install Deno'));
      }
    });
  });
}

// Main installation process
async function main() {
  try {
    const denoAvailable = await checkDeno();
    
    if (!denoAvailable) {
      await installDeno();
    }
    
    console.log('Claude-Flow installation completed!');
    console.log('You can now use: npx claude-flow or claude-flow (if installed globally)');
    
  } catch (error) {
    console.error('Installation failed:', error.message);
    console.log('Please install Deno manually from https://deno.land/ and try again.');
    process.exit(1);
  }
}

main();