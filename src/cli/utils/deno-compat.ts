/**
 * Deno compatibility layer for Node.js
 * Provides Deno-like APIs using Node.js equivalents
 */

import * as fs from 'fs';
import * as path from 'path';
import { spawn, ChildProcess } from 'child_process';
import { promisify } from 'util';

// Create a Deno-like API object
export const Deno = {
  // Process control
  exit: (code?: number) => process.exit(code),
  pid: process.pid,
  
  // File system operations
  stat: promisify(fs.stat),
  
  writeTextFile: async (filePath: string, data: string) => {
    await fs.promises.writeFile(filePath, data, 'utf8');
  },
  
  mkdir: async (dirPath: string, options?: { recursive?: boolean }) => {
    await fs.promises.mkdir(dirPath, options);
  },
  
  remove: async (filePath: string) => {
    const stats = await fs.promises.stat(filePath).catch(() => null);
    if (stats?.isDirectory()) {
      await fs.promises.rmdir(filePath, { recursive: true });
    } else if (stats) {
      await fs.promises.unlink(filePath);
    }
  },
  
  chmod: async (filePath: string, mode: number) => {
    await fs.promises.chmod(filePath, mode);
  },
  
  // Process management
  kill: (pid: number, signal?: NodeJS.Signals | number) => {
    try {
      process.kill(pid, signal);
    } catch (error) {
      // Ignore errors if process doesn't exist
    }
  },
  
  // Command execution
  Command: class {
    private command: string;
    private args: string[];
    private options: any;
    
    constructor(command: string, options?: any) {
      this.command = command;
      this.args = options?.args || [];
      this.options = options || {};
    }
    
    spawn(): ChildProcess {
      return spawn(this.command, this.args, {
        cwd: this.options.cwd,
        env: { ...process.env, ...this.options.env },
        stdio: this.options.stdio || 'inherit'
      });
    }
    
    output(): Promise<{ code: number; stdout: Uint8Array; stderr: Uint8Array }> {
      return new Promise((resolve, reject) => {
        const child = spawn(this.command, this.args, {
          cwd: this.options.cwd,
          env: { ...process.env, ...this.options.env }
        });
        
        const stdout: Buffer[] = [];
        const stderr: Buffer[] = [];
        
        if (child.stdout) {
          child.stdout.on('data', (data) => stdout.push(data));
        }
        if (child.stderr) {
          child.stderr.on('data', (data) => stderr.push(data));
        }
        
        child.on('close', (code) => {
          resolve({
            code: code || 0,
            stdout: new Uint8Array(Buffer.concat(stdout)),
            stderr: new Uint8Array(Buffer.concat(stderr))
          });
        });
        
        child.on('error', reject);
      });
    }
  },
  
  // I/O operations
  stdin: {
    read: async (buffer: Uint8Array): Promise<number | null> => {
      return new Promise((resolve) => {
        process.stdin.once('data', (data) => {
          const bytesToCopy = Math.min(data.length, buffer.length);
          for (let i = 0; i < bytesToCopy; i++) {
            buffer[i] = data[i];
          }
          resolve(bytesToCopy);
        });
        
        process.stdin.once('end', () => resolve(null));
      });
    }
  },
  
  stdout: {
    write: (data: Uint8Array): Promise<number> => {
      return new Promise((resolve) => {
        process.stdout.write(data, () => resolve(data.length));
      });
    },
    
    writeSync: (data: Uint8Array): number => {
      process.stdout.write(data);
      return data.length;
    }
  }
};

// Re-export Node.js equivalents
export { existsSync } from 'fs';