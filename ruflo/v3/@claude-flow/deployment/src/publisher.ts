/**
 * NPM Publisher
 * Handles npm package publishing with tag support
 */

import { execSync, execFileSync } from 'child_process';
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import type { PublishOptions, PublishResult, PackageInfo } from './types.js';

export class Publisher {
  private cwd: string;

  constructor(cwd: string = process.cwd()) {
    this.cwd = cwd;
  }

  /**
   * Publish package to npm
   */
  async publishToNpm(options: PublishOptions = {}): Promise<PublishResult> {
    const {
      tag = 'latest',
      access,
      dryRun = false,
      registry,
      otp,
      skipBuild = false,
      buildCommand = 'npm run build'
    } = options;

    const result: PublishResult = {
      packageName: '',
      version: '',
      tag,
      success: false
    };

    try {
      // Read package.json
      const pkgPath = join(this.cwd, 'package.json');
      if (!existsSync(pkgPath)) {
        throw new Error('package.json not found');
      }

      const pkg: PackageInfo = JSON.parse(readFileSync(pkgPath, 'utf-8'));

      if (pkg.private) {
        throw new Error('Cannot publish private package');
      }

      result.packageName = pkg.name;
      result.version = pkg.version;

      // Run build if not skipped
      if (!skipBuild) {
        console.log('Building package...');
        this.execCommand(buildCommand);
      }

      // Construct npm publish command arguments (without 'npm' prefix for execNpmCommand)
      const publishArgs: string[] = ['publish'];

      if (tag) {
        publishArgs.push('--tag', tag);
      }

      if (access) {
        publishArgs.push('--access', access);
      }

      if (registry) {
        publishArgs.push('--registry', registry);
      }

      if (otp) {
        publishArgs.push('--otp', otp);
      }

      if (dryRun) {
        publishArgs.push('--dry-run');
      }

      // Execute publish
      console.log(`Publishing ${result.packageName}@${result.version} with tag '${tag}'...`);

      if (dryRun) {
        console.log('Dry run mode - no actual publish');
        console.log('Command: npm', publishArgs.join(' '));
      }

      const output = this.execNpmCommand(publishArgs, true);

      // Parse output for tarball URL
      const tarballMatch = output.match(/https:\/\/[^\s]+\.tgz/);
      if (tarballMatch) {
        result.tarball = tarballMatch[0];
      }

      result.publishedAt = new Date();
      result.success = true;

      console.log(`Successfully published ${result.packageName}@${result.version}`);

      return result;

    } catch (error) {
      result.error = error instanceof Error ? error.message : String(error);
      console.error('Publish failed:', result.error);
      return result;
    }
  }

  /**
   * Check if package version already exists on npm
   */
  async checkVersionExists(packageName: string, version: string): Promise<boolean> {
    try {
      const output = this.execNpmCommand(['view', `${packageName}@${version}`, 'version'], true);
      return output.trim() === version;
    } catch {
      return false;
    }
  }

  /**
   * Get latest published version
   */
  async getLatestVersion(packageName: string, tag = 'latest'): Promise<string | null> {
    try {
      const output = this.execNpmCommand(['view', `${packageName}@${tag}`, 'version'], true);
      return output.trim();
    } catch {
      return null;
    }
  }

  /**
   * Get package info from npm registry
   */
  async getPackageInfo(packageName: string): Promise<PackageInfo | null> {
    try {
      const output = this.execNpmCommand(['view', packageName, '--json'], true);
      return JSON.parse(output);
    } catch {
      return null;
    }
  }

  /**
   * Verify npm authentication
   */
  async verifyAuth(): Promise<boolean> {
    try {
      const output = this.execNpmCommand(['whoami'], true);
      return output.trim().length > 0;
    } catch {
      return false;
    }
  }

  /**
   * Get npm registry URL
   */
  async getRegistry(): Promise<string> {
    try {
      const output = this.execNpmCommand(['config', 'get', 'registry'], true);
      return output.trim();
    } catch {
      return 'https://registry.npmjs.org/';
    }
  }

  /**
   * Pack package to tarball
   */
  async pack(outputDir?: string): Promise<string> {
    try {
      const packArgs = ['pack'];
      if (outputDir) {
        packArgs.push('--pack-destination', outputDir);
      }

      const output = this.execNpmCommand(packArgs, true);
      const tarballName = output.trim().split('\n').pop() || '';

      return outputDir ? join(outputDir, tarballName) : tarballName;
    } catch (error) {
      throw new Error(`Failed to pack: ${error}`);
    }
  }

  /**
   * Execute npm command safely using execFileSync
   */
  private execNpmCommand(args: string[], returnOutput = false): string {
    try {
      // Validate args don't contain shell metacharacters
      for (const arg of args) {
        if (/[;&|`$()<>]/.test(arg)) {
          throw new Error(`Invalid argument: contains shell metacharacters`);
        }
      }
      const output = execFileSync('npm', args, {
        cwd: this.cwd,
        encoding: 'utf-8',
        shell: false,
        stdio: returnOutput ? ['pipe', 'pipe', 'pipe'] : 'inherit'
      });
      return returnOutput ? output : '';
    } catch (error) {
      throw error;
    }
  }

  /**
   * Execute command (for build scripts only - validated)
   */
  private execCommand(cmd: string, returnOutput = false): string {
    // Only allow npm/npx build commands for safety
    const allowedPrefixes = ['npm run ', 'npm ', 'npx ', 'pnpm ', 'yarn '];
    const isAllowed = allowedPrefixes.some(prefix => cmd.startsWith(prefix));
    if (!isAllowed) {
      throw new Error(`Disallowed command: only npm/npx/pnpm/yarn commands are permitted`);
    }
    // Validate no dangerous shell metacharacters
    if (/[;&|`$()<>]/.test(cmd)) {
      throw new Error(`Invalid command: contains shell metacharacters`);
    }
    try {
      const output = execSync(cmd, {
        cwd: this.cwd,
        encoding: 'utf-8',
        stdio: returnOutput ? 'pipe' : 'inherit'
      });
      return returnOutput ? output : '';
    } catch (error) {
      throw error;
    }
  }
}

/**
 * Convenience function to publish to npm
 */
export async function publishToNpm(
  options: PublishOptions = {}
): Promise<PublishResult> {
  const publisher = new Publisher();
  return publisher.publishToNpm(options);
}

/**
 * Convenience function to check version exists
 */
export async function checkVersionExists(
  packageName: string,
  version: string
): Promise<boolean> {
  const publisher = new Publisher();
  return publisher.checkVersionExists(packageName, version);
}

/**
 * Convenience function to get latest version
 */
export async function getLatestVersion(
  packageName: string,
  tag?: string
): Promise<string | null> {
  const publisher = new Publisher();
  return publisher.getLatestVersion(packageName, tag);
}
