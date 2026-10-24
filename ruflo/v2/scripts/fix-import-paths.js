#!/usr/bin/env node

/**
 * Script to fix incorrect import paths in the codebase
 */

import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

async function fixImportPaths(filePath) {
  try {
    let content = await fs.readFile(filePath, 'utf-8');
    let modified = false;

    // Fix error-handler import paths in CLI commands
    if (filePath.includes('/cli/commands/')) {
      const wrongPath = '../utils/error-handler.js';
      const correctPath = '../../utils/error-handler.js';
      
      if (content.includes(wrongPath)) {
        content = content.replace(new RegExp(wrongPath, 'g'), correctPath);
        modified = true;
      }
    }

    // Fix type imports that should be value imports
    const typeImportFixes = [
      // EventEmitter should be a value import
      {
        from: "import type { EventEmitter } from 'events';",
        to: "import { EventEmitter } from 'events';"
      },
      {
        from: "import type { EventEmitter } from 'node:events';",
        to: "import { EventEmitter } from 'node:events';"
      },
      // Command should be a value import for Cliffy
      {
        from: "import type { Command } from '@cliffy/command';",
        to: "import { Command } from '@cliffy/command';"
      },
      // Logger should be a value import
      {
        from: "import type { Logger } from '../../core/logger.js';",
        to: "import { Logger } from '../../core/logger.js';"
      },
      {
        from: "import type { AdvancedMemoryManager } from '../../memory/advanced-memory-manager.js';",
        to: "import { AdvancedMemoryManager } from '../../memory/advanced-memory-manager.js';"
      }
    ];

    for (const fix of typeImportFixes) {
      if (content.includes(fix.from)) {
        content = content.replace(fix.from, fix.to);
        modified = true;
      }
    }

    if (modified) {
      await fs.writeFile(filePath, content);
      console.log(`✅ Fixed import paths in: ${filePath}`);
    }
  } catch (error) {
    console.error(`❌ Error processing ${filePath}:`, error.message);
  }
}

async function findTypeScriptFiles(dir) {
  const files = [];
  const entries = await fs.readdir(dir, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = join(dir, entry.name);
    
    if (entry.isDirectory() && !entry.name.includes('node_modules') && !entry.name.includes('dist')) {
      files.push(...await findTypeScriptFiles(fullPath));
    } else if (entry.isFile() && entry.name.endsWith('.ts')) {
      files.push(fullPath);
    }
  }

  return files;
}

async function main() {
  const srcDir = join(dirname(__dirname), 'src');
  const files = await findTypeScriptFiles(srcDir);
  
  console.log(`Found ${files.length} TypeScript files to check for import path issues...`);
  
  for (const file of files) {
    await fixImportPaths(file);
  }
  
  console.log('✅ Import path fixes complete!');
}

main().catch(console.error);