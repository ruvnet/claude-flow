#!/usr/bin/env node
/**
 * Fix remaining syntax errors in TypeScript files
 */

import { readFileSync, writeFileSync } from 'fs';
import glob from 'glob';

async function fixRemainingSyntax() {
  console.log('🔍 Scanning for remaining syntax errors...');
  
  // Target specific files with known syntax issues
  const targetFiles = [
    'src/cli/commands/index.ts',
    'src/cli/commands/sparc.ts',
    'src/cli/init/batch-tools.ts',
    'src/cli/init/claude-config.ts',
    'src/cli/node-repl.ts',
    'src/cli/repl.ts',
    'src/cli/simple-cli.js',
    'src/cli/simple-commands/init/sparc/roomodes-config.js',
    'src/mcp/auth.ts',
    'src/memory/advanced-memory-manager.ts',
    'src/persistence/sqlite/models/audit.ts',
    'src/security/input-validator.ts',
    'src/swarm/coordinator.ts',
    'src/swarm/sparc-executor.ts',
    'src/terminal/adapters/native.ts',
    'src/terminal/session.ts',
    'src/tracing/test-tracing.ts'
  ];
  
  let totalFixed = 0;
  const fixedFiles: { file: string; fixes: string[] }[] = [];
  
  for (const file of targetFiles) {
    try {
      if (!glob.sync(file).length) continue;
      
      const content = readFileSync(file, 'utf-8');
      let fixedContent = content;
      const fixes: string[] = [];
      
      // Fix pattern 1: Property access with quotes that should be dot notation
      // e.g., object["property"] -> object.property (but only for valid identifiers)
      fixedContent = fixedContent.replace(/(\w+)\["(\w+)"\]/g, (match, obj, prop) => {
        // Don't change if it's a reserved word or starts with number
        if (/^[a-zA-Z_$][a-zA-Z0-9_$]*$/.test(prop) && 
            !['length', 'size', 'name', 'value', 'type', 'id', 'key'].includes(prop)) {
          return `${obj}.${prop}`;
        }
        return match;
      });
      
      // Fix pattern 2: Missing semicolons at end of statements
      const lines = fixedContent.split('\n');
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim();
        
        // Add semicolons to lines that look like they need them
        if (line && !line.endsWith(';') && !line.endsWith(',') && 
            !line.endsWith('{') && !line.endsWith('}') && 
            !line.endsWith('(') && !line.endsWith(')') &&
            !line.endsWith('[') && !line.endsWith(']') &&
            !line.startsWith('//') && !line.startsWith('*') &&
            !line.includes('//') && // Has comment
            (line.includes('=') || line.includes('return') || 
             line.includes('console.') || line.includes('await') ||
             line.includes('const ') || line.includes('let ') ||
             line.includes('var ') || line.endsWith(')'))) {
          
          lines[i] = lines[i].trimEnd() + ';';
          fixes.push(`Added semicolon to line ${i + 1}`);
          totalFixed++;
        }
      }
      
      if (fixes.length > 0) {
        fixedContent = lines.join('\n');
      }
      
      // Fix pattern 3: Fix malformed template literals
      fixedContent = fixedContent.replace(/\$\{([^}]+)\}(?!["'`])/g, (match, expr) => {
        // If it's outside a template literal, wrap in backticks
        return '`${' + expr + '}`';
      });
      
      // Fix pattern 4: Fix property access syntax errors
      fixedContent = fixedContent.replace(/\['(\w+)'\s*\]/g, "['$1']");
      
      if (fixedContent !== content) {
        writeFileSync(file, fixedContent, 'utf-8');
        if (fixes.length === 0) {
          fixes.push('Applied pattern-based fixes');
          totalFixed++;
        }
        fixedFiles.push({ file, fixes });
        console.log(`✅ Fixed ${fixes.length} issues in ${file}`);
      }
    } catch (error) {
      console.error(`❌ Error processing ${file}:`, error);
    }
  }
  
  console.log('\n📊 Summary:');
  console.log(`✅ Fixed ${totalFixed} syntax issues in ${fixedFiles.length} files`);
  
  if (fixedFiles.length > 0) {
    console.log('\n📝 Modified files:');
    fixedFiles.forEach(({ file }) => {
      console.log(`  - ${file}`);
    });
  }
}

// Run the fix
fixRemainingSyntax().catch(console.error);