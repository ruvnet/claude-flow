/**
 * Direct validation - no test framework
 */

import {
  chunkText,
  estimateTokens,
} from '../dist/chunking.js';

import {
  l2Normalize,
  l2Norm,
  isNormalized,
} from '../dist/normalization.js';

import {
  euclideanToPoincare,
  isInPoincareBall,
  hyperbolicDistance,
  mobiusAdd,
  poincareToEuclidean,
} from '../dist/hyperbolic.js';

import {
  cosineSimilarity,
  euclideanDistance,
  dotProduct,
  MockEmbeddingService,
} from '../dist/embedding-service.js';

function assert(condition, msg) {
  if (!condition) throw new Error(`FAIL: ${msg}`);
  console.log(`✓ ${msg}`);
}

// Chunking
let result = chunkText('Hello world. This is a test.', { maxChunkSize: 15, strategy: 'character' });
assert(result.totalChunks > 0, 'chunkText works');
assert(estimateTokens('Hello world') === 3, 'estimateTokens works');

// Normalization
const vec = new Float32Array([3, 4, 0]);
const normalized = l2Normalize(vec);
assert(Math.abs(l2Norm(normalized) - 1) < 1e-5, 'L2 normalize creates unit vector');
assert(Math.abs(normalized[0] - 0.6) < 1e-5, 'L2 normalize [3,4,0][0] = 0.6');
assert(Math.abs(normalized[1] - 0.8) < 1e-5, 'L2 normalize [3,4,0][1] = 0.8');
assert(!isNormalized(vec), 'isNormalized false for unnormalized');
assert(isNormalized(normalized), 'isNormalized true for normalized');

// Hyperbolic
const eucVec = new Float32Array([0.5, 0.3, 0.2]);
const poincare = euclideanToPoincare(eucVec);
assert(isInPoincareBall(poincare), 'euclideanToPoincare stays in ball');

const origin = new Float32Array([0, 0, 0]);
const poincareOrigin = euclideanToPoincare(origin);
assert(Array.from(poincareOrigin).every(v => Math.abs(v) < 1e-10), 'origin maps to origin');

const back = poincareToEuclidean(poincare);
for (let i = 0; i < eucVec.length; i++) {
  assert(Math.abs(back[i] - eucVec[i]) < 1e-4, `round trip [${i}]`);
}

const p = euclideanToPoincare(new Float32Array([0.1, 0.1, 0.1]));
assert(Math.abs(hyperbolicDistance(p, p)) < 1e-5, 'hyperbolicDistance self = 0');

const a = euclideanToPoincare(new Float32Array([0.1, 0.2, 0.1]));
const b = euclideanToPoincare(new Float32Array([0.3, 0.1, 0.2]));
assert(Math.abs(hyperbolicDistance(a, b) - hyperbolicDistance(b, a)) < 1e-5, 'hyperbolicDistance symmetry');

const pp = euclideanToPoincare(new Float32Array([0.2, 0.1, 0.1]));
const addResult = mobiusAdd(pp, origin);
for (let i = 0; i < pp.length; i++) {
  assert(Math.abs(addResult[i] - pp[i]) < 1e-5, `mobiusAdd identity [${i}]`);
}

assert(isInPoincareBall(new Float32Array([0.5, 0.3, 0.2])), 'isInPoincareBall inside');
assert(!isInPoincareBall(new Float32Array([0.9, 0.9, 0.9])), 'isInPoincareBall outside');

// Similarity
const vecA = new Float32Array([1, 0, 0]);
const vecB = new Float32Array([0, 1, 0]);
const vecC = new Float32Array([1, 0, 0]);

assert(Math.abs(cosineSimilarity(vecA, vecC) - 1) < 1e-5, 'cosine identical = 1');
assert(Math.abs(cosineSimilarity(vecA, vecB)) < 1e-5, 'cosine orthogonal = 0');
assert(Math.abs(euclideanDistance(vecA, vecC)) < 1e-5, 'euclidean same = 0');
assert(Math.abs(euclideanDistance(vecA, vecB) - Math.sqrt(2)) < 1e-5, 'euclidean orthogonal');
assert(Math.abs(dotProduct(vecA, vecB)) < 1e-5, 'dot orthogonal = 0');
assert(Math.abs(dotProduct(vecA, vecC) - 1) < 1e-5, 'dot same = 1');

// MockEmbeddingService
const service = new MockEmbeddingService({ dimensions: 384 });
const embedding = await service.embed('test text');
assert(embedding.embedding instanceof Float32Array, 'embed returns Float32Array');
assert(embedding.embedding.length === 384, 'embed returns correct dimensions');

const e1 = await service.embed('hello world');
const e2 = await service.embed('hello world');
assert(Array.from(e1.embedding).every((v, i) => v === e2.embedding[i]), 'deterministic embeddings');

const e3 = await service.embed('hello');
const e4 = await service.embed('world');
assert(!Array.from(e3.embedding).every((v, i) => v === e4.embedding[i]), 'different text different embedding');

const cached = await service.embed('test text');
assert(cached.cached === true, 'cached result');

const batch = await service.embedBatch(['one', 'two', 'three']);
assert(batch.embeddings.length === 3, 'batch returns 3 embeddings');
assert(batch.embeddings[0].length === 384, 'batch correct dimensions');

console.log('\n✅ ALL TESTS PASSED!');
process.exit(0);
