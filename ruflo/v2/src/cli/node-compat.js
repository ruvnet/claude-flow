/**
 * Node.js compatibility layer for Deno APIs
 * This module provides Node.js equivalents for Deno-specific APIs
 */

import { readdir, stat, mkdir, readFile, writeFile, unlink, rmdir } from 'fs/promises';
import { existsSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join, normalize } from 'path';
import process from 'process';
import { spawn } from 'child_process';

// Process arguments (remove first two: node executable and script path)
export const args = process.argv.slice(2);

// Current working directory
export const cwd = () => process.cwd();

// File system operations
export const readDir = async (path) => {
  const entries = await readdir(path, { withFileTypes: true });
  return entries.map((entry) => ({
    name: entry.name,
    isFile: entry.isFile(),
    isDirectory: entry.isDirectory(),
    isSymlink: entry.isSymbolicLink(),
  }));
};

export const statFile = async (path) => {
  const stats = await stat(path);
  return {
    isFile: stats.isFile(),
    isDirectory: stats.isDirectory(),
    size: stats.size,
    mtime: stats.mtime,
    atime: stats.atime,
    birthtime: stats.birthtime,
  };
};

export const readTextFile = async (path) => {
  return await readFile(path, 'utf-8');
};

export const writeTextFile = async (path, content) => {
  await writeFile(path, content, 'utf-8');
};

export const remove = async (path) => {
  const stats = await stat(path);
  if (stats.isDirectory()) {
    await rmdir(path, { recursive: true });
  } else {
    await unlink(path);
  }
};

export const mkdirSync = (path, options = {}) => {
  const fs = require('fs');
  fs.mkdirSync(path, { recursive: options.recursive });
};

export const mkdirAsync = async (path, options = {}) => {
  await mkdir(path, { recursive: options.recursive });
};

// Process operations
export const pid = process.pid;

export const kill = (pid, signal = 'SIGTERM') => {
  process.kill(pid, signal);
};

export const exit = (code = 0) => {
  process.exit(code);
};

export const execPath = () => process.execPath;

// stdin/stdout/stderr support
export const stdin = {
  read: async (buffer) => {
    return new Promise((resolve) => {
      if (process.stdin.isTTY) {
        process.stdin.setRawMode(true);
      }
      process.stdin.resume();
      process.stdin.once('data', (data) => {
        const bytes = Math.min(data.length, buffer.length);
        for (let i = 0; i < bytes; i++) {
          buffer[i] = data[i];
        }
        if (process.stdin.isTTY) {
          process.stdin.setRawMode(false);
        }
        process.stdin.pause();
        resolve(bytes);
      });
    });
  },
};

export const stdout = {
  write: async (data) => {
    return new Promise((resolve, reject) => {
      process.stdout.write(data, (err) => {
        if (err) reject(err);
        else resolve(data.length);
      });
    });
  },
};

export const stderr = {
  write: async (data) => {
    return new Promise((resolve, reject) => {
      process.stderr.write(data, (err) => {
        if (err) reject(err);
        else resolve(data.length);
      });
    });
  },
};

// Deno.errors compatibility
export const errors = {
  NotFound: class NotFound extends Error {
    constructor(message) {
      super(message);
      this.name = 'NotFound';
    }
  },
  AlreadyExists: class AlreadyExists extends Error {
    constructor(message) {
      super(message);
      this.name = 'AlreadyExists';
    }
  },
  PermissionDenied: class PermissionDenied extends Error {
    constructor(message) {
      super(message);
      this.name = 'PermissionDenied';
    }
  },
};

// import.meta compatibility
export const getImportMetaUrl = () => {
  // This will be replaced by the actual import.meta.url in each file
  return import.meta.url;
};

export const getDirname = (importMetaUrl) => {
  const __filename = fileURLToPath(importMetaUrl);
  return dirname(__filename);
};

export const getFilename = (importMetaUrl) => {
  return fileURLToPath(importMetaUrl);
};

// Check if this is the main module (Node.js equivalent of import.meta.main)
export const isMainModule = (importMetaUrl) => {
  const __filename = fileURLToPath(importMetaUrl);
  return normalize(process.argv[1]) === normalize(__filename);
};

// Helper to check file existence
export { existsSync };

// Build information (Node.js equivalent of Deno.build)
export const build = {
  os:
    process.platform === 'win32'
      ? 'windows'
      : process.platform === 'darwin'
        ? 'darwin'
        : process.platform === 'linux'
          ? 'linux'
          : process.platform,
  arch: process.arch,
  target: `${process.arch}-${process.platform}`,
};

// Environment variables support
export const env = {
  get: (key) => process.env[key],
  set: (key, value) => {
    process.env[key] = value;
  },
  toObject: () => ({ ...process.env }),
};

// Deno.Command compatibility
export class Command {
  constructor(command, options = {}) {
    this.command = command;
    this.options = options;
  }

  async output() {
    return new Promise((resolve, reject) => {
      const child = spawn(this.command, this.options.args || [], {
        cwd: this.options.cwd,
        env: this.options.env,
        stdio: ['pipe', 'pipe', 'pipe'],
      });

      let stdout = [];
      let stderr = [];

      child.stdout.on('data', (data) => {
        stdout.push(data);
      });

      child.stderr.on('data', (data) => {
        stderr.push(data);
      });

      child.on('close', (code) => {
        resolve({
          code,
          success: code === 0,
          stdout: Buffer.concat(stdout),
          stderr: Buffer.concat(stderr),
        });
      });

      child.on('error', (err) => {
        reject(err);
      });
    });
  }

  spawn() {
    const child = spawn(this.command, this.options.args || [], {
      cwd: this.options.cwd,
      env: this.options.env,
      stdio: this.options.stdio || 'inherit',
    });

    return {
      status: new Promise((resolve) => {
        child.on('close', (code) => {
          resolve({ code, success: code === 0 });
        });
      }),
      stdout: child.stdout,
      stderr: child.stderr,
      kill: (signal) => child.kill(signal),
    };
  }
}

// Legacy exports for compatibility - to be removed
// These functions are now available as direct imports

// NOTE: Deno export has been removed in alpha.79
// All Deno APIs have been replaced with native Node.js equivalents
