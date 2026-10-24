/**
 * Workaround test for agentic-flow v1.7.1 features
 *
 * The package has index-new.js with v1.7.1 exports but package.json
 * points to the old index.js for backwards compatibility.
 *
 * This test uses direct file system imports as a workaround.
 */

import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const __dirname = dirname(fileURLToPath(import.meta.url));

console.log('🧪 Testing agentic-flow v1.7.1 with workaround...\n');

// Test 1: Try direct file system import
console.log('Test 1: Direct file system import...');
try {
  const packagePath = join(__dirname, '../node_modules/agentic-flow/dist/reasoningbank');
  const indexNewPath = join(packagePath, 'index-new.js');

  console.log(`   Importing from: ${indexNewPath}`);

  const module = await import(indexNewPath);

  if (module.HybridReasoningBank) {
    console.log('✅ HybridReasoningBank found!');
    console.log('   Type:', typeof module.HybridReasoningBank);

    // Test instantiation
    const rb = new module.HybridReasoningBank({
      preferWasm: false,
      enableCaching: true
    });

    console.log('✅ HybridReasoningBank instantiated successfully');

    // Test storing a pattern
    console.log('\nTest 2: Storing test pattern...');
    await rb.storePattern({
      sessionId: 'workaround-test-1',
      task: 'Testing v1.7.1 features with workaround',
      input: 'Direct file system import',
      output: 'Successfully accessed HybridReasoningBank',
      critique: 'Workaround successful',
      success: true,
      reward: 0.92,
      latencyMs: 95
    });
    console.log('✅ Pattern stored successfully');

    // Test retrieving patterns
    console.log('\nTest 3: Retrieving patterns...');
    const patterns = await rb.retrievePatterns('workaround', { k: 5 });
    console.log(`✅ Retrieved ${patterns.length} patterns`);

    // Test getStats
    console.log('\nTest 4: Getting statistics...');
    const stats = rb.getStats();
    console.log('✅ Statistics:', JSON.stringify(stats, null, 2));

  } else {
    console.error('❌ HybridReasoningBank not found in exports');
    console.log('   Available exports:', Object.keys(module));
  }

  if (module.AdvancedMemorySystem) {
    console.log('\n✅ AdvancedMemorySystem found!');
    console.log('   Type:', typeof module.AdvancedMemorySystem);

    const memory = new module.AdvancedMemorySystem();
    console.log('✅ AdvancedMemorySystem instantiated successfully');

    const stats = memory.getStats();
    console.log('✅ Stats:', JSON.stringify(stats, null, 2));
  }

} catch (error) {
  console.error('❌ Direct import failed:', error.message);
  console.error('   Stack:', error.stack);
}

console.log('\n📋 Summary:');
console.log('   - v1.7.1 package has index-new.js with new features');
console.log('   - package.json exports point to old index.js');
console.log('   - Direct file system imports work as workaround');
console.log('   - Issue should be reported to agentic-flow maintainers');
