#!/usr/bin/env node
/**
 * Agent 10: Targeted TS4111 bracket notation fixes (corrected version)
 * Fixes ONLY actual property access from index signatures, not imports
 */

import { readFileSync, writeFileSync } from 'fs';

interface Fix {
  file: string;
  line: number;
  original: string;
  fixed: string;
}

const fixes: Fix[] = [];

// Files that need TS4111 fixes
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

function revertImportChanges(filePath: string): void {
  try {
    const content = readFileSync(filePath, 'utf-8');
    let lines = content.split('\n');
    let modified = false;

    for (let i = 0; i < lines.length; i++) {
      const originalLine = lines[i];
      let fixedLine = originalLine;

      // Revert incorrect import changes from .js to ['js']
      fixedLine = fixedLine.replace(/(['"])js(['"])\[['"]js['"]\]/g, '$1js$2');
      fixedLine = fixedLine.replace(/\.ts\[['"]ts['"]\]/g, '.ts');
      fixedLine = fixedLine.replace(/\.js\[['"]js['"]\]/g, '.js');
      
      // More specific import reverts
      fixedLine = fixedLine.replace(/from\s+['"][^'"]*\[['"][^'"]*['"]\]['"]['"]/g, (match) => {
        // Extract the original path from patterns like "path['js']'"
        return match.replace(/\[['"][^'"]*['"]\]/g, '');
      });

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
      console.log(`✓ Reverted import fixes in ${filePath}`);
    }
  } catch (error) {
    console.error(`Error processing ${filePath}:`, error);
  }
}

function fixOnlyPropertyAccess(filePath: string): void {
  try {
    const content = readFileSync(filePath, 'utf-8');
    let lines = content.split('\n');
    let modified = false;

    for (let i = 0; i < lines.length; i++) {
      const originalLine = lines[i];
      let fixedLine = originalLine;

      // Skip lines that look like imports
      if (originalLine.trim().startsWith('import ') || 
          originalLine.trim().startsWith('export ') ||
          originalLine.includes('from ')) {
        continue;
      }

      // ONLY fix ctx.flags.property -> ctx.flags['property'] patterns
      fixedLine = fixedLine.replace(/ctx\.flags\.([a-zA-Z_][a-zA-Z0-9_]*)/g, "ctx.flags['$1']");
      
      // ONLY fix process.env.VARIABLE -> process.env['VARIABLE'] patterns  
      fixedLine = fixedLine.replace(/process\.env\.([A-Z_][A-Z0-9_]*)/g, "process.env['$1']");

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
      console.log(`✓ Applied targeted property access fixes to ${filePath}`);
    }
  } catch (error) {
    console.error(`Error processing ${filePath}:`, error);
  }
}

async function main() {
  console.log('Agent 10: Applying targeted TS4111 fixes...');
  
  // First revert the overly aggressive import changes
  console.log('\n1. Reverting incorrect import changes...');
  for (const file of filesToFix) {
    revertImportChanges(file);
  }
  
  // Then apply only the correct property access fixes
  console.log('\n2. Applying targeted property access fixes...');
  for (const file of filesToFix) {
    fixOnlyPropertyAccess(file);
  }
  
  // Store results in Memory
  const report = {
    agent: 'Agent 10: Bracket Notation Specialist (Corrected)',
    timestamp: new Date().toISOString(),
    totalFixes: fixes.length,
    filesModified: filesToFix.length,
    summary: `Applied targeted fixes for ${fixes.length} TS4111 bracket notation issues`,
    corrections: 'Reverted overly aggressive import path changes and applied only property access fixes',
    fixes: fixes
  };
  
  // Update the memory file
  const memoryDir = 'memory/data/typescript-strict-final-push/agent-10';
  writeFileSync(
    `${memoryDir}/targeted-bracket-fixes.json`,
    JSON.stringify(report, null, 2)
  );
  
  console.log(`\n✅ Agent 10 targeted fixes completed: ${fixes.length} corrections applied`);
  console.log(`📊 Memory updated at: ${memoryDir}/targeted-bracket-fixes.json`);
  console.log('🔄 Re-run typecheck to verify targeted fixes');
  
  return report;
}

// Run if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(console.error);
}

export { main as fixTS4111Targeted };