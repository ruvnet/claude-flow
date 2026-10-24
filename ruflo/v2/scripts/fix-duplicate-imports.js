#!/usr/bin/env node

/**
 * Script to fix duplicate imports in the codebase
 */

import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

async function removeDuplicateImports(filePath) {
  try {
    let content = await fs.readFile(filePath, 'utf-8');
    let modified = false;

    // Remove duplicate error handler imports
    const errorHandlerRegex = /import\s+{\s*getErrorMessage\s*}\s+from\s+['"].*?error-handler\.js['"];\s*\n/g;
    const matches = content.match(errorHandlerRegex);
    
    if (matches && matches.length > 1) {
      // Keep only the first import
      let firstFound = false;
      content = content.replace(errorHandlerRegex, (match) => {
        if (!firstFound) {
          firstFound = true;
          return match;
        }
        modified = true;
        return '';
      });
    }

    // Remove duplicate fs imports
    const fsImportRegex = /import\s+{\s*promises\s+as\s+fs\s*}\s+from\s+['"]node:fs['"];\s*\n/g;
    const fsMatches = content.match(fsImportRegex);
    
    if (fsMatches && fsMatches.length > 1) {
      // Keep only the first import
      let firstFound = false;
      content = content.replace(fsImportRegex, (match) => {
        if (!firstFound) {
          firstFound = true;
          return match;
        }
        modified = true;
        return '';
      });
    }

    // Fix duplicate type imports
    const typeImportRegex = /import\s+type\s+{\s*([^}]+)\s*}\s+from\s+['"]([^'"]+)['"];\s*\n/g;
    const typeImports = new Map();
    
    content = content.replace(typeImportRegex, (match, types, from) => {
      const key = from;
      if (typeImports.has(key)) {
        // Merge with existing import
        const existing = typeImports.get(key);
        const newTypes = types.split(',').map(t => t.trim());
        const existingTypes = existing.split(',').map(t => t.trim());
        const allTypes = [...new Set([...existingTypes, ...newTypes])];
        typeImports.set(key, allTypes.join(', '));
        modified = true;
        return '';
      } else {
        typeImports.set(key, types);
        return match;
      }
    });

    if (modified) {
      await fs.writeFile(filePath, content);
      console.log(`✅ Fixed duplicate imports in: ${filePath}`);
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
  
  console.log(`Found ${files.length} TypeScript files to check...`);
  
  for (const file of files) {
    await removeDuplicateImports(file);
  }
  
  console.log('✅ Duplicate import fixes complete!');
}

main().catch(console.error);