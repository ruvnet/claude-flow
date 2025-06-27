#!/usr/bin/env node
/**
 * Script to convert Deno test files to Jest
 */

import { readFileSync, writeFileSync, readdirSync, statSync } from 'fs';
import { join, extname } from 'path';

const DENO_TO_JEST_MAPPINGS = {
  // Deno imports to remove (these are global in Jest)
  "import { describe, it, beforeEach, afterEach, beforeAll, afterAll } from 'https://deno.land/std@0.220.0/testing/bdd.ts';": '',
  'import { describe, it, beforeEach, afterEach, beforeAll, afterAll } from "https://deno.land/std@0.220.0/testing/bdd.ts";': '',
  
  // Assert functions
  "import { assertEquals, assertExists, assertRejects, assertThrows } from 'https://deno.land/std@0.220.0/assert/mod.ts';": '',
  'import { assertEquals, assertExists, assertRejects, assertThrows } from "https://deno.land/std@0.220.0/assert/mod.ts";': '',
  "import { assertEquals, assertExists, assertRejects, assertThrows, assertStringIncludes } from 'https://deno.land/std@0.220.0/assert/mod.ts';": '',
  'import { assertEquals, assertExists, assertRejects, assertThrows, assertStringIncludes } from "https://deno.land/std@0.220.0/assert/mod.ts";': '',
  
  // Mock functions
  "import { spy, stub, assertSpyCall, assertSpyCalls } from 'https://deno.land/std@0.220.0/testing/mock.ts';": '',
  'import { spy, stub, assertSpyCall, assertSpyCalls } from "https://deno.land/std@0.220.0/testing/mock.ts";': '',
  "import { spy, stub } from 'https://deno.land/std@0.220.0/testing/mock.ts';": '',
  'import { spy, stub } from "https://deno.land/std@0.220.0/testing/mock.ts";': '',
  
  // FakeTime
  "import { FakeTime } from 'https://deno.land/std@0.220.0/testing/time.ts';": '',
  'import { FakeTime } from "https://deno.land/std@0.220.0/testing/time.ts";': '',
  
  // Function replacements
  'assertEquals(': 'expect(',
  'assertExists(': 'expect(',
  'assertThrows(': 'expect(',
  'assertRejects(': 'expect(',
  'assertStringIncludes(': 'expect(',
  'assertSpyCall(': 'expect(',
  'assertSpyCalls(': 'expect(',
  
  // Spy/stub replacements
  'spy(': 'jest.spyOn(',
  'stub(': 'jest.spyOn(',
  
  // FakeTime replacement
  'new FakeTime()': 'jest.useFakeTimers()',
  'fakeTime.restore()': 'jest.useRealTimers()',
  'fakeTime.tick(': 'jest.advanceTimersByTime(',
};

// Additional patterns that need more complex replacements
const COMPLEX_REPLACEMENTS = [
  // assertEquals(a, b) -> expect(a).toBe(b) or expect(a).toEqual(b)
  {
    pattern: /assertEquals\(([^,]+),\s*([^)]+)\)/g,
    replacement: 'expect($1).toEqual($2)'
  },
  // assertExists(a) -> expect(a).toBeDefined()
  {
    pattern: /assertExists\(([^)]+)\)/g,
    replacement: 'expect($1).toBeDefined()'
  },
  // assertThrows(() => {...}, Error) -> expect(() => {...}).toThrow()
  {
    pattern: /assertThrows\(([^,]+),\s*([^)]+)\)/g,
    replacement: 'expect($1).toThrow($2)'
  },
  // assertRejects(async () => {...}, Error) -> await expect(async () => {...}).rejects.toThrow()
  {
    pattern: /assertRejects\(([^,]+),\s*([^)]+)\)/g,
    replacement: 'await expect($1).rejects.toThrow($2)'
  },
  // assertStringIncludes(str, substr) -> expect(str).toContain(substr)
  {
    pattern: /assertStringIncludes\(([^,]+),\s*([^)]+)\)/g,
    replacement: 'expect($1).toContain($2)'
  },
];

function convertFile(filePath: string): void {
  console.log(`Converting: ${filePath}`);
  
  let content = readFileSync(filePath, 'utf-8');
  let modified = false;
  
  // Apply simple string replacements
  for (const [from, to] of Object.entries(DENO_TO_JEST_MAPPINGS)) {
    if (content.includes(from)) {
      content = content.replace(new RegExp(from.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'), to);
      modified = true;
    }
  }
  
  // Apply complex regex replacements
  for (const { pattern, replacement } of COMPLEX_REPLACEMENTS) {
    const newContent = content.replace(pattern, replacement);
    if (newContent !== content) {
      content = newContent;
      modified = true;
    }
  }
  
  // Update import paths to use .js extensions
  content = content.replace(/from ['"]\.\.?\//g, (match) => {
    modified = true;
    return match;
  });
  
  // Add Jest types import if file uses Jest functions
  if (modified && !content.includes("import { jest }") && !content.includes('/// <reference types="jest"')) {
    content = `/// <reference types="jest" />\n\n${content}`;
  }
  
  // Remove empty lines created by import removals
  content = content.replace(/\n\n\n+/g, '\n\n');
  
  if (modified) {
    writeFileSync(filePath, content, 'utf-8');
    console.log(`✓ Converted: ${filePath}`);
  } else {
    console.log(`✗ No changes needed: ${filePath}`);
  }
}

function findTestFiles(dir: string): string[] {
  const files: string[] = [];
  
  function traverse(currentDir: string) {
    const entries = readdirSync(currentDir);
    
    for (const entry of entries) {
      const fullPath = join(currentDir, entry);
      const stat = statSync(fullPath);
      
      if (stat.isDirectory() && !entry.startsWith('.') && entry !== 'node_modules') {
        traverse(fullPath);
      } else if (stat.isFile() && entry.endsWith('.test.ts')) {
        files.push(fullPath);
      }
    }
  }
  
  traverse(dir);
  return files;
}

// Main execution
const testsDir = join(process.cwd(), 'tests');
const testFiles = findTestFiles(testsDir);

console.log(`Found ${testFiles.length} test files to convert\n`);

for (const file of testFiles) {
  try {
    convertFile(file);
  } catch (error) {
    console.error(`Error converting ${file}:`, error);
  }
}

// Also convert test.utils.ts and any other utility files
const utilFiles = [
  join(testsDir, 'test.utils.ts'),
  join(testsDir, 'utils', 'test-utils.ts'),
  join(testsDir, 'mocks', 'index.ts'),
];

for (const file of utilFiles) {
  try {
    if (statSync(file).isFile()) {
      convertFile(file);
    }
  } catch (error) {
    // File might not exist
  }
}

console.log('\nConversion complete!');