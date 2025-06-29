#!/usr/bin/env node

import { readFileSync, writeFileSync } from 'fs';
import glob from 'glob';

/**
 * Fix all bracket notation syntax errors introduced by overly aggressive fixes
 */

function fixBracketSyntax() {
  const files = glob.sync('src/**/*.ts');
  let totalFixed = 0;
  const fixes: Array<{file: string, pattern: string}> = [];
  
  for (const file of files) {
    try {
      const content = readFileSync(file, 'utf-8');
      let fixedContent = content;
      
      // Fix patterns in order of complexity
      
      // 1. Fix import paths with ['js'] or similar
      fixedContent = fixedContent
        .replace(/from\s+'([^']+)\[['"]js['"]\]'/g, "from '$1.js'")
        .replace(/from\s+"([^"]+)\[['"]js['"]\]"/g, 'from "$1.js"');
      
      // 2. Fix file extensions in strings (e.g., 'file.config['json']' -> 'file.config.json')
      fixedContent = fixedContent
        .replace(/(\w+)\[['"](\w+)['"]\]'/g, "$1.$2'")
        .replace(/(\w+)\[['"](\w+)['"]\]"/g, '$1.$2"')
        .replace(/(\w+)\[['"](\w+)['"]\]/g, '$1.$2');
      
      // 3. Fix property access that shouldn't have bracket notation
      // e.g., process['env'] -> process.env (when 'env' is a valid identifier)
      fixedContent = fixedContent
        .replace(/(\w+)\[['"]([a-zA-Z_$][a-zA-Z0-9_$]*)['"]\]/g, (match, obj, prop) => {
          // Skip if it's a type definition or interface
          if (match.includes(':') || match.includes('<') || match.includes('>')) {
            return match;
          }
          // Skip common valid bracket notation cases
          if (['meta', 'json', 'js', 'ts', 'tsx', 'jsx'].includes(prop)) {
            return match;
          }
          // Skip if object looks like a variable that might need bracket notation
          if (obj.includes('.') || obj.includes('[') || obj.includes(']')) {
            return match;
          }
          fixes.push({file, pattern: `${obj}['${prop}'] -> ${obj}.${prop}`});
          return `${obj}.${prop}`;
        });
      
      // 4. Fix meta access pattern specifically
      fixedContent = fixedContent
        .replace(/import\['meta'\]/g, 'import.meta')
        .replace(/import\["meta"\]/g, 'import.meta');
      
      // 5. Fix object property definitions that shouldn't have quotes
      // But be careful not to break valid quoted properties
      
      if (content !== fixedContent) {
        writeFileSync(file, fixedContent);
        totalFixed++;
        console.log(`Fixed: ${file}`);
      }
    } catch (error) {
      console.error(`Error processing ${file}:`, error);
    }
  }
  
  console.log(`\n✅ Fixed ${totalFixed} files`);
  
  if (fixes.length > 0) {
    console.log('\nSpecific fixes applied:');
    const uniqueFixes = [...new Set(fixes.map(f => f.pattern))];
    uniqueFixes.forEach(pattern => {
      console.log(`  - ${pattern}`);
    });
  }
}

fixBracketSyntax();