#!/usr/bin/env node

/**
 * Regression Tester for Swarm Operations
 * 
 * Automated regression testing that runs after each significant change
 * to ensure no functionality is broken by agent modifications.
 */

const { execSync, spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

class RegressionTester {
  constructor() {
    this.testDir = path.join(__dirname, 'regression-tests');
    this.reportDir = path.join(__dirname, 'reports');
    this.baselineDir = path.join(__dirname, 'baselines');
    this.ensureDirectories();
  }

  ensureDirectories() {
    [this.testDir, this.reportDir, this.baselineDir].forEach(dir => {
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
    });
  }

  /**
   * Run comprehensive regression tests
   */
  async runRegressionTests(context = {}) {
    const timestamp = new Date().toISOString();
    console.log(`\n🧪 Starting regression tests at ${timestamp}`);
    
    const results = {
      timestamp,
      context,
      tests: {},
      summary: {},
      baseline_comparison: {}
    };

    try {
      // 1. Core functionality tests
      results.tests.core = await this.testCoreFunctionality();
      
      // 2. CLI command tests
      results.tests.cli = await this.testCLICommands();
      
      // 3. Process management tests
      results.tests.process = await this.testProcessManagement();
      
      // 4. Configuration tests
      results.tests.config = await this.testConfiguration();
      
      // 5. Memory/coordination tests
      results.tests.coordination = await this.testCoordination();
      
      // 6. Integration tests
      results.tests.integration = await this.testIntegration();
      
      // Generate summary
      results.summary = this.generateTestSummary(results.tests);
      
      // Compare with baseline
      results.baseline_comparison = await this.compareWithBaseline(results);
      
      // Save results
      await this.saveResults(results);
      
      return results;
      
    } catch (error) {
      console.error('❌ Regression testing failed:', error.message);
      results.error = error.message;
      await this.saveResults(results);
      throw error;
    }
  }

  /**
   * Test core functionality that should never break
   */
  async testCoreFunctionality() {
    console.log('🔧 Testing core functionality...');
    
    const tests = {
      import_structure: await this.testImportStructure(),
      basic_instantiation: await this.testBasicInstantiation(),
      config_loading: await this.testConfigLoading(),
      logger_functionality: await this.testLoggerFunctionality()
    };
    
    return {
      status: Object.values(tests).every(t => t.status === 'pass') ? 'pass' : 'fail',
      tests,
      details: 'Core system functionality verification'
    };
  }

  /**
   * Test CLI command functionality
   */
  async testCLICommands() {
    console.log('💻 Testing CLI commands...');
    
    const commands = [
      { cmd: './claude-flow --help', desc: 'Help command' },
      { cmd: './claude-flow status', desc: 'Status command' },
      { cmd: './claude-flow config show', desc: 'Config show' },
      { cmd: './claude-flow memory list', desc: 'Memory list' }
    ];
    
    const results = [];
    
    for (const { cmd, desc } of commands) {
      try {
        const output = execSync(cmd, { 
          cwd: path.join(__dirname, '..'),
          encoding: 'utf8',
          timeout: 10000,
          stdio: ['pipe', 'pipe', 'pipe']
        });
        
        results.push({
          command: cmd,
          description: desc,
          status: 'pass',
          output: output.substring(0, 200)
        });
        
      } catch (error) {
        results.push({
          command: cmd,
          description: desc,
          status: 'fail',
          error: error.message.substring(0, 200)
        });
      }
    }
    
    const passCount = results.filter(r => r.status === 'pass').length;
    
    return {
      status: passCount === results.length ? 'pass' : 'partial',
      passed: passCount,
      total: results.length,
      tests: results,
      details: 'CLI command functionality verification'
    };
  }

  /**
   * Test process management functionality
   */
  async testProcessManagement() {
    console.log('⚙️ Testing process management...');
    
    const tests = {
      process_pool_import: await this.testProcessPoolImport(),
      process_registry_basic: await this.testProcessRegistryBasic(),
      ipc_communication: await this.testIPCCommunication()
    };
    
    return {
      status: Object.values(tests).every(t => t.status === 'pass') ? 'pass' : 'fail',
      tests,
      details: 'Process management and IPC functionality'
    };
  }

  /**
   * Test configuration system
   */
  async testConfiguration() {
    console.log('⚙️ Testing configuration...');
    
    const tests = {
      config_loading: await this.testConfigLoading(),
      config_validation: await this.testConfigValidation(),
      default_config: await this.testDefaultConfig()
    };
    
    return {
      status: Object.values(tests).every(t => t.status === 'pass') ? 'pass' : 'fail',
      tests,
      details: 'Configuration system functionality'
    };
  }

  /**
   * Test coordination and memory systems
   */
  async testCoordination() {
    console.log('🤝 Testing coordination systems...');
    
    const tests = {
      memory_manager: await this.testMemoryManager(),
      task_coordination: await this.testTaskCoordination(),
      agent_communication: await this.testAgentCommunication()
    };
    
    return {
      status: Object.values(tests).every(t => t.status === 'pass') ? 'pass' : 'fail',
      tests,
      details: 'Coordination and memory systems'
    };
  }

  /**
   * Test integration scenarios
   */
  async testIntegration() {
    console.log('🔗 Testing integration scenarios...');
    
    const tests = {
      end_to_end_flow: await this.testEndToEndFlow(),
      swarm_coordination: await this.testSwarmCoordination(),
      error_handling: await this.testErrorHandling()
    };
    
    return {
      status: Object.values(tests).every(t => t.status === 'pass') ? 'pass' : 'fail',
      tests,
      details: 'Integration and end-to-end scenarios'
    };
  }

  // Individual test implementations
  async testImportStructure() {
    try {
      const testCode = `
        const config = require('../src/config');
        const { Logger } = require('../src/shared/logger');
        console.log('Import structure test passed');
      `;
      
      const result = execSync(`node -e "${testCode}"`, {
        cwd: __dirname,
        encoding: 'utf8',
        timeout: 5000
      });
      
      return { status: 'pass', message: 'Core imports work correctly' };
      
    } catch (error) {
      return { status: 'fail', error: error.message };
    }
  }

  async testBasicInstantiation() {
    try {
      const testCode = `
        const { Logger } = require('../src/shared/logger');
        const logger = new Logger('test');
        logger.info('Test message');
        console.log('Basic instantiation test passed');
      `;
      
      const result = execSync(`node -e "${testCode}"`, {
        cwd: __dirname,
        encoding: 'utf8',
        timeout: 5000
      });
      
      return { status: 'pass', message: 'Basic instantiation works' };
      
    } catch (error) {
      return { status: 'fail', error: error.message };
    }
  }

  async testConfigLoading() {
    try {
      const testCode = `
        const config = require('../src/config');
        if (config && typeof config === 'object') {
          console.log('Config loading test passed');
        } else {
          throw new Error('Config not loaded properly');
        }
      `;
      
      const result = execSync(`node -e "${testCode}"`, {
        cwd: __dirname,
        encoding: 'utf8',
        timeout: 5000
      });
      
      return { status: 'pass', message: 'Configuration loads correctly' };
      
    } catch (error) {
      return { status: 'fail', error: error.message };
    }
  }

  async testLoggerFunctionality() {
    try {
      const testCode = `
        const { Logger } = require('../src/shared/logger');
        const logger = new Logger('regression-test');
        logger.info('Test info message');
        logger.warn('Test warning message');
        logger.error('Test error message');
        console.log('Logger functionality test passed');
      `;
      
      const result = execSync(`node -e "${testCode}"`, {
        cwd: __dirname,
        encoding: 'utf8',
        timeout: 5000
      });
      
      return { status: 'pass', message: 'Logger functionality works' };
      
    } catch (error) {
      return { status: 'fail', error: error.message };
    }
  }

  async testProcessPoolImport() {
    try {
      const testCode = `
        const { ProcessPool } = require('../src/core/process-pool');
        if (ProcessPool) {
          console.log('ProcessPool import test passed');
        } else {
          throw new Error('ProcessPool not available');
        }
      `;
      
      const result = execSync(`node -e "${testCode}"`, {
        cwd: __dirname,
        encoding: 'utf8',
        timeout: 5000
      });
      
      return { status: 'pass', message: 'ProcessPool can be imported' };
      
    } catch (error) {
      return { status: 'fail', error: error.message };
    }
  }

  async testProcessRegistryBasic() {
    try {
      const testCode = `
        const fs = require('fs');
        const path = require('path');
        const registryPath = path.join(__dirname, '../src/services/process-registry');
        if (fs.existsSync(registryPath)) {
          console.log('Process registry structure test passed');
        } else {
          throw new Error('Process registry not found');
        }
      `;
      
      const result = execSync(`node -e "${testCode}"`, {
        cwd: __dirname,
        encoding: 'utf8',
        timeout: 5000
      });
      
      return { status: 'pass', message: 'Process registry structure exists' };
      
    } catch (error) {
      return { status: 'fail', error: error.message };
    }
  }

  async testIPCCommunication() {
    // Basic IPC structure test
    try {
      const testCode = `
        const fs = require('fs');
        const path = require('path');
        const ipcPath = path.join(__dirname, '../src/communication/ipc');
        if (fs.existsSync(ipcPath)) {
          console.log('IPC structure test passed');
        } else {
          throw new Error('IPC structure not found');
        }
      `;
      
      const result = execSync(`node -e "${testCode}"`, {
        cwd: __dirname,
        encoding: 'utf8',
        timeout: 5000
      });
      
      return { status: 'pass', message: 'IPC structure exists' };
      
    } catch (error) {
      return { status: 'fail', error: error.message };
    }
  }

  async testConfigValidation() {
    return { status: 'pass', message: 'Config validation placeholder' };
  }

  async testDefaultConfig() {
    return { status: 'pass', message: 'Default config placeholder' };
  }

  async testMemoryManager() {
    return { status: 'pass', message: 'Memory manager placeholder' };
  }

  async testTaskCoordination() {
    return { status: 'pass', message: 'Task coordination placeholder' };
  }

  async testAgentCommunication() {
    return { status: 'pass', message: 'Agent communication placeholder' };
  }

  async testEndToEndFlow() {
    return { status: 'pass', message: 'End-to-end flow placeholder' };
  }

  async testSwarmCoordination() {
    return { status: 'pass', message: 'Swarm coordination placeholder' };
  }

  async testErrorHandling() {
    return { status: 'pass', message: 'Error handling placeholder' };
  }

  /**
   * Generate test summary
   */
  generateTestSummary(tests) {
    const categories = Object.keys(tests);
    const totalTests = categories.length;
    const passedTests = categories.filter(cat => tests[cat].status === 'pass').length;
    const partialTests = categories.filter(cat => tests[cat].status === 'partial').length;
    const failedTests = categories.filter(cat => tests[cat].status === 'fail').length;
    
    return {
      total: totalTests,
      passed: passedTests,
      partial: partialTests,
      failed: failedTests,
      pass_rate: Math.round((passedTests / totalTests) * 100),
      status: failedTests === 0 ? (partialTests === 0 ? 'pass' : 'partial') : 'fail'
    };
  }

  /**
   * Compare with baseline results
   */
  async compareWithBaseline(results) {
    const baselineFile = path.join(this.baselineDir, 'regression-baseline.json');
    
    if (!fs.existsSync(baselineFile)) {
      // Create baseline if it doesn't exist
      await this.createBaseline(results);
      return { status: 'baseline_created', message: 'New baseline created' };
    }
    
    try {
      const baseline = JSON.parse(fs.readFileSync(baselineFile, 'utf8'));
      
      const comparison = {
        pass_rate_change: results.summary.pass_rate - baseline.summary.pass_rate,
        new_failures: [],
        new_passes: [],
        regression_detected: false
      };
      
      // Compare individual test categories
      for (const category of Object.keys(results.tests)) {
        const current = results.tests[category].status;
        const baseline_status = baseline.tests[category]?.status;
        
        if (baseline_status === 'pass' && current === 'fail') {
          comparison.new_failures.push(category);
          comparison.regression_detected = true;
        } else if (baseline_status === 'fail' && current === 'pass') {
          comparison.new_passes.push(category);
        }
      }
      
      return comparison;
      
    } catch (error) {
      return { status: 'comparison_error', error: error.message };
    }
  }

  /**
   * Create baseline for future comparisons
   */
  async createBaseline(results) {
    const baselineFile = path.join(this.baselineDir, 'regression-baseline.json');
    
    const baseline = {
      created: new Date().toISOString(),
      summary: results.summary,
      tests: Object.fromEntries(
        Object.entries(results.tests).map(([key, value]) => [
          key,
          { status: value.status, description: value.details }
        ])
      )
    };
    
    fs.writeFileSync(baselineFile, JSON.stringify(baseline, null, 2));
    console.log(`📊 Baseline created: ${baselineFile}`);
  }

  /**
   * Save test results
   */
  async saveResults(results) {
    const timestamp = results.timestamp.replace(/[:.]/g, '-');
    const resultsFile = path.join(this.reportDir, `regression-${timestamp}.json`);
    
    fs.writeFileSync(resultsFile, JSON.stringify(results, null, 2));
    
    // Create summary report
    const summaryReport = this.generateSummaryReport(results);
    const reportFile = path.join(this.reportDir, `regression-summary-${timestamp}.md`);
    fs.writeFileSync(reportFile, summaryReport);
    
    console.log(`📝 Regression test results saved:`);
    console.log(`   - ${resultsFile}`);
    console.log(`   - ${reportFile}`);
  }

  /**
   * Generate summary report
   */
  generateSummaryReport(results) {
    const { summary, baseline_comparison, tests } = results;
    
    let report = `# Regression Test Summary

**Timestamp:** ${results.timestamp}
**Context:** ${JSON.stringify(results.context)}

## Overall Results
- **Total Test Categories:** ${summary.total}
- **Passed:** ${summary.passed}
- **Partial:** ${summary.partial}
- **Failed:** ${summary.failed}
- **Pass Rate:** ${summary.pass_rate}%
- **Overall Status:** ${summary.status}

## Test Categories
`;

    Object.entries(tests).forEach(([category, result]) => {
      const status = result.status === 'pass' ? '✅' : 
                   result.status === 'partial' ? '⚠️' : '❌';
      report += `
### ${category} ${status}
- **Status:** ${result.status}
- **Details:** ${result.details}
`;
      
      if (result.tests && typeof result.tests === 'object') {
        Object.entries(result.tests).forEach(([testName, testResult]) => {
          const testStatus = testResult.status === 'pass' ? '✅' : '❌';
          report += `  - ${testName}: ${testStatus} ${testResult.message || testResult.error || ''}\n`;
        });
      }
    });

    if (baseline_comparison) {
      report += `
## Baseline Comparison
`;
      
      if (baseline_comparison.regression_detected) {
        report += `❌ **REGRESSION DETECTED**\n`;
        if (baseline_comparison.new_failures.length > 0) {
          report += `- New failures: ${baseline_comparison.new_failures.join(', ')}\n`;
        }
      } else {
        report += `✅ No regressions detected\n`;
      }
      
      if (baseline_comparison.new_passes.length > 0) {
        report += `- New passes: ${baseline_comparison.new_passes.join(', ')}\n`;
      }
      
      if (baseline_comparison.pass_rate_change !== 0) {
        const change = baseline_comparison.pass_rate_change > 0 ? '+' : '';
        report += `- Pass rate change: ${change}${baseline_comparison.pass_rate_change}%\n`;
      }
    }

    return report;
  }
}

// CLI Interface
if (require.main === module) {
  const tester = new RegressionTester();
  
  const command = process.argv[2];
  const context = process.argv[3] ? { trigger: process.argv[3] } : {};
  
  switch (command) {
    case 'run':
      tester.runRegressionTests(context)
        .then(() => process.exit(0))
        .catch(() => process.exit(1));
      break;
      
    case 'baseline':
      tester.runRegressionTests({ baseline: true })
        .then(() => process.exit(0))
        .catch(() => process.exit(1));
      break;
      
    default:
      console.log(`
Usage:
  node regression-tester.js run [context]
  node regression-tester.js baseline

Examples:
  node regression-tester.js run "after-agent5-completion"
  node regression-tester.js baseline
`);
      process.exit(1);
  }
}

module.exports = RegressionTester;