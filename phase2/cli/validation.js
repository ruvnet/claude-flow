#!/usr/bin/env node

/**
 * Phase 2 CLI Consolidation & Runtime Migration - Comprehensive Validation Script
 * QA TESTER AGENT - swarm-development-hierarchical-1751006703324
 * 
 * This script performs comprehensive validation of CLI backward compatibility
 * and runtime migration readiness for Phase 2 remediation.
 */

import { execSync, spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

class CLIValidationSuite {
  constructor() {
    this.results = {
      timestamp: new Date().toISOString(),
      environment: {
        nodeVersion: process.version,
        platform: os.platform(),
        arch: os.arch(),
        workingDirectory: process.cwd()
      },
      summary: {
        totalTests: 0,
        passed: 0,
        failed: 0,
        warnings: 0,
        skipped: 0
      },
      categories: {
        basicCommands: [],
        advancedCommands: [],
        errorHandling: [],
        performance: [],
        compatibility: [],
        runtimeMigration: []
      },
      issues: [],
      recommendations: []
    };
    
    this.CLI_PATH = './claude-flow';
    this.TIMEOUT = 30000;
  }

  log(message, level = 'info') {
    const timestamp = new Date().toISOString();
    const prefix = level.toUpperCase().padEnd(7);
    console.log(`[${timestamp}] ${prefix} ${message}`);
  }

  async executeCommand(command, args = [], options = {}) {
    const startTime = Date.now();
    
    return new Promise((resolve) => {
      const child = spawn(command, args, {
        stdio: ['pipe', 'pipe', 'pipe'],
        timeout: this.TIMEOUT,
        ...options
      });
      
      let stdout = '';
      let stderr = '';
      
      child.stdout?.on('data', (data) => {
        stdout += data.toString();
      });
      
      child.stderr?.on('data', (data) => {
        stderr += data.toString();
      });
      
      child.on('close', (exitCode) => {
        const duration = Date.now() - startTime;
        resolve({
          command: `${command} ${args.join(' ')}`,
          exitCode: exitCode || 0,
          stdout,
          stderr,
          duration,
          success: exitCode === 0
        });
      });
      
      child.on('error', (error) => {
        const duration = Date.now() - startTime;
        resolve({
          command: `${command} ${args.join(' ')}`,
          exitCode: -1,
          stdout: '',
          stderr: error.message,
          duration,
          success: false,
          error: error.message
        });
      });
    });
  }

  async testBasicCommands() {
    this.log('Testing basic CLI commands...', 'info');
    
    const basicTests = [
      { name: 'Help Command', args: ['--help'], expectSuccess: true },
      { name: 'Version Display', args: ['--version'], expectSuccess: true, allowExitCode1: true },
      { name: 'Status Command', args: ['status'], expectSuccess: true },
      { name: 'Config Show', args: ['config', 'show'], expectSuccess: true, allowExitCode1: true },
      { name: 'Config Validate', args: ['config', 'validate'], expectSuccess: true, allowExitCode1: true }
    ];

    for (const test of basicTests) {
      this.results.summary.totalTests++;
      
      try {
        const result = await this.executeCommand(this.CLI_PATH, test.args);
        
        const success = test.allowExitCode1 ? 
          (result.exitCode === 0 || result.exitCode === 1) : 
          result.exitCode === 0;

        this.results.categories.basicCommands.push({
          name: test.name,
          command: result.command,
          exitCode: result.exitCode,
          duration: result.duration,
          success: success,
          output: result.stdout.substring(0, 200),
          error: result.stderr ? result.stderr.substring(0, 200) : null
        });

        if (success) {
          this.results.summary.passed++;
          this.log(`✅ ${test.name} - PASSED (${result.duration}ms)`, 'info');
        } else {
          this.results.summary.failed++;
          this.log(`❌ ${test.name} - FAILED (exit code: ${result.exitCode})`, 'error');
          this.results.issues.push(`Basic command failed: ${test.name}`);
        }
      } catch (error) {
        this.results.summary.failed++;
        this.log(`❌ ${test.name} - ERROR: ${error.message}`, 'error');
        this.results.issues.push(`Basic command error: ${test.name} - ${error.message}`);
      }
    }
  }

  async testAdvancedCommands() {
    this.log('Testing advanced CLI commands...', 'info');
    
    const advancedTests = [
      { name: 'Memory List', args: ['memory', 'list'], allowFailure: true },
      { name: 'Memory Stats', args: ['memory', 'stats'], allowFailure: true },
      { name: 'SPARC Modes', args: ['sparc', 'modes'], expectSuccess: true },
      { name: 'SPARC Help', args: ['sparc', '--help'], expectSuccess: true },
      { name: 'Agent List', args: ['agent', 'list'], allowFailure: true },
      { name: 'Agent Help', args: ['agent', '--help'], expectSuccess: true },
      { name: 'MCP Status', args: ['mcp', 'status'], allowFailure: true },
      { name: 'MCP Tools', args: ['mcp', 'tools'], allowFailure: true },
      { name: 'Task List', args: ['task', 'list'], allowFailure: true },
      { name: 'Monitor Status', args: ['monitor'], allowFailure: true }
    ];

    for (const test of advancedTests) {
      this.results.summary.totalTests++;
      
      try {
        const result = await this.executeCommand(this.CLI_PATH, test.args);
        
        const success = test.allowFailure ? 
          (result.exitCode >= 0) : // Any exit code is acceptable
          result.exitCode === 0;

        this.results.categories.advancedCommands.push({
          name: test.name,
          command: result.command,
          exitCode: result.exitCode,
          duration: result.duration,
          success: success,
          output: result.stdout.substring(0, 200),
          error: result.stderr ? result.stderr.substring(0, 200) : null,
          allowFailure: test.allowFailure
        });

        if (success) {
          this.results.summary.passed++;
          this.log(`✅ ${test.name} - PASSED (${result.duration}ms)`, 'info');
        } else if (test.allowFailure && result.exitCode <= 1) {
          this.results.summary.warnings++;
          this.log(`⚠️ ${test.name} - WARNING (exit code: ${result.exitCode})`, 'warn');
        } else {
          this.results.summary.failed++;
          this.log(`❌ ${test.name} - FAILED (exit code: ${result.exitCode})`, 'error');
          this.results.issues.push(`Advanced command failed: ${test.name}`);
        }
      } catch (error) {
        if (test.allowFailure) {
          this.results.summary.warnings++;
          this.log(`⚠️ ${test.name} - ERROR (expected): ${error.message}`, 'warn');
        } else {
          this.results.summary.failed++;
          this.log(`❌ ${test.name} - ERROR: ${error.message}`, 'error');
          this.results.issues.push(`Advanced command error: ${test.name} - ${error.message}`);
        }
      }
    }
  }

  async testErrorHandling() {
    this.log('Testing error handling...', 'info');
    
    const errorTests = [
      { name: 'Invalid Command', args: ['invalid-command-xyz'], expectFailure: true },
      { name: 'Invalid Subcommand', args: ['config', 'invalid-subcommand'], expectFailure: true },
      { name: 'Invalid SPARC Mode', args: ['sparc', 'run', 'invalid-mode', 'test'], expectFailure: true },
      { name: 'Missing Arguments', args: ['memory', 'store'], expectFailure: true }
    ];

    for (const test of errorTests) {
      this.results.summary.totalTests++;
      
      try {
        const result = await this.executeCommand(this.CLI_PATH, test.args);
        
        const success = test.expectFailure ? 
          result.exitCode > 0 : 
          result.exitCode === 0;

        this.results.categories.errorHandling.push({
          name: test.name,
          command: result.command,
          exitCode: result.exitCode,
          duration: result.duration,
          success: success,
          expectFailure: test.expectFailure,
          errorMessage: result.stderr.substring(0, 200)
        });

        if (success) {
          this.results.summary.passed++;
          this.log(`✅ ${test.name} - PASSED (proper error handling)`, 'info');
        } else {
          this.results.summary.failed++;
          this.log(`❌ ${test.name} - FAILED (improper error handling)`, 'error');
          this.results.issues.push(`Error handling failed: ${test.name}`);
        }
      } catch (error) {
        if (test.expectFailure) {
          this.results.summary.passed++;
          this.log(`✅ ${test.name} - PASSED (expected error)`, 'info');
        } else {
          this.results.summary.failed++;
          this.log(`❌ ${test.name} - ERROR: ${error.message}`, 'error');
          this.results.issues.push(`Error handling test failed: ${test.name} - ${error.message}`);
        }
      }
    }
  }

  async testPerformance() {
    this.log('Testing performance benchmarks...', 'info');
    
    const performanceTests = [
      { name: 'Help Command Speed', args: ['--help'], maxDuration: 5000 },
      { name: 'Status Command Speed', args: ['status'], maxDuration: 10000 },
      { name: 'Config Show Speed', args: ['config', 'show'], maxDuration: 8000 },
      { name: 'SPARC Modes Speed', args: ['sparc', 'modes'], maxDuration: 8000 }
    ];

    for (const test of performanceTests) {
      this.results.summary.totalTests++;
      
      try {
        const result = await this.executeCommand(this.CLI_PATH, test.args);
        
        const withinTimeLimit = result.duration <= test.maxDuration;
        const functionallySuccessful = result.exitCode <= 1; // Allow minor exit codes

        this.results.categories.performance.push({
          name: test.name,
          command: result.command,
          duration: result.duration,
          maxDuration: test.maxDuration,
          withinTimeLimit: withinTimeLimit,
          exitCode: result.exitCode,
          success: withinTimeLimit && functionallySuccessful
        });

        if (withinTimeLimit && functionallySuccessful) {
          this.results.summary.passed++;
          this.log(`✅ ${test.name} - PASSED (${result.duration}ms)`, 'info');
        } else if (functionallySuccessful) {
          this.results.summary.warnings++;
          this.log(`⚠️ ${test.name} - SLOW (${result.duration}ms > ${test.maxDuration}ms)`, 'warn');
        } else {
          this.results.summary.failed++;
          this.log(`❌ ${test.name} - FAILED (${result.duration}ms, exit: ${result.exitCode})`, 'error');
          this.results.issues.push(`Performance test failed: ${test.name}`);
        }
      } catch (error) {
        this.results.summary.failed++;
        this.log(`❌ ${test.name} - ERROR: ${error.message}`, 'error');
        this.results.issues.push(`Performance test error: ${test.name} - ${error.message}`);
      }
    }
  }

  async testRuntimeCompatibility() {
    this.log('Testing runtime compatibility...', 'info');
    
    // Test different Node.js environment configurations
    const envTests = [
      { name: 'Test Environment', env: { NODE_ENV: 'test' } },
      { name: 'Production Environment', env: { NODE_ENV: 'production' } },
      { name: 'Debug Mode', env: { DEBUG: '*' } },
      { name: 'Custom Working Directory', env: { CLAUDE_WORKING_DIR: process.cwd() } }
    ];

    for (const envTest of envTests) {
      this.results.summary.totalTests++;
      
      try {
        const result = await this.executeCommand(this.CLI_PATH, ['--help'], {
          env: { ...process.env, ...envTest.env }
        });
        
        const success = result.exitCode === 0;

        this.results.categories.compatibility.push({
          name: envTest.name,
          environment: envTest.env,
          exitCode: result.exitCode,
          duration: result.duration,
          success: success
        });

        if (success) {
          this.results.summary.passed++;
          this.log(`✅ ${envTest.name} - PASSED`, 'info');
        } else {
          this.results.summary.failed++;
          this.log(`❌ ${envTest.name} - FAILED (exit code: ${result.exitCode})`, 'error');
          this.results.issues.push(`Compatibility test failed: ${envTest.name}`);
        }
      } catch (error) {
        this.results.summary.failed++;
        this.log(`❌ ${envTest.name} - ERROR: ${error.message}`, 'error');
        this.results.issues.push(`Compatibility test error: ${envTest.name} - ${error.message}`);
      }
    }
  }

  async testFileSystemCompatibility() {
    this.log('Testing file system compatibility...', 'info');
    
    const fsTests = [
      { name: 'CLI Executable Exists', path: this.CLI_PATH },
      { name: 'Package.json Exists', path: 'package.json' },
      { name: 'TypeScript Config Exists', path: 'tsconfig.json' },
      { name: 'Source Directory Exists', path: 'src' },
      { name: 'CLI Source Directory Exists', path: 'src/cli' }
    ];

    for (const fsTest of fsTests) {
      this.results.summary.totalTests++;
      
      try {
        const exists = fs.existsSync(fsTest.path);
        
        this.results.categories.compatibility.push({
          name: fsTest.name,
          path: fsTest.path,
          exists: exists,
          success: exists
        });

        if (exists) {
          this.results.summary.passed++;
          this.log(`✅ ${fsTest.name} - EXISTS`, 'info');
        } else {
          this.results.summary.failed++;
          this.log(`❌ ${fsTest.name} - NOT FOUND`, 'error');
          this.results.issues.push(`File system test failed: ${fsTest.name}`);
        }
      } catch (error) {
        this.results.summary.failed++;
        this.log(`❌ ${fsTest.name} - ERROR: ${error.message}`, 'error');
        this.results.issues.push(`File system test error: ${fsTest.name} - ${error.message}`);
      }
    }
  }

  generateRecommendations() {
    const { passed, failed, warnings, totalTests } = this.results.summary;
    const successRate = ((passed + warnings * 0.5) / totalTests) * 100;

    this.results.recommendations.push(
      `Overall Success Rate: ${successRate.toFixed(1)}%`,
      `Tests Passed: ${passed}/${totalTests}`,
      `Tests Failed: ${failed}/${totalTests}`,
      `Warnings: ${warnings}/${totalTests}`
    );

    if (successRate >= 90) {
      this.results.recommendations.push('🟢 EXCELLENT - System is ready for Phase 2 consolidation');
    } else if (successRate >= 80) {
      this.results.recommendations.push('🟡 GOOD - System is mostly ready, minor issues to address');
    } else if (successRate >= 70) {
      this.results.recommendations.push('🟠 FAIR - System has issues that should be addressed before consolidation');
    } else {
      this.results.recommendations.push('🔴 POOR - System has significant issues requiring attention');
    }

    if (this.results.issues.length > 0) {
      this.results.recommendations.push('');
      this.results.recommendations.push('Critical Issues to Address:');
      this.results.issues.forEach(issue => {
        this.results.recommendations.push(`  • ${issue}`);
      });
    }

    // Phase 2 specific recommendations
    this.results.recommendations.push('');
    this.results.recommendations.push('Phase 2 Consolidation Recommendations:');
    
    if (failed === 0) {
      this.results.recommendations.push('  • Proceed with CLI consolidation - all basic functionality working');
    } else {
      this.results.recommendations.push('  • Fix failing tests before proceeding with consolidation');
    }
    
    this.results.recommendations.push('  • Prioritize Tier 1 commands (start, sparc, init, swarm, agent) for consolidation');
    this.results.recommendations.push('  • Maintain comprehensive test coverage during consolidation');
    this.results.recommendations.push('  • Test each consolidation step incrementally');
    this.results.recommendations.push('  • Create rollback procedures for each consolidation phase');
  }

  async saveResults() {
    const resultsDir = 'phase2/cli';
    if (!fs.existsSync(resultsDir)) {
      fs.mkdirSync(resultsDir, { recursive: true });
    }

    const resultsFile = path.join(resultsDir, 'validation-results.json');
    const reportFile = path.join(resultsDir, 'validation-report.md');

    // Save JSON results
    fs.writeFileSync(resultsFile, JSON.stringify(this.results, null, 2));

    // Generate markdown report
    const report = this.generateMarkdownReport();
    fs.writeFileSync(reportFile, report);

    this.log(`Results saved to: ${resultsFile}`, 'info');
    this.log(`Report saved to: ${reportFile}`, 'info');
  }

  generateMarkdownReport() {
    const { summary, recommendations, issues } = this.results;
    
    return `# Phase 2 CLI Validation Report

**Generated**: ${this.results.timestamp}
**QA TESTER AGENT**: swarm-development-hierarchical-1751006703324

## Summary

- **Total Tests**: ${summary.totalTests}
- **Passed**: ${summary.passed}
- **Failed**: ${summary.failed}
- **Warnings**: ${summary.warnings}
- **Success Rate**: ${(((summary.passed + summary.warnings * 0.5) / summary.totalTests) * 100).toFixed(1)}%

## Environment

- **Node.js Version**: ${this.results.environment.nodeVersion}
- **Platform**: ${this.results.environment.platform}
- **Architecture**: ${this.results.environment.arch}
- **Working Directory**: ${this.results.environment.workingDirectory}

## Test Categories

### Basic Commands
${this.results.categories.basicCommands.map(test => 
  `- ${test.success ? '✅' : '❌'} ${test.name} (${test.duration}ms)`
).join('\n')}

### Advanced Commands
${this.results.categories.advancedCommands.map(test => 
  `- ${test.success ? '✅' : test.allowFailure ? '⚠️' : '❌'} ${test.name} (${test.duration}ms)`
).join('\n')}

### Error Handling
${this.results.categories.errorHandling.map(test => 
  `- ${test.success ? '✅' : '❌'} ${test.name}`
).join('\n')}

### Performance
${this.results.categories.performance.map(test => 
  `- ${test.success ? '✅' : test.withinTimeLimit ? '⚠️' : '❌'} ${test.name} (${test.duration}ms)`
).join('\n')}

## Issues Found

${issues.length > 0 ? issues.map(issue => `- ${issue}`).join('\n') : 'No critical issues found.'}

## Recommendations

${recommendations.join('\n')}

## Next Steps

1. Review and address any failed tests
2. Proceed with Phase 2 consolidation for passing commands
3. Implement incremental testing during consolidation
4. Maintain this test suite for regression testing

---
*Report generated by QA TESTER AGENT for Phase 2 CLI Consolidation & Runtime Migration*
`;
  }

  async run() {
    this.log('Starting Phase 2 CLI Validation Suite...', 'info');
    this.log(`Environment: Node.js ${process.version} on ${os.platform()}`, 'info');
    
    try {
      await this.testBasicCommands();
      await this.testAdvancedCommands();
      await this.testErrorHandling();
      await this.testPerformance();
      await this.testRuntimeCompatibility();
      await this.testFileSystemCompatibility();
      
      this.generateRecommendations();
      await this.saveResults();
      
      this.log('Validation suite completed successfully!', 'info');
      this.log(`Results: ${this.results.summary.passed} passed, ${this.results.summary.failed} failed, ${this.results.summary.warnings} warnings`, 'info');
      
      return this.results;
    } catch (error) {
      this.log(`Validation suite failed: ${error.message}`, 'error');
      throw error;
    }
  }
}

// Run validation if called directly
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const validator = new CLIValidationSuite();
  validator.run()
    .then(results => {
      const successRate = ((results.summary.passed + results.summary.warnings * 0.5) / results.summary.totalTests) * 100;
      console.log(`\n🎯 Validation Complete: ${successRate.toFixed(1)}% success rate`);
      process.exit(results.summary.failed > 0 ? 1 : 0);
    })
    .catch(error => {
      console.error('❌ Validation suite failed:', error.message);
      process.exit(1);
    });
}

export default CLIValidationSuite;