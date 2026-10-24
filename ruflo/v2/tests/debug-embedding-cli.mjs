import * as ReasoningBank from 'agentic-flow/reasoningbank';

console.log('\n=== Testing Embedding Generation ===\n');

await ReasoningBank.initialize();

console.log('Step 1: Generate query embedding...');
const start = Date.now();

try {
  const embedding = await Promise.race([
    ReasoningBank.computeEmbedding('configuration'),
    new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout after 5s')), 5000))
  ]);

  const duration = Date.now() - start;
  console.log(`✅ Embedding generated in ${duration}ms`);
  console.log(`   Dimensions: ${embedding.length}`);
  console.log(`   First 3 values: [${embedding.slice(0, 3).join(', ')}]`);

  console.log('\nStep 2: Fetch candidates...');
  const candidates = ReasoningBank.db.fetchMemoryCandidates({
    domain: 'semantic',
    minConfidence: 0.3
  });
  console.log(`✅ Found ${candidates.length} candidates`);

  console.log('\nStep 3: Full retrieveMemories call...');
  const results = await Promise.race([
    ReasoningBank.retrieveMemories('configuration', {
      domain: 'semantic',
      k: 3
    }),
    new Promise((_, reject) => setTimeout(() => reject(new Error('retrieveMemories timeout')), 5000))
  ]);
  console.log(`✅ Retrieved ${results.length} results`);

} catch (error) {
  console.log(`❌ Error: ${error.message}`);
}

ReasoningBank.db.closeDb();
console.log('\n=== Test Complete ===\n');
