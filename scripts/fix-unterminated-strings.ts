#!/usr/bin/env node
/**
 * Fix unterminated string literals in TypeScript/JavaScript files
 */

import { readFileSync, writeFileSync } from 'fs';
import glob from 'glob';

interface StringFix {
  file: string;
  line: number;
  original: string;
  fixed: string;
  issue: string;
}

async function fixUnterminatedStrings() {
  console.log('🔍 Scanning for unterminated string literals...');
  
  const files = glob.sync('src/**/*.{ts,js}', { 
    ignore: ['**/node_modules/**', '**/dist/**', '**/build/**']
  });
  
  console.log(`📁 Found ${files.length} files to check`);
  
  const fixes: StringFix[] = [];
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
        
        // Fix 1: Array with missing quotes
        // Pattern: ["string, "string, "string]
        const arrayPattern = /\[((?:"[^"]*(?:,\s*)?)+)\]/g;
        let match;
        while ((match = arrayPattern.exec(line)) !== null) {
          const arrayContent = match[1];
          // Check for missing quotes by counting quotes
          const quoteCount = (arrayContent.match(/"/g) || []).length;
          
          if (quoteCount % 2 !== 0) {
            // Odd number of quotes means missing quotes
            // Fix by ensuring each string has both quotes
            const fixedArray = arrayContent
              .split(',')
              .map(item => {
                const trimmed = item.trim();
                if (trimmed.startsWith('"') && !trimmed.endsWith('"')) {
                  return trimmed + '"';
                }
                return trimmed;
              })
              .join(', ');
            
            const fixedFullArray = `[${fixedArray}]`;
            fixedLine = fixedLine.substring(0, match.index) + fixedFullArray + fixedLine.substring(match.index + match[0].length);
            
            fixes.push({
              file,
              line: lineNum,
              original: line.trim(),
              fixed: fixedLine.trim(),
              issue: 'Missing closing quotes in array'
            });
            lines[i] = fixedLine;
            modified = true;
            totalFixed++;
          }
        }
        
        // Fix 2: Methods array pattern
        // Pattern: methods=.POST)
        const methodsPattern = /methods=\.(\w+)\)/g;
        if (methodsPattern.test(line)) {
          fixedLine = fixedLine.replace(methodsPattern, "methods=['$1'])");
          if (fixedLine !== line) {
            fixes.push({
              file,
              line: lineNum,
              original: line.trim(),
              fixed: fixedLine.trim(),
              issue: 'Missing array brackets in methods'
            });
            lines[i] = fixedLine;
            modified = true;
            totalFixed++;
          }
        }
        
        // Fix 3: Object property patterns with missing quotes
        // Pattern: { key: "value, key2: "value2 }
        const objectPattern = /\{([^}]+)\}/g;
        let objMatch;
        while ((objMatch = objectPattern.exec(line)) !== null) {
          const objContent = objMatch[1];
          const keyValuePairs = objContent.split(',');
          let needsFix = false;
          
          const fixedPairs = keyValuePairs.map(pair => {
            const colonIndex = pair.indexOf(':');
            if (colonIndex === -1) return pair;
            
            const key = pair.substring(0, colonIndex).trim();
            const value = pair.substring(colonIndex + 1).trim();
            
            // Check if value starts with quote but doesn't end with one
            if (value.startsWith('"') && !value.endsWith('"')) {
              needsFix = true;
              return `${key}: ${value}"`;
            } else if (value.startsWith("'") && !value.endsWith("'")) {
              needsFix = true;
              return `${key}: ${value}'`;
            }
            
            return pair;
          });
          
          if (needsFix) {
            const fixedObject = `{${fixedPairs.join(',')}}`;
            fixedLine = fixedLine.substring(0, objMatch.index) + fixedObject + fixedLine.substring(objMatch.index + objMatch[0].length);
            
            fixes.push({
              file,
              line: lineNum,
              original: line.trim(),
              fixed: fixedLine.trim(),
              issue: 'Missing closing quotes in object'
            });
            lines[i] = fixedLine;
            modified = true;
            totalFixed++;
          }
        }
        
        // Fix 4: General unterminated strings (simple case)
        // Count quotes and check for imbalance
        const doubleQuotes = (line.match(/"/g) || []).length;
        const singleQuotes = (line.match(/'/g) || []).length;
        
        // Skip if line contains template literals or regex
        if (line.includes('`') || line.includes('/${') || /\/[^\/]+\/[gimuy]*/.test(line)) {
          continue;
        }
        
        // Very simple fix for obvious cases
        if (doubleQuotes % 2 !== 0 && !line.includes('\\"')) {
          // Find last opening quote without closing
          const lastQuoteIndex = fixedLine.lastIndexOf('"');
          if (lastQuoteIndex !== -1) {
            // Check if there's a comma, bracket, or paren after where quote should be
            const afterQuote = fixedLine.substring(lastQuoteIndex + 1);
            if (afterQuote.match(/^[^"]*[,\)\]\}]/)) {
              // Insert closing quote before the delimiter
              const delimMatch = afterQuote.match(/[,\)\]\}]/);
              if (delimMatch && delimMatch.index !== undefined) {
                const insertPos = lastQuoteIndex + 1 + delimMatch.index;
                fixedLine = fixedLine.substring(0, insertPos) + '"' + fixedLine.substring(insertPos);
                
                fixes.push({
                  file,
                  line: lineNum,
                  original: line.trim(),
                  fixed: fixedLine.trim(),
                  issue: 'Missing closing double quote'
                });
                lines[i] = fixedLine;
                modified = true;
                totalFixed++;
              }
            }
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
  console.log(`✅ Fixed ${totalFixed} unterminated strings in ${new Set(fixes.map(f => f.file)).size} files`);
  
  if (fixes.length > 0) {
    console.log('\n📝 Detailed fixes:');
    // Group by issue type
    const byIssue = fixes.reduce((acc, fix) => {
      if (!acc[fix.issue]) acc[fix.issue] = [];
      acc[fix.issue].push(fix);
      return acc;
    }, {} as Record<string, StringFix[]>);
    
    for (const [issue, issueFixes] of Object.entries(byIssue)) {
      console.log(`\n${issue} (${issueFixes.length} fixes):`);
      issueFixes.slice(0, 5).forEach(fix => {
        console.log(`  ${fix.file}:${fix.line}`);
        console.log(`    - ${fix.original}`);
        console.log(`    + ${fix.fixed}`);
      });
      if (issueFixes.length > 5) {
        console.log(`  ... and ${issueFixes.length - 5} more`);
      }
    }
  }
}

// Run the fix
fixUnterminatedStrings().catch(console.error);