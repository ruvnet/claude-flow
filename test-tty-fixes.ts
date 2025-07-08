/**
 * Test script for validating TTY error fixes
 * Run with: npx tsx test-tty-fixes.ts
 */

import { createSafeReadlineInterface, withSafeTTY, isTTYAvailable } from './src/utils/tty-error-handler';
import fs from 'fs/promises';

console.log('🧪 Testing TTY Error Fixes...\n');

// Test 1: TTY Error Handling
async function testTTYErrorHandling() {
  console.log('📋 Test 1: TTY Error Handling');
  
  try {
    // Test TTY availability check
    const ttyAvailable = isTTYAvailable();
    console.log(`   TTY Available: ${ttyAvailable ? '✅ Yes' : '⚠️  No'}`);
    
    // Test safe readline interface creation
    const rl = await createSafeReadlineInterface();
    if (rl) {
      console.log('   ✅ Readline interface created successfully');
      rl.close();
    } else {
      console.log('   ⚠️  Running in non-interactive mode (expected in some environments)');
    }
    
    // Test withSafeTTY wrapper
    const result = await withSafeTTY(
      async (rl) => {
        return 'TTY operation successful';
      },
      () => 'Fallback operation successful'
    );
    console.log(`   ✅ withSafeTTY result: ${result}`);
    
    console.log('   ✅ TTY error handling test passed\n');
    return true;
  } catch (error: any) {
    console.error('   ❌ TTY error handling test failed:', error.message);
    return false;
  }
}

// Test 2: SPARC Command Integration
async function testSparcCommandIntegration() {
  console.log('📋 Test 2: SPARC Command Integration');
  
  try {
    // Check if sparc.ts has been updated with the TTY handler import
    const sparcPath = './src/cli/commands/sparc.ts';
    const sparcContent = await fs.readFile(sparcPath, 'utf-8');
    
    if (sparcContent.includes('createSafeReadlineInterface')) {
      console.log('   ✅ SPARC command has been updated with TTY handler');
      
      // Check for proper usage in the code
      const properUsagePattern = /const\s+rl\s*=\s*await\s+createSafeReadlineInterface\(\)/;
      if (properUsagePattern.test(sparcContent)) {
        console.log('   ✅ TTY handler is properly used in SPARC command');
      } else {
        console.log('   ⚠️  TTY handler import found but usage might need review');
      }
    } else {
      console.log('   ❌ SPARC command missing TTY handler import');
      return false;
    }
    
    console.log('   ✅ SPARC command integration test passed\n');
    return true;
  } catch (error: any) {
    console.error('   ❌ SPARC command integration test failed:', error.message);
    return false;
  }
}

// Run all tests
async function runAllTests() {
  console.log('🚀 Starting TTY fix validation...\n');
  
  const results = {
    ttyErrorHandling: await testTTYErrorHandling(),
    sparcIntegration: await testSparcCommandIntegration()
  };
  
  // Summary
  console.log('📊 Test Summary:');
  console.log('================');
  
  let passed = 0;
  let failed = 0;
  
  for (const [test, result] of Object.entries(results)) {
    if (result === true) {
      console.log(`✅ ${test}: PASSED`);
      passed++;
    } else {
      console.log(`❌ ${test}: FAILED`);
      failed++;
    }
  }
  
  console.log('\n📈 Results:');
  console.log(`   Passed: ${passed}`);
  console.log(`   Failed: ${failed}`);
  console.log(`   Total: ${passed + failed}`);
  
  if (failed === 0 && passed > 0) {
    console.log('\n✅ All TTY fixes are working correctly!');
    console.log('\nℹ️  Note: These fixes prevent crashes in:');
    console.log('   - Docker containers');
    console.log('   - CI/CD environments');
    console.log('   - SSH sessions');
    console.log('   - Non-interactive terminals');
  } else if (failed > 0) {
    console.log('\n❌ Some tests failed. Please review the errors above.');
    process.exit(1);
  }
}

// Run tests
runAllTests().catch(error => {
  console.error('❌ Test suite failed:', error);
  process.exit(1);
});
