#!/usr/bin/env node

import { readFileSync, writeFileSync } from 'fs';
import glob from 'glob';
import path from 'path';

interface Fix {
  file: string;
  line: number;
  original: string;
  fixed: string;
  type: string;
}

async function fixTSSyntaxErrors() {
  console.log('Scanning for TypeScript syntax errors...');
  
  // Get all TypeScript files in src/
  const files = glob.sync('src/**/*.ts', { 
    cwd: '/workspaces/claude-code-flow',
    absolute: true,
    ignore: ['**/node_modules/**', '**/dist/**']
  });
  
  const fixes: Fix[] = [];
  let totalModified = 0;
  
  for (const filePath of files) {
    try {
      const content = readFileSync(filePath, 'utf-8');
      const lines = content.split('\n');
      let modified = false;
      
      for (let i = 0; i < lines.length; i++) {
        const originalLine = lines[i];
        let fixedLine = originalLine;
        
        // Fix 1: Import statements with bracket notation ['js'] -> .js
        if (fixedLine.includes("['js']")) {
          fixedLine = fixedLine.replace(/\['js'\]/g, '.js');
          if (fixedLine !== originalLine) {
            fixes.push({
              file: filePath,
              line: i + 1,
              original: originalLine.trim(),
              fixed: fixedLine.trim(),
              type: 'import-bracket-notation'
            });
            modified = true;
          }
        }
        
        // Fix 2: File paths with malformed bracket notation like 'entries['json'] -> 'entries.json'
        if (fixedLine.includes("['json']") && !fixedLine.includes("import")) {
          fixedLine = fixedLine.replace(/\['json'\]/g, '.json');
          if (fixedLine !== originalLine) {
            fixes.push({
              file: filePath,
              line: i + 1,
              original: originalLine.trim(),
              fixed: fixedLine.trim(),
              type: 'path-bracket-notation'
            });
            modified = true;
          }
        }
        
        // Fix 3: Array/object property access where dot notation should be used
        // Fix patterns like array['length'] -> array.length
        if (fixedLine.includes("['length']")) {
          fixedLine = fixedLine.replace(/\['length'\]/g, '.length');
          if (fixedLine !== originalLine) {
            fixes.push({
              file: filePath,
              line: i + 1,
              original: originalLine.trim(),
              fixed: fixedLine.trim(),
              type: 'array-length-access'
            });
            modified = true;
          }
        }
        
        // Fix 4: Empty bracket access like someVar[] -> needs to be fixed case by case
        // Check for patterns like variable[] with no content
        if (fixedLine.match(/\w+\[\]/)) {
          // This needs manual inspection as it's often a syntax error
          console.log(`Warning: Empty bracket access found in ${filePath}:${i + 1}: ${originalLine.trim()}`);
        }
        
        // Fix 5: CLI flags access patterns
        // Fix patterns like ctx.flags['option'] that should use dot notation if possible
        // But keep them as bracket notation for dynamic property access
        
        lines[i] = fixedLine;
      }
      
      if (modified) {
        writeFileSync(filePath, lines.join('\n'));
        totalModified++;
        console.log(`✓ Fixed ${path.relative('/workspaces/claude-code-flow', filePath)}`);
      }
      
    } catch (error) {
      console.error(`Error processing ${filePath}:`, error);
    }
  }
  
  console.log(`\nFixed ${fixes.length} syntax errors in ${totalModified} files`);
  
  // Save detailed report
  const report = {
    timestamp: new Date().toISOString(),
    totalFixes: fixes.length,
    filesModified: totalModified,
    fixTypes: fixes.reduce((acc, fix) => {
      acc[fix.type] = (acc[fix.type] || 0) + 1;
      return acc;
    }, {} as Record<string, number>),
    fixes: fixes
  };
  
  writeFileSync(
    '/workspaces/claude-code-flow/typescript-syntax-fixes.json',
    JSON.stringify(report, null, 2)
  );
  
  return fixes;
}

// Run if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  fixTSSyntaxErrors().catch(console.error);
}

export { fixTSSyntaxErrors };