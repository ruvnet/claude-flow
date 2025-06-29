#!/usr/bin/env node
/**
 * Fix syntax errors that are preventing TypeScript from finding type errors
 */

import { readFileSync, writeFileSync } from 'fs';

interface SyntaxFix {
  file: string;
  line: number;
  original: string;
  fixed: string;
  errorType: string;
}

async function fixSyntaxErrors() {
  console.log('Fixing syntax errors from build output...');
  
  const buildOutput = readFileSync('build-output.log', 'utf-8');
  const fixes: SyntaxFix[] = [];
  
  // Fix specific known syntax errors
  const filesToFix = [
    {
      path: '/workspaces/claude-code-flow/src/terminal/adapters/native.ts',
      fixes: [
        { line: 217, from: "args: .--no-rcs,", to: "args: ['--no-rcs']," }
      ]
    }
  ];
  
  for (const fileToFix of filesToFix) {
    try {
      const content = readFileSync(fileToFix.path, 'utf-8');
      const lines = content.split('\n');
      let modified = false;
      
      for (const fix of fileToFix.fixes) {
        const lineIndex = fix.line - 1;
        if (lineIndex >= 0 && lineIndex < lines.length) {
          const originalLine = lines[lineIndex];
          if (originalLine.includes(fix.from)) {
            lines[lineIndex] = originalLine.replace(fix.from, fix.to);
            modified = true;
            fixes.push({
              file: fileToFix.path,
              line: fix.line,
              original: originalLine.trim(),
              fixed: lines[lineIndex].trim(),
              errorType: 'syntax'
            });
          }
        }
      }
      
      if (modified) {
        writeFileSync(fileToFix.path, lines.join('\n'));
        console.log(`✓ Fixed ${fileToFix.path}`);
      }
    } catch (error) {
      console.error(`Error processing ${fileToFix.path}:`, error);
    }
  }
  
  // Parse and fix other syntax errors from build output
  const errorLines = buildOutput.split('\n').filter(line => line.includes('error TS'));
  const fileMap = new Map<string, { line: number; error: string }[]>();
  
  errorLines.forEach(line => {
    const match = line.match(/^(.*?)\((\d+),(\d+)\): error (TS\d+): (.+)$/);
    if (match) {
      const [, file, lineNum, colNum, errorCode, message] = match;
      if (!fileMap.has(file)) {
        fileMap.set(file, []);
      }
      fileMap.get(file)!.push({
        line: parseInt(lineNum),
        error: `${errorCode}: ${message}`
      });
    }
  });
  
  console.log(`\nCompleted ${fixes.length} syntax fixes`);
  console.log('Re-run build to check for type errors');
  
  return fixes;
}

// Run if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  fixSyntaxErrors().catch(console.error);
}

export { fixSyntaxErrors };