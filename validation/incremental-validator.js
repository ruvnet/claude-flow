#!/usr/bin/env node

/**
 * Incremental Validation Framework
 * Agent 10: Incremental Validation Specialist
 * 
 * This script provides continuous validation after each swarm agent completes work.
 * Tracks TypeScript errors, test regressions, and validates fixes incrementally.
 */

import { execSync, spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

class IncrementalValidator {
  constructor() {
    this.swarmId = 'swarm-development-hierarchical-1751184493913';
    this.agentId = 'agent10';
    this.validationDir = path.join(__dirname, 'reports');
    this.memoryDir = path.join(__dirname, '..', 'memory', 'data');
    this.ensureDirectories();
  }

  ensureDirectories() {
    [this.validationDir, this.memoryDir].forEach(dir => {
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
    });
  }

  /**
   * Main validation workflow - runs after each agent completes work
   */
  async validateIncremental(agentId = null, workDescription = '') {
    const timestamp = new Date().toISOString();
    console.log(`\n🔍 Starting incremental validation at ${timestamp}`);
    
    if (agentId) {
      console.log(`📝 Validating work by ${agentId}: ${workDescription}`);
    }

    const results = {
      timestamp,
      agentId,
      workDescription,
      validations: {}
    };

    try {
      // 1. TypeScript Error Count Tracking
      results.validations.typescript = await this.validateTypeScript();
      
      // 2. Build Validation
      results.validations.build = await this.validateBuild();
      
      // 3. Test Regression Check
      results.validations.tests = await this.validateTests();
      
      // 4. Git Status Check
      results.validations.git = await this.validateGitStatus();
      
      // 5. Memory Coordination Check
      results.validations.coordination = await this.checkAgentCoordination();

      // Generate report
      const report = this.generateReport(results);
      
      // Save to files and memory
      await this.saveResults(results, report);
      
      return results;
      
    } catch (error) {
      console.error('❌ Validation failed:', error.message);
      results.error = error.message;
      await this.saveResults(results, null);
      throw error;
    }
  }

  /**
   * Track TypeScript errors with detailed analysis
   */
  async validateTypeScript() {
    console.log('🔧 Checking TypeScript errors...');
    
    try {
      const output = execSync('npm run typecheck', { 
        encoding: 'utf8', 
        cwd: path.join(__dirname, '..'),
        timeout: 30000
      });
      
      return {
        status: 'success',
        errorCount: 0,
        message: 'No TypeScript errors found'
      };
      
    } catch (error) {
      const errorOutput = error.stdout || error.stderr || '';
      const errorLines = errorOutput.split('\n').filter(line => line.includes('error TS'));
      const errorCount = errorLines.length;
      
      // Categorize errors
      const errorCategories = this.categorizeTypeScriptErrors(errorLines);
      
      return {
        status: errorCount > 0 ? 'errors' : 'success',
        errorCount,
        errors: errorLines.slice(0, 10), // First 10 errors for summary
        categories: errorCategories,
        fullOutput: errorOutput
      };
    }
  }

  /**
   * Categorize TypeScript errors for better analysis
   */
  categorizeTypeScriptErrors(errorLines) {
    const categories = {
      'TS2739': { name: 'Missing Properties', count: 0 }, // Missing properties
      'TS2393': { name: 'Duplicate Implementation', count: 0 }, // Duplicate function
      'TS2554': { name: 'Argument Count Mismatch', count: 0 }, // Wrong argument count
      'TS2540': { name: 'Read-only Assignment', count: 0 }, // Cannot assign to readonly
      'TS17009': { name: 'Super Call Required', count: 0 }, // Super must be called
      'TS2749': { name: 'Type/Value Confusion', count: 0 }, // Refers to value but used as type
      'TS2693': { name: 'Type Used as Value', count: 0 }, // Type used as value
      'TS2559': { name: 'No Common Properties', count: 0 }, // No properties in common
      'TS2362': { name: 'Invalid Arithmetic', count: 0 }, // Invalid arithmetic operation
      'other': { name: 'Other Errors', count: 0 }
    };

    errorLines.forEach(line => {
      const match = line.match(/error (TS\d+):/);
      if (match) {
        const errorCode = match[1];
        if (categories[errorCode]) {
          categories[errorCode].count++;
        } else {
          categories.other.count++;
        }
      }
    });

    return categories;
  }

  /**
   * Validate build process
   */
  async validateBuild() {
    console.log('🏗️ Checking build process...');
    
    try {
      execSync('npm run build', { 
        encoding: 'utf8', 
        cwd: path.join(__dirname, '..'),
        timeout: 60000
      });
      
      return {
        status: 'success',
        message: 'Build completed successfully'
      };
      
    } catch (error) {
      return {
        status: 'failed',
        message: 'Build failed',
        error: (error.stdout || error.stderr || '').substring(0, 1000)
      };
    }
  }

  /**
   * Validate test execution and look for regressions
   */
  async validateTests() {
    console.log('🧪 Checking test execution...');
    
    try {
      const output = execSync('npm test -- --passWithNoTests', { 
        encoding: 'utf8', 
        cwd: path.join(__dirname, '..'),
        timeout: 120000
      });
      
      return {
        status: 'success',
        message: 'Tests passed',
        output: output.substring(0, 500)
      };
      
    } catch (error) {
      const errorOutput = error.stdout || error.stderr || '';
      
      return {
        status: 'failed',
        message: 'Tests failed or timed out',
        error: errorOutput.substring(0, 1000),
        suggestion: 'Check for test timeouts, logger issues, or new test failures'
      };
    }
  }

  /**
   * Check git status for uncommitted changes
   */
  async validateGitStatus() {
    console.log('📋 Checking git status...');
    
    try {
      const status = execSync('git status --porcelain', { 
        encoding: 'utf8', 
        cwd: path.join(__dirname, '..')
      });
      
      const changedFiles = status.trim().split('\n').filter(line => line.trim());
      
      return {
        status: changedFiles.length > 0 ? 'changes' : 'clean',
        changedFiles: changedFiles.slice(0, 20),
        message: changedFiles.length > 0 
          ? `${changedFiles.length} files have changes`
          : 'Working directory clean'
      };
      
    } catch (error) {
      return {
        status: 'error',
        message: 'Could not check git status',
        error: error.message
      };
    }
  }

  /**
   * Check coordination with other agents via memory
   */
  async checkAgentCoordination() {
    console.log('🤝 Checking agent coordination...');
    
    try {
      const memoryFiles = fs.readdirSync(this.memoryDir)
        .filter(file => file.includes(this.swarmId))
        .sort((a, b) => fs.statSync(path.join(this.memoryDir, b)).mtime - 
                      fs.statSync(path.join(this.memoryDir, a)).mtime);
      
      const recentAgents = [];
      const agentStatus = {};
      
      memoryFiles.slice(0, 10).forEach(file => {
        try {
          const content = fs.readFileSync(path.join(this.memoryDir, file), 'utf8');
          const data = JSON.parse(content);
          
          if (data.role || data.agentId) {
            const agent = data.role || data.agentId;
            const status = data.status || 'unknown';
            
            recentAgents.push(agent);
            agentStatus[agent] = {
              status,
              timestamp: data.timestamp,
              file: file
            };
          }
        } catch (e) {
          // Skip invalid JSON files
        }
      });
      
      return {
        status: 'active',
        recentAgents: [...new Set(recentAgents)].slice(0, 5),
        agentStatus,
        totalMemoryFiles: memoryFiles.length
      };
      
    } catch (error) {
      return {
        status: 'error',
        message: 'Could not check agent coordination',
        error: error.message
      };
    }
  }

  /**
   * Generate comprehensive validation report
   */
  generateReport(results) {
    const { validations } = results;
    
    let report = `
# Incremental Validation Report
**Timestamp:** ${results.timestamp}
**Agent:** ${results.agentId || 'System'}
**Work Description:** ${results.workDescription || 'General validation'}

## 🔧 TypeScript Validation
- **Status:** ${validations.typescript.status}
- **Error Count:** ${validations.typescript.errorCount}
`;

    if (validations.typescript.errorCount > 0) {
      report += `
### Error Categories:
`;
      Object.entries(validations.typescript.categories || {}).forEach(([code, info]) => {
        if (info.count > 0) {
          report += `- **${code}** (${info.name}): ${info.count} errors\n`;
        }
      });
      
      report += `
### Sample Errors:
`;
      (validations.typescript.errors || []).slice(0, 5).forEach(error => {
        report += `- ${error}\n`;
      });
    }

    report += `
## 🏗️ Build Validation
- **Status:** ${validations.build.status}
- **Message:** ${validations.build.message}

## 🧪 Test Validation
- **Status:** ${validations.tests.status}
- **Message:** ${validations.tests.message}

## 📋 Git Status
- **Status:** ${validations.git.status}
- **Message:** ${validations.git.message}
`;

    if (validations.git.changedFiles && validations.git.changedFiles.length > 0) {
      report += `
### Changed Files:
`;
      validations.git.changedFiles.slice(0, 10).forEach(file => {
        report += `- ${file}\n`;
      });
    }

    report += `
## 🤝 Agent Coordination
- **Status:** ${validations.coordination.status}
- **Active Agents:** ${(validations.coordination.recentAgents || []).join(', ')}
- **Memory Files:** ${validations.coordination.totalMemoryFiles}

## 📊 Overall Assessment
`;

    const errorCount = validations.typescript.errorCount;
    const buildOk = validations.build.status === 'success';
    const testsOk = validations.tests.status === 'success';
    
    if (errorCount === 0 && buildOk && testsOk) {
      report += `✅ **EXCELLENT** - All validations passed! System is in great shape.`;
    } else if (errorCount < 50 && (buildOk || testsOk)) {
      report += `⚠️ **GOOD** - Minor issues present but system is functional.`;
    } else if (errorCount < 100) {
      report += `🔧 **NEEDS WORK** - Moderate issues that should be addressed.`;
    } else {
      report += `❌ **CRITICAL** - Significant issues require immediate attention.`;
    }

    return report;
  }

  /**
   * Save validation results to files and memory
   */
  async saveResults(results, report) {
    const timestamp = results.timestamp.replace(/[:.]/g, '-');
    
    // Save detailed results
    const resultsFile = path.join(this.validationDir, `validation-${timestamp}.json`);
    fs.writeFileSync(resultsFile, JSON.stringify(results, null, 2));
    
    // Save report
    if (report) {
      const reportFile = path.join(this.validationDir, `report-${timestamp}.md`);
      fs.writeFileSync(reportFile, report);
    }
    
    // Save to memory for swarm coordination
    const memoryKey = `${this.swarmId}/${this.agentId}/incremental-validation`;
    const memoryFile = path.join(this.memoryDir, `${memoryKey.replace(/\//g, '-')}.json`);
    
    const memoryData = {
      swarmId: this.swarmId,
      agentRole: 'Incremental Validation Specialist',
      timestamp: results.timestamp,
      validation_results: results,
      report_summary: {
        typescript_errors: results.validations?.typescript?.errorCount || 'unknown',
        build_status: results.validations?.build?.status || 'unknown',
        test_status: results.validations?.tests?.status || 'unknown',
        coordination_status: results.validations?.coordination?.status || 'unknown'
      },
      next_validation_recommendations: this.generateRecommendations(results)
    };
    
    fs.writeFileSync(memoryFile, JSON.stringify(memoryData, null, 2));
    
    console.log(`📝 Results saved to:`);
    console.log(`   - ${resultsFile}`);
    if (report) console.log(`   - ${reportFile}`);
    console.log(`   - ${memoryFile}`);
  }

  /**
   * Generate recommendations for next steps
   */
  generateRecommendations(results) {
    const recommendations = [];
    const { validations } = results;
    
    if (validations.typescript?.errorCount > 0) {
      const categories = validations.typescript.categories || {};
      
      // Prioritize by error category
      if (categories['TS2739']?.count > 0) {
        recommendations.push('Focus on TS2739 (Missing Properties) - likely config/type definition issues');
      }
      if (categories['TS2393']?.count > 0) {
        recommendations.push('Fix TS2393 (Duplicate Implementation) - check for duplicate function definitions');
      }
      if (categories['TS17009']?.count > 0) {
        recommendations.push('Fix TS17009 (Super Call) - ensure super() is called before this access in constructors');
      }
    }
    
    if (validations.build?.status === 'failed') {
      recommendations.push('Build is failing - address TypeScript errors before proceeding');
    }
    
    if (validations.tests?.status === 'failed') {
      recommendations.push('Test suite has issues - may need logger fixes or timeout adjustments');
    }
    
    if (validations.git?.changedFiles?.length > 20) {
      recommendations.push('Many files changed - consider creating intermediate commits');
    }
    
    if (recommendations.length === 0) {
      recommendations.push('System validation passed - ready for next phase of development');
    }
    
    return recommendations;
  }
}

// CLI Interface
if (import.meta.url === `file://${process.argv[1]}`) {
  const validator = new IncrementalValidator();
  
  const command = process.argv[2];
  const agentId = process.argv[3];
  const workDescription = process.argv.slice(4).join(' ');
  
  switch (command) {
    case 'validate':
      validator.validateIncremental(agentId, workDescription)
        .then(() => process.exit(0))
        .catch(() => process.exit(1));
      break;
      
    case 'monitor':
      // Run validation every 30 seconds
      console.log('🔄 Starting continuous validation monitoring...');
      setInterval(() => {
        validator.validateIncremental('monitor', 'Continuous monitoring')
          .catch(err => console.error('Monitoring error:', err.message));
      }, 30000);
      break;
      
    default:
      console.log(`
Usage:
  node incremental-validator.js validate [agentId] [work description]
  node incremental-validator.js monitor

Examples:
  node incremental-validator.js validate agent5 "Fixed ProcessPool integration"
  node incremental-validator.js monitor
`);
      process.exit(1);
  }
}

export default IncrementalValidator;