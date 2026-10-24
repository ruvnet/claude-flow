#!/usr/bin/env node

/**
 * Script to fix import issues in the codebase
 */

import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const replacements = [
  // Cliffy imports to Commander/Inquirer
  {
    from: /import\s*{\s*Command\s*}\s*from\s*['"]@cliffy\/command['"]/g,
    to: "import { Command } from 'commander'"
  },
  {
    from: /import\s*{\s*Table\s*}\s*from\s*['"]@cliffy\/table['"]/g,
    to: "import Table from 'cli-table3'"
  },
  {
    from: /import\s*\*?\s*as\s*colors\s*from\s*['"]@cliffy\/ansi\/colors['"]/g,
    to: "import chalk from 'chalk'"
  },
  {
    from: /import\s*{\s*colors\s*}\s*from\s*['"]@cliffy\/ansi\/colors['"]/g,
    to: "import chalk from 'chalk'"
  },
  {
    from: /import\s*{\s*Select,\s*Input,\s*Confirm,\s*Number\s*}\s*from\s*['"]@cliffy\/prompt['"]/g,
    to: "import inquirer from 'inquirer'"
  },
  // Fix colors usage
  {
    from: /colors\.(green|red|yellow|blue|gray|cyan|magenta|white|black|bold|dim)/g,
    to: "chalk.$1"
  },
  // Fix duplicate fs imports
  {
    from: /import\s*{\s*promises\s*as\s*fs\s*}\s*from\s*['"]node:fs['"];?\s*\n(?:.*\n)*?import\s*{\s*promises\s*as\s*fs\s*}\s*from\s*['"]node:fs['"];?/g,
    to: "import { promises as fs } from 'node:fs';"
  },
  // Fix showHelp() calls
  {
    from: /\.showHelp\(\)/g,
    to: ".outputHelp()"
  },
  // Fix Table.push usage
  {
    from: /table\.push\(/g,
    to: "table.push("
  },
  // Fix missing error handler imports
  {
    from: /^((?!import.*getErrorMessage)[\s\S])*?import/m,
    to: "import { getErrorMessage } from '../utils/error-handler.js';\n$&"
  }
];

async function processFile(filePath) {
  try {
    let content = await fs.readFile(filePath, 'utf-8');
    let modified = false;

    for (const replacement of replacements) {
      const before = content;
      content = content.replace(replacement.from, replacement.to);
      if (content !== before) {
        modified = true;
      }
    }

    if (modified) {
      await fs.writeFile(filePath, content);
      console.log(`✅ Fixed imports in: ${filePath}`);
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
  
  console.log(`Found ${files.length} TypeScript files to process...`);
  
  for (const file of files) {
    await processFile(file);
  }
  
  console.log('✅ Import fixes complete!');
}

main().catch(console.error);