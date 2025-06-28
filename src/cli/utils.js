// utils.js - Shared CLI utility functions
import { promises as fs } from 'fs';
import { spawn } from 'child_process';
import { promisify } from 'util';
import path from 'path';

// Color formatting functions
export function printSuccess(message) {
  console.log(`✅ ${message}`);
}

export function printError(message) {
  console.log(`❌ ${message}`);
}

export function printWarning(message) {
  console.log(`⚠️  ${message}`);
}

export function printInfo(message) {
  console.log(`ℹ️  ${message}`);
}

// Command validation helpers
export function validateArgs(args, minLength, usage) {
  if (args.length < minLength) {
    printError(`Usage: ${usage}`);
    return false;
  }
  return true;
}

// File system helpers
export async function ensureDirectory(dirPath) {
  try {
    await fs.mkdir(dirPath, { recursive: true });
    return true;
  } catch (err) {
    if (err.code !== 'EEXIST') {
      throw err;
    }
    return true;
  }
}

export async function fileExists(filePath) {
  try {
    await fs.stat(filePath);
    return true;
  } catch {
    return false;
  }
}

// JSON helpers
export async function readJsonFile(filePath, defaultValue = {}) {
  try {
    const content = await fs.readFile(filePath, 'utf8');
    return JSON.parse(content);
  } catch {
    return defaultValue;
  }
}

export async function writeJsonFile(filePath, data) {
  await fs.writeFile(filePath, JSON.stringify(data, null, 2), 'utf8');
}

// String helpers
export function formatTimestamp(timestamp) {
  return new Date(timestamp).toLocaleString();
}

export function truncateString(str, length = 100) {
  return str.length > length ? str.substring(0, length) + '...' : str;
}

export function formatBytes(bytes) {
  const units = ['B', 'KB', 'MB', 'GB'];
  let size = bytes;
  let unitIndex = 0;
  
  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex++;
  }
  
  return `${size.toFixed(2)} ${units[unitIndex]}`;
}

// Command execution helpers
export function parseFlags(args) {
  const flags = {};
  const filteredArgs = [];
  
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    
    if (arg.startsWith('--')) {
      const flagName = arg.substring(2);
      const nextArg = args[i + 1];
      
      if (nextArg && !nextArg.startsWith('--')) {
        flags[flagName] = nextArg;
        i++; // Skip next arg since we consumed it
      } else {
        flags[flagName] = true;
      }
    } else if (arg.startsWith('-') && arg.length > 1) {
      // Short flags
      const shortFlags = arg.substring(1);
      for (const flag of shortFlags) {
        flags[flag] = true;
      }
    } else {
      filteredArgs.push(arg);
    }
  }
  
  return { flags, args: filteredArgs };
}

// Process execution helpers
export async function runCommand(command, args = [], options = {}) {
  try {
    return new Promise((resolve) => {
      const child = spawn(command, args, {
        ...options,
        stdio: 'pipe'
      });
      
      let stdout = '';
      let stderr = '';
      
      if (child.stdout) {
        child.stdout.on('data', (data) => {
          stdout += data.toString();
        });
      }
      
      if (child.stderr) {
        child.stderr.on('data', (data) => {
          stderr += data.toString();
        });
      }
      
      child.on('error', (err) => {
        resolve({
          success: false,
          code: -1,
          stdout: '',
          stderr: err.message
        });
      });
      
      child.on('close', (code) => {
        resolve({
          success: code === 0,
          code: code || 0,
          stdout,
          stderr
        });
      });
    });
  } catch (err) {
    return {
      success: false,
      code: -1,
      stdout: '',
      stderr: err.message
    };
  }
}

// Configuration helpers
export async function loadConfig(path = 'claude-flow.config.json') {
  const defaultConfig = {
    terminal: {
      poolSize: 10,
      recycleAfter: 20,
      healthCheckInterval: 30000,
      type: "auto"
    },
    orchestrator: {
      maxConcurrentTasks: 10,
      taskTimeout: 300000
    },
    memory: {
      backend: "json",
      path: "./memory/claude-flow-data.json"
    }
  };
  
  try {
    const content = await fs.readFile(path, 'utf8');
    return { ...defaultConfig, ...JSON.parse(content) };
  } catch {
    return defaultConfig;
  }
}

export async function saveConfig(config, path = 'claude-flow.config.json') {
  await writeJsonFile(path, config);
}

// ID generation
export function generateId(prefix = '') {
  const timestamp = Date.now();
  const random = Math.random().toString(36).substr(2, 9);
  return prefix ? `${prefix}-${timestamp}-${random}` : `${timestamp}-${random}`;
}

// Array helpers
export function chunk(array, size) {
  const chunks = [];
  for (let i = 0; i < array.length; i += size) {
    chunks.push(array.slice(i, i + size));
  }
  return chunks;
}

// Environment helpers
export function getEnvVar(name, defaultValue = null) {
  return process.env[name] ?? defaultValue;
}

export function setEnvVar(name, value) {
  process.env[name] = value;
}

// Validation helpers
export function isValidJson(str) {
  try {
    JSON.parse(str);
    return true;
  } catch {
    return false;
  }
}

export function isValidUrl(str) {
  try {
    new URL(str);
    return true;
  } catch {
    return false;
  }
}

// Progress and status helpers
export function showProgress(current, total, message = '') {
  const percentage = Math.round((current / total) * 100);
  const bar = '█'.repeat(Math.round(percentage / 5)) + '░'.repeat(20 - Math.round(percentage / 5));
  console.log(`\r${bar} ${percentage}% ${message}`);
}

export function clearLine() {
  console.log('\r\x1b[K');
}

// Async helpers
export function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export async function retry(fn, maxAttempts = 3, delay = 1000) {
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      if (attempt === maxAttempts) {
        throw err;
      }
      await sleep(delay * attempt);
    }
  }
}