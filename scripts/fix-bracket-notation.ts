#!/usr/bin/env node
/**
 * Automatically fix TS4111 errors by converting dot notation to bracket notation
 * for properties from index signatures
 */

import { readFileSync, writeFileSync } from 'fs';
import { glob } from 'glob';

interface Fix {
  file: string;
  line: number;
  original: string;
  fixed: string;
}

async function fixBracketNotation() {
  console.log('Scanning for TS4111 errors...');
  
  // Read build output to find TS4111 errors
  const buildOutput = readFileSync('build-output.log', 'utf-8');
  const errorLines = buildOutput.split('\n').filter(line => line.includes('error TS4111'));
  
  const fixes: Fix[] = [];
  const fileMap = new Map<string, Set<number>>();
  
  // Parse errors
  errorLines.forEach(line => {
    // Example: src/utils/colors.ts(36,30): error TS4111: Property 'NO_COLOR' comes from an index signature, so it must be accessed with ['NO_COLOR'].
    const match = line.match(/^(.*?)\((\d+),(\d+)\): error TS4111: Property '([^']+)' comes from an index signature/);
    if (match) {
      const [, file, lineNum, colNum, property] = match;
      if (!fileMap.has(file)) {
        fileMap.set(file, new Set());
      }
      fileMap.get(file)!.add(parseInt(lineNum));
    }
  });
  
  console.log(`Found ${errorLines.length} TS4111 errors in ${fileMap.size} files`);
  
  // Process each file
  for (const [filePath, lineNumbers] of fileMap.entries()) {
    try {
      const content = readFileSync(filePath, 'utf-8');
      const lines = content.split('\n');
      let modified = false;
      
      // Sort line numbers in reverse order to avoid offset issues
      const sortedLineNumbers = Array.from(lineNumbers).sort((a, b) => b - a);
      
      sortedLineNumbers.forEach(lineNum => {
        const lineIndex = lineNum - 1; // Convert to 0-based index
        if (lineIndex >= 0 && lineIndex < lines.length) {
          const originalLine = lines[lineIndex];
          
          // Common patterns to fix:
          // process.env.VARIABLE -> process.env['VARIABLE']
          // ctx.flags.property -> ctx.flags['property'] (CLI options)
          // obj.property -> obj['property'] (when from index signature)
          
          // Skip import statements completely
          if (originalLine.trim().startsWith('import ') || originalLine.trim().startsWith('export ')) {
            return;
          }
          
          // Pattern 1: process.env.PROPERTY
          let fixedLine = originalLine.replace(
            /process\.env\.([A-Z_][A-Z0-9_]*)/g,
            "process.env['$1']"
          );
          
          // Pattern 2: CLI flags pattern ctx.flags.property (most common in our case)
          if (fixedLine === originalLine) {
            fixedLine = originalLine.replace(
              /(\b\w+\.flags)\.([a-zA-Z_][a-zA-Z0-9_-]*)/g,
              "$1['$2']"
            );
          }
          
          // Pattern 3: Other object property access (but be more careful)
          if (fixedLine === originalLine) {
            // Only fix specific known patterns that cause TS4111
            // Look for patterns like: someObj.property where property needs brackets
            fixedLine = originalLine.replace(
              /(\b(?:ctx\.flags|options|config|params|args|data|result)\.[\w\[\]'"]*)\.([a-zA-Z_][a-zA-Z0-9_-]*)/g,
              (match, prefix, property) => {
                // Don't fix if it's already in brackets or quotes
                if (prefix.includes('[') || prefix.includes("'") || prefix.includes('"')) {
                  return match;
                }
                return `${prefix}['${property}']`;
              }
            );
          }
          
          if (fixedLine !== originalLine) {
            lines[lineIndex] = fixedLine;
            modified = true;
            fixes.push({
              file: filePath,
              line: lineNum,
              original: originalLine.trim(),
              fixed: fixedLine.trim()
            });
          }
        }
      });
      
      if (modified) {
        writeFileSync(filePath, lines.join('\n'));
        console.log(`✓ Fixed ${filePath}`);
      }
    } catch (error) {
      console.error(`Error processing ${filePath}:`, error);
    }
  }
  
  // Write fix report
  const report = {
    timestamp: new Date().toISOString(),
    totalFixes: fixes.length,
    filesModified: fileMap.size,
    fixes: fixes.slice(0, 20) // Sample of fixes
  };
  
  writeFileSync(
    'memory/data/typescript-strict-final-push/agent-4/bracket-notation-fixes.json',
    JSON.stringify(report, null, 2)
  );
  
  console.log(`\nCompleted ${fixes.length} fixes in ${fileMap.size} files`);
  console.log('Re-run build to verify fixes');
  
  return fixes;
}

// Run if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  fixBracketNotation().catch(console.error);
}

export { fixBracketNotation };