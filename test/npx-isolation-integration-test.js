#!/usr/bin/env node

/**
 * Integration test for NPX cache isolation
 * 
 * Tests the actual NPX command execution with isolated caches
 * to ensure no ENOTEMPTY errors occur.
 */

import { spawn } from 'child_process';
import path from 'path';
import fs from 'fs/promises';
import os from 'os';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import { getIsolatedNpxEnv } from '../src/utils/npx-isolated-cache.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const TEST_DIR = path.join(os.tmpdir(), 'npx-isolation-test-' + Date.now());

async function runNpxWithIsolation(taskName, npxArgs) {
  return new Promise((resolve) => {
    console.log(`\n🚀 ${taskName}: Running npx ${npxArgs.join(' ')}`);
    const startTime = Date.now();
    
    const proc = spawn('npx', npxArgs, {
      env: getIsolatedNpxEnv(),
      stdio: 'pipe'
    });
    
    let stdout = '';
    let stderr = '';
    
    proc.stdout.on('data', (data) => { stdout += data.toString(); });
    proc.stderr.on('data', (data) => { stderr += data.toString(); });
    
    proc.on('close', (code) => {
      const duration = Date.now() - startTime;
      const hasEnotempty = stderr.includes('ENOTEMPTY') || stdout.includes('ENOTEMPTY');
      
      if (code === 0 && !hasEnotempty) {
        console.log(`  ✅ Success in ${duration}ms`);
        resolve({ success: true, duration, taskName });
      } else if (hasEnotempty) {
        console.log(`  ❌ ENOTEMPTY error detected!`);
        console.log(`     ${stderr.split('\n').find(line => line.includes('ENOTEMPTY'))}`);
        resolve({ success: false, enotempty: true, duration, taskName, stderr });
      } else {
        console.log(`  ⚠️  Failed with code ${code} (but no ENOTEMPTY)`);
        resolve({ success: false, code, duration, taskName });
      }
    });
    
    proc.on('error', (error) => {
      console.log(`  ❌ Process error: ${error.message}`);
      resolve({ success: false, error: error.message, taskName });
    });
  });
}

async function main() {
  console.log('🧪 NPX Cache Isolation Integration Test');
  console.log('======================================');
  
  await fs.mkdir(TEST_DIR, { recursive: true });
  
  // Test 1: Concurrent NPX package executions
  console.log('\n📋 Test 1: Concurrent NPX Package Executions');
  const test1Tasks = [
    runNpxWithIsolation('Task 1.1', ['--version']),
    runNpxWithIsolation('Task 1.2', ['--version']),
    runNpxWithIsolation('Task 1.3', ['--version']),
    runNpxWithIsolation('Task 1.4', ['--version']),
    runNpxWithIsolation('Task 1.5', ['--version'])
  ];
  
  const test1Results = await Promise.all(test1Tasks);
  
  // Test 2: Concurrent package installs (more likely to cause conflicts)
  console.log('\n📋 Test 2: Concurrent Package Checks');
  const test2Tasks = [
    runNpxWithIsolation('Task 2.1', ['-y', 'cowsay', '--version']),
    runNpxWithIsolation('Task 2.2', ['-y', 'cowsay', '--version']),
    runNpxWithIsolation('Task 2.3', ['-y', 'cowsay', '--version'])
  ];
  
  const test2Results = await Promise.all(test2Tasks);
  
  // Test 3: Rapid fire same package
  console.log('\n📋 Test 3: Rapid Fire Same Package');
  const test3Tasks = [];
  for (let i = 0; i < 10; i++) {
    test3Tasks.push(runNpxWithIsolation(`Task 3.${i + 1}`, ['-y', 'is-odd', '3']));
  }
  
  const test3Results = await Promise.all(test3Tasks);
  
  // Analyze results
  const allResults = [...test1Results, ...test2Results, ...test3Results];
  const enotemptyErrors = allResults.filter(r => r.enotempty);
  const otherFailures = allResults.filter(r => !r.success && !r.enotempty);
  const successes = allResults.filter(r => r.success);
  
  // Summary
  console.log('\n\n📊 Test Summary');
  console.log('===============');
  console.log(`Total runs: ${allResults.length}`);
  console.log(`✅ Successful: ${successes.length}`);
  console.log(`❌ ENOTEMPTY errors: ${enotemptyErrors.length}`);
  console.log(`⚠️  Other failures: ${otherFailures.length}`);
  
  if (enotemptyErrors.length === 0) {
    console.log('\n🎉 SUCCESS: No ENOTEMPTY errors detected!');
    console.log('The isolated cache approach is working correctly.');
  } else {
    console.log('\n❌ FAILURE: ENOTEMPTY errors were detected.');
    console.log('The fix needs further investigation.');
  }
  
  // Cleanup
  await fs.rm(TEST_DIR, { recursive: true, force: true });
  
  process.exit(enotemptyErrors.length > 0 ? 1 : 0);
}

main().catch(error => {
  console.error('Test failed:', error);
  process.exit(1);
});