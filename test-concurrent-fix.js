#!/usr/bin/env node

/**
 * Test script to verify the concurrent NPX cache fix
 * 
 * This script will attempt to run multiple claude-flow init commands
 * concurrently to test if the NPX cache manager prevents ENOTEMPTY errors
 */

import { spawn } from 'child_process';
import path from 'path';
import fs from 'fs/promises';

const TEST_DIR = path.join(process.cwd(), 'test-concurrent-runs');

async function cleanup() {
  try {
    await fs.rm(TEST_DIR, { recursive: true, force: true });
  } catch (error) {
    // Ignore errors during cleanup
  }
}

async function createTestProject(name) {
  const projectDir = path.join(TEST_DIR, name);
  await fs.mkdir(projectDir, { recursive: true });
  
  return new Promise((resolve, reject) => {
    console.log(`Starting test ${name}...`);
    
    const proc = spawn('npx', ['--y', 'claude-flow@alpha', 'init', '--force'], {
      cwd: projectDir,
      stdio: 'inherit'
    });
    
    proc.on('close', (code) => {
      if (code === 0) {
        console.log(`✅ Test ${name} completed successfully`);
        resolve({ name, success: true });
      } else {
        console.log(`❌ Test ${name} failed with code ${code}`);
        resolve({ name, success: false, code });
      }
    });
    
    proc.on('error', (error) => {
      console.error(`❌ Test ${name} error:`, error.message);
      reject(error);
    });
  });
}

async function runConcurrentTest() {
  console.log('🧪 Testing concurrent NPX cache fix...\n');
  
  // Clean up any previous test runs
  await cleanup();
  await fs.mkdir(TEST_DIR, { recursive: true });
  
  // Run multiple init commands concurrently
  const concurrentRuns = 5;
  const promises = [];
  
  for (let i = 1; i <= concurrentRuns; i++) {
    promises.push(createTestProject(`project-${i}`));
  }
  
  console.log(`\n🚀 Launching ${concurrentRuns} concurrent init commands...\n`);
  
  try {
    const results = await Promise.all(promises);
    
    // Check results
    const successful = results.filter(r => r.success).length;
    const failed = results.filter(r => !r.success).length;
    
    console.log('\n📊 Test Results:');
    console.log(`✅ Successful: ${successful}/${concurrentRuns}`);
    console.log(`❌ Failed: ${failed}/${concurrentRuns}`);
    
    if (failed === 0) {
      console.log('\n🎉 All concurrent runs completed successfully!');
      console.log('The NPX cache conflict fix is working correctly.');
    } else {
      console.log('\n⚠️  Some runs failed. Check the output above for details.');
    }
  } catch (error) {
    console.error('\n❌ Test failed with error:', error.message);
  } finally {
    // Clean up test directory
    await cleanup();
  }
}

// Run the test
runConcurrentTest().catch(console.error);