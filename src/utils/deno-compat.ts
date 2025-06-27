/**
 * Deno-to-Node.js Compatibility Layer
 * 
 * This module provides Node.js equivalents for Deno APIs to enable
 * progressive migration from dual runtime to Node.js only.
 * 
 * Phase 2 Runtime Migration - Issues #72, #79
 */

import { promises as fs, constants } from 'fs';
import { join, resolve } from 'path';
import { spawn, exec } from 'child_process';
import { promisify } from 'util';
import { memoryUsage as nodeMemoryUsage, exit, pid, kill as nodeKill, argv, cwd as nodeCwd, chdir as nodeChdir, env, platform, arch } from 'process';
import { stdin as nodeStdin, stdout as nodeStdout } from 'process';

const execAsync = promisify(exec);

/**
 * File System Operations
 * Mapping Deno file operations to Node.js fs promises
 */
export class DenoCompatFS {
  /**
   * Deno.writeTextFile equivalent
   */
  static async writeTextFile(path: string, data: string, options?: { append?: boolean; create?: boolean }): Promise<void> {
    const resolvedPath = resolve(path);
    
    if (options?.create !== false) {
      // Ensure directory exists
      await fs.mkdir(join(resolvedPath, '..'), { recursive: true });
    }
    
    const writeOptions: any = { encoding: 'utf8' };
    if (options?.append) {
      writeOptions.flag = 'a';
    }
    
    await fs.writeFile(resolvedPath, data, writeOptions);
  }
  
  /**
   * Deno.readTextFile equivalent
   */
  static async readTextFile(path: string): Promise<string> {
    return await fs.readFile(resolve(path), 'utf8');
  }
  
  /**
   * Deno.stat equivalent
   */
  static async stat(path: string): Promise<{
    isFile: boolean;
    isDirectory: boolean;
    isSymlink: boolean;
    size: number;
    mtime: Date | null;
    atime: Date | null;
    birthtime: Date | null;
    mode: number | null;
    uid: number | null;
    gid: number | null;
  }> {
    const stats = await fs.stat(resolve(path));
    return {
      isFile: stats.isFile(),
      isDirectory: stats.isDirectory(),
      isSymlink: stats.isSymbolicLink(),
      size: stats.size,
      mtime: stats.mtime,
      atime: stats.atime,
      birthtime: stats.birthtime,
      mode: stats.mode,
      uid: stats.uid,
      gid: stats.gid
    };
  }
  
  /**
   * Deno.mkdir equivalent
   */
  static async mkdir(path: string, options?: { recursive?: boolean; mode?: number }): Promise<void> {
    await fs.mkdir(resolve(path), {
      recursive: options?.recursive ?? false,
      mode: options?.mode
    });
  }
  
  /**
   * Deno.remove equivalent
   */
  static async remove(path: string, options?: { recursive?: boolean }): Promise<void> {
    await fs.rm(resolve(path), {
      recursive: options?.recursive ?? false,
      force: true
    });
  }
  
  /**
   * Deno.readDir equivalent
   */
  static async *readDir(path: string): AsyncIterableIterator<{
    name: string;
    isFile: boolean;
    isDirectory: boolean;
    isSymlink: boolean;
  }> {
    const entries = await fs.readdir(resolve(path), { withFileTypes: true });
    for (const entry of entries) {
      yield {
        name: entry.name,
        isFile: entry.isFile(),
        isDirectory: entry.isDirectory(),
        isSymlink: entry.isSymbolicLink()
      };
    }
  }
  
  /**
   * Check if file/directory exists (Deno equivalent)
   */
  static async exists(path: string): Promise<boolean> {
    try {
      await fs.access(resolve(path), constants.F_OK);
      return true;
    } catch {
      return false;
    }
  }
}

/**
 * Environment and Process Operations
 * Mapping Deno environment APIs to Node.js process
 */
export class DenoCompatEnv {
  /**
   * Deno.env equivalent
   */
  static env = {
    get: (key: string): string | undefined => env[key],
    set: (key: string, value: string): void => { env[key] = value; },
    delete: (key: string): void => { delete env[key]; },
    has: (key: string): boolean => key in env,
    toObject: (): Record<string, string> => ({ ...env })
  };
  
  /**
   * Deno.args equivalent
   */
  static get args(): string[] {
    return argv.slice(2);
  }
  
  /**
   * Deno.cwd equivalent
   */
  static cwd(): string {
    return nodeCwd();
  }
  
  /**
   * Deno.chdir equivalent
   */
  static chdir(directory: string): void {
    nodeChdir(directory);
  }
  
  /**
   * Deno.exit equivalent
   */
  static exit(code?: number): never {
    exit(code || 0);
  }
  
  /**
   * Deno.pid equivalent
   */
  static get pid(): number {
    return pid;
  }
  
  /**
   * Deno.kill equivalent
   */
  static kill(pid: number, signal?: string | number): void {
    nodeKill(pid, signal as any);
  }
}

/**
 * Command Execution
 * Mapping Deno.Command to Node.js child_process
 */
export class DenoCompatCommand {
  private command: string;
  private args: string[];
  private options: any;
  
  constructor(command: string, options?: {
    args?: string[];
    cwd?: string;
    env?: Record<string, string>;
    stdin?: 'piped' | 'inherit' | 'null';
    stdout?: 'piped' | 'inherit' | 'null';
    stderr?: 'piped' | 'inherit' | 'null';
  }) {
    this.command = command;
    this.args = options?.args || [];
    this.options = {
      cwd: options?.cwd,
      env: { ...env, ...(options?.env || {}) },
      stdio: [
        this.mapStdio(options?.stdin || 'inherit'),
        this.mapStdio(options?.stdout || 'inherit'),
        this.mapStdio(options?.stderr || 'inherit')
      ]
    };
  }
  
  private mapStdio(stdio: 'piped' | 'inherit' | 'null'): 'pipe' | 'inherit' | 'ignore' {
    switch (stdio) {
      case 'piped': return 'pipe';
      case 'inherit': return 'inherit';
      case 'null': return 'ignore';
    }
  }
  
  /**
   * Execute command and return result
   */
  async output(): Promise<{
    code: number;
    stdout: Uint8Array;
    stderr: Uint8Array;
    success: boolean;
  }> {
    return new Promise((resolve, reject) => {
      const child = spawn(this.command, this.args, this.options);
      
      let stdout = Buffer.alloc(0);
      let stderr = Buffer.alloc(0);
      
      if (child.stdout) {
        child.stdout.on('data', (data) => {
          stdout = Buffer.concat([stdout, data]);
        });
      }
      
      if (child.stderr) {
        child.stderr.on('data', (data) => {
          stderr = Buffer.concat([stderr, data]);
        });
      }
      
      child.on('close', (code) => {
        resolve({
          code: code || 0,
          stdout: new Uint8Array(stdout),
          stderr: new Uint8Array(stderr),
          success: code === 0
        });
      });
      
      child.on('error', reject);
    });
  }
  
  /**
   * Spawn command and return child process
   */
  spawn(): {
    pid: number;
    status: Promise<{ code: number; success: boolean }>;
  } {
    const child = spawn(this.command, this.args, this.options);
    
    return {
      pid: child.pid!,
      status: new Promise((resolve) => {
        child.on('close', (code) => {
          resolve({
            code: code || 0,
            success: code === 0
          });
        });
      })
    };
  }
}

/**
 * System Information
 * Mapping Deno system APIs to Node.js equivalents
 */
export class DenoCompatSystem {
  /**
   * Deno.memoryUsage equivalent
   */
  static memoryUsage(): {
    rss: number;
    heapTotal: number;
    heapUsed: number;
    external: number;
  } {
    const usage = nodeMemoryUsage();
    return {
      rss: usage.rss,
      heapTotal: usage.heapTotal,
      heapUsed: usage.heapUsed,
      external: usage.external
    };
  }
  
  /**
   * Deno.build equivalent
   */
  static get build(): {
    target: string;
    arch: string;
    os: string;
    vendor: string;
    env: string;
  } {
    return {
      target: `${arch}-${platform}`,
      arch: arch,
      os: platform,
      vendor: 'nodejs',
      env: 'node'
    };
  }
  
  /**
   * Deno.stdin equivalent
   */
  static get stdin() {
    return nodeStdin;
  }
  
  /**
   * Deno.stdout equivalent
   */
  static get stdout() {
    return nodeStdout;
  }
  
  /**
   * Deno.addSignalListener equivalent
   */
  static addSignalListener(signal: NodeJS.Signals, handler: () => void): void {
    process.on(signal, handler);
  }
  
  /**
   * Remove signal listener (Node.js equivalent)
   */
  static removeSignalListener(signal: NodeJS.Signals, handler: () => void): void {
    process.off(signal, handler);
  }
}

/**
 * Error Types
 * Mapping Deno.errors to Node.js equivalents
 */
export class DenoCompatErrors {
  static NotFound = class extends Error {
    name = 'NotFound';
    constructor(message?: string) {
      super(message || 'File or directory not found');
    }
  };
  
  static PermissionDenied = class extends Error {
    name = 'PermissionDenied';
    constructor(message?: string) {
      super(message || 'Permission denied');
    }
  };
  
  static AlreadyExists = class extends Error {
    name = 'AlreadyExists';
    constructor(message?: string) {
      super(message || 'File or directory already exists');
    }
  };
}

/**
 * Main Compatibility Object
 * Drop-in replacement for Deno global
 */
export const DenoCompat = {
  writeTextFile: DenoCompatFS.writeTextFile,
  readTextFile: DenoCompatFS.readTextFile,
  stat: DenoCompatFS.stat,
  mkdir: DenoCompatFS.mkdir,
  remove: DenoCompatFS.remove,
  readDir: DenoCompatFS.readDir,
  exists: DenoCompatFS.exists,
  
  env: DenoCompatEnv.env,
  args: DenoCompatEnv.args,
  cwd: DenoCompatEnv.cwd,
  chdir: DenoCompatEnv.chdir,
  exit: DenoCompatEnv.exit,
  pid: DenoCompatEnv.pid,
  kill: DenoCompatEnv.kill,
  
  Command: DenoCompatCommand,
  
  memoryUsage: DenoCompatSystem.memoryUsage,
  build: DenoCompatSystem.build,
  stdin: DenoCompatSystem.stdin,
  stdout: DenoCompatSystem.stdout,
  addSignalListener: DenoCompatSystem.addSignalListener,
  removeSignalListener: DenoCompatSystem.removeSignalListener,
  
  errors: DenoCompatErrors
};

/**
 * Global Deno polyfill
 * Can be used to replace Deno global during migration
 */
if (typeof globalThis !== 'undefined' && !globalThis.Deno) {
  globalThis.Deno = DenoCompat as any;
}

export default DenoCompat;