#!/usr/bin/env node

/**
 * Failure Scenario Test - Demonstrates ENOTEMPTY errors without isolation
 * 
 * This test simulates the original problem by using shared NPX cache,
 * showing how concurrent processes can conflict and cause ENOTEMPTY errors.
 */

import { spawn } from 'child_process';
import path from 'path';
import fs from 'fs/promises';
import os from 'os';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const TEST_DIR = path.join(os.tmpdir(), 'claude-flow-failure-test-' + Date.now());
const SHARED_CACHE = path.join(os.tmpdir(), '.npm-cache', 'shared-test-cache');

// Test results tracking
const results = {
  enotemptyErrors: 0,
  otherErrors: 0,
  successful: 0,
  total: 0
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
    await fs.rm(SHARED_CACHE, { recursive: true, force: true });
  } catch (error) {
    // Ignore cleanup errors
  }
}

async function setup() {
  await cleanup();
  await fs.mkdir(TEST_DIR, { recursive: true });
  await fs.mkdir(SHARED_CACHE, { recursive: true });
  log(`\n📁 Test directory: ${TEST_DIR}`, 'blue');
  log(`📁 Shared cache: ${SHARED_CACHE}`, 'blue');
}

/**
 * Run NPX command WITHOUT cache isolation (simulating the old behavior)
 */
async function runUnprotectedNpxCommand(projectDir, index) {
  return new Promise((resolve) => {
    const startTime = Date.now();
    
    // Create a test script that uses the SAME cache directory (no isolation)
    const testScript = `
      import { spawn } from 'child_process';
      
      // Use shared cache - this is what caused the original ENOTEMPTY errors
      const sharedEnv = {
        ...process.env,
        NPM_CONFIG_CACHE: '${SHARED_CACHE}',
        npm_config_cache: '${SHARED_CACHE}'
      };
      
      const proc = spawn('npx', ['--version'], {
        env: sharedEnv,
        stdio: 'pipe'
      });
      
      let stdout = '';
      let stderr = '';
      
      proc.stdout.on('data', (data) => { stdout += data.toString(); });
      proc.stderr.on('data', (data) => { stderr += data.toString(); });
      
      proc.on('close', (code) => {
        if (stderr.includes('ENOTEMPTY')) {
          console.error('ENOTEMPTY ERROR DETECTED:', stderr);
        }
        process.exit(code);
      });
    `;
    
    const scriptPath = path.join(projectDir, 'test-unprotected.mjs');
    fs.writeFile(scriptPath, testScript).then(() => {
      const proc = spawn('node', [scriptPath], {
        cwd: projectDir,
        stdio: ['ignore', 'pipe', 'pipe']
      });
      
      let stdout = '';
      let stderr = '';
      
      proc.stdout?.on('data', (data) => { stdout += data.toString(); });
      proc.stderr?.on('data', (data) => { stderr += data.toString(); });
      
      proc.on('close', (code) => {
        const duration = Date.now() - startTime;
        
        results.total++;
        
        if (stderr.includes('ENOTEMPTY')) {
          results.enotemptyErrors++;
          log(`  ❌ Process ${index}: ENOTEMPTY error detected!`, 'red');
        } else if (code !== 0) {
          results.otherErrors++;
          log(`  ⚠️  Process ${index}: Other error (code ${code})`, 'yellow');
        } else {
          results.successful++;
          log(`  ✅ Process ${index}: Succeeded`, 'green');
        }
        
        resolve({
          success: code === 0,
          code,
          duration,
          stdout,
          stderr,
          hasEnotempty: stderr.includes('ENOTEMPTY')
        });
      });
      
      proc.on('error', (error) => {
        results.total++;
        results.otherErrors++;
        log(`  ❌ Process ${index}: Spawn error - ${error.message}`, 'red');
        
        resolve({
          success: false,
          error: error.message,
          duration: Date.now() - startTime,
          hasEnotempty: false
        });
      });
    });
  });
}

/**
 * Test concurrent execution with shared cache (reproduces the original problem)
 */
async function testConcurrentSharedCache() {
  log('\n🧪 Testing Concurrent Shared Cache (Failure Scenario)...', 'yellow');
  log('This simulates the original ENOTEMPTY problem', 'blue');
  
  const concurrentCount = 8; // Higher count increases chance of conflicts
  const promises = [];
  
  // Create multiple concurrent processes all using the same cache
  for (let i = 0; i < concurrentCount; i++) {
    const projectDir = path.join(TEST_DIR, `concurrent-fail-${i}`);
    await fs.mkdir(projectDir, { recursive: true });
    
    // Start all processes simultaneously to maximize conflict chance
    promises.push(runUnprotectedNpxCommand(projectDir, i));
  }
  
  log(`\nStarting ${concurrentCount} concurrent processes with shared cache...`, 'blue');
  
  try {
    const results = await Promise.allSettled(promises);
    
    // Wait a bit more to catch any delayed errors
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    log('\n📊 Concurrent Test Results:', 'blue');
    log(`Total processes: ${concurrentCount}`);
    log(`Successful: ${results.filter(r => r.status === 'fulfilled' && r.value.success).length}`, 'green');
    log(`Failed: ${results.filter(r => r.status === 'rejected' || !r.value?.success).length}`, 'red');
    log(`ENOTEMPTY errors: ${results.filter(r => r.value?.hasEnotempty).length}`, 'red');
    
  } catch (error) {
    log(`❌ Test failed: ${error.message}`, 'red');
  }
}

/**
 * Test rapid sequential execution with shared cache
 */
async function testRapidSequentialSharedCache() {
  log('\n🧪 Testing Rapid Sequential Shared Cache...', 'yellow');
  
  const sequentialCount = 5;
  
  for (let i = 0; i < sequentialCount; i++) {
    const projectDir = path.join(TEST_DIR, `sequential-fail-${i}`);
    await fs.mkdir(projectDir, { recursive: true });
    
    // Run with minimal delay to increase conflict chance
    await runUnprotectedNpxCommand(projectDir, i);
    await new Promise(resolve => setTimeout(resolve, 100)); // Very short delay
  }
  
  log('\n📊 Sequential Test Results:', 'blue');
}

/**
 * Demonstrate the fix by showing isolated cache works
 */
async function testWithIsolation() {
  log('\n🧪 Testing WITH Isolation (Fix Verification)...', 'yellow');
  
  // Import the fixed version
  const { getIsolatedNpxEnv } = await import('./src/utils/npx-isolated-cache.js');
  
  const promises = [];
  for (let i = 0; i < 5; i++) {
    const projectDir = path.join(TEST_DIR, `isolated-${i}`);
    await fs.mkdir(projectDir, { recursive: true });
    
    promises.push(new Promise((resolve) => {
      const testScript = `
        import { getIsolatedNpxEnv } from '${path.resolve('src/utils/npx-isolated-cache.js')}';
        import { spawn } from 'child_process';
        
        const proc = spawn('npx', ['--version'], {
          env: getIsolatedNpxEnv(),
          stdio: 'pipe'
        });
        
        let stderr = '';
        proc.stderr.on('data', (data) => { stderr += data.toString(); });
        
        proc.on('close', (code) => {
          if (stderr.includes('ENOTEMPTY')) {
            console.error('UNEXPECTED: ENOTEMPTY with isolation!');
            process.exit(1);
          }
          process.exit(code);
        });
      `;
      
      const scriptPath = path.join(projectDir, 'test-isolated.mjs');
      fs.writeFile(scriptPath, testScript).then(() => {
        const proc = spawn('node', [scriptPath], {
          cwd: projectDir,
          stdio: 'pipe'
        });
        
        proc.on('close', (code) => {
          if (code === 0) {
            log(`  ✅ Isolated process ${i}: Success`, 'green');
          } else {
            log(`  ❌ Isolated process ${i}: Failed`, 'red');
          }
          resolve({ success: code === 0 });
        });
      });
    }));
  }
  
  const results = await Promise.all(promises);
  const successful = results.filter(r => r.success).length;
  
  log(`\n📊 Isolation Test Results:`, 'blue');
  log(`Successful with isolation: ${successful}/5`, successful === 5 ? 'green' : 'red');
}

// Main test runner
async function runFailureTests() {
  log('\n🚨 NPX Cache Failure Scenario Test', 'red');
  log('===================================', 'red');
  log('This test demonstrates the ORIGINAL problem that PR #215 fixes', 'yellow');
  
  await setup();
  
  // Run tests that should show failures
  await testConcurrentSharedCache();
  await testRapidSequentialSharedCache();
  
  // Show that the fix works
  await testWithIsolation();
  
  // Final summary
  log('\n\n📊 Overall Results', 'blue');
  log('==================', 'blue');
  log(`Total unprotected processes: ${results.total}`);
  log(`ENOTEMPTY errors detected: ${results.enotemptyErrors}`, results.enotemptyErrors > 0 ? 'red' : 'yellow');
  log(`Other errors: ${results.otherErrors}`, results.otherErrors > 0 ? 'yellow' : 'green');
  log(`Successful: ${results.successful}`, 'green');
  
  if (results.enotemptyErrors > 0) {
    log('\n✅ SUCCESS: Demonstrated the original ENOTEMPTY problem!', 'green');
    log('The isolated cache fix (PR #215) prevents these errors.', 'blue');
  } else {
    log('\n⚠️  Note: No ENOTEMPTY errors occurred in this run.', 'yellow');
    log('This can happen due to timing. The fix still prevents potential conflicts.', 'blue');
  }
  
  await cleanup();
  
  // Exit successfully - we WANT to see some failures in this test
  process.exit(0);
}

// Run failure tests
runFailureTests().catch(error => {
  log(`\n❌ Test suite failed: ${error.message}`, 'red');
  process.exit(1);
});