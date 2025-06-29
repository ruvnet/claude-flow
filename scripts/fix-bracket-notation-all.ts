#!/usr/bin/env node
/**
 * Fix all incorrect bracket notation patterns with file extensions
 */

import { readFileSync, writeFileSync } from 'fs';
import glob from 'glob';
import path from 'path';

async function fixBracketNotation() {
  console.log('🔍 Scanning for incorrect bracket notation patterns...');
  
  // Find all TypeScript and JavaScript files
  const files = glob.sync('src/**/*.{ts,js}', { 
    ignore: ['**/node_modules/**', '**/dist/**', '**/build/**']
  });
  
  console.log(`📁 Found ${files.length} files to check`);
  
  let totalFixed = 0;
  const fixedFiles: string[] = [];
  
  // Common file extensions to fix
  const extensions = ['js', 'ts', 'tsx', 'jsx', 'json', 'md', 'xml', 'yaml', 'yml', 'css', 'scss', 'html', 'com'];
  
  for (const file of files) {
    try {
      const content = readFileSync(file, 'utf-8');
      let fixedContent = content;
      let fileFixCount = 0;
      
      // Fix patterns like ['extension'] in various contexts
      extensions.forEach(ext => {
        // Pattern 1: filename['ext'] -> filename.ext
        const pattern1 = new RegExp(`([a-zA-Z0-9_\\-\\/\\.]+)\\['${ext}'\\]`, 'g');
        const beforeCount = (fixedContent.match(pattern1) || []).length;
        fixedContent = fixedContent.replace(pattern1, `$1.${ext}`);
        fileFixCount += beforeCount;
        
        // Pattern 2: ["ext"] -> .ext (in file contexts)
        const pattern2 = new RegExp(`(\\w+)\\["${ext}"\\]`, 'g');
        const beforeCount2 = (fixedContent.match(pattern2) || []).length;
        fixedContent = fixedContent.replace(pattern2, `$1.${ext}`);
        fileFixCount += beforeCount2;
      });
      
      // Special case for object property access that shouldn't be changed
      // Revert changes that look like actual object property access
      fixedContent = fixedContent.replace(/(\w+)\['(length|size|name|value|type|id|key)\'\]/g, "$1['$2']");
      
      if (fixedContent !== content) {
        writeFileSync(file, fixedContent, 'utf-8');
        totalFixed += fileFixCount;
        fixedFiles.push(file);
        console.log(`✅ Fixed ${fileFixCount} patterns in ${file}`);
      }
    } catch (error) {
      console.error(`❌ Error processing ${file}:`, error);
    }
  }
  
  console.log('\n📊 Summary:');
  console.log(`✅ Fixed ${totalFixed} bracket notation patterns in ${fixedFiles.length} files`);
  
  if (fixedFiles.length > 0) {
    console.log('\n📝 Modified files:');
    fixedFiles.forEach(file => console.log(`  - ${file}`));
  }
}

// Run the fix
fixBracketNotation().catch(console.error);