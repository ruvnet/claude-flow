/// <reference types="jest" />
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

/**
 * Test utilities for Claude-Flow
 */

// Jest test functions
export const { describe, it, beforeEach, afterEach, beforeAll, afterAll } = globalThis;

// Jest assertion helpers
export function assertEquals<T>(actual: T, expected: T, message?: string): void {
  expect(actual).toEqual(expected);
}

export function assertExists<T>(actual: T, message?: string): asserts actual is NonNullable<T> {
  expect(actual).toBeDefined();
  expect(actual).not.toBeNull();
}

export function assertStringIncludes(actual: string, expected: string, message?: string): void {
  expect(actual).toContain(expected);
}

export async function assertRejects(
  fn: () => Promise<unknown>,
  errorClass?: new (...args: any[]) => Error,
  msgIncludes?: string
): Promise<Error> {
  await expect(fn).rejects.toThrow(errorClass);
  return new Error('Test assertion helper');
}

export function assertThrows(
  fn: () => unknown,
  errorClass?: new (...args: any[]) => Error,
  msgIncludes?: string
): Error {
  expect(fn).toThrow(errorClass);
  return new Error('Test assertion helper');
}

// Jest spy helpers
export const spy = jest.fn;
export const stub = jest.fn;

export function assertSpyCall(spyFn: jest.SpyInstance, callIndex: number, expectedArgs?: any[]): void {
  expect(spyFn).toHaveBeenNthCalledWith(callIndex + 1).toBe( ...(expectedArgs || []));
}

export function assertSpyCalls(spyFn: jest.SpyInstance, callCount: number): void {
  expect(spyFn).toHaveBeenCalledTimes(callCount);
}

// Fake timers helper
export class FakeTime {
  constructor() {
    jest.useFakeTimers();
  }

  tick(ms: number): void {
    jest.advanceTimersByTime(ms);
  }

  tickAsync(ms: number): Promise<void> {
    jest.advanceTimersByTime(ms);
    return Promise.resolve();
  }

  restore(): void {
    jest.useRealTimers();
  }
}

/**
 * Creates a test fixture
 */
export function createFixture<T>(factory: () => T): {
  get(): T;
  reset(): void;
} {
  let instance: T;

  return {
    get(): T {
      if (!instance) {
        instance = factory();
      }
      return instance;
    },
    reset(): void {
      instance = factory();
    },
  };
}

/**
 * Waits for a condition to be true
 */
export async function waitFor(
  condition: () => boolean | Promise<boolean>,
  options: { timeout?: number; interval?: number } = {},
): Promise<void> {
  const { timeout = 5000, interval = 100 } = options;
  const start = Date.now();

  while (Date.now() - start < timeout) {
    if (await condition()) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, interval));
  }

  throw new Error('Timeout waiting for condition');
}

/**
 * Creates a deferred promise for testing
 */
export function createDeferred<T>(): {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (reason?: any) => void;
} {
  let resolve: (value: T) => void;
  let reject: (reason?: any) => void;

  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });

  return { promise, resolve: resolve!, reject: reject! };
}

/**
 * Captures console output during test
 */
export function captureConsole(): {
  getOutput(): string[];
  getErrors(): string[];
  restore(): void;
} {
  const output: string[] = [];
  const errors: string[] = [];

  const originalLog = console.log;
  const originalError = console.error;
  const originalDebug = console.debug;
  const originalInfo = console.info;
  const originalWarn = console.warn;

  console.log = (...args: any[]) => output.push(args.join(' '));
  console.error = (...args: any[]) => errors.push(args.join(' '));
  console.debug = (...args: any[]) => output.push(args.join(' '));
  console.info = (...args: any[]) => output.push(args.join(' '));
  console.warn = (...args: any[]) => output.push(args.join(' '));

  return {
    getOutput: () => [...output],
    getErrors: () => [...errors],
    restore: () => {
      console.log = originalLog;
      console.error = originalError;
      console.debug = originalDebug;
      console.info = originalInfo;
      console.warn = originalWarn;
    },
  };
}

/**
 * Creates a test file in a temporary directory
 */
export async function createTestFile(
  path: string,
  content: string,
): Promise<string> {
  const tempDir =  fs.mkdtempSync(path.join(os.tmpdir(), "claude-flow-test-"));
  const filePath = `${tempDir}/${path}`;
  const dir = filePath.substring(0, filePath.lastIndexOf('/'));
  
      // TODO: Replace with mock - // TODO: Replace with mock -   await Deno.mkdir(dir, { recursive: true });
  fs.writeFileSync(filePath,  content, "utf8");
  
  return filePath;
}

/**
 * Runs a CLI command and captures output
 */
export async function runCommand(
  args: string[],
  options: { stdin?: string; env?: Record<string, string> } = {},
): Promise<{ stdout: string; stderr: string; code: number }> {
  const cmdOptions: Deno.CommandOptions = {
    args: ['run', '--allow-all', 'src/cli/index.ts', ...args],
    stdout: 'piped',
    stderr: 'piped',
  };

  if (options.stdin) {
    cmdOptions.stdin = 'piped';
  }

  if (options.env) {
    cmdOptions.env = options.env;
  }

      // TODO: Implement mock command execution
