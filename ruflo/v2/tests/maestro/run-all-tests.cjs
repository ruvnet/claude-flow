#!/usr/bin/env node

/**
 * Maestro Native Hive Mind Test Runner
 * 
 * Runs all maestro validation and workflow tests
 */

const { execSync } = require('child_process');
const path = require('path');

// ANSI colors for console output
const colors = {
  green: '\x1b[32m',
  red: '\x1b[31m',
  blue: '\x1b[34m',
  yellow: '\x1b[33m',
  cyan: '\x1b[36m',
  reset: '\x1b[0m',
  bold: '\x1b[1m'
};

function log(message, color = 'reset') {
  console.log(`${colors[color]}${message}${colors.reset}`);
}

async function runTest(testName, testPath) {
  log(`\n🧪 Running ${testName}...`, 'blue');
  log('='.repeat(50), 'blue');
  
  try {
    const output = execSync(`node ${testPath}`, { 
      encoding: 'utf8',
      stdio: 'inherit',
      cwd: path.join(__dirname, '../..')
    });
    
    log(`✅ ${testName} completed successfully`, 'green');
    return { test: testName, status: 'pass' };
  } catch (error) {
    if (error.status === 0) {
      // Exit code 0 means success
      log(`✅ ${testName} completed successfully`, 'green');
      return { test: testName, status: 'pass' };
    } else {
      log(`❌ ${testName} failed with exit code ${error.status}`, 'red');
      return { test: testName, status: 'fail', error: `Exit code: ${error.status}` };
    }
  }
}

async function main() {
  log('🚀 Maestro Native Hive Mind Test Suite', 'bold');
  log('=====================================', 'bold');
  
  const tests = [
    {
      name: 'Implementation Validation',
      path: path.join(__dirname, 'validate-maestro-native-hive-mind.cjs')
    },
    {
      name: 'Specs-Driven Workflow Test',
      path: path.join(__dirname, 'test-specs-driven-workflow.cjs')
    }
  ];
  
  const results = [];
  
  for (const test of tests) {
    const result = await runTest(test.name, test.path);
    results.push(result);
  }
  
  // Generate summary report
  log('\n📊 Test Suite Summary', 'bold');
  log('====================', 'bold');
  
  const totalTests = results.length;
  const passedTests = results.filter(r => r.status === 'pass').length;
  const failedTests = results.filter(r => r.status === 'fail').length;
  
  log(`\nTotal Test Suites: ${totalTests}`, 'cyan');
  log(`Passed: ${passedTests}`, 'green');
  log(`Failed: ${failedTests}`, 'red');
  log(`Success Rate: ${((passedTests / totalTests) * 100).toFixed(1)}%`, 'blue');
  
  results.forEach(result => {
    const status = result.status === 'pass' ? '✅' : '❌';
    const color = result.status === 'pass' ? 'green' : 'red';
    log(`  ${status} ${result.test}`, color);
  });
  
  if (failedTests === 0) {
    log('\n🎉 All test suites passed!', 'green');
    log('Maestro Native Hive Mind implementation is fully validated.', 'green');
  } else {
    log('\n⚠️  Some test suites failed. Please review individual test outputs.', 'yellow');
  }
  
  log('\n📚 Implementation Summary:', 'cyan');
  log('- Native hive mind swarm coordination implemented', 'reset');
  log('- 6 specialized agent types with specs-driven topology', 'reset');
  log('- Complete workflow phases with consensus validation', 'reset');
  log('- Steering document integration with swarm memory', 'reset');
  log('- Comprehensive cleanup and consolidation completed', 'reset');
  log('- CLI commands updated for native hive mind', 'reset');
  log('- Documentation consolidated and updated', 'reset');
  
  process.exit(failedTests === 0 ? 0 : 1);
}

if (require.main === module) {
  main().catch(error => {
    console.error(`\n❌ Test runner failed: ${error.message}`);
    process.exit(1);
  });
}