#!/usr/bin/env tsx

/**
 * Agent 17 - Pattern Application Specialist 
 * Fix incorrect bracket notation for import.meta.url
 * 
 * Problem: The bracket notation fix script incorrectly converted import.meta.url
 * to import['meta'].url, which is invalid syntax.
 * 
 * This script corrects import.meta back to proper syntax.
 */

import { readFileSync, writeFileSync } from 'fs';
import glob from 'glob';

const IMPORT_META_PATTERN = /import\['meta'\]/g;

interface FixResult {
  file: string;
  fixesApplied: number;
  errors: string[];
}

function fixImportMeta(content: string): { content: string; fixCount: number } {
  let fixCount = 0;
  
  // Fix import['meta'] -> import.meta
  content = content.replace(IMPORT_META_PATTERN, (match) => {
    fixCount++;
    return 'import.meta';
  });
  
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
    const { content: newContent, fixCount } = fixImportMeta(originalContent);
    
    if (fixCount > 0) {
      writeFileSync(filePath, newContent, 'utf-8');
      result.fixesApplied = fixCount;
      console.log(`✅ Fixed ${fixCount} import.meta references in ${filePath}`);
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
  console.log('🎯 Fixing incorrect bracket notation for import.meta');
  console.log('');
  
  // Find TypeScript files that might have import.meta issues
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
  console.log('🎉 import.meta fix complete!');
  console.log('💡 Next: Run `npm run typecheck` to verify the fixes');
}

// Run if this is the main module
main();

export { fixImportMeta, processFile };