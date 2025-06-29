#!/usr/bin/env node
/**
 * Fix malformed string literals in TypeScript files
 */

import { readFileSync, writeFileSync } from 'fs';
import glob from 'glob';

async function fixStringLiterals() {
  console.log('🔍 Scanning for malformed string literals...');
  
  // Find all TypeScript files
  const files = glob.sync('src/**/*.{ts,js}', { 
    ignore: ['**/node_modules/**', '**/dist/**', '**/build/**']
  });
  
  console.log(`📁 Found ${files.length} files to check`);
  
  let totalFixed = 0;
  const fixedFiles: { file: string; fixes: string[] }[] = [];
  
  for (const file of files) {
    try {
      const content = readFileSync(file, 'utf-8');
      let fixedContent = content;
      const fixes: string[] = [];
      
      // Fix pattern: ["string, "string, "string] -> ["string", "string", "string"]
      // This regex looks for arrays with missing quotes
      fixedContent = fixedContent.replace(
        /\[([^\]]+)\]/g, 
        (match, arrayContent) => {
          // Check if this looks like a malformed string array
          if (arrayContent.includes(', "') && arrayContent.includes('"')) {
            // Split by comma and fix each element
            const elements = arrayContent.split(',').map(elem => {
              elem = elem.trim();
              // If element starts with " but doesn't end with ", add the closing quote
              if (elem.startsWith('"') && !elem.endsWith('"')) {
                fixes.push(`Fixed missing closing quote: ${elem}`);
                return elem + '"';
              }
              // If element doesn't start with " but looks like it should be a string
              if (!elem.startsWith('"') && !elem.startsWith("'") && 
                  elem.match(/^[A-Za-z][A-Za-z0-9\-_.]*\.(md|ts|js|json|yaml|yml|txt|log)$/)) {
                fixes.push(`Added quotes to: ${elem}`);
                return `"${elem}"`;
              }
              return elem;
            });
            
            if (fixes.length > 0) {
              totalFixed += fixes.length;
              return '[' + elements.join(', ') + ']';
            }
          }
          return match;
        }
      );
      
      // Fix another common pattern: incomplete string literals
      // Pattern: "string without closing quote at end of line
      const lines = fixedContent.split('\n');
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        
        // Count quotes in the line
        const doubleQuotes = (line.match(/"/g) || []).length;
        const singleQuotes = (line.match(/'/g) || []).length;
        
        // If odd number of quotes and line doesn't end with quote or semicolon
        if (doubleQuotes % 2 === 1 && !line.trim().endsWith('"') && !line.trim().endsWith(';')) {
          // Check if it looks like a string that needs closing
          const lastQuoteIndex = line.lastIndexOf('"');
          if (lastQuoteIndex > 0) {
            const afterQuote = line.substring(lastQuoteIndex + 1);
            // If after the quote there's only whitespace or a comma/bracket
            if (afterQuote.match(/^[^"]*[,\]\);\s]*$/)) {
              lines[i] = line.substring(0, lastQuoteIndex + 1) + 
                        afterQuote.replace(/([,\]\);])/g, '"$1');
              fixes.push(`Fixed unclosed string on line ${i + 1}`);
              totalFixed++;
            }
          }
        }
      }
      
      if (fixes.length > 0) {
        fixedContent = lines.join('\n');
      }
      
      if (fixedContent !== content) {
        writeFileSync(file, fixedContent, 'utf-8');
        fixedFiles.push({ file, fixes });
        console.log(`✅ Fixed ${fixes.length} issues in ${file}`);
      }
    } catch (error) {
      console.error(`❌ Error processing ${file}:`, error);
    }
  }
  
  console.log('\n📊 Summary:');
  console.log(`✅ Fixed ${totalFixed} string literal issues in ${fixedFiles.length} files`);
  
  if (fixedFiles.length > 0) {
    console.log('\n📝 Modified files and fixes:');
    fixedFiles.forEach(({ file, fixes }) => {
      console.log(`  - ${file}:`);
      fixes.forEach(fix => console.log(`    • ${fix}`));
    });
  }
}

// Run the fix
fixStringLiterals().catch(console.error);