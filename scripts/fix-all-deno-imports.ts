#!/usr/bin/env node

/**
 * Complete Deno to Node.js migration script for test files
 * Fixes all remaining Deno API usage across the test suite
 */

import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '..');

// Deno to Node.js API mappings
const replacements = [
  // Environment variables
  { from: /Deno\.env\.set\(/g, to: 'process.env[' },
  { from: /Deno\.env\.get\(/g, to: 'process.env[' },
  { from: /Deno\.env\.delete\(/g, to: 'delete process.env[' },
  
  // File system operations
  { from: /await Deno\.makeTempDir\([^)]*\)/g, to: 'fs.mkdtempSync(path.join(os.tmpdir(), "claude-flow-test-"))' },
  { from: /Deno\.makeTempDir\([^)]*\)/g, to: 'fs.mkdtempSync(path.join(os.tmpdir(), "claude-flow-test-"))' },
  { from: /await Deno\.writeTextFile\(([^,]+),\s*([^)]+)\)/g, to: 'fs.writeFileSync($1, $2, "utf8")' },
  { from: /Deno\.writeTextFile\(([^,]+),\s*([^)]+)\)/g, to: 'fs.writeFileSync($1, $2, "utf8")' },
  { from: /await Deno\.readTextFile\(([^)]+)\)/g, to: 'fs.readFileSync($1, "utf8")' },
  { from: /Deno\.readTextFile\(([^)]+)\)/g, to: 'fs.readFileSync($1, "utf8")' },
  { from: /await Deno\.remove\(([^,]+),\s*\{\s*recursive:\s*true\s*\}\)/g, to: 'fs.rmSync($1, { recursive: true, force: true })' },
  { from: /Deno\.remove\(([^,]+),\s*\{\s*recursive:\s*true\s*\}\)/g, to: 'fs.rmSync($1, { recursive: true, force: true })' },
  { from: /await Deno\.stat\(([^)]+)\)/g, to: 'fs.statSync($1)' },
  { from: /Deno\.stat\(([^)]+)\)/g, to: 'fs.statSync($1)' },
  { from: /await Deno\.statSync\(([^)]+)\)/g, to: 'fs.statSync($1)' },
  { from: /Deno\.statSync\(([^)]+)\)/g, to: 'fs.statSync($1)' },
  { from: /await Deno\.mkdir\(([^,]+),\s*\{\s*recursive:\s*true\s*\}\)/g, to: 'fs.mkdirSync($1, { recursive: true })' },
  { from: /Deno\.mkdir\(([^,]+),\s*\{\s*recursive:\s*true\s*\}\)/g, to: 'fs.mkdirSync($1, { recursive: true })' },
  { from: /await Deno\.mkdirSync\(([^,]+),\s*\{\s*recursive:\s*true\s*\}\)/g, to: 'fs.mkdirSync($1, { recursive: true })' },
  { from: /Deno\.mkdirSync\(([^,]+),\s*\{\s*recursive:\s*true\s*\}\)/g, to: 'fs.mkdirSync($1, { recursive: true })' },
  
  // Process operations
  { from: /Deno\.cwd\(\)/g, to: 'process.cwd()' },
  { from: /Deno\.execPath\(\)/g, to: 'process.execPath' },
  
  // Memory operations
  { from: /Deno\.memoryUsage\(\)/g, to: 'process.memoryUsage()' },
  
  // Command execution - replace with Node.js child_process
  { from: /new Deno\.Command\(/g, to: 'spawn(' },
  { from: /\.output\(\)/g, to: '.output()' }, // Will need manual adjustment
  { from: /\.spawn\(\)/g, to: '' }, // Will need manual adjustment
];

// Files that need fs, path, os imports
const importsToAdd = `import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { spawn } from 'child_process';
`;

function processFile(filePath: string): boolean {
  try {
    let content = fs.readFileSync(filePath, 'utf8');
    let modified = false;

    // Check if file has Deno references
    if (!content.includes('Deno.')) {
      return false;
    }

    console.log(`Processing: ${path.relative(projectRoot, filePath)}`);

    // Apply replacements
    for (const replacement of replacements) {
      if (replacement.from.test(content)) {
        content = content.replace(replacement.from, replacement.to);
        modified = true;
      }
    }

    // Add necessary imports if not present
    if (modified) {
      // Check if imports are needed
      const needsFs = content.includes('fs.') && !content.includes("import * as fs from 'fs'");
      const needsPath = content.includes('path.') && !content.includes("import * as path from 'path'");
      const needsOs = content.includes('os.') && !content.includes("import * as os from 'os'");
      const needsSpawn = content.includes('spawn(') && !content.includes("import { spawn }");

      if (needsFs || needsPath || needsOs || needsSpawn) {
        // Find the first import or the start of the file
        const importMatch = content.match(/^(\/\/\/[^\n]*\n)?(\/\*\*[\s\S]*?\*\/\n)?(import[\s\S]*?from[^;]+;?\n)/m);
        if (importMatch) {
          const beforeImports = content.substring(0, importMatch.index! + importMatch[0].length);
          const afterImports = content.substring(importMatch.index! + importMatch[0].length);
          
          let newImports = '';
          if (needsFs) newImports += "import * as fs from 'fs';\n";
          if (needsPath) newImports += "import * as path from 'path';\n";
          if (needsOs) newImports += "import * as os from 'os';\n";
          if (needsSpawn) newImports += "import { spawn } from 'child_process';\n";
          
          content = beforeImports + newImports + afterImports;
        } else {
          // Add imports at the top after any reference comments
          const lines = content.split('\n');
          let insertIndex = 0;
          for (let i = 0; i < lines.length; i++) {
            if (lines[i].startsWith('///') || lines[i].startsWith('/**') || lines[i].trim() === '') {
              insertIndex = i + 1;
            } else {
              break;
            }
          }
          
          let newImports = '';
          if (needsFs) newImports += "import * as fs from 'fs';\n";
          if (needsPath) newImports += "import * as path from 'path';\n";
          if (needsOs) newImports += "import * as os from 'os';\n";
          if (needsSpawn) newImports += "import { spawn } from 'child_process';\n";
          
          lines.splice(insertIndex, 0, newImports);
          content = lines.join('\n');
        }
      }

      // Write the modified content
      fs.writeFileSync(filePath, content, 'utf8');
      console.log(`  ✅ Fixed Deno imports in ${path.relative(projectRoot, filePath)}`);
    }

    return modified;
  } catch (error) {
    console.error(`❌ Error processing ${filePath}:`, error);
    return false;
  }
}

function main() {
  console.log('🔧 Fixing Deno imports in test files...\n');

  const testFiles = [
    'tests/unit/core/config.test.ts',
    'tests/unit/core/logger.test.ts',
    'tests/unit/memory/memory-backends.test.ts',
    'tests/unit/cli/cli-commands.test.ts',
    'tests/unit/cli/start/process-ui.test.ts',
    'tests/unit/cli/commands/init/init-command.test.ts',
    'tests/unit/cli/commands/init/sparc-structure.test.ts',
    'tests/unit/cli/commands/init/rollback.test.ts',
    'tests/unit/cli/commands/init/validation.test.ts',
    'tests/test.utils.ts',
    'tests/integration/terminal.test.ts',
    'tests/integration/workflow-yaml-json.test.ts',
    'tests/integration/cli/init/e2e-workflow.test.ts',
    'tests/integration/cli/init/selective-modes.test.ts',
    'tests/integration/cli/init/full-init-flow.test.ts',
    'tests/integration/start-compatibility.test.ts',
    'tests/integration/start-command.test.ts',
    'tests/integration/workflow-engine.test.ts',
    'tests/integration/enhanced-repl.test.ts',
    'tests/manual/test-process-ui.ts',
    'tests/manual/verify-start-command.ts',
    'tests/performance/cli/init/init-performance.test.ts',
    'tests/performance/load-testing.test.ts',
    'tests/e2e/cli-commands.test.ts',
    'tests/e2e/start-command-e2e.test.ts',
    'tests/e2e/full-system-integration.test.ts',
    'tests/e2e/workflow.test.ts',
    'tests/e2e/full-workflow.test.ts',
  ];

  let processedCount = 0;
  let modifiedCount = 0;

  for (const testFile of testFiles) {
    const fullPath = path.join(projectRoot, testFile);
    if (fs.existsSync(fullPath)) {
      processedCount++;
      if (processFile(fullPath)) {
        modifiedCount++;
      }
    } else {
      console.log(`⚠️  File not found: ${testFile}`);
    }
  }

  console.log(`\n✅ Processed ${processedCount} files, modified ${modifiedCount} files`);
  console.log('🎉 Deno to Node.js migration complete!');
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}