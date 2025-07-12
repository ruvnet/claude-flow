#!/usr/bin/env node

/**
 * Real-world test for NPX cache isolation
 * 
 * This test actually runs claude-flow init commands concurrently
 * to verify the fix works in practice.
 */

import { spawn } from 'child_process';
import path from 'path';
import fs from 'fs/promises';
import os from 'os';

const TEST_DIR = path.join(os.tmpdir(), 'claude-flow-real-test-' + Date.now());

async function setup() {
  await fs.mkdir(TEST_DIR, { recursive: true });
  console.log(`\n📁 Test directory: ${TEST_DIR}\n`);
}

async function cleanup() {
  try {
    await fs.rm(TEST_DIR, { recursive: true, force: true });
  } catch (error) {
    // Ignore
  }
}

async function runClaudeFlowInit(projectName, index) {
  const projectDir = path.join(TEST_DIR, projectName);
  await fs.mkdir(projectDir, { recursive: true });
  
  return new Promise((resolve) => {
    console.log(`🚀 Starting ${projectName}...`);
    const startTime = Date.now();
    
    const proc = spawn('node', [
      path.join(process.cwd(), 'src/cli/simple-cli.js'),
      'init',
      '--force',
      '--minimal'
    ], {
      cwd: projectDir,
      stdio: 'pipe',
      env: {
        ...process.env,
        // Ensure we're using the local version
        NODE_PATH: path.join(process.cwd(), 'node_modules')
      }
    });
    
    let output = '';
    let errorOutput = '';
    
    proc.stdout.on('data', (data) => {
      output += data.toString();
    });
    
    proc.stderr.on('data', (data) => {
      errorOutput += data.toString();
    });
    
    proc.on('close', (code) => {
      const duration = Date.now() - startTime;
      
      if (code === 0) {
        console.log(`✅ ${projectName} completed in ${duration}ms`);
        resolve({
          success: true,
          name: projectName,
          duration,
          output
        });
      } else {
        console.log(`❌ ${projectName} failed with code ${code}`);
        if (errorOutput) {
          console.log(`   Error: ${errorOutput.split('\n')[0]}`);
        } else if (output) {
          console.log(`   Output: ${output.split('\n')[0]}`);
        }
        if (errorOutput.includes('ENOTEMPTY')) {
          console.log(`   💥 ENOTEMPTY error detected!`);
        }
        resolve({
          success: false,
          name: projectName,
          code,
          duration,
          error: errorOutput || output
        });
      }
    });
    
    proc.on('error', (error) => {
      console.log(`❌ ${projectName} error: ${error.message}`);
      resolve({
        success: false,
        name: projectName,
        error: error.message
      });
    });
  });
}

async function main() {
  console.log('🧪 Real-World Claude-Flow Concurrent Init Test');
  console.log('============================================');
  
  await setup();
  
  // Test 1: Run 3 concurrent inits
  console.log('\n📋 Test 1: 3 Concurrent Initializations');
  const test1Promises = [
    runClaudeFlowInit('project-1', 1),
    runClaudeFlowInit('project-2', 2),
    runClaudeFlowInit('project-3', 3)
  ];
  
  const test1Results = await Promise.all(test1Promises);
  const test1Success = test1Results.filter(r => r.success).length;
  console.log(`\n📊 Test 1 Result: ${test1Success}/3 succeeded`);
  
  // Test 2: Run 5 concurrent inits with slight delays
  console.log('\n📋 Test 2: 5 Concurrent Initializations (staggered)');
  const test2Promises = [];
  for (let i = 1; i <= 5; i++) {
    test2Promises.push(runClaudeFlowInit(`staggered-${i}`, i));
    await new Promise(resolve => setTimeout(resolve, 100)); // 100ms delay
  }
  
  const test2Results = await Promise.all(test2Promises);
  const test2Success = test2Results.filter(r => r.success).length;
  console.log(`\n📊 Test 2 Result: ${test2Success}/5 succeeded`);
  
  // Check for ENOTEMPTY errors
  const allResults = [...test1Results, ...test2Results];
  const enotemptyErrors = allResults.filter(r => 
    !r.success && r.error && r.error.includes('ENOTEMPTY')
  );
  
  // Summary
  console.log('\n\n🏁 Final Summary');
  console.log('================');
  console.log(`Total runs: ${allResults.length}`);
  console.log(`Successful: ${allResults.filter(r => r.success).length}`);
  console.log(`Failed: ${allResults.filter(r => !r.success).length}`);
  console.log(`ENOTEMPTY errors: ${enotemptyErrors.length}`);
  
  if (enotemptyErrors.length > 0) {
    console.log('\n❌ ENOTEMPTY errors found! The fix needs improvement.');
    enotemptyErrors.forEach(e => {
      console.log(`\n  ${e.name}:`);
      console.log(`  ${e.error.split('\n').slice(0, 5).join('\n  ')}`);
    });
  } else if (allResults.filter(r => !r.success).length > 0) {
    console.log('\n⚠️  Some runs failed (but no ENOTEMPTY errors)');
  } else {
    console.log('\n✅ All concurrent runs succeeded without ENOTEMPTY errors!');
  }
  
  await cleanup();
  
  process.exit(enotemptyErrors.length > 0 ? 1 : 0);
}

main().catch(error => {
  console.error('Test failed:', error);
  process.exit(1);
});