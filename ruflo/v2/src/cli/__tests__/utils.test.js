/**
 * Tests for utils.js
 */

import { jest } from '@jest/globals';
import {
  parseFlags,
  formatBytes,
  truncateString,
  printSuccess,
  printError,
  printWarning,
  printInfo,
  validateArgs,
  generateId,
  retry,
  sleep,
  chunk,
  isValidJson,
  isValidUrl,
  formatTimestamp,
} from '../utils.js';

// Mock console for testing output functions
let consoleLogSpy;
let consoleErrorSpy;

beforeEach(() => {
  consoleLogSpy = jest.spyOn(console, 'log').mockImplementation();
  consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation();
});

afterEach(() => {
  consoleLogSpy.mockRestore();
  consoleErrorSpy.mockRestore();
});

describe('Utils', () => {
  describe('parseFlags', () => {
    test('should parse boolean flags', () => {
      const result = parseFlags(['--verbose', '--force']);
      expect(result.flags).toEqual({ verbose: true, force: true });
      expect(result.args).toEqual([]);
    });

    test('should parse value flags', () => {
      const result = parseFlags(['--port', '8080', '--name', 'test']);
      expect(result.flags).toEqual({ port: '8080', name: 'test' });
      expect(result.args).toEqual([]);
    });

    test('should parse mixed flags and arguments', () => {
      const result = parseFlags(['arg1', '--flag', 'value', 'arg2', '--bool']);
      expect(result.flags).toEqual({ flag: 'value', bool: true });
      expect(result.args).toEqual(['arg1', 'arg2']);
    });

    test('should handle short flags', () => {
      const result = parseFlags(['-vf', '--port', '8080']);
      expect(result.flags).toEqual({ v: true, f: true, port: '8080' });
      expect(result.args).toEqual([]);
    });

    test('should handle empty input', () => {
      const result = parseFlags([]);
      expect(result.flags).toEqual({});
      expect(result.args).toEqual([]);
    });
  });

  describe('formatBytes', () => {
    test('should format bytes to human readable', () => {
      expect(formatBytes(0)).toBe('0.00 B');
      expect(formatBytes(1024)).toBe('1.00 KB');
      expect(formatBytes(1048576)).toBe('1.00 MB');
      expect(formatBytes(1073741824)).toBe('1.00 GB');
    });

    test('should handle large numbers', () => {
      expect(formatBytes(2048)).toBe('2.00 KB');
      expect(formatBytes(1536)).toBe('1.50 KB');
    });
  });

  describe('truncateString', () => {
    test('should truncate long strings', () => {
      expect(truncateString('Hello World', 5)).toBe('Hello...');
      expect(truncateString('Short', 10)).toBe('Short');
    });

    test('should handle empty string', () => {
      expect(truncateString('', 5)).toBe('');
    });

    test('should use default length', () => {
      const longString = 'a'.repeat(150);
      const result = truncateString(longString);
      expect(result).toBe('a'.repeat(100) + '...');
    });
  });

  describe('print functions', () => {
    test('printSuccess should log success message', () => {
      printSuccess('Test message');
      expect(consoleLogSpy).toHaveBeenCalledWith('✅ Test message');
    });

    test('printError should log error message', () => {
      printError('Error message');
      expect(consoleLogSpy).toHaveBeenCalledWith('❌ Error message');
    });

    test('printWarning should log warning message', () => {
      printWarning('Warning message');
      expect(consoleLogSpy).toHaveBeenCalledWith('⚠️  Warning message');
    });

    test('printInfo should log info message', () => {
      printInfo('Info message');
      expect(consoleLogSpy).toHaveBeenCalledWith('ℹ️  Info message');
    });
  });

  describe('validateArgs', () => {
    test('should return true for valid arguments', () => {
      const result = validateArgs(['arg1', 'arg2'], 2, 'command <arg1> <arg2>');
      expect(result).toBe(true);
    });

    test('should return false and print error for insufficient arguments', () => {
      const result = validateArgs(['arg1'], 2, 'command <arg1> <arg2>');
      expect(result).toBe(false);
      expect(consoleLogSpy).toHaveBeenCalledWith('❌ Usage: command <arg1> <arg2>');
    });
  });

  describe('generateId', () => {
    test('should generate unique IDs', () => {
      const id1 = generateId();
      const id2 = generateId();

      expect(id1).not.toBe(id2);
      expect(id1.length).toBeGreaterThan(0);
      expect(typeof id1).toBe('string');
    });

    test('should generate ID with prefix', () => {
      const id = generateId('user');
      expect(id).toMatch(/^user-\d+-[a-z0-9]+$/);
    });
  });

  describe('retry', () => {
    test('should retry on failure', async () => {
      let attempts = 0;
      const fn = jest.fn(async () => {
        attempts++;
        if (attempts < 3) throw new Error('Failed');
        return 'success';
      });

      const result = await retry(fn, 3, 10);

      expect(result).toBe('success');
      expect(fn).toHaveBeenCalledTimes(3);
    });

    test('should fail after max retries', async () => {
      const fn = jest.fn(async () => {
        throw new Error('Always fails');
      });

      await expect(retry(fn, 2, 10)).rejects.toThrow('Always fails');
      expect(fn).toHaveBeenCalledTimes(2);
    });
  });

  describe('sleep', () => {
    test('should delay execution', async () => {
      const start = Date.now();
      await sleep(50);
      const end = Date.now();

      expect(end - start).toBeGreaterThanOrEqual(45); // Allow some margin
    });
  });

  describe('chunk', () => {
    test('should split array into chunks', () => {
      const array = [1, 2, 3, 4, 5, 6, 7];
      const result = chunk(array, 3);

      expect(result).toEqual([[1, 2, 3], [4, 5, 6], [7]]);
    });

    test('should handle empty array', () => {
      const result = chunk([], 3);
      expect(result).toEqual([]);
    });

    test('should handle chunk size larger than array', () => {
      const result = chunk([1, 2], 5);
      expect(result).toEqual([[1, 2]]);
    });
  });

  describe('isValidJson', () => {
    test('should validate correct JSON', () => {
      expect(isValidJson('{"key":"value"}')).toBe(true);
      expect(isValidJson('[1,2,3]')).toBe(true);
      expect(isValidJson('"string"')).toBe(true);
      expect(isValidJson('123')).toBe(true);
    });

    test('should reject invalid JSON', () => {
      expect(isValidJson('{"key":}')).toBe(false);
      expect(isValidJson('invalid')).toBe(false);
      expect(isValidJson('')).toBe(false);
    });
  });

  describe('isValidUrl', () => {
    test('should validate correct URLs', () => {
      expect(isValidUrl('https://example.com')).toBe(true);
      expect(isValidUrl('http://localhost:8080')).toBe(true);
      expect(isValidUrl('ftp://files.example.com')).toBe(true);
    });

    test('should reject invalid URLs', () => {
      expect(isValidUrl('not a url')).toBe(false);
      expect(isValidUrl('example.com')).toBe(false);
      expect(isValidUrl('')).toBe(false);
    });
  });

  describe('formatTimestamp', () => {
    test('should format timestamp to readable string', () => {
      const timestamp = 1234567890000; // Fixed timestamp
      const result = formatTimestamp(timestamp);

      expect(typeof result).toBe('string');
      expect(result.length).toBeGreaterThan(0);
    });

    test('should handle current timestamp', () => {
      const now = Date.now();
      const result = formatTimestamp(now);

      expect(typeof result).toBe('string');
      expect(result).toContain('2025'); // Should contain current year
    });
  });
});
