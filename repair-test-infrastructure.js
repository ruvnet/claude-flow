#!/usr/bin/env node

/**
 * Test Infrastructure Repair Tool
 * Fixes corrupted Jest test files identified in QA analysis
 * 
 * Phase 2 QA Testing - Critical Infrastructure Recovery
 */

import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

class TestInfrastructureRepairer {
  constructor() {
    this.testDir = path.join(__dirname, 'tests');
    this.repairLog = [];
    this.stats = {
      filesScanned: 0,
      filesRepaired: 0,
      issuesFixed: 0,
      backupsCreated: 0
    };
  }

  // Define comprehensive repair patterns
  getRepairPatterns() {
    return [
      {
        name: 'broken_toBe_array_simple',
        pattern: /\.toBe\(\s*\[([^\]]+)\)\.toBe\(\s*([^\)]+)\)/g,
        replacement: '.toEqual([$1, $2])',
        description: 'Fix broken array assertions like .toBe( [2).toBe( 3)'
      },
      {
        name: 'broken_toBe_object_simple', 
        pattern: /\.toBe\(\s*\{\s*([^:]+):\s*([^}]+)\)\.toBe\(\s*([^:]+):\s*([^}]+)\)/g,
        replacement: '.toEqual({ $1: $2, $3: $4 })',
        description: 'Fix broken object assertions'
      },
      {
        name: 'broken_toBe_chaining',
        pattern: /\.toBe\(\s*([^)]+)\)\.toBe\(\s*([^)]+)\)/g,
        replacement: '.toEqual([$1, $2])',
        description: 'Fix general .toBe().toBe() chaining issues'
      },
      {
        name: 'malformed_object_props',
        pattern: /\{\s*([^:]+):\s*([^}]+)\)\.toBe\(\s*([^:]+):/g,
        replacement: '{ $1: $2, $3:',
        description: 'Fix malformed object properties with ).toBe('
      },
      {
        name: 'import_path_fixes',
        pattern: /@\/([^']+)'/g,
        replacement: '../../../src/$1',
        description: 'Fix broken @/ import paths'
      },
      {
        name: 'missing_closing_braces',
        pattern: /(\w+)\s*\}\s*;\s*$(?!\s*\})/gm,
        replacement: '$1 }\n  });',
        description: 'Add missing closing braces for test blocks'
      },
      {
        name: 'expect_calls_syntax',
        pattern: /expect\((\w+)\.calls\[(\d+)\]\.args\)\.toBe\(\s*\[([^\]]+)\)\.toBe\(\s*([^\)]+)\)/g,
        replacement: 'expect($1.calls[$2].args).toEqual([$3, $4])',
        description: 'Fix spy call argument assertions'
      },
      {
        name: 'toEqual_object_broken',
        pattern: /\.toEqual\(\{\s*([^:]+):\s*([^}]+)\)\.toBe\(\s*([^:]+):\s*([^}]+)\s*\}\)/g,
        replacement: '.toEqual({ $1: $2, $3: $4 })',
        description: 'Fix broken toEqual object syntax'
      }
    ];
  }

  // Find all test files recursively
  async findTestFiles(dir = this.testDir) {
    const files = [];
    
    try {
      const entries = await fs.readdir(dir, { withFileTypes: true });
      
      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        
        if (entry.isDirectory()) {
          files.push(...await this.findTestFiles(fullPath));
        } else if (entry.name.endsWith('.test.ts') || entry.name.endsWith('.test.js')) {
          files.push(fullPath);
        }
      }
    } catch (error) {
      console.warn(`⚠️  Warning: Could not read directory ${dir}: ${error.message}`);
    }
    
    return files;
  }

  // Create backup of original file
  async createBackup(filePath) {
    const backupPath = `${filePath}.backup-${Date.now()}`;
    try {
      const content = await fs.readFile(filePath, 'utf8');
      await fs.writeFile(backupPath, content);
      this.stats.backupsCreated++;
      return backupPath;
    } catch (error) {
      console.error(`❌ Failed to create backup for ${filePath}: ${error.message}`);
      return null;
    }
  }

  // Repair a single test file
  async repairTestFile(filePath) {
    this.stats.filesScanned++;
    
    try {
      const originalContent = await fs.readFile(filePath, 'utf8');
      let repairedContent = originalContent;
      const patterns = this.getRepairPatterns();
      let fileIssuesFixed = 0;
      const appliedFixes = [];

      // Apply each repair pattern
      for (const pattern of patterns) {
        const beforeLength = repairedContent.length;
        const beforeMatches = Array.from(originalContent.matchAll(pattern.pattern));
        
        if (beforeMatches.length > 0) {
          repairedContent = repairedContent.replace(pattern.pattern, pattern.replacement);
          const afterMatches = Array.from(repairedContent.matchAll(pattern.pattern));
          const fixesApplied = beforeMatches.length - afterMatches.length;
          
          if (fixesApplied > 0) {
            fileIssuesFixed += fixesApplied;
            appliedFixes.push({
              pattern: pattern.name,
              description: pattern.description,
              count: fixesApplied,
              examples: beforeMatches.slice(0, 2).map(m => m[0])
            });
          }
        }
      }

      // Additional manual fixes for complex cases
      repairedContent = this.applyManualFixes(repairedContent, filePath);

      // Only write if repairs were made
      if (repairedContent !== originalContent) {
        // Create backup first
        const backupPath = await this.createBackup(filePath);
        if (!backupPath) {
          console.error(`❌ Skipping repair of ${filePath} - backup failed`);
          return false;
        }

        // Write repaired content
        await fs.writeFile(filePath, repairedContent);
        
        this.stats.filesRepaired++;
        this.stats.issuesFixed += fileIssuesFixed;
        
        this.repairLog.push({
          file: path.relative(__dirname, filePath),
          backup: path.relative(__dirname, backupPath),
          issuesFixed: fileIssuesFixed,
          appliedFixes
        });

        console.log(`✅ Repaired ${path.relative(__dirname, filePath)} (${fileIssuesFixed} issues fixed)`);
        return true;
      } else {
        console.log(`✨ No issues found in ${path.relative(__dirname, filePath)}`);
        return false;
      }
      
    } catch (error) {
      console.error(`❌ Failed to repair ${filePath}: ${error.message}`);
      return false;
    }
  }

  // Apply additional manual fixes for complex patterns
  applyManualFixes(content, filePath) {
    let fixed = content;

    // Fix specific broken patterns seen in the error logs
    fixed = fixed.replace(
      /expect\(callOrder\)\.toBe\(\s*\[2\)\.toBe\(\s*3,\s*1\)\);/g,
      'expect(callOrder).toEqual([2, 3, 1]);'
    );

    fixed = fixed.replace(
      /expect\(result\)\.toEqual\(\{\s*id:\s*1\)\.toBe\(\s*name:\s*'test'\s*\}\);/g,
      'expect(result).toEqual({ id: 1, name: \'test\' });'
    );

    fixed = fixed.replace(
      /expect\(addSpy\.calls\[0\]\.args\)\.toBe\(\s*\[2\)\.toBe\(\s*3\)\);/g,
      'expect(addSpy.calls[0].args).toEqual([2, 3]);'
    );

    fixed = fixed.replace(
      /expect\(addSpy\.calls\[1\]\.args\)\.toBe\(\s*\[4\)\.toBe\(\s*5\)\);/g,
      'expect(addSpy.calls[1].args).toEqual([4, 5]);'
    );

    // Fix conflict agents assertion
    fixed = fixed.replace(
      /expect\(conflict\.agents\)\.toBe\(\s*\['agent-1'\)\.toBe\(\s*'agent-2'\]\);/g,
      'expect(conflict.agents).toEqual([\'agent-1\', \'agent-2\']);'
    );

    // Fix malformed closing braces
    fixed = fixed.replace(
      /^\s*\}\s*;\s*$/gm,
      '  });'
    );

    // Fix specific import issues
    fixed = fixed.replace(
      /@\/core\/logger/g,
      '../../../src/core/logger'
    );

    return fixed;
  }

  // Generate repair report
  async generateReport() {
    const reportContent = `# Test Infrastructure Repair Report

**Date**: ${new Date().toISOString()}
**Tool**: Test Infrastructure Repairer
**Status**: ${this.stats.filesRepaired > 0 ? 'REPAIRS COMPLETED' : 'NO REPAIRS NEEDED'}

## Summary Statistics
- **Files Scanned**: ${this.stats.filesScanned}
- **Files Repaired**: ${this.stats.filesRepaired}
- **Total Issues Fixed**: ${this.stats.issuesFixed}
- **Backups Created**: ${this.stats.backupsCreated}

## Repair Details

${this.repairLog.map(entry => `
### ${entry.file}
- **Issues Fixed**: ${entry.issuesFixed}
- **Backup Created**: ${entry.backup}
- **Applied Fixes**:
${entry.appliedFixes.map(fix => `  - **${fix.pattern}**: ${fix.count} fixes - ${fix.description}`).join('\n')}
`).join('\n')}

## Next Steps
1. Run \`npm test\` to validate repairs
2. If tests pass, remove backup files: \`rm tests/**/*.backup-*\`
3. If tests fail, investigate remaining issues
4. Proceed with Phase 2 CLI consolidation testing

## Pattern Analysis
${this.getRepairPatterns().map(p => `- **${p.name}**: ${p.description}`).join('\n')}
`;

    await fs.writeFile('test-repair-report.md', reportContent);
    console.log('\n📋 Generated test-repair-report.md');
  }

  // Validate repairs by running a syntax check
  async validateRepairs() {
    console.log('\n🧪 Validating repairs...');
    
    const testFiles = await this.findTestFiles();
    let validationErrors = 0;

    for (const filePath of testFiles) {
      try {
        const content = await fs.readFile(filePath, 'utf8');
        
        // Basic syntax validation
        if (content.includes('.toBe(').includes(').toBe(')) {
          console.warn(`⚠️  Possible remaining .toBe().toBe() pattern in ${path.relative(__dirname, filePath)}`);
          validationErrors++;
        }
        
        if (content.includes('@/')) {
          console.warn(`⚠️  Possible remaining @/ import path in ${path.relative(__dirname, filePath)}`);
          validationErrors++;
        }
        
      } catch (error) {
        console.error(`❌ Validation error in ${filePath}: ${error.message}`);
        validationErrors++;
      }
    }

    if (validationErrors === 0) {
      console.log('✅ All repairs validated successfully');
    } else {
      console.log(`⚠️  ${validationErrors} potential issues found - manual review recommended`);
    }

    return validationErrors === 0;
  }

  // Main repair process
  async repair() {
    console.log('🔧 Starting Test Infrastructure Repair...\n');
    
    const testFiles = await this.findTestFiles();
    
    if (testFiles.length === 0) {
      console.log('⚠️  No test files found. Check that tests directory exists.');
      return false;
    }

    console.log(`Found ${testFiles.length} test files to analyze\n`);

    // Process each test file
    for (const filePath of testFiles) {
      await this.repairTestFile(filePath);
    }

    // Generate comprehensive report
    await this.generateReport();
    
    // Validate repairs
    const validationPassed = await this.validateRepairs();

    // Summary
    console.log('\n📊 Repair Summary:');
    console.log(`  Files Scanned: ${this.stats.filesScanned}`);
    console.log(`  Files Repaired: ${this.stats.filesRepaired}`);
    console.log(`  Issues Fixed: ${this.stats.issuesFixed}`);
    console.log(`  Backups Created: ${this.stats.backupsCreated}`);
    
    if (this.stats.filesRepaired > 0) {
      console.log('\n🎯 Next Steps:');
      console.log('  1. Run: npm test');
      console.log('  2. If tests pass: rm tests/**/*.backup-*');
      console.log('  3. Proceed with Phase 2 CLI consolidation testing');
    }

    return validationPassed && this.stats.issuesFixed > 0;
  }
}

// Main execution
async function main() {
  const repairer = new TestInfrastructureRepairer();
  
  try {
    const success = await repairer.repair();
    
    if (success) {
      console.log('\n✅ Test infrastructure repair completed successfully!');
      process.exit(0);
    } else {
      console.log('\n⚠️  Test infrastructure repair completed with warnings');
      process.exit(1);
    }
    
  } catch (error) {
    console.error('\n❌ Test infrastructure repair failed:', error.message);
    process.exit(1);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}

export default TestInfrastructureRepairer;