#!/usr/bin/env node
/**
 * Revert overly aggressive bracket notation conversions
 * Fix patterns that were incorrectly converted by the bracket notation script
 */

import { readFileSync, writeFileSync, readdirSync, statSync } from 'fs';
import * as path from 'path';

function findTsFiles(dir: string): string[] {
  const results: string[] = [];
  try {
    const items = readdirSync(dir);
    
    for (const item of items) {
      const fullPath = path.join(dir, item);
      const stat = statSync(fullPath);
      
      if (stat.isDirectory()) {
        results.push(...findTsFiles(fullPath));
      } else if (item.endsWith('.ts')) {
        results.push(fullPath);
      }
    }
  } catch (error) {
    // Skip directories that can't be read
  }
  
  return results;
}

async function fixAggressiveBracketNotation() {
  console.log('Reverting overly aggressive bracket notation conversions...');
  
  const files = findTsFiles('/workspaces/claude-code-flow/src');
  let totalFixes = 0;
  
  for (const fullPath of files) {
    const relativePath = path.relative('/workspaces/claude-code-flow', fullPath);
    try {
      let content = readFileSync(fullPath, 'utf-8');
      const originalContent = content;
      let fileFixCount = 0;
      
      // Fix file extensions in strings: '.json', '.txt', '.md', etc.
      content = content.replace(/\['(json|txt|md|csv|xml|yaml|yml|log|sql|html|css|js|ts)'\]/g, '.$1');
      content = content.replace(/\["(json|txt|md|csv|xml|yaml|yml|log|sql|html|css|js|ts)"\]/g, '.$1');
      
      // Fix length property access: arr['length'] -> arr.length
      content = content.replace(/\['length'\]/g, '.length');
      content = content.replace(/\["length"\]/g, '.length');
      
      // Fix common array methods that were incorrectly converted
      const arrayMethods = ['push', 'pop', 'shift', 'unshift', 'slice', 'splice', 'sort', 'reverse', 
                           'join', 'concat', 'indexOf', 'includes', 'find', 'filter', 'map', 'reduce',
                           'forEach', 'some', 'every', 'toString', 'valueOf'];
      
      for (const method of arrayMethods) {
        content = content.replace(new RegExp(`\\['${method}'\\]`, 'g'), `.${method}`);
        content = content.replace(new RegExp(`\\["${method}"\\]`, 'g'), `.${method}`);
      }
      
      // Fix common object methods
      const objectMethods = ['toString', 'valueOf', 'hasOwnProperty', 'isPrototypeOf', 'propertyIsEnumerable'];
      
      for (const method of objectMethods) {
        content = content.replace(new RegExp(`\\['${method}'\\]`, 'g'), `.${method}`);
        content = content.replace(new RegExp(`\\["${method}"\\]`, 'g'), `.${method}`);
      }
      
      // Fix Date methods
      const dateMethods = ['getTime', 'getFullYear', 'getMonth', 'getDate', 'getHours', 'getMinutes', 
                          'getSeconds', 'getMilliseconds', 'toISOString', 'toJSON', 'toString'];
      
      for (const method of dateMethods) {
        content = content.replace(new RegExp(`\\['${method}'\\]`, 'g'), `.${method}`);
        content = content.replace(new RegExp(`\\["${method}"\\]`, 'g'), `.${method}`);
      }
      
      // Fix numeric indices that were incorrectly quoted
      content = content.replace(/\['(\d+)'\]/g, '[$1]');
      content = content.replace(/\["(\d+)"\]/g, '[$1]');
      
      // Fix string access in object literals (inside strings)
      content = content.replace(/'([^']*)\['([^']+)'\]'/g, "'$1.$2'");
      content = content.replace(/"([^"]*)\["([^"]+)"\]/g, '"$1.$2"');
      
      // Fix common patterns that shouldn't be bracket notation
      // Function calls that got converted
      content = content.replace(/(\w+)\['(\w+)'\]\(/g, '$1.$2(');
      content = content.replace(/(\w+)\["(\w+)"\]\(/g, '$1.$2(');
      
      // Fix template literals and string concatenation patterns
      content = content.replace(/`([^`]*)\['([^']+)'\]([^`]*)`/g, '`$1.$2$3`');
      
      // Count the number of changes
      const lines = content.split('\n');
      const originalLines = originalContent.split('\n');
      
      for (let i = 0; i < lines.length; i++) {
        if (lines[i] !== originalLines[i]) {
          fileFixCount++;
        }
      }
      
      if (content !== originalContent) {
        writeFileSync(fullPath, content);
        console.log(`✓ Fixed ${relativePath} (${fileFixCount} changes)`);
        totalFixes += fileFixCount;
      }
      
    } catch (error) {
      console.error(`Error processing ${relativePath}:`, error);
    }
  }
  
  console.log(`\n✅ Reverted ${totalFixes} overly aggressive bracket notation conversions`);
  return totalFixes;
}

// Run if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  fixAggressiveBracketNotation().catch(console.error);
}

export { fixAggressiveBracketNotation };