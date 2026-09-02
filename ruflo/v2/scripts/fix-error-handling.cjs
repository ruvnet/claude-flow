#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const glob = require('glob');

// Find all TypeScript files
const files = glob.sync('src/**/*.ts', { 
  ignore: ['src/**/*.test.ts', 'src/**/*.spec.ts'] 
});

let totalFixed = 0;

files.forEach(file => {
  let content = fs.readFileSync(file, 'utf8');
  let modified = false;

  // Fix error handling patterns
  const patterns = [
    // Fix unknown error types in catch blocks
    {
      regex: /catch\s*\(\s*error\s*\)\s*{([^}]+error\.message)/g,
      replacement: 'catch (error) {$1'
    },
    // Fix error.message access
    {
      regex: /(\$\{|`)error\.message/g,
      replacement: '$1(error instanceof Error ? error.message : String(error))'
    },
    // Fix standalone error.message
    {
      regex: /([^`$])error\.message/g,
      replacement: '$1(error instanceof Error ? error.message : String(error))'
    },
    // Fix error type annotations
    {
      regex: /catch\s*\(\s*error:\s*any\s*\)/g,
      replacement: 'catch (error)'
    },
    // Fix error type in functions
    {
      regex: /\(error:\s*unknown\)/g,
      replacement: '(error)'
    }
  ];

  patterns.forEach(pattern => {
    const before = content;
    content = content.replace(pattern.regex, pattern.replacement);
    if (before !== content) {
      modified = true;
    }
  });

  if (modified) {
    // Add error handler import if needed
    if (!content.includes("from '../utils/error-handler'") && 
        !content.includes("from '../../utils/error-handler'") &&
        content.includes('error instanceof Error')) {
      const importPath = file.includes('cli/commands') ? '../../utils/error-handler' : '../utils/error-handler';
      content = `import { getErrorMessage } from '${importPath}';\n` + content;
    }

    fs.writeFileSync(file, content);
    totalFixed++;
    console.log(`Fixed: ${file}`);
  }
});

console.log(`\nTotal files fixed: ${totalFixed}`);