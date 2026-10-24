#!/usr/bin/env node

/**
 * Script to fix shebang lines that got moved incorrectly
 */

import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

async function fixShebangLine(filePath) {
  try {
    let content = await fs.readFile(filePath, 'utf-8');
    let modified = false;

    // Check if shebang is not at the start but exists in the file
    if (!content.startsWith('#!') && content.includes('#!/usr/bin/env node')) {
      // Find the shebang line
      const lines = content.split('\n');
      const shebangIndex = lines.findIndex(line => line.startsWith('#!/usr/bin/env node'));
      
      if (shebangIndex > 0) {
        // Remove the shebang from its current position
        const shebangLine = lines[shebangIndex];
        lines.splice(shebangIndex, 1);
        
        // Add it to the beginning
        lines.unshift(shebangLine);
        
        content = lines.join('\n');
        modified = true;
      }
    }

    if (modified) {
      await fs.writeFile(filePath, content);
      console.log(`✅ Fixed shebang in: ${filePath}`);
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
  
  console.log(`Found ${files.length} TypeScript files to check for shebang issues...`);
  
  for (const file of files) {
    await fixShebangLine(file);
  }
  
  console.log('✅ Shebang fixes complete!');
}

main().catch(console.error);