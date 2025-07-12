#!/usr/bin/env node

/**
 * Comprehensive test suite for NPX cache isolation fix
 * 
 * Tests multiple scenarios to ensure the isolated cache approach
 * prevents ENOTEMPTY errors in all situations.
 */

import { spawn, execSync } from 'child_process';
import path from 'path';
import fs from 'fs/promises';
import os from 'os';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const TEST_DIR = path.join(os.tmpdir(), 'claude-flow-cache-test-' + Date.now());
const CLAUDE_FLOW_ROOT = path.join(__dirname, '..');

// Test results tracking
const results = {
  passed: 0,
  failed: 0,
  tests: []
};

// Colors for output
const colors = {
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  reset: '\x1b[0m'
};

function log(message, color = 'reset') {
  console.log(`${colors[color]}${message}${colors.reset}`);
}

async function cleanup() {
  try {
    await fs.rm(TEST_DIR, { recursive: true, force: true });
  } catch (error) {
    // Ignore cleanup errors
  }
}

async function setup() {
  await cleanup();
  await fs.mkdir(TEST_DIR, { recursive: true });
  log(`\n📁 Test directory: ${TEST_DIR}`, 'blue');
}

/**
 * Test 1: Basic isolation - single process
 */
async function testBasicIsolation() {
  const testName = 'Basic Cache Isolation';
  log(`\n🧪 ${testName}...`, 'yellow');
  
  try {
    // Run the isolated cache test directly
    const { stdout } = await execCommand('node', [
      path.join(CLAUDE_FLOW_ROOT, 'src/utils/npx-isolated-cache.js'),
      'test'
    ]);
    
    if (stdout.includes('Environment configured successfully') && 
        stdout.includes('Cleanup completed')) {
      recordSuccess(testName, 'Cache isolation working correctly');
    } else {
      recordFailure(testName, 'Unexpected output');
    }
  } catch (error) {
    recordFailure(testName, error.message);
  }
}

/**
 * Test 2: Concurrent NPX executions
 */
async function testConcurrentNpx() {
  const testName = 'Concurrent NPX Executions';
  log(`\n🧪 ${testName}...`, 'yellow');
  
  const concurrentCount = 5;
  const promises = [];
  
  for (let i = 0; i < concurrentCount; i++) {
    const projectDir = path.join(TEST_DIR, `concurrent-${i}`);
    await fs.mkdir(projectDir, { recursive: true });
    
    promises.push(runNpxCommand(projectDir, i));
  }
  
  try {
    const results = await Promise.all(promises);
    const successful = results.filter(r => r.success).length;
    
    if (successful === concurrentCount) {
      recordSuccess(testName, `All ${concurrentCount} concurrent runs succeeded`);
    } else {
      recordFailure(testName, `Only ${successful}/${concurrentCount} runs succeeded`);
    }
  } catch (error) {
    recordFailure(testName, error.message);
  }
}

/**
 * Test 3: Rapid sequential executions
 */
async function testRapidSequential() {
  const testName = 'Rapid Sequential Executions';
  log(`\n🧪 ${testName}...`, 'yellow');
  
  const sequentialCount = 3;
  let allSucceeded = true;
  
  for (let i = 0; i < sequentialCount; i++) {
    const projectDir = path.join(TEST_DIR, `sequential-${i}`);
    await fs.mkdir(projectDir, { recursive: true });
    
    try {
      const result = await runNpxCommand(projectDir, i);
      if (!result.success) {
        allSucceeded = false;
        break;
      }
    } catch (error) {
      allSucceeded = false;
      recordFailure(testName, `Run ${i + 1} failed: ${error.message}`);
      break;
    }
  }
  
  if (allSucceeded) {
    recordSuccess(testName, `All ${sequentialCount} sequential runs succeeded`);
  }
}

/**
 * Test 4: Cache cleanup verification
 */
async function testCacheCleanup() {
  const testName = 'Cache Cleanup';
  log(`\n🧪 ${testName}...`, 'yellow');
  
  try {
    // Get temp dir before running command
    const tempDir = os.tmpdir();
    const npmCacheDir = path.join(tempDir, '.npm-cache');
    
    // Count cache dirs before
    let cacheCountBefore = 0;
    try {
      const files = await fs.readdir(npmCacheDir);
      cacheCountBefore = files.filter(f => f.startsWith('claude-flow-')).length;
    } catch (e) {
      // Directory might not exist yet
    }
    
    // Run a command that creates a cache
    const projectDir = path.join(TEST_DIR, 'cleanup-test');
    await fs.mkdir(projectDir, { recursive: true });
    await runNpxCommand(projectDir, 99);
    
    // Small delay to ensure cleanup
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    // Count cache dirs after
    let cacheCountAfter = 0;
    try {
      const files = await fs.readdir(npmCacheDir);
      cacheCountAfter = files.filter(f => f.startsWith('claude-flow-')).length;
    } catch (e) {
      // Directory might not exist
    }
    
    if (cacheCountAfter <= cacheCountBefore) {
      recordSuccess(testName, 'Cache directories cleaned up properly');
    } else {
      recordFailure(testName, `Cache directories not cleaned: before=${cacheCountBefore}, after=${cacheCountAfter}`);
    }
  } catch (error) {
    recordFailure(testName, error.message);
  }
}

/**
 * Test 5: Stress test with many concurrent processes
 */
async function testStress() {
  const testName = 'Stress Test (10 concurrent)';
  log(`\n🧪 ${testName}...`, 'yellow');
  
  const stressCount = 10;
  const promises = [];
  
  for (let i = 0; i < stressCount; i++) {
    const projectDir = path.join(TEST_DIR, `stress-${i}`);
    await fs.mkdir(projectDir, { recursive: true });
    
    // Stagger the starts slightly
    await new Promise(resolve => setTimeout(resolve, i * 50));
    promises.push(runNpxCommand(projectDir, i));
  }
  
  try {
    const results = await Promise.allSettled(promises);
    const successful = results.filter(r => r.status === 'fulfilled' && r.value.success).length;
    const failed = results.filter(r => r.status === 'rejected' || !r.value?.success).length;
    
    if (successful === stressCount) {
      recordSuccess(testName, `All ${stressCount} stress test runs succeeded`);
    } else {
      recordFailure(testName, `${successful} succeeded, ${failed} failed`);
    }
  } catch (error) {
    recordFailure(testName, error.message);
  }
}

/**
 * Test 6: Verify no ENOTEMPTY errors
 */
async function testNoEnotemptyErrors() {
  const testName = 'No ENOTEMPTY Errors';
  log(`\n🧪 ${testName}...`, 'yellow');
  
  const errorCheckCount = 5;
  const promises = [];
  let enotemptyFound = false;
  
  for (let i = 0; i < errorCheckCount; i++) {
    const projectDir = path.join(TEST_DIR, `enotempty-check-${i}`);
    await fs.mkdir(projectDir, { recursive: true });
    
    promises.push(runNpxCommand(projectDir, i, true));
  }
  
  try {
    const results = await Promise.all(promises);
    
    for (const result of results) {
      if (result.stderr && result.stderr.includes('ENOTEMPTY')) {
        enotemptyFound = true;
        break;
      }
    }
    
    if (!enotemptyFound) {
      recordSuccess(testName, 'No ENOTEMPTY errors detected');
    } else {
      recordFailure(testName, 'ENOTEMPTY error detected');
    }
  } catch (error) {
    recordFailure(testName, error.message);
  }
}

// Helper function to run NPX command
async function runNpxCommand(projectDir, index, captureStderr = false) {
  return new Promise((resolve) => {
    const startTime = Date.now();
    
    // Create a simple test that uses npx
    const testScript = `
      import { getIsolatedNpxEnv } from '${path.join(CLAUDE_FLOW_ROOT, 'src/utils/npx-isolated-cache.js')}';
      import { spawn } from 'child_process';
      
      const proc = spawn('npx', ['--version'], {
        env: getIsolatedNpxEnv(),
        stdio: 'inherit'
      });
      
      proc.on('close', (code) => {
        process.exit(code);
      });
    `;
    
    const scriptPath = path.join(projectDir, 'test-npx.mjs');
    fs.writeFile(scriptPath, testScript).then(() => {
      const proc = spawn('node', [scriptPath], {
        cwd: projectDir,
        stdio: captureStderr ? ['ignore', 'pipe', 'pipe'] : 'ignore'
      });
      
      let stdout = '';
      let stderr = '';
      
      if (captureStderr) {
        proc.stdout?.on('data', (data) => { stdout += data.toString(); });
        proc.stderr?.on('data', (data) => { stderr += data.toString(); });
      }
      
      proc.on('close', (code) => {
        const duration = Date.now() - startTime;
        resolve({
          success: code === 0,
          code,
          duration,
          stdout,
          stderr
        });
      });
      
      proc.on('error', (error) => {
        resolve({
          success: false,
          error: error.message,
          duration: Date.now() - startTime
        });
      });
    });
  });
}

// Helper function to execute commands
function execCommand(command, args) {
  return new Promise((resolve, reject) => {
    const proc = spawn(command, args, { encoding: 'utf8' });
    let stdout = '';
    let stderr = '';
    
    proc.stdout.on('data', (data) => { stdout += data; });
    proc.stderr.on('data', (data) => { stderr += data; });
    
    proc.on('close', (code) => {
      if (code === 0) {
        resolve({ stdout, stderr });
      } else {
        reject(new Error(`Command failed with code ${code}: ${stderr}`));
      }
    });
  });
}

// Result recording functions
function recordSuccess(testName, message) {
  results.passed++;
  results.tests.push({ name: testName, passed: true, message });
  log(`  ✅ ${message}`, 'green');
}

function recordFailure(testName, message) {
  results.failed++;
  results.tests.push({ name: testName, passed: false, message });
  log(`  ❌ ${message}`, 'red');
}

// Main test runner
async function runAllTests() {
  log('\n🚀 NPX Cache Isolation Test Suite', 'blue');
  log('================================\n', 'blue');
  
  await setup();
  
  // Run all tests
  await testBasicIsolation();
  await testConcurrentNpx();
  await testRapidSequential();
  await testCacheCleanup();
  await testStress();
  await testNoEnotemptyErrors();
  
  // Print summary
  log('\n\n📊 Test Summary', 'blue');
  log('===============', 'blue');
  log(`Total Tests: ${results.passed + results.failed}`);
  log(`Passed: ${results.passed}`, 'green');
  log(`Failed: ${results.failed}`, results.failed > 0 ? 'red' : 'green');
  
  if (results.failed > 0) {
    log('\n❌ Failed Tests:', 'red');
    results.tests
      .filter(t => !t.passed)
      .forEach(t => log(`  - ${t.name}: ${t.message}`, 'red'));
  }
  
  // Cleanup
  await cleanup();
  
  // Exit with appropriate code
  process.exit(results.failed > 0 ? 1 : 0);
}

// Run tests
runAllTests().catch(error => {
  log(`\n❌ Test suite failed: ${error.message}`, 'red');
  process.exit(1);
});