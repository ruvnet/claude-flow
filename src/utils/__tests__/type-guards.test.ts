/**
 * Tests for type guard utilities
 */

import { isDefined, safeStringAccess, safeArrayAccess, conditionalSpread, conditionalValue } from '../type-guards';

describe('Type Guards', () => {
  describe('isDefined', () => {
    test('returns true for defined values', () => {
      expect(isDefined('hello')).toBe(true);
      expect(isDefined(0)).toBe(true);
      expect(isDefined(false)).toBe(true);
      expect(isDefined([])).toBe(true);
      expect(isDefined({})).toBe(true);
    });

    test('returns false for undefined', () => {
      expect(isDefined(undefined)).toBe(false);
    });

    test('provides type narrowing', () => {
      const value: string | undefined = Math.random() > 0.5 ? 'test' : undefined;
      
      if (isDefined(value)) {
        // TypeScript should know value is string here
        expect(typeof value).toBe('string');
        expect(value.length).toBeGreaterThanOrEqual(0);
      }
    });
  });

  describe('safeStringAccess', () => {
    test('returns array element when it exists', () => {
      const arr = ['first', 'second', 'third'];
      expect(safeStringAccess(arr, 0)).toBe('first');
      expect(safeStringAccess(arr, 1)).toBe('second');
      expect(safeStringAccess(arr, 2)).toBe('third');
    });

    test('returns empty string for out-of-bounds access', () => {
      const arr = ['first', 'second'];
      expect(safeStringAccess(arr, 5)).toBe('');
      expect(safeStringAccess(arr, -1)).toBe('');
    });

    test('returns empty string for empty array', () => {
      expect(safeStringAccess([], 0)).toBe('');
    });
  });

  describe('safeArrayAccess', () => {
    test('returns array element when it exists', () => {
      const arr = [1, 2, 3];
      expect(safeArrayAccess(arr, 0)).toBe(1);
      expect(safeArrayAccess(arr, 1)).toBe(2);
      expect(safeArrayAccess(arr, 2)).toBe(3);
    });

    test('returns undefined for out-of-bounds access', () => {
      const arr = [1, 2];
      expect(safeArrayAccess(arr, 5)).toBeUndefined();
      expect(safeArrayAccess(arr, -1)).toBeUndefined();
    });
  });

  describe('conditionalSpread', () => {
    test('returns object when condition is true', () => {
      const obj = { a: 1, b: 2 };
      expect(conditionalSpread(true, obj)).toEqual(obj);
    });

    test('returns empty object when condition is false', () => {
      const obj = { a: 1, b: 2 };
      expect(conditionalSpread(false, obj)).toEqual({});
    });
  });

  describe('conditionalValue', () => {
    test('returns object with key-value when value is defined', () => {
      expect(conditionalValue('test', 'name')).toEqual({ name: 'test' });
      expect(conditionalValue(42, 'count')).toEqual({ count: 42 });
    });

    test('returns empty object when value is undefined', () => {
      expect(conditionalValue(undefined, 'name')).toEqual({});
    });
  });
});