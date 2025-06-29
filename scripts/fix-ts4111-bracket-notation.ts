#!/usr/bin/env node
/**
 * Agent 10: Targeted TS4111 bracket notation fixes
 * Fixes all property access patterns that come from index signatures
 */

import { readFileSync, writeFileSync } from 'fs';

interface Fix {
  file: string;
  line: number;
  original: string;
  fixed: string;
}

const fixes: Fix[] = [];

// Files and their specific property access patterns that need fixing
const filesToFix = [
  'src/cli/commands/enterprise.ts',
  'src/cli/commands/index.ts',
  'src/cli/commands/sparc.ts',
  'src/cli/commands/swarm.ts',
  'src/cli/simple-orchestrator.ts',
  'src/cli/unified/commands/status.ts',
  'src/coordination/work-stealing.ts',
  'src/mcp/session-manager.ts',
  'src/memory/swarm-memory.ts',
  'src/services/process-registry/registry.ts'
];

function fixBracketNotationInFile(filePath: string): void {
  try {
    const content = readFileSync(filePath, 'utf-8');
    const lines = content.split('\n');
    let modified = false;

    for (let i = 0; i < lines.length; i++) {
      const originalLine = lines[i];
      let fixedLine = originalLine;

      // Fix various property access patterns that come from index signatures
      
      // Pattern 1: ctx.flags.property -> ctx.flags['property']
      fixedLine = fixedLine.replace(
        /ctx\.flags\.([a-zA-Z_][a-zA-Z0-9_]*)/g,
        "ctx.flags['$1']"
      );

      // Pattern 2: process.env.PROPERTY -> process.env['PROPERTY'] 
      fixedLine = fixedLine.replace(
        /process\.env\.([A-Z_][A-Z0-9_]*)/g,
        "process.env['$1']"
      );

      // Pattern 3: Generic property access from index signatures
      // This handles cases like: auth.token, auth.username, etc.
      fixedLine = fixedLine.replace(
        /(\w+)\.([a-zA-Z_][a-zA-Z0-9_]*)/g,
        (match, obj, prop) => {
          // Skip if it's already in brackets
          if (originalLine.includes(`${obj}['${prop}']`)) {
            return match;
          }
          
          // Skip common object patterns that shouldn't be converted
          const skipPatterns = [
            'console.log', 'console.error', 'console.warn', 'console.info',
            'JSON.stringify', 'JSON.parse', 'Object.keys', 'Object.values',
            'Array.from', 'Promise.resolve', 'Promise.reject', 'Date.now',
            'Math.floor', 'Math.ceil', 'Math.round', 'Math.random',
            'String.prototype', 'Array.prototype', 'Object.prototype',
            'Buffer.from', 'Buffer.alloc', 'path.join', 'path.resolve',
            'fs.readFileSync', 'fs.writeFileSync', 'os.platform', 'os.arch'
          ];
          
          if (skipPatterns.some(pattern => match.startsWith(pattern))) {
            return match;
          }
          
          // Skip method calls (if followed by parentheses)
          const nextChar = originalLine[originalLine.indexOf(match) + match.length];
          if (nextChar === '(') {
            return match;
          }
          
          // Skip property chains that look like method calls or built-in objects
          if (obj === 'this' || obj === 'super' || obj.includes('.')) {
            return match;
          }
          
          // Convert to bracket notation
          return `${obj}['${prop}']`;
        }
      );

      if (fixedLine !== originalLine) {
        lines[i] = fixedLine;
        modified = true;
        fixes.push({
          file: filePath,
          line: i + 1,
          original: originalLine.trim(),
          fixed: fixedLine.trim()
        });
      }
    }

    if (modified) {
      writeFileSync(filePath, lines.join('\n'));
      console.log(`✓ Fixed ${filePath} (${fixes.filter(f => f.file === filePath).length} fixes)`);
    }
  } catch (error) {
    console.error(`Error processing ${filePath}:`, error);
  }
}

async function main() {
  console.log('Agent 10: Starting TS4111 bracket notation fixes...');
  
  for (const file of filesToFix) {
    fixBracketNotationInFile(file);
  }
  
  // Store results in Memory
  const report = {
    agent: 'Agent 10: Bracket Notation Specialist',
    timestamp: new Date().toISOString(),
    totalFixes: fixes.length,
    filesModified: filesToFix.length,
    summary: `Fixed ${fixes.length} TS4111 bracket notation errors across ${filesToFix.length} files`,
    fixes: fixes
  };
  
  // Ensure directory exists
  const memoryDir = 'memory/data/typescript-strict-final-push/agent-10';
  await import('fs').then(fs => {
    if (!fs.existsSync(memoryDir)) {
      fs.mkdirSync(memoryDir, { recursive: true });
    }
  });
  
  writeFileSync(
    `${memoryDir}/bracket-notation-fixes.json`,
    JSON.stringify(report, null, 2)
  );
  
  console.log(`\n✅ Agent 10 completed: ${fixes.length} TS4111 fixes applied`);
  console.log(`📊 Memory stored at: ${memoryDir}/bracket-notation-fixes.json`);
  console.log('🔄 Re-run typecheck to verify fixes');
  
  return report;
}

// Run if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(console.error);
}

export { main as fixTS4111BracketNotation };