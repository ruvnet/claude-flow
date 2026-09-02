import * as ReasoningBank from 'agentic-flow/reasoningbank';

await ReasoningBank.initialize();

console.log('\n=== Debug Test: fetchMemoryCandidates vs retrieveMemories ===\n');

// Test 1: Direct fetchMemoryCandidates call
console.log('Test 1: Direct fetchMemoryCandidates({domain: "semantic", minConfidence: 0.3})');
const candidates = ReasoningBank.db.fetchMemoryCandidates({
  domain: 'semantic',
  minConfidence: 0.3
});
console.log('✅ Result:', candidates.length, 'candidates');

// Test 2: retrieveMemories call
console.log('\nTest 2: retrieveMemories("configuration", {domain: "semantic", k: 3, minConfidence: 0.3})');
try {
  const results = await ReasoningBank.retrieveMemories('configuration', {
    domain: 'semantic',
    k: 3,
    minConfidence: 0.3
  });
  console.log('✅ Result:', results.length, 'results');
} catch (error) {
  console.log('❌ Error:', error.message);
}

// Test 3: Check if embedding generation is the issue
console.log('\nTest 3: Testing computeEmbedding("configuration")');
try {
  const embedding = await ReasoningBank.computeEmbedding('configuration');
  console.log('✅ Embedding generated:', embedding.length, 'dimensions');
  console.log('   First 5 values:', Array.from(embedding.slice(0, 5)));
} catch (error) {
  console.log('❌ Embedding failed:', error.message);
}

ReasoningBank.db.closeDb();
console.log('\n=== Test Complete ===\n');
