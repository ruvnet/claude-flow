/**
 * Node.js Runtime Adapter
 * Provides Node.js-specific implementations of runtime operations
 */

import { promises as fs, watchFile, unwatchFile } from 'fs';
import { spawn as nodeSpawn } from '../../tracing/index.js';
import { resolve, join } from 'path';
import type { RuntimeAdapter, SpawnOptions, ProcessResult, FileStats } from './interfaces.js';

export class NodeRuntimeAdapter implements RuntimeAdapter {
  async readFile(path: string): Promise<string> {
    try {
      return await fs.readFile(path, 'utf-8');
    } catch (error) {
      throw new Error(`Failed to read file ${path}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  async writeFile(path: string, content: string): Promise<void> {
    try {
      await fs.writeFile(path, content, 'utf-8');
    } catch (error) {
      throw new Error(`Failed to write file ${path}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  async exists(path: string): Promise<boolean> {
    try {
      await fs.access(path);
      return true;
    } catch {
      return false;
    }
  }

  getCurrentDir(): string {
    return process.cwd();
  }

  getEnvVar(name: string): string | undefined {
    return process.env[name];
  }

  async spawn(command: string, args: string[], options: SpawnOptions = {}): Promise<ProcessResult> {
    return new Promise((resolve, reject) => {
      const child = nodeSpawn(command, args, {
        cwd: options.cwd || this.getCurrentDir(),
        env: { ...process.env, ...options.env },
        stdio: options.stdio || 'pipe',
        shell: options.shell || false
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

      child.on('error', (error) => {
        reject(new Error(`Spawn error: ${error.message}`));
      });

      child.on('close', (code) => {
        resolve({
          code: code || 0,
          stdout: stdout.trim(),
          stderr: stderr.trim()
        });
      });
    });
  }

  resolvePath(...segments: string[]): string {
    return resolve(join(...segments));
  }

  async getStats(path: string): Promise<FileStats> {
    try {
      const stats = await fs.stat(path);
      return {
        isFile: stats.isFile(),
        isDirectory: stats.isDirectory(),
        size: stats.size,
        mtime: stats.mtime
      };
    } catch (error) {
      throw new Error(`Failed to get stats for ${path}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Node.js specific helper methods
   */

  /** Check if running in development mode */
  isDevelopment(): boolean {
    return process.env['NODE_ENV'] === 'development' || process.env['NODE_ENV'] === 'dev';
  }

  /** Check if running in production mode */
  isProduction(): boolean {
    return process.env['NODE_ENV'] === 'production';
  }

  /** Get the current Node.js version */
  getNodeVersion(): string {
    return process.version;
  }

  /** Get platform information */
  getPlatform(): {
    platform: string;
    arch: string;
    version: string;
  } {
    return {
      platform: process.platform,
      arch: process.arch,
      version: process.version
    };
  }

  /** Create directory recursively */
  async ensureDir(path: string): Promise<void> {
    try {
      await fs.mkdir(path, { recursive: true });
    } catch (error) {
      throw new Error(`Failed to create directory ${path}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /** Copy file */
  async copyFile(src: string, dest: string): Promise<void> {
    try {
      await fs.copyFile(src, dest);
    } catch (error) {
      throw new Error(`Failed to copy file from ${src} to ${dest}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /** Delete file or directory */
  async remove(path: string): Promise<void> {
    try {
      const stats = await this.getStats(path);
      if (stats.isDirectory) {
        await fs.rmdir(path, { recursive: true });
      } else {
        await fs.unlink(path);
      }
    } catch (error) {
      throw new Error(`Failed to remove ${path}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /** List directory contents */
  async readDir(path: string): Promise<string[]> {
    try {
      return await fs.readdir(path);
    } catch (error) {
      throw new Error(`Failed to read directory ${path}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /** Watch file for changes */
  watchFile(path: string, callback: (eventType: string, filename: string) => void): () => void {
    // Node's watchFile has a different signature, so we need to adapt it
    const listener = () => {
      callback('change', path);
    };
    watchFile(path, listener);
    return () => {
      unwatchFile(path, listener);
    };
  }
}