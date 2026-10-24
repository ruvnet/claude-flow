/**
 * Debug test to find memory issue
 */

console.log('Importing modules...');
const { chunkText, estimateTokens } = await import('../dist/chunking.js');
const { l2Normalize, l2Norm, isNormalized } = await import('../dist/normalization.js');
const { euclideanToPoincare, isInPoincareBall, hyperbolicDistance, mobiusAdd, poincareToEuclidean } = await import('../dist/hyperbolic.js');
const { cosineSimilarity, euclideanDistance, dotProduct, MockEmbeddingService } = await import('../dist/embedding-service.js');
console.log('Imports done.');

function assert(condition, msg) {
  if (!condition) throw new Error(`FAIL: ${msg}`);
  console.log(`✓ ${msg}`);
}

console.log('\n--- Chunking tests ---');
let result = chunkText('Hello world. This is a test.', { maxChunkSize: 15, strategy: 'character' });
assert(result.totalChunks > 0, 'chunkText works');
assert(estimateTokens('Hello world') === 3, 'estimateTokens works');
console.log('Chunking done.');

console.log('\n--- Normalization tests ---');
const vec = new Float32Array([3, 4, 0]);
const normalized = l2Normalize(vec);
assert(Math.abs(l2Norm(normalized) - 1) < 1e-5, 'L2 normalize');
assert(!isNormalized(vec), 'isNormalized false');
assert(isNormalized(normalized), 'isNormalized true');
console.log('Normalization done.');

console.log('\n--- Hyperbolic tests ---');
const eucVec = new Float32Array([0.5, 0.3, 0.2]);
const poincare = euclideanToPoincare(eucVec);
assert(isInPoincareBall(poincare), 'euclideanToPoincare stays in ball');
const back = poincareToEuclidean(poincare);
assert(Math.abs(back[0] - eucVec[0]) < 1e-4, 'round trip');
console.log('Hyperbolic done.');

console.log('\n--- Similarity tests ---');
const vecA = new Float32Array([1, 0, 0]);
const vecB = new Float32Array([0, 1, 0]);
assert(Math.abs(cosineSimilarity(vecA, vecA) - 1) < 1e-5, 'cosine identical');
assert(Math.abs(dotProduct(vecA, vecB)) < 1e-5, 'dot orthogonal');
console.log('Similarity done.');

console.log('\n--- MockEmbeddingService tests ---');
const service = new MockEmbeddingService({ dimensions: 384 });
console.log('Service created.');
const embedding = await service.embed('test');
console.log('Embed called.');
assert(embedding.embedding.length === 384, 'embed dimensions');
console.log('MockEmbeddingService done.');

console.log('\n✅ ALL TESTS PASSED!');
process.exit(0);
