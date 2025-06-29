#!/usr/bin/env node
/**
 * Fix TS2375/TS2379 exactOptionalPropertyTypes errors
 * These occur when assigning objects with undefined values to optional properties
 */

import { readFileSync, writeFileSync } from 'fs';

interface ExactOptionalFix {
  file: string;
  line: number;
  column: number;
  original: string;
  fixed: string;
  errorType: 'TS2375' | 'TS2379';
}

// Parse the exact optional errors from the error file
function parseExactOptionalErrors(): ExactOptionalFix[] {
  const errorText = readFileSync('/workspaces/claude-code-flow/typescript-exact-optional-errors-current.txt', 'utf-8');
  const lines = errorText.split('\n').filter(line => line.trim());
  
  const fixes: ExactOptionalFix[] = [];
  
  lines.forEach(line => {
    // Parse format: src/file.ts(line,col): error TS2375: message
    const match = line.match(/^(\d+)→(.+?)\((\d+),(\d+)\): error (TS2375|TS2379):/);
    if (match) {
      const [, , file, lineNum, colNum, errorType] = match;
      fixes.push({
        file,
        line: parseInt(lineNum),
        column: parseInt(colNum),
        original: '',
        fixed: '',
        errorType: errorType as 'TS2375' | 'TS2379'
      });
    }
  });
  
  return fixes;
}

// Fix strategies for different types of exactOptionalPropertyTypes errors
function fixExactOptionalProperty(file: string, line: number, content: string): string {
  const lines = content.split('\n');
  const lineIndex = line - 1;
  
  if (lineIndex < 0 || lineIndex >= lines.length) {
    return content;
  }
  
  const originalLine = lines[lineIndex];
  let fixedLine = originalLine;
  
  // Strategy 1: Object assignment with potentially undefined values
  // Convert: { prop: value | undefined } to { ...(value !== undefined && { prop: value }) }
  
  // Strategy 2: Handle specific patterns we see in the errors
  
  // Pattern for message-bus.ts: expiresAt: Date | undefined
  if (file.includes('message-bus.ts') && originalLine.includes('expiresAt:')) {
    fixedLine = originalLine.replace(
      /expiresAt:\s*([^,}]+)/,
      '...(expiresAt !== undefined && { expiresAt: $1 })'
    );
  }
  
  // Pattern for protocol-manager.ts: listChanged: boolean | undefined
  if (file.includes('protocol-manager.ts') && originalLine.includes('listChanged:')) {
    fixedLine = originalLine.replace(
      /{\s*listChanged:\s*([^,}]+)\s*}/,
      '{ ...(listChanged !== undefined && { listChanged: $1 }) }'
    );
    
    // Handle more complex objects with multiple optional properties
    fixedLine = fixedLine.replace(
      /{\s*listChanged:\s*([^,}]+),\s*subscribe:\s*([^,}]+)\s*}/,
      '{ ...(listChanged !== undefined && { listChanged: $1 }), ...(subscribe !== undefined && { subscribe: $2 }) }'
    );
  }
  
  // Pattern for memory files: various optional properties
  if (file.includes('memory/') && originalLine.includes('undefined')) {
    // Handle ttl: number | undefined
    fixedLine = fixedLine.replace(
      /ttl:\s*([^,}]+)/,
      '...(ttl !== undefined && { ttl: $1 })'
    );
    
    // Handle metadata: Record<string, any> | undefined
    fixedLine = fixedLine.replace(
      /metadata:\s*([^,}]+)/,
      '...(metadata !== undefined && { metadata: $1 })'
    );
    
    // Handle parentId: string | undefined
    fixedLine = fixedLine.replace(
      /parentId:\s*([^,}]+)/,
      '...(parentId !== undefined && { parentId: $1 })'
    );
  }
  
  // Pattern for process-registry: parentId: undefined
  if (file.includes('process-registry/') && originalLine.includes('parentId: undefined')) {
    // Simply omit the property when it's undefined
    fixedLine = originalLine.replace(
      /\s*parentId:\s*undefined,?\s*/,
      ''
    );
  }
  
  // Pattern for swarm files: backward?: CopyResult
  if (file.includes('swarm/') && originalLine.includes('backward:')) {
    fixedLine = originalLine.replace(
      /backward:\s*([^,}]+)/,
      '...(backward !== undefined && { backward: $1 })'
    );
  }
  
  // Pattern for task files: various optional schedule properties
  if (file.includes('task/') && originalLine.includes('undefined')) {
    // Handle schedule properties
    fixedLine = fixedLine.replace(
      /startTime:\s*([^,}]+)/,
      '...(startTime !== undefined && { startTime: $1 })'
    );
    
    fixedLine = fixedLine.replace(
      /deadline:\s*([^,}]+)/,
      '...(deadline !== undefined && { deadline: $1 })'
    );
    
    fixedLine = fixedLine.replace(
      /timezone:\s*([^,}]+)/,
      '...(timezone !== undefined && { timezone: $1 })'
    );
    
    fixedLine = fixedLine.replace(
      /recurring:\s*([^,}]+)/,
      '...(recurring !== undefined && { recurring: $1 })'
    );
    
    fixedLine = fixedLine.replace(
      /assignedAgent:\s*([^,}]+)/,
      '...(assignedAgent !== undefined && { assignedAgent: $1 })'
    );
  }
  
  // Generic pattern: handle function arguments with optional properties
  // For TS2379 errors: convert argument objects to omit undefined values
  if (originalLine.includes('undefined') && originalLine.includes(':')) {
    // Use bracket notation for optional properties when value might be undefined
    fixedLine = fixedLine.replace(
      /(\w+):\s*([^,}]+\s*\|\s*undefined)/g,
      '...($2 !== undefined && { $1: $2 })'
    );
  }
  
  if (fixedLine !== originalLine) {
    lines[lineIndex] = fixedLine;
    return lines.join('\n');
  }
  
  return content;
}

// Main function to apply all fixes
async function fixAllExactOptionalErrors(): Promise<ExactOptionalFix[]> {
  console.log('Fixing TS2375/TS2379 exactOptionalPropertyTypes errors...');
  
  const errors = parseExactOptionalErrors();
  console.log(`Found ${errors.length} exactOptionalPropertyTypes errors`);
  
  const fixes: ExactOptionalFix[] = [];
  const processedFiles = new Set<string>();
  
  for (const error of errors) {
    if (processedFiles.has(error.file)) {
      continue; // Skip already processed files
    }
    
    try {
      const content = readFileSync(error.file, 'utf-8');
      const originalContent = content;
      
      // Apply fixes for this file
      let fixedContent = content;
      const fileErrors = errors.filter(e => e.file === error.file);
      
      for (const fileError of fileErrors) {
        fixedContent = fixExactOptionalProperty(error.file, fileError.line, fixedContent);
      }
      
      if (fixedContent !== originalContent) {
        writeFileSync(error.file, fixedContent);
        console.log(`✓ Fixed ${error.file} (${fileErrors.length} errors)`);
        
        // Record the fixes
        fileErrors.forEach(fileError => {
          fixes.push({
            ...fileError,
            original: originalContent.split('\n')[fileError.line - 1]?.trim() || '',
            fixed: fixedContent.split('\n')[fileError.line - 1]?.trim() || ''
          });
        });
      }
      
      processedFiles.add(error.file);
    } catch (err) {
      console.error(`Error processing ${error.file}:`, err);
    }
  }
  
  return fixes;
}

// Run if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  fixAllExactOptionalErrors().then(fixes => {
    console.log(`\nCompleted ${fixes.length} exactOptionalPropertyTypes fixes`);
    console.log('Re-run build to verify fixes');
  }).catch(console.error);
}

export { fixAllExactOptionalErrors };