#!/usr/bin/env node
/**
 * Fix remaining syntax errors after bracket notation fixes
 */

import { readFileSync, writeFileSync } from 'fs';
import glob from 'glob';

interface Fix {
  file: string;
  line: number;
  original: string;
  fixed: string;
  pattern: string;
}

async function fixRemainingSyntaxErrors() {
  console.log('🔍 Scanning for remaining syntax errors...');
  
  const files = glob.sync('src/**/*.{ts,js}', { 
    ignore: ['**/node_modules/**', '**/dist/**', '**/build/**']
  });
  
  console.log(`📁 Found ${files.length} files to check`);
  
  const fixes: Fix[] = [];
  let totalFixed = 0;
  
  for (const file of files) {
    try {
      const content = readFileSync(file, 'utf-8');
      const lines = content.split('\n');
      let modified = false;
      
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const lineNum = i + 1;
        let fixedLine = line;
        
        // Fix 1: Double dots in optional chaining (?.. -> ?.)
        if (line.includes('?..')) {
          fixedLine = fixedLine.replace(/\?\.\./g, '?.');
          if (fixedLine !== line) {
            fixes.push({
              file,
              line: lineNum,
              original: line.trim(),
              fixed: fixedLine.trim(),
              pattern: 'Double dot in optional chaining'
            });
            lines[i] = fixedLine;
            modified = true;
            totalFixed++;
          }
        }
        
        // Fix 2: Missing quotes in array literals
        // Pattern: ["string, "string, "string] -> ["string", "string", "string"]
        const arrayPattern = /\[(\"[^"]*(?:,\s*\"[^"]*)*)\]/g;
        const arrayMatch = line.match(arrayPattern);
        if (arrayMatch) {
          const fixedArrayLine = line.replace(/\"([^",]+),\s*\"/g, '"$1", "');
          if (fixedArrayLine !== line) {
            fixes.push({
              file,
              line: lineNum,
              original: line.trim(),
              fixed: fixedArrayLine.trim(),
              pattern: 'Missing quotes in array literal'
            });
            lines[i] = fixedArrayLine;
            modified = true;
            totalFixed++;
          }
        }
        
        // Fix 3: dependencies: .identifier -> dependencies: ['identifier']
        const depPattern = /(\s*(?:dependencies|tags):\s*)\.(\w+)/;
        const depMatch = line.match(depPattern);
        if (depMatch) {
          fixedLine = line.replace(depPattern, "$1['$2']");
          if (fixedLine !== line) {
            fixes.push({
              file,
              line: lineNum,
              original: line.trim(),
              fixed: fixedLine.trim(),
              pattern: 'Missing array brackets in property'
            });
            lines[i] = fixedLine;
            modified = true;
            totalFixed++;
          }
        }
        
        // Fix 4: Incomplete expressions starting with dot
        // Pattern: return value || .Some text -> return value || ['Some text']
        const incompletePattern = /(\|\|\s*)\.([A-Z][^;]+)/;
        const incompleteMatch = line.match(incompletePattern);
        if (incompleteMatch) {
          fixedLine = line.replace(incompletePattern, "$1['$2']");
          if (fixedLine !== line) {
            fixes.push({
              file,
              line: lineNum,
              original: line.trim(),
              fixed: fixedLine.trim(),
              pattern: 'Incomplete expression with dot'
            });
            lines[i] = fixedLine;
            modified = true;
            totalFixed++;
          }
        }
      }
      
      if (modified) {
        writeFileSync(file, lines.join('\n'), 'utf-8');
        console.log(`✅ Fixed ${file}`);
      }
    } catch (error) {
      console.error(`❌ Error processing ${file}:`, error);
    }
  }
  
  console.log('\n📊 Summary:');
  console.log(`✅ Fixed ${totalFixed} syntax errors in ${new Set(fixes.map(f => f.file)).size} files`);
  
  if (fixes.length > 0) {
    console.log('\n📝 Detailed fixes:');
    // Group by pattern
    const byPattern = fixes.reduce((acc, fix) => {
      if (!acc[fix.pattern]) acc[fix.pattern] = [];
      acc[fix.pattern].push(fix);
      return acc;
    }, {} as Record<string, Fix[]>);
    
    for (const [pattern, patternFixes] of Object.entries(byPattern)) {
      console.log(`\n${pattern} (${patternFixes.length} fixes):`);
      patternFixes.slice(0, 5).forEach(fix => {
        console.log(`  ${fix.file}:${fix.line}`);
        console.log(`    - ${fix.original}`);
        console.log(`    + ${fix.fixed}`);
      });
      if (patternFixes.length > 5) {
        console.log(`  ... and ${patternFixes.length - 5} more`);
      }
    }
  }
}

// Run the fix
fixRemainingSyntaxErrors().catch(console.error);