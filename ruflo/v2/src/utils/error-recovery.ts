/**
 * Error Recovery Utilities
 * Automatic error detection and recovery for common installation issues
 */

import { execSync } from 'child_process';
import * as fs from 'fs-extra';
import * as path from 'path';
import * as os from 'os';

export interface RecoveryResult {
  success: boolean;
  action: string;
  message: string;
  recovered: boolean;
}

export interface RetryOptions {
  maxRetries?: number;
  delay?: number;
  onRetry?: (attempt: number, error: Error) => void;
  cleanupFn?: () => Promise<void>;
}

/**
 * Detect if an error is the ENOTEMPTY npm cache error
 */
export function isNpmCacheError(error: any): boolean {
  const errorStr = error?.message || String(error);
  return (
    errorStr.includes('ENOTEMPTY') &&
    (errorStr.includes('npm') || errorStr.includes('npx') || errorStr.includes('_npx'))
  ) || errorStr.includes('better-sqlite3');
}

/**
 * Detect if an error is a native module version mismatch (NODE_MODULE_VERSION)
 * This happens when native modules are compiled for a different Node.js version
 */
export function isNativeModuleVersionError(error: any): boolean {
  const errorStr = error?.message || String(error);
  return (
    errorStr.includes('NODE_MODULE_VERSION') ||
    errorStr.includes('was compiled against a different Node.js version') ||
    errorStr.includes('re-compiling or re-installing the module')
  );
}

/**
 * Get helpful message for native module version mismatch
 */
export function getNativeModuleRecoveryMessage(error: any): string {
  const errorStr = error?.message || String(error);

  // Extract version numbers if available
  const compiledMatch = errorStr.match(/NODE_MODULE_VERSION (\d+)/);
  const requiredMatch = errorStr.match(/requires\s+NODE_MODULE_VERSION (\d+)/);

  let message = '⚠️  Native module version mismatch detected.\n';

  if (compiledMatch && requiredMatch) {
    const nodeVersionMap: Record<string, string> = {
      '108': '18.x',
      '115': '20.x',
      '120': '21.x',
      '127': '22.x',
      '131': '23.x'
    };
    const compiled = nodeVersionMap[compiledMatch[1]] || `ABI ${compiledMatch[1]}`;
    const required = nodeVersionMap[requiredMatch[1]] || `ABI ${requiredMatch[1]}`;
    message += `   Module was compiled for Node.js ${compiled}, but running Node.js ${required}.\n`;
  }

  message += '\n   To fix this, try one of:\n';
  message += '   1. npm rebuild better-sqlite3\n';
  message += '   2. rm -rf node_modules && npm install\n';
  message += '   3. npx cache: rm -rf ~/.npm/_npx/ && run command again\n';

  return message;
}

/**
 * Detect if running on WSL (Windows Subsystem for Linux)
 */
export function isWSL(): boolean {
  if (process.platform !== 'linux') {
    return false;
  }

  try {
    const release = fs.readFileSync('/proc/version', 'utf8').toLowerCase();
    return release.includes('microsoft') || release.includes('wsl');
  } catch {
    return false;
  }
}

/**
 * Clean npm and npx cache directories
 */
export async function cleanNpmCache(): Promise<RecoveryResult> {
  const homeDir = os.homedir();
  const npxCacheDir = path.join(homeDir, '.npm', '_npx');

  try {
    console.log('🧹 Cleaning npm cache...');

    // Clean npm cache
    try {
      execSync('npm cache clean --force', { stdio: 'pipe' });
      console.log('✅ npm cache cleaned');
    } catch (error) {
      console.warn('⚠️  npm cache clean failed, continuing...');
    }

    // Remove npx cache directory
    if (await fs.pathExists(npxCacheDir)) {
      console.log(`🗑️  Removing npx cache: ${npxCacheDir}`);
      await fs.remove(npxCacheDir);
      console.log('✅ npx cache removed');
    }

    // Fix permissions on WSL
    if (isWSL()) {
      const npmDir = path.join(homeDir, '.npm');
      if (await fs.pathExists(npmDir)) {
        try {
          execSync(`chmod -R 755 "${npmDir}"`, { stdio: 'pipe' });
          console.log('✅ npm directory permissions fixed');
        } catch (error) {
          console.warn('⚠️  Permission fix failed, continuing...');
        }
      }
    }

    return {
      success: true,
      action: 'cache-cleanup',
      message: 'npm/npx cache cleaned successfully',
      recovered: true
    };
  } catch (error) {
    return {
      success: false,
      action: 'cache-cleanup',
      message: `Failed to clean cache: ${error instanceof Error ? error.message : String(error)}`,
      recovered: false
    };
  }
}

/**
 * Automatic retry with exponential backoff and error recovery
 */
export async function retryWithRecovery<T>(
  fn: () => Promise<T>,
  options: RetryOptions = {}
): Promise<T> {
  const {
    maxRetries = 3,
    delay = 1000,
    onRetry,
    cleanupFn
  } = options;

  let lastError: Error | undefined;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error as Error;

      // Check if it's a recoverable error
      if (isNpmCacheError(error)) {
        console.log(`\n⚠️  Detected npm cache error (attempt ${attempt}/${maxRetries})`);

        // Attempt automatic recovery
        const recovery = await cleanNpmCache();
        if (recovery.success) {
          console.log('✅ Cache cleaned, retrying...\n');

          // Run custom cleanup if provided
          if (cleanupFn) {
            await cleanupFn();
          }

          // Exponential backoff
          const backoffDelay = delay * Math.pow(2, attempt - 1);
          await new Promise(resolve => setTimeout(resolve, backoffDelay));

          continue; // Retry
        } else {
          console.error('❌ Cache cleanup failed:', recovery.message);
        }
      }

      // Call retry callback
      if (onRetry && attempt < maxRetries) {
        onRetry(attempt, lastError);
        await new Promise(resolve => setTimeout(resolve, delay));
        continue;
      }

      // Last attempt failed
      if (attempt === maxRetries) {
        break;
      }
    }
  }

  // All retries exhausted
  throw new Error(
    `Operation failed after ${maxRetries} attempts. ` +
    `Last error: ${lastError?.message || 'Unknown error'}`
  );
}

/**
 * WSL-specific error recovery
 */
export async function recoverWSLErrors(): Promise<RecoveryResult> {
  if (!isWSL()) {
    return {
      success: true,
      action: 'wsl-check',
      message: 'Not running on WSL, no recovery needed',
      recovered: false
    };
  }

  console.log('🔍 Detected WSL environment, applying fixes...');

  try {
    const homeDir = os.homedir();

    // Check if running from Windows mount
    const cwd = process.cwd();
    if (cwd.startsWith('/mnt/')) {
      console.warn('⚠️  WARNING: Running from Windows filesystem (/mnt/)');
      console.warn('   For best results, run from WSL filesystem (e.g., ~/projects/)');
    }

    // Ensure build tools are available
    try {
      execSync('which gcc', { stdio: 'pipe' });
    } catch {
      console.warn('⚠️  build-essential not found. Install with:');
      console.warn('   sudo apt-get update && sudo apt-get install -y build-essential python3');
    }

    // Clean cache with WSL-specific handling
    return await cleanNpmCache();
  } catch (error) {
    return {
      success: false,
      action: 'wsl-recovery',
      message: `WSL recovery failed: ${error instanceof Error ? error.message : String(error)}`,
      recovered: false
    };
  }
}

/**
 * Verify better-sqlite3 installation
 */
export async function verifyBetterSqlite3(): Promise<boolean> {
  try {
    require.resolve('better-sqlite3');
    return true;
  } catch {
    return false;
  }
}

/**
 * Install better-sqlite3 with retry and error recovery
 */
export async function installBetterSqlite3WithRecovery(): Promise<RecoveryResult> {
  console.log('📦 Installing better-sqlite3...');

  return retryWithRecovery(
    async () => {
      execSync('npm install better-sqlite3 --no-save', {
        stdio: 'inherit',
        cwd: process.cwd()
      });

      // Verify installation
      if (await verifyBetterSqlite3()) {
        return {
          success: true,
          action: 'install-sqlite',
          message: 'better-sqlite3 installed successfully',
          recovered: true
        };
      } else {
        throw new Error('Installation completed but module not found');
      }
    },
    {
      maxRetries: 3,
      delay: 2000,
      onRetry: (attempt, error) => {
        console.log(`⚠️  Install attempt ${attempt} failed: ${error.message}`);
        console.log('🔄 Cleaning cache and retrying...');
      }
    }
  );
}

/**
 * Comprehensive error recovery for initialization
 */
export async function recoverInitErrors(error: any): Promise<RecoveryResult> {
  console.log('\n🚨 Error detected during initialization');
  console.log(`   Error: ${error?.message || String(error)}\n`);

  // WSL-specific recovery
  if (isWSL()) {
    console.log('🔧 Applying WSL-specific fixes...');
    const wslRecovery = await recoverWSLErrors();
    if (!wslRecovery.success) {
      return wslRecovery;
    }
  }

  // npm cache error recovery
  if (isNpmCacheError(error)) {
    console.log('🔧 Detected npm cache error, attempting recovery...');
    const cacheRecovery = await cleanNpmCache();
    if (!cacheRecovery.success) {
      return cacheRecovery;
    }

    // Try to reinstall better-sqlite3
    if (!await verifyBetterSqlite3()) {
      console.log('🔧 better-sqlite3 missing, attempting reinstall...');
      return await installBetterSqlite3WithRecovery();
    }

    return {
      success: true,
      action: 'error-recovery',
      message: 'Cache cleaned and dependencies verified',
      recovered: true
    };
  }

  // Generic error handling
  return {
    success: false,
    action: 'error-recovery',
    message: `Unable to automatically recover from error: ${error?.message || String(error)}`,
    recovered: false
  };
}

/**
 * Export utility functions
 */
export const errorRecovery = {
  isNpmCacheError,
  isNativeModuleVersionError,
  getNativeModuleRecoveryMessage,
  isWSL,
  cleanNpmCache,
  retryWithRecovery,
  recoverWSLErrors,
  verifyBetterSqlite3,
  installBetterSqlite3WithRecovery,
  recoverInitErrors
};
