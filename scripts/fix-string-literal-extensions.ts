#!/usr/bin/env tsx

/**
 * Agent 17 - Pattern Application Specialist 
 * Fix incorrect bracket notation in string literals for file extensions
 * 
 * Problem: The bracket notation fix script incorrectly converted file extensions
 * within string literals from '.json' to ['json'], causing syntax errors.
 * 
 * This script corrects string literals back to proper syntax.
 */

import { readFileSync, writeFileSync } from 'fs';
import glob from 'glob';

// Patterns to match file extensions incorrectly converted in string literals
const STRING_EXTENSION_PATTERNS = [
  // Single quoted strings with bracket notation extensions
  /('.*?)\['([a-zA-Z0-9]+)'\](')/g,
  // Double quoted strings with bracket notation extensions  
  /(".*?)\['([a-zA-Z0-9]+)'\](")/g,
  // Template literals with bracket notation extensions
  /(`.*?)\['([a-zA-Z0-9]+)'\](`)/g,
];

interface FixResult {
  file: string;
  fixesApplied: number;
  errors: string[];
}

function fixStringLiteralExtensions(content: string): { content: string; fixCount: number } {
  let fixCount = 0;
  
  for (const pattern of STRING_EXTENSION_PATTERNS) {
    content = content.replace(pattern, (match, prefix, ext, suffix) => {
      // Only fix if it looks like a file extension (.js, .json, .ts, etc.)
      if (/^[a-zA-Z0-9]{1,5}$/.test(ext)) {
        fixCount++;
        return `${prefix}.${ext}${suffix}`;
      }
      return match;
    });
  }
  
  return { content, fixCount };
}

function processFile(filePath: string): FixResult {
  const result: FixResult = {
    file: filePath,
    fixesApplied: 0,
    errors: []
  };
  
  try {
    const originalContent = readFileSync(filePath, 'utf-8');
    const { content: newContent, fixCount } = fixStringLiteralExtensions(originalContent);
    
    if (fixCount > 0) {
      writeFileSync(filePath, newContent, 'utf-8');
      result.fixesApplied = fixCount;
      console.log(`✅ Fixed ${fixCount} string literal extensions in ${filePath}`);
    }
  } catch (error) {
    const errorMsg = `Error processing ${filePath}: ${error instanceof Error ? error.message : 'Unknown error'}`;
    result.errors.push(errorMsg);
    console.error(`❌ ${errorMsg}`);
  }
  
  return result;
}

function main() {
  console.log('🔧 Agent 17 - Pattern Application Specialist');
  console.log('🎯 Fixing incorrect bracket notation in string literal file extensions');
  console.log('');
  
  // Find TypeScript files that might have string literal extension issues
  const tsFiles = glob.sync('src/**/*.ts');
  
  console.log(`📁 Found ${tsFiles.length} TypeScript files to process`);
  console.log('');
  
  const results: FixResult[] = [];
  let totalFixes = 0;
  let totalErrors = 0;
  
  for (const file of tsFiles) {
    const result = processFile(file);
    results.push(result);
    totalFixes += result.fixesApplied;
    totalErrors += result.errors.length;
  }
  
  // Summary
  console.log('');
  console.log('📊 Summary:');
  console.log(`✅ Total files processed: ${results.length}`);
  console.log(`🔧 Total fixes applied: ${totalFixes}`);
  console.log(`❌ Total errors: ${totalErrors}`);
  
  if (totalErrors > 0) {
    console.log('');
    console.log('❌ Files with errors:');
    results.forEach(result => {
      if (result.errors.length > 0) {
        console.log(`  - ${result.file}: ${result.errors.join(', ')}`);
      }
    });
  }
  
  if (totalFixes > 0) {
    console.log('');
    console.log('✅ Files successfully fixed:');
    results.forEach(result => {
      if (result.fixesApplied > 0) {
        console.log(`  - ${result.file}: ${result.fixesApplied} fixes`);
      }
    });
  }
  
  console.log('');
  console.log('🎉 String literal extension fix complete!');
  console.log('💡 Next: Run `npm run typecheck` to verify the fixes');
}

// Run if this is the main module
main();

export { fixStringLiteralExtensions, processFile };