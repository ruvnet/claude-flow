/**
 * V3 Hooks Tests Index
 *
 * Exports all hook tests for the V3 hooks system.
 *
 * @module v3/shared/hooks/__tests__
 */

// Test files are automatically discovered by vitest
// This file serves as documentation of available tests

export const testFiles = [
  './task-hooks.test.ts',
  './session-hooks.test.ts',
  './bash-safety.test.ts',
  './file-organization.test.ts',
  './git-commit.test.ts',
];

export const testCategories = {
  'Core Hooks': ['task-hooks.test.ts', 'session-hooks.test.ts'],
  'Safety Hooks': ['bash-safety.test.ts', 'file-organization.test.ts', 'git-commit.test.ts'],
};
