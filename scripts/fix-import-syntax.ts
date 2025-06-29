#!/usr/bin/env node

import { readFileSync, writeFileSync } from 'fs';
import glob from 'glob';

/**
 * Fix malformed imports that have ['js'] or similar bracket notation
 * This was caused by overly aggressive bracket notation fixes
 */

function fixImportSyntax() {
  const files = glob.sync('src/**/*.ts');
  let totalFixed = 0;
  
  for (const file of files) {
    try {
      const content = readFileSync(file, 'utf-8');
      
      // Fix imports with ['js'] pattern
      const fixedContent = content
        // Fix import statements with ['js'] or similar
        .replace(/from\s+'([^']+)\[['"]js['"]\]'/g, "from '$1.js'")
        .replace(/from\s+"([^"]+)\[['"]js['"]\]"/g, 'from "$1.js"')
        // Fix any ['js'] at the end of import paths
        .replace(/(['"])([^'"]+)\[['"]js['"]\]\1/g, '$1$2.js$1')
        // Remove ['js'] that was incorrectly added to module names
        .replace(/\['js'\]/g, '');
      
      if (content !== fixedContent) {
        writeFileSync(file, fixedContent);
        totalFixed++;
        console.log(`Fixed imports in: ${file}`);
      }
    } catch (error) {
      console.error(`Error processing ${file}:`, error);
    }
  }
  
  console.log(`\n✅ Fixed imports in ${totalFixed} files`);
}

fixImportSyntax();