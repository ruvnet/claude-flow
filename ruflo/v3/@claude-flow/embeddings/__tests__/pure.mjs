/**
 * Pure utility tests - no embedding service
 */

console.log('Importing utilities only...');
const { chunkText, estimateTokens } = await import('../dist/chunking.js');
const { l2Normalize, l2Norm, isNormalized } = await import('../dist/normalization.js');
const { euclideanToPoincare, isInPoincareBall, hyperbolicDistance } = await import('../dist/hyperbolic.js');
console.log('Imports done.');

function assert(condition, msg) {
  if (!condition) throw new Error(`FAIL: ${msg}`);
  console.log(`✓ ${msg}`);
}

console.log('\n--- Tests ---');

// Chunking
let result = chunkText('Hello world. This is a test.', { maxChunkSize: 15, strategy: 'character' });
assert(result.totalChunks > 0, 'chunkText');
assert(estimateTokens('Hello world') === 3, 'estimateTokens');

// Normalization
const vec = new Float32Array([3, 4, 0]);
const normalized = l2Normalize(vec);
assert(Math.abs(l2Norm(normalized) - 1) < 1e-5, 'L2 normalize');
assert(!isNormalized(vec), 'isNormalized false');
assert(isNormalized(normalized), 'isNormalized true');

// Hyperbolic
const eucVec = new Float32Array([0.5, 0.3, 0.2]);
const poincare = euclideanToPoincare(eucVec);
assert(isInPoincareBall(poincare), 'euclideanToPoincare');

console.log('\n✅ ALL TESTS PASSED!');
process.exit(0);
