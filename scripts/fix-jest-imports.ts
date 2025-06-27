#!/usr/bin/env node
/**
 * Fix remaining Deno imports and Jest issues in test files
 */

import { readFileSync, writeFileSync, readdirSync, statSync } from 'fs';
import { join, extname } from 'path';

function fixTestFile(filePath: string): void {
  console.log(`Fixing: ${filePath}`);
  
  let content = readFileSync(filePath, 'utf-8');
  let modified = false;
  
  // Remove all Deno imports (they're global in Jest)
  const denoImportPattern = /import\s*{[^}]+}\s*from\s*["']https:\/\/deno\.land[^"']+["'];?\s*\n?/g;
  if (denoImportPattern.test(content)) {
    content = content.replace(denoImportPattern, '');
    modified = true;
  }
  
  // Remove FakeTime imports
  const fakeTimePattern = /import\s*{[^}]*FakeTime[^}]*}\s*from\s*["']https:\/\/deno\.land[^"']+["'];?\s*\n?/g;
  if (fakeTimePattern.test(content)) {
    content = content.replace(fakeTimePattern, '');
    modified = true;
  }
  
  // Fix spy/stub usage
  content = content.replace(/spy\(/g, 'jest.fn(');
  content = content.replace(/stub\(/g, 'jest.spyOn(');
  
  // Fix assertions
  content = content.replace(/assertEquals\(([^,]+),\s*([^)]+)\)/g, 'expect($1).toEqual($2)');
  content = content.replace(/assertExists\(([^)]+)\)/g, 'expect($1).toBeDefined()');
  content = content.replace(/assertThrows\(([^,]+),\s*([^)]+)\)/g, 'expect($1).toThrow($2)');
  content = content.replace(/assertRejects\(([^,]+),\s*([^)]+)\)/g, 'await expect($1).rejects.toThrow($2)');
  content = content.replace(/assertStringIncludes\(([^,]+),\s*([^)]+)\)/g, 'expect($1).toContain($2)');
  
  // Fix test utilities imports
  content = content.replace(/from\s+['"]\.\.\/([^'"]+)\.ts['"]/g, "from '../$1.js'");
  content = content.replace(/from\s+['"]\.\.\/\.\.\/([^'"]+)\.ts['"]/g, "from '../../$1.js'");
  content = content.replace(/from\s+['"]\.\.\/\.\.\/\.\.\/([^'"]+)\.ts['"]/g, "from '../../../$1.js'");
  content = content.replace(/from\s+['"]\.\.\/\.\.\/\.\.\/\.\.\/([^'"]+)\.ts['"]/g, "from '../../../../$1.js'");
  
  // Fix absolute imports from src
  content = content.replace(/from\s+['"]src\/([^'"]+)\.ts['"]/g, "from '../src/$1.js'");
  
  // Fix FakeTime usage
  content = content.replace(/new FakeTime\(\)/g, 'jest.useFakeTimers()');
  content = content.replace(/fakeTime\.restore\(\)/g, 'jest.useRealTimers()');
  content = content.replace(/fakeTime\.tick\(/g, 'jest.advanceTimersByTime(');
  
  // Clean up extra empty lines
  content = content.replace(/\n\n\n+/g, '\n\n');
  
  // Remove any remaining empty import blocks
  content = content.replace(/import\s*{\s*}\s*from\s*["'][^"']+["'];?\s*\n?/g, '');
  
  if (modified || content !== readFileSync(filePath, 'utf-8')) {
    writeFileSync(filePath, content, 'utf-8');
    console.log(`✓ Fixed: ${filePath}`);
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
      } else if (stat.isFile() && (entry.endsWith('.test.ts') || entry === 'test.utils.ts' || entry === 'test-utils.ts' || entry === 'index.ts')) {
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

console.log(`Found ${testFiles.length} test files to fix\n`);

for (const file of testFiles) {
  try {
    fixTestFile(file);
  } catch (error) {
    console.error(`Error fixing ${file}:`, error);
  }
}

console.log('\nFix complete!');