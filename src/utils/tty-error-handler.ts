/**
 * TTY Error Handler - Hardened stream reading with EIO recovery
 * 
 * Implements comprehensive TTY error handling to prevent crashes
 * in CI/CD environments, containers, SSH sessions, and other
 * non-interactive environments.
 * 
 * Key features:
 * - Graceful handling of EIO (Input/Output) errors
 * - ENOTTY error recovery
 * - Fallback to non-interactive mode
 * - Safe readline interface creation
 * - Process-wide TTY availability checking
 */

import * as readline from 'readline';
import { Readable, Writable } from 'stream';

/**
 * Check if TTY is available and functional
 */
export function isTTYAvailable(): boolean {
  try {
    return !!(
      process.stdin && 
      process.stdout && 
      process.stdin.isTTY && 
      process.stdout.isTTY &&
      process.stdin.readable &&
      process.stdout.writable
    );
  } catch {
    return false;
  }
}

/**
 * Creates a safe readline interface that gracefully handles TTY errors
 * Returns null if TTY is unavailable rather than crashing
 * 
 * This function is the primary defense against EIO errors that can
 * occur in various environments where TTY operations are restricted.
 */
export async function createSafeReadlineInterface(): Promise<readline.Interface | null> {
  try {
    // Check if we have valid TTY streams
    if (!process.stdin || !process.stdout) {
      console.warn('⚠️ TTY streams unavailable - running in non-interactive mode');
      return null;
    }

    // Test if we can actually read/write to streams
    if (!process.stdin.readable || !process.stdout.writable) {
      console.warn('⚠️ TTY streams not accessible - running in non-interactive mode');
      return null;
    }

    // Create readline interface with error handling
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
      terminal: process.stdin.isTTY && process.stdout.isTTY
    });

    // Add error handlers to prevent crashes
    const handleError = (error: Error) => {
      if (error.message.includes('EIO') || 
          error.message.includes('ENOTTY') ||
          error.message.includes('Input/output error')) {
        console.warn('⚠️ TTY error detected - falling back to non-interactive mode');
        rl.close();
        return null;
      }
      // Re-throw other errors
      throw error;
    };

    rl.on('error', handleError);
    process.stdin.on('error', handleError);
    process.stdout.on('error', handleError);

    // Test the interface with a simple operation
    // This helps catch errors early before they cause crashes
    try {
      // Create a promise that resolves quickly to test the interface
      await new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, 10);
        rl.once('close', () => {
          clearTimeout(timer);
          resolve();
        });
      });
      
      return rl;
    } catch (testError) {
      console.warn('⚠️ TTY interface test failed - falling back to non-interactive mode');
      try {
        rl.close();
      } catch {
        // Ignore close errors
      }
      return null;
    }
  } catch (error) {
    // Log but don't crash on readline creation errors
    if (error instanceof Error) {
      if (error.message.includes('EIO') || 
          error.message.includes('ENOTTY') ||
          error.message.includes('Input/output error')) {
        console.warn('⚠️ TTY initialization failed - running in non-interactive mode');
      } else {
        console.warn('⚠️ Unable to create readline interface:', error.message);
      }
    }
    return null;
  }
}

/**
 * Wrapper function that executes TTY operations with fallback
 * 
 * @param ttyOperation - Function to execute if TTY is available
 * @param fallbackOperation - Function to execute if TTY is not available
 * @returns Result from either the TTY operation or fallback
 */
export async function withSafeTTY<T>(
  ttyOperation: (rl: readline.Interface) => Promise<T>,
  fallbackOperation: () => T | Promise<T>
): Promise<T> {
  const rl = await createSafeReadlineInterface();
  
  if (rl) {
    try {
      return await ttyOperation(rl);
    } finally {
      rl.close();
    }
  } else {
    return await fallbackOperation();
  }
}

/**
 * Safe question prompt that handles TTY errors gracefully
 * 
 * @param question - The question to ask
 * @param defaultAnswer - Default answer if TTY is not available
 * @returns User's answer or default
 */
export async function safeQuestion(question: string, defaultAnswer: string = ''): Promise<string> {
  return withSafeTTY(
    async (rl) => {
      return new Promise<string>((resolve) => {
        rl.question(question, (answer) => {
          resolve(answer || defaultAnswer);
        });
      });
    },
    () => {
      console.log(`${question} [Using default: ${defaultAnswer}]`);
      return defaultAnswer;
    }
  );
}

/**
 * Safe confirmation prompt that handles TTY errors gracefully
 * 
 * @param message - The confirmation message
 * @param defaultConfirm - Default confirmation if TTY is not available
 * @returns User's confirmation or default
 */
export async function safeConfirm(message: string, defaultConfirm: boolean = false): Promise<boolean> {
  return withSafeTTY(
    async (rl) => {
      return new Promise<boolean>((resolve) => {
        rl.question(`${message} (y/n) `, (answer) => {
          resolve(answer.toLowerCase() === 'y' || answer.toLowerCase() === 'yes');
        });
      });
    },
    () => {
      const confirmText = defaultConfirm ? 'yes' : 'no';
      console.log(`${message} [Using default: ${confirmText}]`);
      return defaultConfirm;
    }
  );
}

/**
 * Create a mock readline interface for testing or non-TTY environments
 * This can be useful for automated testing or CI/CD pipelines
 */
export function createMockReadlineInterface(
  responses: Map<string, string> = new Map()
): readline.Interface {
  const mockRl = Object.create(readline.Interface.prototype);
  
  mockRl.question = (query: string, callback: (answer: string) => void) => {
    const response = responses.get(query) || '';
    setTimeout(() => callback(response), 0);
  };
  
  mockRl.close = () => {
    // No-op
  };
  
  mockRl.on = () => mockRl;
  mockRl.once = () => mockRl;
  mockRl.emit = () => true;
  
  return mockRl;
}

/**
 * Export all functions as a namespace for convenience
 */
export const TTYErrorHandler = {
  isTTYAvailable,
  createSafeReadlineInterface,
  withSafeTTY,
  safeQuestion,
  safeConfirm,
  createMockReadlineInterface
};
