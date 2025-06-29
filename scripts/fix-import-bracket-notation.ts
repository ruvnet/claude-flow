#!/usr/bin/env node
/**
 * Fix import paths that were incorrectly changed to bracket notation
 * Change ['js'] and ['ts'] back to .js and .ts in import paths
 */

import { readFileSync, writeFileSync, readdirSync, statSync } from 'fs';
import * as path from 'path';

function findTsFiles(dir: string): string[] {
  const results: string[] = [];
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
  
  return results;
}

async function fixImportBracketNotation() {
  console.log('Fixing incorrect bracket notation in import paths...');
  
  // Find all TypeScript files
  const files = findTsFiles('/workspaces/claude-code-flow/src');
  
  let totalFixes = 0;
  
  for (const fullPath of files) {
    const relativePath = path.relative('/workspaces/claude-code-flow', fullPath);
    try {
      const content = readFileSync(fullPath, 'utf-8');
      const lines = content.split('\n');
      let modified = false;
      
      for (let i = 0; i < lines.length; i++) {
        const originalLine = lines[i];
        let fixedLine = originalLine;
        
        // Fix import paths: ['js'] -> .js and ['ts'] -> .ts
        fixedLine = fixedLine.replace(/\['js'\]/g, '.js');
        fixedLine = fixedLine.replace(/\['ts'\]/g, '.ts');
        fixedLine = fixedLine.replace(/\["js"\]/g, '.js');
        fixedLine = fixedLine.replace(/\["ts"\]/g, '.ts');
        
        // Fix more specific patterns that might occur in imports
        fixedLine = fixedLine.replace(/\.js\['js'\]/g, '.js');
        fixedLine = fixedLine.replace(/\.ts\['ts'\]/g, '.ts');
        
        if (fixedLine !== originalLine) {
          lines[i] = fixedLine;
          modified = true;
          totalFixes++;
        }
      }
      
      if (modified) {
        writeFileSync(fullPath, lines.join('\n'));
        console.log(`✓ Fixed ${relativePath}`);
      }
    } catch (error) {
      console.error(`Error processing ${relativePath}:`, error);
    }
  }
  
  console.log(`\n✅ Fixed ${totalFixes} import bracket notation issues`);
  return totalFixes;
}

// Run if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  fixImportBracketNotation().catch(console.error);
}

export { fixImportBracketNotation };