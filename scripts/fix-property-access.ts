#!/usr/bin/env tsx

/**
 * Agent 17 - Pattern Application Specialist 
 * Fix incorrect property access syntax from bracket notation fixes
 * 
 * Problem: The bracket notation fix scripts incorrectly converted some property
 * access patterns, causing various syntax errors.
 * 
 * This script corrects common property access issues.
 */

import { readFileSync, writeFileSync } from 'fs';
import glob from 'glob';

interface FixResult {
  file: string;
  fixesApplied: number;
  errors: string[];
}

function fixPropertyAccess(content: string): { content: string; fixCount: number } {
  let fixCount = 0;
  
  // Fix malformed aliases arrays: aliases: .something" -> aliases: ["something"]
  content = content.replace(/aliases:\s*\.([a-zA-Z0-9-_]+)"/g, (match, alias) => {
    fixCount++;
    return `aliases: ["${alias}"]`;
  });
  
  // Fix malformed property access: .property-name" -> ['property-name']
  content = content.replace(/\.([a-zA-Z0-9-_]+)"\s*(?=[,\]\)\}]|\s|$)/g, (match, prop) => {
    fixCount++;
    return `['${prop}']`;
  });
  
  // Fix unterminated property access: .property" at end of condition
  content = content.replace(/\.([a-zA-Z0-9-_]+)"\s*\)/g, (match, prop) => {
    fixCount++;
    return `['${prop}'])`;
  });
  
  // Fix malformed property chains in conditions
  content = content.replace(/\['flags'\]\.([a-zA-Z0-9-_]+)"/g, (match, prop) => {
    fixCount++;
    return `['flags']['${prop}']`;
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
    const { content: newContent, fixCount } = fixPropertyAccess(originalContent);
    
    if (fixCount > 0) {
      writeFileSync(filePath, newContent, 'utf-8');
      result.fixesApplied = fixCount;
      console.log(`✅ Fixed ${fixCount} property access issues in ${filePath}`);
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
  console.log('🎯 Fixing incorrect property access syntax');
  console.log('');
  
  // Find TypeScript files that might have property access issues
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
  console.log('🎉 Property access fix complete!');
  console.log('💡 Next: Run `npm run typecheck` to verify the fixes');
}

// Run if this is the main module
main();

export { fixPropertyAccess, processFile };