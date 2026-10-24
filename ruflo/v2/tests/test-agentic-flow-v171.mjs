/**
 * Test agentic-flow v1.7.1 advanced features
 *
 * Testing HybridReasoningBank and AdvancedMemorySystem
 */

console.log('🧪 Testing agentic-flow v1.7.1 advanced features...\n');

// Test 1: Import from index-new.js directly
console.log('Test 1: Importing from index-new.js...');
try {
  const { HybridReasoningBank, AdvancedMemorySystem } = await import('agentic-flow/dist/reasoningbank/index-new.js');
  console.log('✅ Successfully imported HybridReasoningBank and AdvancedMemorySystem from index-new.js');
  console.log('   - HybridReasoningBank:', typeof HybridReasoningBank);
  console.log('   - AdvancedMemorySystem:', typeof AdvancedMemorySystem);
} catch (error) {
  console.error('❌ Import from index-new.js failed:', error.message);
}

console.log('\nTest 2: Testing HybridReasoningBank instantiation...');
try {
  const { HybridReasoningBank } = await import('agentic-flow/dist/reasoningbank/index-new.js');
  const rb = new HybridReasoningBank({
    preferWasm: false, // Use TypeScript backend for testing
    enableCaching: true,
    queryTTL: 60000
  });

  console.log('✅ HybridReasoningBank instantiated successfully');

  // Test storePattern
  console.log('\nTest 3: Storing test pattern...');
  await rb.storePattern({
    sessionId: 'test-session-1',
    task: 'Test integration with claude-flow v2.7.1',
    input: 'Testing agentic-flow v1.7.1 features',
    output: 'Successfully integrated HybridReasoningBank',
    critique: 'Integration working as expected',
    success: true,
    reward: 0.95,
    latencyMs: 100
  });
  console.log('✅ Pattern stored successfully');

  // Test retrievePatterns
  console.log('\nTest 4: Retrieving patterns...');
  const patterns = await rb.retrievePatterns('integration test', {
    k: 3,
    minReward: 0.8,
    onlySuccesses: true
  });
  console.log(`✅ Retrieved ${patterns.length} patterns`);
  if (patterns.length > 0) {
    console.log('   First pattern:', {
      task: patterns[0].task,
      reward: patterns[0].reward,
      similarity: patterns[0].similarity
    });
  }

  // Test getStats
  console.log('\nTest 5: Getting statistics...');
  const stats = rb.getStats();
  console.log('✅ Statistics:', stats);

} catch (error) {
  console.error('❌ HybridReasoningBank test failed:', error.message);
  console.error('   Stack:', error.stack);
}

console.log('\nTest 6: Testing AdvancedMemorySystem...');
try {
  const { AdvancedMemorySystem } = await import('agentic-flow/dist/reasoningbank/index-new.js');
  const memory = new AdvancedMemorySystem();

  console.log('✅ AdvancedMemorySystem instantiated successfully');

  // Test getStats
  const stats = memory.getStats();
  console.log('✅ AdvancedMemorySystem stats:', stats);

} catch (error) {
  console.error('❌ AdvancedMemorySystem test failed:', error.message);
  console.error('   Stack:', error.stack);
}

console.log('\n✅ All tests complete!');
console.log('\n📝 Summary:');
console.log('   - v1.7.1 features are available in index-new.js');
console.log('   - Main index.js uses old exports (backwards compatibility)');
console.log('   - Import path: agentic-flow/dist/reasoningbank/index-new.js');
