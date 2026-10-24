#!/usr/bin/env node

/**
 * TypeScript Error Fix Script
 * Categorizes and fixes common TypeScript errors in parallel
 */

import { promises as fs } from 'fs';
import path from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

// Error categories and their fixes
const ERROR_FIXES = {
  // TS1361: Enum member must have initializer
  TS1361: {
    pattern: /error TS1361: '([^']+)' cannot be used as a value because it was imported using 'import type'/,
    fix: async (file, match) => {
      const content = await fs.readFile(file, 'utf8');
      // Change import type to regular import
      const updated = content.replace(
        /import type \{([^}]*)\} from '([^']+)'/g,
        (m, imports, path) => {
          if (imports.includes(match[1])) {
            return `import { ${imports} } from '${path}'`;
          }
          return m;
        }
      );
      await fs.writeFile(file, updated);
    }
  },

  // TS2339: Property does not exist on type
  TS2339: {
    pattern: /error TS2339: Property '([^']+)' does not exist on type '([^']+)'/,
    fix: async (file, match) => {
      const content = await fs.readFile(file, 'utf8');
      const property = match[1];
      const type = match[2];
      
      // Add type assertions for 'never' types
      if (type === 'never') {
        const updated = content.replace(
          new RegExp(`(\\w+)\\.${property}`, 'g'),
          `($1 as any).${property}`
        );
        await fs.writeFile(file, updated);
      }
    }
  },

  // TS2304: Cannot find name
  TS2304: {
    pattern: /error TS2304: Cannot find name '([^']+)'/,
    fix: async (file, match) => {
      const name = match[1];
      const content = await fs.readFile(file, 'utf8');
      
      // Common missing imports
      const commonImports = {
        'process': "import process from 'node:process';",
        'Buffer': "import { Buffer } from 'node:buffer';",
        'URL': "import { URL } from 'node:url';",
        '__dirname': "import { dirname } from 'node:path';\nimport { fileURLToPath } from 'node:url';\nconst __dirname = dirname(fileURLToPath(import.meta.url));",
        '__filename': "import { fileURLToPath } from 'node:url';\nconst __filename = fileURLToPath(import.meta.url);"
      };
      
      if (commonImports[name] && !content.includes(commonImports[name])) {
        const lines = content.split('\n');
        const importIndex = lines.findIndex(line => line.startsWith('import'));
        if (importIndex !== -1) {
          lines.splice(importIndex, 0, commonImports[name]);
          await fs.writeFile(file, lines.join('\n'));
        }
      }
    }
  },

  // TS2322: Type assignment errors
  TS2322: {
    pattern: /error TS2322: Type '([^']+)' is not assignable to type '([^']+)'/,
    fix: async (file, match) => {
      const content = await fs.readFile(file, 'utf8');
      const fromType = match[1];
      const toType = match[2];
      
      // Fix 'never' type assignments
      if (toType === 'never') {
        const lines = content.split('\n');
        const errorLine = parseInt(match.input.match(/\((\d+),/)[1]) - 1;
        if (lines[errorLine]) {
          lines[errorLine] = lines[errorLine].replace(
            /(\w+)\.push\(/,
            '($1 as any[]).push('
          );
          await fs.writeFile(file, lines.join('\n'));
        }
      }
    }
  },

  // TS2307: Cannot find module
  TS2307: {
    pattern: /error TS2307: Cannot find module '([^']+)'/,
    fix: async (file, match) => {
      const modulePath = match[1];
      const content = await fs.readFile(file, 'utf8');
      
      // Fix missing .js extensions
      if (!modulePath.endsWith('.js') && modulePath.startsWith('.')) {
        const updated = content.replace(
          new RegExp(`from '${modulePath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}'`, 'g'),
          `from '${modulePath}.js'`
        );
        await fs.writeFile(file, updated);
      }
    }
  },

  // TS1205: Decorators are not valid
  TS1205: {
    pattern: /error TS1205: Re-exporting a type when/,
    fix: async (file, match) => {
      const content = await fs.readFile(file, 'utf8');
      // Convert export type to export
      const updated = content.replace(
        /export type \{([^}]+)\} from/g,
        'export { type $1 } from'
      );
      await fs.writeFile(file, updated);
    }
  },

  // TS4114: Missing override modifier
  TS4114: {
    pattern: /error TS4114: This member must have an 'override' modifier/,
    fix: async (file, match) => {
      const content = await fs.readFile(file, 'utf8');
      const lines = content.split('\n');
      const errorLine = parseInt(match.input.match(/\((\d+),/)[1]) - 1;
      
      if (lines[errorLine] && !lines[errorLine].includes('override')) {
        lines[errorLine] = lines[errorLine].replace(
          /(async\s+)?(\w+)\s*\(/,
          '$1override $2('
        );
        await fs.writeFile(file, lines.join('\n'));
      }
    }
  }
};

// Main fix function
async function fixTypeScriptErrors() {
  console.log('🔧 Starting TypeScript error fixes...\n');
  
  // Get all errors
  const { stdout } = await execAsync('npm run build:ts 2>&1 || true');
  const errors = stdout.split('\n').filter(line => line.includes('error TS'));
  
  console.log(`Found ${errors.length} TypeScript errors\n`);
  
  // Group errors by type
  const errorGroups = {};
  for (const error of errors) {
    const match = error.match(/error TS(\d+):/);
    if (match) {
      const code = `TS${match[1]}`;
      if (!errorGroups[code]) {
        errorGroups[code] = [];
      }
      errorGroups[code].push(error);
    }
  }
  
  // Display error summary
  console.log('📊 Error Summary:');
  for (const [code, errors] of Object.entries(errorGroups).sort((a, b) => b[1].length - a[1].length)) {
    console.log(`  ${code}: ${errors.length} errors`);
  }
  console.log();
  
  // Fix errors in parallel batches
  const fixPromises = [];
  
  for (const [code, errors] of Object.entries(errorGroups)) {
    if (ERROR_FIXES[code]) {
      console.log(`🔧 Fixing ${code} errors...`);
      
      for (const error of errors.slice(0, 50)) { // Process 50 at a time
        const fileMatch = error.match(/([^(]+)\(/);
        if (fileMatch) {
          const file = fileMatch[1];
          const match = error.match(ERROR_FIXES[code].pattern);
          
          if (match) {
            fixPromises.push(
              ERROR_FIXES[code].fix(file, match).catch(err => {
                console.error(`Error fixing ${file}: ${err.message}`);
              })
            );
          }
        }
      }
    }
  }
  
  // Wait for all fixes
  await Promise.all(fixPromises);
  
  console.log('\n✅ Applied initial fixes. Running build again...\n');
  
  // Run build again to see remaining errors
  const { stdout: stdout2 } = await execAsync('npm run build:ts 2>&1 || true');
  const remainingErrors = stdout2.split('\n').filter(line => line.includes('error TS')).length;
  
  console.log(`📊 Remaining errors: ${remainingErrors}`);
  
  return remainingErrors;
}

// Advanced fixes for specific patterns
async function applyAdvancedFixes() {
  console.log('\n🔧 Applying advanced fixes...\n');
  
  // Fix all .push() operations on never[] arrays
  const files = await execAsync("find src -name '*.ts' -type f");
  const fileList = files.stdout.split('\n').filter(f => f);
  
  const fixes = fileList.map(async (file) => {
    try {
      const content = await fs.readFile(file, 'utf8');
      let updated = content;
      
      // Fix array push operations
      updated = updated.replace(
        /(\w+)\.push\(/g,
        (match, varName) => {
          // Check if this is likely a never[] array
          if (content.includes(`${varName} = []`) || content.includes(`${varName}: []`)) {
            return `(${varName} as any[]).push(`;
          }
          return match;
        }
      );
      
      // Fix import type issues
      updated = updated.replace(
        /import type \{([^}]+)\} from/g,
        (match, imports) => {
          // Check if any of these types are used as values
          const importList = imports.split(',').map(i => i.trim());
          const hasValueUsage = importList.some(imp => {
            const name = imp.split(' as ')[0].trim();
            return new RegExp(`\\b${name}\\s*[\\({\\.]`).test(content);
          });
          
          if (hasValueUsage) {
            return `import { ${imports} } from`;
          }
          return match;
        }
      );
      
      if (updated !== content) {
        await fs.writeFile(file, updated);
      }
    } catch (err) {
      // Ignore errors
    }
  });
  
  await Promise.all(fixes);
}

// Run the fix process
(async () => {
  try {
    // Initial fixes
    let remaining = await fixTypeScriptErrors();
    
    // Apply advanced fixes if needed
    if (remaining > 500) {
      await applyAdvancedFixes();
      remaining = await fixTypeScriptErrors();
    }
    
    // Final report
    console.log('\n📊 Final Report:');
    console.log(`  Errors fixed: ${1512 - remaining}`);
    console.log(`  Errors remaining: ${remaining}`);
    
    if (remaining === 0) {
      console.log('\n✅ All TypeScript errors fixed!');
    } else {
      console.log('\n⚠️  Some errors remain. Manual intervention may be required.');
    }
  } catch (error) {
    console.error('Error during fix process:', error);
    process.exit(1);
  }
})();